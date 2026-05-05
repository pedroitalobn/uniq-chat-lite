package handlers

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

func (h *ToolsHandler) toolListCampaigns(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	limit := 20
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 100 {
		limit = int(v)
	}

	q := h.db.Model(&models.Campaign{}).Where("workspace_id = ?", wsID)
	if status, ok := args["status"].(string); ok && status != "" {
		q = q.Where("status = ?", status)
	}

	var rows []models.Campaign
	q.Order("created_at DESC").Limit(limit).Find(&rows)

	out := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		out = append(out, map[string]any{
			"id":           c.ID.String(),
			"name":         c.Name,
			"status":       c.Status,
			"channel":      c.Channel,
			"action_type":  c.ActionType,
			"total_count":  c.TotalCount,
			"sent_count":   c.SentCount,
			"failed_count": c.FailedCount,
			"started_at":   c.StartedAt,
			"created_at":   c.CreatedAt.Format("2006-01-02 15:04"),
		})
	}

	return map[string]any{"count": len(out), "campaigns": out}
}

func (h *ToolsHandler) toolGetCampaign(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["campaign_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "campaign_id inválido"}
	}

	var c models.Campaign
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "campanha não encontrada"}
	}

	var pendingCount, sentCount, failedCount int64
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ? AND status = ?", cid, models.RecipientStatusPending).Count(&pendingCount)
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ? AND status = ?", cid, models.RecipientStatusSent).Count(&sentCount)
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ? AND status = ?", cid, models.RecipientStatusFailed).Count(&failedCount)

	return map[string]any{
		"id":             c.ID.String(),
		"name":           c.Name,
		"status":         c.Status,
		"channel":        c.Channel,
		"action_type":    c.ActionType,
		"message_text":   c.MessageText,
		"recipient_type": c.RecipientType,
		"total_count":    c.TotalCount,
		"sent_count":     sentCount,
		"failed_count":   failedCount,
		"pending_count":  pendingCount,
		"delay_min":      c.DelayMinSeconds,
		"delay_max":      c.DelayMaxSeconds,
		"started_at":     c.StartedAt,
		"completed_at":   c.CompletedAt,
		"created_at":     c.CreatedAt.Format("2006-01-02 15:04"),
	}
}

func (h *ToolsHandler) toolCreateCampaign(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	name, _ := args["name"].(string)
	instanceIDStr, _ := args["instance_id"].(string)
	messageText, _ := args["message_text"].(string)

	if name == "" || instanceIDStr == "" || messageText == "" {
		return map[string]any{"error": "name, instance_id e message_text são obrigatórios"}
	}

	iid, err := uuid.Parse(instanceIDStr)
	if err != nil {
		return map[string]any{"error": "instance_id inválido"}
	}

	var inst models.Instance
	if err := h.db.Where("id = ? AND user_id = ?", iid, userID).First(&inst).Error; err != nil {
		return map[string]any{"error": "instância não encontrada"}
	}

	c := models.Campaign{
		UserID:        userID,
		WorkspaceID:   &wsID,
		InstanceID:    iid,
		Name:          name,
		Channel:       string(inst.Channel),
		MessageText:   messageText,
		Status:        models.CampaignStatusDraft,
		RecipientType: "contacts",
	}

	if v, ok := args["recipient_type"].(string); ok && v != "" {
		c.RecipientType = v
	}

	if err := h.db.Create(&c).Error; err != nil {
		return map[string]any{"error": fmt.Sprintf("erro ao criar campanha: %v", err)}
	}

	return map[string]any{
		"success":     true,
		"campaign_id": c.ID.String(),
		"message":     fmt.Sprintf("Campanha '%s' criada como rascunho. Use start_campaign para iniciar.", c.Name),
	}
}

func (h *ToolsHandler) toolStartCampaign(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["campaign_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "campaign_id inválido"}
	}

	var c models.Campaign
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "campanha não encontrada"}
	}

	if c.Status == models.CampaignStatusRunning {
		return map[string]any{"error": "campanha já está em execução"}
	}
	if c.Status == models.CampaignStatusCompleted {
		return map[string]any{"error": "campanha já foi concluída"}
	}

	now := time.Now()
	if err := h.db.Model(&c).Updates(map[string]any{
		"status":     models.CampaignStatusRunning,
		"started_at": now,
	}).Error; err != nil {
		return map[string]any{"error": "erro ao iniciar campanha"}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Campanha '%s' iniciada", c.Name),
	}
}

func (h *ToolsHandler) toolPauseCampaign(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["campaign_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "campaign_id inválido"}
	}

	var c models.Campaign
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "campanha não encontrada"}
	}

	if c.Status != models.CampaignStatusRunning {
		return map[string]any{"error": "campanha não está em execução"}
	}

	if err := h.db.Model(&c).Update("status", models.CampaignStatusPaused).Error; err != nil {
		return map[string]any{"error": "erro ao pausar campanha"}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Campanha '%s' pausada", c.Name),
	}
}
