package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type DepartmentHandler struct{ db *gorm.DB }

func NewDepartmentHandler(db *gorm.DB) *DepartmentHandler { return &DepartmentHandler{db: db} }

// List GET /v1/departments
func (h *DepartmentHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var items []models.Department
	h.db.Where("workspace_id = ?", ws).Order("sort_order ASC, name ASC").Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Create POST /v1/departments
func (h *DepartmentHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body models.Department
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if body.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name é obrigatório"})
	}
	body.WorkspaceID = ws
	if err := h.db.Create(&body).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(body)
}

// Patch PATCH /v1/departments/:id
func (h *DepartmentHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var d models.Department
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "departamento não encontrado"})
	}
	var body struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Color       *string `json:"color"`
		Icon        *string `json:"icon"`
		IsActive    *bool   `json:"is_active"`
		SortOrder   *int    `json:"sort_order"`
	}
	c.BodyParser(&body)
	updates := map[string]any{}
	if body.Name != nil {
		updates["name"] = *body.Name
	}
	if body.Description != nil {
		updates["description"] = *body.Description
	}
	if body.Color != nil {
		updates["color"] = *body.Color
	}
	if body.Icon != nil {
		updates["icon"] = *body.Icon
	}
	if body.IsActive != nil {
		updates["is_active"] = *body.IsActive
	}
	if body.SortOrder != nil {
		updates["sort_order"] = *body.SortOrder
	}
	if len(updates) > 0 {
		h.db.Model(&d).Updates(updates)
	}
	h.db.First(&d, "id = ?", id)
	return c.JSON(d)
}

// Delete DELETE /v1/departments/:id (soft-delete)
func (h *DepartmentHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", ws, id).Delete(&models.Department{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "departamento não encontrado"})
	}
	return c.JSON(fiber.Map{"ok": true})
}
