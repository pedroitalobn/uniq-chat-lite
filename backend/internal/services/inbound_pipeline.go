// Package services — InboundPipeline routes every inbound message from any
// channel (WhatsApp, WABA, Instagram, TikTok, ...) through a single
// channel-agnostic flow: resolve contact → resolve or create conversation →
// persist MessageLog → emit WS event → handoff to DispatchService/AgentRuntime.
//
// Callers from the channel layer (whatsmeow handlers, WABA webhook, IG Graph
// webhook, Taktik poller) should invoke InboundPipeline.Process(...). The
// legacy path that writes MessageLog directly continues to work during the
// migration window — InboundPipeline simply backfills conversation_id.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/storage"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// InboundMessage is the channel-agnostic payload that enters the pipeline.
type InboundMessage struct {
	InstanceID  uuid.UUID
	WorkspaceID uuid.UUID
	ChannelType string // whatsapp|waba|instagram|tiktok|...
	ChannelKey  string // JID normalized (phone@s.whatsapp.net, username, thread_id, ...)
	ThreadKey   string // optional
	FromName    string
	FromAvatar  string
	SenderJID   string // group sender, if applicable
	SenderName  string
	Type        string // text|image|video|audio|document|location|reaction|revoke
	Content     string // JSON or plain text — same contract as MessageLog.Content
	ReplyToID   *uuid.UUID
	OccurredAt  time.Time
}

// Broadcaster is the minimal surface the pipeline needs from the WS hub.
// Hub.Broadcast satisfies this interface without importing hub directly.
type Broadcaster interface {
	Broadcast(event *whatsapp.Event)
}

// InboundPipeline is the channel-agnostic entry point.
type InboundPipeline struct {
	db       *gorm.DB
	hub      Broadcaster
	dispatch *DispatchService
	triggers *TriggerService // optional — wired by SetTriggerService
}

func NewInboundPipeline(db *gorm.DB, hub Broadcaster) *InboundPipeline {
	return &InboundPipeline{db: db, hub: hub, dispatch: NewDispatchService(db)}
}

// SetTriggerService wires the keyword-trigger evaluator into the
// pipeline. Optional — quando nil, triggers ficam inertes.
func (p *InboundPipeline) SetTriggerService(s *TriggerService) {
	p.triggers = s
}

// Process handles a single inbound message. Safe to call concurrently.
// Returns the Conversation and MessageLog that were created/updated.
func (p *InboundPipeline) Process(ctx context.Context, in InboundMessage) (*models.Conversation, *models.MessageLog, error) {
	if in.InstanceID == uuid.Nil {
		return nil, nil, errors.New("inbound: instance_id is required")
	}
	if in.ChannelKey == "" {
		return nil, nil, errors.New("inbound: channel_key is required")
	}
	if in.WorkspaceID == uuid.Nil {
		// resolve from Instance
		var inst models.Instance
		if err := p.db.WithContext(ctx).Select("workspace_id").First(&inst, "id = ?", in.InstanceID).Error; err != nil {
			return nil, nil, err
		}
		if inst.WorkspaceID != nil {
			in.WorkspaceID = *inst.WorkspaceID
		}
	}
	if in.ChannelType == "" {
		var inst models.Instance
		if err := p.db.WithContext(ctx).Select("channel").First(&inst, "id = ?", in.InstanceID).Error; err == nil {
			in.ChannelType = string(inst.Channel)
		}
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = time.Now()
	}

	contact, err := p.resolveContact(ctx, in)
	if err != nil {
		log.Warn().Err(err).Msg("inbound: resolveContact failed — continuing without contact_id")
	}

	conv, created, reopened, err := p.resolveOrCreateConversation(ctx, in, contact)
	if err != nil {
		return nil, nil, err
	}

	// Route newly-created conversations through the dispatcher. Reopens keep
	// their previous assignee when possible; a nil assignee on a reopen falls
	// through to the dispatcher just like a new conversation.
	if (created || (reopened && conv.AssignedUserID == nil)) && p.dispatch != nil {
		if err := p.dispatch.AssignNewConversation(ctx, conv); err != nil {
			log.Warn().Err(err).Str("conv_id", conv.ID.String()).Msg("inbound: dispatch failed")
		}
	}

	msg, err := p.persistMessage(ctx, in, conv)
	if err != nil {
		return conv, nil, err
	}

	p.appendEvent(ctx, conv, models.ConvEventMessage, models.ActorCustomer, nil, &msg.ID, map[string]any{"type": in.Type})

	p.updateDenorm(ctx, conv, in, msg, false)

	p.broadcastConversation(conv, msg, created, reopened)

	// Sprint 8: avalia triggers configurados (autoresponder por keyword).
	// Síncrono pra cooldown ficar correto, mas a Action efetiva (envio
	// de mensagem etc.) roda em goroutine dentro do TriggerService.
	if p.triggers != nil {
		p.triggers.Evaluate(ctx, in, msg)
	}

	return conv, msg, nil
}

// ProcessSavedInbound is the alternate entry used by whatsapp.Manager.SaveMessage:
// the legacy path already persisted the MessageLog, and here we resolve/
// create the Conversation, backfill conversation_id and emit the WS event.
//
// Safe to call concurrently. Idempotent: calling it twice for the same
// MessageLog produces no additional events after the first success (unless
// the conversation_id is nil).
//
// Despacha pra ProcessSavedOutbound quando direction=out — chamadas que
// não distinguem (caminho legacy SaveMessage) podem usar este como entry.
func (p *InboundPipeline) ProcessSavedInbound(ctx context.Context, ml *models.MessageLog) error {
	if ml == nil || ml.ID == uuid.Nil {
		return errors.New("inbound: message log is required")
	}
	if ml.Direction == models.DirectionOut {
		return p.ProcessSavedOutbound(ctx, ml)
	}
	if ml.ConversationID != nil {
		return nil // already attached
	}

	var inst models.Instance
	if err := p.db.WithContext(ctx).First(&inst, "id = ?", ml.InstanceID).Error; err != nil {
		return err
	}
	ws := uuid.Nil
	if inst.WorkspaceID != nil {
		ws = *inst.WorkspaceID
	}

	in := InboundMessage{
		InstanceID:  ml.InstanceID,
		WorkspaceID: ws,
		ChannelType: string(inst.Channel),
		ChannelKey:  ml.ToJID,
		FromName:    ml.ContactName,
		FromAvatar:  ml.ContactAvatar,
		SenderJID:   ml.SenderJID,
		SenderName:  ml.SenderName,
		Type:        ml.Type,
		Content:     ml.Content,
		ReplyToID:   ml.ReplyToID,
		OccurredAt:  ml.CreatedAt,
	}

	contact, err := p.resolveContact(ctx, in)
	if err != nil {
		log.Warn().Err(err).Str("ml_id", ml.ID.String()).Msg("inbound: resolveContact failed")
	}
	conv, created, reopened, err := p.resolveOrCreateConversation(ctx, in, contact)
	if err != nil {
		return err
	}

	// Route newly-created / newly-reopened conversations through the dispatcher.
	if (created || (reopened && conv.AssignedUserID == nil)) && p.dispatch != nil {
		if err := p.dispatch.AssignNewConversation(ctx, conv); err != nil {
			log.Warn().Err(err).Str("conv_id", conv.ID.String()).Msg("inbound(saved): dispatch failed")
		}
	}

	// Backfill the existing MessageLog with conversation_id (plus workspace
	// if it was missing) instead of inserting another row.
	updates := map[string]any{"conversation_id": conv.ID}
	if ml.WorkspaceID == nil && ws != uuid.Nil {
		updates["workspace_id"] = ws
	}
	p.db.WithContext(ctx).Model(&models.MessageLog{}).Where("id = ?", ml.ID).Updates(updates)
	ml.ConversationID = &conv.ID
	if ml.WorkspaceID == nil && ws != uuid.Nil {
		wsCopy := ws
		ml.WorkspaceID = &wsCopy
	}

	p.appendEvent(ctx, conv, models.ConvEventMessage, models.ActorCustomer, nil, &ml.ID, map[string]any{"type": ml.Type})
	p.updateDenorm(ctx, conv, in, ml, false)
	p.broadcastConversation(conv, ml, created, reopened)
	return nil
}

// ProcessSavedOutbound liga ao Conversation uma mensagem outbound já
// persistida — caso típico: dono da instância manda mensagem pelo
// WhatsApp Mobile/Desktop. O whatsmeow recebe events.Message com
// IsFromMe=true, o handler chama Manager.SaveMessage que cria
// MessageLog com direction=out, mas SEM conversation_id. Sem essa rota
// a mensagem ficava órfã (não aparecia no inbox da plataforma).
//
// Comportamento:
//   - Resolve/cria Conversation pra (workspace, instance, channel_key)
//     usando o `to_jid` como key (destino da mensagem)
//   - Atualiza denorm com fromAgent=true (last_agent_msg_at, zera
//     agent_unread_count — o "agente" mandou, leu)
//   - Emite WS pro frontend mostrar imediatamente
//   - NÃO dispara journey/dispatch (operações são pra inbound)
//   - NÃO incrementa unread_count (foi nóis que mandou)
func (p *InboundPipeline) ProcessSavedOutbound(ctx context.Context, ml *models.MessageLog) error {
	if ml == nil || ml.ID == uuid.Nil {
		return errors.New("outbound: message log is required")
	}
	if ml.ConversationID != nil {
		return nil // já tem conversation_id (mandado via API direto, OK)
	}

	var inst models.Instance
	if err := p.db.WithContext(ctx).First(&inst, "id = ?", ml.InstanceID).Error; err != nil {
		return err
	}
	ws := uuid.Nil
	if inst.WorkspaceID != nil {
		ws = *inst.WorkspaceID
	}

	in := InboundMessage{
		InstanceID:  ml.InstanceID,
		WorkspaceID: ws,
		ChannelType: string(inst.Channel),
		ChannelKey:  ml.ToJID,
		FromName:    ml.ContactName,
		FromAvatar:  ml.ContactAvatar,
		SenderJID:   ml.SenderJID,
		SenderName:  ml.SenderName,
		Type:        ml.Type,
		Content:     ml.Content,
		ReplyToID:   ml.ReplyToID,
		OccurredAt:  ml.CreatedAt,
	}

	contact, err := p.resolveContact(ctx, in)
	if err != nil {
		log.Warn().Err(err).Str("ml_id", ml.ID.String()).Msg("outbound: resolveContact failed")
	}
	conv, created, reopened, err := p.resolveOrCreateConversation(ctx, in, contact)
	if err != nil {
		return err
	}

	updates := map[string]any{"conversation_id": conv.ID}
	if ml.WorkspaceID == nil && ws != uuid.Nil {
		updates["workspace_id"] = ws
	}
	p.db.WithContext(ctx).Model(&models.MessageLog{}).Where("id = ?", ml.ID).Updates(updates)
	ml.ConversationID = &conv.ID
	if ml.WorkspaceID == nil && ws != uuid.Nil {
		wsCopy := ws
		ml.WorkspaceID = &wsCopy
	}

	p.appendEvent(ctx, conv, models.ConvEventMessage, models.ActorUser, nil, &ml.ID, map[string]any{"type": ml.Type, "source": "external"})
	p.updateDenorm(ctx, conv, in, ml, true) // fromAgent=true
	p.broadcastConversation(conv, ml, created, reopened)
	return nil
}

// -- steps ---------------------------------------------------------------

func (p *InboundPipeline) resolveContact(ctx context.Context, in InboundMessage) (*models.Contact, error) {
	if in.WorkspaceID == uuid.Nil {
		return nil, nil
	}
	phone := extractPhone(in.ChannelKey)

	var c models.Contact
	query := p.db.WithContext(ctx).Where("workspace_id = ?", in.WorkspaceID)

	// Prefer an exact external_id match (normalized channel_key)
	if err := query.Where("external_id = ?", in.ChannelKey).First(&c).Error; err == nil {
		return &c, nil
	}
	// Fallback: match by phone for WhatsApp-like channels
	if phone != "" {
		if err := p.db.WithContext(ctx).
			Where("workspace_id = ? AND phone = ?", in.WorkspaceID, phone).
			First(&c).Error; err == nil {
			// Populate external_id if missing
			if c.ExternalID == "" {
				p.db.WithContext(ctx).Model(&c).Update("external_id", in.ChannelKey)
			}
			return &c, nil
		}
	}

	// Create
	var inst models.Instance
	p.db.WithContext(ctx).First(&inst, "id = ?", in.InstanceID)

	name := in.FromName
	if name == "" {
		name = phone
	}
	if name == "" {
		name = in.ChannelKey
	}

	src := models.ContactSource(in.ChannelType)
	if _, ok := models.ContactSourceMeta[src]; !ok {
		src = models.SourceManual
	}

	newContact := models.Contact{
		UserID:      inst.UserID,
		WorkspaceID: &in.WorkspaceID,
		Name:        name,
		Phone:       phone,
		AvatarURL:   in.FromAvatar,
		Source:      src,
		InstanceID:  &in.InstanceID,
		ExternalID:  in.ChannelKey,
	}
	if err := p.db.WithContext(ctx).Create(&newContact).Error; err != nil {
		return nil, err
	}
	return &newContact, nil
}

func (p *InboundPipeline) resolveOrCreateConversation(ctx context.Context, in InboundMessage, contact *models.Contact) (conv *models.Conversation, created bool, reopened bool, err error) {
	var existing models.Conversation
	q := p.db.WithContext(ctx).
		Where("workspace_id = ? AND instance_id = ? AND channel_key = ?", in.WorkspaceID, in.InstanceID, in.ChannelKey).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).
		Order("updated_at DESC")
	if err := q.First(&existing).Error; err == nil {
		// Conversation is live — unsnooze if necessary
		if existing.Status == models.ConversationStatusSnoozed {
			existing.Status = models.ConversationStatusOpen
			existing.SnoozedUntil = nil
			p.db.WithContext(ctx).Save(&existing)
			p.appendEvent(ctx, &existing, models.ConvEventUnsnoozed, models.ActorSystem, nil, nil, map[string]any{"trigger": "inbound"})
		}
		return &existing, false, false, nil
	}

	// Check for a recently-closed conversation eligible for auto-reopen
	reopenWindow := 120 * time.Minute // default; Queue-specific window overrides in Phase 2
	cutoff := in.OccurredAt.Add(-reopenWindow)
	var recent models.Conversation
	err = p.db.WithContext(ctx).
		Where("workspace_id = ? AND instance_id = ? AND channel_key = ?", in.WorkspaceID, in.InstanceID, in.ChannelKey).
		Where("status IN ?", []models.ConversationStatus{models.ConversationStatusClosed, models.ConversationStatusResolved}).
		Where("(closed_at IS NOT NULL AND closed_at >= ?) OR (resolved_at IS NOT NULL AND resolved_at >= ?)", cutoff, cutoff).
		Order("COALESCE(closed_at, resolved_at) DESC").
		First(&recent).Error
	if err == nil {
		now := in.OccurredAt
		recent.Status = models.ConversationStatusOpen
		recent.ReopenCount++
		recent.ReopenedAt = &now
		recent.ClosedAt = nil
		recent.ResolvedAt = nil
		if contact != nil {
			recent.ContactID = &contact.ID
		}
		if err := p.db.WithContext(ctx).Save(&recent).Error; err != nil {
			return nil, false, false, err
		}
		p.appendEvent(ctx, &recent, models.ConvEventReopened, models.ActorSystem, nil, nil, map[string]any{"reason": "inbound_within_window"})
		return &recent, false, true, nil
	}

	// Create fresh.
	// IsBotActive is true by default so the legacy InstanceAgent-per-instance
	// behavior is preserved end-to-end. Human handoff flips this to false via
	// the /v1/conversations/:id/bot/disable endpoint.
	newConv := models.Conversation{
		WorkspaceID: in.WorkspaceID,
		InstanceID:  in.InstanceID,
		ChannelType: in.ChannelType,
		ChannelKey:  in.ChannelKey,
		ThreadKey:   in.ThreadKey,
		Status:      models.ConversationStatusOpen,
		Priority:    models.ConversationPriorityNormal,
		IsBotActive: true,
	}
	if contact != nil {
		newConv.ContactID = &contact.ID
		if contact.DefaultQueueID != nil {
			newConv.QueueID = contact.DefaultQueueID
		}
	}
	if err := p.db.WithContext(ctx).Create(&newConv).Error; err != nil {
		return nil, false, false, err
	}
	p.appendEvent(ctx, &newConv, models.ConvEventStatusChanged, models.ActorSystem, nil, nil, map[string]any{"to": "open", "reason": "created_from_inbound"})
	return &newConv, true, false, nil
}

func (p *InboundPipeline) persistMessage(ctx context.Context, in InboundMessage, conv *models.Conversation) (*models.MessageLog, error) {
	ws := in.WorkspaceID
	msg := models.MessageLog{
		InstanceID:     in.InstanceID,
		WorkspaceID:    &ws,
		ConversationID: &conv.ID,
		Direction:      models.DirectionIn,
		Type:           in.Type,
		ToJID:          in.ChannelKey,
		ContactName:    in.FromName,
		ContactAvatar:  in.FromAvatar,
		SenderJID:      in.SenderJID,
		SenderName:     in.SenderName,
		Content:        in.Content,
		Status:         models.MessageStatusDelivered,
		ReplyToID:      in.ReplyToID,
		CreatedAt:      in.OccurredAt,
	}
	if err := p.db.WithContext(ctx).Create(&msg).Error; err != nil {
		return nil, err
	}
	return &msg, nil
}

func (p *InboundPipeline) updateDenorm(ctx context.Context, conv *models.Conversation, in InboundMessage, msg *models.MessageLog, fromAgent bool) {
	preview := buildPreview(in.Type, in.Content)
	updates := map[string]any{
		"last_message_at":      in.OccurredAt,
		"last_message_preview": preview,
		"last_message_type":    in.Type,
		"last_message_from_me": fromAgent,
		"message_count":        gorm.Expr("message_count + 1"),
	}
	if fromAgent {
		updates["last_agent_msg_at"] = in.OccurredAt
		updates["agent_unread_count"] = 0
	} else {
		updates["last_customer_msg_at"] = in.OccurredAt
		updates["unread_count"] = gorm.Expr("unread_count + 1")
		updates["agent_unread_count"] = gorm.Expr("agent_unread_count + 1")
	}
	p.db.WithContext(ctx).Model(&models.Conversation{}).Where("id = ?", conv.ID).Updates(updates)
}

func (p *InboundPipeline) appendEvent(ctx context.Context, conv *models.Conversation, t models.ConversationEventType, actor models.ConversationActor, actorUserID *uuid.UUID, messageLogID *uuid.UUID, payload map[string]any) {
	var payloadJSON string
	if payload != nil {
		if b, err := json.Marshal(payload); err == nil {
			payloadJSON = string(b)
		}
	}
	evt := models.ConversationEvent{
		ConversationID: conv.ID,
		WorkspaceID:    conv.WorkspaceID,
		ActorType:      actor,
		ActorUserID:    actorUserID,
		EventType:      t,
		Payload:        payloadJSON,
		MessageLogID:   messageLogID,
		CreatedAt:      time.Now(),
	}
	if err := p.db.WithContext(ctx).Create(&evt).Error; err != nil {
		log.Warn().Err(err).Str("event_type", string(t)).Msg("inbound: failed to append conversation event")
	}
}

func (p *InboundPipeline) broadcastConversation(conv *models.Conversation, msg *models.MessageLog, created, reopened bool) {
	if p.hub == nil {
		return
	}
	topic := "conversation.message"
	if created {
		topic = "conversation.created"
	} else if reopened {
		topic = "conversation.reopened"
	}
	// Resolve signed URL no payload do WS push antes de enviar pro front.
	// Sem isso, mensagens recém-chegadas via push trazem URL pública (403
	// em bucket private) — só funcionariam após o front refetchar o
	// timeline. Cópia local da msg pra não mexer no objeto que vai pro DB.
	msgCopy := *msg
	msgCopy.Content = storage.ResolveMediaURLs(context.Background(), msgCopy.Content)
	convCopy := *conv
	convCopy.LastMessagePreview = storage.ResolveMediaURLs(context.Background(), convCopy.LastMessagePreview)
	p.hub.Broadcast(&whatsapp.Event{
		Type:      topic,
		Instance:  conv.InstanceID.String(),
		Workspace: conv.WorkspaceID.String(),
		Payload: map[string]any{
			"conversation": &convCopy,
			"message":      &msgCopy,
		},
	})
}

// -- helpers ------------------------------------------------------------

// extractPhone peels the phone-number portion off a JID like
// 5511999999999@s.whatsapp.net → 5511999999999. Returns the raw input for
// non-phone channels (Instagram/TikTok usernames, etc.).
func extractPhone(channelKey string) string {
	if channelKey == "" {
		return ""
	}
	if i := strings.IndexByte(channelKey, '@'); i > 0 {
		return channelKey[:i]
	}
	return channelKey
}

// buildPreview generates a short preview string for the Inbox list. For text
// messages it takes up to 280 chars. For media, it falls back to a
// human-readable label.
func buildPreview(msgType, content string) string {
	switch msgType {
	case "image":
		return "📷 Imagem"
	case "video":
		return "🎬 Vídeo"
	case "gif":
		return "🎞 GIF"
	case "audio":
		return "🎤 Áudio"
	case "document":
		return "📎 Documento"
	case "location":
		return "📍 Localização"
	case "reaction":
		return "👍 Reação"
	case "revoke":
		return "Mensagem apagada"
	}
	// Try to unwrap JSON-encoded {"text": "..."} payload when present
	if strings.HasPrefix(content, "{") {
		var payload struct {
			Text    string `json:"text"`
			Caption string `json:"caption"`
		}
		if json.Unmarshal([]byte(content), &payload) == nil {
			if payload.Text != "" {
				content = payload.Text
			} else if payload.Caption != "" {
				content = payload.Caption
			}
		}
	}
	content = strings.TrimSpace(content)
	if len(content) > 280 {
		return content[:280]
	}
	return content
}
