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
}

func NewConversationHandler(
	db *gorm.DB,
	manager *whatsapp.Manager,
	outboundReg *outbound.Registry,
	pipeline *services.InboundPipeline,
) *ConversationHandler {
	return &ConversationHandler{db: db, manager: manager, outbound: outboundReg, pipeline: pipeline}
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
		Preload("Instance", func(tx *gorm.DB) *gorm.DB {
			return tx.Select("id, name, channel, phone_number")
		}).
		Order("COALESCE(last_message_at, updated_at) DESC").
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
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Preload("Contact").Preload("AssignedUser").
		Preload("Instance", func(tx *gorm.DB) *gorm.DB {
			return tx.Select("id, name, channel, phone_number")
		}).
		Where("workspace_id = ? AND id = ?", ws, id).
		First(&conv).Error; err != nil {
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
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}

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
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}

	var body struct {
		Subject    *string `json:"subject"`
		Priority   *string `json:"priority"`
		SubStatus  *string `json:"sub_status"`
		IsArchived *bool   `json:"is_archived"`
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
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
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
			_, sendErr := h.outbound.Send(ctx, &inst, outbound.OutboundMessage{
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
			})
			if sendErr != nil {
				sendStatus = models.MessageStatusFailed
				sendErrStr = sendErr.Error()
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

// Typing POST /v1/conversations/:id/typing  { typing: bool }
// Emite indicador de digitação pelo canal (hoje apenas WhatsApp whatsmeow
// implementa; outros canais viram no-op silencioso).
func (h *ConversationHandler) Typing(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		Typing bool `json:"typing"`
	}
	c.BodyParser(&body)
	var conv models.Conversation
	if err := h.db.Select("instance_id, channel_key").
		Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
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
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.Model(&models.Conversation{}).Where("id = ?", id).Updates(map[string]any{
		"unread_count":       0,
		"agent_unread_count": 0,
	})
	h.broadcast(&models.Conversation{ID: id, WorkspaceID: ws}, "conversation.read", map[string]any{"by_user_id": middleware.GetCurrentUserID(c), "at": time.Now()})
	return c.JSON(fiber.Map{"ok": true})
}

// Assign POST /v1/conversations/:id/assign  { user_id }
// Race-safe: only succeeds if the conversation is currently unassigned OR the
// actor has tickets:view_all (supervisor reassignment).
func (h *ConversationHandler) Assign(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
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

	// Fetch current state
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
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
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		QueueID string `json:"queue_id"`
		TeamID  string `json:"team_id"`
		UserID  string `json:"user_id"`
		Note    string `json:"note"`
	}
	c.BodyParser(&body)

	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}

	updates := map[string]any{}
	var toQueue *uuid.UUID
	if body.QueueID != "" {
		if qid, err := uuid.Parse(body.QueueID); err == nil {
			updates["queue_id"] = qid
			toQueue = &qid
			var q models.Queue
			if h.db.First(&q, "id = ?", qid).Error == nil {
				updates["department_id"] = q.DepartmentID
				updates["team_id"] = q.TeamID
			}
		}
	}
	if body.TeamID != "" {
		if tid, err := uuid.Parse(body.TeamID); err == nil {
			updates["team_id"] = tid
		}
	}
	var toUser *uuid.UUID
	if body.UserID != "" {
		if uid, err := uuid.Parse(body.UserID); err == nil {
			updates["assigned_user_id"] = uid
			toUser = &uid
		}
	} else if _, ok := updates["queue_id"]; ok {
		// Transferring to a queue drops the current assignee
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
		ConversationID: id,
		WorkspaceID:    ws,
		FromUserID:     conv.AssignedUserID,
		ToUserID:       toUser,
		FromQueueID:    conv.QueueID,
		ToQueueID:      toQueue,
		Reason:         "transfer",
		ActorUserID:    &actor,
		Note:           body.Note,
	})
	h.appendEvent(&conv, models.ConvEventTransferred, actor, map[string]any{"to_queue_id": toQueue, "to_user_id": toUser, "note": body.Note})
	h.db.Where("id = ?", id).First(&conv)
	h.broadcast(&conv, "conversation.transferred", map[string]any{"to_queue_id": toQueue, "to_user_id": toUser})
	return c.JSON(conv)
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
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
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
	return c.JSON(fiber.Map{"ok": true})
}

// RemoveTag DELETE /v1/conversations/:id/tags/:tagId
func (h *ConversationHandler) RemoveTag(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	tagID, err := uuid.Parse(c.Params("tagId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tagId inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	h.ensureConversationTagsTable()
	h.db.Exec(`DELETE FROM conversation_tags WHERE conversation_id = ? AND tag_id = ?`, id, tagID)
	actor := middleware.GetCurrentUserID(c)
	h.appendEvent(&models.Conversation{ID: id, WorkspaceID: ws}, models.ConvEventTagRemoved, actor, map[string]any{"tag_id": tagID})
	return c.JSON(fiber.Map{"ok": true})
}

// ListTags GET /v1/conversations/:id/tags
func (h *ConversationHandler) ListTags(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.assertAccess(ws, id); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
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

func (h *ConversationHandler) setStatus(c *fiber.Ctx, status models.ConversationStatus, mutator func(*models.Conversation)) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
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
