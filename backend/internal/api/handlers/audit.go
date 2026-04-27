package handlers

import (
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// LogAudit registra uma ação no audit_log. Best-effort: falha silenciosa
// (loga warning) — nunca propaga erro pro caller, pra não quebrar o
// fluxo principal por causa do logging.
//
// Use de qualquer handler que mexa com user/admin/billing:
//
//   handlers.LogAudit(h.db, c, "user.delete",
//     handlers.AuditTarget{Type: "user", ID: targetID},
//     map[string]any{"reason": "cascade", "deleted_count": 12})
func LogAudit(db *gorm.DB, c *fiber.Ctx, action string, target AuditTarget, metadata any) {
	entry := models.AuditLog{
		Action:     action,
		TargetType: target.Type,
		TargetID:   target.ID,
		IPAddress:  c.IP(),
		UserAgent:  truncate(c.Get("User-Agent"), 500),
	}
	if user := middleware.GetCurrentUser(c); user != nil {
		entry.ActorUserID = &user.ID
		entry.ActorEmail = user.Email
		entry.ActorRole = string(user.Role)
	}
	if metadata != nil {
		if b, err := json.Marshal(metadata); err == nil {
			entry.Metadata = string(b)
		}
	}
	if err := db.Create(&entry).Error; err != nil {
		log.Warn().Err(err).Str("action", action).Msg("audit: failed to write log")
	}
}

type AuditTarget struct {
	Type string
	ID   *uuid.UUID
}

// ListAuditLogs GET /v1/admin/audit-logs
//
// Filtros opcionais: actor_user_id, action (substring), target_type,
// target_id, since, until. Default: últimos 200 do mais recente.
func (h *AdminHandler) ListAuditLogs(c *fiber.Ctx) error {
	q := h.db.Model(&models.AuditLog{})
	if v := c.Query("actor_user_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("actor_user_id = ?", id)
		}
	}
	if v := c.Query("action"); v != "" {
		q = q.Where("action ILIKE ?", "%"+strings.TrimSpace(v)+"%")
	}
	if v := c.Query("target_type"); v != "" {
		q = q.Where("target_type = ?", v)
	}
	if v := c.Query("target_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("target_id = ?", id)
		}
	}
	if v := c.Query("since"); v != "" {
		q = q.Where("created_at >= ?", v)
	}
	if v := c.Query("until"); v != "" {
		q = q.Where("created_at <= ?", v)
	}
	limit := c.QueryInt("limit", 200)
	if limit > 1000 {
		limit = 1000
	}

	var logs []models.AuditLog
	if err := q.Order("created_at DESC").Limit(limit).Find(&logs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": logs, "limit": limit})
}
