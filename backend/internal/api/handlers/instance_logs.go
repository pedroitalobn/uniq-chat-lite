package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type InstanceLogHandler struct {
	db *gorm.DB
}

func NewInstanceLogHandler(db *gorm.DB) *InstanceLogHandler {
	return &InstanceLogHandler{db: db}
}

func (h *InstanceLogHandler) List(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	limit, _ := strconv.Atoi(c.Query("limit", "100"))
	if limit <= 0 || limit > 300 {
		limit = 100
	}

	q := h.db.Where("instance_id = ?", instance.ID)
	if level := c.Query("level"); level != "" {
		q = q.Where("level = ?", level)
	}
	if source := c.Query("source"); source != "" {
		q = q.Where("source = ?", source)
	}

	var logs []models.InstanceEventLog
	if err := q.Order("created_at DESC").Limit(limit).Find(&logs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if logs == nil {
		logs = []models.InstanceEventLog{}
	}
	return c.JSON(fiber.Map{"data": logs, "total": len(logs)})
}
