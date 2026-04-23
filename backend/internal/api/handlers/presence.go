package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type PresenceHandler struct{ db *gorm.DB }

func NewPresenceHandler(db *gorm.DB) *PresenceHandler { return &PresenceHandler{db: db} }

// GetMine GET /v1/me/presence
func (h *PresenceHandler) GetMine(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	p := h.loadOrDefault(userID, ws)
	return c.JSON(p)
}

// UpdateMine PUT /v1/me/presence  { status, status_message?, away_reason?, max_load? }
// Also acts as a heartbeat — LastSeenAt is always refreshed.
func (h *PresenceHandler) UpdateMine(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	var body struct {
		Status        *string `json:"status"`
		StatusMessage *string `json:"status_message"`
		AwayReason    *string `json:"away_reason"`
		MaxLoad       *int    `json:"max_load"`
	}
	c.BodyParser(&body)
	p := h.loadOrDefault(userID, ws)
	now := time.Now()
	updates := map[string]any{
		"last_seen_at": now,
		"updated_at":   now,
	}
	if body.Status != nil {
		updates["status"] = *body.Status
	}
	if body.StatusMessage != nil {
		updates["status_message"] = *body.StatusMessage
	}
	if body.AwayReason != nil {
		updates["away_reason"] = *body.AwayReason
	}
	if body.MaxLoad != nil {
		updates["max_load"] = *body.MaxLoad
	}
	h.db.Model(&models.UserPresence{}).
		Where("user_id = ? AND workspace_id = ?", userID, ws).
		Updates(updates)
	h.db.Where("user_id = ? AND workspace_id = ?", userID, ws).First(&p)

	// Broadcast presence.changed (payload shape matches the frontend hook)
	if hub := whatsapp.GetHub(); hub != nil {
		hub.Broadcast(&whatsapp.Event{
			Type:      "presence.changed",
			Workspace: ws.String(),
			Payload:   p,
		})
	}
	return c.JSON(p)
}

// MyWorkload GET /v1/me/workload
// Counters for the signed-in user in the active workspace.
func (h *PresenceHandler) MyWorkload(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	counts := fiber.Map{}
	var open, pending, snoozed int64
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND assigned_user_id = ? AND status = ?", ws, userID, models.ConversationStatusOpen).
		Count(&open)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND assigned_user_id = ? AND status = ?", ws, userID, models.ConversationStatusPending).
		Count(&pending)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND assigned_user_id = ? AND status = ?", ws, userID, models.ConversationStatusSnoozed).
		Count(&snoozed)
	counts["open"] = open
	counts["pending"] = pending
	counts["snoozed"] = snoozed
	return c.JSON(counts)
}

// ListWorkspacePresence GET /v1/workspaces/:id/presence
// Supervisor view — presence:view_others required.
func (h *PresenceHandler) ListWorkspacePresence(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	type row struct {
		models.UserPresence
		UserName  string `json:"user_name"`
		UserEmail string `json:"user_email"`
	}
	var rows []row
	h.db.Table("user_presences AS up").
		Select("up.*, u.name AS user_name, u.email AS user_email").
		Joins("LEFT JOIN users u ON u.id = up.user_id").
		Where("up.workspace_id = ?", ws).
		Order("up.last_seen_at DESC").
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

func (h *PresenceHandler) loadOrDefault(userID, ws uuid.UUID) models.UserPresence {
	var p models.UserPresence
	err := h.db.Where("user_id = ? AND workspace_id = ?", userID, ws).First(&p).Error
	if err != nil {
		p = models.UserPresence{
			UserID:      userID,
			WorkspaceID: ws,
			Status:      models.PresenceOffline,
			LastSeenAt:  time.Now(),
		}
		h.db.Create(&p)
	}
	return p
}
