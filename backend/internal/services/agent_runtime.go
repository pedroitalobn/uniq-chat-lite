package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/audioconvert"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type AgentRuntime struct {
	db         *gorm.DB
	manager    *whatsapp.Manager
	llm        *LLMService
	tts        *TTSService
	replyQueue *AgentReplyQueue  // jitter + serialização por instância (anti-ban)
	debouncer  *MessageDebouncer // agrupa mensagens sequenciais antes de responder

	seenMu   sync.Mutex
	seenMsgs map[string]time.Time
}

func NewAgentRuntime(db *gorm.DB, manager *whatsapp.Manager, llm *LLMService, tts *TTSService) *AgentRuntime {
	r := &AgentRuntime{
		db:         db,
		manager:    manager,
		llm:        llm,
		tts:        tts,
		replyQueue: NewAgentReplyQueue(manager),
		seenMsgs:   make(map[string]time.Time),
	}
	r.debouncer = NewMessageDebouncer(r.handleBatched)
	return r
}

// handleBatched é o callback do debouncer. Reentra em HandleIncoming pela
// mesma porta, mas com flag bypassBatching=true pra não cair em loop. O
// texto agregado já é o concatenado das mensagens do bucket; o messageID
// é o último (que serve de chave de dedup downstream).
func (r *AgentRuntime) handleBatched(p BatchPayload) {
	r.handleIncomingInternal(
		p.InstanceID, p.MessageID, p.FromJID, p.FromName, p.GroupJID,
		p.Text, p.MessageType, p.IsGroup, true,
	)
}

// HandleIncoming é a porta de entrada chamada pelo Manager. Decide entre
// debouncing (agrupar mensagens sequenciais e responder uma vez) e
// processamento direto. Quando batching estiver ativo no agente, esta
// função enfileira no MessageDebouncer e retorna true imediatamente —
// o flush real acontece via handleBatched() depois da janela de silêncio.
func (r *AgentRuntime) HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) bool {
	return r.handleIncomingInternal(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType, isGroup, false)
}

func (r *AgentRuntime) handleIncomingInternal(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup, bypassBatching bool) bool {
	if r == nil || r.db == nil || r.llm == nil {
		return false
	}
	if isGroup {
		return false
	}

	text := strings.TrimSpace(messageText)
	if text == "" || text == "—" {
		return false
	}
	mt := strings.ToLower(strings.TrimSpace(messageType))
	if mt == "protocol" || mt == "revoke" || mt == "status" || strings.Contains(strings.ToLower(fromJID), "@newsletter") {
		return false
	}
	if strings.HasPrefix(text, "/") {
		return false
	}
	// Quando o debouncer flushar (bypassBatching=true), o messageID já foi
	// "visto" no Enqueue inicial. Pular o dedup aqui evita matar o flush.
	if !bypassBatching && r.seenRecently(instanceID, messageID) {
		log.Debug().Str("instance", instanceID).Str("msg", messageID).Msg("agent-runtime: dedup — mensagem já processada")
		return false
	}

	// Logging de execução: começamos um struct mutável aqui que cada
	// branch pode preencher e chamar logExecution antes de retornar.
	started := time.Now()
	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return false
	}

	agent, agentMode, found := r.resolveAgent(instUUID, fromJID)
	if !found {
		// Diagnóstico — quando resolveAgent não retorna agente, ainda
		// queremos logar pra que o admin veja na aba "Logs" que a
		// mensagem chegou mas foi bloqueada. Procura o primário pra
		// usar agent_id no log + identifica a razão provável.
		r.logSkippedNoAgent(instUUID, text, started, fromJID)
		return false
	}

	// Debounce / message batching — quando habilitado, em vez de responder
	// agora, acumulamos a mensagem num bucket e (re)programamos o flush.
	// Mensagens novas dentro da janela resetam o timer; só quando o cliente
	// "para de digitar" (silêncio > window) chamamos o LLM com o texto
	// agregado. Mimetiza humano lendo o burst todo antes de responder.
	// bypassBatching=true vem do próprio debouncer; evita loop infinito.
	if !bypassBatching {
		if window := BatchingWindow(agent.MessageBatching); window > 0 {
			r.debouncer.Enqueue(BatchPayload{
				InstanceID:  instanceID,
				MessageID:   messageID,
				FromJID:     fromJID,
				FromName:    fromName,
				GroupJID:    groupJID,
				Text:        text,
				MessageType: messageType,
				IsGroup:     isGroup,
			}, window)
			log.Info().
				Str("instance", instanceID).
				Str("agent", agent.AgentName).
				Str("chat", fromJID).
				Dur("window", window).
				Msg("agent-runtime: mensagem agrupada, aguardando silêncio antes de responder")
			return true
		}
	}

	if !agentAllowsMessageType(agent.TriggerMessageTypes, messageType) {
		log.Debug().
			Str("instance", instanceID).
			Str("agent", agent.AgentName).
			Str("message_type", messageType).
			Msg("agent-runtime: tipo de mensagem não habilitado")
		r.logExecution(models.AgentExecution{
			AgentID: agent.ID, InstanceID: instUUID,
			Trigger: "inbound", Status: "skipped", SkipReason: "message_type_not_allowed",
			InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
		})
		return false
	}

	// Resolve LLM integration. Prioridade:
	//   1. Agent.Integration (custom escolhida pelo user em /agents)
	//   2. PlatformAI default (Uniq AI configurada pelo admin) — quando
	//      o agent não tem integration_id.
	//   3. Sem fallback → não responde (e loga pra debug).
	//
	// Antes a função BAILAVA OUT em (1), o que fazia agentes em Uniq AI
	// (que é o default da UI!) nunca responderem. UI marcava como pronto,
	// runtime silenciava — confusão clássica.
	var integration *models.UserIntegration
	if agent.Integration != nil && agent.IntegrationID != nil {
		integration = agent.Integration
	} else {
		// Fallback Uniq AI / PlatformAI.
		var pai models.PlatformAI
		if err := r.db.Where("is_active = true AND api_key <> ''").
			Order("created_at ASC").First(&pai).Error; err == nil {
			integration = PlatformAIToIntegration(&pai)
		}
	}
	if integration == nil {
		log.Warn().
			Str("instance", instanceID).
			Str("agent", agent.AgentName).
			Msg("agent-runtime: nenhuma LLM disponível (sem integração custom e sem PlatformAI configurada)")
		r.logExecution(models.AgentExecution{
			AgentID: agent.ID, InstanceID: instUUID,
			Trigger: "inbound", Status: "skipped", SkipReason: "no_llm",
			InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
		})
		return false
	}
	if model := strings.TrimSpace(agent.Model); model != "" {
		if b, err := json.Marshal([]string{model}); err == nil {
			copy := *integration
			copy.Models = string(b)
			integration = &copy
		}
	}

	client := r.manager.GetInstance(instanceID)
	if client == nil || !client.IsConnected() {
		r.logExecution(models.AgentExecution{
			AgentID: agent.ID, InstanceID: instUUID,
			Trigger: "inbound", Status: "skipped", SkipReason: "instance_disconnected",
			InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
		})
		return false
	}

	// Trigger gate — em qual condição o agente DECIDE responder.
	// "any" passa direto. "keyword" exige match na mensagem inbound.
	// "webhook" não responde inbound NUNCA — só é disparado via
	// /v1/webhooks/agent-trigger/:slug.
	if !shouldTriggerAgent(agent, text) {
		log.Debug().
			Str("agent", agent.AgentName).
			Str("trigger_mode", agent.TriggerMode).
			Msg("agent-runtime: trigger não satisfeito — pulando")
		reason := "trigger_no_match"
		if strings.ToLower(agent.TriggerMode) == "webhook" {
			reason = "trigger_webhook_only"
		}
		r.logExecution(models.AgentExecution{
			AgentID: agent.ID, InstanceID: instUUID,
			Trigger: "inbound", Status: "skipped", SkipReason: reason,
			InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
		})
		return false
	}

	systemPrompt := BuildAgentSystemPrompt(agent, agent.Assets)
	if siblings := r.loadSiblingsForPrompt(agent); siblings != "" {
		systemPrompt += "\n\n" + siblings
	}
	// Anti-repetição CROSS-conversa. O LLM tem cap de naturalidade
	// quando recebe a mesma pergunta de várias pessoas e responde
	// literalmente igual — isso explode o circuit breaker
	// recipient_burst. Injetamos as últimas respostas que este agente
	// mandou pra OUTROS clientes na mesma instância pra que o modelo
	// varie tom/emoji/ordem das frases naturalmente.
	recentInstanceReplies := r.recentInstanceOutboundTexts(instUUID, fromJID, 10)
	if len(recentInstanceReplies) > 0 {
		systemPrompt += "\n\n" + buildAntiRepetitionSection(recentInstanceReplies)
	}
	if tools := BuildToolsPromptSection(agent); tools != "" {
		systemPrompt += "\n\n" + tools
	}
	// Memória de longo prazo do contato (se houver). Acumulada por
	// SummarizeContactConversation a cada conversa fechada. Sem isso o
	// agente "esquece" tudo que aprendeu além dos últimos 25 turnos.
	if contactID := r.resolveContactID(instUUID, fromJID); contactID != uuid.Nil {
		if mem := LoadContactMemoryPrompt(r.db, contactID); mem != "" {
			systemPrompt += "\n\n" + mem
		}
	}
	// Contexto personalizado do operador para esta conversa.
	if conv := r.resolveConversation(instUUID, fromJID); conv.ID != uuid.Nil {
		var state models.ConversationAgentState
		if err := r.db.Where("conversation_id = ?", conv.ID).First(&state).Error; err == nil {
			if ctx := strings.TrimSpace(state.CustomContext); ctx != "" {
				systemPrompt += "\n\nINSTRUÇÕES ADICIONAIS DO OPERADOR PARA ESTA CONVERSA\n" + ctx
			}
		}
	}
	userPrompt := r.buildUserPrompt(instUUID, fromJID, fromName, text, messageType)
	if strings.TrimSpace(systemPrompt) == "" {
		systemPrompt = "Você é um assistente de atendimento útil, profissional e objetivo."
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	llmResult, err := r.llm.CallChatWithSystemResult(ctx, integration, systemPrompt, userPrompt, false)
	if err != nil {
		log.Error().Err(err).Str("instance", instanceID).Str("chat", fromJID).Msg("agent-runtime: falha ao gerar resposta")
		r.logExecution(models.AgentExecution{
			AgentID: agent.ID, InstanceID: instUUID,
			Trigger: "inbound", Status: "failed", ErrorMessage: err.Error(),
			InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
		})
		return false
	}
	reply := llmResult.Content
	recordLLMUsage(ctx, r.db, instUUID, integration, llmResult, userPrompt+systemPrompt, reply)

	reply = sanitizeAssistantReply(reply)
	// Dedup contra a última resposta do agente nessa conversa. Mesmo com
	// as instruções de "não repita verbatim" no system prompt, LLMs
	// (especialmente os menores) reciclam closers tipo "Se precisar de
	// mais detalhes, posso checar com a equipe" turno após turno.
	// Removemos sentenças que aparecem idênticas (modulo casing/pontuação)
	// na resposta imediatamente anterior do agente.
	if prev := r.lastAgentReply(instUUID, fromJID); prev != "" {
		reply = dedupAgainstPrevious(reply, prev)
	}
	// Anti-repetição cross-conversa: se o reply ainda saiu muito
	// parecido com algo recente da MESMA instância pra OUTRO cliente,
	// regeneramos UMA vez com instrução reforçada. Limiar 0.65 cobre
	// o caso "Olá, tudo bem? Posso ajudar..." vs "Olá! Tudo certo,
	// como posso ajudar..." que dispara o circuit breaker mesmo sendo
	// quase idêntico semanticamente.
	if len(recentInstanceReplies) > 0 && replyTooSimilar(reply, recentInstanceReplies, 0.65) {
		log.Warn().Str("instance", instanceID).Str("chat", fromJID).
			Msg("agent-runtime: reply muito similar a respostas recentes — regenerando com reforço")
		retrySystem := systemPrompt + "\n\nATENÇÃO MÁXIMA: a resposta anterior que você gerou foi muito parecida com mensagens recentes pra outros clientes. REESCREVA usando palavras DIFERENTES, ordem DIFERENTE de frases, emoji DIFERENTE. Mantenha o significado, mude completamente a forma."
		retryCtx, retryCancel := context.WithTimeout(context.Background(), 30*time.Second)
		if retryResult, retryErr := r.llm.CallChatWithSystemResult(retryCtx, integration, retrySystem, userPrompt, false); retryErr == nil && strings.TrimSpace(retryResult.Content) != "" {
			retryClean := sanitizeAssistantReply(retryResult.Content)
			if retryClean != "" && !replyTooSimilar(retryClean, recentInstanceReplies, 0.75) {
				reply = retryClean
			}
		}
		retryCancel()
	}
	if reply == "" {
		r.logExecution(models.AgentExecution{
			AgentID: agent.ID, InstanceID: instUUID,
			Trigger: "inbound", Status: "failed", ErrorMessage: "LLM retornou resposta vazia",
			InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
		})
		return false
	}

	// Multi-agente: detecta marcador [[handoff:role]], pina sibling em
	// ConversationAgentState e remove o token da resposta visível.
	var convForActions models.Conversation
	convForActionsLoaded := false
	{
		if err := r.db.Where("instance_id = ? AND channel_key = ?", instUUID, fromJID).
			Where("status IN ?", []models.ConversationStatus{
				models.ConversationStatusOpen,
				models.ConversationStatusPending,
				models.ConversationStatusSnoozed,
			}).
			Order("updated_at DESC").First(&convForActions).Error; err == nil {
			reply = r.detectAndApplyHandoff(agent, &convForActions, reply)
			convForActionsLoaded = true
		} else {
			reply = handoffMarkerRe.ReplaceAllString(reply, "")
			reply = strings.TrimSpace(reply)
		}
		if reply == "" {
			return false
		}
	}

	// Ações nativas: marker [[action:NAME({...})]]. ParseAndExecuteActions
	// despacha tools (add_tag, note, create_task, schedule_meeting,
	// transfer_to_human) respeitando ActionConfirmation e devolve a reply
	// já sem markers.
	{
		toolCtx := AgentToolContext{
			DB:           r.db,
			Agent:        agent,
			Conversation: &convForActions,
		}
		if convForActionsLoaded {
			toolCtx.WorkspaceID = convForActions.WorkspaceID
		}
		if convForActionsLoaded && convForActions.ContactID != nil {
			var contact models.Contact
			if err := r.db.First(&contact, "id = ?", *convForActions.ContactID).Error; err == nil {
				toolCtx.Contact = &contact
			}
		}
		// Resolve user dono da instância pra rastreabilidade.
		var inst models.Instance
		if err := r.db.Select("id, user_id, workspace_id").First(&inst, "id = ?", instUUID).Error; err == nil {
			toolCtx.CreatedByID = inst.UserID
			if toolCtx.WorkspaceID == uuid.Nil && inst.WorkspaceID != nil {
				toolCtx.WorkspaceID = *inst.WorkspaceID
			}
		}
		var results []AgentToolResult
		reply, results = ParseAndExecuteActions(toolCtx, reply)
		for _, res := range results {
			log.Info().
				Str("tool", res.Tool).
				Bool("ok", res.OK).
				Str("detail", res.Detail).
				Str("agent", agent.AgentName).
				Msg("agent-runtime: tool executada")
		}
		if reply == "" {
			return false
		}
	}

	// Modo "observing": salva sugestão no estado da conversa, não envia.
	if agentMode == models.AgentModeObserving {
		r.saveSuggestion(instUUID, fromJID, messageID, reply)
		log.Info().
			Str("instance", instanceID).
			Str("chat", fromJID).
			Str("agent", agent.AgentName).
			Msg("agent-runtime: sugestão salva (modo observing)")
		return true
	}

	// AudioReplyMode decide se o agente tenta responder em áudio:
	//   text        → nunca (sempre texto).
	//   audio       → sempre tenta (com fallback automático pra texto).
	//   match_input → só se a inbound foi áudio (espelha o canal).
	// Se trySendAudio falhar (voz não configurada, TTS down, etc.), cai pro
	// path de texto via reply queue — fallback transparente.
	if r.tts != nil && shouldReplyWithAudio(agent, messageType) && r.trySendAudio(ctx, client, agent, fromJID, reply) {
		_ = client.SendTyping(fromJID, false)
		log.Info().
			Str("instance", instanceID).
			Str("chat", fromJID).
			Str("agent", agent.AgentName).
			Msg("agent-runtime: resposta enviada em áudio")
		return true
	}

	// Detecta se é a primeira mensagem do agente nesta conversa — aciona
	// delay extra (first_message_delay) antes do typing indicator.
	isFirstMessage := false
	if convForActionsLoaded && convForActions.ID != uuid.Nil {
		var agentMsgCount int64
		r.db.Model(&models.MessageLog{}).
			Where("conversation_id = ? AND direction = ? AND type = ?", convForActions.ID, models.DirectionOut, "text").
			Count(&agentMsgCount)
		isFirstMessage = agentMsgCount == 0
	}

	// Texto: enfileira via AgentReplyQueue. Worker per-instance aplica
	// "digitando…" + sleep proporcional ao tamanho da resposta + jitter
	// + cooldown final. Mimetiza humano único atendendo, reduz risco de
	// banimento por padrão robótico.
	r.replyQueue.Enqueue(AgentReplyJob{
		InstanceID:       instanceID,
		ToJID:            fromJID,
		Reply:            reply,
		AgentName:        agent.AgentName,
		Pace:             agent.ResponsePace,
		PaceSettingsJSON: agent.PaceSettings,
		MessageID:        messageID,
		IsFirstMessage:   isFirstMessage,
	})

	log.Info().
		Str("instance", instanceID).
		Str("chat", fromJID).
		Str("agent", agent.AgentName).
		Msg("agent-runtime: resposta enviada")

	r.logExecution(models.AgentExecution{
		AgentID: agent.ID, InstanceID: instUUID,
		Trigger: "inbound", Status: "success",
		InputPreview: text, ReplyPreview: reply,
		DurationMs: int(time.Since(started).Milliseconds()),
	})
	return true
}

func agentAllowsMessageType(raw, messageType string) bool {
	mt := strings.ToLower(strings.TrimSpace(messageType))
	if mt == "" {
		mt = "text"
	}
	var allowed []string
	if err := json.Unmarshal([]byte(raw), &allowed); err != nil || len(allowed) == 0 {
		allowed = []string{"text"}
	}
	for _, item := range allowed {
		v := strings.ToLower(strings.TrimSpace(item))
		if v == "all" || v == mt {
			return true
		}
	}
	return false
}

// saveSuggestion persiste a última sugestão gerada no modo observing.
func (r *AgentRuntime) saveSuggestion(instanceID uuid.UUID, fromJID, msgID, suggestion string) {
	var conv models.Conversation
	if err := r.db.
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).
		Order("updated_at DESC").
		First(&conv).Error; err != nil {
		return
	}
	now := time.Now()
	var state models.ConversationAgentState
	if r.db.Where("conversation_id = ?", conv.ID).First(&state).Error != nil {
		r.db.Create(&models.ConversationAgentState{
			ConversationID:  conv.ID,
			Mode:            models.AgentModeObserving,
			LastSuggestion:  suggestion,
			SuggestionAt:    &now,
			SuggestionMsgID: msgID,
		})
	} else {
		r.db.Model(&state).Updates(map[string]interface{}{
			"last_suggestion":   suggestion,
			"suggestion_at":     now,
			"suggestion_msg_id": msgID,
		})
	}
}

// resolveAgent decides which InstanceAgent answers a given inbound message.
//
// Precedence:
//  1. ConversationAgentState.Mode = disabled → no bot.
//  2. ConversationAgentState.AgentID set → use that specific agent.
//  3. ConversationAgentState.Mode = active|observing, no AgentID → continue.
//  4. If no state: Conversation.is_bot_active=false → no bot.
//  5. Queue-level agent (EnableChatbot + ChatbotAgentID).
//  6. Instance-level agent fallback.
//
// Returns (agent, mode, found). mode is AgentModeActive or AgentModeObserving.
func (r *AgentRuntime) resolveAgent(instanceID uuid.UUID, fromJID string) (*models.InstanceAgent, models.AgentMode, bool) {
	preloadAgent := func(db *gorm.DB, cond string, args ...interface{}) (*models.InstanceAgent, bool) {
		var a models.InstanceAgent
		// Multi-agente: quando o filtro é por instance_id, queremos o agente
		// primário. ORDER BY é defensivo pra todos os casos — ID lookup
		// retorna 1 row de qualquer jeito.
		err := db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
			return tx.Where("is_active = ?", true).Order("created_at DESC")
		}).Where(cond, args...).
			Order("is_primary DESC, priority ASC, created_at ASC").
			First(&a).Error
		return &a, err == nil
	}

	// Load the active conversation for this instance + channel_key.
	var conv models.Conversation
	convErr := r.db.
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).
		Order("updated_at DESC").
		First(&conv).Error

	// Janela de ativação: gate antes de retornar qualquer agente. Usa
	// time.Now() + msgCount da conversa pra decidir new_contact_only.
	now := time.Now()
	msgCount := 0
	if convErr == nil {
		var c int64
		r.db.Model(&models.MessageLog{}).Where("conversation_id = ?", conv.ID).Count(&c)
		msgCount = int(c)
	}
	gate := func(a *models.InstanceAgent) bool {
		if !isAgentActiveNow(a, now, msgCount) {
			log.Debug().
				Str("agent", a.AgentName).
				Str("mode", a.ActivationMode).
				Msg("agent-runtime: fora da janela de ativação — handoff pra humano")
			return false
		}
		return true
	}

	// Check per-conversation agent state (highest precedence)
	if convErr == nil {
		var state models.ConversationAgentState
		if stateErr := r.db.Where("conversation_id = ?", conv.ID).First(&state).Error; stateErr == nil {
			if state.Mode == models.AgentModeDisabled {
				return nil, models.AgentModeDisabled, false
			}
			mode := state.Mode
			if mode == "" {
				mode = models.AgentModeActive
			}
			// Agent override
			if state.AgentID != nil {
				if a, ok := preloadAgent(r.db, "id = ? AND is_active = ?", *state.AgentID, true); ok {
					if gate(a) {
						return a, mode, true
					}
					return nil, models.AgentModeDisabled, false
				}
			}
			// No agent override but mode is set — fall through to queue/instance resolution
			// but preserve the mode.
			if a, ok := r.resolveQueueOrInstance(conv, instanceID, preloadAgent); ok {
				if gate(a) {
					return a, mode, true
				}
				return nil, models.AgentModeDisabled, false
			}
			return nil, models.AgentModeDisabled, false
		}
	}

	// Removido check legado de is_bot_active. Source of truth é
	// ConversationAgentState (acima). is_bot_active tem default false no
	// model — conversas antigas/migradas vinham bloqueadas erroneamente,
	// agente não respondia mesmo estando ativo. Quando humano desliga o
	// bot pela UI do inbox, ConversationAgentState.Mode=disabled é setado
	// e o branch acima já trata.

	if a, ok := r.resolveQueueOrInstance(conv, instanceID, preloadAgent); ok {
		if gate(a) {
			return a, models.AgentModeActive, true
		}
	}
	return nil, models.AgentModeDisabled, false
}

func (r *AgentRuntime) resolveQueueOrInstance(conv models.Conversation, instanceID uuid.UUID, load func(*gorm.DB, string, ...interface{}) (*models.InstanceAgent, bool)) (*models.InstanceAgent, bool) {
	// Queue-level agent
	if conv.QueueID != nil {
		var q models.Queue
		if qErr := r.db.First(&q, "id = ?", *conv.QueueID).Error; qErr == nil {
			if q.EnableChatbot && q.ChatbotAgentID != nil {
				if a, ok := load(r.db, "id = ? AND is_active = ?", *q.ChatbotAgentID, true); ok {
					return a, true
				}
			}
		}
	}
	// Instance-level fallback
	return load(r.db, "instance_id = ? AND is_active = ?", instanceID, true)
}

func (r *AgentRuntime) buildUserPrompt(instanceID uuid.UUID, fromJID, fromName, latestMessage, messageType string) string {
	// Aumenta janela de histórico de 10→25 turnos. Antes o agente
	// ficava repetitivo porque "esquecia" perguntas/respostas anteriores
	// rapidamente. 25 turnos cobrem ~5min de bate-papo médio.
	history := r.recentHistory(instanceID, fromJID, 25)
	lastBotReply := r.lastAgentReply(instanceID, fromJID)
	if fromName == "" {
		fromName = extractPhoneFromJIDLocal(fromJID)
	}

	var b strings.Builder
	b.WriteString("Contexto da conversa em tempo real.\n")
	b.WriteString(fmt.Sprintf("Contato: %s\n", strings.TrimSpace(fromName)))
	b.WriteString(fmt.Sprintf("Canal: WhatsApp\nTipo da mensagem: %s\n", messageType))
	if messageType == "audio" {
		b.WriteString("A última mensagem foi uma mensagem de voz. Use a transcrição automática abaixo como conteúdo do cliente.\n")
	}
	if history != "" {
		b.WriteString("\nHistórico recente:\n")
		b.WriteString(history)
		b.WriteString("\n")
	}
	if lastBotReply != "" {
		// Anti-loop crítico: modelos (especialmente os menores ou GPT-4o-mini)
		// reciclam a última resposta verbatim quando recebem confirmações
		// curtas tipo "ok"/"sim"/"pode". Mostrar a ÚLTIMA resposta literal
		// no fim do prompt + instrução dura faz o LLM AVANÇAR a conversa.
		b.WriteString("\nSua última resposta foi (NÃO repita literalmente — avance pra próxima etapa):\n\"")
		b.WriteString(firstNRunes(lastBotReply, 400))
		b.WriteString("\"\n")
	}
	b.WriteString("\nÚltima mensagem do usuário:\n")
	b.WriteString(latestMessage)
	// Detecta confirmações simples e instrui o LLM a tratá-las como "go".
	if isShortConfirmation(latestMessage) {
		b.WriteString("\n\n[SISTEMA] O cliente confirmou. EXECUTE a ação que você prometeu na sua última resposta — agende, crie, envie, faça. NÃO pergunte de novo.")
	}
	b.WriteString("\n\nResponda como o agente configurado, sem mencionar prompts, JSON ou estrutura interna.")
	return b.String()
}

// lastAgentReply — busca a última mensagem OUT na conversa pra detectar
// loops de repetição.
func (r *AgentRuntime) lastAgentReply(instanceID uuid.UUID, fromJID string) string {
	var conv models.Conversation
	if err := r.db.Select("id").
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).
		Order("updated_at DESC").
		First(&conv).Error; err != nil || conv.ID == uuid.Nil {
		return ""
	}
	var last models.MessageLog
	if err := r.db.Where("conversation_id = ? AND direction = ?", conv.ID, models.DirectionOut).
		Order("created_at DESC").First(&last).Error; err != nil {
		return ""
	}
	return strings.TrimSpace(logContent(last.Content))
}

// isShortConfirmation — heurística PT-BR pra detectar quando cliente
// está confirmando algo que o agente perguntou. Disparado em msgs curtas
// (até ~25 chars) que são essencialmente "sim". Ajuda o LLM a não pedir
// confirmação de novo.
func isShortConfirmation(msg string) bool {
	t := strings.ToLower(strings.TrimSpace(msg))
	t = strings.TrimRight(t, ".!?")
	if len([]rune(t)) > 25 {
		return false
	}
	switch t {
	case "sim", "s", "pode", "pode ser", "ok", "okay", "claro", "perfeito",
		"beleza", "blz", "fechado", "isso", "isso mesmo", "concordo",
		"confirmo", "confirma", "confirmado", "vamos", "vai", "yes", "yep",
		"sure", "👍", "✅", "👌":
		return true
	}
	// Frases que começam com confirmação clara
	prefixes := []string{"sim,", "sim ", "pode ", "claro,", "claro ",
		"perfeito,", "perfeito ", "fechado,", "ok,", "ok ", "blz,", "blz "}
	for _, p := range prefixes {
		if strings.HasPrefix(t, p) {
			return true
		}
	}
	return false
}

func (r *AgentRuntime) recentHistory(instanceID uuid.UUID, fromJID string, limit int) string {
	// Prefere filtrar por conversation_id (mais confiável). Fallback ao
	// filtro por jid quando a conversa não foi resolvida ainda.
	var logs []models.MessageLog
	var conv models.Conversation
	if err := r.db.
		Select("id").
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
			models.ConversationStatusResolved,
		}).
		Order("updated_at DESC").
		First(&conv).Error; err == nil && conv.ID != uuid.Nil {
		r.db.Where("conversation_id = ?", conv.ID).
			Order("created_at DESC").
			Limit(limit).
			Find(&logs)
	} else {
		// Fallback antigo — filtro por JID com OR. Pode pegar msgs de
		// outras conversas com mesmo número, mas é melhor que nada.
		phone := extractPhoneFromJIDLocal(fromJID)
		r.db.Where("instance_id = ? AND (to_jid = ? OR to_jid LIKE ? OR sender_jid = ?)",
			instanceID, fromJID, phone+"%@", fromJID).
			Order("created_at DESC").
			Limit(limit).
			Find(&logs)
	}

	if len(logs) == 0 {
		return ""
	}

	lines := make([]string, 0, len(logs))
	for i := len(logs) - 1; i >= 0; i-- {
		content := strings.TrimSpace(logContent(logs[i].Content))
		if logs[i].Type == "audio" && strings.TrimSpace(logs[i].Transcription) != "" {
			content = "[áudio transcrito] " + strings.TrimSpace(logs[i].Transcription)
		}
		if content == "" {
			continue
		}
		role := "Cliente"
		if logs[i].Direction == models.DirectionOut {
			role = "Agente"
		}
		lines = append(lines, fmt.Sprintf("- %s: %s", role, content))
	}
	return strings.Join(lines, "\n")
}

// shouldReplyWithAudio decide se vamos tentar responder em áudio baseado
// no AudioReplyMode do agente e no tipo da mensagem inbound. Quando volta
// false, o caller pula trySendAudio e vai direto pro texto. Quando true,
// trySendAudio ainda pode falhar silenciosamente (sem voz configurada /
// TTS down) — nesse caso o caller também cai no texto. Resultado: o
// fallback "áudio configurado mas voz faltando → texto" é automático.
func shouldReplyWithAudio(agent *models.InstanceAgent, inboundType string) bool {
	if agent == nil {
		return false
	}
	mode := strings.ToLower(strings.TrimSpace(agent.AudioReplyMode))
	switch mode {
	case "audio":
		return true
	case "match_input":
		return strings.EqualFold(strings.TrimSpace(inboundType), "audio")
	case "text", "":
		return false
	}
	return false
}

// trySendAudio converts reply text to audio via TTS and sends it as a PTT message.
// Returns true if audio was sent successfully.
//
// Resolução do provider de voz:
//  1. cfg.WorkspaceVoiceID = "uniq:<voice_id>" → usa Uniq Voice (platform)
//     com a voz <voice_id>. Gated por plano (AllowVoice).
//  2. cfg.WorkspaceVoiceID = UUID → carrega WorkspaceVoice + Provider
//     próprio do workspace.
//  3. cfg.WorkspaceVoiceID vazio + plano libera + Uniq Voice ativo →
//     usa Uniq Voice com a primeira voz da config global.
func (r *AgentRuntime) trySendAudio(ctx context.Context, client interface {
	SendAudioMessage(string, []byte, string, bool, uint32) (string, error)
}, agent *models.InstanceAgent, toJID, text string) bool {
	cfg, ok := parseAgentVoiceConfig(agent.Voice)
	if !ok {
		return false
	}

	// Resolve provider e voice_id externo. Pode vir do WorkspaceVoice
	// próprio, OU do PlatformVoice (Uniq Voice) quando o user não tem
	// VoiceProvider configurado e o plano libera.
	var (
		voiceProvider *models.VoiceProvider
		voiceExternal string
	)

	if strings.HasPrefix(cfg.WorkspaceVoiceID, "uniq:") {
		// Modo explícito Uniq Voice — extrai voice_id e resolve platform.
		voiceExternal = strings.TrimPrefix(cfg.WorkspaceVoiceID, "uniq:")
		vp, _ := r.resolvePlatformVoiceProvider(ctx, agent.InstanceID)
		if vp == nil {
			return false
		}
		voiceProvider = vp
	} else if cfg.WorkspaceVoiceID != "" {
		// Path original: workspace voice por UUID.
		voiceID, err := uuid.Parse(cfg.WorkspaceVoiceID)
		if err != nil {
			return false
		}
		var voice models.WorkspaceVoice
		if r.db.Preload("Provider").First(&voice, "id = ?", voiceID).Error != nil {
			return false
		}
		if voice.Source == "uniq_voice" || voice.PlatformVoiceID != nil {
			vp, _ := r.resolvePlatformVoiceProvider(ctx, agent.InstanceID)
			if vp == nil {
				return false
			}
			voiceProvider = vp
		} else {
			if voice.Provider == nil || !voice.Provider.IsActive {
				return false
			}
			voiceProvider = voice.Provider
		}
		voiceExternal = voice.ExternalID
	} else {
		// audio_enabled=true mas sem voice_id setado — tenta Uniq Voice
		// como último recurso. Pega a primeira voz da config global.
		vp, voiceID := r.resolvePlatformVoiceProvider(ctx, agent.InstanceID)
		if vp == nil {
			return false
		}
		voiceProvider = vp
		voiceExternal = voiceID
	}

	stability := cfg.Stability
	if stability == 0 {
		stability = 0.5
	}
	similarity := cfg.Similarity
	if similarity == 0 {
		similarity = 0.75
	}
	style := cfg.Style
	speed := cfg.Speed
	if speed == 0 {
		speed = 1.0
	}

	audioData, mime, err := r.tts.Synthesize(ctx, voiceProvider, TTSRequest{
		Text:       text,
		VoiceID:    voiceExternal,
		Stability:  stability,
		Similarity: similarity,
		Style:      style,
		Speed:      speed,
	})
	if err != nil {
		log.Warn().Err(err).Str("voice", voiceExternal).Msg("agent-runtime: TTS falhou, usando texto")
		return false
	}
	// Grava consumo de Voice (categoria voice, chars sintetizados).
	recordTTSUsage(ctx, r.db, agent.InstanceID, string(voiceProvider.Provider), voiceExternal, text)

	// PTT só é válido com containers Opus (ogg/webm). Forçar PTT=true em
	// MP3/AAC faz o destinatário receber o áudio como "indisponível" porque
	// o WhatsApp espera Opus quando AudioMessage.PTT=true. Os providers TTS
	// atuais devolvem MP3, então transcodamos pra OGG/Opus quando ffmpeg
	// estiver disponível (vira voice note real). Sem ffmpeg, mandamos como
	// anexo MP3 mesmo (PTT=false) — opção segura.
	low := strings.ToLower(mime)
	outBytes := audioData
	outMime := mime
	var ptt bool
	var seconds uint32
	if strings.Contains(low, "opus") || strings.Contains(low, "ogg") || strings.Contains(low, "webm") {
		ptt = true
	} else {
		// MP3/AAC do TTS — tenta transcodar pra voice note. Se ffmpeg
		// faltar, mantém anexo MP3 sem PTT.
		if conv, dur, terr := audioconvert.TranscodeToOggOpus(ctx, audioData); terr == nil {
			outBytes = conv
			outMime = "audio/ogg; codecs=opus"
			ptt = true
			seconds = dur
		}
	}
	_, err = client.SendAudioMessage(toJID, outBytes, outMime, ptt, seconds)
	return err == nil
}

// parseAgentVoiceConfig desserializa o campo Voice do InstanceAgent.
func parseAgentVoiceConfig(raw string) (*agentVoiceConfig, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || raw == "null" {
		return nil, false
	}
	var cfg agentVoiceConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, false
	}
	// Aceita: voice_id explícito (UUID OR "uniq:<id>") OR vazio (vai cair
	// no fallback de Uniq Voice se o plano permitir + platform tiver voz).
	return &cfg, cfg.AudioEnabled
}

// resolvePlatformVoiceProvider — carrega o PlatformVoice ativo e devolve
// um *models.VoiceProvider sintético (in-memory) compatível com os
// adapters do TTSService. O voice_id externo default vem da primeira
// entrada do array de Voices da config (JSON), ou de defaults conhecidos
// por provider quando vazio. Retorna nil se:
//   - plano do user não libera FeatureVoice
//   - Não há PlatformVoice ativo configurado pelo super admin
//   - PlatformVoice tem provider name fora do conjunto suportado pelo TTSService
func (r *AgentRuntime) resolvePlatformVoiceProvider(ctx context.Context, instanceID uuid.UUID) (*models.VoiceProvider, string) {
	// Acha o user dono da instância e seu plano.
	var inst models.Instance
	if err := r.db.WithContext(ctx).Preload("User.Plan").First(&inst, "id = ?", instanceID).Error; err != nil {
		return nil, ""
	}
	if inst.User == nil {
		return nil, ""
	}
	plan := inst.User.Plan
	// Super admin / planos sem feature locked = bloqueia. UI já indica que
	// Uniq Voice não está disponível, mas defesa em profundidade aqui.
	if plan == nil || !plan.HasFeature(models.FeatureVoice) {
		return nil, ""
	}
	var pv models.PlatformVoice
	if err := r.db.WithContext(ctx).
		Where("is_active = ?", true).
		Order("created_at ASC").
		First(&pv).Error; err != nil {
		return nil, ""
	}
	// Mapeia o name do provider pro enum interno do VoiceProvider. Se o
	// super admin colocou um provider que ainda não temos adapter, o TTS
	// vai falhar com "provider não suportado" — log warn no caller.
	pname := models.VoiceProviderType("")
	switch strings.ToLower(pv.Provider) {
	case "elevenlabs":
		pname = models.VoiceProviderElevenLabs
	case "qwen_tts", "qwen":
		pname = models.VoiceProviderQwenTTS
	case "openai_tts", "openai":
		pname = models.VoiceProviderOpenAITTS
	default:
		log.Warn().Str("provider", pv.Provider).Msg("uniq voice: provider sem adapter no TTSService")
		return nil, ""
	}
	virt := &models.VoiceProvider{
		ID:       pv.ID,
		Provider: pname,
		APIKey:   pv.APIKey,
		IsActive: true,
		Name:     pv.Name,
	}
	// Voice id default: primeira da config global, ou fallback por provider.
	voiceID := firstPlatformVoiceID(pv.Voices)
	if voiceID == "" {
		switch pname {
		case models.VoiceProviderElevenLabs:
			voiceID = "21m00Tcm4TlvDq8ikWAM" // Rachel
		case models.VoiceProviderQwenTTS:
			voiceID = "longxiaoxia"
		case models.VoiceProviderOpenAITTS:
			voiceID = "nova"
		}
	}
	return virt, voiceID
}

// firstPlatformVoiceID — extrai o "id" do primeiro item do array de
// vozes salvo como JSON em PlatformVoice.Voices. Robusto contra JSON
// inválido (retorna "" e cai no default por provider no caller).
func firstPlatformVoiceID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(raw), &arr); err != nil || len(arr) == 0 {
		return ""
	}
	if id, ok := arr[0]["id"].(string); ok {
		return id
	}
	return ""
}

type agentVoiceConfig struct {
	WorkspaceVoiceID string  `json:"workspace_voice_id,omitempty"`
	AudioEnabled     bool    `json:"audio_enabled"`
	Stability        float64 `json:"stability"`
	Similarity       float64 `json:"similarity"`
	Style            float64 `json:"style"`
	Speed            float64 `json:"speed"`
}

func (r *AgentRuntime) seenRecently(instanceID, messageID string) bool {
	if messageID == "" {
		return false
	}
	key := instanceID + ":" + messageID
	now := time.Now()

	r.seenMu.Lock()
	defer r.seenMu.Unlock()

	for k, ts := range r.seenMsgs {
		if now.Sub(ts) > 15*time.Minute {
			delete(r.seenMsgs, k)
		}
	}
	if ts, ok := r.seenMsgs[key]; ok && now.Sub(ts) < 15*time.Minute {
		return true
	}
	r.seenMsgs[key] = now
	return false
}

func BuildAgentSystemPrompt(agent *models.InstanceAgent, assets []models.AgentAsset) string {
	if agent == nil {
		return ""
	}

	sections := []string{
		uniqBasePersona,
		"Responda sempre no idioma do usuário.",
		"Se a base não trouxer informação suficiente, diga isso com transparência e proponha encaminhamento humano em vez de inventar detalhes.",
		// Anti-repetição — alça o problema "agente cumprimenta a cada msg".
		// Vai como diretriz no início do system prompt pra que o modelo já
		// considere desde a primeira tokenização.
		"REGRAS DE CONTINUIDADE DA CONVERSA (críticas):\n" +
			"- O HISTÓRICO RECENTE da conversa será fornecido logo abaixo. LEIA antes de responder.\n" +
			"- ⚠️ NUNCA EM HIPÓTESE ALGUMA repita VERBATIM (palavra por palavra) sua última resposta. Se o cliente confirmou (\"sim\", \"pode\", \"ok\", \"claro\"), AVANCE pra próxima etapa — execute a ação prometida ou conduza pra próximo passo.\n" +
			"- NUNCA cumprimente novamente se já cumprimentou nesta conversa. Saudação só na PRIMEIRA mensagem.\n" +
			"- NUNCA se apresente novamente (\"Sou o X, da Y\") se já se apresentou antes.\n" +
			"- NUNCA repita literalmente o que o cliente acabou de dizer (\"Entendi que você quer X\" → vá direto ao ponto).\n" +
			"- NÃO comece toda mensagem com \"Olá\", \"Oi\", \"Tudo bem?\", \"Como posso ajudar?\". Continue a conversa naturalmente.\n" +
			"- Se o cliente faz uma pergunta direta (preço, prazo, sim/não), responda DIRETO sem preâmbulos.\n" +
			"- Quando você prometeu uma ação (agendar, enviar, criar) e o cliente CONFIRMOU, EXECUTE imediatamente — emita o marker [[action:...]] correspondente em vez de perguntar de novo.",
	}

	appendSection := func(title, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		sections = append(sections, title+"\n"+value)
	}

	if agent.AgentName != "" {
		sections = append(sections, fmt.Sprintf("IDENTIDADE PRINCIPAL\nVocê é %s.", strings.TrimSpace(agent.AgentName)))
	}
	appendSection("IDENTIDADE E POSICIONAMENTO", agent.Identity)
	appendSection("OBJETIVO", agent.Objective)
	appendSection("DIRETRIZES DE COMUNICAÇÃO", agent.CommunicationGuidelines)
	appendSection("INSTRUÇÕES DE ATENDIMENTO", agent.ServiceInstructions)
	appendSection("RESTRIÇÕES", agent.Restrictions)
	appendSection("BASE DE CONHECIMENTO", agent.KnowledgeBase)

	if faq := formatJSONBlock(agent.FAQ, "FAQ"); faq != "" {
		sections = append(sections, faq)
	}
	if variables := formatJSONBlock(agent.Variables, "VARIÁVEIS DISPONÍVEIS"); variables != "" {
		sections = append(sections, variables)
	}
	if voice := formatJSONBlock(agent.Voice, "VOZ CONFIGURADA"); voice != "" {
		sections = append(sections, voice)
	}
	if skills := formatJSONBlock(agent.Skills, "SKILLS E CAPACIDADES"); skills != "" {
		sections = append(sections, skills)
	}
	if apps := formatJSONBlock(agent.AppAccess, "APPS E ACESSOS DISPONÍVEIS"); apps != "" {
		sections = append(sections, apps)
	}

	if agent.RAGEnabled && len(assets) > 0 {
		knowledgeChunks := make([]string, 0, len(assets))
		for _, asset := range assets {
			text := strings.TrimSpace(asset.ExtractedText)
			if text == "" {
				continue
			}
			text = firstNRunes(text, 2400)
			knowledgeChunks = append(knowledgeChunks, fmt.Sprintf("[%s]\n%s", asset.FileName, text))
		}
		if len(knowledgeChunks) > 0 {
			sections = append(sections, "DOCUMENTOS DO AGENTE (RAG BASE)\n"+strings.Join(knowledgeChunks, "\n\n"))
		}
	}

	if strings.TrimSpace(agent.SystemPrompt) != "" {
		sections = append(sections, "PROMPT BASE ADICIONAL\n"+strings.TrimSpace(agent.SystemPrompt))
	}

	// ResponseLength — diretriz dura sobre o tamanho da resposta. Sem
	// isso o LLM tendia a ser excessivamente verboso (especialmente
	// modelos da família Claude/GPT-4) e o cliente percebia como
	// "robô explicando demais".
	if guide := responseLengthGuide(agent.ResponseLength); guide != "" {
		sections = append(sections, "TAMANHO E RITMO DAS RESPOSTAS\n"+guide)
	}

	// Última coisa no prompt: re-injeta o contrato de naturalidade da Uniq
	// pra sobrepor presets/instruções verbosas que o user pode ter colado
	// nos campos livres. LLMs costumam priorizar as últimas instruções —
	// usamos isso pra garantir que o tom humano prevaleça.
	sections = append(sections, uniqOutputContract)

	return strings.Join(sections, "\n\n")
}

// uniqBasePersona — bloco de abertura aplicado a TODO agente da plataforma.
// O objetivo é impor um padrão humano e curto antes mesmo da config do user
// entrar em cena. Sem isso, o agente herdava o tom corporativo default dos
// LLMs (parágrafos numerados, "gostaria de saber mais sobre…", reassurance
// de marketing) — exatamente o oposto do que "soa humano" no WhatsApp.
const uniqBasePersona = `Você é uma pessoa real atendendo no WhatsApp. NÃO é um bot, NÃO é um assistente virtual, NÃO é uma IA. É gente conversando com gente.

Como gente conversa no WhatsApp (siga SEMPRE):
- Mensagens CURTAS. 1 frase, no máximo 2. Se tiver mais coisa pra falar, mande em outra mensagem (use uma linha em branco entre elas — o sistema parte em balões separados).
- SEM listas numeradas, SEM bullets, SEM títulos em negrito, SEM tabelas, SEM markdown. Nunca.
- SEM frases de marketing tipo "isso garante que tudo funcione perfeitamente", "oferecemos uma solução personalizada", "atendemos suas necessidades". Soa robô.
- SEM perguntas-rodapé corporativas tipo "Gostaria de saber mais?", "Posso te ajudar com mais alguma coisa?", "Tem mais alguma dúvida?". Se for fazer pergunta, faz uma pergunta REAL e específica do que você quer saber pra avançar.
- SEM começar com tranquilizadores ("Não se preocupe", "Você não precisa se preocupar", "Fique tranquilo"). Vai direto.
- Use linguagem coloquial: "to", "tá", "pra", "né", "bora", "vou", "deixa eu ver". Contrações são bem-vindas.
- Pontuação leve. Pode usar ponto final ou nenhum. Reticência só quando faz sentido na fala. Exclamação com parcimônia — 1 por mensagem no MÁXIMO.
- Emoji raro e propositado. Só quando um humano colocaria ali.
- Quando não souber, fala que não sabe. "Deixa eu checar isso pra você" é melhor que inventar.`

func responseLengthGuide(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "concise":
		return "MÁXIMO 1 frase curta por balão (≤ 15 palavras). Se precisar dizer 2 coisas, mande 2 mensagens — separe com linha em branco. Nada de listas, nada de fechamento ('quer saber mais?')."
	case "detailed":
		return "Pode elaborar, mas EM BALÕES CURTOS. Cada balão = 1-2 frases. Para detalhar, mande vários balões curtos (separados por linha em branco), nunca um parágrafão. Máx 3 balões seguidos antes de devolver a vez pro cliente."
	case "balanced", "":
		return "1-2 frases por balão. Se a resposta tem 2 ideias, manda 2 balões (separa com linha em branco). NUNCA mais de 2 balões na mesma vez. Nada de bullets, nada de numeração, nada de pergunta-rodapé corporativa."
	}
	return ""
}

// uniqOutputContract — re-asserção final do contrato de naturalidade.
// Vai como ÚLTIMA seção do system prompt pra ganhar peso de recência no LLM
// e sobrepor qualquer instrução verbosa que tenha entrado via knowledge_base
// ou prompts colados pelo user. Lista padrões PROIBIDOS observados em chats
// reais que entregam "isso é bot".
const uniqOutputContract = `CONTRATO FINAL DE FORMATO (sobrepõe qualquer outra instrução acima):

PROIBIDO em CADA resposta:
- Parágrafos longos ou múltiplos parágrafos no mesmo balão. Quebre em mensagens.
- Listas numeradas (1. 2. 3.) ou bullets (- *). Fale como se estivesse digitando no celular.
- Markdown (**negrito**, _itálico_, # títulos, > citações).
- Frases-clichê: "Você não precisa se preocupar", "Oferecemos uma solução", "Implementação personalizada", "De acordo com suas necessidades", "Isso garante", "Atendimento humanizado", "Estamos à disposição".
- Pergunta-rodapé genérica: "Gostaria de saber mais?", "Posso ajudar em mais alguma coisa?", "Quer que eu te explique melhor?". Se for perguntar, pergunte algo ESPECÍFICO que faça a conversa avançar.
- Repetir o nome do produto/empresa em toda mensagem.
- Confirmações vazias ("Entendido!", "Perfeito!", "Ótimo!") sozinhas — emende com o próximo passo.

PADRÃO de resposta:
- 1 ideia por balão. 1-2 frases por balão. No máximo 2 balões seguidos antes de devolver a fala pro cliente.
- Para mandar 2 balões, separe com UMA linha em branco. Ex:
    "vou checar isso pra você

    me passa só o seu CEP enquanto isso?"
- Pergunta natural > pergunta corporativa. "qual o tamanho da sua loja hoje?" > "Gostaria de compartilhar mais detalhes sobre seu negócio?"

Se você se vir escrevendo "Isso inclui...", "A implementação...", "Isso garante..." — PARE. Reescreva como mensagem de WhatsApp.`

func formatJSONBlock(raw string, title string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" || raw == "{}" || raw == "null" {
		return ""
	}
	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return title + "\n" + raw
	}
	b, err := json.MarshalIndent(parsed, "", "  ")
	if err != nil {
		return title + "\n" + raw
	}
	return title + "\n" + string(b)
}

func logContent(raw string) string {
	var s string
	if err := json.Unmarshal([]byte(raw), &s); err == nil {
		return s
	}
	return raw
}

// botFooterRe — pergunta-rodapé corporativa que vira "tell" de bot.
// Roda no FINAL de balão (separado por dupla newline). Cada caso vem
// do que observamos chats reais dispararem repetidamente, indicando
// "bot": rodapés genéricos, propostas vagas de checar com terceiros,
// "se precisar de mais detalhes…", etc. Quando alguma dessas frases
// vier no fim de um balão, ela é descartada antes do envio.
var botFooterRe = regexp.MustCompile(`(?im)^\s*(` +
	`gostaria de saber mais.*\??|` +
	`posso (te )?ajudar (com|em) (mais|outra).*\??|` +
	`tem (mais )?alguma (outra )?d[uú]vida.*\??|` +
	`fico (à|a) disposi[cç][ãa]o.*[.!?]?|` +
	`estou (à|a) disposi[cç][ãa]o.*[.!?]?|` +
	`qualquer d[uú]vida.*[.!?]?|` +
	`(se|caso) (voc[eê] )?precisar de (mais )?(detalhes|informa[cç][õo]es?).*[.!?]?|` +
	`(se|caso) (voc[eê] )?(quiser|precisar).*posso (checar|consultar|verificar).*com (a |o )?(equipe|time|suporte).*[.!?]?|` +
	`(posso|vou) (checar|consultar|verificar).*com (a |o )?(equipe|time|suporte).*[.!?]?|` +
	`estamos (aqui|prontos) (pra|para) (te )?ajudar.*[.!?]?|` +
	`estou (aqui|pronto) (pra|para) (te )?ajudar.*[.!?]?|` +
	`conte comigo.*[.!?]?` +
	`)\s*$`)

// listMarkerRe — bullets e numeração no início de linha. Se o LLM
// insistiu em formatar uma lista, removemos os marcadores e deixamos
// as frases — vira texto corrido (ou múltiplos balões via newline).
var listMarkerRe = regexp.MustCompile(`(?m)^\s*(?:[-*•]\s+|\d+[.)]\s+)`)

// markdownEmphasisRe — **negrito**, __sublinhado__, _itálico_. WhatsApp
// usa * e _ próprios mas o LLM colando ** vira poluição visual.
var markdownEmphasisRe = regexp.MustCompile(`(\*\*|__)(.+?)(\*\*|__)`)

// dedupAgainstPrevious — recebe a nova resposta + a última do agente
// e tira sentenças do novo reply que sejam basicamente idênticas a
// alguma sentença do reply anterior. "Basicamente idênticas" =
// lowercase, sem pontuação, sem espaços extras. Cobre o caso clássico
// do LLM fechar com "Se precisar de mais detalhes, posso checar com
// a equipe." em DOIS turnos seguidos.
//
// Se restar reply vazia, devolve string vazia — o caller decide
// (loga como failed). Se restar algo, devolve sem as repetidas.
func dedupAgainstPrevious(reply, previous string) string {
	prevNorm := make(map[string]bool)
	for _, s := range splitSentences(previous) {
		key := normalizeForDedup(s)
		if len(key) >= 12 { // ignora "ok", "sim" etc.
			prevNorm[key] = true
		}
	}
	if len(prevNorm) == 0 {
		return reply
	}
	bubbles := strings.Split(reply, "\n\n")
	out := bubbles[:0]
	for _, bubble := range bubbles {
		kept := make([]string, 0)
		for _, sent := range splitSentences(bubble) {
			if prevNorm[normalizeForDedup(sent)] {
				continue
			}
			kept = append(kept, sent)
		}
		joined := strings.TrimSpace(strings.Join(kept, " "))
		if joined != "" {
			out = append(out, joined)
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n\n"))
}

// splitSentences — quebra texto em sentenças básicas. Não vale a pena
// trazer biblioteca de NLP pra isso; um split por terminação simples
// resolve 95% dos casos do agente.
func splitSentences(text string) []string {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	out := make([]string, 0, 4)
	var b strings.Builder
	for _, r := range text {
		b.WriteRune(r)
		if r == '.' || r == '!' || r == '?' || r == '\n' {
			s := strings.TrimSpace(b.String())
			if s != "" {
				out = append(out, s)
			}
			b.Reset()
		}
	}
	rest := strings.TrimSpace(b.String())
	if rest != "" {
		out = append(out, rest)
	}
	return out
}

// normalizeForDedup — chave de comparação. Lowercase, sem pontuação,
// sem espaços duplicados.
func normalizeForDedup(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevSpace = false
		case r >= 192 && r <= 255: // latin-1 acentuado
			b.WriteRune(r)
			prevSpace = false
		case r == ' ' || r == '\t' || r == '\n':
			if !prevSpace && b.Len() > 0 {
				b.WriteByte(' ')
				prevSpace = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

func sanitizeAssistantReply(reply string) string {
	reply = strings.TrimSpace(reply)
	reply = strings.TrimPrefix(reply, "\"")
	reply = strings.TrimSuffix(reply, "\"")
	reply = strings.TrimSpace(reply)
	if strings.EqualFold(reply, "null") {
		return ""
	}

	// Remove markdown emphasis (mantém o conteúdo, tira os asteriscos
	// duplos / underscores duplos que LLMs adoram colocar).
	reply = markdownEmphasisRe.ReplaceAllString(reply, "$2")
	// Remove títulos markdown (# Título → Título).
	reply = regexp.MustCompile(`(?m)^\s*#{1,6}\s+`).ReplaceAllString(reply, "")
	// Remove marcadores de lista (-, *, •, 1., 2)) no início de linha.
	reply = listMarkerRe.ReplaceAllString(reply, "")

	// Quebra em balões (linha em branco) e remove rodapés corporativos
	// de cada um. Se um balão fica vazio depois disso, descarta.
	parts := strings.Split(reply, "\n\n")
	kept := parts[:0]
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		p = botFooterRe.ReplaceAllString(p, "")
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		kept = append(kept, p)
	}
	reply = strings.Join(kept, "\n\n")

	return strings.TrimSpace(reply)
}

func extractPhoneFromJIDLocal(jid string) string {
	if jid == "" {
		return ""
	}
	if idx := strings.Index(jid, "@"); idx >= 0 {
		return jid[:idx]
	}
	return jid
}

func firstNRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// ─── Multi-agente: handoff entre agentes da mesma instância ─────────────

// handoffMarkerRe captura tokens [[handoff:<role>]] na resposta do LLM.
// Convenção curta e fácil pro modelo emitir; permite letras, números,
// hífen e underscore no role.
var handoffMarkerRe = regexp.MustCompile(`(?i)\[\[handoff:([a-z0-9_\-]+)\]\]`)

// detectAndApplyHandoff procura marcador [[handoff:role]] na reply do LLM.
// Se achou e existe outro agente nesta instância com `role` ou skill
// equivalente em handoff_skills, pina ele em ConversationAgentState pra
// que a próxima mensagem inbound caia direto nele. Retorna a reply com o
// marcador removido (sempre — o cliente nunca deve ver o token cru).
func (r *AgentRuntime) detectAndApplyHandoff(currentAgent *models.InstanceAgent, conv *models.Conversation, reply string) string {
	matches := handoffMarkerRe.FindStringSubmatch(reply)
	stripped := handoffMarkerRe.ReplaceAllString(reply, "")
	stripped = strings.TrimSpace(stripped)
	if len(matches) < 2 || conv == nil || currentAgent == nil {
		return stripped
	}
	target := strings.ToLower(strings.TrimSpace(matches[1]))
	if target == "" || target == strings.ToLower(currentAgent.Role) {
		return stripped // já é esse agente, nada a fazer
	}

	// Procura sibling: mesmo instance_id, ativo, role bate OU handoff_skills
	// contém o target. JSON contains via LIKE pra evitar dependência de
	// extensão jsonb_array_elements (compat com SQLite em dev).
	var sibling models.InstanceAgent
	q := r.db.Where("instance_id = ? AND id <> ? AND is_active = ?",
		currentAgent.InstanceID, currentAgent.ID, true).
		Where("LOWER(role) = ? OR LOWER(handoff_skills) LIKE ?",
			target, "%\""+target+"\"%").
		Order("priority ASC, created_at ASC")
	if err := q.First(&sibling).Error; err != nil {
		log.Debug().Str("target", target).Str("conv", conv.ID.String()).
			Msg("agent-runtime: handoff requisitado mas nenhum sibling bate")
		return stripped
	}

	// Upsert ConversationAgentState com o novo agente. Mode active.
	state := models.ConversationAgentState{
		ConversationID: conv.ID,
		AgentID:        &sibling.ID,
		Mode:           models.AgentModeActive,
	}
	r.db.Where("conversation_id = ?", conv.ID).
		Assign(map[string]any{"agent_id": sibling.ID, "mode": models.AgentModeActive}).
		FirstOrCreate(&state)

	log.Info().
		Str("from_agent", currentAgent.AgentName).
		Str("to_agent", sibling.AgentName).
		Str("conv", conv.ID.String()).
		Str("target_role", target).
		Msg("agent-runtime: handoff aplicado")

	return stripped
}

// loadSiblingsForPrompt — devolve [{role, name, skills}] dos outros agentes
// da mesma instância pra incluir no system prompt e instruir o modelo a
// emitir [[handoff:role]] quando apropriado.
func (r *AgentRuntime) loadSiblingsForPrompt(agent *models.InstanceAgent) string {
	if agent == nil {
		return ""
	}
	var siblings []models.InstanceAgent
	r.db.Select("id, agent_name, role, handoff_skills").
		Where("instance_id = ? AND id <> ? AND is_active = ?", agent.InstanceID, agent.ID, true).
		Order("priority ASC").
		Find(&siblings)
	if len(siblings) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("AGENTES PARCEIROS DESTA INSTÂNCIA\n")
	b.WriteString("Você pode transferir a conversa pra um deles emitindo a tag literal [[handoff:ROLE]] no final da sua resposta. ")
	b.WriteString("Use SOMENTE quando a demanda do cliente for claramente fora do seu escopo.\n")
	for _, s := range siblings {
		var skills []string
		_ = json.Unmarshal([]byte(s.HandoffSkills), &skills)
		line := fmt.Sprintf("- role=%s nome=%s", s.Role, s.AgentName)
		if len(skills) > 0 {
			line += " skills=" + strings.Join(skills, ",")
		}
		b.WriteString(line + "\n")
	}
	return b.String()
}

// ─── Janelas de ativação ─────────────────────────────────────────────────

// agentScheduleDay representa um intervalo HH:MM dentro de um dia.
type agentScheduleRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type agentSchedule struct {
	Timezone string                          `json:"timezone"`
	Days     map[string][]agentScheduleRange `json:"days"`
}

var weekdayKey = map[time.Weekday]string{
	time.Sunday: "sun", time.Monday: "mon", time.Tuesday: "tue",
	time.Wednesday: "wed", time.Thursday: "thu", time.Friday: "fri", time.Saturday: "sat",
}

// isAgentActiveNow decide se o agente DEVE responder neste momento.
// Returns true quando:
//   - ActivationMode vazio ou "always" (sempre responde se IsActive=true).
//   - "business_hours" e o now (no TZ do schedule) cai DENTRO de algum range.
//   - "off_hours" e o now cai FORA de TODOS os ranges (cobre noite/fim de
//     semana — quando deveria ser handoff humano).
//   - "new_contact_only" — caller passa contactMessageCount; true se ≤1.
//   - "custom" — usa schedule + tolerância simples; expansões futuras vão
//     em ContextRules.
//
// Pra qualquer JSON inválido cai pra "always" — falha aberta é melhor que
// trancar todo o atendimento por typo no schedule.
func isAgentActiveNow(agent *models.InstanceAgent, now time.Time, contactMessageCount int) bool {
	if agent == nil {
		return false
	}
	mode := strings.ToLower(strings.TrimSpace(agent.ActivationMode))
	if mode == "" || mode == "always" {
		return true
	}
	if mode == "new_contact_only" {
		return contactMessageCount <= 1
	}

	var sched agentSchedule
	if strings.TrimSpace(agent.Schedule) != "" {
		_ = json.Unmarshal([]byte(agent.Schedule), &sched)
	}

	loc, err := time.LoadLocation(strings.TrimSpace(sched.Timezone))
	if err != nil || loc == nil {
		loc = time.Local
	}
	local := now.In(loc)
	dayKey := weekdayKey[local.Weekday()]
	ranges := sched.Days[dayKey]

	insideAnyRange := false
	for _, r := range ranges {
		if rangeContains(r, local) {
			insideAnyRange = true
			break
		}
	}

	switch mode {
	case "business_hours":
		return insideAnyRange
	case "off_hours":
		return !insideAnyRange
	case "custom":
		// Sem schedule definido → trata como "always" pra evitar trancar.
		if len(ranges) == 0 && len(sched.Days) == 0 {
			return true
		}
		return insideAnyRange
	}
	return true
}

// rangeContains — checa se HH:MM (local) está dentro de [from, to). Suporta
// ranges que cruzam meia-noite (ex: from=22:00 to=06:00) interpretando
// como "do início até 23:59 OU 00:00 até fim".
func rangeContains(r agentScheduleRange, local time.Time) bool {
	from, ok1 := parseHHMM(r.From)
	to, ok2 := parseHHMM(r.To)
	if !ok1 || !ok2 {
		return false
	}
	cur := local.Hour()*60 + local.Minute()
	if from <= to {
		return cur >= from && cur < to
	}
	// Cruza meia-noite
	return cur >= from || cur < to
}

func parseHHMM(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if len(s) < 4 || !strings.Contains(s, ":") {
		return 0, false
	}
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := atoiSafe(parts[0])
	m, err2 := atoiSafe(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

func atoiSafe(s string) (int, error) {
	n := 0
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid digit")
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

// derefUUID — devolve uuid.Nil quando ptr é nil. Usado pra evitar panic
// em conversation.WorkspaceID e similares.
func derefUUID(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}

// shouldTriggerAgent — gate de TriggerMode. Decide se o agente deve
// processar este inbound. Webhook-mode NÃO responde mensagens normais
// (só via endpoint dedicado).
func shouldTriggerAgent(agent *models.InstanceAgent, inboundText string) bool {
	if agent == nil {
		return false
	}
	mode := strings.ToLower(strings.TrimSpace(agent.TriggerMode))
	switch mode {
	case "", "any":
		return true
	case "webhook":
		// Inbound não dispara webhook-only; só /v1/webhooks/agent-trigger.
		return false
	case "keyword":
		var kws []string
		_ = json.Unmarshal([]byte(agent.TriggerKeywords), &kws)
		if len(kws) == 0 {
			return false // sem keywords cadastradas → não responde nada
		}
		lower := strings.ToLower(inboundText)
		for _, kw := range kws {
			kw = strings.ToLower(strings.TrimSpace(kw))
			if kw != "" && strings.Contains(lower, kw) {
				return true
			}
		}
		return false
	}
	return true // modos desconhecidos → fail-open pra não trancar atendimento
}

// ─── Webhook trigger ──────────────────────────────────────────────────────

// AgentWebhookPayload — corpo aceito pelo webhook de trigger do agente.
// O contexto mínimo é só "to" (JID/phone do destinatário) + "message"
// (texto que vira input do LLM). Variables é livre — o agente pode
// referenciar via {{variables.X}} no system prompt se quiser.
type AgentWebhookPayload struct {
	To        string         `json:"to"`        // JID, e.164, ou phone bruto
	Message   string         `json:"message"`   // texto do "evento" pra alimentar o LLM
	FromName  string         `json:"from_name"` // opcional — nome do contato pra contexto
	Variables map[string]any `json:"variables"` // opcional — ficam disponíveis pro prompt
	Metadata  map[string]any `json:"metadata"`  // opcional — só pra log/audit
}

// TriggerByWebhook — dispara o agente fora do fluxo inbound regular.
// Usado pelo endpoint /v1/webhooks/agent-trigger/:slug. Carrega o agente,
// roda o LLM e envia a resposta via WhatsApp pra `payload.To`.
//
// Retorna a reply enviada (sanitizada, sem markers) ou erro descritivo.
func (r *AgentRuntime) TriggerByWebhook(agent *models.InstanceAgent, payload AgentWebhookPayload) (string, error) {
	if r == nil || agent == nil {
		return "", fmt.Errorf("runtime ou agente inválido")
	}
	if !agent.IsActive {
		return "", fmt.Errorf("agente inativo")
	}
	to := strings.TrimSpace(payload.To)
	msg := strings.TrimSpace(payload.Message)
	if to == "" {
		return "", fmt.Errorf("campo 'to' obrigatório")
	}
	if msg == "" {
		return "", fmt.Errorf("campo 'message' obrigatório")
	}

	// Normaliza JID — aceita "5511...", "+55 11 ...", "5511...@s.whatsapp.net".
	jid := to
	if !strings.Contains(jid, "@") {
		// Tira tudo que não é dígito
		var b strings.Builder
		for _, c := range jid {
			if c >= '0' && c <= '9' {
				b.WriteRune(c)
			}
		}
		jid = b.String() + "@s.whatsapp.net"
	}

	// Resolve LLM (mesma cascata do inbound regular):
	//   custom Integration > PlatformAI default (Uniq AI) > erro.
	var integration *models.UserIntegration
	if agent.IntegrationID != nil {
		if agent.Integration != nil {
			integration = agent.Integration
		} else {
			var integ models.UserIntegration
			if err := r.db.First(&integ, "id = ?", *agent.IntegrationID).Error; err == nil {
				integration = &integ
			}
		}
	}
	if integration == nil {
		var pai models.PlatformAI
		if err := r.db.Where("is_active = true AND api_key <> ''").
			Order("created_at ASC").First(&pai).Error; err == nil {
			integration = PlatformAIToIntegration(&pai)
		}
	}
	if integration == nil {
		return "", fmt.Errorf("nenhuma LLM disponível (sem integration_id e sem PlatformAI ativa)")
	}
	if model := strings.TrimSpace(agent.Model); model != "" {
		if b, err := json.Marshal([]string{model}); err == nil {
			copy := *integration
			copy.Models = string(b)
			integration = &copy
		}
	}

	// Cliente WhatsApp da instância do agente.
	client := r.manager.GetInstance(agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return "", fmt.Errorf("instância do agente desconectada")
	}

	// System prompt + ferramentas + handoff (mesmo que inbound regular).
	systemPrompt := BuildAgentSystemPrompt(agent, agent.Assets)
	if siblings := r.loadSiblingsForPrompt(agent); siblings != "" {
		systemPrompt += "\n\n" + siblings
	}
	if tools := BuildToolsPromptSection(agent); tools != "" {
		systemPrompt += "\n\n" + tools
	}
	if strings.TrimSpace(systemPrompt) == "" {
		systemPrompt = "Você é um assistente de atendimento útil, profissional e objetivo."
	}

	// User prompt: contexto do evento + variáveis.
	var userPrompt strings.Builder
	userPrompt.WriteString("Você foi disparado por um webhook externo. Use o evento abaixo como gancho pra iniciar/continuar a conversa de forma natural com o cliente.\n\n")
	if payload.FromName != "" {
		userPrompt.WriteString(fmt.Sprintf("Cliente: %s\n", payload.FromName))
	}
	userPrompt.WriteString("Canal: WhatsApp\n\nEvento recebido:\n")
	userPrompt.WriteString(msg)
	if len(payload.Variables) > 0 {
		if vb, err := json.MarshalIndent(payload.Variables, "", "  "); err == nil {
			userPrompt.WriteString("\n\nDados adicionais:\n")
			userPrompt.Write(vb)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	llmResult, err := r.llm.CallChatWithSystemResult(ctx, integration, systemPrompt, userPrompt.String(), false)
	reply := llmResult.Content
	if reply != "" {
		recordLLMUsage(ctx, r.db, agent.InstanceID, integration, llmResult, userPrompt.String()+systemPrompt, reply)
	}
	if err != nil {
		return "", fmt.Errorf("LLM falhou: %w", err)
	}
	reply = sanitizeAssistantReply(reply)
	reply = handoffMarkerRe.ReplaceAllString(reply, "")
	reply = actionMarkerRe.ReplaceAllString(reply, "")
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return "", fmt.Errorf("LLM retornou resposta vazia")
	}

	// Webhook trigger também passa pela fila — mesmo benefício anti-ban
	// (digitando + jitter + cooldown). Async: o caller recebe 200 enquanto
	// o envio acontece em background.
	r.replyQueue.Enqueue(AgentReplyJob{
		InstanceID: agent.InstanceID.String(),
		ToJID:      jid,
		Reply:      reply,
		AgentName:  agent.AgentName,
		Pace:       agent.ResponsePace,
	})
	log.Info().
		Str("agent", agent.AgentName).
		Str("to", jid).
		Msg("agent-runtime: trigger webhook executado")
	r.logExecution(models.AgentExecution{
		AgentID: agent.ID, InstanceID: agent.InstanceID,
		Trigger: "webhook", Status: "success",
		InputPreview: msg, ReplyPreview: reply,
	})
	return reply, nil
}

// ─── Logging de execução (aba Logs do agente) ─────────────────────────────

// logExecution persiste um AgentExecution. Async (goroutine) pra não
// adicionar latência no path de resposta. Erros do save só viram log
// debug — perder uma row de log nunca pode quebrar o atendimento.
func (r *AgentRuntime) logExecution(rec models.AgentExecution) {
	if r == nil || r.db == nil {
		return
	}
	go func() {
		// Trunca previews defensivamente (DB já tem varchar(500), mas
		// reduz risco de erro silencioso por overflow).
		rec.InputPreview = truncateRunes(rec.InputPreview, 480)
		rec.ReplyPreview = truncateRunes(rec.ReplyPreview, 480)
		if err := r.db.Create(&rec).Error; err != nil {
			log.Debug().Err(err).Msg("agent-runtime: falha ao persistir log de execução")
		}
	}()
}

func truncateRunes(s string, max int) string {
	rs := []rune(s)
	if len(rs) <= max {
		return s
	}
	return string(rs[:max]) + "…"
}

// logSkippedNoAgent — chamado quando resolveAgent retorna não-found.
// Tenta achar o primário da instância pra logar com contexto. Diagnóstico
// inclui razão provável (sem agente, agente inativo, conv com bot
// desligado, fora da janela).
func (r *AgentRuntime) logSkippedNoAgent(instanceID uuid.UUID, text string, started time.Time, fromJID string) {
	var primary models.InstanceAgent
	err := r.db.Where("instance_id = ?", instanceID).
		Order("is_primary DESC, created_at ASC").First(&primary).Error
	if err != nil {
		log.Warn().
			Str("instance", instanceID.String()).
			Str("from", fromJID).
			Msg("agent-runtime: inbound chegou mas instância não tem agente cadastrado")
		return
	}

	reason := "no_active_agent"
	if !primary.IsActive {
		reason = "agent_inactive"
	} else {
		var conv models.Conversation
		if err := r.db.Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
			Where("status IN ?", []models.ConversationStatus{
				models.ConversationStatusOpen,
				models.ConversationStatusPending,
				models.ConversationStatusSnoozed,
			}).Order("updated_at DESC").First(&conv).Error; err == nil {
			var state models.ConversationAgentState
			if r.db.Where("conversation_id = ?", conv.ID).First(&state).Error == nil {
				if state.Mode == models.AgentModeDisabled {
					reason = "human_took_over"
				}
			}
			if !conv.IsBotActive {
				reason = "bot_disabled_in_conversation"
			}
		}
		if !isAgentActiveNow(&primary, time.Now(), 0) {
			reason = "outside_activation_window"
		}
	}

	r.logExecution(models.AgentExecution{
		AgentID: primary.ID, InstanceID: instanceID,
		Trigger: "inbound", Status: "skipped", SkipReason: reason,
		InputPreview: text, DurationMs: int(time.Since(started).Milliseconds()),
	})
}

// resolveContactID — quick lookup do contact_id pra uma instance+jid.
// Retorna uuid.Nil quando não existe (contato ainda não foi criado pelo
// inbound_pipeline). Usado pra carregar ContactMemory no system prompt.
func (r *AgentRuntime) resolveContactID(instanceID uuid.UUID, fromJID string) uuid.UUID {
	var conv models.Conversation
	if err := r.db.
		Select("contact_id").
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
			models.ConversationStatusResolved,
		}).
		Order("updated_at DESC").
		First(&conv).Error; err == nil && conv.ContactID != nil {
		return *conv.ContactID
	}
	return uuid.Nil
}

// resolveConversation — lookup da conversation ativa pra uma instance+jid.
func (r *AgentRuntime) resolveConversation(instanceID uuid.UUID, fromJID string) models.Conversation {
	var conv models.Conversation
	r.db.
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).
		Order("updated_at DESC").
		First(&conv)
	return conv
}

// recentInstanceOutboundTexts — devolve até `limit` textos enviados
// pelo AGENTE (direction=out, type=text) nesta instância nas últimas
// 12h, EXCLUINDO a conversa atual (essa é tratada por lastAgentReply).
// Deduplicado por content normalizado pra ranking mais limpo.
//
// Usado pra alimentar o bloco "VARIE A LINGUAGEM ENTRE CLIENTES" do
// system prompt, prevenindo o agente de responder literalmente igual
// pra perguntas idênticas vindas de pessoas diferentes — o que dispara
// o circuit breaker antiban (recipient_burst).
func (r *AgentRuntime) recentInstanceOutboundTexts(instanceID uuid.UUID, currentFromJID string, limit int) []string {
	if r == nil || r.db == nil || limit <= 0 {
		return nil
	}
	since := time.Now().Add(-12 * time.Hour)
	rows := []struct {
		Content    string
		ChannelKey string
	}{}
	q := r.db.Table("message_logs").
		Select("content, channel_key").
		Where("instance_id = ? AND direction = ? AND type = ? AND content <> ''",
			instanceID, models.DirectionOut, "text").
		Where("created_at >= ?", since).
		Order("created_at DESC").
		Limit(limit * 4) // sobre-amostra pra deduplicar abaixo
	if currentFromJID != "" {
		q = q.Where("channel_key <> ?", currentFromJID)
	}
	_ = q.Scan(&rows).Error

	seen := map[string]bool{}
	out := make([]string, 0, limit)
	for _, row := range rows {
		txt := strings.TrimSpace(row.Content)
		if txt == "" {
			continue
		}
		key := normalizeForDedup(txt)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, txt)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// buildAntiRepetitionSection — bloco que vai no fim do system prompt.
// Lista as respostas recentes pra OUTROS clientes e instrui o LLM a
// variar palavras/ordem/emoji. O texto é cortado em 200 runes por
// linha pra economizar tokens.
func buildAntiRepetitionSection(recent []string) string {
	var sb strings.Builder
	sb.WriteString("VARIE A LINGUAGEM ENTRE CLIENTES — anti-repetição\n\n")
	sb.WriteString("Estas são as últimas respostas que VOCÊ enviou pra OUTROS clientes nesta instância:\n")
	for i, t := range recent {
		sb.WriteString(fmt.Sprintf("%d. \"%s\"\n", i+1, firstNRunes(t, 200)))
	}
	sb.WriteString("\nRegra crítica: NUNCA repita literalmente nenhuma frase acima ao responder o cliente atual, ")
	sb.WriteString("mesmo que a pergunta seja idêntica. Varie palavras (use sinônimos), reordene as frases, ")
	sb.WriteString("alterne uso e posição de emoji, varie pontuação e energia. ")
	sb.WriteString("Mensagens iguais em pessoas diferentes são tratadas como SPAM pelo WhatsApp e podem banir a conta.")
	return sb.String()
}

// replyTooSimilar — Jaccard de tokens normalizados entre o reply
// recém-gerado e cada uma das respostas recentes. Devolve true quando
// algum par bate o limiar; nesse caso o caller pode regenerar.
func replyTooSimilar(reply string, recent []string, threshold float64) bool {
	a := tokenSetForSim(reply)
	if len(a) == 0 {
		return false
	}
	for _, prev := range recent {
		b := tokenSetForSim(prev)
		if len(b) == 0 {
			continue
		}
		inter := 0
		for tok := range a {
			if b[tok] {
				inter++
			}
		}
		union := len(a) + len(b) - inter
		if union == 0 {
			continue
		}
		jaccard := float64(inter) / float64(union)
		if jaccard >= threshold {
			return true
		}
	}
	return false
}

// tokenSetForSim — set de palavras lowercased, sem pontuação. Tokens
// curtos (≤ 2 chars) são descartados — preposições/artigos não devem
// pesar no julgamento de similaridade.
func tokenSetForSim(s string) map[string]bool {
	out := map[string]bool{}
	var b strings.Builder
	flush := func() {
		w := b.String()
		if len(w) > 2 {
			out[w] = true
		}
		b.Reset()
	}
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9',
			r >= 192 && r <= 255:
			b.WriteRune(r)
		default:
			flush()
		}
	}
	flush()
	return out
}
