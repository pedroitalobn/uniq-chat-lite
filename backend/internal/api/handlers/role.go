package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type RoleHandler struct {
	db *gorm.DB
}

func NewRoleHandler(db *gorm.DB) *RoleHandler {
	return &RoleHandler{db: db}
}

// List returns all roles for a workspace
func (h *RoleHandler) List(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("workspace_id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var roles []models.Role
	h.db.Preload("Permissions").
		Where("workspace_id = ?", workspaceID).
		Order("is_default DESC, name ASC").
		Find(&roles)

	return c.JSON(fiber.Map{"roles": roles})
}

// Get returns a specific role
func (h *RoleHandler) Get(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("workspace_id")
	roleID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var role models.Role
	if err := h.db.Preload("Permissions").
		Where("id = ? AND workspace_id = ?", roleID, workspaceID).
		First(&role).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "função não encontrada"})
	}

	return c.JSON(fiber.Map{"role": role})
}

// Create creates a new role
func (h *RoleHandler) Create(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("workspace_id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var req struct {
		Name          string      `json:"name"`
		Description   string      `json:"description"`
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}

	// Create role
	role := models.Role{
		WorkspaceID: uuid.MustParse(workspaceID),
		Name:        req.Name,
		Description: req.Description,
		IsDefault:   false,
	}

	if err := h.db.Create(&role).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar função"})
	}

	// Assign permissions
	if len(req.PermissionIDs) > 0 {
		for _, permID := range req.PermissionIDs {
			h.db.Create(&models.RolePermission{
				RoleID:       role.ID,
				PermissionID: permID,
			})
		}
	}

	// Reload with permissions
	h.db.Preload("Permissions").First(&role, role.ID)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"role": role})
}

// Update updates a role
func (h *RoleHandler) Update(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("workspace_id")
	roleID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var role models.Role
	if err := h.db.Where("id = ? AND workspace_id = ?", roleID, workspaceID).First(&role).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "função não encontrada"})
	}

	var req struct {
		Name          *string     `json:"name"`
		Description   *string     `json:"description"`
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "dados inválidos"})
	}

	if req.Name != nil {
		role.Name = *req.Name
	}
	if req.Description != nil {
		role.Description = *req.Description
	}

	h.db.Save(&role)

	// Update permissions if provided
	if req.PermissionIDs != nil {
		// Clear existing permissions
		h.db.Where("role_id = ?", role.ID).Delete(&models.RolePermission{})

		// Add new permissions
		for _, permID := range req.PermissionIDs {
			h.db.Create(&models.RolePermission{
				RoleID:       role.ID,
				PermissionID: permID,
			})
		}
	}

	// Reload with permissions
	h.db.Preload("Permissions").First(&role, role.ID)

	return c.JSON(fiber.Map{"role": role})
}

// Delete deletes a role
func (h *RoleHandler) Delete(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("workspace_id")
	roleID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var role models.Role
	if err := h.db.Where("id = ? AND workspace_id = ?", roleID, workspaceID).First(&role).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "função não encontrada"})
	}

	// Can't delete default roles
	if role.IsDefault {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "não é possível excluir funções padrão"})
	}

	// Check if role is in use
	var count int64
	h.db.Model(&models.UserWorkspace{}).Where("role_id = ?", roleID).Count(&count)
	if count > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "função está em uso por membros"})
	}

	h.db.Where("role_id = ?", roleID).Delete(&models.RolePermission{})
	h.db.Delete(&role)

	return c.JSON(fiber.Map{"success": true})
}

// ListPermissions returns all available permissions
func (h *RoleHandler) ListPermissions(c *fiber.Ctx) error {
	var permissions []models.Permission
	h.db.Order("category, name").Find(&permissions)

	// Group by category
	grouped := make(map[string][]models.Permission)
	for _, p := range permissions {
		grouped[p.Category] = append(grouped[p.Category], p)
	}

	return c.JSON(fiber.Map{
		"permissions": permissions,
		"grouped":     grouped,
	})
}

// SeedPermissions seeds the default permissions if they don't exist
func (h *RoleHandler) SeedPermissions(c *fiber.Ctx) error {
	perms := models.GetAllPermissions()
	for i := range perms {
		h.db.Where(models.Permission{Key: perms[i].Key}).
			Assign(models.Permission{
				Name:        perms[i].Name,
				Description: perms[i].Description,
				Category:    perms[i].Category,
			}).
			FirstOrCreate(&perms[i])
	}
	return c.JSON(fiber.Map{"success": true, "count": len(perms)})
}
