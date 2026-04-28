package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type SuppressionHandler struct {
	db *gorm.DB
}

func NewSuppressionHandler(db *gorm.DB) *SuppressionHandler {
	return &SuppressionHandler{db: db}
}

// List GET /v1/suppressions?channel=&q=
func (h *SuppressionHandler) List(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	q := h.db.Where("workspace_id = ?", wsID)
	if ch := c.Query("channel"); ch != "" && ch != "all" {
		q = q.Where("channel = ?", ch)
	}
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		q = q.Where("key ILIKE ?", "%"+s+"%")
	}
	limit := c.QueryInt("limit", 100)
	if limit > 500 {
		limit = 500
	}
	var rows []models.Suppression
	q.Order("created_at DESC").Limit(limit).Find(&rows)
	return c.JSON(fiber.Map{"data": rows})
}

// Create POST /v1/suppressions  { key, channel?, reason, note? }
func (h *SuppressionHandler) Create(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	var req struct {
		Key     string `json:"key"`
		Channel string `json:"channel"`
		Reason  string `json:"reason"`
		Note    string `json:"note"`
	}
	if err := c.BodyParser(&req); err != nil || req.Key == "" || req.Reason == "" {
		return c.Status(400).JSON(fiber.Map{"error": "key e reason obrigatórios"})
	}
	s := models.Suppression{
		WorkspaceID: wsID, Key: strings.TrimSpace(req.Key),
		Channel: req.Channel, Reason: req.Reason, Note: req.Note,
	}
	if user != nil {
		s.ActorUserID = &user.ID
	}
	if err := h.db.Create(&s).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(201).JSON(s)
}

// Delete DELETE /v1/suppressions/:id
func (h *SuppressionHandler) Delete(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.Suppression{})
	return c.JSON(fiber.Map{"ok": true})
}
