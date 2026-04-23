package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type QueueHandler struct{ db *gorm.DB }

func NewQueueHandler(db *gorm.DB) *QueueHandler { return &QueueHandler{db: db} }

// List GET /v1/queues?department_id=&team_id=
func (h *QueueHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Model(&models.Queue{}).Where("workspace_id = ?", ws)
	if dep := c.Query("department_id"); dep != "" {
		if id, err := uuid.Parse(dep); err == nil {
			q = q.Where("department_id = ?", id)
		}
	}
	if t := c.Query("team_id"); t != "" {
		if id, err := uuid.Parse(t); err == nil {
			q = q.Where("team_id = ?", id)
		}
	}
	var items []models.Queue
	q.Preload("Department").Preload("Team").Order("priority DESC, name ASC").Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Create POST /v1/queues
func (h *QueueHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body models.Queue
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

// Get GET /v1/queues/:id
func (h *QueueHandler) Get(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var q models.Queue
	if err := h.db.Preload("Department").Preload("Team").
		Where("workspace_id = ? AND id = ?", ws, id).First(&q).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	return c.JSON(q)
}

// Patch PATCH /v1/queues/:id
func (h *QueueHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var q models.Queue
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&q).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	var body struct {
		Name                    *string `json:"name"`
		Description             *string `json:"description"`
		Color                   *string `json:"color"`
		DepartmentID            *string `json:"department_id"`
		TeamID                  *string `json:"team_id"`
		AssignmentStrategy      *string `json:"assignment_strategy"`
		MaxConcurrentPerUser    *int    `json:"max_concurrent_per_user"`
		AutoAssignOnOpen        *bool   `json:"auto_assign_on_open"`
		AutoCloseAfterHours     *int    `json:"auto_close_after_hours"`
		ReopenWindowMinutes     *int    `json:"reopen_window_minutes"`
		EnableChatbot           *bool   `json:"enable_chatbot"`
		ChatbotAgentID          *string `json:"chatbot_agent_id"`
		BusinessHoursJSON       *string `json:"business_hours"`
		TimezoneTZ              *string `json:"timezone"`
		OffHoursMessage         *string `json:"off_hours_message"`
		FirstResponseSLAMinutes *int    `json:"first_response_sla_minutes"`
		ResolutionSLAMinutes    *int    `json:"resolution_sla_minutes"`
		Priority                *int    `json:"priority"`
		IsActive                *bool   `json:"is_active"`
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
	if body.DepartmentID != nil {
		if *body.DepartmentID == "" {
			updates["department_id"] = nil
		} else if id, err := uuid.Parse(*body.DepartmentID); err == nil {
			updates["department_id"] = id
		}
	}
	if body.TeamID != nil {
		if *body.TeamID == "" {
			updates["team_id"] = nil
		} else if id, err := uuid.Parse(*body.TeamID); err == nil {
			updates["team_id"] = id
		}
	}
	if body.AssignmentStrategy != nil {
		updates["assignment_strategy"] = *body.AssignmentStrategy
	}
	if body.MaxConcurrentPerUser != nil {
		updates["max_concurrent_per_user"] = *body.MaxConcurrentPerUser
	}
	if body.AutoAssignOnOpen != nil {
		updates["auto_assign_on_open"] = *body.AutoAssignOnOpen
	}
	if body.AutoCloseAfterHours != nil {
		updates["auto_close_after_hours"] = *body.AutoCloseAfterHours
	}
	if body.ReopenWindowMinutes != nil {
		updates["reopen_window_minutes"] = *body.ReopenWindowMinutes
	}
	if body.EnableChatbot != nil {
		updates["enable_chatbot"] = *body.EnableChatbot
	}
	if body.ChatbotAgentID != nil {
		if *body.ChatbotAgentID == "" {
			updates["chatbot_agent_id"] = nil
		} else if id, err := uuid.Parse(*body.ChatbotAgentID); err == nil {
			updates["chatbot_agent_id"] = id
		}
	}
	if body.BusinessHoursJSON != nil {
		updates["business_hours_json"] = *body.BusinessHoursJSON
	}
	if body.TimezoneTZ != nil {
		updates["timezone_tz"] = *body.TimezoneTZ
	}
	if body.OffHoursMessage != nil {
		updates["off_hours_message"] = *body.OffHoursMessage
	}
	if body.FirstResponseSLAMinutes != nil {
		updates["first_response_sla_minutes"] = *body.FirstResponseSLAMinutes
	}
	if body.ResolutionSLAMinutes != nil {
		updates["resolution_sla_minutes"] = *body.ResolutionSLAMinutes
	}
	if body.Priority != nil {
		updates["priority"] = *body.Priority
	}
	if body.IsActive != nil {
		updates["is_active"] = *body.IsActive
	}
	if len(updates) > 0 {
		h.db.Model(&q).Updates(updates)
	}
	h.db.Preload("Department").Preload("Team").First(&q, "id = ?", id)
	return c.JSON(q)
}

// Delete DELETE /v1/queues/:id
func (h *QueueHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", ws, id).Delete(&models.Queue{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// -- Members ---------------------------------------------------------------

// ListMembers GET /v1/queues/:id/members
func (h *QueueHandler) ListMembers(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	type row struct {
		models.QueueMember
		UserName  string `json:"user_name"`
		UserEmail string `json:"user_email"`
	}
	var rows []row
	h.db.Table("queue_members AS qm").
		Select("qm.*, u.name AS user_name, u.email AS user_email").
		Joins("LEFT JOIN users u ON u.id = qm.user_id").
		Where("qm.queue_id = ?", queueID).
		Order("qm.joined_at ASC").
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

// AddMember POST /v1/queues/:id/members  { user_id, priority? }
func (h *QueueHandler) AddMember(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	var body struct {
		UserID   string `json:"user_id"`
		Priority int    `json:"priority"`
	}
	c.BodyParser(&body)
	userID, err := uuid.Parse(body.UserID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "user_id inválido"})
	}
	// User must belong to the workspace
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, ws).First(&uw).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "usuário não pertence ao workspace"})
	}
	m := models.QueueMember{QueueID: queueID, UserID: userID, Priority: body.Priority, CanReceive: true}
	if err := h.db.Create(&m).Error; err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(m)
}

// UpdateMember PATCH /v1/queues/:id/members/:userId  { can_receive?, priority? }
func (h *QueueHandler) UpdateMember(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	userID, err := uuid.Parse(c.Params("userId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "userId inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	var body struct {
		CanReceive *bool `json:"can_receive"`
		Priority   *int  `json:"priority"`
	}
	c.BodyParser(&body)
	updates := map[string]any{}
	if body.CanReceive != nil {
		updates["can_receive"] = *body.CanReceive
	}
	if body.Priority != nil {
		updates["priority"] = *body.Priority
	}
	if len(updates) > 0 {
		h.db.Model(&models.QueueMember{}).
			Where("queue_id = ? AND user_id = ?", queueID, userID).
			Updates(updates)
	}
	return c.JSON(fiber.Map{"ok": true})
}

// RemoveMember DELETE /v1/queues/:id/members/:userId
func (h *QueueHandler) RemoveMember(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	userID, err := uuid.Parse(c.Params("userId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "userId inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	h.db.Where("queue_id = ? AND user_id = ?", queueID, userID).Delete(&models.QueueMember{})
	return c.JSON(fiber.Map{"ok": true})
}

// -- Channel bindings -------------------------------------------------------

// ListChannels GET /v1/queues/:id/channels
func (h *QueueHandler) ListChannels(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	type row struct {
		models.QueueChannel
		InstanceName    string `json:"instance_name"`
		InstanceChannel string `json:"instance_channel"`
	}
	var rows []row
	h.db.Table("queue_channels AS qc").
		Select("qc.*, i.name AS instance_name, i.channel AS instance_channel").
		Joins("LEFT JOIN instances i ON i.id = qc.instance_id").
		Where("qc.queue_id = ?", queueID).
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

// AddChannel POST /v1/queues/:id/channels  { instance_id, is_default? }
func (h *QueueHandler) AddChannel(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	var body struct {
		InstanceID string `json:"instance_id"`
		IsDefault  bool   `json:"is_default"`
	}
	c.BodyParser(&body)
	instanceID, err := uuid.Parse(body.InstanceID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instance_id inválido"})
	}
	// Instance must belong to workspace
	var inst models.Instance
	if err := h.db.Where("id = ? AND workspace_id = ?", instanceID, ws).First(&inst).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não pertence ao workspace"})
	}
	// If IsDefault=true, unset other defaults for this instance
	if body.IsDefault {
		h.db.Model(&models.QueueChannel{}).
			Where("instance_id = ? AND is_default = true", instanceID).
			Update("is_default", false)
	}
	qc := models.QueueChannel{QueueID: queueID, InstanceID: instanceID, IsDefault: body.IsDefault}
	if err := h.db.Create(&qc).Error; err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(qc)
}

// RemoveChannel DELETE /v1/queues/:id/channels/:instanceId
func (h *QueueHandler) RemoveChannel(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	queueID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	instanceID, err := uuid.Parse(c.Params("instanceId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instanceId inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, queueID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}
	h.db.Where("queue_id = ? AND instance_id = ?", queueID, instanceID).Delete(&models.QueueChannel{})
	return c.JSON(fiber.Map{"ok": true})
}

// -- Stats ------------------------------------------------------------------

// Stats GET /v1/queues/:id/stats
// Returns counters used by the supervisor dashboard:
//   waiting: conversations in the queue without assignee
//   active:  conversations currently assigned (status=open)
//   members_online: queue_members whose presence=online
func (h *QueueHandler) Stats(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if !h.queueBelongsToWorkspace(ws, id) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "fila não encontrada"})
	}

	var waiting, active, membersOnline int64
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND queue_id = ? AND assigned_user_id IS NULL AND status IN ?", ws, id,
			[]models.ConversationStatus{models.ConversationStatusOpen, models.ConversationStatusPending}).
		Count(&waiting)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND queue_id = ? AND assigned_user_id IS NOT NULL AND status = ?", ws, id, models.ConversationStatusOpen).
		Count(&active)
	h.db.Table("queue_members AS qm").
		Joins("JOIN user_presences up ON up.user_id = qm.user_id AND up.workspace_id = ?", ws).
		Where("qm.queue_id = ? AND qm.can_receive = true AND up.status = ?", id, models.PresenceOnline).
		Count(&membersOnline)
	return c.JSON(fiber.Map{
		"waiting":        waiting,
		"active":         active,
		"members_online": membersOnline,
	})
}

func (h *QueueHandler) queueBelongsToWorkspace(ws, queueID uuid.UUID) bool {
	var count int64
	h.db.Model(&models.Queue{}).Where("id = ? AND workspace_id = ?", queueID, ws).Count(&count)
	return count > 0
}
