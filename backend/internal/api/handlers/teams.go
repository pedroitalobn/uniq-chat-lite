package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type TeamHandler struct{ db *gorm.DB }

func NewTeamHandler(db *gorm.DB) *TeamHandler { return &TeamHandler{db: db} }

// List GET /v1/teams?department_id=
func (h *TeamHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Model(&models.Team{}).Where("workspace_id = ?", ws)
	if dep := c.Query("department_id"); dep != "" {
		if id, err := uuid.Parse(dep); err == nil {
			q = q.Where("department_id = ?", id)
		}
	}
	var items []models.Team
	q.Preload("Department").Order("name ASC").Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Create POST /v1/teams
func (h *TeamHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body models.Team
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

// Patch PATCH /v1/teams/:id
func (h *TeamHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var t models.Team
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&t).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "equipe não encontrada"})
	}
	var body struct {
		Name         *string `json:"name"`
		Description  *string `json:"description"`
		DepartmentID *string `json:"department_id"`
		LeaderUserID *string `json:"leader_user_id"`
		IsActive     *bool   `json:"is_active"`
	}
	c.BodyParser(&body)
	updates := map[string]any{}
	if body.Name != nil {
		updates["name"] = *body.Name
	}
	if body.Description != nil {
		updates["description"] = *body.Description
	}
	if body.DepartmentID != nil {
		if *body.DepartmentID == "" {
			updates["department_id"] = nil
		} else if id, err := uuid.Parse(*body.DepartmentID); err == nil {
			updates["department_id"] = id
		}
	}
	if body.LeaderUserID != nil {
		if *body.LeaderUserID == "" {
			updates["leader_user_id"] = nil
		} else if id, err := uuid.Parse(*body.LeaderUserID); err == nil {
			updates["leader_user_id"] = id
		}
	}
	if body.IsActive != nil {
		updates["is_active"] = *body.IsActive
	}
	if len(updates) > 0 {
		h.db.Model(&t).Updates(updates)
	}
	h.db.Preload("Department").First(&t, "id = ?", id)
	return c.JSON(t)
}

// Delete DELETE /v1/teams/:id
func (h *TeamHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", ws, id).Delete(&models.Team{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "equipe não encontrada"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// ListMembers GET /v1/teams/:id/members
func (h *TeamHandler) ListMembers(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	teamID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.teamBelongsToWorkspace(ws, teamID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "equipe não encontrada"})
	}
	type row struct {
		TeamMember models.TeamMember `gorm:"embedded"`
		UserName   string            `json:"user_name"`
		UserEmail  string            `json:"user_email"`
	}
	var rows []row
	h.db.Table("team_members AS tm").
		Select("tm.*, u.name AS user_name, u.email AS user_email").
		Joins("LEFT JOIN users u ON u.id = tm.user_id").
		Where("tm.team_id = ?", teamID).
		Order("tm.joined_at ASC").
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

// AddMember POST /v1/teams/:id/members  { user_id, role? }
func (h *TeamHandler) AddMember(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	teamID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.teamBelongsToWorkspace(ws, teamID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "equipe não encontrada"})
	}
	var body struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	c.BodyParser(&body)
	userID, err := uuid.Parse(body.UserID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "user_id inválido"})
	}
	// Ensure user is part of workspace
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, ws).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "usuário não pertence ao workspace"})
	}
	m := models.TeamMember{TeamID: teamID, UserID: userID, Role: body.Role}
	if m.Role == "" {
		m.Role = "member"
	}
	if err := h.db.Create(&m).Error; err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(m)
}

// RemoveMember DELETE /v1/teams/:id/members/:userId
func (h *TeamHandler) RemoveMember(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	teamID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	userID, err := uuid.Parse(c.Params("userId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "userId inválido"})
	}
	if !h.teamBelongsToWorkspace(ws, teamID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "equipe não encontrada"})
	}
	h.db.Where("team_id = ? AND user_id = ?", teamID, userID).Delete(&models.TeamMember{})
	return c.JSON(fiber.Map{"ok": true})
}

func (h *TeamHandler) teamBelongsToWorkspace(ws, teamID uuid.UUID) bool {
	var count int64
	h.db.Model(&models.Team{}).Where("id = ? AND workspace_id = ?", teamID, ws).Count(&count)
	return count > 0
}
