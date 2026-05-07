package handlers

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

type DealHandler struct {
	db         *gorm.DB
	dispatcher *services.CrmJourneyDispatcher
}

func NewDealHandler(db *gorm.DB) *DealHandler {
	return &DealHandler{
		db:         db,
		dispatcher: services.NewCrmJourneyDispatcher(db),
	}
}

// List GET /v1/crm/deals?funnel_id=&stage_id=&status=&owner_id=&contact_id=&company_id=&q=&limit=&offset=
//
// Default behavior: returns open deals only, sorted by stage_change_at desc.
// The Kanban view in the frontend queries with funnel_id set and iterates
// per-stage on the client using the returned items.
func (h *DealHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Model(&models.Deal{}).Where("workspace_id = ?", ws)

	if raw := c.Query("status"); raw != "" {
		statuses := strings.Split(raw, ",")
		q = q.Where("status IN ?", statuses)
	} else {
		q = q.Where("status = ?", models.DealStatusOpen)
	}
	if v := c.Query("funnel_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("funnel_id = ?", id)
		}
	}
	if v := c.Query("stage_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("stage_id = ?", id)
		}
	}
	if v := c.Query("owner_id"); v != "" {
		if v == "me" {
			q = q.Where("owner_id = ?", middleware.GetCurrentUserID(c))
		} else if id, err := uuid.Parse(v); err == nil {
			q = q.Where("owner_id = ?", id)
		}
	}
	if v := c.Query("contact_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("contact_id = ?", id)
		}
	}
	if v := c.Query("company_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("company_id = ?", id)
		}
	}
	// instance_id: filtra deals cujos contatos pertencem à instância dada.
	// Útil pra agentes que operam múltiplas instâncias (ex.: 1 ws com 3
	// instâncias WhatsApp diferentes pra produtos distintos).
	if v := c.Query("instance_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("contact_id IN (SELECT id FROM contacts WHERE instance_id = ?)", id)
		}
	}
	// tag_id: deal tem ao menos uma tag específica.
	if v := c.Query("tag_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("id IN (SELECT deal_id FROM deal_tags WHERE tag_id = ?)", id)
		}
	}
	if term := strings.TrimSpace(c.Query("q")); term != "" {
		pattern := "%" + term + "%"
		q = q.Where("title ILIKE ? OR description ILIKE ?", pattern, pattern)
	}

	limit := atoiDefault(c.Query("limit"), 100)
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	var total int64
	q.Count(&total)
	var items []models.Deal
	q.Preload("Contact").Preload("Company").Preload("Owner").Preload("Tags").
		Order("COALESCE(stage_change_at, updated_at) DESC").
		Limit(limit).Offset(atoiDefault(c.Query("offset"), 0)).Find(&items)
	return c.JSON(fiber.Map{"items": items, "total": total, "limit": limit})
}

// Summary GET /v1/crm/deals/summary?funnel_id=
// Returns per-stage counters + value sums — the Kanban column headers use it
// to show "X deals · R$ Y" without loading all deals.
func (h *DealHandler) Summary(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	funnelID, err := uuid.Parse(c.Query("funnel_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "funnel_id inválido"})
	}
	type row struct {
		StageID uuid.UUID `json:"stage_id"`
		Count   int64     `json:"count"`
		Sum     int64     `json:"value_sum"`
	}
	var rows []row
	h.db.Raw(`
		SELECT stage_id, COUNT(*) AS count, COALESCE(SUM(value), 0) AS sum
		FROM deals
		WHERE workspace_id = ? AND funnel_id = ? AND status = 'open' AND deleted_at IS NULL
		GROUP BY stage_id
	`, ws, funnelID).Scan(&rows)

	// Global totals
	var totalOpen, wonCount, lostCount int64
	var wonValue int64
	h.db.Model(&models.Deal{}).Where("workspace_id = ? AND funnel_id = ? AND status = 'open'", ws, funnelID).Count(&totalOpen)
	h.db.Model(&models.Deal{}).Where("workspace_id = ? AND funnel_id = ? AND status = 'won'", ws, funnelID).Count(&wonCount)
	h.db.Raw(`SELECT COALESCE(SUM(value), 0) FROM deals WHERE workspace_id = ? AND funnel_id = ? AND status = 'won' AND deleted_at IS NULL`, ws, funnelID).Scan(&wonValue)
	h.db.Model(&models.Deal{}).Where("workspace_id = ? AND funnel_id = ? AND status = 'lost'", ws, funnelID).Count(&lostCount)

	return c.JSON(fiber.Map{
		"stages":     rows,
		"total_open": totalOpen,
		"won_count":  wonCount,
		"won_value":  wonValue,
		"lost_count": lostCount,
	})
}

// Get GET /v1/crm/deals/:id
func (h *DealHandler) Get(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var d models.Deal
	if err := h.db.Preload("Contact").Preload("Company").Preload("Owner").Preload("Tags").
		Where("workspace_id = ? AND id = ?", ws, id).First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	return c.JSON(d)
}

// Create POST /v1/crm/deals
func (h *DealHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body models.Deal
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if body.Title == "" || body.ContactID == uuid.Nil || body.FunnelID == uuid.Nil || body.StageID == uuid.Nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "title, contact_id, funnel_id e stage_id são obrigatórios"})
	}
	// Validate contact & funnel belong to this workspace
	var contactCount int64
	h.db.Model(&models.Contact{}).Where("id = ? AND (workspace_id = ? OR workspace_id IS NULL)", body.ContactID, ws).Count(&contactCount)
	if contactCount == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "contato inválido"})
	}
	var stageCount int64
	h.db.Model(&models.FunnelStage{}).Where("id = ? AND funnel_id = ?", body.StageID, body.FunnelID).Count(&stageCount)
	if stageCount == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "estágio não pertence ao funil"})
	}
	body.WorkspaceID = ws
	if body.OwnerID == nil {
		u := middleware.GetCurrentUserID(c)
		body.OwnerID = &u
	}
	now := time.Now()
	body.StageChangeAt = &now
	if err := h.db.Create(&body).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.activity(&body, models.DealActivityCreated, "Deal criado", nil, middleware.GetCurrentUserID(c))
	h.bumpContactDealCounters(body.ContactID)
	if body.CompanyID != nil {
		h.bumpCompanyDealCounters(*body.CompanyID)
	}
	// CRM v2: dispara journey trigger "deal_created" pra qualquer journey
	// configurada com esse trigger + filtro (funnel_id/stage_id).
	h.dispatcher.FireDealEvent(models.TriggerDealCreated, &body)
	return c.Status(fiber.StatusCreated).JSON(body)
}

// Patch PATCH /v1/crm/deals/:id — accepts arbitrary allowed fields.
// Stage changes via this endpoint ALSO update stage_change_at and emit a
// stage_changed activity, so POST /move is a convenience wrapper for the UI
// but clients that just want to PATCH stage_id get equivalent behavior.
func (h *DealHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var d models.Deal
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	actor := middleware.GetCurrentUserID(c)
	allowed := map[string]bool{
		"title": true, "description": true, "value": true, "currency": true,
		"probability": true, "expected_close_date": true, "stage_id": true,
		"funnel_id": true, "company_id": true, "owner_id": true,
		"priority": true, "source": true, "is_archived": true,
	}
	update := map[string]any{}
	var newStageID *uuid.UUID
	for k, v := range body {
		if !allowed[k] {
			continue
		}
		if k == "stage_id" {
			if s, ok := v.(string); ok {
				if id, err := uuid.Parse(s); err == nil && id != d.StageID {
					newStageID = &id
				}
			}
		}
		update[k] = v
	}
	if newStageID != nil {
		// Verify stage belongs to the (possibly new) funnel
		fid := d.FunnelID
		if raw, ok := body["funnel_id"].(string); ok {
			if id, err := uuid.Parse(raw); err == nil {
				fid = id
			}
		}
		var cnt int64
		h.db.Model(&models.FunnelStage{}).Where("id = ? AND funnel_id = ?", *newStageID, fid).Count(&cnt)
		if cnt == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "estágio não pertence ao funil"})
		}
		now := time.Now()
		update["stage_change_at"] = now
	}
	if len(update) > 0 {
		h.db.Model(&d).Updates(update)
	}
	h.db.Preload("Contact").Preload("Company").Preload("Owner").Preload("Tags").First(&d, "id = ?", id)
	if newStageID != nil {
		payload, _ := json.Marshal(map[string]any{"from": d.StageID, "to": *newStageID})
		h.activity(&d, models.DealActivityStageChanged, "Estágio alterado", string(payload), actor)
	}
	return c.JSON(d)
}

// Move POST /v1/crm/deals/:id/move  { stage_id }
// Dedicated endpoint for the Kanban drag-drop path; same effect as PATCH
// stage_id but keeps the frontend semantics explicit.
func (h *DealHandler) Move(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct{ StageID string `json:"stage_id"` }
	c.BodyParser(&body)
	newStageID, err := uuid.Parse(body.StageID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "stage_id inválido"})
	}
	var d models.Deal
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	if d.StageID == newStageID {
		return c.JSON(d)
	}
	var stage models.FunnelStage
	if err := h.db.Where("id = ? AND funnel_id = ?", newStageID, d.FunnelID).First(&stage).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "estágio não pertence ao funil"})
	}
	prev := d.StageID
	now := time.Now()
	update := map[string]any{"stage_id": newStageID, "stage_change_at": now}
	// Auto-finalize when stage is marked as won/lost
	if stage.IsWon {
		update["status"] = models.DealStatusWon
		update["won_at"] = now
	} else if stage.IsLost {
		update["status"] = models.DealStatusLost
		update["lost_at"] = now
	}
	// Default probability from stage when non-explicit
	if stage.Probability > 0 && d.Probability == nil {
		p := stage.Probability
		update["probability"] = p
	}
	h.db.Model(&d).Updates(update)

	payload, _ := json.Marshal(map[string]any{"from": prev, "to": newStageID})
	h.activity(&d, models.DealActivityStageChanged, "Estágio alterado", string(payload), middleware.GetCurrentUserID(c))
	if stage.IsWon {
		h.activity(&d, models.DealActivityWon, "Deal ganho", nil, middleware.GetCurrentUserID(c))
	} else if stage.IsLost {
		h.activity(&d, models.DealActivityLost, "Deal perdido", nil, middleware.GetCurrentUserID(c))
	}
	h.db.Preload("Contact").Preload("Company").Preload("Owner").Preload("Tags").First(&d, "id = ?", id)

	// CRM v2: dispara journeys vinculadas a eventos de deal — async,
	// não atrasa a response.
	h.dispatcher.FireDealEvent(models.TriggerDealStageEnter, &d)
	if stage.IsWon {
		h.dispatcher.FireDealEvent(models.TriggerDealWon, &d)
	} else if stage.IsLost {
		h.dispatcher.FireDealEvent(models.TriggerDealLost, &d)
	}
	return c.JSON(d)
}

// Win POST /v1/crm/deals/:id/win
func (h *DealHandler) Win(c *fiber.Ctx) error {
	return h.finalize(c, models.DealStatusWon, models.DealActivityWon)
}

// Lose POST /v1/crm/deals/:id/lose  { reason }
func (h *DealHandler) Lose(c *fiber.Ctx) error {
	return h.finalize(c, models.DealStatusLost, models.DealActivityLost)
}

// Reopen POST /v1/crm/deals/:id/reopen
func (h *DealHandler) Reopen(c *fiber.Ctx) error {
	return h.finalize(c, models.DealStatusOpen, models.DealActivityReopened)
}

func (h *DealHandler) finalize(c *fiber.Ctx, status models.DealStatus, activity models.DealActivityType) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var d models.Deal
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	var body struct{ Reason string `json:"reason"` }
	c.BodyParser(&body)
	now := time.Now()
	update := map[string]any{"status": status}
	switch status {
	case models.DealStatusWon:
		update["won_at"] = now
		update["lost_at"] = nil
		update["lost_reason"] = ""
	case models.DealStatusLost:
		update["lost_at"] = now
		update["won_at"] = nil
		update["lost_reason"] = body.Reason
	case models.DealStatusOpen:
		update["won_at"] = nil
		update["lost_at"] = nil
	}
	h.db.Model(&d).Updates(update)
	h.activity(&d, activity, "", nil, middleware.GetCurrentUserID(c))
	h.db.Preload("Contact").Preload("Company").Preload("Owner").First(&d, "id = ?", id)

	// Goal/Exit hooks pra Journey: dispara evento "deal.won" / "deal.lost"
	// pro contato. JourneyEventDispatcher trata goal counter + exit.
	if d.Contact != nil && d.Contact.Phone != "" {
		eventName := "deal." + string(status)
		jid := d.Contact.Phone + "@s.whatsapp.net"
		services.DispatchJourneyEvent(eventName, jid, map[string]any{
			"deal_id":   d.ID.String(),
			"funnel_id": d.FunnelID.String(),
			"value":     d.Value,
			"currency":  d.Currency,
			"reason":    body.Reason,
		})
	}
	// CRM v2: dispara journey trigger correspondente (deal_won/deal_lost).
	switch status {
	case models.DealStatusWon:
		h.dispatcher.FireDealEvent(models.TriggerDealWon, &d)
	case models.DealStatusLost:
		h.dispatcher.FireDealEvent(models.TriggerDealLost, &d)
	}
	return c.JSON(d)
}

// Delete DELETE /v1/crm/deals/:id (soft)
func (h *DealHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("workspace_id = ? AND id = ?", ws, id).Delete(&models.Deal{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// Timeline GET /v1/crm/deals/:id/timeline
func (h *DealHandler) Timeline(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var cnt int64
	h.db.Model(&models.Deal{}).Where("workspace_id = ? AND id = ?", ws, id).Count(&cnt)
	if cnt == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	var items []models.DealActivity
	h.db.Where("deal_id = ?", id).Order("created_at DESC").Limit(500).Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// AddNote POST /v1/crm/deals/:id/notes  { body }
func (h *DealHandler) AddNote(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var d models.Deal
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "deal não encontrado"})
	}
	var body struct{ Body string `json:"body"` }
	c.BodyParser(&body)
	if strings.TrimSpace(body.Body) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body é obrigatório"})
	}
	h.activity(&d, models.DealActivityNoteAdded, "", body.Body, middleware.GetCurrentUserID(c))
	return c.JSON(fiber.Map{"ok": true})
}

// -- helpers ---------------------------------------------------------------

func (h *DealHandler) activity(d *models.Deal, t models.DealActivityType, title string, body any, actor uuid.UUID) {
	a := models.DealActivity{
		DealID:      d.ID,
		WorkspaceID: d.WorkspaceID,
		Type:        t,
		Title:       title,
		ActorUserID: &actor,
	}
	switch v := body.(type) {
	case string:
		a.Body = v
		a.Payload = v
	case nil:
		// nothing
	default:
		if b, err := json.Marshal(v); err == nil {
			a.Payload = string(b)
		}
	}
	h.db.Create(&a)
}

// bumpContactDealCounters maintains Contact.DealsOpen / DealsWon caches.
func (h *DealHandler) bumpContactDealCounters(contactID uuid.UUID) {
	var open, won int64
	h.db.Model(&models.Deal{}).Where("contact_id = ? AND status = 'open' AND deleted_at IS NULL", contactID).Count(&open)
	h.db.Model(&models.Deal{}).Where("contact_id = ? AND status = 'won' AND deleted_at IS NULL", contactID).Count(&won)
	h.db.Model(&models.Contact{}).Where("id = ?", contactID).Updates(map[string]any{
		"deals_open": open, "deals_won": won,
	})
}

func (h *DealHandler) bumpCompanyDealCounters(companyID uuid.UUID) {
	var count int64
	var openSum int64
	h.db.Model(&models.Deal{}).Where("company_id = ? AND deleted_at IS NULL", companyID).Count(&count)
	h.db.Raw(`SELECT COALESCE(SUM(value),0) FROM deals WHERE company_id = ? AND status = 'open' AND deleted_at IS NULL`, companyID).Scan(&openSum)
	h.db.Model(&models.Company{}).Where("id = ?", companyID).Updates(map[string]any{
		"deal_count": count, "open_deal_sum": openSum,
	})
}
