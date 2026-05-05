package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/storage"
	"gorm.io/gorm"
)

// JourneyExecutor é a interface mínima que o Manager precisa para delegar
// execução de jornadas. Fica aqui para evitar ciclo com o pacote services.
//
// HandleIncoming recebe o ID da mensagem WhatsApp (`messageID`) para
// deduplicação: whatsmeow re-emite eventos na reconexão/history sync, e
// sem dedup cada re-emissão dispara a jornada de novo (loop de envio).
type JourneyExecutor interface {
	HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) bool
}

type AgentRuntime interface {
	HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) bool
}

// InboundProcessor is the hook the Manager calls after persisting a received
// WhatsApp message. It lets the ticketing pipeline (services.InboundPipeline)
// resolve/create a Conversation and backfill MessageLog.conversation_id
// without creating an import cycle with services/.
type InboundProcessor interface {
	ProcessSavedInbound(ctx context.Context, ml *models.MessageLog) error
}

// Manager manages all active WhatsApp instance clients.
type Manager struct {
	mu         sync.RWMutex
	clients    map[string]*InstanceClient
	consumers  map[string]context.CancelFunc // instanceID → queue consumer cancel
	sessionDir string
	db         *gorm.DB
	executor   JourneyExecutor
	agentRT    AgentRuntime
	inboundP   InboundProcessor
}

// SetJourneyExecutor injeta o executor (chamado no bootstrap do servidor)
func (m *Manager) SetJourneyExecutor(ex JourneyExecutor) {
	m.mu.Lock()
	m.executor = ex
	m.mu.Unlock()
}

func (m *Manager) SetAgentRuntime(rt AgentRuntime) {
	m.mu.Lock()
	m.agentRT = rt
	m.mu.Unlock()
}

func (m *Manager) JourneyExecutorRef() JourneyExecutor {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.executor
}

func (m *Manager) AgentRuntimeRef() AgentRuntime {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.agentRT
}

// SetInboundProcessor injects the ticketing pipeline (called at bootstrap).
func (m *Manager) SetInboundProcessor(p InboundProcessor) {
	m.mu.Lock()
	m.inboundP = p
	m.mu.Unlock()
}

func (m *Manager) InboundProcessorRef() InboundProcessor {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.inboundP
}

var GlobalManager *Manager

// NewManager creates and returns a new Manager.
func NewManager(sessionDir string, db *gorm.DB) *Manager {
	m := &Manager{
		clients:    make(map[string]*InstanceClient),
		consumers:  make(map[string]context.CancelFunc),
		sessionDir: sessionDir,
		db:         db,
	}
	GlobalManager = m
	return m
}

// StartInstance starts (or restarts) the WhatsApp client for the given instance.
func (m *Manager) StartInstance(instance *models.Instance) error {
	// Defensive check: bloqueia status terminais (banned/error). Aceitamos
	// connected/disconnected E connecting — esse último é estado transitório
	// que persiste no DB quando o backend é reiniciado durante o handshake
	// (deploy, crash, OOM kill). Sem aceitar connecting aqui o LoadAll do
	// boot recusa todas as instances que estavam em pareamento — efeito
	// colateral do próprio LoadAll que marca como connecting antes do start.
	if instance.Status != models.StatusConnected &&
		instance.Status != models.StatusDisconnected &&
		instance.Status != models.StatusConnecting {
		log.Warn().Str("instance", instance.ID.String()).Str("status", string(instance.Status)).
			Msg("refusing to start instance with invalid status")
		return fmt.Errorf("cannot start instance with status %s", instance.Status)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// If already running, stop first
	if existing, ok := m.clients[instance.ID.String()]; ok {
		existing.Disconnect()
		delete(m.clients, instance.ID.String())
	}
	// Cancel existing consumer if any
	if cancel, ok := m.consumers[instance.ID.String()]; ok {
		cancel()
		delete(m.consumers, instance.ID.String())
	}

	proxyCfg := m.buildProxyCfg(instance)
	webhooks := m.loadWebhooks(instance.ID.String())
	settings := instanceSettings(instance)

	client, err := NewInstanceClient(instance.ID.String(), m.sessionDir, proxyCfg, webhooks, settings)
	if err != nil {
		return fmt.Errorf("failed to create instance client: %w", err)
	}

	if err := client.Connect(); err != nil {
		return fmt.Errorf("failed to connect instance: %w", err)
	}

	m.clients[instance.ID.String()] = client
	log.Info().Str("instance", instance.ID.String()).Msg("WhatsApp instance started")

	// Watch for status updates and persist to DB
	go m.watchStatus(instance.ID.String(), client)

	// Start queue consumer for this instance (if RabbitMQ is configured)
	if queue.GlobalQueue != nil && queue.GlobalQueue.IsConnected() {
		ctx, cancel := context.WithCancel(context.Background())
		m.consumers[instance.ID.String()] = cancel
		queue.GlobalQueue.StartConsumer(ctx, instance.ID.String(), func(job queue.SendJob) error {
			ic := m.GetInstance(instance.ID.String())
			if ic == nil {
				return fmt.Errorf("instance not running")
			}
			return ic.ProcessQueueJob(job)
		})
	}

	return nil
}

// StopInstance disconnects and removes the instance client.
func (m *Manager) StopInstance(instanceID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, ok := m.clients[instanceID]; ok {
		client.Disconnect()
		delete(m.clients, instanceID)
		log.Info().Str("instance", instanceID).Msg("WhatsApp instance stopped")
	}
	if cancel, ok := m.consumers[instanceID]; ok {
		cancel()
		delete(m.consumers, instanceID)
	}
}

// GetInstance returns the active client for an instance ID, or nil if not running.
func (m *Manager) GetInstance(instanceID string) *InstanceClient {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[instanceID]
}

// IsRunning returns whether an instance has an active client.
func (m *Manager) IsRunning(instanceID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.clients[instanceID]
	return ok
}

// SaveMessage saves a message to the database for inbox display.
// Wrapper preservado pra compatibilidade com call sites antigos. Novos
// caminhos devem chamar SaveMessageEx pra carregar external_id (stanza_id
// WhatsApp) e quoted reply correlation.
func (m *Manager) SaveMessage(instanceID string, toJID string, content string, direction models.MessageDirection, msgType string, pushName string, isGroup bool, senderJID string) error {
	return m.SaveMessageEx(SaveMessageInput{
		InstanceID: instanceID,
		ToJID:      toJID,
		Content:    content,
		Direction:  direction,
		Type:       msgType,
		PushName:   pushName,
		IsGroup:    isGroup,
		SenderJID:  senderJID,
	})
}

// SaveMessageInput agrupa todos os parâmetros do save. Permite adicionar
// novos campos (external_id, reply_to_external_id, ...) sem quebrar
// signatures existentes.
type SaveMessageInput struct {
	InstanceID        string
	ToJID             string
	Content           string
	Direction         models.MessageDirection
	Type              string
	PushName          string
	IsGroup           bool
	SenderJID         string
	ExternalMessageID string // ex.: stanza_id WhatsApp (v.Info.ID)
	ReplyToExternalID string // stanza_id da msg citada — resolve pra ReplyToID
}

// SaveMessageEx é a versão completa do save. Recebe um struct pra evoluir
// sem quebra de assinatura. Resolve ReplyToExternalID consultando msgs
// anteriores da mesma instance pelo external_id.
func (m *Manager) SaveMessageEx(in SaveMessageInput) error {
	instanceID := in.InstanceID
	toJID := in.ToJID
	content := in.Content
	direction := in.Direction
	msgType := in.Type
	pushName := in.PushName
	isGroup := in.IsGroup
	senderJID := in.SenderJID
	if m.db == nil {
		return nil
	}

	rawJID := toJID
	toJID = canonicalJID(toJID)
	log.Printf("DEBUG SaveMessage: instanceID=%s, rawJID=%s, canonicalJID=%s, isGroup=%v", instanceID, rawJID, toJID, isGroup)

	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return err
	}

	// Salva content como veio. Pro caminho legacy (texto puro), o front
	// trata strings raw e strings JSON-encoded ("oi") via parseMessage
	// Content. Pro caminho novo de mídia (JSON com media_key/url),
	// PRECISA ficar como objeto JSON cru — fazer Marshal aqui escapava o
	// JSON (`{"media_key":...}` virava `"{\"media_key\":...}"`) e o
	// resolver pulava porque o conteúdo não começava com `{`.
	contentJSON := []byte(content)

	// Extract phone from JID (for non-groups)
	phone := extractPhoneFromJID(toJID)

	// Try to get contact info
	var contactName string
	var contactAvatar string

	if isGroup {
		// For groups, get the group name from WhatsApp.
		// Cache em memória por JID — algumas chamadas falham por rate limit
		// ou timeout transitório; reusar resultado anterior evita ficar com
		// "Grupo 5511..." pra sempre quando o primeiro fetch falhou.
		if cached, ok := groupNameCache.Load(toJID); ok {
			if name, ok := cached.(string); ok && name != "" {
				contactName = name
			}
		}
		if contactName == "" {
			if client := m.GetInstance(instanceID); client != nil && client.IsConnected() {
				groupInfo, err := client.GetGroupInfo(toJID)
				if err == nil {
					if name, ok := groupInfo["name"].(string); ok && name != "" {
						contactName = name
						groupNameCache.Store(toJID, name)
					}
				} else {
					// Log estruturado pra ficar visível em observability
					// (rate-limit, timeout, client desconectado). Sem isso
					// o admin só via "Grupo 5511..." sem pista do motivo.
					log.Warn().
						Err(err).
						Str("instance_id", instanceID).
						Str("jid", toJID).
						Msg("manager: GetGroupInfo falhou — usando fallback de nome")
				}
			}
		}
		if contactName == "" {
			contactName = "Grupo " + phone
			// Tentativa async: depois de 5s, refetch e atualiza Conversation/MessageLog
			// caso o nome do grupo agora esteja disponível. Evita ficar travado
			// no fallback quando o primeiro GetGroupInfo deu timeout.
			go m.refetchGroupNameLater(instanceID, toJID)
		}
	} else {
		// For individual chats
		if direction == models.DirectionOut {
			// For sent messages (direction OUT), get recipient info
			// First try CRM
			var contact models.Contact
			if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
				contactName = contact.Name
			}
			// Fallback to phone number
			if contactName == "" {
				contactName = phone
			}
		} else {
			// For received messages, use push name from event
			if pushName != "" {
				contactName = pushName
			}

			// If no push name, try CRM
			if contactName == "" {
				var contact models.Contact
				if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
					contactName = contact.Name
				}
			}

			// Fallback to phone number
			if contactName == "" {
				contactName = phone
			}
		}
	}

	// Try to get avatar from WhatsApp (async, non-blocking for speed)
	if client := m.GetInstance(instanceID); client != nil && client.IsConnected() {
		if picURL := client.GetContactProfilePicture(toJID); picURL != "" {
			contactAvatar = picURL
		}
	}

	senderName := pushName
	if senderName == "" && senderJID != "" {
		senderName = extractPhoneFromJID(senderJID)
	}

	logEntry := models.MessageLog{
		ID:                uuid.New(),
		InstanceID:        instUUID,
		Direction:         direction,
		Type:              msgType,
		ToJID:             toJID,
		ContactName:       contactName,
		ContactAvatar:     contactAvatar,
		SenderJID:         senderJID,
		SenderName:        senderName,
		Content:           string(contentJSON),
		Status:            models.MessageStatusSent,
		ExternalMessageID: in.ExternalMessageID,
	}

	// Reply correlation — se a msg cita outra (ContextInfo.StanzaID), busca
	// a MessageLog correspondente pelo external_id. Mesma instância.
	if in.ReplyToExternalID != "" {
		var quoted models.MessageLog
		if err := m.db.Select("id").
			Where("instance_id = ? AND external_message_id = ?", instUUID, in.ReplyToExternalID).
			First(&quoted).Error; err == nil {
			logEntry.ReplyToID = &quoted.ID
		}
	}

	// Check for duplicate - don't save if same message was saved in last 2 seconds.
	// Use a Go-computed cutoff instead of datetime('now', ...) so the query
	// works on both SQLite (dev) and Postgres (prod).
	var count int64
	cutoff := time.Now().Add(-2 * time.Second)
	m.db.Model(&models.MessageLog{}).Where(
		"instance_id = ? AND to_jid = ? AND content = ? AND direction = ? AND created_at > ?",
		instUUID, toJID, string(contentJSON), direction, cutoff,
	).Count(&count)

	if count > 0 {
		log.Printf("DEBUG: Skipping duplicate message for %s", toJID)
		return nil
	}

	if err := m.db.Create(&logEntry).Error; err != nil {
		return err
	}
	if updatedContent, ok := m.registerMediaFileForMessage(&logEntry); ok {
		logEntry.Content = updatedContent
	}

	// Fire ticketing pipeline (non-blocking).
	//   - Inbound: cria/abre Conversation pro contato.
	//   - Outbound do whatsmeow (isFromMe=true sem ConversationID): dono
	//     respondeu pelo celular/desktop — linka à Conversation correta
	//     pra aparecer no inbox dos agentes em tempo real. Outbound
	//     enviado via API da plataforma já vem com ConversationID setado
	//     e o ProcessSavedOutbound retorna no-op.
	if !isGroup {
		if p := m.InboundProcessorRef(); p != nil {
			entry := logEntry
			go func() {
				if err := p.ProcessSavedInbound(context.Background(), &entry); err != nil {
					log.Warn().Err(err).
						Str("instance", instanceID).
						Str("direction", string(entry.Direction)).
						Msg("ticketing pipeline: failed to process")
				}
			}()
		}
	}

	return nil
}

func (m *Manager) registerMediaFileForMessage(msg *models.MessageLog) (string, bool) {
	if m.db == nil || msg == nil || msg.Content == "" || !strings.HasPrefix(strings.TrimSpace(msg.Content), "{") {
		return "", false
	}
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(msg.Content), &payload); err != nil {
		return "", false
	}
	key, _ := payload["media_key"].(string)
	if key == "" {
		return "", false
	}
	if existingID, _ := payload["media_id"].(string); existingID != "" {
		return msg.Content, false
	}

	var media models.MediaFile
	err := m.db.Where("object_key = ?", key).First(&media).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		log.Warn().Err(err).Str("key", key).Msg("media file lookup failed")
		return "", false
	}
	if err == gorm.ErrRecordNotFound {
		media = models.MediaFile{
			WorkspaceID:  msg.WorkspaceID,
			UserID:       msg.UserID,
			InstanceID:   &msg.InstanceID,
			MessageLogID: &msg.ID,
			ObjectKey:    key,
			MediaType:    msg.Type,
			MimeType:     stringFromPayload(payload, "mime_type"),
			Filename:     stringFromPayload(payload, "filename"),
			PublicURL:    stringFromPayload(payload, "url"),
			SizeBytes:    int64FromPayload(payload, "size_bytes"),
		}
		if storage.GlobalStorage != nil {
			media.Bucket = storage.GlobalStorage.BucketName()
			if media.PublicURL == "" {
				media.PublicURL = storage.GlobalStorage.PublicURL(key)
			}
		}
		if err := m.db.Create(&media).Error; err != nil {
			log.Warn().Err(err).Str("key", key).Msg("media file create failed")
			return "", false
		}
	} else if media.MessageLogID == nil {
		updates := map[string]interface{}{"message_log_id": msg.ID}
		if media.WorkspaceID == nil && msg.WorkspaceID != nil {
			updates["workspace_id"] = *msg.WorkspaceID
		}
		if media.UserID == nil && msg.UserID != nil {
			updates["user_id"] = *msg.UserID
		}
		if media.InstanceID == nil {
			updates["instance_id"] = msg.InstanceID
		}
		m.db.Model(&media).Updates(updates)
	}

	payload["media_id"] = media.ID.String()
	payload["public_url"] = "/m/" + media.ID.String()
	payload["download_url"] = "/v1/media/files/" + media.ID.String() + "/download"
	payload["stream_url"] = "/v1/media/files/" + media.ID.String() + "/stream"
	out, err := json.Marshal(payload)
	if err != nil {
		return "", false
	}
	updated := string(out)
	if updated != msg.Content {
		if err := m.db.Model(&models.MessageLog{}).Where("id = ?", msg.ID).Update("content", updated).Error; err != nil {
			log.Warn().Err(err).Str("message_id", msg.ID.String()).Msg("message media_id update failed")
			return "", false
		}
		return updated, true
	}
	return updated, false
}

func stringFromPayload(payload map[string]interface{}, key string) string {
	v, _ := payload[key].(string)
	return v
}

func int64FromPayload(payload map[string]interface{}, key string) int64 {
	switch v := payload[key].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	default:
		return 0
	}
}

// UpdateEditedMessage atualiza uma MessageLog existente quando o cliente
// edita uma mensagem já enviada. O whatsmeow re-emite events.Message com
// IsEdit=true; o stanza_id da mensagem original vem em ContextInfo.
//
// Se a msg original for encontrada (mesma instance + external_id), atualiza
// content + is_edited=true. Se não, retorna false e o caller pode salvar
// como nova msg (fallback).
func (m *Manager) UpdateEditedMessage(instanceID, originalStanzaID, newContent string) bool {
	if m.db == nil || originalStanzaID == "" {
		return false
	}
	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return false
	}
	res := m.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND external_message_id = ?", instUUID, originalStanzaID).
		Updates(map[string]any{
			"content":   newContent,
			"is_edited": true,
		})
	if res.Error != nil {
		log.Warn().Err(res.Error).Msg("UpdateEditedMessage: falhou")
		return false
	}
	return res.RowsAffected > 0
}

// ApplyReceipt persiste delivery/read receipts vindo do whatsmeow.
// Mapeia ReceiptType → status:
//   - ""           → delivered (default whatsmeow)
//   - "delivery"   → delivered
//   - "read"       → read
//   - "read-self"  → read
//   - "played"     → read (view-once aberto)
//   - resto        → ignorado
//
// Em conversas 1:1 atualiza só MessageLog (status + delivered_at/read_at).
// Em grupos, ALÉM disso cria uma linha em message_receipts pra montar o
// painel "Visto por X, Y, Z" (uma linha por participante por evento).
func (m *Manager) ApplyReceipt(instanceID string, externalIDs []string, receiptType, participantJID string, ts time.Time, isGroup bool) {
	if m.db == nil || len(externalIDs) == 0 {
		return
	}
	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return
	}
	var newStatus models.MessageStatus
	switch receiptType {
	case "", "delivery":
		newStatus = models.MessageStatusDelivered
	case "read", "read-self", "played", "played-self":
		newStatus = models.MessageStatusRead
	default:
		// retry, sender, server-error, inactive, peer_msg, hist_sync — ignora
		return
	}

	// Lookup pelas msgs alvo (outbound nossas que estão recebendo receipt)
	var msgs []models.MessageLog
	if err := m.db.Where(
		"instance_id = ? AND external_message_id IN ? AND direction = ?",
		instUUID, externalIDs, models.DirectionOut,
	).Find(&msgs).Error; err != nil {
		log.Warn().Err(err).Msg("ApplyReceipt: lookup falhou")
		return
	}
	if len(msgs) == 0 {
		return
	}

	// Update em batch — só promove status (sent → delivered → read), nunca regride
	updates := map[string]any{}
	switch newStatus {
	case models.MessageStatusDelivered:
		updates["status"] = models.MessageStatusDelivered
		updates["delivered_at"] = ts
		// Apenas promove se status atual ainda é pending/sent
		m.db.Model(&models.MessageLog{}).
			Where("id IN ? AND status IN ?", messageIDs(msgs), []models.MessageStatus{
				models.MessageStatusPending, models.MessageStatusSent,
			}).
			Updates(updates)
	case models.MessageStatusRead:
		updates["status"] = models.MessageStatusRead
		updates["read_at"] = ts
		// Read promove qualquer status anterior
		m.db.Model(&models.MessageLog{}).
			Where("id IN ?", messageIDs(msgs)).
			Updates(updates)
	}

	// Em grupos, registra cada receipt individual pra painel de "visto por"
	if isGroup && participantJID != "" {
		receiptKind := "delivered"
		if newStatus == models.MessageStatusRead {
			receiptKind = "read"
		}
		for _, msg := range msgs {
			r := models.MessageReceipt{
				ID:             uuid.New(),
				MessageLogID:   msg.ID,
				ParticipantJID: participantJID,
				Type:           receiptKind,
				Timestamp:      ts,
			}
			// Idempotente — se já existe receipt do mesmo tipo do mesmo participante, skipa
			var count int64
			m.db.Model(&models.MessageReceipt{}).
				Where("message_log_id = ? AND participant_j_id = ? AND type = ?", msg.ID, participantJID, receiptKind).
				Count(&count)
			if count == 0 {
				_ = m.db.Create(&r).Error
			}
		}
	}

	// Broadcast WS pra UI atualizar tick em tempo real (sem polling).
	// Reusa o hub global; targeting por workspace via room "workspace:<id>".
	if hub := GetHub(); hub != nil {
		for _, msg := range msgs {
			payload := map[string]any{
				"id":     msg.ID.String(),
				"status": string(newStatus),
				"ts":     ts.Unix(),
			}
			if msg.ConversationID != nil {
				payload["conversation_id"] = msg.ConversationID.String()
			}
			ev := &Event{Type: "message.receipt", Payload: payload}
			if msg.WorkspaceID != nil {
				ev.Workspace = msg.WorkspaceID.String()
			}
			ev.Instance = instanceID
			hub.Broadcast(ev)
		}
	}
}

func messageIDs(msgs []models.MessageLog) []uuid.UUID {
	out := make([]uuid.UUID, len(msgs))
	for i := range msgs {
		out[i] = msgs[i].ID
	}
	return out
}

// groupNameCache evita ficar com "Grupo 5511..." quando GetGroupInfo
// falhar transitoriamente (rate limit, timeout). Map[jid]name.
var groupNameCache sync.Map

// refetchGroupNameLater tenta de novo após 5s. Se conseguir o nome, atualiza
// MessageLogs+Conversation desse grupo na instância. Idempotente — não faz
// nada se o cache já tem o nome ou se o fetch falhar de novo.
//
// Faz até 3 tentativas com backoff exponencial (5s, 15s, 45s) — sem isso
// um único timeout no primeiro fetch deixava o grupo com fallback "Grupo
// 5511..." pra sempre, porque a goroutine só rodava 1 vez.
func (m *Manager) refetchGroupNameLater(instanceID, groupJID string) {
	delays := []time.Duration{5 * time.Second, 15 * time.Second, 45 * time.Second}
	for attempt, d := range delays {
		time.Sleep(d)
		if _, ok := groupNameCache.Load(groupJID); ok {
			return // outro caller já cacheou
		}
		client := m.GetInstance(instanceID)
		if client == nil || !client.IsConnected() {
			continue // tenta de novo no próximo backoff
		}
		info, err := client.GetGroupInfo(groupJID)
		if err != nil {
			log.Debug().
				Err(err).
				Str("instance_id", instanceID).
				Str("jid", groupJID).
				Int("attempt", attempt+1).
				Msg("manager: refetch nome do grupo falhou — vai tentar de novo")
			continue
		}
		name, ok := info["name"].(string)
		if !ok || name == "" {
			continue
		}
		groupNameCache.Store(groupJID, name)
		log.Info().
			Str("instance_id", instanceID).
			Str("jid", groupJID).
			Str("name", name).
			Int("attempt", attempt+1).
			Msg("manager: nome do grupo resolvido após refetch")
		applyGroupName(m, instanceID, groupJID, name)
		return
	}
}

// upsertPushName persiste o push name capturado em events.PushName/Contact:
//   - Cria/atualiza Contact pelo phone (extrai do JID).
//   - Atualiza MessageLog.contact_name onde ainda está com o número/JID.
//   - Atualiza Conversation.push_name (campo dedicado pro nome de exibição).
// Idempotente — sobrescreve só quando o registro tem nome vazio ou igual
// ao número (heurística pra não pisar em renomeações manuais via CRM).
func upsertPushName(m *Manager, instanceID, jid, name string) {
	if m == nil || m.db == nil || jid == "" || name == "" {
		return
	}
	phone := extractPhoneFromJID(jid)
	if phone == "" {
		return
	}
	// Contact: upsert por phone. Se contact existe com nome real (≠ phone),
	// não toca — push name é "fonte secundária", não sobrescreve edição CRM.
	var existing models.Contact
	err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&existing).Error
	if err == nil {
		if existing.Name == "" || existing.Name == phone || existing.Name == "+"+phone {
			m.db.Model(&existing).Update("name", name)
		}
	}
	instUUID, parseErr := uuid.Parse(instanceID)
	if parseErr != nil {
		return
	}
	// MessageLog: troca contact_name onde ainda mostra o número.
	m.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND from_jid = ? AND (contact_name = '' OR contact_name = ? OR contact_name = ?)",
			instUUID, jid, phone, "+"+phone).
		Update("contact_name", name)
	// Conversation: push_name é o nome de exibição quando contact não está
	// vinculado. Atualiza onde está vazio.
	m.db.Model(&models.Conversation{}).
		Where("instance_id = ? AND channel_key = ? AND (push_name = '' OR push_name IS NULL)",
			instUUID, jid).
		Update("push_name", name)
	log.Debug().
		Str("instance_id", instanceID).
		Str("jid", jid).
		Str("name", name).
		Msg("manager: push name persistido")
}

// applyGroupName persiste o nome resolvido em MessageLog/Conversation. Extraído
// do refetch original pra ser chamável de outros call sites (ex: webhook
// consumer de events.GroupInfo).
func applyGroupName(m *Manager, instanceID, groupJID, name string) {
	if m.db == nil {
		return
	}
	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return
	}
	// Atualiza MessageLogs desse grupo nessa instance que ainda têm fallback
	m.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND to_jid = ? AND contact_name LIKE ?", instUUID, groupJID, "Grupo %").
		Update("contact_name", name)
	// Conversation: se contato é nil ou subject vazio, define subject = nome
	m.db.Model(&models.Conversation{}).
		Where("instance_id = ? AND channel_key = ? AND (subject = '' OR subject IS NULL)", instUUID, groupJID).
		Update("subject", name)
}

func extractPhoneFromJID(jid string) string {
	if idx := strings.Index(jid, "@"); idx > 0 {
		return jid[:idx]
	}
	return jid
}

// canonicalJID normalizes personal chats to @s.whatsapp.net to avoid split conversations.
// LID-form JIDs are left untouched so we never fabricate a "phone" JID from a LID
// user-id hash — that would split the inbox (@lid row vs. real @s.whatsapp.net row).
// Upstream code (InstanceClient.resolveChatPNJID) is responsible for mapping LID → PN
// before calling SaveMessage; any @lid that still reaches here is filtered out of
// the inbox listing downstream.
//
// Strip device suffix `:N` (e.g. "5511XXX:1@s.whatsapp.net" → "5511XXX@s.whatsapp.net").
// CallOffer/Terminate frequentemente vêm com device suffix; sem strip, calls
// criariam conversation duplicada por não casar com a key sem suffix.
func canonicalJID(jid string) string {
	if jid == "" {
		return jid
	}
	if strings.HasSuffix(jid, "@g.us") || strings.HasSuffix(jid, "@newsletter") || jid == "status@broadcast" {
		return jid
	}
	if strings.HasSuffix(jid, "@lid") {
		return jid
	}
	phone := extractPhoneFromJID(jid)
	if phone == "" {
		return jid
	}
	// Strip device suffix `:N` se houver
	if idx := strings.Index(phone, ":"); idx > 0 {
		phone = phone[:idx]
	}
	return phone + "@s.whatsapp.net"
}

// RestartWithProxy stops the instance and restarts it with updated proxy configuration.
func (m *Manager) RestartWithProxy(instance *models.Instance) error {
	return m.StartInstance(instance)
}

// StartInstanceForPairing starts the instance in phone-pairing mode (no QR channel).
func (m *Manager) StartInstanceForPairing(instance *models.Instance) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.clients[instance.ID.String()]; ok {
		existing.Disconnect()
		delete(m.clients, instance.ID.String())
	}

	proxyCfg := m.buildProxyCfg(instance)
	webhooks := m.loadWebhooks(instance.ID.String())
	settings := instanceSettings(instance)

	client, err := NewInstanceClient(instance.ID.String(), m.sessionDir, proxyCfg, webhooks, settings)
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	if err := client.ConnectDirect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	m.clients[instance.ID.String()] = client
	go m.watchStatus(instance.ID.String(), client)

	if queue.GlobalQueue != nil && queue.GlobalQueue.IsConnected() {
		ctx, cancel := context.WithCancel(context.Background())
		m.consumers[instance.ID.String()] = cancel
		queue.GlobalQueue.StartConsumer(ctx, instance.ID.String(), func(job queue.SendJob) error {
			ic := m.GetInstance(instance.ID.String())
			if ic == nil {
				return fmt.Errorf("instance not running")
			}
			return ic.ProcessQueueJob(job)
		})
	}
	return nil
}

// LoadAll loads and starts all connected instances from the database.
func (m *Manager) LoadAll() {
	// Instâncias presas em "connecting" são resíduo de deploys/crashes no meio
	// do handshake QR. Resetamos para "disconnected" antes de qualquer coisa —
	// isso evita que o boot re-inicie sessões incompletas ou instâncias que o
	// usuário desconectou enquanto ainda estava em connecting.
	if err := m.db.Model(&models.Instance{}).
		Where("status = ?", models.StatusConnecting).
		Update("status", models.StatusDisconnected).Error; err != nil {
		log.Error().Err(err).Msg("failed to reset stale connecting instances")
	}

	// Carrega apenas instâncias que estavam efetivamente conectadas.
	// "connecting" foi limpo acima; "disconnected" = usuário desconectou ou
	// sessão caiu — não deve ser re-iniciada automaticamente sem ação do user.
	var instances []models.Instance
	if err := m.db.Find(&instances, "status = ?", models.StatusConnected).Error; err != nil {
		log.Error().Err(err).Msg("failed to load connected instances")
		return
	}

	// Skip if nothing to load
	if len(instances) == 0 {
		log.Info().Msg("no instances to load")
		return
	}

	for i := range instances {
		m.db.Model(&instances[i]).Update("status", models.StatusConnecting)
		if err := m.StartInstance(&instances[i]); err != nil {
			log.Error().Err(err).Str("instance", instances[i].ID.String()).Msg("failed to start instance on boot")
			m.db.Model(&instances[i]).Update("status", models.StatusDisconnected)
		}
	}

	// Start background reconnection checker
	go m.startReconnectionChecker()

	log.Info().Int("count", len(instances)).Msg("loaded WhatsApp instances")
}

// startReconnectionChecker periodically checks connected instances that lost
// their manager client (e.g. after a crash/OOM that didn't update the DB)
// and restarts them. Only runs for status="connected" — disconnected instances
// (user-initiated or session-cleared) are never touched.
func (m *Manager) startReconnectionChecker() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		var instances []models.Instance
		// Apenas canais gerenciados pelo whatsmeow (WhatsApp não-oficial).
		// Instagram, TikTok e WABA têm seu próprio ciclo de vida e não
		// possuem client em m.clients — incluí-los causaria reconnect loops.
		m.db.Find(&instances, "status = ? AND channel IN ?", models.StatusConnected,
			[]string{"whatsapp", "whatsapp_business"})

		for _, inst := range instances {
			m.mu.RLock()
			client, exists := m.clients[inst.ID.String()]
			m.mu.RUnlock()

			// Já está rodando e conectado — nada a fazer.
			if exists && client != nil && client.IsConnected() {
				continue
			}

			// Sem sessão whatsmeow no store → usuário desconectou e limpou
			// a sessão. Não re-iniciamos: atualizamos o status para refletir
			// a realidade e deixamos o usuário reconectar manualmente.
			if exists && client != nil && !client.IsLoggedIn() {
				log.Info().Str("instance", inst.ID.String()).
					Msg("reconnect checker: sem sessão no store — marcando como disconnected")
				m.db.Model(&inst).Update("status", models.StatusDisconnected)
				m.StopInstance(inst.ID.String())
				continue
			}

			log.Info().Str("instance", inst.ID.String()).Msg("attempting auto-reconnect")
			if err := m.StartInstance(&inst); err != nil {
				log.Error().Err(err).Str("instance", inst.ID.String()).Msg("auto-reconnect failed")
			}
		}
	}
}

// ResetSession clears the WhatsApp session for an instance (logout + delete device store)
// so it can be re-paired with a new phone number. Message history is preserved in the DB.
func (m *Manager) ResetSession(instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, ok := m.clients[instanceID]; ok {
		if err := client.ClearSession(); err != nil {
			return fmt.Errorf("clear session: %w", err)
		}
		client.Disconnect()
		delete(m.clients, instanceID)
	}
	if cancel, ok := m.consumers[instanceID]; ok {
		cancel()
		delete(m.consumers, instanceID)
	}
	return nil
}

// RefreshSettings updates the behavior settings for a running instance without reconnecting.
func (m *Manager) RefreshSettings(instanceID string, instance *models.Instance) {
	m.mu.RLock()
	client, ok := m.clients[instanceID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	client.UpdateSettings(instanceSettings(instance))
}

// ReconnectAll triggers reconnection for all instances belonging to a specific user
func (m *Manager) ReconnectAll(userID string) {
	var instances []models.Instance
	m.db.Find(&instances, "user_id = ? AND status = ?", userID, models.StatusConnected)

	for _, inst := range instances {
		m.db.Model(&inst).Update("status", models.StatusConnecting)
		if err := m.StartInstance(&inst); err != nil {
			log.Error().Err(err).Str("instance", inst.ID.String()).Msg("failed to reconnect on login")
			m.db.Model(&inst).Update("status", models.StatusDisconnected)
		}
	}
}

// RefreshWebhooks updates the webhooks for a running instance without reconnecting.
func (m *Manager) RefreshWebhooks(instanceID string) {
	m.mu.RLock()
	client, ok := m.clients[instanceID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	client.UpdateWebhooks(m.loadWebhooks(instanceID))
}

// buildProxyCfg constructs a ProxyConfig from an instance model using the central resolver.
// Returns nil if the resolver decides no proxy should apply (avoids passing "http://:0"
// to whatsmeow when config is broken).
func (m *Manager) buildProxyCfg(instance *models.Instance) *ProxyConfig {
	resolved := NewProxyResolver(m.db).Resolve(instance)
	return resolved.Config
}

// ResolveEffectiveProxyExported é a versão pública usada por handlers para debug
// (endpoint /proxy/effective). Retorna (config, source).
func (m *Manager) ResolveEffectiveProxyExported(instance *models.Instance) (*ProxyConfig, string) {
	resolved := NewProxyResolver(m.db).Resolve(instance)
	return resolved.Config, resolved.Source
}

// ResolveEffectiveProxyDetailed retorna o objeto ResolvedProxy completo (inclui chain).
func (m *Manager) ResolveEffectiveProxyDetailed(instance *models.Instance) *ResolvedProxy {
	return NewProxyResolver(m.db).Resolve(instance)
}

// resolveGlobalProxyFields retorna os campos efetivos de um GlobalProxyConfig,
// honrando UseEnv (lê BRIGHTDATA_HOST/PORT/USER/PASS das envs).
// Retorna (host, port, username, password_plaintext, proxy_type, source).
func resolveGlobalProxyFields(g *models.Proxy) (string, int, string, string, string, string) {
	host := g.Host
	port := g.Port
	user := g.Username
	pass := ""
	proxyType := g.ProxyType
	source := "global_db"

	if g.Password != "" {
		if dec, err := DecryptProxyPassword(g.Password); err == nil {
			pass = dec
		}
	}

	if g.UseEnv {
		source = "global_env"
		if v := os.Getenv("BRIGHTDATA_HOST"); v != "" {
			host = v
		}
		if v := os.Getenv("BRIGHTDATA_PORT"); v != "" {
			if p, err := strconv.Atoi(v); err == nil && p > 0 {
				port = p
			}
		}
		if v := os.Getenv("BRIGHTDATA_USER"); v != "" {
			user = v
		}
		if v := os.Getenv("BRIGHTDATA_PASS"); v != "" {
			pass = v
		}
		if proxyType == "" {
			proxyType = "http"
		}
	}

	return host, port, user, pass, proxyType, source
}

// ResolveGlobalProxyFieldsExported expõe o helper para o pacote handlers
// (necessário para o endpoint de admin de test do global proxy).
func ResolveGlobalProxyFieldsExported(g *models.Proxy) (host string, port int, user, pass, proxyType, source string) {
	return resolveGlobalProxyFields(g)
}

func (m *Manager) loadWebhooks(instanceID string) []webhookEntry {
	var webhooks []models.Webhook
	if err := m.db.Find(&webhooks, "instance_id = ? AND is_active = true", instanceID).Error; err != nil {
		return nil
	}

	entries := make([]webhookEntry, 0, len(webhooks))
	for _, wh := range webhooks {
		evs := parseEventsJSON(wh.Events)
		entries = append(entries, webhookEntry{
			ID:            wh.ID.String(),
			Events:        evs,
			IgnoreGroups:  wh.IgnoreGroups,
			IgnoreSelf:    wh.IgnoreSelf,
			IgnoreAPISent: wh.IgnoreAPISent,
			// HTTP
			URL:    wh.URL,
			Secret: wh.Secret,
			// RabbitMQ
			RabbitMQEnabled: wh.RabbitMQEnabled,
			AMQPURL:         wh.AMQPURL,
			Exchange:        wh.Exchange,
			RoutingKey:      wh.RoutingKey,
			// NATS
			NATSEnabled: wh.NATSEnabled,
			NATSURL:     wh.NATSURL,
			NATSSubject: wh.NATSSubject,
			NATSToken:   wh.NATSToken,
			// WS Client
			WSEnabled:     wh.WSEnabled,
			WSClientURL:   wh.WSClientURL,
			WSClientToken: wh.WSClientToken,
		})
	}
	return entries
}

// disconnectedDebounce delays persisting/broadcasting a "disconnected" event
// pra ocultar flaps transitórios. Com EnableAutoReconnect=true no whatsmeow,
// a lib reconecta em 0-18s via exponential backoff interno — o debounce só
// precisa cobrir o tempo entre o evento Disconnected e o evento Connected
// da reconexão. 8s pega 90% dos flaps sem atrasar demais o feedback real.
const disconnectedDebounce = 8 * time.Second

func (m *Manager) watchStatus(instanceID string, client *InstanceClient) {
	// If the instance hasn't connected within 60 s, reset to disconnected.
	connectTimer := time.AfterFunc(60*time.Second, func() {
		if !client.IsConnected() {
			m.db.Model(&models.Instance{}).
				Where("id = ? AND status = ?", instanceID, models.StatusConnecting).
				Update("status", models.StatusDisconnected)
			log.Info().Str("instance", instanceID).Msg("connection timeout — reset to disconnected")
		}
	})

	var disconnectTimer *time.Timer
	var disconnectTimerMu sync.Mutex
	cancelDisconnect := func() {
		disconnectTimerMu.Lock()
		if disconnectTimer != nil {
			disconnectTimer.Stop()
			disconnectTimer = nil
		}
		disconnectTimerMu.Unlock()
	}

	for status := range client.GetStatusChan() {
		connectTimer.Stop()

		// Get phone number for the event
		var inst models.Instance
		var phone string
		if err := m.db.First(&inst, "id = ?", instanceID).Error; err == nil {
			phone = inst.PhoneNumber
		}

		if status == "connected" {
			// Cancel any pending debounced disconnect — we recovered in time.
			cancelDisconnect()

			now := time.Now()
			m.db.Model(&models.Instance{}).Where("id = ?", instanceID).Updates(map[string]interface{}{
				"status":       models.StatusConnected,
				"connected_at": now,
			})

			// Broadcast connection event
			if hub := GetHub(); hub != nil {
				hub.BroadcastInstanceStatus(instanceID, "connected", phone)
			}
		} else {
			// Debounce: hold the disconnect for disconnectedDebounce. If a
			// "connected" arrives before then, cancel and never surface the
			// blip. If we're still down after the window, commit it.
			cancelDisconnect()
			phoneCopy := phone
			disconnectTimerMu.Lock()
			disconnectTimer = time.AfterFunc(disconnectedDebounce, func() {
				if client.IsConnected() {
					// whatsmeow reconectou silenciosamente dentro da janela
					// de debounce — ótimo, flap escondido do usuário.
					log.Debug().Str("instance", instanceID).
						Msg("disconnect hidden: whatsmeow reconectou dentro do debounce window")
					return
				}
				m.db.Model(&models.Instance{}).Where("id = ?", instanceID).Update("status", models.StatusDisconnected)
				if hub := GetHub(); hub != nil {
					hub.BroadcastInstanceStatus(instanceID, "disconnected", phoneCopy)
				}
				log.Info().Str("instance", instanceID).Msg("disconnect sustained past debounce window — surfacing")
			})
			disconnectTimerMu.Unlock()
		}
	}
}

func instanceSettings(instance *models.Instance) InstanceSettings {
	return InstanceSettings{
		AlwaysOnline: instance.AlwaysOnline,
		RejectCalls:  instance.RejectCalls,
		ReadMessages: instance.ReadMessages,
		IgnoreGroups: instance.IgnoreGroups,
		IgnoreStatus: instance.IgnoreStatus,
	}
}

func parseEventsJSON(raw string) []string {
	if raw == "" || raw == "[]" {
		return []string{"*"}
	}
	var events []string
	if err := json.Unmarshal([]byte(raw), &events); err != nil {
		return []string{"*"}
	}
	return events
}

// CheckJourneys checks if any journey should be triggered for the given message
// and executes them asynchronously. Delega ao JourneyExecutor quando injetado.
func (m *Manager) CheckJourneys(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) {
	ex := m.JourneyExecutorRef()
	if ex != nil {
		ex.HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType, isGroup)
		return
	}

	// Fallback legacy (caso executor não injetado)
	var journeys []models.Journey
	if err := m.db.Where("instance_id = ? AND status = 'active'", instanceID).Find(&journeys).Error; err != nil {
		log.Error().Err(err).Str("instance", instanceID).Msg("failed to query journeys")
		return
	}
	if len(journeys) == 0 {
		return
	}
	for i := range journeys {
		journey := &journeys[i]
		if !journey.ShouldTrigger(messageText, groupJID, messageType, isGroup) {
			continue
		}
		go func(j *models.Journey) {
			if err := m.executeJourney(j, fromJID, fromName, groupJID, messageText, isGroup); err != nil {
				log.Error().Err(err).Str("journey", j.ID).Msg("failed to execute journey")
			}
		}(journey)
	}
}

// HandleIncomingAutomation runs journeys first and only falls back to the
// instance agent when no journey consumed the incoming message.
func (m *Manager) HandleIncomingAutomation(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) {
	handledByJourney := false
	if ex := m.JourneyExecutorRef(); ex != nil {
		handledByJourney = ex.HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType, isGroup)
	} else {
		m.CheckJourneys(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType, isGroup)
	}
	if handledByJourney {
		return
	}
	if rt := m.AgentRuntimeRef(); rt != nil {
		rt.HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType, isGroup)
	}
}

// completeExecution marca uma execução como completa
func (m *Manager) completeExecution(execution *models.JourneyExecution, journey *models.Journey) {
	now := time.Now()
	execution.Status = models.ExecutionCompleted
	execution.CompletedAt = &now
	execution.UpdatedAt = now
	m.db.Save(execution)

	m.db.Model(journey).Updates(map[string]interface{}{
		"invocations":     journey.Invocations + 1,
		"completed_count": journey.CompletedCount + 1,
		"last_run_at":     now,
	})

	log.Info().
		Str("journey", journey.ID).
		Str("contato", execution.ContactJID).
		Msg("execução de jornada completa")
}

// failExecution marca uma execução como falha
func (m *Manager) failExecution(execution *models.JourneyExecution, errMsg string) {
	now := time.Now()
	execution.Status = models.ExecutionFailed
	execution.ErrorMessage = errMsg
	execution.UpdatedAt = now
	if execution.CompletedAt == nil {
		execution.CompletedAt = &now
	}
	m.db.Save(execution)

	log.Error().
		Str("execution", execution.ID).
		Str("erro", errMsg).
		Msg("execução de jornada falhou")
}

func (m *Manager) executeJourney(journey *models.Journey, fromJID, fromName, groupJID, messageText string, isGroup bool) error {
	client := m.GetInstance(journey.InstanceID)
	if client == nil {
		log.Error().Str("journey", journey.ID).Str("instance", journey.InstanceID).Msg("instance not running for journey")
		return fmt.Errorf("instance not running")
	}

	log.Info().
		Str("journey", journey.ID).
		Str("name", journey.Name).
		Str("from", fromJID).
		Str("fromName", fromName).
		Str("groupJID", groupJID).
		Bool("isGroup", isGroup).
		Str("messageTemplate", journey.MessageTemplate).
		Msg("executing journey - sending message")

	// Create execution record
	execution := &models.JourneyExecution{
		ID:          uuid.New().String(),
		JourneyID:   journey.ID,
		InstanceID:  journey.InstanceID,
		ContactJID:  fromJID,
		ContactName: fromName,
		GroupJID:    groupJID,
		Status:      models.ExecutionActive,
		TotalSteps:  1,
		CurrentStep: "send",
		StepIndex:   0,
		StartedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	m.db.Create(execution)

	// Add inbound message
	execution.AddMessage("inbound", messageText, "trigger")

	responseMsg := buildJourneyResponse(journey, fromName, messageText)

	// Determine recipient based on journey type and group context
	recipientJID := fromJID
	if isGroup && journey.GroupJID != "" {
		// For group triggers, send to the group
		recipientJID = journey.GroupJID
	} else if !strings.Contains(recipientJID, "@") {
		recipientJID = recipientJID + "@s.whatsapp.net"
	}

	if _, err := client.SendTextMessage(recipientJID, responseMsg); err != nil {
		log.Error().Err(err).Str("journey", journey.ID).Str("to", recipientJID).Msg("failed to send journey message")
		execution.Status = models.ExecutionFailed
		execution.ErrorMessage = err.Error()
		execution.UpdatedAt = time.Now()
		execution.CompletedAt = &execution.UpdatedAt
		m.db.Save(execution)
		return fmt.Errorf("failed to send message: %w", err)
	}

	// Add outbound message
	execution.AddMessage("outbound", responseMsg, "send")

	now := time.Now()
	execution.Status = models.ExecutionCompleted
	execution.CompletedAt = &now
	execution.UpdatedAt = now
	m.db.Save(execution)

	m.db.Model(journey).Updates(map[string]interface{}{
		"invocations":     gorm.Expr("invocations + 1"),
		"completed_count": gorm.Expr("completed_count + 1"),
		"last_run_at":     now,
	})

	log.Info().Str("journey", journey.ID).Str("to", recipientJID).Str("message", responseMsg).Msg("journey executed successfully")
	return nil
}

// executeCRMAction executes CRM-related actions for a journey
func (m *Manager) executeCRMAction(actionType models.ActionType, contactPhone, contactName, instanceID string, actionConfig map[string]interface{}) error {
	log.Info().Str("action", string(actionType)).Str("phone", contactPhone).Msg("executing CRM action")

	// Get phone without @s.whatsapp.net
	phone := contactPhone
	if idx := strings.Index(phone, "@"); idx > 0 {
		phone = phone[:idx]
	}

	switch actionType {
	case models.ActionCreateContact, models.ActionCreateLead:
		// Create or update contact in CRM
		instanceUUID, _ := uuid.Parse(instanceID)
		funnel := "Default"
		stage := "Novo"
		if f, ok := actionConfig["funnel"].(string); ok && f != "" {
			funnel = f
		}
		if s, ok := actionConfig["stage"].(string); ok && s != "" {
			stage = s
		}
		if fs, ok := actionConfig["funnel_stage"].(string); ok && fs != "" {
			parts := strings.Split(fs, "/")
			if len(parts) >= 1 && parts[0] != "" {
				funnel = parts[0]
			}
			if len(parts) >= 2 && parts[1] != "" {
				stage = parts[1]
			}
		}

		contactNameToSave := contactName
		if contactNameToSave == "" {
			contactNameToSave = "Cliente " + phone
		}

		// Check if contact exists
		var existing models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&existing).Error; err == nil {
			// Update existing contact
			existing.Funnel = funnel
			existing.Stage = stage
			m.db.Save(&existing)
			log.Info().Str("phone", phone).Str("funnel", funnel).Str("stage", stage).Msg("journey updated contact in CRM")
		} else {
			// Create new contact
			userID := uuid.Nil
			// Try to get user from instance
			var inst models.Instance
			if err := m.db.First(&inst, "id = ?", instanceUUID).Error; err == nil {
				userID = inst.UserID
			}
			contact := models.Contact{
				ID:     uuid.New(),
				UserID: userID,
				Phone:  phone,
				Name:   contactNameToSave,
				Funnel: funnel,
				Stage:  stage,
			}
			// Try to associate with workspace
			if inst.WorkspaceID != nil {
				contact.WorkspaceID = inst.WorkspaceID
			}
			if err := m.db.Create(&contact).Error; err != nil {
				log.Error().Err(err).Str("phone", phone).Msg("journey failed to create contact in CRM")
				return fmt.Errorf("failed to create contact: %w", err)
			}
			log.Info().Str("phone", phone).Str("funnel", funnel).Str("stage", stage).Msg("journey created contact in CRM")
		}

	case models.ActionAddTag:
		// Add tag to contact
		tagName := "Lead"
		if t, ok := actionConfig["tag"].(string); ok && t != "" {
			tagName = t
		}
		// Find or create tag
		var tag models.Tag
		if err := m.db.Where("name = ?", tagName).First(&tag).Error; err != nil {
			tag = models.Tag{Name: tagName, Color: "#00d46a"}
			m.db.Create(&tag)
		}
		// Add tag to contact
		var contact models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
			var contactTags []models.Tag
			m.db.Model(&contact).Association("Tags").Find(&contactTags)
			hasTag := false
			for _, t := range contactTags {
				if t.ID == tag.ID {
					hasTag = true
					break
				}
			}
			if !hasTag {
				m.db.Model(&contact).Association("Tags").Append(&tag)
				log.Info().Str("phone", phone).Str("tag", tagName).Msg("journey added tag to contact")
			}
		}

	case models.ActionUpdateStage:
		// Update contact stage
		funnel := "Default"
		stage := "Novo"
		if f, ok := actionConfig["funnel"].(string); ok && f != "" {
			funnel = f
		}
		if s, ok := actionConfig["stage"].(string); ok && s != "" {
			stage = s
		}
		var contact models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
			contact.Funnel = funnel
			contact.Stage = stage
			m.db.Save(&contact)
			log.Info().Str("phone", phone).Str("funnel", funnel).Str("stage", stage).Msg("journey updated contact stage")
		}

	case models.ActionAddToInbox:
		// Mark contact for inbox review by adding to journey field
		var contact models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
			contact.Journey = "Aguardando atendimento - " + time.Now().Format("02/01/2006 15:04")
			m.db.Save(&contact)
			log.Info().Str("phone", phone).Msg("journey marked contact for inbox review")
		}

	case models.ActionAssignUser:
		// Assign contact to a user
		userID := ""
		if u, ok := actionConfig["user_id"].(string); ok && u != "" {
			userID = u
		} else if email, ok := actionConfig["user_email"].(string); ok && email != "" {
			var user models.User
			if err := m.db.Where("email = ?", email).First(&user).Error; err == nil {
				userID = user.ID.String()
			}
		}
		if userID != "" {
			var contact models.Contact
			if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
				ownerUUID := uuid.MustParse(userID)
				contact.OwnerID = &ownerUUID
				m.db.Save(&contact)
				log.Info().Str("phone", phone).Str("user_id", userID).Msg("journey assigned contact to user")
			}
		}

	default:
		log.Debug().Str("action", string(actionType)).Msg("action not implemented in journey")
	}

	return nil
}

func buildJourneyResponse(journey *models.Journey, fromName, originalMessage string) string {
	if journey.MessageTemplate != "" {
		return strings.ReplaceAll(strings.ReplaceAll(journey.MessageTemplate, "{{name}}", fromName), "{{message}}", originalMessage)
	}

	defaultResponses := []string{
		"Olá " + fromName + "! Recebi sua mensagem. Como posso ajudar?",
		"Oi " + fromName + "! Obrigado por entrar em contato. Em que posso ser útil?",
		"Olá! " + fromName + ", agradecemos o contato. Retornaremos em breve!",
	}
	response := defaultResponses[time.Now().UnixNano()%int64(len(defaultResponses))]

	var rules struct {
		Trigger struct {
			Filter string `json:"filter"`
		} `json:"trigger"`
		Actions []struct {
			Text string `json:"text"`
		} `json:"actions"`
	}

	rulesJSON, _ := json.Marshal(journey.ParsedRules)
	if err := json.Unmarshal(rulesJSON, &rules); err == nil && len(rules.Actions) > 0 && rules.Actions[0].Text != "" {
		response = "Olá " + fromName + "! " + rules.Actions[0].Text
	}

	return response
}
