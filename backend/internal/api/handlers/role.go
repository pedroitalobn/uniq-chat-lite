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

// resolveAccess lê o workspace_id dos parâmetros da rota (suporta tanto
// `:id` quanto `:workspace_id`, já que a rota atual monta como
// `/v1/workspaces/:id/roles`), e confirma que o usuário logado tem
// acesso àquele workspace. Super-admins passam sem UserWorkspace row.
func (h *RoleHandler) resolveAccess(c *fiber.Ctx) (uuid.UUID, error) {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return uuid.Nil, c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	raw := c.Params("id")
	if raw == "" {
		raw = c.Params("workspace_id")
	}
	wsID, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id inválido"})
	}

	// Super-admin: acesso total (usado pela tela /admin e pelo próprio
	// dono da conta quando atua como operador)
	if user.Role == models.RoleSuperAdmin {
		return wsID, nil
	}

	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", user.ID, wsID).First(&uw).Error; err != nil {
		return uuid.Nil, c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
	}
	return wsID, nil
}

// hasPermission retorna true quando o user autenticado tem a permissão
// key no workspace. Super-admins e owners passam sem checar role.
func (h *RoleHandler) hasPermission(c *fiber.Ctx, wsID uuid.UUID, key string) bool {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return false
	}
	if user.Role == models.RoleSuperAdmin {
		return true
	}
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", user.ID, wsID).First(&uw).Error; err != nil {
		return false
	}
	if uw.IsOwner {
		return true
	}
	if uw.RoleID == nil {
		return false
	}
	var count int64
	h.db.Model(&models.RolePermission{}).
		Joins("JOIN permissions ON permissions.id = role_permissions.permission_id").
		Where("role_permissions.role_id = ? AND permissions.key = ?", uw.RoleID, key).
		Count(&count)
	return count > 0
}

// List returns all roles for a workspace
func (h *RoleHandler) List(c *fiber.Ctx) error {
	wsID, err := h.resolveAccess(c)
	if err != nil {
		return err
	}
	var roles []models.Role
	h.db.Preload("Permissions").
		Where("workspace_id = ?", wsID).
		Order("is_default DESC, name ASC").
		Find(&roles)
	return c.JSON(fiber.Map{"roles": roles})
}

// Get returns a specific role
func (h *RoleHandler) Get(c *fiber.Ctx) error {
	wsID, err := h.resolveAccess(c)
	if err != nil {
		return err
	}
	roleID := c.Params("role_id")
	if roleID == "" {
		roleID = c.Params("id")
	}
	var role models.Role
	if err := h.db.Preload("Permissions").
		Where("id = ? AND workspace_id = ?", roleID, wsID).
		First(&role).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "função não encontrada"})
	}
	return c.JSON(fiber.Map{"role": role})
}

// Create creates a new role
func (h *RoleHandler) Create(c *fiber.Ctx) error {
	wsID, err := h.resolveAccess(c)
	if err != nil {
		return err
	}
	// Requer roles:create (se configurado) — owner/super-admin passam via hasPermission.
	if !h.hasPermission(c, wsID, models.PermRolesCreate) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão para criar funções"})
	}
	var req struct {
		Name          string      `json:"name"`
		Description   string      `json:"description"`
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}

	// Evita duplicar nome no mesmo workspace
	var dup int64
	h.db.Model(&models.Role{}).Where("workspace_id = ? AND name = ?", wsID, req.Name).Count(&dup)
	if dup > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "já existe uma função com esse nome"})
	}

	role := models.Role{
		WorkspaceID: wsID,
		Name:        req.Name,
		Description: req.Description,
		IsDefault:   false,
	}
	if err := h.db.Create(&role).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar função"})
	}
	for _, permID := range req.PermissionIDs {
		h.db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: permID})
	}
	h.db.Preload("Permissions").First(&role, role.ID)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"role": role})
}

// Update updates a role
func (h *RoleHandler) Update(c *fiber.Ctx) error {
	wsID, err := h.resolveAccess(c)
	if err != nil {
		return err
	}
	if !h.hasPermission(c, wsID, models.PermRolesEdit) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão para editar funções"})
	}
	roleID := c.Params("role_id")
	if roleID == "" {
		roleID = c.Params("id")
	}
	var role models.Role
	if err := h.db.Where("id = ? AND workspace_id = ?", roleID, wsID).First(&role).Error; err != nil {
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

	if req.PermissionIDs != nil {
		h.db.Where("role_id = ?", role.ID).Delete(&models.RolePermission{})
		for _, permID := range req.PermissionIDs {
			h.db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: permID})
		}
	}
	h.db.Preload("Permissions").First(&role, role.ID)
	return c.JSON(fiber.Map{"role": role})
}

// Delete deletes a role
func (h *RoleHandler) Delete(c *fiber.Ctx) error {
	wsID, err := h.resolveAccess(c)
	if err != nil {
		return err
	}
	if !h.hasPermission(c, wsID, models.PermRolesDelete) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão para excluir funções"})
	}
	roleID := c.Params("role_id")
	if roleID == "" {
		roleID = c.Params("id")
	}
	var role models.Role
	if err := h.db.Where("id = ? AND workspace_id = ?", roleID, wsID).First(&role).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "função não encontrada"})
	}
	if role.IsDefault {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "não é possível excluir funções padrão"})
	}
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
	grouped := make(map[string][]models.Permission)
	for _, p := range permissions {
		grouped[p.Category] = append(grouped[p.Category], p)
	}
	return c.JSON(fiber.Map{"permissions": permissions, "grouped": grouped})
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
