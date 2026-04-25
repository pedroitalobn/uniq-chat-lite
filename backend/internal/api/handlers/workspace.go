package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type WorkspaceHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
}

func NewWorkspaceHandler(db *gorm.DB, emailSvc *email.Service) *WorkspaceHandler {
	return &WorkspaceHandler{db: db, emailSvc: emailSvc}
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

	// Seed as roles padrão (Supervisor / Agente / Agente RO) pro owner
	// já poder convidar gente e atribuir funções sem precisar montar
	// permissões do zero. Idempotente.
	models.SeedDefaultRolesForWorkspace(h.db, &workspace)

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

	// Preload Role.Permissions também — o frontend usa essa lista pra
	// gatear módulos no sidebar (sem isso, role chega sem perms e a UI
	// trata como "user sem acesso", escondendo tudo).
	var members []models.UserWorkspace
	h.db.Preload("User").Preload("Role.Permissions").
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

// UpdateMember PATCH /v1/workspaces/:id/members/:member_id
// Body: { role_id: string }
// Troca a role de um membro já existente no workspace. Só owner ou
// super-admin podem executar — evita escalação onde um membro se auto-
// promove. O owner não pode ter a role removida (ficaria sem permissions
// efetivas mesmo com IsOwner=true, que é OK, mas é confuso).
func (h *WorkspaceHandler) UpdateMember(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	workspaceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	memberID, err := uuid.Parse(c.Params("member_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "member_id inválido"})
	}

	// Checa se o caller é super-admin OU owner do workspace
	var callerUW models.UserWorkspace
	isCallerOwnerOrAdmin := user.Role == models.RoleSuperAdmin
	if !isCallerOwnerOrAdmin {
		if err := h.db.Where("user_id = ? AND workspace_id = ?", user.ID, workspaceID).
			First(&callerUW).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
		}
		isCallerOwnerOrAdmin = callerUW.IsOwner
	}
	if !isCallerOwnerOrAdmin {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas proprietário ou super-admin pode alterar funções"})
	}

	var req struct {
		RoleID string `json:"role_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "dados inválidos"})
	}
	var roleID *uuid.UUID
	if req.RoleID != "" {
		id, err := uuid.Parse(req.RoleID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "role_id inválido"})
		}
		// Valida que a role pertence a esse workspace
		var cnt int64
		h.db.Model(&models.Role{}).Where("id = ? AND workspace_id = ?", id, workspaceID).Count(&cnt)
		if cnt == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "função não pertence a esse workspace"})
		}
		roleID = &id
	}

	// Atualiza o membro
	var member models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", memberID, workspaceID).
		First(&member).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "membro não encontrado"})
	}
	h.db.Model(&member).Update("role_id", roleID)
	h.db.Preload("Role.Permissions").First(&member, member.ID)
	return c.JSON(fiber.Map{"member": member})
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

	// Monta URL de aceite (frontend). Se FRONTEND_URL não estiver configurada,
	// usa o appURL do email service como fallback.
	frontendURL := ""
	if config.AppConfig != nil {
		frontendURL = strings.TrimRight(config.AppConfig.FrontendURL, "/")
	}
	if frontendURL == "" {
		_, _, _ = h.emailSvc.GetConfig()
		frontendURL = "https://app.uniq.chat"
	}
	acceptURL := frontendURL + "/invite/" + invite.Token

	// Preload dados pro email — workspace name, inviter name, role name.
	var workspace models.Workspace
	h.db.Select("id, name").First(&workspace, "id = ?", workspaceID)
	var inviter models.User
	h.db.Select("id, name, email").First(&inviter, "id = ?", userID)
	var role models.Role
	h.db.Select("id, name").First(&role, "id = ?", req.RoleID)

	inviterName := inviter.Name
	if inviterName == "" {
		inviterName = inviter.Email
	}
	workspaceName := workspace.Name
	if workspaceName == "" {
		workspaceName = "seu workspace"
	}
	roleName := role.Name
	if roleName == "" {
		roleName = "Membro"
	}

	// Envio assíncrono — se Maileroo cair, o convite ainda é válido pelo link.
	go func(to, ws, inv, rl, url string) {
		if h.emailSvc == nil {
			return
		}
		if err := h.emailSvc.SendWorkspaceInvite(to, ws, inv, rl, url); err != nil {
			log.Error().Err(err).Str("to", to).Str("workspace", ws).
				Msg("workspace: failed to send invite email")
		}
	}(invite.Email, workspaceName, inviterName, roleName, acceptURL)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"invite":     invite,
		"link":       "/invite/" + invite.Token,
		"accept_url": acceptURL,
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

	// Filtra só convites ativos (pending). Aceitos viram UserWorkspace e
	// não precisam aparecer aqui; revogados foram deletados; expired são
	// lixo — limpamos na marra antes de listar.
	h.db.Model(&models.Invite{}).
		Where("workspace_id = ? AND status = 'pending' AND expires_at < ?", workspaceID, time.Now()).
		Update("status", "expired")

	var invites []models.Invite
	h.db.Preload("Role").Preload("Inviter").
		Where("workspace_id = ? AND status = 'pending'", workspaceID).
		Order("created_at DESC").
		Find(&invites)

	return c.JSON(fiber.Map{"invites": invites})
}

// RevokeInvite marca o convite como revoked. Mantém a linha no DB pra
// auditoria; a UI filtra só pending, então a linha "some" do usuário
// mesmo sem hard delete. Quem tenta aceitar o token depois recebe 404.
func (h *WorkspaceHandler) RevokeInvite(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")
	inviteID := c.Params("invite_id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	if err := h.db.Model(&models.Invite{}).
		Where("id = ? AND workspace_id = ?", inviteID, workspaceID).
		Update("status", "revoked").Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao revogar convite"})
	}

	return c.JSON(fiber.Map{"success": true})
}

// ResendInvite reenvia o email de convite usando o token existente
// (novo token invalidaria links já copiados). Atualiza expires_at pra
// +7 dias contando de agora — faz sentido: se o gestor reenviou, é
// porque quer dar mais tempo.
func (h *WorkspaceHandler) ResendInvite(c *fiber.Ctx) error {
	userID := middleware.GetCurrentUserID(c)
	workspaceID := c.Params("id")
	inviteID := c.Params("invite_id")

	// Check access
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var invite models.Invite
	if err := h.db.Preload("Role").
		Where("id = ? AND workspace_id = ?", inviteID, workspaceID).
		First(&invite).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "convite não encontrado"})
	}

	// Estende expiração + volta pra pending (caso tenha virado expired).
	invite.ExpiresAt = time.Now().Add(7 * 24 * time.Hour)
	invite.Status = "pending"
	h.db.Save(&invite)

	// Monta URL de aceite.
	frontendURL := ""
	if config.AppConfig != nil {
		frontendURL = strings.TrimRight(config.AppConfig.FrontendURL, "/")
	}
	if frontendURL == "" {
		frontendURL = "https://app.uniq.chat"
	}
	acceptURL := frontendURL + "/invite/" + invite.Token

	// Preload nomes pro email.
	var workspace models.Workspace
	h.db.Select("id, name").First(&workspace, "id = ?", workspaceID)
	var inviter models.User
	h.db.Select("id, name, email").First(&inviter, "id = ?", userID)

	inviterName := inviter.Name
	if inviterName == "" {
		inviterName = inviter.Email
	}
	workspaceName := workspace.Name
	if workspaceName == "" {
		workspaceName = "seu workspace"
	}
	roleName := ""
	if invite.Role.Name != "" {
		roleName = invite.Role.Name
	} else {
		roleName = "Membro"
	}

	// Envio síncrono aqui — usuário clicou "Reenviar" e quer feedback
	// (sucesso/erro) antes de fechar. 15s timeout no HTTP client.
	if h.emailSvc != nil {
		if err := h.emailSvc.SendWorkspaceInvite(invite.Email, workspaceName, inviterName, roleName, acceptURL); err != nil {
			log.Error().Err(err).Str("to", invite.Email).Msg("workspace: failed to resend invite email")
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
				"error":      "email não pôde ser enviado — compartilhe o link manualmente",
				"accept_url": acceptURL,
			})
		}
	}

	return c.JSON(fiber.Map{
		"success":    true,
		"invite":     invite,
		"accept_url": acceptURL,
	})
}

// PreviewInvite é o endpoint PÚBLICO (sem auth) que a página /invite/:token
// usa pra decidir se o destinatário vai pra /login (conta existe) ou /register
// (conta não existe). Retorna só dados seguros pra exibir: nome do workspace,
// do convidante, da role e se o email já está cadastrado.
func (h *WorkspaceHandler) PreviewInvite(c *fiber.Ctx) error {
	token := c.Params("token")
	if token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token ausente"})
	}

	var invite models.Invite
	if err := h.db.Preload("Role").
		Where("token = ? AND status = 'pending'", token).
		First(&invite).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "convite não encontrado ou já utilizado"})
	}

	if time.Now().After(invite.ExpiresAt) {
		h.db.Model(&invite).Update("status", "expired")
		return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "convite expirado"})
	}

	var workspace models.Workspace
	h.db.Select("id, name").First(&workspace, "id = ?", invite.WorkspaceID)

	var inviter models.User
	h.db.Select("id, name, email").First(&inviter, "id = ?", invite.InvitedBy)
	inviterName := inviter.Name
	if inviterName == "" {
		inviterName = inviter.Email
	}

	// Existe conta com esse email?
	var existing models.User
	userExists := h.db.Select("id").Where("email = ?", invite.Email).First(&existing).Error == nil

	return c.JSON(fiber.Map{
		"email":          invite.Email,
		"workspace_name": workspace.Name,
		"inviter_name":   inviterName,
		"role_name":      invite.Role.Name,
		"user_exists":    userExists,
		"expires_at":     invite.ExpiresAt,
	})
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
