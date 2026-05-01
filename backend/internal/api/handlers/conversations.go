// Package handlers — Conversations handler exposes the ticketing REST API.
// Routes are registered under /v1/conversations (see router.go) and protected
// by RequireWorkspacePermission with tickets:* / notes:* keys.
package handlers

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/outbound"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/storage"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ConversationHandler struct {
	db       *gorm.DB
	manager  *whatsapp.Manager
	outbound *outbound.Registry
	pipeline *services.InboundPipeline
	llm      *services.LLMService
}

func NewConversationHandler(
	db *gorm.DB,
	manager *whatsapp.Manager,
	outboundReg *outbound.Registry,
	pipeline *services.InboundPipeline,
	llm *services.LLMService,
) *ConversationHandler {
	return &ConversationHandler{db: db, manager: manager, outbound: outboundReg, pipeline: pipeline, llm: llm}
}

// -- list -------------------------------------------------------------------

// Health GET /v1/conversations/health
// Cheap sanity check the frontend uses to distinguish "route missing / old
// deploy" (404) from "route exists but handler blew up" (500). Uses the
// GORM Migrator — não faz COUNT/SELECT complexo (evita o famoso SQLSTATE
// 42703 quando alguém escreve .Select("1")...).
func (h *ConversationHandler) Health(c *fiber.Ctx) error {
	if !h.db.Migrator().HasTable(&models.Conversation{}) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"ok":    false,
			"stage": "conversations_table",
			"error": "tabela conversations ausente — rode AutoMigrate",
		})
	}
	return c.JSON(fiber.Map{"ok": true, "handler": "conversations", "v": 2})
}

// List GET /v1/conversations
// Query: status, channel, queue_id, assigned_user_id=me|<uuid>, contact_id,
//        priority, is_archived, q (search in subject/preview), cursor, limit
func (h *ConversationHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)

	// Defensive: workspace_id is required; RequireWorkspacePermission should
	// have set it, but super-admin bypass may leave it empty if the client
	// forgot the X-Workspace-ID header. Return an explicit 400 instead of
	// silently matching everything.
	if ws == uuid.Nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "X-Workspace-ID é obrigatório (ou ?workspace_id= na query)",
		})
	}

	q := h.db.Model(&models.Conversation{}).Where("workspace_id = ?", ws)

	if s := c.Query("status"); s != "" {
		q = q.Where("status IN ?", strings.Split(s, ","))
	}
	if ch := c.Query("channel"); ch != "" {
		// comma-separated multi-select: ?channel=whatsapp,instagram
		channels := strings.Split(ch, ",")
		cleaned := make([]string, 0, len(channels))
		for _, v := range channels {
			v = strings.TrimSpace(v)
			if v != "" {
				cleaned = append(cleaned, v)
			}
		}
		if len(cleaned) == 1 {
			q = q.Where("channel_type = ?", cleaned[0])
		} else if len(cleaned) > 1 {
			q = q.Where("channel_type IN ?", cleaned)
		}
	}
	if iid := c.Query("instance_id"); iid != "" {
		// comma-separated multi-select: ?instance_id=uuid1,uuid2
		raw := strings.Split(iid, ",")
		ids := make([]uuid.UUID, 0, len(raw))
		for _, v := range raw {
			v = strings.TrimSpace(v)
			if v == "" {
				continue
			}
			if id, err := uuid.Parse(v); err == nil {
				ids = append(ids, id)
			}
		}
		if len(ids) == 1 {
			q = q.Where("instance_id = ?", ids[0])
		} else if len(ids) > 1 {
			q = q.Where("instance_id IN ?", ids)
		}
	}
	if qid := c.Query("queue_id"); qid != "" {
		if qid == "none" {
			q = q.Where("queue_id IS NULL")
		} else if id, err := uuid.Parse(qid); err == nil {
			q = q.Where("queue_id = ?", id)
		}
	}
	if au := c.Query("assigned_user_id"); au != "" {
		switch au {
		case "me":
			q = q.Where("assigned_user_id = ?", userID)
		case "none":
			q = q.Where("assigned_user_id IS NULL")
		default:
			if id, err := uuid.Parse(au); err == nil {
				q = q.Where("assigned_user_id = ?", id)
			}
		}
	}
	if cid := c.Query("contact_id"); cid != "" {
		if id, err := uuid.Parse(cid); err == nil {
			q = q.Where("contact_id = ?", id)
		}
	}
	if pr := c.Query("priority"); pr != "" {
		q = q.Where("priority = ?", pr)
	}
	if arc := c.Query("is_archived"); arc != "" {
		q = q.Where("is_archived = ?", arc == "true")
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		pattern := "%" + search + "%"
		q = q.Where("subject ILIKE ? OR last_message_preview ILIKE ?", pattern, pattern)
	}

	limit := atoiDefault(c.Query("limit"), 50)
	if limit < 1 || limit > 200 {
		limit = 50
	}

	var total int64
	q.Count(&total)

	var items []models.Conversation
	// Preload Instance pra que o front mostre o nome da instância no card
	// e no header sem precisar de query extra. Select só campos seguros
	// (não vaza Token de instance).
	err := q.Preload("Contact").Preload("AssignedUser").
		Preload("Department", func(tx *gorm.DB) *gorm.DB { return tx.Select("id, name, color") }).
		Preload("Team", func(tx *gorm.DB) *gorm.DB { return tx.Select("id, name") }).
		Preload("Queue", func(tx *gorm.DB) *gorm.DB { return tx.Select("id, name") }).
		Preload("Instance", func(tx *gorm.DB) *gorm.DB {
			return tx.Select("id, name, channel, phone_number")
		}).
		Order("is_pinned DESC, COALESCE(last_message_at, updated_at) DESC").
		Limit(limit + 1).
		Offset(atoiDefault(c.Query("offset"), 0)).
		Find(&items).Error
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	hasMore := false
	if len(items) > limit {
		hasMore = true
		items = items[:limit]
	}

	return c.JSON(fiber.Map{
		"items":    items,
		"total":    total,
		"has_more": hasMore,
		"limit":    limit,
	})
}

// Count GET /v1/conversations/count
// Returns counters for badges: open, pending, snoozed, assigned_to_me, unassigned.
func (h *ConversationHandler) Count(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)

	type bucket struct {
		Key   string
		Where func(*gorm.DB) *gorm.DB
	}
	buckets := []bucket{
		{"open", func(q *gorm.DB) *gorm.DB { return q.Where("status = ?", models.ConversationStatusOpen) }},
		{"pending", func(q *gorm.DB) *gorm.DB { return q.Where("status = ?", models.ConversationStatusPending) }},
		{"snoozed", func(q *gorm.DB) *gorm.DB { return q.Where("status = ?", models.ConversationStatusSnoozed) }},
		{"resolved", func(q *gorm.DB) *gorm.DB { return q.Where("status = ?", models.ConversationStatusResolved) }},
		{"closed", func(q *gorm.DB) *gorm.DB { return q.Where("status = ?", models.ConversationStatusClosed) }},
		{"mine_open", func(q *gorm.DB) *gorm.DB {
			return q.Where("status = ? AND assigned_user_id = ?", models.ConversationStatusOpen, userID)
		}},
		{"unassigned_open", func(q *gorm.DB) *gorm.DB {
			return q.Where("status IN ? AND assigned_user_id IS NULL", []models.ConversationStatus{models.ConversationStatusOpen, models.ConversationStatusPending})
		}},
	}

	out := fiber.Map{}
	for _, b := range buckets {
		var n int64
		b.Where(h.db.Model(&models.Conversation{}).Where("workspace_id = ?", ws)).Count(&n)
		out[b.Key] = n
	}
	return c.JSON(out)
}

// -- single -----------------------------------------------------------------

func (h *ConversationHandler) Get(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Preload("Contact").Preload("AssignedUser").
		Preload("Department", func(tx *gorm.DB) *gorm.DB { return tx.Select("id, name, color") }).
		Preload("Team", func(tx *gorm.DB) *gorm.DB { return tx.Select("id, name") }).
		Preload("Queue", func(tx *gorm.DB) *gorm.DB { return tx.Select("id, name") }).
		Preload("Instance", func(tx *gorm.DB) *gorm.DB {
			return tx.Select("id, name, channel, phone_number")
		})
	conv, err := h.resolveConvByIDOrKey(c.Params("id"), ws, q)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	// last_message_preview pode conter JSON com URL pública de mídia.
	// Resolve pra signed URL antes de retornar.
	conv.LastMessagePreview = storage.ResolveMediaURLs(c.Context(), conv.LastMessagePreview)
	return c.JSON(conv)
}

// Timeline GET /v1/conversations/:id/timeline
// Merges MessageLog (messages) + ConversationEvent + ConversationNote into a
// chronological feed.
func (h *ConversationHandler) Timeline(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	conv, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	id := conv.ID

	limit := atoiDefault(c.Query("limit"), 100)
	if limit > 500 {
		limit = 500
	}
	before := c.Query("before")

	type entry = timelineEntry

	var messages []models.MessageLog
	msgQ := h.db.Where("conversation_id = ?", id).Order("created_at DESC").Limit(limit)
	if before != "" {
		if t, err := time.Parse(time.RFC3339, before); err == nil {
			msgQ = msgQ.Where("created_at < ?", t)
		}
	}
	msgQ.Find(&messages)

	var notes []models.ConversationNote
	h.db.Where("conversation_id = ?", id).Order("created_at DESC").Limit(limit).Preload("Author").Find(&notes)

	var events []models.ConversationEvent
	h.db.Where("conversation_id = ? AND event_type <> ?", id, models.ConvEventMessage).
		Order("created_at DESC").Limit(limit).Find(&events)

	// Resolve signed URLs pra mídias antes de retornar. Bucket private
	// (Hetzner Object Storage / R2 com private) precisa de URL assinada
	// pra renderizar <img>/<audio>/<video>. Pública seria 403.
	for i := range messages {
		messages[i].Content = storage.ResolveMediaURLs(c.Context(), messages[i].Content)
	}

	// Preload reply_to snapshots em batch. Coleta todos os reply_to_id
	// únicos, busca em uma query, monta map e atribui — evita N+1.
	h.populateReplyTo(c.Context(), messages)

	out := make([]entry, 0, len(messages)+len(notes)+len(events))
	for i := range messages {
		m := &messages[i]
		out = append(out, entry{Kind: "message", At: m.CreatedAt, ID: m.ID, Payload: m})
	}
	for i := range notes {
		n := &notes[i]
		out = append(out, entry{Kind: "note", At: n.CreatedAt, ID: n.ID, Payload: n})
	}
	for i := range events {
		e := &events[i]
		out = append(out, entry{Kind: "event", At: e.CreatedAt, ID: e.ID, Payload: e})
	}
	// sort desc by At — insertion order is already approx; do an in-memory stable sort
	sortEntriesDesc(out)

	return c.JSON(fiber.Map{"items": out})
}

// -- mutations --------------------------------------------------------------

// Patch PATCH /v1/conversations/:id
// Accepts: subject, priority, sub_status, is_archived, funnel_id, stage_id
func (h *ConversationHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convPtr, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	conv := *convPtr
	id := conv.ID
	_ = id

	var body struct {
		Subject    *string `json:"subject"`
		Priority   *string `json:"priority"`
		SubStatus  *string `json:"sub_status"`
		IsArchived *bool   `json:"is_archived"`
		IsPinned   *bool   `json:"is_pinned"`
		IsMuted    *bool   `json:"is_muted"`
		FunnelID   *string `json:"funnel_id"`
		StageID    *string `json:"stage_id"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]any{}
	if body.Subject != nil {
		updates["subject"] = *body.Subject
	}
	if body.Priority != nil {
		updates["priority"] = *body.Priority
		h.appendEvent(&conv, models.ConvEventPriorityChanged, middleware.GetCurrentUserID(c), map[string]any{"to": *body.Priority})
	}
	if body.SubStatus != nil {
		updates["sub_status"] = *body.SubStatus
	}
	if body.IsArchived != nil {
		updates["is_archived"] = *body.IsArchived
	}
	if body.IsPinned != nil {
		updates["is_pinned"] = *body.IsPinned
	}
	if body.IsMuted != nil {
		updates["is_muted"] = *body.IsMuted
	}
	if body.FunnelID != nil {
		if *body.FunnelID == "" {
			updates["funnel_id"] = nil
		} else if fid, err := uuid.Parse(*body.FunnelID); err == nil {
			updates["funnel_id"] = fid
		}
	}
	if body.StageID != nil {
		if *body.StageID == "" {
			updates["stage_id"] = nil
		} else if sid, err := uuid.Parse(*body.StageID); err == nil {
			updates["stage_id"] = sid
		}
	}
	if len(updates) > 0 {
		h.db.Model(&conv).Updates(updates)
	}
	h.db.Where("id = ?", id).First(&conv)
	h.broadcast(&conv, "conversation.updated", nil)
	return c.JSON(conv)
}

// SendMessage POST /v1/conversations/:id/messages
// Body: { body?, type?, media_url?, media_mime?, caption?, filename? }
//
//   - text:     { body: "olá" }
//   - image:    { type: "image", media_url, media_mime, caption? }
//   - audio:    { type: "audio", media_url, media_mime }
//   - video:    { type: "video", media_url, media_mime, caption? }
//   - document: { type: "document", media_url, media_mime, filename? }
func (h *ConversationHandler) SendMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convResolved, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	id := convResolved.ID
	var body struct {
		Body               string           `json:"body"`
		Type               string           `json:"type"`
		MediaURL           string           `json:"media_url"`
		MediaMime          string           `json:"media_mime"`
		Caption            string           `json:"caption"`
		Filename           string           `json:"filename"`
		TemplateName       string           `json:"template_name"`
		TemplateLanguage   string           `json:"template_language"`
		TemplateComponents []map[string]any `json:"template_components"`
		// ReplyToMessageID — id INTERNO da MessageLog citada. Backend traduz
		// pra external_id (stanza_id WA, msg_id WABA) antes de enviar.
		ReplyToMessageID string `json:"reply_to_message_id"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	msgType := body.Type
	if msgType == "" {
		msgType = "text"
	}
	isMedia := msgType == "image" || msgType == "audio" || msgType == "video" || msgType == "document"
	isTemplate := msgType == "template"
	if isMedia && strings.TrimSpace(body.MediaURL) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "media_url é obrigatório para " + msgType})
	}
	if isTemplate && strings.TrimSpace(body.TemplateName) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "template_name é obrigatório para type=template"})
	}
	if !isMedia && !isTemplate && strings.TrimSpace(body.Body) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body é obrigatório"})
	}

	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}

	// Disable automatic bot replies once a human has written in the conversation.
	// This implements the "handoff" rule: agent intervention stops the bot.
	if conv.IsBotActive {
		h.db.Model(&conv).Update("is_bot_active", false)
		actorID := middleware.GetCurrentUserID(c)
		h.db.Create(&models.ConversationEvent{
			ConversationID: conv.ID,
			WorkspaceID:    ws,
			ActorType:      models.ActorUser,
			ActorUserID:    &actorID,
			EventType:      models.ConvEventBotHandoff,
			Payload:        `{"trigger":"agent_reply"}`,
		})
	}

	userID := middleware.GetCurrentUserID(c)
	wsCopy := ws
	// Persist outbound MessageLog. Para texto o content é o body em JSON
	// string. Para mídia serializamos { url, mime_type, filename, caption }
	// para o MessageBubble do frontend renderizar exatamente igual ao
	// formato recebido do inbound (parseMessageContent aceita os dois).
	var contentStr string
	switch {
	case isMedia:
		payload := map[string]any{
			"url":       body.MediaURL,
			"mime_type": body.MediaMime,
		}
		if body.Filename != "" {
			payload["filename"] = body.Filename
		}
		if body.Caption != "" {
			payload["caption"] = body.Caption
		} else if body.Body != "" {
			payload["caption"] = body.Body
		}
		b, _ := json.Marshal(payload)
		contentStr = string(b)
	case isTemplate:
		payload := map[string]any{
			"template_name":     body.TemplateName,
			"template_language": body.TemplateLanguage,
			"components":        body.TemplateComponents,
		}
		b, _ := json.Marshal(payload)
		contentStr = string(b)
	default:
		b, _ := json.Marshal(body.Body)
		contentStr = string(b)
	}
	// Reply context — se especificado, busca a MessageLog citada pra
	// extrair external_message_id + sender_jid + texto (necessários pra
	// ContextInfo no canal). Texto é crítico: sem ele, o WhatsApp mobile
	// renderiza como msg nova em vez de quote.
	var replyToExternalID, replyToParticipant, replyToText string
	var replyToInternalID *uuid.UUID
	if body.ReplyToMessageID != "" {
		if rid, err := uuid.Parse(body.ReplyToMessageID); err == nil {
			var quoted models.MessageLog
			if err := h.db.
				Where("id = ? AND conversation_id = ?", rid, conv.ID).
				First(&quoted).Error; err == nil {
				replyToInternalID = &quoted.ID
				replyToExternalID = quoted.ExternalMessageID
				replyToParticipant = quoted.SenderJID
				replyToText = extractQuotedDisplayText(quoted.Content, quoted.Type)
			}
		}
	}

	logRow := models.MessageLog{
		InstanceID:     conv.InstanceID,
		WorkspaceID:    &wsCopy,
		UserID:         &userID,
		ConversationID: &conv.ID,
		Direction:      models.DirectionOut,
		Type:           msgType,
		ToJID:          conv.ChannelKey,
		Content:        contentStr,
		Status:         models.MessageStatusPending,
		ReplyToID:      replyToInternalID,
	}
	if err := h.db.Create(&logRow).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Deliver via the outbound Registry — routes per channel.
	sendStatus := models.MessageStatusSent
	sendErrStr := ""
	if h.outbound != nil {
		var inst models.Instance
		if err := h.db.First(&inst, "id = ?", conv.InstanceID).Error; err == nil {
			ctx, cancel := context.WithTimeout(c.UserContext(), 60*time.Second)
			defer cancel()
			res, sendErr := h.outbound.Send(ctx, &inst, outbound.OutboundMessage{
				To:                 conv.ChannelKey,
				Type:               msgType,
				Body:               body.Body,
				MediaURL:           body.MediaURL,
				MediaMime:          body.MediaMime,
				Caption:            body.Caption,
				Filename:           body.Filename,
				TemplateName:       body.TemplateName,
				TemplateLanguage:   body.TemplateLanguage,
				TemplateComponents: body.TemplateComponents,
				ReplyToExternalID:  replyToExternalID,
				ReplyToParticipant: replyToParticipant,
				ReplyToText:        replyToText,
			})
			if sendErr != nil {
				sendStatus = models.MessageStatusFailed
				sendErrStr = sendErr.Error()
			} else if res != nil && res.ExternalID != "" {
				// Salva external_id retornado pelo canal pra futuras correlações
				// (receipts, reply, edit, revoke).
				h.db.Model(&logRow).Update("external_message_id", res.ExternalID)
			}
		} else {
			sendStatus = models.MessageStatusFailed
			sendErrStr = "instância não encontrada"
		}
	}
	updates := map[string]any{"status": sendStatus}
	if sendErrStr != "" {
		// Append error details into content alongside the original payload so
		// the agent UI can show why it failed without touching schema.
		updates["content"] = contentStr + " /* err: " + truncate(sendErrStr, 200) + " */"
	}
	h.db.Model(&logRow).Updates(updates)

	// Denormalizations: preview do último envio. Texto mostra o body; mídia
	// mostra um label legível consistente com o render do front.
	now := time.Now()
	preview := body.Body
	if isMedia {
		switch msgType {
		case "image":
			preview = "📷 Imagem"
		case "video":
			preview = "🎬 Vídeo"
		case "audio":
			preview = "🎤 Áudio"
		case "document":
			if body.Filename != "" {
				preview = "📎 " + body.Filename
			} else {
				preview = "📎 Documento"
			}
		}
		if body.Caption != "" {
			preview = preview + " · " + body.Caption
		}
	} else if isTemplate {
		preview = "📨 Template · " + body.TemplateName
	}
	if len(preview) > 280 {
		preview = preview[:280]
	}
	h.db.Model(&conv).Updates(map[string]any{
		"last_message_at":      now,
		"last_message_preview": preview,
		"last_message_type":    msgType,
		"last_message_from_me": true,
		"last_agent_msg_at":    now,
		"agent_unread_count":   0,
		"message_count":        gorm.Expr("message_count + 1"),
	})
	if conv.FirstResponseAt == nil {
		h.db.Model(&conv).Update("first_response_at", now)
	}

	// Message event in the timeline
	h.db.Create(&models.ConversationEvent{
		ConversationID: conv.ID,
		WorkspaceID:    ws,
		ActorType:      models.ActorUser,
		ActorUserID:    &userID,
		EventType:      models.ConvEventMessage,
		MessageLogID:   &logRow.ID,
		Payload:        `{"direction":"out","type":"` + msgType + `"}`,
	})

	h.broadcast(&conv, "conversation.message", map[string]any{"message": logRow})
	return c.Status(fiber.StatusCreated).JSON(logRow)
}

// PatchMessage PATCH /v1/conversations/:id/messages/:msgId
// Body: { is_pinned?, is_favorite?, is_archived?, is_deleted? }
// Permite fixar, favoritar, arquivar mensagens individuais. Os flags
// existem no MessageLog desde a fase legacy — aqui só expomos um endpoint
// integrado ao novo fluxo de Conversation.
func (h *ConversationHandler) PatchMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	msgID, err := uuid.Parse(c.Params("msgId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgId inválido"})
	}
	// Verificar que a mensagem pertence a uma conversation desse workspace.
	var cnt int64
	h.db.Model(&models.MessageLog{}).
		Joins("JOIN conversations c ON c.id = message_logs.conversation_id").
		Where("message_logs.id = ? AND c.workspace_id = ? AND c.id = ?", msgID, ws, convID).
		Count(&cnt)
	if cnt == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mensagem não encontrada"})
	}

	var body struct {
		IsPinned   *bool `json:"is_pinned"`
		IsFavorite *bool `json:"is_favorite"`
		IsArchived *bool `json:"is_archived"`
		IsDeleted  *bool `json:"is_deleted"`
	}
	c.BodyParser(&body)
	updates := map[string]any{}
	if body.IsPinned != nil {
		updates["is_pinned"] = *body.IsPinned
	}
	if body.IsFavorite != nil {
		updates["is_favorite"] = *body.IsFavorite
	}
	if body.IsArchived != nil {
		updates["is_archived"] = *body.IsArchived
	}
	if body.IsDeleted != nil {
		updates["is_deleted"] = *body.IsDeleted
	}
	if len(updates) == 0 {
		return c.JSON(fiber.Map{"ok": true, "changed": 0})
	}
	h.db.Model(&models.MessageLog{}).Where("id = ?", msgID).Updates(updates)
	var updated models.MessageLog
	h.db.First(&updated, "id = ?", msgID)
	h.broadcast(&models.Conversation{ID: convID, WorkspaceID: ws}, "conversation.message_updated", map[string]any{
		"message": updated,
	})
	return c.JSON(updated)
}

// SendConstraints GET /v1/conversations/:id/send-constraints
// Retorna o que o canal aceita pra essa conversation. Frontend usa pra
// desabilitar botões/abrir modal de template quando necessário.
//
// Por canal:
//   - whatsapp (whatsmeow): janela 24h irrelevante (E2E direto), todos os
//     tipos de mídia, reactions, reply, edits.
//   - waba: janela 24h relevante; fora da janela só template; reactions OK,
//     reply OK, edit não.
//   - instagram: janela 24h; só image/video/text; sem reaction/reply/edit.
//   - tiktok: text + image; sem reactions; reply ok.
func (h *ConversationHandler) SendConstraints(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	var inst models.Instance
	if err := h.db.First(&inst, "id = ?", conv.InstanceID).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "instance não encontrada"})
	}

	windowOpen := true
	if h.outbound != nil {
		windowOpen = h.outbound.WindowOpen(&inst, conv.LastCustomerMsgAt)
	}

	type cons struct {
		Channel          string   `json:"channel"`
		WindowOpen       bool     `json:"window_open"`
		AllowsTemplate   bool     `json:"allows_template"`
		SupportsReply    bool     `json:"supports_reply"`
		SupportsReaction bool     `json:"supports_reaction"`
		SupportsEdit     bool     `json:"supports_edit"`
		SupportsRevoke   bool     `json:"supports_revoke"`
		AllowedTypes     []string `json:"allowed_types"`
		MaxBodyChars     int      `json:"max_body_chars"`
	}
	out := cons{
		Channel:    string(inst.Channel),
		WindowOpen: windowOpen,
	}
	switch inst.Channel {
	case models.ChannelWhatsApp:
		out.AllowedTypes = []string{"text", "image", "video", "audio", "document", "sticker", "location", "contact"}
		out.SupportsReply = true
		out.SupportsReaction = true
		out.SupportsEdit = true
		out.SupportsRevoke = true
		out.MaxBodyChars = 65536
	case models.ChannelWABA:
		out.AllowsTemplate = true
		out.SupportsReply = true
		out.SupportsReaction = true
		out.SupportsEdit = false
		out.SupportsRevoke = false
		out.AllowedTypes = []string{"text", "image", "video", "audio", "document", "template"}
		out.MaxBodyChars = 4096
	case models.ChannelInstagram:
		out.SupportsReply = true
		out.SupportsReaction = false
		out.SupportsEdit = false
		out.SupportsRevoke = false
		out.AllowedTypes = []string{"text", "image", "video", "audio"}
		out.MaxBodyChars = 1000
	case models.ChannelTikTok:
		out.SupportsReply = true
		out.SupportsReaction = false
		out.AllowedTypes = []string{"text", "image"}
		out.MaxBodyChars = 1000
	default:
		out.AllowedTypes = []string{"text"}
		out.MaxBodyChars = 4096
	}
	return c.JSON(out)
}

// SearchMessages GET /v1/conversations/messages/search?q=&limit=
// Busca global no conteúdo de mensagens do workspace. Retorna até 30 hits
// ordenados por created_at DESC com snippet + conversation_id pra UI abrir.
//
// Indexação: depende de índice gin no postgres pra performance em volume —
// `CREATE INDEX idx_msglogs_content_trgm ON message_logs USING gin (content gin_trgm_ops)`.
// Sem o índice, ILIKE faz seq scan; aceitável até ~100k msgs por workspace.
func (h *ConversationHandler) SearchMessages(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := strings.TrimSpace(c.Query("q"))
	if len(q) < 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "q precisa ter ao menos 2 caracteres"})
	}
	limit := atoiDefault(c.Query("limit"), 30)
	if limit > 100 {
		limit = 100
	}

	type hit struct {
		MessageID      uuid.UUID `json:"message_id"`
		ConversationID uuid.UUID `json:"conversation_id"`
		Direction      string    `json:"direction"`
		Type           string    `json:"type"`
		Snippet        string    `json:"snippet"`
		SenderName     string    `json:"sender_name,omitempty"`
		ContactName    string    `json:"contact_name,omitempty"`
		ChannelKey     string    `json:"channel_key"`
		CreatedAt      time.Time `json:"created_at"`
	}

	rows := []struct {
		MessageID      uuid.UUID
		ConversationID uuid.UUID
		Direction      string
		Type           string
		Content        string
		SenderName     string
		ContactName    string
		ChannelKey     string
		CreatedAt      time.Time
	}{}

	pattern := "%" + q + "%"
	if err := h.db.Table("message_logs ml").
		Select(`ml.id AS message_id, ml.conversation_id, ml.direction, ml.type,
			ml.content, ml.sender_name, ml.contact_name,
			c.channel_key, ml.created_at`).
		Joins("JOIN conversations c ON c.id = ml.conversation_id").
		Where("c.workspace_id = ? AND ml.is_deleted = false AND ml.content ILIKE ?", ws, pattern).
		Order("ml.created_at DESC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	hits := make([]hit, 0, len(rows))
	qLower := strings.ToLower(q)
	for _, r := range rows {
		// Snippet: extrai trecho ao redor do match (~80 chars total).
		snippet := buildSnippet(r.Content, qLower, 80)
		hits = append(hits, hit{
			MessageID:      r.MessageID,
			ConversationID: r.ConversationID,
			Direction:      r.Direction,
			Type:           r.Type,
			Snippet:        snippet,
			SenderName:     r.SenderName,
			ContactName:    r.ContactName,
			ChannelKey:     r.ChannelKey,
			CreatedAt:      r.CreatedAt,
		})
	}
	return c.JSON(fiber.Map{"hits": hits})
}

// buildSnippet gera trecho com ~maxLen chars centrado no primeiro match.
// Se o content é JSON ({text:..., caption:...}), tenta extrair o texto antes.
func buildSnippet(content, qLower string, maxLen int) string {
	text := content
	// Se for JSON estruturado, extrai text/caption pra display.
	if strings.HasPrefix(strings.TrimSpace(content), "{") {
		var obj map[string]any
		if err := json.Unmarshal([]byte(content), &obj); err == nil {
			if v, ok := obj["text"].(string); ok && v != "" {
				text = v
			} else if v, ok := obj["caption"].(string); ok && v != "" {
				text = v
			}
		}
	}
	idx := strings.Index(strings.ToLower(text), qLower)
	if idx < 0 {
		// query bateu em campo JSON cru — devolve só os primeiros chars
		if len(text) > maxLen {
			return text[:maxLen] + "…"
		}
		return text
	}
	half := maxLen / 2
	start := idx - half
	if start < 0 {
		start = 0
	}
	end := idx + len(qLower) + half
	if end > len(text) {
		end = len(text)
	}
	prefix := ""
	if start > 0 {
		prefix = "…"
	}
	suffix := ""
	if end < len(text) {
		suffix = "…"
	}
	return prefix + text[start:end] + suffix
}

// extractQuotedDisplayText extrai o texto que vai no QuotedMessage do
// ContextInfo. Priorities: text → caption → label do tipo (fallback).
// Sem isso, mobile do WhatsApp não consegue renderizar o quote bubble.
func extractQuotedDisplayText(content, msgType string) string {
	if content != "" {
		// JSON estruturado (mídia)
		if strings.HasPrefix(strings.TrimSpace(content), "{") {
			var obj map[string]any
			if err := json.Unmarshal([]byte(content), &obj); err == nil {
				if v, ok := obj["text"].(string); ok && v != "" {
					return truncate(v, 280)
				}
				if v, ok := obj["caption"].(string); ok && v != "" {
					return truncate(v, 280)
				}
			}
		} else {
			// Texto puro ou JSON-encoded
			var s string
			if json.Unmarshal([]byte(content), &s) == nil && s != "" {
				return truncate(s, 280)
			}
			return truncate(content, 280)
		}
	}
	// Fallback: label do tipo
	switch msgType {
	case "image":
		return "📷 Imagem"
	case "video":
		return "🎬 Vídeo"
	case "gif":
		return "🎞 GIF"
	case "audio":
		return "🔊 Áudio"
	case "document":
		return "📄 Documento"
	case "sticker":
		return "😊 Sticker"
	case "location", "live_location":
		return "📍 Localização"
	case "contact", "contacts":
		return "👤 Contato"
	case "poll":
		return "📊 Enquete"
	case "call":
		return "📞 Chamada"
	default:
		return "..."
	}
}

// loadMessageInWS — helper: carrega MessageLog garantindo que pertence
// a conversation desse workspace. Retorna 404 se não bater.
func (h *ConversationHandler) loadMessageInWS(c *fiber.Ctx, ws uuid.UUID, convID, msgID uuid.UUID) (*models.MessageLog, *models.Conversation, error) {
	var msg models.MessageLog
	var conv models.Conversation
	err := h.db.
		Joins("JOIN conversations c ON c.id = message_logs.conversation_id").
		Where("message_logs.id = ? AND c.workspace_id = ? AND c.id = ?", msgID, ws, convID).
		Select("message_logs.*").
		First(&msg).Error
	if err != nil {
		return nil, nil, c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mensagem não encontrada"})
	}
	if err := h.db.First(&conv, "id = ?", convID).Error; err != nil {
		return nil, nil, c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	return &msg, &conv, nil
}

// RevokeMessage DELETE /v1/conversations/:id/messages/:msgId
// Apaga uma mensagem enviada pelo agente (delete-for-everyone). Funciona
// apenas em mensagens outbound nossas com external_message_id (stanza_id).
// Marca is_deleted=true + content="" no DB e dispara whatsmeow Revoke
// pra remover do dispositivo do destinatário também.
func (h *ConversationHandler) RevokeMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	msgID, err := uuid.Parse(c.Params("msgId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgId inválido"})
	}
	msg, conv, errResp := h.loadMessageInWS(c, ws, convID, msgID)
	if errResp != nil {
		return errResp
	}
	if msg.Direction != models.DirectionOut {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "só é possível apagar mensagens enviadas pela equipe"})
	}
	if msg.ExternalMessageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "mensagem não tem id externo — não pode ser apagada no canal"})
	}

	// Dispara revoke no canal — best-effort. Se falhar, ainda marcamos no DB
	// (pelo menos some da inbox da equipe).
	if h.manager != nil {
		if client := h.manager.GetInstance(conv.InstanceID.String()); client != nil && client.IsConnected() {
			senderJID := msg.SenderJID
			if senderJID == "" {
				senderJID = client.OwnerJID()
			}
			_, _ = client.RevokeMessage(conv.ChannelKey, msg.ExternalMessageID, senderJID)
		}
	}

	h.db.Model(&models.MessageLog{}).Where("id = ?", msgID).Updates(map[string]any{
		"is_deleted": true,
		"type":       "revoke",
		"content":    "",
	})
	var updated models.MessageLog
	h.db.First(&updated, "id = ?", msgID)
	h.broadcast(conv, "conversation.message_updated", map[string]any{"message": updated})
	return c.JSON(updated)
}

// EditMessage PATCH /v1/conversations/:id/messages/:msgId/content { body }
// Edita o texto de uma mensagem outbound já enviada. Whatsmeow tem janela
// de 15min pra edit funcionar do lado do recipiente; depois disso só
// atualiza no nosso DB.
func (h *ConversationHandler) EditMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	msgID, err := uuid.Parse(c.Params("msgId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgId inválido"})
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := c.BodyParser(&body); err != nil || strings.TrimSpace(body.Body) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'body' é obrigatório"})
	}
	msg, conv, errResp := h.loadMessageInWS(c, ws, convID, msgID)
	if errResp != nil {
		return errResp
	}
	if msg.Direction != models.DirectionOut {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "só é possível editar mensagens enviadas pela equipe"})
	}
	if msg.Type != "text" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "edit suportado apenas para mensagens de texto"})
	}
	if msg.ExternalMessageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "mensagem não tem id externo"})
	}

	// Edit no canal — whatsmeow.BuildEdit. Best-effort.
	if h.manager != nil {
		if client := h.manager.GetInstance(conv.InstanceID.String()); client != nil && client.IsConnected() {
			_, _ = client.EditMessage(conv.ChannelKey, msg.ExternalMessageID, body.Body)
		}
	}

	h.db.Model(&models.MessageLog{}).Where("id = ?", msgID).Updates(map[string]any{
		"content":   body.Body,
		"is_edited": true,
	})
	var updated models.MessageLog
	h.db.First(&updated, "id = ?", msgID)
	h.broadcast(conv, "conversation.message_updated", map[string]any{"message": updated})
	return c.JSON(updated)
}

// ReactToMessage POST /v1/conversations/:id/messages/:msgId/react { emoji }
// Reage com emoji a uma mensagem (qualquer direção). emoji vazio remove a
// reação. Salva como MessageLog tipo "reaction" e dispara SendReaction.
func (h *ConversationHandler) ReactToMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	msgID, err := uuid.Parse(c.Params("msgId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgId inválido"})
	}
	var body struct {
		Emoji string `json:"emoji"`
	}
	c.BodyParser(&body)
	msg, conv, errResp := h.loadMessageInWS(c, ws, convID, msgID)
	if errResp != nil {
		return errResp
	}
	if msg.ExternalMessageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "mensagem não tem id externo"})
	}

	// Dispara reaction no canal
	if h.manager != nil {
		if client := h.manager.GetInstance(conv.InstanceID.String()); client != nil && client.IsConnected() {
			senderJID := msg.SenderJID
			if senderJID == "" {
				senderJID = client.OwnerJID()
			}
			_, _ = client.SendReaction(conv.ChannelKey, msg.ExternalMessageID, senderJID, body.Emoji)
		}
	}

	// Persiste como msg do agente tipo "reaction" pra aparecer na timeline.
	// Reply_to aponta pra mensagem reagida pra agrupamento no UI (#10).
	reaction := models.MessageLog{
		ID:             uuid.New(),
		InstanceID:     conv.InstanceID,
		ConversationID: &conv.ID,
		WorkspaceID:    &ws,
		Direction:      models.DirectionOut,
		Type:           "reaction",
		ToJID:          conv.ChannelKey,
		Content:        body.Emoji,
		Status:         models.MessageStatusSent,
		ReplyToID:      &msg.ID,
	}
	if err := h.db.Create(&reaction).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.broadcast(conv, "conversation.message", map[string]any{"message": reaction})
	return c.JSON(reaction)
}

// ForwardMessage POST /v1/conversations/:id/messages/:msgId/forward { targets[] }
// Encaminha uma mensagem para uma ou mais conversations alvo. Targets pode
// ter conversation_id (existente) OU contact_phone (cria/abre conv 1:1).
// Cada target gera um novo SendMessage outbound; mantém media_key (re-presign
// na hora). Marca o forward com flag is_forwarded no JSON content.
func (h *ConversationHandler) ForwardMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	msgID, err := uuid.Parse(c.Params("msgId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgId inválido"})
	}
	var body struct {
		ConversationIDs []string `json:"conversation_ids"`
	}
	if err := c.BodyParser(&body); err != nil || len(body.ConversationIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "informe ao menos um conversation_id"})
	}
	msg, _, errResp := h.loadMessageInWS(c, ws, convID, msgID)
	if errResp != nil {
		return errResp
	}

	type result struct {
		ConversationID string `json:"conversation_id"`
		MessageID      string `json:"message_id,omitempty"`
		Error          string `json:"error,omitempty"`
	}
	results := make([]result, 0, len(body.ConversationIDs))
	for _, raw := range body.ConversationIDs {
		targetID, err := uuid.Parse(raw)
		if err != nil {
			results = append(results, result{ConversationID: raw, Error: "id inválido"})
			continue
		}
		var target models.Conversation
		if err := h.db.Where("workspace_id = ? AND id = ?", ws, targetID).First(&target).Error; err != nil {
			results = append(results, result{ConversationID: raw, Error: "conversation não encontrada"})
			continue
		}
		// Novo MessageLog outbound copiando content + flag forwarded
		forwardedContent := injectForwardedFlag(msg.Content)
		newMsg := models.MessageLog{
			ID:             uuid.New(),
			InstanceID:     target.InstanceID,
			ConversationID: &target.ID,
			WorkspaceID:    &ws,
			Direction:      models.DirectionOut,
			Type:           msg.Type,
			ToJID:          target.ChannelKey,
			Content:        forwardedContent,
			Status:         models.MessageStatusPending,
		}
		if err := h.db.Create(&newMsg).Error; err != nil {
			results = append(results, result{ConversationID: raw, Error: err.Error()})
			continue
		}
		// Dispara envio no canal via outbound registry. Reusa o body/url/mime
		// extraídos do content original.
		if h.outbound != nil {
			var inst models.Instance
			if err := h.db.First(&inst, "id = ?", target.InstanceID).Error; err == nil {
				out := buildOutboundFromContent(forwardedContent, msg.Type, target.ChannelKey)
				ctx, cancel := context.WithTimeout(c.UserContext(), 30*time.Second)
				_, sendErr := h.outbound.Send(ctx, &inst, out)
				cancel()
				if sendErr != nil {
					h.db.Model(&newMsg).Update("status", models.MessageStatusFailed)
					results = append(results, result{ConversationID: raw, MessageID: newMsg.ID.String(), Error: sendErr.Error()})
					continue
				}
				h.db.Model(&newMsg).Update("status", models.MessageStatusSent)
			}
		}
		results = append(results, result{ConversationID: raw, MessageID: newMsg.ID.String()})
		h.broadcast(&target, "conversation.message", map[string]any{"message": newMsg})
	}
	return c.JSON(fiber.Map{"results": results})
}

// buildOutboundFromContent monta o OutboundMessage extraindo body+url+mime
// do JSON content. Tipos de mídia (image/video/audio/document) usam media_url
// + caption; texto usa body. Tipos não suportados (poll/contact/etc) caem
// pra body=stripJSONString fallback.
func buildOutboundFromContent(content, msgType, to string) outbound.OutboundMessage {
	out := outbound.OutboundMessage{To: to, Type: msgType}
	var asObj map[string]any
	if json.Unmarshal([]byte(content), &asObj) == nil {
		if v, ok := asObj["url"].(string); ok {
			out.MediaURL = v
		}
		if v, ok := asObj["mime_type"].(string); ok {
			out.MediaMime = v
		}
		if v, ok := asObj["filename"].(string); ok {
			out.Filename = v
		}
		if v, ok := asObj["caption"].(string); ok {
			out.Caption = v
		}
		if v, ok := asObj["text"].(string); ok {
			out.Body = v
		}
	} else {
		out.Body = stripJSONString(content)
	}
	return out
}

// injectForwardedFlag adiciona is_forwarded=true ao JSON content (se for JSON)
// ou empacota texto puro como {text, is_forwarded:true}.
func injectForwardedFlag(content string) string {
	if content == "" {
		return content
	}
	var asObj map[string]any
	if err := json.Unmarshal([]byte(content), &asObj); err == nil {
		asObj["is_forwarded"] = true
		if data, err := json.Marshal(asObj); err == nil {
			return string(data)
		}
		return content
	}
	// texto puro — mantém como string mas via wrap (simples manter compat).
	wrap := map[string]any{"text": stripJSONString(content), "is_forwarded": true}
	if data, err := json.Marshal(wrap); err == nil {
		return string(data)
	}
	return content
}

// stripJSONString lida com content que veio JSON-encoded ("oi") devolvendo
// "oi". Se já é texto puro, retorna como veio.
func stripJSONString(s string) string {
	var out string
	if json.Unmarshal([]byte(s), &out) == nil {
		return out
	}
	return s
}

// GetMessageReceipts GET /v1/conversations/:id/messages/:msgId/receipts
// Lista quem recebeu/leu a mensagem em grupo. Em conversa 1:1 retorna 0..1
// linhas (ou nenhuma — basta usar message.delivered_at/read_at). É o painel
// "Info da mensagem" do WhatsApp Web.
func (h *ConversationHandler) GetMessageReceipts(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	msgID, err := uuid.Parse(c.Params("msgId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgId inválido"})
	}
	msg, _, errResp := h.loadMessageInWS(c, ws, convID, msgID)
	if errResp != nil {
		return errResp
	}
	var receipts []models.MessageReceipt
	h.db.Where("message_log_id = ?", msg.ID).Order("timestamp ASC").Find(&receipts)

	// Agrupa por participant — entrega antes da leitura (uma linha cada).
	// Frontend usa pra montar duas listas: "Entregue a" e "Lida por".
	delivered := make([]map[string]any, 0)
	read := make([]map[string]any, 0)
	for _, r := range receipts {
		entry := map[string]any{
			"participant_jid": r.ParticipantJID,
			"timestamp":       r.Timestamp,
		}
		switch r.Type {
		case "read":
			read = append(read, entry)
		default:
			delivered = append(delivered, entry)
		}
	}
	return c.JSON(fiber.Map{
		"message_id":   msg.ID,
		"delivered":    delivered,
		"read":         read,
		"delivered_at": msg.DeliveredAt,
		"read_at":      msg.ReadAt,
	})
}

// Typing POST /v1/conversations/:id/typing  { typing: bool }
// Emite indicador de digitação pelo canal (hoje apenas WhatsApp whatsmeow
// implementa; outros canais viram no-op silencioso).
func (h *ConversationHandler) Typing(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convPtr, err := h.resolveConvByIDOrKey(c.Params("id"), ws, h.db.Select("id, instance_id, channel_key, workspace_id"))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	conv := *convPtr
	var body struct {
		Typing bool `json:"typing"`
	}
	c.BodyParser(&body)
	if h.manager != nil {
		if client := h.manager.GetInstance(conv.InstanceID.String()); client != nil && client.IsConnected() {
			_ = client.SendTyping(conv.ChannelKey, body.Typing)
		}
	}
	return c.JSON(fiber.Map{"ok": true})
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// MarkRead POST /v1/conversations/:id/read
func (h *ConversationHandler) MarkRead(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convPtr, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	id := convPtr.ID
	h.db.Model(&models.Conversation{}).Where("id = ?", id).Updates(map[string]any{
		"unread_count":       0,
		"agent_unread_count": 0,
	})
	h.broadcast(&models.Conversation{ID: id, WorkspaceID: ws}, "conversation.read", map[string]any{"by_user_id": middleware.GetCurrentUserID(c), "at": time.Now()})
	return c.JSON(fiber.Map{"ok": true})
}

// MarkUnread POST /v1/conversations/:id/unread
// Reseta o agent_unread pra 1 (sinaliza atenção sem inflar contador).
func (h *ConversationHandler) MarkUnread(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convPtr, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	id := convPtr.ID
	h.db.Model(&models.Conversation{}).Where("id = ?", id).Update("agent_unread_count", 1)
	h.broadcast(&models.Conversation{ID: id, WorkspaceID: ws}, "conversation.unread", map[string]any{"by_user_id": middleware.GetCurrentUserID(c), "at": time.Now()})
	return c.JSON(fiber.Map{"ok": true})
}

// Take POST /v1/conversations/:id/take
// Atalho semântico pra "atender" — equivalente a self-assign, mas explícito
// pra integrações (n8n/agentes/etc) que querem expressar a ação claramente.
func (h *ConversationHandler) Take(c *fiber.Ctx) error {
	return h.Assign(c) // mesmo comportamento; Assign sem user_id já faz self-assign race-safe
}

// Bulk POST /v1/conversations/bulk
// Body: { ids: [uuid...], action: "resolve"|"close"|"reopen"|"snooze"|"unsnooze"|
//                                 "read"|"unread"|"assign"|"unassign"|"transfer"|
//                                 "archive"|"unarchive"|"pin"|"unpin"|"mute"|"unmute",
//         user_id?, queue_id?, team_id?, department_id?, until?, reason?, note? }
//
// Aplica a mesma ação em N conversas. Cada item processado independentemente —
// retorna lista de { id, ok, error? }.
func (h *ConversationHandler) Bulk(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body struct {
		IDs          []string `json:"ids"`
		Action       string   `json:"action"`
		UserID       string   `json:"user_id"`
		QueueID      string   `json:"queue_id"`
		TeamID       string   `json:"team_id"`
		DepartmentID string   `json:"department_id"`
		Until        string   `json:"until"`
		Reason       string   `json:"reason"`
		Note         string   `json:"note"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if body.Action == "" || len(body.IDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ids e action obrigatórios"})
	}
	if len(body.IDs) > 200 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "máximo 200 ids por request"})
	}

	actor := middleware.GetCurrentUserID(c)
	type result struct {
		ID    string `json:"id"`
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}
	out := make([]result, 0, len(body.IDs))

	for _, raw := range body.IDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			out = append(out, result{ID: raw, OK: false, Error: "id inválido"})
			continue
		}
		var conv models.Conversation
		if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
			out = append(out, result{ID: raw, OK: false, Error: "não encontrado"})
			continue
		}
		updates := map[string]any{}
		eventType := models.ConvEventStatusChanged
		switch body.Action {
		case "resolve":
			updates["status"] = models.ConversationStatusResolved
			updates["resolved_at"] = time.Now()
		case "close":
			updates["status"] = models.ConversationStatusClosed
			updates["closed_at"] = time.Now()
		case "reopen":
			updates["status"] = models.ConversationStatusOpen
			updates["reopened_at"] = time.Now()
			updates["reopen_count"] = gorm.Expr("reopen_count + 1")
			eventType = models.ConvEventReopened
		case "snooze":
			until, err := time.Parse(time.RFC3339, body.Until)
			if err != nil {
				out = append(out, result{ID: raw, OK: false, Error: "until inválido (RFC3339)"})
				continue
			}
			updates["status"] = models.ConversationStatusSnoozed
			updates["snoozed_until"] = until
			eventType = models.ConvEventSnoozed
		case "unsnooze":
			updates["status"] = models.ConversationStatusOpen
			updates["snoozed_until"] = nil
			eventType = models.ConvEventUnsnoozed
		case "read":
			updates["unread_count"] = 0
			updates["agent_unread_count"] = 0
		case "unread":
			updates["agent_unread_count"] = 1
		case "assign":
			target := actor
			if body.UserID != "" {
				if u, err := uuid.Parse(body.UserID); err == nil {
					target = u
				}
			}
			updates["assigned_user_id"] = target
			eventType = models.ConvEventAssignmentChanged
		case "unassign":
			updates["assigned_user_id"] = nil
			eventType = models.ConvEventAssignmentChanged
		case "transfer":
			if body.QueueID != "" {
				if qid, err := uuid.Parse(body.QueueID); err == nil {
					updates["queue_id"] = qid
					updates["assigned_user_id"] = nil
					var q models.Queue
					if h.db.First(&q, "id = ?", qid).Error == nil {
						updates["department_id"] = q.DepartmentID
						updates["team_id"] = q.TeamID
					}
				}
			}
			if body.DepartmentID != "" {
				if did, err := uuid.Parse(body.DepartmentID); err == nil {
					updates["department_id"] = did
				}
			}
			if body.TeamID != "" {
				if tid, err := uuid.Parse(body.TeamID); err == nil {
					updates["team_id"] = tid
				}
			}
			if body.UserID != "" {
				if uid, err := uuid.Parse(body.UserID); err == nil {
					updates["assigned_user_id"] = uid
				}
			}
			eventType = models.ConvEventTransferred
		case "archive":
			updates["is_archived"] = true
		case "unarchive":
			updates["is_archived"] = false
		case "pin":
			updates["is_pinned"] = true
		case "unpin":
			updates["is_pinned"] = false
		case "mute":
			updates["is_muted"] = true
		case "unmute":
			updates["is_muted"] = false
		default:
			out = append(out, result{ID: raw, OK: false, Error: "action desconhecida: " + body.Action})
			continue
		}
		if len(updates) == 0 {
			out = append(out, result{ID: raw, OK: false, Error: "sem mudanças"})
			continue
		}
		if err := h.db.Model(&models.Conversation{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			out = append(out, result{ID: raw, OK: false, Error: err.Error()})
			continue
		}
		h.appendEvent(&conv, eventType, actor, map[string]any{"action": body.Action, "note": body.Note, "reason": body.Reason})
		h.broadcast(&conv, "conversation."+body.Action, map[string]any{"by_user_id": actor})
		out = append(out, result{ID: raw, OK: true})
	}
	return c.JSON(fiber.Map{"results": out})
}

// Assign POST /v1/conversations/:id/assign  { user_id }
// Race-safe: only succeeds if the conversation is currently unassigned OR the
// actor has tickets:view_all (supervisor reassignment).
func (h *ConversationHandler) Assign(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convPtr, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	conv := *convPtr
	id := conv.ID
	var body struct {
		UserID string `json:"user_id"`
	}
	c.BodyParser(&body)

	actorID := middleware.GetCurrentUserID(c)
	target := actorID
	if body.UserID != "" {
		if u, err := uuid.Parse(body.UserID); err == nil {
			target = u
		}
	}

	prev := conv.AssignedUserID
	isForce := target != actorID // assigning someone else requires supervisor perm in middleware

	// Race-safe self-assign: only update if currently unassigned
	if !isForce && conv.AssignedUserID == nil {
		res := h.db.Model(&models.Conversation{}).
			Where("id = ? AND assigned_user_id IS NULL", id).
			Update("assigned_user_id", target)
		if res.RowsAffected == 0 {
			// Someone beat us to it — return 409
			h.db.Where("id = ?", id).First(&conv)
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":       "atendimento já atribuído",
				"assigned_to": conv.AssignedUserID,
			})
		}
	} else {
		// Unconditional update (supervisor reassign or self-claim when already mine)
		h.db.Model(&models.Conversation{}).Where("id = ?", id).Update("assigned_user_id", target)
	}

	// Bump open status if needed
	h.db.Model(&models.Conversation{}).Where("id = ? AND status = ?", id, models.ConversationStatusPending).
		Update("status", models.ConversationStatusOpen)

	h.db.Create(&models.ConversationAssignment{
		ConversationID: id,
		WorkspaceID:    ws,
		FromUserID:     prev,
		ToUserID:       &target,
		Reason:         pickReason(actorID, target),
		ActorUserID:    &actorID,
	})
	h.appendEvent(&conv, models.ConvEventAssignmentChanged, actorID, map[string]any{"to_user_id": target, "from_user_id": prev})

	h.db.Where("id = ?", id).First(&conv)
	h.broadcast(&conv, "conversation.assigned", map[string]any{"from_user_id": prev, "to_user_id": target, "actor": actorID})
	return c.JSON(conv)
}

// Unassign POST /v1/conversations/:id/unassign
func (h *ConversationHandler) Unassign(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	prev := conv.AssignedUserID
	h.db.Model(&models.Conversation{}).Where("id = ?", id).Update("assigned_user_id", nil)

	actor := middleware.GetCurrentUserID(c)
	h.db.Create(&models.ConversationAssignment{
		ConversationID: id,
		WorkspaceID:    ws,
		FromUserID:     prev,
		ToUserID:       nil,
		Reason:         "manual",
		ActorUserID:    &actor,
	})
	h.appendEvent(&conv, models.ConvEventAssignmentChanged, actor, map[string]any{"from_user_id": prev, "to_user_id": nil})
	h.db.Where("id = ?", id).First(&conv)
	h.broadcast(&conv, "conversation.assigned", map[string]any{"from_user_id": prev, "to_user_id": nil, "actor": actor})
	return c.JSON(conv)
}

// Transfer POST /v1/conversations/:id/transfer
// Body: { queue_id?, team_id?, user_id?, note }
func (h *ConversationHandler) Transfer(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	rawID := c.Params("id")

	var body struct {
		QueueID      string `json:"queue_id"`
		TeamID       string `json:"team_id"`
		DepartmentID string `json:"department_id"`
		UserID       string `json:"user_id"`
		Note         string `json:"note"`
	}
	c.BodyParser(&body)

	// Resolve a conversa por UUID OU channel_key (JID/lid) — n8n e webhooks
	// recebem JID/lid em vez do UUID interno; essa flexibilidade evita
	// pipeline duplicado pra "lookup conversation by JID first".
	var conv models.Conversation
	if id, err := uuid.Parse(rawID); err == nil {
		if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
		}
	} else {
		// Fallback: trata o param como channel_key (JID/lid). Pega a conversa
		// mais recente nesse canal dentro do workspace.
		//
		// LID → PN: quando o caller passa um @lid (ex: "268255570710700@lid"),
		// as conversas são armazenadas com o phone JID (@s.whatsapp.net) porque
		// o whatsmeow resolve LIDs antes de persistir. Tentamos resolver via
		// qualquer instância conectada do workspace antes de fazer o lookup.
		lookupKey := rawID
		if strings.HasSuffix(rawID, "@lid") && h.manager != nil {
			var instances []models.Instance
			h.db.Where("workspace_id = ? AND status = ?", ws, models.StatusConnected).Find(&instances)
			for _, inst := range instances {
				if client := h.manager.GetInstance(inst.ID.String()); client != nil {
					if resolved := client.ResolvePNForLID(rawID); strings.HasSuffix(resolved, "@s.whatsapp.net") {
						lookupKey = resolved
						break
					}
				}
			}
		}

		if err := h.db.Where("workspace_id = ? AND channel_key = ?", ws, lookupKey).
			Order("updated_at DESC").
			First(&conv).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "atendimento não encontrado pelo id/channel_key fornecido",
			})
		}
	}

	// Snapshot do estado ATUAL antes do update — usado pra responder com
	// from_* + to_* e pra registrar o evento detalhado.
	fromQueueID := conv.QueueID
	fromDeptID := conv.DepartmentID
	fromTeamID := conv.TeamID
	fromUserID := conv.AssignedUserID

	updates := map[string]any{}
	var toQueue *uuid.UUID
	var toDept *uuid.UUID
	var toTeam *uuid.UUID
	if body.QueueID != "" {
		if qid, err := uuid.Parse(body.QueueID); err == nil {
			updates["queue_id"] = qid
			toQueue = &qid
			var q models.Queue
			if h.db.First(&q, "id = ?", qid).Error == nil {
				updates["department_id"] = q.DepartmentID
				updates["team_id"] = q.TeamID
				toDept = q.DepartmentID
				toTeam = q.TeamID
			}
		}
	}
	if body.DepartmentID != "" {
		if did, err := uuid.Parse(body.DepartmentID); err == nil {
			updates["department_id"] = did
			toDept = &did
		}
	}
	if body.TeamID != "" {
		if tid, err := uuid.Parse(body.TeamID); err == nil {
			updates["team_id"] = tid
			toTeam = &tid
		}
	}
	var toUser *uuid.UUID
	if body.UserID != "" {
		if uid, err := uuid.Parse(body.UserID); err == nil {
			updates["assigned_user_id"] = uid
			toUser = &uid
		}
	} else if _, ok := updates["queue_id"]; ok {
		updates["assigned_user_id"] = nil
		if conv.Status == models.ConversationStatusOpen {
			updates["status"] = models.ConversationStatusPending
		}
	}
	if len(updates) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nenhum destino informado"})
	}
	h.db.Model(&conv).Updates(updates)

	actor := middleware.GetCurrentUserID(c)
	h.db.Create(&models.ConversationAssignment{
		ConversationID: conv.ID,
		WorkspaceID:    ws,
		FromUserID:     fromUserID,
		ToUserID:       toUser,
		FromQueueID:    fromQueueID,
		ToQueueID:      toQueue,
		Reason:         "transfer",
		ActorUserID:    &actor,
		Note:           body.Note,
	})

	// Resolve nomes (origem + destino) pra enriquecer response e WS event.
	type ref struct {
		ID   *uuid.UUID `json:"id"`
		Name string     `json:"name,omitempty"`
	}
	resolveDept := func(id *uuid.UUID) ref {
		r := ref{ID: id}
		if id != nil && *id != uuid.Nil {
			var d models.Department
			if h.db.Select("name").First(&d, "id = ?", *id).Error == nil {
				r.Name = d.Name
			}
		}
		return r
	}
	resolveTeam := func(id *uuid.UUID) ref {
		r := ref{ID: id}
		if id != nil && *id != uuid.Nil {
			var t models.Team
			if h.db.Select("name").First(&t, "id = ?", *id).Error == nil {
				r.Name = t.Name
			}
		}
		return r
	}
	resolveQueue := func(id *uuid.UUID) ref {
		r := ref{ID: id}
		if id != nil && *id != uuid.Nil {
			var q models.Queue
			if h.db.Select("name").First(&q, "id = ?", *id).Error == nil {
				r.Name = q.Name
			}
		}
		return r
	}
	resolveUser := func(id *uuid.UUID) ref {
		r := ref{ID: id}
		if id != nil && *id != uuid.Nil {
			var u models.User
			if h.db.Select("name").First(&u, "id = ?", *id).Error == nil {
				r.Name = u.Name
			}
		}
		return r
	}

	transferDetails := map[string]any{
		"from_department": resolveDept(fromDeptID),
		"to_department":   resolveDept(toDept),
		"from_team":       resolveTeam(fromTeamID),
		"to_team":         resolveTeam(toTeam),
		"from_queue":      resolveQueue(fromQueueID),
		"to_queue":        resolveQueue(toQueue),
		"from_user":       resolveUser(fromUserID),
		"to_user":         resolveUser(toUser),
		"note":            body.Note,
	}
	h.appendEvent(&conv, models.ConvEventTransferred, actor, transferDetails)
	h.db.Where("id = ?", conv.ID).First(&conv)
	h.broadcast(&conv, "conversation.transferred", transferDetails)

	return c.JSON(fiber.Map{
		"conversation": conv,
		"transfer":     transferDetails,
	})
}

// Resolve POST /v1/conversations/:id/resolve  { reason?, send_csat? }
func (h *ConversationHandler) Resolve(c *fiber.Ctx) error {
	return h.setStatus(c, models.ConversationStatusResolved, func(conv *models.Conversation) {
		now := time.Now()
		conv.ResolvedAt = &now
	})
}

// Close POST /v1/conversations/:id/close
func (h *ConversationHandler) Close(c *fiber.Ctx) error {
	return h.setStatus(c, models.ConversationStatusClosed, func(conv *models.Conversation) {
		now := time.Now()
		conv.ClosedAt = &now
	})
}

// Reopen POST /v1/conversations/:id/reopen
func (h *ConversationHandler) Reopen(c *fiber.Ctx) error {
	return h.setStatus(c, models.ConversationStatusOpen, func(conv *models.Conversation) {
		now := time.Now()
		conv.ReopenedAt = &now
		conv.ReopenCount++
		conv.ClosedAt = nil
		conv.ResolvedAt = nil
	})
}

// Snooze POST /v1/conversations/:id/snooze { until: "2026-05-01T12:00:00Z" }
func (h *ConversationHandler) Snooze(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		Until string `json:"until"`
	}
	c.BodyParser(&body)
	until, err := time.Parse(time.RFC3339, body.Until)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "until inválido (use RFC3339)"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	h.db.Model(&conv).Updates(map[string]any{
		"status":        models.ConversationStatusSnoozed,
		"snoozed_until": until,
	})
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&conv, models.ConvEventSnoozed, actor, map[string]any{"until": until})
	h.db.Where("id = ?", id).First(&conv)
	h.broadcast(&conv, "conversation.status_changed", map[string]any{"from": "open", "to": "snoozed", "until": until})
	return c.JSON(conv)
}

// Unsnooze POST /v1/conversations/:id/unsnooze
func (h *ConversationHandler) Unsnooze(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	h.db.Model(&conv).Updates(map[string]any{
		"status":        models.ConversationStatusOpen,
		"snoozed_until": nil,
	})
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&conv, models.ConvEventUnsnoozed, actor, nil)
	h.db.Where("id = ?", id).First(&conv)
	h.broadcast(&conv, "conversation.status_changed", map[string]any{"from": "snoozed", "to": "open"})
	return c.JSON(conv)
}

// EnableBot / DisableBot POST /v1/conversations/:id/bot/{enable|disable}
func (h *ConversationHandler) EnableBot(c *fiber.Ctx) error  { return h.setBot(c, true) }
func (h *ConversationHandler) DisableBot(c *fiber.Ctx) error { return h.setBot(c, false) }

func (h *ConversationHandler) setBot(c *fiber.Ctx, active bool) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.Model(&models.Conversation{}).Where("id = ?", id).Update("is_bot_active", active)
	actor := middleware.GetCurrentUserID(c)
	evtType := models.ConvEventBotHandoff
	h.db.Create(&models.ConversationEvent{
		ConversationID: id,
		WorkspaceID:    ws,
		ActorType:      models.ActorUser,
		ActorUserID:    &actor,
		EventType:      evtType,
		Payload:        jsonEncode(map[string]any{"bot_active": active}),
	})
	return c.JSON(fiber.Map{"ok": true, "is_bot_active": active})
}

// -- backfill + diagnostics -------------------------------------------------

// InboxStats GET /v1/conversations/inbox-stats
// Diagnostic endpoint: conta MessageLogs, Conversations e MessageLogs
// pendentes de backfill (conversation_id NULL). Usado pelo front para
// mostrar CTA de "Sincronizar histórico" quando faz sentido.
func (h *ConversationHandler) InboxStats(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var messageLogs, conversations, pendingBackfill, openConvs, mineOpen int64
	h.db.Model(&models.MessageLog{}).Where("workspace_id = ?", ws).Count(&messageLogs)
	h.db.Model(&models.Conversation{}).Where("workspace_id = ?", ws).Count(&conversations)
	h.db.Model(&models.MessageLog{}).
		Where("workspace_id = ? AND conversation_id IS NULL AND direction = ? AND to_jid <> ''",
			ws, models.DirectionIn).
		Count(&pendingBackfill)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND status IN ?", ws,
			[]models.ConversationStatus{models.ConversationStatusOpen, models.ConversationStatusPending}).
		Count(&openConvs)
	userID := middleware.GetCurrentUserID(c)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND assigned_user_id = ? AND status = ?", ws, userID, models.ConversationStatusOpen).
		Count(&mineOpen)

	return c.JSON(fiber.Map{
		"message_logs":     messageLogs,
		"conversations":    conversations,
		"pending_backfill": pendingBackfill,
		"open":             openConvs,
		"mine_open":        mineOpen,
	})
}

// Backfill POST /v1/conversations/backfill  { limit?: int, max_batches?: int }
// Executa o InboundPipeline para MessageLogs do workspace que ainda não têm
// conversation_id atribuído. Processado em lotes síncronos (padrão 500
// rows × 20 lotes = 10k msgs por chamada). Clientes podem chamar múltiplas
// vezes até pending_backfill chegar a 0.
//
// Race-safe: se outra chamada concorrente estiver rodando, ambas convergem
// porque ProcessSavedInbound é idempotente (skips MessageLogs que já têm
// conversation_id preenchido).
func (h *ConversationHandler) Backfill(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	if h.pipeline == nil {
		return c.Status(fiber.StatusServiceUnavailable).
			JSON(fiber.Map{"error": "pipeline indisponível"})
	}

	var body struct {
		Limit      int `json:"limit"`
		MaxBatches int `json:"max_batches"`
	}
	c.BodyParser(&body)
	limit := body.Limit
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	maxBatches := body.MaxBatches
	if maxBatches <= 0 || maxBatches > 100 {
		maxBatches = 20
	}

	ctx := c.UserContext()
	processed := 0
	inbound := 0
	outbound := 0
	batches := 0
	start := time.Now()

	// Inbound pass — through the pipeline so it creates/reuses Conversations.
	for batches < maxBatches {
		var rows []models.MessageLog
		if err := h.db.WithContext(ctx).
			Where("workspace_id = ? AND conversation_id IS NULL AND direction = ? AND to_jid <> ''",
				ws, models.DirectionIn).
			Order("created_at ASC").
			Limit(limit).
			Find(&rows).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		if len(rows) == 0 {
			break
		}
		for i := range rows {
			if err := h.pipeline.ProcessSavedInbound(ctx, &rows[i]); err != nil {
				log.Debug().Err(err).Str("ml_id", rows[i].ID.String()).Msg("backfill: skip")
				continue
			}
			inbound++
			processed++
		}
		batches++
	}

	// Outbound pass — attach to the existing live Conversation if we can find
	// one matching (workspace, instance, channel_key) + created_at window.
	obBatches := 0
	for obBatches < maxBatches {
		var rows []models.MessageLog
		if err := h.db.WithContext(ctx).
			Where("workspace_id = ? AND conversation_id IS NULL AND direction = ? AND to_jid <> ''",
				ws, models.DirectionOut).
			Order("created_at ASC").
			Limit(limit).
			Find(&rows).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		if len(rows) == 0 {
			break
		}
		for i := range rows {
			ml := &rows[i]
			convID := h.findConversationForOutbound(ctx, ws, ml)
			if convID == nil {
				continue
			}
			h.db.WithContext(ctx).Model(&models.MessageLog{}).
				Where("id = ?", ml.ID).
				Update("conversation_id", *convID)
			outbound++
			processed++
		}
		obBatches++
	}

	// Report how much is left so the UI can keep calling.
	var remaining int64
	h.db.Model(&models.MessageLog{}).
		Where("workspace_id = ? AND conversation_id IS NULL AND direction IN ?",
			ws, []models.MessageDirection{models.DirectionIn, models.DirectionOut}).
		Count(&remaining)

	// Totals pro client saber onde estão os tickets — às vezes o user
	// processa 1600 message_logs e cria só 80 conversations porque o mesmo
	// contato recebeu muitas mensagens.
	var totalConvs, openConvs, pendingConvs, unassignedOpen int64
	h.db.Model(&models.Conversation{}).Where("workspace_id = ?", ws).Count(&totalConvs)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND status = ?", ws, models.ConversationStatusOpen).Count(&openConvs)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND status = ?", ws, models.ConversationStatusPending).Count(&pendingConvs)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND status IN ? AND assigned_user_id IS NULL", ws,
			[]models.ConversationStatus{models.ConversationStatusOpen, models.ConversationStatusPending}).
		Count(&unassignedOpen)

	return c.JSON(fiber.Map{
		"processed":         processed,
		"inbound":           inbound,
		"outbound":          outbound,
		"batches":           batches + obBatches,
		"remaining":         remaining,
		"total_conversations":     totalConvs,
		"open_conversations":      openConvs,
		"pending_conversations":   pendingConvs,
		"unassigned_open":         unassignedOpen,
		"elapsed_ms":        time.Since(start).Milliseconds(),
	})
}

// findConversationForOutbound locates a Conversation that covers an outbound
// MessageLog. Prefers the one alive at ml.created_at; falls back to the most
// recent for (workspace, instance, channel_key).
func (h *ConversationHandler) findConversationForOutbound(ctx context.Context, ws uuid.UUID, ml *models.MessageLog) *uuid.UUID {
	if ml.ToJID == "" || ml.InstanceID == uuid.Nil {
		return nil
	}
	var conv models.Conversation
	err := h.db.WithContext(ctx).
		Where("workspace_id = ? AND instance_id = ? AND channel_key = ?", ws, ml.InstanceID, ml.ToJID).
		Where("created_at <= ?", ml.CreatedAt).
		Where("(closed_at IS NULL OR closed_at >= ?)", ml.CreatedAt).
		Order("created_at DESC").
		First(&conv).Error
	if err == nil {
		return &conv.ID
	}
	err = h.db.WithContext(ctx).
		Where("workspace_id = ? AND instance_id = ? AND channel_key = ?", ws, ml.InstanceID, ml.ToJID).
		Order("created_at DESC").
		First(&conv).Error
	if err != nil {
		return nil
	}
	return &conv.ID
}

// -- tags -------------------------------------------------------------------

// AddTag POST /v1/conversations/:id/tags  { tag_id }
// Attaches an existing Tag (models.Tag lives on contact_tags M2M today; for
// conversations we reuse the same Tag table with a different join).
// We implement the M2M ad-hoc via a `conversation_tags` table auto-migrated
// through AddTag's raw SQL to avoid a schema change here.
func (h *ConversationHandler) AddTag(c *fiber.Ctx) error {
	id, ws, err := h.resolveIDOrKey(c)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	var body struct{ TagID string `json:"tag_id"` }
	c.BodyParser(&body)
	tagID, err := uuid.Parse(body.TagID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tag_id inválido"})
	}
	// Ensure tag belongs to this workspace
	var count int64
	h.db.Model(&models.Tag{}).Where("id = ? AND (workspace_id = ? OR workspace_id IS NULL)", tagID, ws).Count(&count)
	if count == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tag não encontrada"})
	}
	h.ensureConversationTagsTable()
	h.db.Exec(`INSERT INTO conversation_tags (conversation_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, id, tagID)
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&models.Conversation{ID: id, WorkspaceID: ws}, models.ConvEventTagAdded, actor, map[string]any{"tag_id": tagID})

	// Goal/Exit hooks pra Journey: tag.added:{tag_name} pro contato.
	var tag models.Tag
	if h.db.First(&tag, "id = ?", tagID).Error == nil {
		var conv models.Conversation
		h.db.Select("contact_id").First(&conv, "id = ?", id)
		if conv.ContactID != nil {
			var contact models.Contact
			if h.db.First(&contact, "id = ?", *conv.ContactID).Error == nil && contact.Phone != "" {
				jid := contact.Phone + "@s.whatsapp.net"
				services.DispatchJourneyEvent("tag.added:"+tag.Name, jid, map[string]any{
					"tag_id": tagID.String(), "tag_name": tag.Name,
				})
				services.DispatchJourneyEvent("tag.added", jid, map[string]any{
					"tag_id": tagID.String(), "tag_name": tag.Name,
				})
			}
		}
	}
	return c.JSON(fiber.Map{"ok": true})
}

// RemoveTag DELETE /v1/conversations/:id/tags/:tagId
func (h *ConversationHandler) RemoveTag(c *fiber.Ctx) error {
	id, ws, err := h.resolveIDOrKey(c)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	tagID, err := uuid.Parse(c.Params("tagId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tagId inválido"})
	}
	h.ensureConversationTagsTable()
	h.db.Exec(`DELETE FROM conversation_tags WHERE conversation_id = ? AND tag_id = ?`, id, tagID)
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&models.Conversation{ID: id, WorkspaceID: ws}, models.ConvEventTagRemoved, actor, map[string]any{"tag_id": tagID})
	return c.JSON(fiber.Map{"ok": true})
}

// ListTags GET /v1/conversations/:id/tags
func (h *ConversationHandler) ListTags(c *fiber.Ctx) error {
	id, _, err := h.resolveIDOrKey(c)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	h.ensureConversationTagsTable()
	var tags []models.Tag
	h.db.Raw(`
		SELECT t.* FROM tags t
		JOIN conversation_tags ct ON ct.tag_id = t.id
		WHERE ct.conversation_id = ?
		ORDER BY t.name ASC
	`, id).Scan(&tags)
	return c.JSON(fiber.Map{"items": tags})
}

// ensureConversationTagsTable creates the join table if missing. Called
// lazily so we don't need a fresh migration. Idempotent per-process.
func (h *ConversationHandler) ensureConversationTagsTable() {
	if h.db.Dialector.Name() == "postgres" {
		h.db.Exec(`
			CREATE TABLE IF NOT EXISTS conversation_tags (
				conversation_id UUID NOT NULL,
				tag_id UUID NOT NULL,
				PRIMARY KEY (conversation_id, tag_id)
			)
		`)
	} else {
		h.db.Exec(`
			CREATE TABLE IF NOT EXISTS conversation_tags (
				conversation_id TEXT NOT NULL,
				tag_id TEXT NOT NULL,
				PRIMARY KEY (conversation_id, tag_id)
			)
		`)
	}
}

// -- participants -----------------------------------------------------------

// AddParticipant POST /v1/conversations/:id/participants  { user_id, role? }
func (h *ConversationHandler) AddParticipant(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	var body struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	c.BodyParser(&body)
	userID, err := uuid.Parse(body.UserID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "user_id inválido"})
	}
	if body.Role == "" {
		body.Role = "follower"
	}
	p := models.ConversationParticipant{
		ConversationID: id,
		UserID:         userID,
		Role:           body.Role,
		AddedAt:        time.Now(),
	}
	if err := h.db.Create(&p).Error; err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	}
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&models.Conversation{ID: id, WorkspaceID: ws}, models.ConvEventParticipantAdded, actor, map[string]any{"user_id": userID, "role": body.Role})
	return c.Status(fiber.StatusCreated).JSON(p)
}

// RemoveParticipant DELETE /v1/conversations/:id/participants/:userId
func (h *ConversationHandler) RemoveParticipant(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	userID, err := uuid.Parse(c.Params("userId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "userId inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.Where("conversation_id = ? AND user_id = ?", id, userID).Delete(&models.ConversationParticipant{})
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&models.Conversation{ID: id, WorkspaceID: ws}, models.ConvEventParticipantRemoved, actor, map[string]any{"user_id": userID})
	return c.JSON(fiber.Map{"ok": true})
}

// ListParticipants GET /v1/conversations/:id/participants
func (h *ConversationHandler) ListParticipants(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	type row struct {
		models.ConversationParticipant
		UserName  string `json:"user_name"`
		UserEmail string `json:"user_email"`
	}
	var rows []row
	h.db.Table("conversation_participants AS cp").
		Select("cp.*, u.name AS user_name, u.email AS user_email").
		Joins("LEFT JOIN users u ON u.id = cp.user_id").
		Where("cp.conversation_id = ?", id).
		Order("cp.added_at ASC").
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

// -- history accessors ------------------------------------------------------

// ListAssignments GET /v1/conversations/:id/assignments
func (h *ConversationHandler) ListAssignments(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	var items []models.ConversationAssignment
	h.db.Where("conversation_id = ?", id).Order("created_at DESC").Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// ListEvents GET /v1/conversations/:id/events
// Raw event stream (without messages/notes merged in) — useful for audit UIs.
func (h *ConversationHandler) ListEvents(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	var items []models.ConversationEvent
	limit := atoiDefault(c.Query("limit"), 200)
	if limit > 1000 {
		limit = 1000
	}
	h.db.Where("conversation_id = ?", id).Order("created_at DESC").Limit(limit).Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// -- notes ------------------------------------------------------------------

// ListNotes GET /v1/conversations/:id/notes
func (h *ConversationHandler) ListNotes(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	var notes []models.ConversationNote
	h.db.Where("conversation_id = ?", id).Preload("Author").
		Order("created_at DESC").Find(&notes)
	return c.JSON(fiber.Map{"items": notes})
}

// CreateNote POST /v1/conversations/:id/notes  { body, mentioned: [uuid], is_pinned? }
func (h *ConversationHandler) CreateNote(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	var body struct {
		Body      string      `json:"body"`
		Mentioned []uuid.UUID `json:"mentioned"`
		IsPinned  bool        `json:"is_pinned"`
	}
	if err := c.BodyParser(&body); err != nil || strings.TrimSpace(body.Body) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body é obrigatório"})
	}
	authorID := middleware.GetCurrentUserID(c)
	mentioned := jsonEncode(body.Mentioned)
	note := models.ConversationNote{
		ConversationID: id,
		WorkspaceID:    ws,
		AuthorUserID:   authorID,
		Body:           body.Body,
		MentionedJSON:  mentioned,
		IsPinned:       body.IsPinned,
	}
	if err := h.db.Create(&note).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.Preload("Author").First(&note, "id = ?", note.ID)
	h.db.Create(&models.ConversationEvent{
		ConversationID: id,
		WorkspaceID:    ws,
		ActorType:      models.ActorUser,
		ActorUserID:    &authorID,
		EventType:      models.ConvEventNote,
	})
	h.broadcast(&models.Conversation{ID: id, WorkspaceID: ws}, "conversation.note_added", map[string]any{"note": note})
	return c.Status(fiber.StatusCreated).JSON(note)
}

// UpdateNote PATCH /v1/conversations/:id/notes/:noteId
func (h *ConversationHandler) UpdateNote(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	noteID, err := uuid.Parse(c.Params("noteId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "noteId inválido"})
	}
	userID := middleware.GetCurrentUserID(c)
	var note models.ConversationNote
	if err := h.db.Where("id = ? AND workspace_id = ?", noteID, ws).First(&note).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "nota não encontrada"})
	}
	if note.AuthorUserID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o autor pode editar"})
	}
	var body struct {
		Body     *string `json:"body"`
		IsPinned *bool   `json:"is_pinned"`
	}
	c.BodyParser(&body)
	updates := map[string]any{}
	if body.Body != nil {
		updates["body"] = *body.Body
	}
	if body.IsPinned != nil {
		updates["is_pinned"] = *body.IsPinned
	}
	if len(updates) > 0 {
		h.db.Model(&note).Updates(updates)
	}
	h.db.Preload("Author").First(&note, "id = ?", noteID)
	return c.JSON(note)
}

// DeleteNote DELETE /v1/conversations/:id/notes/:noteId
func (h *ConversationHandler) DeleteNote(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	noteID, err := uuid.Parse(c.Params("noteId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "noteId inválido"})
	}
	userID := middleware.GetCurrentUserID(c)
	var note models.ConversationNote
	if err := h.db.Where("id = ? AND workspace_id = ?", noteID, ws).First(&note).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "nota não encontrada"})
	}
	if note.AuthorUserID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o autor pode excluir"})
	}
	h.db.Delete(&note)
	return c.JSON(fiber.Map{"ok": true})
}

// -- helpers ----------------------------------------------------------------

func (h *ConversationHandler) assertAccess(workspaceID, id uuid.UUID) error {
	var count int64
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND id = ?", workspaceID, id).Count(&count)
	if count == 0 {
		return fiber.NewError(fiber.StatusNotFound, "atendimento não encontrado")
	}
	return nil
}

// resolveIDOrKey é o atalho pros endpoints que só precisam do UUID (não
// da conv inteira). Tenta UUID; cai pra channel_key se falhar; valida
// access via workspace.
func (h *ConversationHandler) resolveIDOrKey(c *fiber.Ctx) (uuid.UUID, uuid.UUID, error) {
	ws := middleware.GetWorkspaceID(c)
	rawID := c.Params("id")
	if id, err := uuid.Parse(rawID); err == nil {
		if err := h.assertAccess(ws, id); err != nil {
			return uuid.Nil, ws, err
		}
		return id, ws, nil
	}
	var conv models.Conversation
	if err := h.db.Select("id").
		Where("workspace_id = ? AND channel_key = ?", ws, rawID).
		Order("updated_at DESC").
		First(&conv).Error; err != nil {
		return uuid.Nil, ws, fiber.NewError(fiber.StatusNotFound, "atendimento não encontrado")
	}
	return conv.ID, ws, nil
}

func (h *ConversationHandler) setStatus(c *fiber.Ctx, status models.ConversationStatus, mutator func(*models.Conversation)) error {
	ws := middleware.GetWorkspaceID(c)
	convPtr, err := h.resolveConvByIDOrKey(c.Params("id"), ws, nil)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	conv := *convPtr
	prev := conv.Status
	conv.Status = status
	if mutator != nil {
		mutator(&conv)
	}
	h.db.Save(&conv)

	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&conv, models.ConvEventStatusChanged, actor, map[string]any{"from": prev, "to": status})
	h.broadcast(&conv, "conversation.status_changed", map[string]any{"from": prev, "to": status})
	return c.JSON(conv)
}

func (h *ConversationHandler) appendEvent(conv *models.Conversation, t models.ConversationEventType, actorUserID uuid.UUID, payload map[string]any) {
	h.db.Create(&models.ConversationEvent{
		ConversationID: conv.ID,
		WorkspaceID:    conv.WorkspaceID,
		ActorType:      models.ActorUser,
		ActorUserID:    &actorUserID,
		EventType:      t,
		Payload:        jsonEncode(payload),
	})
}

func (h *ConversationHandler) broadcast(conv *models.Conversation, topic string, extra map[string]any) {
	hub := whatsapp.GetHub()
	if hub == nil {
		return
	}
	payload := map[string]any{"conversation_id": conv.ID}
	for k, v := range extra {
		payload[k] = v
	}
	hub.Broadcast(&whatsapp.Event{
		Type:      topic,
		Workspace: conv.WorkspaceID.String(),
		Instance:  conv.InstanceID.String(),
		Payload:   payload,
	})
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}

func jsonEncode(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func pickReason(actorID, targetID uuid.UUID) string {
	if actorID == targetID {
		return "self_pick"
	}
	return "manual"
}

// timelineEntry is the shape returned by Timeline for a merged feed of
// messages, notes and events.
type timelineEntry struct {
	Kind    string      `json:"kind"` // message | note | event
	At      time.Time   `json:"at"`
	ID      uuid.UUID   `json:"id"`
	Payload interface{} `json:"payload"`
}

// sortEntriesDesc performs a simple in-place insertion sort; suitable for the
// ~300-row slices we build in Timeline.
func sortEntriesDesc(entries []timelineEntry) {
	for i := 1; i < len(entries); i++ {
		j := i
		for j > 0 && entries[j-1].At.Before(entries[j].At) {
			entries[j-1], entries[j] = entries[j], entries[j-1]
			j--
		}
	}
}

// resolveMediaURLs foi movido pra internal/storage/resolver.go pra ser
// reutilizado pelo Timeline, Get e pelo WS broadcast (inbound pipeline).

// populateReplyTo enriquece cada MessageLog com snapshot da mensagem citada.
// Coleta os reply_to_id únicos, faz UMA query batch, monta map e atribui
// cada msg.ReplyTo. Evita N+1 ao renderizar timeline com muitos quotes.
//
// Para texto, extrai do JSON content (campo "text" ou "caption" ou raw).
// Para mídia, copia url+mime pra preview thumbnail.
func (h *ConversationHandler) populateReplyTo(ctx context.Context, messages []models.MessageLog) {
	if len(messages) == 0 {
		return
	}
	idSet := make(map[uuid.UUID]struct{})
	for i := range messages {
		if messages[i].ReplyToID != nil {
			idSet[*messages[i].ReplyToID] = struct{}{}
		}
	}
	if len(idSet) == 0 {
		return
	}
	ids := make([]uuid.UUID, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	var refs []models.MessageLog
	if err := h.db.Where("id IN ?", ids).Find(&refs).Error; err != nil {
		log.Warn().Err(err).Msg("populateReplyTo: batch query falhou")
		return
	}
	byID := make(map[uuid.UUID]*models.MessageLog, len(refs))
	for i := range refs {
		// Resolve mídia também na quoted (thumbnail vai aparecer)
		refs[i].Content = storage.ResolveMediaURLs(ctx, refs[i].Content)
		byID[refs[i].ID] = &refs[i]
	}
	for i := range messages {
		if messages[i].ReplyToID == nil {
			continue
		}
		ref, ok := byID[*messages[i].ReplyToID]
		if !ok {
			continue
		}
		preview := &models.MessageLogReplyPreview{
			ID:         ref.ID,
			Direction:  ref.Direction,
			Type:       ref.Type,
			SenderName: ref.SenderName,
		}
		// Extrai texto+url+mime do content (legacy texto puro ou JSON estruturado)
		if ref.Content != "" {
			var asObj map[string]any
			if err := json.Unmarshal([]byte(ref.Content), &asObj); err == nil {
				if v, ok := asObj["text"].(string); ok {
					preview.Text = v
				}
				if preview.Text == "" {
					if v, ok := asObj["caption"].(string); ok {
						preview.Text = v
					}
				}
				if v, ok := asObj["url"].(string); ok {
					preview.MediaURL = v
				}
				if v, ok := asObj["mime_type"].(string); ok {
					preview.MimeType = v
				}
			} else {
				// raw text — pode estar JSON-encoded ("...") ou puro
				var s string
				if json.Unmarshal([]byte(ref.Content), &s) == nil {
					preview.Text = s
				} else {
					preview.Text = ref.Content
				}
			}
		}
		// Truncate texto pra preview compacto
		if len(preview.Text) > 280 {
			preview.Text = preview.Text[:280] + "…"
		}
		messages[i].ReplyTo = preview
	}
}

// resolveConvByIDOrKey aceita UUID OU channel_key (JID/lid) e devolve a
// conversa correspondente dentro do workspace. Útil pra integradores
// externos (n8n, webhooks downstream) que recebem channel_key e não têm
// o UUID interno do Uniq.
//
// O parâmetro opcional `q` permite passar uma query customizada com
// preloads. Se nil, usa h.db direto.
func (h *ConversationHandler) resolveConvByIDOrKey(rawID string, ws uuid.UUID, q *gorm.DB) (*models.Conversation, error) {
	if q == nil {
		q = h.db
	}
	var conv models.Conversation
	if id, err := uuid.Parse(rawID); err == nil {
		if err := q.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
			return nil, err
		}
		return &conv, nil
	}
	if err := q.Where("workspace_id = ? AND channel_key = ?", ws, rawID).
		Order("updated_at DESC").
		First(&conv).Error; err != nil {
		return nil, err
	}
	return &conv, nil
}

// ── Agent State per Conversation ────────────────────────────────────────────

// GetAgentState GET /v1/conversations/:id/agent-state
// Retorna o estado operacional do agente para a conversa.
func (h *ConversationHandler) GetAgentState(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}

	var state models.ConversationAgentState
	if err := h.db.Preload("Agent").Where("conversation_id = ?", id).First(&state).Error; err != nil {
		// Sem state explícito — retorna estado padrão derivado de is_bot_active
		var conv models.Conversation
		h.db.Select("id, is_bot_active").Where("id = ?", id).First(&conv)
		mode := models.AgentModeActive
		if !conv.IsBotActive {
			mode = models.AgentModeDisabled
		}
		return c.JSON(fiber.Map{
			"conversation_id": id,
			"mode":            mode,
			"agent_id":        nil,
			"agent":           nil,
			"last_suggestion": "",
			"suggestion_at":   nil,
			"handoff_reason":  "",
		})
	}
	return c.JSON(state)
}

// SetAgentState PATCH /v1/conversations/:id/agent-state
// Atualiza o modo e/ou agente da conversa.
// Body: { mode: "active"|"observing"|"disabled", agent_id?: uuid, handoff_reason?: string }
func (h *ConversationHandler) SetAgentState(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}

	var body struct {
		Mode           string  `json:"mode"`
		AgentID        *string `json:"agent_id"`
		HandoffReason  string  `json:"handoff_reason"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	mode := models.AgentMode(body.Mode)
	if mode != models.AgentModeActive && mode != models.AgentModeObserving && mode != models.AgentModeDisabled {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "mode deve ser active, observing ou disabled"})
	}

	var agentID *uuid.UUID
	if body.AgentID != nil && *body.AgentID != "" {
		parsed, err := uuid.Parse(*body.AgentID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "agent_id inválido"})
		}
		agentID = &parsed
	}

	var state models.ConversationAgentState
	result := h.db.Where("conversation_id = ?", id).First(&state)
	if result.Error != nil {
		// Create
		state = models.ConversationAgentState{
			ConversationID: id,
			Mode:           mode,
			AgentID:        agentID,
			HandoffReason:  body.HandoffReason,
		}
		h.db.Create(&state)
	} else {
		// Update
		updates := map[string]any{"mode": mode, "handoff_reason": body.HandoffReason}
		if agentID != nil {
			updates["agent_id"] = agentID
		}
		h.db.Model(&state).Updates(updates)
	}

	// Sync is_bot_active on conversation for backward compat
	botActive := mode == models.AgentModeActive || mode == models.AgentModeObserving
	h.db.Model(&models.Conversation{}).Where("id = ?", id).Update("is_bot_active", botActive)

	// Audit event
	actor := middleware.GetCurrentUserID(c)
	h.db.Create(&models.ConversationEvent{
		ConversationID: id,
		WorkspaceID:    ws,
		ActorType:      models.ActorUser,
		ActorUserID:    &actor,
		EventType:      models.ConvEventBotHandoff,
		Payload:        jsonEncode(map[string]any{"mode": mode, "handoff_reason": body.HandoffReason}),
	})

	h.db.Preload("Agent").Where("conversation_id = ?", id).First(&state)
	return c.JSON(state)
}

// SuggestAgentReply POST /v1/conversations/:id/agent/suggest
// Gera uma sugestão de resposta sem enviar — para uso no modo "observing".
// Salva a sugestão no ConversationAgentState e retorna o texto.
func (h *ConversationHandler) SuggestAgentReply(c *fiber.Ctx) error {
	if h.llm == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "LLM não configurado"})
	}
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}

	// Load conversation + agent
	var conv models.Conversation
	if err := h.db.Where("id = ? AND workspace_id = ?", id, ws).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "conversa não encontrada"})
	}

	// Resolve agent: check override first, then instance
	var agent models.InstanceAgent
	var state models.ConversationAgentState
	hasState := h.db.Preload("Agent").Where("conversation_id = ?", id).First(&state).Error == nil

	if hasState && state.AgentID != nil {
		if err := h.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
			return tx.Where("is_active = ?", true)
		}).Where("id = ? AND is_active = ?", *state.AgentID, true).First(&agent).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "agente configurado não encontrado"})
		}
	} else {
		// Fallback: instance agent
		if err := h.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
			return tx.Where("is_active = ?", true)
		}).Where("instance_id = ? AND is_active = ?", conv.InstanceID, true).First(&agent).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "nenhum agente ativo nesta instância"})
		}
	}

	if agent.Integration == nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "agente sem integração de LLM configurada"})
	}

	// Load last messages for context
	var logs []models.MessageLog
	h.db.Where("conversation_id = ?", id).Order("created_at DESC").Limit(10).Find(&logs)

	var historyLines []string
	for i := len(logs) - 1; i >= 0; i-- {
		l := logs[i]
		content := l.Content
		var s string
		if json.Unmarshal([]byte(content), &s) == nil {
			content = s
		}
		content = strings.TrimSpace(content)
		if content == "" {
			continue
		}
		role := "Cliente"
		if l.Direction == models.DirectionOut {
			role = "Agente"
		}
		historyLines = append(historyLines, "- "+role+": "+content)
	}

	contactName := ""
	if conv.Contact != nil {
		contactName = conv.Contact.Name
	}

	systemPrompt := services.BuildAgentSystemPrompt(&agent, agent.Assets)
	userPrompt := "Contexto da conversa em tempo real.\n" +
		"Contato: " + contactName + "\n" +
		"Canal: " + string(conv.ChannelType) + "\n\n"
	if len(historyLines) > 0 {
		userPrompt += "Histórico recente:\n" + strings.Join(historyLines, "\n") + "\n\n"
	}
	userPrompt += "Gere uma sugestão de resposta para o próximo turno. Seja conciso e natural.\n" +
		"Responda como o agente configurado, sem mencionar prompts ou estrutura interna."

	integration := agent.Integration
	if model := strings.TrimSpace(agent.Model); model != "" {
		integCopy := *integration
		if b, err := json.Marshal([]string{model}); err == nil {
			integCopy.Models = string(b)
		}
		integration = &integCopy
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	suggestion, err := h.llm.CallChatWithSystem(ctx, integration, systemPrompt, userPrompt, false)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao gerar sugestão: " + err.Error()})
	}
	suggestion = strings.TrimSpace(suggestion)

	// Persist suggestion in state
	now := time.Now()
	if hasState {
		h.db.Model(&state).Updates(map[string]any{
			"last_suggestion": suggestion,
			"suggestion_at":   now,
		})
	} else {
		state = models.ConversationAgentState{
			ConversationID:  id,
			Mode:            models.AgentModeObserving,
			LastSuggestion:  suggestion,
			SuggestionAt:    &now,
		}
		h.db.Create(&state)
	}

	return c.JSON(fiber.Map{
		"suggestion":    suggestion,
		"suggestion_at": now,
		"agent_name":    agent.AgentName,
		"model":         agent.Model,
	})
}

// SetWindowKeeper PATCH /v1/conversations/:id/window-keeper
// Body: { enabled: bool, message?: string }
// Ativa/desativa o envio automático de mensagem para manter a janela WABA de 24h aberta.
func (h *ConversationHandler) SetWindowKeeper(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		Enabled bool   `json:"enabled"`
		Message string `json:"message"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	updates := map[string]any{
		"window_keeper_enabled": body.Enabled,
	}
	if body.Message != "" {
		updates["window_keeper_message"] = body.Message
	}

	if err := h.db.Model(&models.Conversation{}).
		Where("id = ? AND workspace_id = ?", id, ws).
		Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "enabled": body.Enabled})
}
