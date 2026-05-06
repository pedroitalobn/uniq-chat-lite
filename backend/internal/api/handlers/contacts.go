package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
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
	ownerID := c.Query("owner_id")
	externalID := c.Query("external_id")
	workspaceID := c.Query("workspace_id")
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	query := h.db.Model(&models.Contact{}).Where("user_id = ?", userID).Preload("Tags")
	// Exclui contatos "lixo" criados automaticamente a partir de JIDs de
	// grupo antes do fix (phone no formato "<groupid>-<timestamp>"). Real
	// phones nunca têm hífen; grupos sempre têm. Também filtra phones
	// vazios (registros tortos sem nada).
	query = query.Where("phone IS NOT NULL AND phone <> '' AND phone NOT LIKE '%-%'")
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			query = query.Where("workspace_id = ?", wid)
			// Aplica RBAC scope DENTRO do workspace selecionado. Owner do
			// workspace e super admin pulam o scope (veem tudo).
			query = h.applyContactScopeRBAC(c, query, wid, userID)
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
		query = query.Joins("LEFT JOIN users owner_users ON owner_users.id = contacts.owner_id").Where("owner_users.name ILIKE ?", "%"+owner+"%")
	}
	if ownerID != "" {
		if oid, err := uuid.Parse(ownerID); err == nil {
			query = query.Where("owner_id = ?", oid)
		}
	}
	if externalID != "" {
		query = query.Where("external_id = ?", externalID)
	}
	// instance_id: filtra contatos criados via uma instância específica
	// (Whatsapp/IG/etc). Espelha o filtro adicionado em deals/companies.
	if v := c.Query("instance_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			query = query.Where("instance_id = ?", id)
		}
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
		OwnerID     string `json:"owner_id"`
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
	}
	if req.WorkspaceID != "" {
		if wid, err := uuid.Parse(req.WorkspaceID); err == nil {
			contact.WorkspaceID = &wid
		}
	}
	if req.OwnerID != "" {
		if oid, err := uuid.Parse(req.OwnerID); err == nil {
			contact.OwnerID = &oid
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
	q := h.db.Preload("Tags").Where("id = ? AND user_id = ?", contactID, userID)
	// Aplica RBAC: se user passou workspace_id e contato pertence ao ws,
	// scope decide se enxerga. Se contato não tem workspace, libera (pré-RBAC).
	if ws := middleware.GetWorkspaceID(c); ws != uuid.Nil {
		q = h.applyContactScopeRBAC(c, q, ws, userID)
	}
	if err := q.First(&contact).Error; err != nil {
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
	q := h.db.Where("id = ? AND user_id = ?", contactID, userID)
	if ws := middleware.GetWorkspaceID(c); ws != uuid.Nil {
		q = h.applyContactScopeRBAC(c, q, ws, userID)
	}
	if err := q.First(&contact).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "contato não encontrado"})
	}
	// Pointer fields para distinguir "não enviado" de "enviado vazio".
	// Evita que atualizar um campo (ex.: funil pelo inbox) zere os demais.
	var req struct {
		Name       *string `json:"name"`
		Phone      *string `json:"phone"`
		Email      *string `json:"email"`
		Notes      *string `json:"notes"`
		AvatarURL  *string `json:"avatar_url"`
		Funnel     *string `json:"funnel"`
		Stage      *string `json:"stage"`
		Journey    *string `json:"journey"`
		ExternalID *string `json:"external_id"`
		OwnerID    *string `json:"owner_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	updates := map[string]interface{}{}
	if req.Name != nil && *req.Name != "" {
		updates["name"] = *req.Name
	}
	if req.Phone != nil && *req.Phone != "" {
		updates["phone"] = *req.Phone
	}
	if req.Email != nil {
		updates["email"] = *req.Email
	}
	if req.Notes != nil {
		updates["notes"] = *req.Notes
	}
	if req.AvatarURL != nil {
		updates["avatar_url"] = *req.AvatarURL
	}
	if req.Funnel != nil {
		updates["funnel"] = *req.Funnel
	}
	if req.Stage != nil {
		updates["stage"] = *req.Stage
	}
	if req.Journey != nil {
		updates["journey"] = *req.Journey
	}
	if req.ExternalID != nil {
		updates["external_id"] = *req.ExternalID
	}
	if req.OwnerID != nil && *req.OwnerID != "" {
		if oid, err := uuid.Parse(*req.OwnerID); err == nil {
			updates["owner_id"] = oid
		}
	}
	if len(updates) > 0 {
		h.db.Model(&contact).Updates(updates)
	}
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
	// Verifica acesso via RBAC antes de deletar
	q := h.db.Where("id = ? AND user_id = ?", contactID, userID)
	if ws := middleware.GetWorkspaceID(c); ws != uuid.Nil {
		q = h.applyContactScopeRBAC(c, q, ws, userID)
	}
	var existing models.Contact
	if err := q.First(&existing).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "contato não encontrado"})
	}
	if err := h.db.Delete(&existing).Error; err != nil {
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
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		Color:       req.Color,
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

// UpdateFunnel PUT /crm/funnels/:id
func (h *ContactHandler) UpdateFunnel(c *fiber.Ctx) error {
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
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Color       *string `json:"color"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "dados inválidos"})
	}
	updates := map[string]interface{}{}
	if req.Name != nil && *req.Name != "" {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if len(updates) > 0 {
		if err := h.db.Model(&funnel).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar funil"})
		}
	}
	return c.JSON(funnel)
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
		Order *int   `json:"order"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}
	order := 0
	if req.Order != nil {
		order = *req.Order
	} else {
		var maxOrder int
		h.db.Model(&models.FunnelStage{}).Where("funnel_id = ?", funnelID).Select("COALESCE(MAX(\"order\"), 0)").Scan(&maxOrder)
		order = maxOrder + 1
	}
	stage := models.FunnelStage{
		FunnelID: funnel.ID,
		Name:     req.Name,
		Order:    order,
		Color:    req.Color,
	}
	if err := h.db.Create(&stage).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar etapa"})
	}
	return c.Status(fiber.StatusCreated).JSON(stage)
}

// UpdateFunnelStage PUT /crm/funnels/:id/stages/:stageId
func (h *ContactHandler) UpdateFunnelStage(c *fiber.Ctx) error {
	stageID := c.Params("stageId")
	var stage models.FunnelStage
	if err := h.db.First(&stage, "id = ?", stageID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "etapa não encontrada"})
	}
	var req struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
		Order *int    `json:"order"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "dados inválidos"})
	}
	updates := map[string]interface{}{}
	if req.Name != nil && *req.Name != "" {
		updates["name"] = *req.Name
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if req.Order != nil {
		updates["order"] = *req.Order
	}
	if len(updates) > 0 {
		if err := h.db.Model(&stage).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar etapa"})
		}
	}
	return c.JSON(stage)
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

// mergeUnique append b em a preservando ordem e sem duplicar.
func mergeUnique(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, v := range a {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	for _, v := range b {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

// ListStageOptions GET /crm/stage-options
// Retorna etapas de funis cadastrados (funnel_stages) + etapas legadas
// derivadas de contacts.stage (retrocompat com dados anteriores ao CRUD de funis).
func (h *ContactHandler) ListStageOptions(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	workspaceID := c.Query("workspace_id")

	// Fonte da verdade: funnel_stages JOIN funnels (filtra por dono/workspace)
	sq := h.db.Table("funnel_stages").
		Joins("JOIN funnels ON funnels.id = funnel_stages.funnel_id").
		Where("funnels.user_id = ?", userID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			sq = sq.Where("funnels.workspace_id = ?", wid)
		}
	}
	var stageNames []string
	sq.Order("funnel_stages.\"order\" ASC").Distinct("funnel_stages.name").Pluck("funnel_stages.name", &stageNames)

	// Legacy: valores distintos em contacts.stage
	var legacy []string
	cq := h.db.Model(&models.Contact{}).Where("user_id = ? AND stage IS NOT NULL AND stage != ''", userID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			cq = cq.Where("workspace_id = ?", wid)
		}
	}
	cq.Distinct("stage").Pluck("stage", &legacy)

	return c.JSON(mergeUnique(stageNames, legacy))
}

// ListFunnelOptions GET /crm/funnel-options
// Retorna funis cadastrados (funnels) + funis legados (distinct contacts.funnel),
// para que um funil criado no CRM apareça no Inbox mesmo antes de ter atribuição.
func (h *ContactHandler) ListFunnelOptions(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	workspaceID := c.Query("workspace_id")

	// Fonte da verdade: tabela funnels
	fq := h.db.Model(&models.Funnel{}).Where("user_id = ?", userID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			fq = fq.Where("workspace_id = ?", wid)
		}
	}
	var funnelNames []string
	fq.Order("name ASC").Pluck("name", &funnelNames)

	// Legacy: valores distintos em contacts.funnel
	var legacy []string
	cq := h.db.Model(&models.Contact{}).Where("user_id = ? AND funnel IS NOT NULL AND funnel != ''", userID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			cq = cq.Where("workspace_id = ?", wid)
		}
	}
	cq.Distinct("funnel").Pluck("funnel", &legacy)

	return c.JSON(mergeUnique(funnelNames, legacy))
}

// applyContactScopeRBAC aplica o filtro de visibilidade do CRM baseado nas
// permissions do user no workspace.
//
// Hierarquia (mais permissivo ganha):
//   1. Workspace owner / super admin       → vê TUDO (sem filtro)
//   2. Permission contacts:view_all        → vê TUDO do workspace
//   3. Permission contacts:view_department → contatos cujo owner está no
//      mesmo department (via team membership)
//   4. Permission contacts:view_team       → contatos cujo owner está no
//      mesmo team
//   5. Default                             → só contatos onde owner_id = self
//      OU sem owner (sem owner = visível pra quem criou, via user_id já
//      filtrado acima)
func (h *ContactHandler) applyContactScopeRBAC(c *fiber.Ctx, q *gorm.DB, ws uuid.UUID, userID uuid.UUID) *gorm.DB {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return q
	}
	// Super admin bypass
	if user.Role == models.RoleSuperAdmin {
		return q
	}

	// Verifica se é owner do workspace
	var uw models.UserWorkspace
	if err := h.db.Where("user_id = ? AND workspace_id = ?", userID, ws).First(&uw).Error; err != nil {
		// Sem membership: bloqueia tudo (não deveria chegar aqui — middleware
		// já validou — mas por segurança).
		return q.Where("1 = 0")
	}
	if uw.IsOwner {
		return q
	}

	// Resolve permissions do role
	permKeys := map[string]bool{}
	if uw.RoleID != nil {
		var perms []models.Permission
		h.db.Model(&models.Permission{}).
			Joins("JOIN role_permissions rp ON rp.permission_id = permissions.id").
			Where("rp.role_id = ?", *uw.RoleID).
			Find(&perms)
		for _, p := range perms {
			permKeys[p.Key] = true
		}
	}

	if permKeys[models.PermContactsViewAll] {
		return q
	}

	if permKeys[models.PermContactsViewDept] {
		// Owner_id pertencer a algum user em algum team do mesmo department
		// que o user atual está. Resolve em SQL pra evitar N+1:
		//   teams_meus = (SELECT team_id FROM team_members WHERE user_id = me)
		//   depts_meus = (SELECT department_id FROM teams WHERE id IN teams_meus)
		//   users_dept = (SELECT user_id FROM team_members WHERE team_id IN
		//                 (SELECT id FROM teams WHERE department_id IN depts_meus))
		return q.Where(`(
			contacts.owner_id IS NULL
			OR contacts.owner_id = ?
			OR contacts.owner_id IN (
				SELECT tm.user_id FROM team_members tm
				WHERE tm.team_id IN (
					SELECT id FROM teams WHERE department_id IN (
						SELECT department_id FROM teams
						WHERE id IN (SELECT team_id FROM team_members WHERE user_id = ?)
					)
				)
			)
		)`, userID, userID)
	}

	if permKeys[models.PermContactsViewTeam] {
		// Owner_id pertencer a algum user no mesmo team que o user atual.
		return q.Where(`(
			contacts.owner_id IS NULL
			OR contacts.owner_id = ?
			OR contacts.owner_id IN (
				SELECT user_id FROM team_members
				WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
			)
		)`, userID, userID)
	}

	// Default: só contatos próprios (owner = self) ou sem owner
	return q.Where("contacts.owner_id IS NULL OR contacts.owner_id = ?", userID)
}
