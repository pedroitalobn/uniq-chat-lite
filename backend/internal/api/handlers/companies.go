package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type CompanyHandler struct{ db *gorm.DB }

func NewCompanyHandler(db *gorm.DB) *CompanyHandler { return &CompanyHandler{db: db} }

// List GET /v1/crm/companies?q=&owner_id=&limit=&offset=
func (h *CompanyHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Model(&models.Company{}).Where("workspace_id = ?", ws)

	if term := strings.TrimSpace(c.Query("q")); term != "" {
		pattern := "%" + term + "%"
		q = q.Where("name ILIKE ? OR domain ILIKE ? OR email ILIKE ? OR tax_id ILIKE ?", pattern, pattern, pattern, pattern)
	}
	if oid := c.Query("owner_id"); oid != "" {
		if id, err := uuid.Parse(oid); err == nil {
			q = q.Where("owner_id = ?", id)
		}
	}
	limit := atoiDefault(c.Query("limit"), 50)
	if limit < 1 || limit > 500 {
		limit = 50
	}
	var total int64
	q.Count(&total)
	var items []models.Company
	q.Preload("Owner").Order("name ASC").
		Limit(limit).Offset(atoiDefault(c.Query("offset"), 0)).
		Find(&items)
	return c.JSON(fiber.Map{"items": items, "total": total, "limit": limit})
}

// Get GET /v1/crm/companies/:id
func (h *CompanyHandler) Get(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var co models.Company
	if err := h.db.Preload("Owner").Where("workspace_id = ? AND id = ?", ws, id).First(&co).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "empresa não encontrada"})
	}
	return c.JSON(co)
}

// Create POST /v1/crm/companies
func (h *CompanyHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body models.Company
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if strings.TrimSpace(body.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name é obrigatório"})
	}
	body.WorkspaceID = ws
	if body.OwnerID == nil {
		id := middleware.GetCurrentUserID(c)
		body.OwnerID = &id
	}
	if err := h.db.Create(&body).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(body)
}

// Patch PATCH /v1/crm/companies/:id
func (h *CompanyHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var co models.Company
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&co).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "empresa não encontrada"})
	}
	var body map[string]any
	c.BodyParser(&body)
	allowed := []string{
		"name", "legal_name", "domain", "website", "industry", "size", "description",
		"phone", "email", "address_line", "city", "state", "country", "postal_code", "tax_id",
		"annual_revenue", "currency", "logo_url", "owner_id",
	}
	update := map[string]any{}
	for _, k := range allowed {
		if v, ok := body[k]; ok {
			update[k] = v
		}
	}
	if len(update) > 0 {
		h.db.Model(&co).Updates(update)
	}
	h.db.Preload("Owner").First(&co, "id = ?", id)
	return c.JSON(co)
}

// Delete DELETE /v1/crm/companies/:id (soft)
func (h *CompanyHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", ws, id).Delete(&models.Company{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "empresa não encontrada"})
	}
	// Null out company_id on contacts/deals (soft-delete keeps history, but
	// referring rows need unpointing so lookups don't fail).
	h.db.Model(&models.Contact{}).Where("company_id = ?", id).Update("company_id", nil)
	h.db.Model(&models.Deal{}).Where("company_id = ?", id).Update("company_id", nil)
	return c.JSON(fiber.Map{"ok": true})
}

// Contacts GET /v1/crm/companies/:id/contacts
func (h *CompanyHandler) Contacts(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var items []models.Contact
	h.db.Where("workspace_id = ? AND company_id = ?", ws, id).
		Order("name ASC").Limit(500).Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Deals GET /v1/crm/companies/:id/deals
func (h *CompanyHandler) Deals(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var items []models.Deal
	h.db.Preload("Contact").Preload("Owner").
		Where("workspace_id = ? AND company_id = ?", ws, id).
		Order("updated_at DESC").Limit(500).Find(&items)
	return c.JSON(fiber.Map{"items": items})
}
