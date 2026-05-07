package services

import (
	"context"
	"encoding/json"
	"fmt"
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
	db      *gorm.DB
	manager *whatsapp.Manager
	llm     *LLMService
	tts     *TTSService

	seenMu   sync.Mutex
	seenMsgs map[string]time.Time
}

func NewAgentRuntime(db *gorm.DB, manager *whatsapp.Manager, llm *LLMService, tts *TTSService) *AgentRuntime {
	return &AgentRuntime{
		db:       db,
		manager:  manager,
		llm:      llm,
		tts:      tts,
		seenMsgs: make(map[string]time.Time),
	}
}

// HandleIncoming replies with the configured instance agent when no journey consumed the message.
func (r *AgentRuntime) HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) bool {
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
	if strings.HasPrefix(text, "/") {
		return false
	}
	if r.seenRecently(instanceID, messageID) {
		log.Debug().Str("instance", instanceID).Str("msg", messageID).Msg("agent-runtime: dedup — mensagem já processada")
		return false
	}

	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return false
	}

	agent, agentMode, found := r.resolveAgent(instUUID, fromJID)
	if !found {
		return false
	}
	if agent.Integration == nil || agent.IntegrationID == nil {
		log.Debug().Str("instance", instanceID).Msg("agent-runtime: agente ativo sem integração vinculada")
		return false
	}

	integration := agent.Integration
	if model := strings.TrimSpace(agent.Model); model != "" {
		if b, err := json.Marshal([]string{model}); err == nil {
			copy := *integration
			copy.Models = string(b)
			integration = &copy
		}
	}

	client := r.manager.GetInstance(instanceID)
	if client == nil || !client.IsConnected() {
		return false
	}

	systemPrompt := BuildAgentSystemPrompt(agent, agent.Assets)
	userPrompt := r.buildUserPrompt(instUUID, fromJID, fromName, text, messageType)
	if strings.TrimSpace(systemPrompt) == "" {
		systemPrompt = "Você é um assistente de atendimento útil, profissional e objetivo."
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	reply, err := r.llm.CallChatWithSystem(ctx, integration, systemPrompt, userPrompt, false)
	if err != nil {
		log.Error().Err(err).Str("instance", instanceID).Str("chat", fromJID).Msg("agent-runtime: falha ao gerar resposta")
		return false
	}

	reply = sanitizeAssistantReply(reply)
	if reply == "" {
		return false
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

	_ = client.SendTyping(fromJID, true)
	time.Sleep(900 * time.Millisecond)

	// Tentar responder em áudio se voz estiver configurada
	if r.tts != nil && r.trySendAudio(ctx, client, agent, fromJID, reply) {
		_ = client.SendTyping(fromJID, false)
		log.Info().
			Str("instance", instanceID).
			Str("chat", fromJID).
			Str("agent", agent.AgentName).
			Msg("agent-runtime: resposta enviada em áudio")
		return true
	}

	_, sendErr := client.SendTextMessage(fromJID, reply)
	_ = client.SendTyping(fromJID, false)
	if sendErr != nil {
		log.Error().Err(sendErr).Str("instance", instanceID).Str("chat", fromJID).Msg("agent-runtime: falha ao enviar resposta")
		return false
	}

	log.Info().
		Str("instance", instanceID).
		Str("chat", fromJID).
		Str("agent", agent.AgentName).
		Msg("agent-runtime: resposta enviada")

	return true
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
		err := db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
			return tx.Where("is_active = ?", true).Order("created_at DESC")
		}).Where(cond, args...).First(&a).Error
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
					return a, mode, true
				}
			}
			// No agent override but mode is set — fall through to queue/instance resolution
			// but preserve the mode.
			if a, ok := r.resolveQueueOrInstance(conv, instanceID, preloadAgent); ok {
				return a, mode, true
			}
			return nil, models.AgentModeDisabled, false
		}
	}

	// Legacy: check is_bot_active
	if convErr == nil && !conv.IsBotActive {
		return nil, models.AgentModeDisabled, false
	}

	if a, ok := r.resolveQueueOrInstance(conv, instanceID, preloadAgent); ok {
		return a, models.AgentModeActive, true
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
	history := r.recentHistory(instanceID, fromJID, 10)
	if fromName == "" {
		fromName = extractPhoneFromJIDLocal(fromJID)
	}

	var b strings.Builder
	b.WriteString("Contexto da conversa em tempo real.\n")
	b.WriteString(fmt.Sprintf("Contato: %s\n", strings.TrimSpace(fromName)))
	b.WriteString(fmt.Sprintf("Canal: WhatsApp\nTipo da mensagem: %s\n", messageType))
	if history != "" {
		b.WriteString("\nHistórico recente:\n")
		b.WriteString(history)
		b.WriteString("\n")
	}
	b.WriteString("\nÚltima mensagem do usuário:\n")
	b.WriteString(latestMessage)
	b.WriteString("\n\nResponda como o agente configurado, sem mencionar prompts, JSON ou estrutura interna.")
	return b.String()
}

func (r *AgentRuntime) recentHistory(instanceID uuid.UUID, fromJID string, limit int) string {
	phone := extractPhoneFromJIDLocal(fromJID)
	var logs []models.MessageLog
	q := r.db.Where("instance_id = ? AND (to_jid = ? OR to_jid LIKE ? OR sender_jid = ?)", instanceID, fromJID, phone+"%@", fromJID).
		Order("created_at DESC").
		Limit(limit)
	if err := q.Find(&logs).Error; err != nil || len(logs) == 0 {
		return ""
	}

	lines := make([]string, 0, len(logs))
	for i := len(logs) - 1; i >= 0; i-- {
		content := strings.TrimSpace(logContent(logs[i].Content))
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

// trySendAudio converts reply text to audio via TTS and sends it as a PTT message.
// Returns true if audio was sent successfully.
func (r *AgentRuntime) trySendAudio(ctx context.Context, client interface {
	SendAudioMessage(string, []byte, string, bool, uint32) (string, error)
}, agent *models.InstanceAgent, toJID, text string) bool {
	cfg, ok := parseAgentVoiceConfig(agent.Voice)
	if !ok {
		return false
	}

	// Resolve the WorkspaceVoice to get provider credentials
	var voice models.WorkspaceVoice
	if cfg.WorkspaceVoiceID != "" {
		voiceID, err := uuid.Parse(cfg.WorkspaceVoiceID)
		if err != nil {
			return false
		}
		if r.db.Preload("Provider").First(&voice, "id = ?", voiceID).Error != nil {
			return false
		}
	} else {
		return false
	}

	if voice.Provider == nil || !voice.Provider.IsActive {
		return false
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

	audioData, mime, err := r.tts.Synthesize(ctx, voice.Provider, TTSRequest{
		Text:       text,
		VoiceID:    voice.ExternalID,
		Stability:  stability,
		Similarity: similarity,
		Style:      style,
		Speed:      speed,
	})
	if err != nil {
		log.Warn().Err(err).Str("voice", voice.ExternalID).Msg("agent-runtime: TTS falhou, usando texto")
		return false
	}

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
	return &cfg, cfg.AudioEnabled && cfg.WorkspaceVoiceID != ""
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
		"Você é um agente operacional de atendimento dentro da plataforma Uniq.chat.",
		"Responda sempre no idioma do usuário, de forma natural, curta e útil.",
		"Se a base não trouxer informação suficiente, diga isso com transparência e proponha encaminhamento humano em vez de inventar detalhes.",
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

	return strings.Join(sections, "\n\n")
}

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

func sanitizeAssistantReply(reply string) string {
	reply = strings.TrimSpace(reply)
	reply = strings.TrimPrefix(reply, "\"")
	reply = strings.TrimSuffix(reply, "\"")
	reply = strings.TrimSpace(reply)
	if strings.EqualFold(reply, "null") {
		return ""
	}
	return reply
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
