package handlers

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type CrmTaskHandler struct{ db *gorm.DB }

func NewCrmTaskHandler(db *gorm.DB) *CrmTaskHandler { return &CrmTaskHandler{db: db} }

// resolveWorkspaceID lê do middleware (X-Workspace-ID) ou cai no
// header explícito como fallback, seguindo o mesmo padrão dos outros
// CRUDs do CRM.
func (h *CrmTaskHandler) resolveWorkspaceID(c *fiber.Ctx) (uuid.UUID, error) {
	if wsID := middleware.GetWorkspaceID(c); wsID != uuid.Nil {
		return wsID, nil
	}
	raw := strings.TrimSpace(c.Get("X-Workspace-ID"))
	if raw == "" {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "X-Workspace-ID é obrigatório")
	}
	return uuid.Parse(raw)
}

// GET /v1/crm/tasks
//   ?status=pending|in_progress|completed|cancelled
//   ?type=call|follow_up|message|...
//   ?assignee_user_id=...
//   ?deal_id=... ?contact_id=... ?company_id=... ?meeting_id=...
//   ?due_before=2024-12-31  ?due_after=2024-01-01
//   ?limit=50 ?offset=0
func (h *CrmTaskHandler) List(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	q := h.db.Where("workspace_id = ?", wsID)
	if v := c.Query("status"); v != "" {
		q = q.Where("status = ?", v)
	}
	if v := c.Query("type"); v != "" {
		q = q.Where("type = ?", v)
	}
	if v := c.Query("assignee_user_id"); v != "" {
		q = q.Where("assignee_user_id = ?", v)
	}
	if v := c.Query("deal_id"); v != "" {
		q = q.Where("deal_id = ?", v)
	}
	if v := c.Query("contact_id"); v != "" {
		q = q.Where("contact_id = ?", v)
	}
	if v := c.Query("company_id"); v != "" {
		q = q.Where("company_id = ?", v)
	}
	if v := c.Query("meeting_id"); v != "" {
		q = q.Where("meeting_id = ?", v)
	}
	if v := c.Query("due_before"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q = q.Where("due_at <= ?", t)
		}
	}
	if v := c.Query("due_after"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q = q.Where("due_at >= ?", t)
		}
	}

	limit := c.QueryInt("limit", 50)
	if limit > 200 {
		limit = 200
	}
	offset := c.QueryInt("offset", 0)

	var total int64
	q.Model(&models.CrmTask{}).Count(&total)

	var tasks []models.CrmTask
	if err := q.Order("due_at ASC NULLS LAST, created_at DESC").
		Limit(limit).Offset(offset).Find(&tasks).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": tasks, "total": total, "limit": limit, "offset": offset})
}

func (h *CrmTaskHandler) Get(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var t models.CrmTask
	if err := h.db.Where("workspace_id = ? AND id = ?", wsID, id).First(&t).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tarefa não encontrada"})
	}
	return c.JSON(t)
}

func (h *CrmTaskHandler) Create(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	userID := middleware.GetCurrentUserID(c)
	if userID == uuid.Nil {
		return fiber.NewError(fiber.StatusUnauthorized, "não autenticado")
	}
	var body models.CrmTask
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if strings.TrimSpace(body.Title) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "title é obrigatório"})
	}
	// Tarefa precisa estar atrelada a algo: deal/contact/company/meeting/conversation,
	// OU ter um responsável (user/agent), pra evitar tarefas órfãs sem
	// contexto. Antes era trivial criar uma task sem nenhum vínculo —
	// resultado: lista geral de tasks tinha lixo.
	hasEntity := body.DealID != nil || body.ContactID != nil || body.CompanyID != nil ||
		body.MeetingID != nil || body.ConversationID != nil
	hasAssignee := body.AssigneeUserID != nil || body.AssigneeAgentID != nil
	if !hasEntity && !hasAssignee {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "task precisa estar vinculada a uma entidade (deal/contact/company/meeting) OU ter um responsável (user/agent)",
		})
	}
	body.WorkspaceID = wsID
	body.CreatedByID = userID
	body.ID = uuid.Nil
	if err := h.db.Create(&body).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(body)
}

func (h *CrmTaskHandler) Update(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var existing models.CrmTask
	if err := h.db.Where("workspace_id = ? AND id = ?", wsID, id).First(&existing).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tarefa não encontrada"})
	}
	var patch map[string]any
	if err := c.BodyParser(&patch); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	// Bloqueia override de campos imutáveis pra evitar tenant escape.
	for _, k := range []string{"id", "workspace_id", "created_by_id", "created_at", "deleted_at"} {
		delete(patch, k)
	}
	// Quando status vira completed, marca completed_at automaticamente
	// (UI não precisa mandar) — e zera quando volta pra pending.
	if v, ok := patch["status"]; ok {
		switch v {
		case string(models.TaskStatusCompleted):
			now := time.Now()
			patch["completed_at"] = now
		case string(models.TaskStatusPending), string(models.TaskStatusInProgress):
			patch["completed_at"] = nil
		}
	}
	// metadata vem como object — converte pra JSON pro datatypes.JSON.
	if md, ok := patch["metadata"]; ok {
		if b, err := json.Marshal(md); err == nil {
			patch["metadata"] = json.RawMessage(b)
		}
	}
	if err := h.db.Model(&existing).Updates(patch).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.First(&existing, "id = ?", existing.ID)
	return c.JSON(existing)
}

func (h *CrmTaskHandler) Delete(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", wsID, id).Delete(&models.CrmTask{})
	if res.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": res.Error.Error()})
	}
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tarefa não encontrada"})
	}
	return c.JSON(fiber.Map{"deleted": true})
}

// POST /v1/crm/tasks/:id/complete — atalho idempotente pra UI marcar
// tarefa como concluída sem montar PATCH.
func (h *CrmTaskHandler) Complete(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	now := time.Now()
	res := h.db.Model(&models.CrmTask{}).
		Where("workspace_id = ? AND id = ?", wsID, id).
		Updates(map[string]any{"status": models.TaskStatusCompleted, "completed_at": now})
	if res.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": res.Error.Error()})
	}
	return c.JSON(fiber.Map{"completed": true})
}
