package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type FunnelViewHandler struct{ db *gorm.DB }

func NewFunnelViewHandler(db *gorm.DB) *FunnelViewHandler {
	return &FunnelViewHandler{db: db}
}

// List GET /v1/crm/funnels/:id/views
// Returns workspace-shared views (owner_user_id IS NULL) + this user's
// personal views. Shared first, then personal.
func (h *FunnelViewHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	funnelID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "funnel_id inválido"})
	}
	var items []models.FunnelView
	h.db.Where("workspace_id = ? AND funnel_id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", ws, funnelID, userID).
		Order("owner_user_id ASC NULLS FIRST, sort_order ASC, name ASC").
		Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Create POST /v1/crm/funnels/:id/views
func (h *FunnelViewHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	funnelID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "funnel_id inválido"})
	}
	var body models.FunnelView
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if strings.TrimSpace(body.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name é obrigatório"})
	}
	body.WorkspaceID = ws
	body.FunnelID = funnelID
	// Personal scope by default — shared views require explicit
	// body.shared=true (or OwnerUserID=nil sent by a manager UI).
	if body.OwnerUserID == nil {
		id := middleware.GetCurrentUserID(c)
		body.OwnerUserID = &id
	}
	if err := h.db.Create(&body).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(body)
}

// Patch PATCH /v1/crm/funnels/:fid/views/:vid
func (h *FunnelViewHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("vid"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "view_id inválido"})
	}
	var v models.FunnelView
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&v).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "view não encontrada"})
	}
	// Personal views can only be edited by the owner
	if v.OwnerUserID != nil && *v.OwnerUserID != middleware.GetCurrentUserID(c) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o dono pode editar esta view"})
	}
	var body map[string]any
	c.BodyParser(&body)
	allowed := []string{"name", "icon", "kind", "filter", "sort", "columns", "extra", "is_default", "sort_order"}
	dbAliases := map[string]string{
		"filter": "filter_json", "sort": "sort_json", "columns": "columns_json", "extra": "extra_json",
	}
	update := map[string]any{}
	for _, k := range allowed {
		if val, ok := body[k]; ok {
			col := k
			if alias, ok := dbAliases[k]; ok {
				col = alias
			}
			update[col] = val
		}
	}
	if len(update) > 0 {
		h.db.Model(&v).Updates(update)
	}
	h.db.First(&v, "id = ?", id)
	return c.JSON(v)
}

// Delete DELETE /v1/crm/funnels/:fid/views/:vid
func (h *FunnelViewHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("vid"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "view_id inválido"})
	}
	var v models.FunnelView
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&v).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "view não encontrada"})
	}
	if v.OwnerUserID != nil && *v.OwnerUserID != middleware.GetCurrentUserID(c) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o dono pode excluir"})
	}
	h.db.Delete(&v)
	return c.JSON(fiber.Map{"ok": true})
}
