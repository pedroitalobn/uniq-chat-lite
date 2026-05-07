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

type CrmMeetingHandler struct{ db *gorm.DB }

func NewCrmMeetingHandler(db *gorm.DB) *CrmMeetingHandler { return &CrmMeetingHandler{db: db} }

func (h *CrmMeetingHandler) resolveWorkspaceID(c *fiber.Ctx) (uuid.UUID, error) {
	if wsID := middleware.GetWorkspaceID(c); wsID != uuid.Nil {
		return wsID, nil
	}
	raw := strings.TrimSpace(c.Get("X-Workspace-ID"))
	if raw == "" {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "X-Workspace-ID é obrigatório")
	}
	return uuid.Parse(raw)
}

// GET /v1/crm/meetings?status=...&deal_id=...&from=...&to=...
func (h *CrmMeetingHandler) List(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	q := h.db.Where("workspace_id = ?", wsID)
	if v := c.Query("status"); v != "" {
		q = q.Where("status = ?", v)
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
	// Janela temporal — útil pra UI de calendário (mês/semana corrente).
	if v := c.Query("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q = q.Where("end_at >= ?", t)
		}
	}
	if v := c.Query("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q = q.Where("start_at <= ?", t)
		}
	}

	limit := c.QueryInt("limit", 100)
	if limit > 500 {
		limit = 500
	}
	offset := c.QueryInt("offset", 0)

	var total int64
	q.Model(&models.CrmMeeting{}).Count(&total)

	var ms []models.CrmMeeting
	if err := q.Order("start_at ASC").Limit(limit).Offset(offset).Find(&ms).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": ms, "total": total, "limit": limit, "offset": offset})
}

func (h *CrmMeetingHandler) Get(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var m models.CrmMeeting
	if err := h.db.Where("workspace_id = ? AND id = ?", wsID, id).First(&m).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "reunião não encontrada"})
	}
	return c.JSON(m)
}

func (h *CrmMeetingHandler) Create(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	userID := middleware.GetCurrentUserID(c)
	if userID == uuid.Nil {
		return fiber.NewError(fiber.StatusUnauthorized, "não autenticado")
	}
	var body models.CrmMeeting
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if strings.TrimSpace(body.Title) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "title é obrigatório"})
	}
	if body.StartAt.IsZero() || body.EndAt.IsZero() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "start_at e end_at são obrigatórios"})
	}
	if body.EndAt.Before(body.StartAt) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "end_at deve ser após start_at"})
	}
	// Reunião deve estar atrelada a deal/contact/company OU ter
	// attendees explícitos — sem isso vira evento órfão sem contexto.
	hasEntity := body.DealID != nil || body.ContactID != nil || body.CompanyID != nil
	hasAttendees := len(body.Attendees) > 0
	if !hasEntity && !hasAttendees {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "reunião precisa estar vinculada a um deal/contact/company OU ter pelo menos 1 attendee",
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

func (h *CrmMeetingHandler) Update(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var existing models.CrmMeeting
	if err := h.db.Where("workspace_id = ? AND id = ?", wsID, id).First(&existing).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "reunião não encontrada"})
	}
	var patch map[string]any
	if err := c.BodyParser(&patch); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	for _, k := range []string{"id", "workspace_id", "created_by_id", "created_at", "deleted_at"} {
		delete(patch, k)
	}
	for _, k := range []string{"attendees", "metadata", "reminder_minutes"} {
		if v, ok := patch[k]; ok {
			if b, err := json.Marshal(v); err == nil {
				patch[k] = json.RawMessage(b)
			}
		}
	}
	if err := h.db.Model(&existing).Updates(patch).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.First(&existing, "id = ?", existing.ID)
	return c.JSON(existing)
}

func (h *CrmMeetingHandler) Delete(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", wsID, id).Delete(&models.CrmMeeting{})
	if res.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": res.Error.Error()})
	}
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "reunião não encontrada"})
	}
	return c.JSON(fiber.Map{"deleted": true})
}
