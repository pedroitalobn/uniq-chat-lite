package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type WorkspaceHandler struct {
	db *gorm.DB
}

func NewWorkspaceHandler(db *gorm.DB) *WorkspaceHandler {
	return &WorkspaceHandler{db: db}
}

// List returns all workspaces for the current user
func (h *WorkspaceHandler) List(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)

	var userWorkspaces []models.UserWorkspace
	h.db.Preload("Workspace").Preload("Role").
		Where("user_id = ?", userID).
		Find(&userWorkspaces)

	workspaces := make([]fiber.Map, len(userWorkspaces))
	for i, uw := range userWorkspaces {
		workspaces[i] = fiber.Map{
			"id":        uw.Workspace.ID,
			"name":      uw.Workspace.Name,
			"slug":      uw.Workspace.Slug,
			"is_owner":  uw.IsOwner,
			"role":      uw.Role,
			"joined_at": uw.JoinedAt,
		}
	}

	return c.JSON(fiber.Map{"workspaces": workspaces})
}

// Create creates a new workspace
func (h *WorkspaceHandler) Create(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	user := middleware.GetCurrentUser(c)

	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}

	// Check workspace limit based on user's plan
	if user.PlanID != nil {
		var plan models.Plan
		if h.db.First(&plan, "id = ?", *user.PlanID).Error == nil && !plan.IsUnlimitedWorkspaces() {
			var existingCount int64
			h.db.Model(&models.UserWorkspace{}).Where("user_id = ? AND is_owner = true", userID).Count(&existingCount)
			if existingCount >= int64(plan.MaxWorkspaces) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": fmt.Sprintf("limite de workspaces atingido (%d). Faça upgrade do seu plano.", plan.MaxWorkspaces),
				})
			}
		}
	}

	// Create workspace
	workspace := models.Workspace{
		OwnerID: userID,
		Name:    req.Name,
	}

	if err := h.db.Create(&workspace).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar workspace"})
	}

	// Create default admin role
	adminRole := models.Role{
		WorkspaceID: workspace.ID,
		Name:        "Admin",
		Description: "Acesso total ao workspace",
		IsDefault:   true,
	}
	h.db.Create(&adminRole)

	// Add all permissions to admin role
	var permissions []models.Permission
	h.db.Find(&permissions)
	if len(permissions) > 0 {
		for _, p := range permissions {
			h.db.Create(&models.RolePermission{
				RoleID:       adminRole.ID,
				PermissionID: p.ID,
			})
		}
	}

	// Add user as owner with admin role
	userWorkspace := models.UserWorkspace{
		UserID:      userID,
		WorkspaceID: workspace.ID,
		RoleID:      &adminRole.ID,
		IsOwner:     true,
	}
	h.db.Create(&userWorkspace)

	// Update user role to customer if they're not already
	if user.Role == "user" {
		h.db.Model(&models.User{}).Where("id = ?", userID).Update("role", models.RoleCustomer)
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"workspace": workspace,
		"role":      adminRole,
	})
}

// Get returns a specific workspace
func (h *WorkspaceHandler) Get(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var workspace models.Workspace
	h.db.Preload("Owner").Where("id = ?", workspaceID).First(&workspace)

	return c.JSON(fiber.Map{"workspace": workspace})
}

// Update updates a workspace
func (h *WorkspaceHandler) Update(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")

	// Check ownership
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ? AND is_owner = true", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o proprietário pode editar"})
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "dados inválidos"})
	}

	if req.Name != "" {
		h.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("name", req.Name)
	}

	return c.JSON(fiber.Map{"success": true})
}

// Delete deactivates a workspace
func (h *WorkspaceHandler) Delete(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")

	// Check ownership
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ? AND is_owner = true", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o proprietário pode excluir"})
	}

	h.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("is_active", false)

	return c.JSON(fiber.Map{"success": true})
}

// ListMembers returns all members of a workspace
func (h *WorkspaceHandler) ListMembers(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var members []models.UserWorkspace
	h.db.Preload("User").Preload("Role").
		Where("workspace_id = ?", workspaceID).
		Find(&members)

	return c.JSON(fiber.Map{"members": members})
}

// RemoveMember removes a user from the workspace
func (h *WorkspaceHandler) RemoveMember(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")
	memberID := c.Params("member_id")

	// Check if caller has permission
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	// Can't remove yourself if you're the owner
	if memberID == userID.String() && uw.IsOwner {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "proprietário não pode ser removido"})
	}

	h.db.Where("user_id = ? AND workspace_id = ?", memberID, workspaceID).
		Delete(&models.UserWorkspace{})

	return c.JSON(fiber.Map{"success": true})
}

// generateToken creates a random token for invites
func generateToken(prefix string) string {
	b := make([]byte, 32)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)[:40]
}

// CreateInvite creates an invitation to join the workspace
func (h *WorkspaceHandler) CreateInvite(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var req struct {
		Email  string    `json:"email"`
		RoleID uuid.UUID `json:"role_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.Email == "" || req.RoleID == uuid.Nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email e role são obrigatórios"})
	}

	// Check if user is already a member
	var existingUserWorkspace models.UserWorkspace
	if err := h.db.Joins("JOIN users ON users.id = user_workspaces.user_id").
		Where("users.email = ? AND workspace_id = ?", req.Email, workspaceID).
		First(&existingUserWorkspace).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "usuário já é membro"})
	}

	// Revoke any pending invites for this email
	h.db.Model(&models.Invite{}).
		Where("email = ? AND workspace_id = ? AND status = 'pending'", req.Email, workspaceID).
		Update("status", "expired")

	invite := models.Invite{
		WorkspaceID: uuid.MustParse(workspaceID),
		Email:       req.Email,
		RoleID:      req.RoleID,
		InvitedBy:   userID,
		Token:       generateToken("inv_"),
		Status:      "pending",
		ExpiresAt:   time.Now().Add(7 * 24 * time.Hour),
	}

	if err := h.db.Create(&invite).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar convite"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"invite": invite,
		"link":   "/invite/" + invite.Token,
	})
}

// ListInvites returns pending invites for a workspace
func (h *WorkspaceHandler) ListInvites(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var invites []models.Invite
	h.db.Preload("Role").Preload("Inviter").
		Where("workspace_id = ?", workspaceID).
		Order("created_at DESC").
		Find(&invites)

	return c.JSON(fiber.Map{"invites": invites})
}

// RevokeInvite revokes a pending invite
func (h *WorkspaceHandler) RevokeInvite(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")
	inviteID := c.Params("invite_id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	h.db.Model(&models.Invite{}).
		Where("id = ? AND workspace_id = ?", inviteID, workspaceID).
		Update("status", "revoked")

	return c.JSON(fiber.Map{"success": true})
}

// AcceptInvite accepts an invitation
func (h *WorkspaceHandler) AcceptInvite(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	token := c.Params("token")

	var invite models.Invite
	if err := h.db.Where("token = ? AND status = 'pending'", token).First(&invite).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "convite não encontrado ou expirado"})
	}

	if time.Now().After(invite.ExpiresAt) {
		h.db.Model(&invite).Update("status", "expired")
		return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "convite expirado"})
	}

	// Check if email matches
	if user.Email != invite.Email {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "este convite é para outro email"})
	}

	// Check user limit based on workspace owner's plan
	var workspace models.Workspace
	h.db.First(&workspace, "id = ?", invite.WorkspaceID)
	if workspace.OwnerID != uuid.Nil {
		var owner models.User
		h.db.Preload("Plan").First(&owner, "id = ?", workspace.OwnerID)
		if owner.Plan != nil && !owner.Plan.IsUnlimitedUsers() {
			var memberCount int64
			h.db.Model(&models.UserWorkspace{}).Where("workspace_id = ?", invite.WorkspaceID).Count(&memberCount)
			if memberCount >= int64(owner.Plan.MaxUsers) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": fmt.Sprintf("limite de usuários do workspace atingido (%d). O proprietário precisa fazer upgrade do plano.", owner.Plan.MaxUsers),
				})
			}
		}
	}

	// Create membership
	userWorkspace := models.UserWorkspace{
		UserID:      user.ID,
		WorkspaceID: invite.WorkspaceID,
		RoleID:      &invite.RoleID,
		IsOwner:     false,
	}
	h.db.Create(&userWorkspace)

	// Mark invite as accepted
	h.db.Model(&invite).Update("status", "accepted")

	return c.JSON(fiber.Map{"success": true, "workspace_id": invite.WorkspaceID})
}
