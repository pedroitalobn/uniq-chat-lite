package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
)

func (h *InstanceHandler) SafetyStatus(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var incident models.InstanceSafetyIncident
	active := h.db.Where("instance_id = ? AND status = ?", instance.ID, "active").
		Order("created_at DESC").
		First(&incident).Error == nil
	state := "normal"
	severity := "low"
	if instance.IsPaused || active {
		state = "critical"
		severity = "high"
		if incident.Severity != "" {
			severity = incident.Severity
		}
	}
	return c.JSON(fiber.Map{
		"monitoring": true,
		"state":      state,
		"severity":   severity,
		"is_paused":  instance.IsPaused,
		"active":     active,
		"incident":   incident,
	})
}

func (h *InstanceHandler) ResumeSafety(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if h.manager != nil {
		if err := h.manager.ResumeInstanceSafety(instance.ID.String()); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
	} else {
		now := time.Now()
		h.db.Model(&models.InstanceSafetyIncident{}).
			Where("instance_id = ? AND status = ?", instance.ID, "active").
			Updates(map[string]any{"status": "resolved", "resolved_at": now})
		h.db.Model(instance).Update("is_paused", false)
	}
	return c.JSON(fiber.Map{"ok": true, "is_paused": false})
}

func (h *InstanceHandler) KeepSafetyPaused(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	h.db.Model(instance).Update("is_paused", true)
	return c.JSON(fiber.Map{"ok": true, "is_paused": true})
}
