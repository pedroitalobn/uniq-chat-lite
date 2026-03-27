package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type ServerHandler struct {
	db *gorm.DB
}

func NewServerHandler(db *gorm.DB) *ServerHandler {
	return &ServerHandler{db: db}
}

// List godoc
// GET /servers
func (h *ServerHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var servers []models.Server
	q := h.db.Order("created_at DESC")
	if user.Role != models.RoleAdmin {
		q = q.Where("user_id = ?", user.ID)
	}
	if err := q.Find(&servers).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar servers"})
	}
	return c.JSON(servers)
}

// Create godoc
// POST /servers
// Body: { "name": "Acme Corp", "slug": "acme-corp" (optional), "description": "..." }
func (h *ServerHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	var req struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}

	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = models.SlugFrom(req.Name)
	} else {
		slug = models.SlugFrom(slug) // normalize
	}

	// Ensure slug uniqueness — append short uuid suffix if taken
	base := slug
	for i := 2; i <= 10; i++ {
		var existing models.Server
		if h.db.Where("slug = ?", slug).First(&existing).Error != nil {
			break // not found → available
		}
		slug = base + "-" + uuid.New().String()[:4]
	}

	server := models.Server{
		UserID:      user.ID,
		Name:        req.Name,
		Slug:        slug,
		Description: req.Description,
		IsActive:    true,
	}

	if err := h.db.Create(&server).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar server: " + err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(server)
}

// Get godoc
// GET /servers/:id
func (h *ServerHandler) Get(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	return c.JSON(server)
}

// Update godoc
// PUT /servers/:id
func (h *ServerHandler) Update(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		IsActive    *bool  `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	h.db.Model(server).Updates(updates)
	return c.JSON(server)
}

// Delete godoc
// DELETE /servers/:id
func (h *ServerHandler) Delete(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	// Detach instances from this server (set server_id = NULL)
	h.db.Model(&models.Instance{}).Where("server_id = ?", server.ID).Update("server_id", nil)

	if err := h.db.Delete(server).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao remover server"})
	}
	return c.JSON(fiber.Map{"message": "server removido"})
}

// Instances godoc
// GET /servers/:id/instances
func (h *ServerHandler) Instances(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var instances []models.Instance
	h.db.Where("server_id = ?", server.ID).Order("created_at DESC").Find(&instances)
	return c.JSON(instances)
}

// getOwned is a helper that loads a server and checks ownership.
func (h *ServerHandler) getOwned(c *fiber.Ctx) *models.Server {
	serverID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
		return nil
	}

	var server models.Server
	if err := h.db.First(&server, "id = ?", serverID).Error; err != nil {
		c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "server não encontrado"})
		return nil
	}

	user := middleware.GetCurrentUser(c)
	if user.Role != models.RoleAdmin && server.UserID != user.ID {
		c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
		return nil
	}
	return &server
}
