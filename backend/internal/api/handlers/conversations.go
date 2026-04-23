// Package handlers — Conversations handler exposes the ticketing REST API.
// Routes are registered under /v1/conversations (see router.go) and protected
// by RequireWorkspacePermission with tickets:* / notes:* keys.
package handlers

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ConversationHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewConversationHandler(db *gorm.DB, manager *whatsapp.Manager) *ConversationHandler {
	return &ConversationHandler{db: db, manager: manager}
}

// -- list -------------------------------------------------------------------

// List GET /v1/conversations
// Query: status, channel, queue_id, assigned_user_id=me|<uuid>, contact_id,
//        priority, is_archived, q (search in subject/preview), cursor, limit
func (h *ConversationHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)

	q := h.db.Model(&models.Conversation{}).Where("workspace_id = ?", ws)

	if s := c.Query("status"); s != "" {
		q = q.Where("status IN ?", strings.Split(s, ","))
	}
	if ch := c.Query("channel"); ch != "" {
		q = q.Where("channel_type = ?", ch)
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
	err := q.Preload("Contact").Preload("AssignedUser").
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
		Where("workspace_id = ? AND id = ?", ws, id).
		First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
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

// SendMessage POST /v1/conversations/:id/messages  { body, type? }
// For Fase 1-3 only text is supported; the outbound sender registry (Fase 5)
// will expand this to media/templates across channels.
func (h *ConversationHandler) SendMessage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		Body string `json:"body"`
		Type string `json:"type"`
	}
	if err := c.BodyParser(&body); err != nil || strings.TrimSpace(body.Body) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body é obrigatório"})
	}
	msgType := body.Type
	if msgType == "" {
		msgType = "text"
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
	// Persist outbound MessageLog (status=pending; manager will mark sent on ack)
	contentJSON, _ := json.Marshal(body.Body)
	log := models.MessageLog{
		InstanceID:     conv.InstanceID,
		WorkspaceID:    &wsCopy,
		UserID:         &userID,
		ConversationID: &conv.ID,
		Direction:      models.DirectionOut,
		Type:           msgType,
		ToJID:          conv.ChannelKey,
		Content:        string(contentJSON),
		Status:         models.MessageStatusPending,
	}
	if err := h.db.Create(&log).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Deliver via channel-specific sender. Fase 3 MVP: WhatsApp/WABA only.
	// Other channels (Instagram/TikTok) fall back to just persisting the
	// MessageLog — they'll light up when the sender Registry lands.
	sendStatus := models.MessageStatusSent
	sendErrStr := ""
	if h.manager != nil {
		if client := h.manager.GetInstance(conv.InstanceID.String()); client != nil && client.IsConnected() {
			if _, sendErr := client.SendTextMessage(conv.ChannelKey, body.Body); sendErr != nil {
				sendStatus = models.MessageStatusFailed
				sendErrStr = sendErr.Error()
			}
		}
	}
	updates := map[string]any{"status": sendStatus}
	if sendErrStr != "" {
		// Append error details into content alongside the original text so the
		// agent UI can show why it failed without touching schema.
		updates["content"] = string(contentJSON) + " /* err: " + truncate(sendErrStr, 200) + " */"
	}
	h.db.Model(&log).Updates(updates)

	// Denormalizations: the conversation's last-message fields
	now := time.Now()
	preview := body.Body
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
		MessageLogID:   &log.ID,
		Payload:        `{"direction":"out","type":"` + msgType + `"}`,
	})

	h.broadcast(&conv, "conversation.message", map[string]any{"message": log})
	return c.Status(fiber.StatusCreated).JSON(log)
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
