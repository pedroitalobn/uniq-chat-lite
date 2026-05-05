package handlers

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

func (h *ToolsHandler) toolListConversations(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	limit := 20
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 100 {
		limit = int(v)
	}

	q := h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND is_archived = false", wsID)

	if status, ok := args["status"].(string); ok && status != "" {
		q = q.Where("status = ?", status)
	} else {
		q = q.Where("status IN ?", []string{"open", "pending"})
	}
	if assignedTo, ok := args["assigned_to"].(string); ok && assignedTo != "" {
		if uid, err := uuid.Parse(assignedTo); err == nil {
			q = q.Where("assigned_user_id = ?", uid)
		}
	}

	var rows []models.Conversation
	q.Preload("Contact").Order("last_message_at DESC").Limit(limit).Find(&rows)

	out := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		item := map[string]any{
			"id":               c.ID.String(),
			"status":           c.Status,
			"channel_type":     c.ChannelType,
			"priority":         c.Priority,
			"unread_count":     c.UnreadCount,
			"message_count":    c.MessageCount,
			"last_preview":     c.LastMessagePreview,
			"last_message_at":  c.LastMessageAt,
			"subject":          c.Subject,
		}
		if c.Contact != nil {
			item["contact_name"] = c.Contact.Name
			item["contact_phone"] = c.Contact.Phone
			item["contact_id"] = c.Contact.ID.String()
		}
		if c.AssignedUserID != nil {
			item["assigned_user_id"] = c.AssignedUserID.String()
		}
		out = append(out, item)
	}

	return map[string]any{"count": len(out), "conversations": out}
}

func (h *ToolsHandler) toolGetConversation(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["conversation_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "conversation_id inválido"}
	}

	var c models.Conversation
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).
		Preload("Contact").Preload("Queue").First(&c).Error; err != nil {
		return map[string]any{"error": "conversa não encontrada"}
	}

	var messages []models.MessageLog
	h.db.Where("conversation_id = ?", cid).
		Order("created_at DESC").Limit(10).Find(&messages)

	msgs := make([]map[string]any, 0, len(messages))
	for _, m := range messages {
		msgs = append(msgs, map[string]any{
			"id":        m.ID.String(),
			"direction": m.Direction,
			"content":   m.Content,
			"type":      m.Type,
			"sent_at":   m.CreatedAt.Format("2006-01-02 15:04"),
		})
	}

	result := map[string]any{
		"id":              c.ID.String(),
		"status":          c.Status,
		"channel_type":    c.ChannelType,
		"priority":        c.Priority,
		"message_count":   c.MessageCount,
		"subject":         c.Subject,
		"is_bot_active":   c.IsBotActive,
		"last_message_at": c.LastMessageAt,
		"last_messages":   msgs,
	}
	if c.Contact != nil {
		result["contact"] = map[string]any{
			"id":    c.Contact.ID.String(),
			"name":  c.Contact.Name,
			"phone": c.Contact.Phone,
		}
	}
	if c.Queue != nil {
		result["queue"] = map[string]any{
			"id":   c.Queue.ID.String(),
			"name": c.Queue.Name,
		}
	}

	return result
}

func (h *ToolsHandler) toolAssignConversation(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	convIDStr, _ := args["conversation_id"].(string)
	cid, err := uuid.Parse(convIDStr)
	if err != nil {
		return map[string]any{"error": "conversation_id inválido"}
	}

	var c models.Conversation
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "conversa não encontrada"}
	}

	updates := map[string]any{}

	if assignIDStr, ok := args["assign_to_user_id"].(string); ok && assignIDStr != "" {
		aid, err := uuid.Parse(assignIDStr)
		if err != nil {
			return map[string]any{"error": "assign_to_user_id inválido"}
		}
		updates["assigned_user_id"] = aid
	}

	if queueIDStr, ok := args["queue_id"].(string); ok && queueIDStr != "" {
		qid, err := uuid.Parse(queueIDStr)
		if err != nil {
			return map[string]any{"error": "queue_id inválido"}
		}
		updates["queue_id"] = qid
	}

	if len(updates) == 0 {
		return map[string]any{"error": "assign_to_user_id ou queue_id são necessários"}
	}

	if err := h.db.Model(&c).Updates(updates).Error; err != nil {
		return map[string]any{"error": "erro ao atribuir conversa"}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Conversa %s atribuída com sucesso", convIDStr[:8]),
	}
}

func (h *ToolsHandler) toolCloseConversation(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["conversation_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "conversation_id inválido"}
	}

	var c models.Conversation
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "conversa não encontrada"}
	}

	status := "resolved"
	if v, ok := args["status"].(string); ok && (v == "resolved" || v == "closed") {
		status = v
	}

	if err := h.db.Model(&c).Update("status", status).Error; err != nil {
		return map[string]any{"error": "erro ao fechar conversa"}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Conversa marcada como '%s'", status),
	}
}

func (h *ToolsHandler) toolListQueues(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	var queues []models.Queue
	h.db.Where("workspace_id = ? AND is_active = true", wsID).Order("name ASC").Find(&queues)

	out := make([]map[string]any, 0, len(queues))
	for _, q := range queues {
		out = append(out, map[string]any{
			"id":                  q.ID.String(),
			"name":                q.Name,
			"description":         q.Description,
			"assignment_strategy": q.AssignmentStrategy,
			"is_active":           q.IsActive,
			"enable_chatbot":      q.EnableChatbot,
		})
	}

	return map[string]any{"count": len(out), "queues": out}
}
