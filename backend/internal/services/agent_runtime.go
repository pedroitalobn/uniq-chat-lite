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
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type AgentRuntime struct {
	db      *gorm.DB
	manager *whatsapp.Manager
	llm     *LLMService

	seenMu   sync.Mutex
	seenMsgs map[string]time.Time
}

func NewAgentRuntime(db *gorm.DB, manager *whatsapp.Manager, llm *LLMService) *AgentRuntime {
	return &AgentRuntime{
		db:       db,
		manager:  manager,
		llm:      llm,
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

	// Respect explicit human handoff: if a live Conversation exists for this
	// (instance, channel_key) with is_bot_active=false, skip the bot entirely.
	// Also: if the Queue attached to the conversation has its own chatbot,
	// that agent takes precedence over the instance-level one.
	agent, found := r.resolveAgent(instUUID, fromJID)
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

	_ = client.SendTyping(fromJID, true)
	time.Sleep(900 * time.Millisecond)
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

// resolveAgent decides which InstanceAgent answers a given inbound message.
//
// Precedence (per user spec):
//  1. If a live Conversation has is_bot_active=false → no bot at all.
//  2. If that Conversation belongs to a Queue with EnableChatbot=true and
//     ChatbotAgentID set → that queue agent wins.
//  3. Otherwise, fall back to the instance-level InstanceAgent.
//
// A returned (nil, false) means "do not reply"; (agent, true) means "use this".
func (r *AgentRuntime) resolveAgent(instanceID uuid.UUID, fromJID string) (*models.InstanceAgent, bool) {
	// Load the active conversation for this instance + channel_key.
	var conv models.Conversation
	err := r.db.
		Where("instance_id = ? AND channel_key = ?", instanceID, fromJID).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).
		Order("updated_at DESC").
		First(&conv).Error

	if err == nil && !conv.IsBotActive {
		// Human handoff explicitly disabled the bot for this conversation.
		return nil, false
	}

	// Try queue-level agent first
	if err == nil && conv.QueueID != nil {
		var q models.Queue
		if qErr := r.db.First(&q, "id = ?", *conv.QueueID).Error; qErr == nil {
			if q.EnableChatbot && q.ChatbotAgentID != nil {
				var agent models.InstanceAgent
				qa := r.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
					return tx.Where("is_active = ?", true).Order("created_at DESC")
				}).Where("id = ? AND is_active = ?", *q.ChatbotAgentID, true).First(&agent)
				if qa.Error == nil {
					return &agent, true
				}
			}
		}
	}

	// Fallback: instance-level agent
	var agent models.InstanceAgent
	fallback := r.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
		return tx.Where("is_active = ?", true).Order("created_at DESC")
	}).Where("instance_id = ? AND is_active = ?", instanceID, true).First(&agent)
	if fallback.Error != nil {
		return nil, false
	}
	return &agent, true
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
