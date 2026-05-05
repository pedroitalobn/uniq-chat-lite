package handlers

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

func (h *ToolsHandler) toolGetDashboardStats(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	var convOpen, convPending, convResolved int64
	var contactCount, dealCount, dealWon int64
	var campaignRunning, campaignTotal int64

	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND status = ? AND is_archived = false", wsID, "open").Count(&convOpen)
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND status = ? AND is_archived = false", wsID, "pending").Count(&convPending)
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND status = ? AND is_archived = false", wsID, "resolved").Count(&convResolved)

	h.db.Model(&models.Contact{}).Where("workspace_id = ?", wsID).Count(&contactCount)
	h.db.Model(&models.Deal{}).Where("workspace_id = ? AND status = ?", wsID, models.DealStatusOpen).Count(&dealCount)
	h.db.Model(&models.Deal{}).Where("workspace_id = ? AND status = ?", wsID, models.DealStatusWon).Count(&dealWon)

	h.db.Model(&models.Campaign{}).Where("workspace_id = ? AND status = ?", wsID, models.CampaignStatusRunning).Count(&campaignRunning)
	h.db.Model(&models.Campaign{}).Where("workspace_id = ?", wsID).Count(&campaignTotal)

	// Deal pipeline value
	var openDealValue struct{ Total int64 }
	h.db.Model(&models.Deal{}).Select("SUM(value) as total").
		Where("workspace_id = ? AND status = ?", wsID, models.DealStatusOpen).Scan(&openDealValue)

	return map[string]any{
		"conversations": map[string]any{
			"open":     convOpen,
			"pending":  convPending,
			"resolved": convResolved,
		},
		"crm": map[string]any{
			"contacts":        contactCount,
			"deals_open":      dealCount,
			"deals_won":       dealWon,
			"pipeline_value":  fmt.Sprintf("R$ %.2f", float64(openDealValue.Total)/100),
		},
		"campaigns": map[string]any{
			"running": campaignRunning,
			"total":   campaignTotal,
		},
		"summary": fmt.Sprintf("%d conversas abertas, %d contatos, %d deals ativos, %d campanhas rodando",
			convOpen, contactCount, dealCount, campaignRunning),
	}
}

func (h *ToolsHandler) toolGetConversationStats(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	days := 7
	if v, ok := args["days"].(float64); ok && v > 0 && v <= 90 {
		days = int(v)
	}

	since := time.Now().AddDate(0, 0, -days)

	var total, open, resolved, closed int64
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND created_at >= ?", wsID, since).Count(&total)
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND created_at >= ? AND status = ?", wsID, since, "open").Count(&open)
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND created_at >= ? AND status = ?", wsID, since, "resolved").Count(&resolved)
	h.db.Model(&models.Conversation{}).Where("workspace_id = ? AND created_at >= ? AND status = ?", wsID, since, "closed").Count(&closed)

	// Messages sent in period
	var msgOut, msgIn int64
	h.db.Model(&models.MessageLog{}).Where("workspace_id = ? AND created_at >= ? AND direction = ?", wsID, since, "out").Count(&msgOut)
	h.db.Model(&models.MessageLog{}).Where("workspace_id = ? AND created_at >= ? AND direction = ?", wsID, since, "in").Count(&msgIn)

	return map[string]any{
		"period_days":   days,
		"conversations": map[string]any{
			"total":    total,
			"open":     open,
			"resolved": resolved,
			"closed":   closed,
		},
		"messages": map[string]any{
			"sent":     msgOut,
			"received": msgIn,
		},
		"summary": fmt.Sprintf("Nos últimos %d dias: %d conversas criadas, %d resolvidas, %d mensagens enviadas",
			days, total, resolved, msgOut),
	}
}
