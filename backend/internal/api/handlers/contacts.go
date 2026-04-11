package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type ContactHandler struct {
	db *gorm.DB
}

func NewContactHandler(db *gorm.DB) *ContactHandler {
	return &ContactHandler{db: db}
}

func (h *ContactHandler) currentUserID(c *fiber.Ctx) (uuid.UUID, error) {
	raw := c.Locals("user_id")
	if raw == nil {
		return uuid.Nil, fiber.NewError(fiber.StatusUnauthorized, "não autenticado")
	}
	id, ok := raw.(uuid.UUID)
	if !ok {
		return uuid.Nil, fiber.NewError(fiber.StatusUnauthorized, "ID de usuário inválido")
	}
	return id, nil
}

// ListContacts godoc
// GET /crm/contacts
func (h *ContactHandler) ListContacts(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	search := c.Query("search")
	tagID := c.Query("tag_id")
	funnel := c.Query("funnel")
	stage := c.Query("stage")
	journey := c.Query("journey")
	owner := c.Query("owner")
	externalID := c.Query("external_id")
	workspaceID := c.Query("workspace_id")
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	query := h.db.Model(&models.Contact{}).Where("user_id = ?", userID).Preload("Tags")
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			query = query.Where("workspace_id = ?", wid)
		}
	}
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("name ILIKE ? OR phone ILIKE ? OR email ILIKE ? OR external_id ILIKE ? OR owner ILIKE ?",
			like, like, like, like, like)
	}
	if tagID != "" {
		query = query.Joins("JOIN contact_tags ON contact_tags.contact_id = contacts.id").
			Where("contact_tags.tag_id = ?", tagID)
	}
	if funnel != "" {
		query = query.Where("funnel = ?", funnel)
	}
	if stage != "" {
		query = query.Where("stage = ?", stage)
	}
	if journey != "" {
		query = query.Where("journey = ?", journey)
	}
	if owner != "" {
		query = query.Where("owner = ?", owner)
	}
	if externalID != "" {
		query = query.Where("external_id = ?", externalID)
	}

	var total int64
	query.Count(&total)

	var contacts []models.Contact
	if err := query.Order("name ASC").Limit(limit).Offset(offset).Find(&contacts).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar contatos"})
	}
	return c.JSON(fiber.Map{"data": contacts, "total": total, "limit": limit, "offset": offset})
}

// CreateContact godoc
// POST /crm/contacts
func (h *ContactHandler) CreateContact(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	var req struct {
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name"`
		Phone       string `json:"phone"`
		Email       string `json:"email"`
		Notes       string `json:"notes"`
		AvatarURL   string `json:"avatar_url"`
		Funnel      string `json:"funnel"`
		Stage       string `json:"stage"`
		Journey     string `json:"journey"`
		ExternalID  string `json:"external_id"`
		Owner       string `json:"owner"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" || req.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'name' e 'phone' são obrigatórios"})
	}
	contact := models.Contact{
		UserID:     userID,
		Name:       req.Name,
		Phone:      req.Phone,
		Email:      req.Email,
		Notes:      req.Notes,
		AvatarURL:  req.AvatarURL,
		Funnel:     req.Funnel,
		Stage:      req.Stage,
		Journey:    req.Journey,
		ExternalID: req.ExternalID,
		Owner:      req.Owner,
	}
	if req.WorkspaceID != "" {
		if wid, err := uuid.Parse(req.WorkspaceID); err == nil {
			contact.WorkspaceID = &wid
		}
	}
	if err := h.db.Create(&contact).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar contato"})
	}
	return c.Status(fiber.StatusCreated).JSON(contact)
}

// GetContact godoc
// GET /crm/contacts/:id
func (h *ContactHandler) GetContact(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	contactID := c.Params("id")
	var contact models.Contact
	if err := h.db.Preload("Tags").Where("id = ? AND user_id = ?", contactID, userID).First(&contact).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "contato não encontrado"})
	}
	return c.JSON(contact)
}

// UpdateContact godoc
// PUT /crm/contacts/:id
func (h *ContactHandler) UpdateContact(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	contactID := c.Params("id")
	var contact models.Contact
	if err := h.db.Where("id = ? AND user_id = ?", contactID, userID).First(&contact).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "contato não encontrado"})
	}
	var req struct {
		Name       string `json:"name"`
		Phone      string `json:"phone"`
		Email      string `json:"email"`
		Notes      string `json:"notes"`
		AvatarURL  string `json:"avatar_url"`
		Funnel     string `json:"funnel"`
		Stage      string `json:"stage"`
		Journey    string `json:"journey"`
		ExternalID string `json:"external_id"`
		Owner      string `json:"owner"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	updates := map[string]interface{}{
		"email":       req.Email,
		"notes":       req.Notes,
		"avatar_url":  req.AvatarURL,
		"funnel":      req.Funnel,
		"stage":       req.Stage,
		"journey":     req.Journey,
		"external_id": req.ExternalID,
		"owner":       req.Owner,
	}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Phone != "" {
		updates["phone"] = req.Phone
	}
	h.db.Model(&contact).Updates(updates)
	h.db.Preload("Tags").First(&contact)
	return c.JSON(contact)
}

// DeleteContact godoc
// DELETE /crm/contacts/:id
func (h *ContactHandler) DeleteContact(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	contactID := c.Params("id")
	if err := h.db.Where("id = ? AND user_id = ?", contactID, userID).Delete(&models.Contact{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar contato"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// AssignTags godoc
// PUT /crm/contacts/:id/tags
func (h *ContactHandler) AssignTags(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	contactID := c.Params("id")
	var contact models.Contact
	if err := h.db.Where("id = ? AND user_id = ?", contactID, userID).First(&contact).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "contato não encontrado"})
	}
	var req struct {
		TagIDs []string `json:"tag_ids"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	var tags []models.Tag
	if len(req.TagIDs) > 0 {
		h.db.Where("id IN ? AND user_id = ?", req.TagIDs, userID).Find(&tags)
	}
	h.db.Model(&contact).Association("Tags").Replace(tags)
	h.db.Preload("Tags").First(&contact)
	return c.JSON(contact)
}

// ── Tags ──────────────────────────────────────────────────────────────────────

// ListTags godoc
// GET /crm/tags
func (h *ContactHandler) ListTags(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	workspaceID := c.Query("workspace_id")
	query := h.db.Where("user_id = ?", userID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			query = query.Where("workspace_id = ?", wid)
		}
	}
	var tags []models.Tag
	query.Order("name ASC").Find(&tags)
	return c.JSON(tags)
}

// CreateTag godoc
// POST /crm/tags
func (h *ContactHandler) CreateTag(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	var req struct {
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name"`
		Color       string `json:"color"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	tag := models.Tag{UserID: userID, Name: req.Name, Color: req.Color}
	if tag.Color == "" {
		tag.Color = "#64748b"
	}
	if req.WorkspaceID != "" {
		if wid, err := uuid.Parse(req.WorkspaceID); err == nil {
			tag.WorkspaceID = &wid
		}
	}
	if err := h.db.Create(&tag).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar tag"})
	}
	return c.Status(fiber.StatusCreated).JSON(tag)
}

// DeleteTag godoc
// DELETE /crm/tags/:id
func (h *ContactHandler) DeleteTag(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	tagID := c.Params("id")
	if err := h.db.Where("id = ? AND user_id = ?", tagID, userID).Delete(&models.Tag{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar tag"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ─── Funnels ─────────────────────────────────────────────────────────────────

// ListFunnels GET /crm/funnels
func (h *ContactHandler) ListFunnels(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	workspaceID := c.Query("workspace_id")
	query := h.db.Where("user_id = ?", userID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			query = query.Where("workspace_id = ?", wid)
		}
	}
	var funnels []models.Funnel
	if err := query.Order("name ASC").Find(&funnels).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar funis"})
	}
	return c.JSON(funnels)
}

// CreateFunnel POST /crm/funnels
func (h *ContactHandler) CreateFunnel(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	var req struct {
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}
	funnel := models.Funnel{
		UserID: userID,
		Name:   req.Name,
	}
	if req.WorkspaceID != "" {
		if wid, err := uuid.Parse(req.WorkspaceID); err == nil {
			funnel.WorkspaceID = &wid
		}
	}
	if err := h.db.Create(&funnel).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar funil"})
	}
	return c.Status(fiber.StatusCreated).JSON(funnel)
}

// DeleteFunnel DELETE /crm/funnels/:id
func (h *ContactHandler) DeleteFunnel(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	funnelID := c.Params("id")
	if err := h.db.Where("id = ? AND user_id = ?", funnelID, userID).Delete(&models.Funnel{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar funil"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ─── Funnel Stages ─────────────────────────────────────────────────────────────

// ListFunnelStages GET /crm/funnels/:id/stages
func (h *ContactHandler) ListFunnelStages(c *fiber.Ctx) error {
	funnelID := c.Params("id")
	var stages []models.FunnelStage
	if err := h.db.Where("funnel_id = ?", funnelID).Order("\"order\" ASC").Find(&stages).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar etapas"})
	}
	return c.JSON(stages)
}

// CreateFunnelStage POST /crm/funnels/:id/stages
func (h *ContactHandler) CreateFunnelStage(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	funnelID := c.Params("id")
	var funnel models.Funnel
	if err := h.db.Where("id = ? AND user_id = ?", funnelID, userID).First(&funnel).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "funil não encontrado"})
	}
	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}
	var maxOrder int
	h.db.Model(&models.FunnelStage{}).Where("funnel_id = ?", funnelID).Select("COALESCE(MAX(\"order\"), 0)").Scan(&maxOrder)
	stage := models.FunnelStage{
		FunnelID: funnel.ID,
		Name:     req.Name,
		Order:    maxOrder + 1,
		Color:    req.Color,
	}
	if err := h.db.Create(&stage).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar etapa"})
	}
	return c.Status(fiber.StatusCreated).JSON(stage)
}

// DeleteFunnelStage DELETE /crm/funnels/:id/stages/:stageId
func (h *ContactHandler) DeleteFunnelStage(c *fiber.Ctx) error {
	stageID := c.Params("stageId")
	if err := h.db.Delete(&models.FunnelStage{}, "id = ?", stageID).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar etapa"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ─── Journey Options ───────────────────────────────────────────────────────────

// ListJourneyOptions GET /crm/journey-options
func (h *ContactHandler) ListJourneyOptions(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	var journeys []models.Journey
	h.db.Where("user_id = ? AND status = 'active'", userID).Order("name ASC").Find(&journeys)
	names := make([]string, len(journeys))
	for i, j := range journeys {
		names[i] = j.Name
	}
	return c.JSON(names)
}

// ListStageOptions GET /crm/stage-options
func (h *ContactHandler) ListStageOptions(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	var stages []string
	h.db.Model(&models.Contact{}).Where("user_id = ? AND stage IS NOT NULL AND stage != ''", userID).Distinct("stage").Pluck("stage", &stages)
	return c.JSON(stages)
}

// ListFunnelOptions GET /crm/funnel-options
func (h *ContactHandler) ListFunnelOptions(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	var funnels []string
	h.db.Model(&models.Contact{}).Where("user_id = ? AND funnel IS NOT NULL AND funnel != ''", userID).Distinct("funnel").Pluck("funnel", &funnels)
	return c.JSON(funnels)
}
