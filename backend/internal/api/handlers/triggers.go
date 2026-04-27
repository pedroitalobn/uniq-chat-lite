package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// TriggerHandler — autoresponder simples por keyword (gap UazAPI).
// Pra clientes não-técnicos terem reply automático sem mexer no
// journey builder. O matching real fica em services/triggers.go (chamado
// pelo inbound pipeline). Esses handlers são só CRUD.
type TriggerHandler struct {
	db *gorm.DB
}

func NewTriggerHandler(db *gorm.DB) *TriggerHandler {
	return &TriggerHandler{db: db}
}

func (h *TriggerHandler) workspaceID(c *fiber.Ctx) (uuid.UUID, error) {
	wsHdr := strings.TrimSpace(c.Get("X-Workspace-ID"))
	if wsHdr == "" {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "header X-Workspace-ID é obrigatório")
	}
	id, err := uuid.Parse(wsHdr)
	if err != nil {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "X-Workspace-ID inválido")
	}
	return id, nil
}

// GET /v1/triggers
func (h *TriggerHandler) List(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	var triggers []models.Trigger
	q := h.db.Where("workspace_id = ?", wsID).Order("priority asc, created_at desc")
	if instStr := strings.TrimSpace(c.Query("instance_id")); instStr != "" {
		if iid, perr := uuid.Parse(instStr); perr == nil {
			q = q.Where("instance_id = ? OR instance_id IS NULL", iid)
		}
	}
	if onlyActive := c.QueryBool("only_active", false); onlyActive {
		q = q.Where("is_active = ?", true)
	}
	if err := q.Find(&triggers).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": triggers, "total": len(triggers)})
}

// POST /v1/triggers
func (h *TriggerHandler) Create(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	var t models.Trigger
	if err := c.BodyParser(&t); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if t.Name == "" || t.Keyword == "" || t.Action == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'name', 'keyword' e 'action' são obrigatórios"})
	}
	t.WorkspaceID = wsID
	if err := h.db.Create(&t).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(t)
}

// GET /v1/triggers/:id
func (h *TriggerHandler) Get(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, perr := uuid.Parse(c.Params("id"))
	if perr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var t models.Trigger
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&t).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "trigger não encontrado"})
	}
	return c.JSON(t)
}

// PUT /v1/triggers/:id
func (h *TriggerHandler) Update(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, perr := uuid.Parse(c.Params("id"))
	if perr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var existing models.Trigger
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&existing).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "trigger não encontrado"})
	}
	var patch models.Trigger
	if err := c.BodyParser(&patch); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	patch.ID = existing.ID
	patch.WorkspaceID = existing.WorkspaceID
	patch.HitCount = existing.HitCount
	patch.LastHitAt = existing.LastHitAt
	patch.CreatedAt = existing.CreatedAt
	if err := h.db.Save(&patch).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(patch)
}

// DELETE /v1/triggers/:id
func (h *TriggerHandler) Delete(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, perr := uuid.Parse(c.Params("id"))
	if perr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.Trigger{})
	if res.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": res.Error.Error()})
	}
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "trigger não encontrado"})
	}
	return c.JSON(fiber.Map{"deleted": true})
}

// POST /v1/triggers/:id/test — simula match com texto sample
// pra UI validar regras antes de salvar.
func (h *TriggerHandler) Test(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, perr := uuid.Parse(c.Params("id"))
	if perr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var t models.Trigger
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&t).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "trigger não encontrado"})
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil || req.Text == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'text' é obrigatório"})
	}
	matched := MatchTrigger(&t, req.Text)
	return c.JSON(fiber.Map{"matched": matched})
}

// MatchTrigger é o avaliador puro (sem efeitos) — exposto pra reuso
// no inbound pipeline e pelo /test handler. Retorna true se o trigger
// dispara pra `text`.
func MatchTrigger(t *models.Trigger, text string) bool {
	if t == nil || !t.IsActive {
		return false
	}
	keyword := t.Keyword
	target := text
	if !t.CaseSensitive {
		keyword = strings.ToLower(keyword)
		target = strings.ToLower(target)
	}
	switch t.MatchMode {
	case models.TriggerMatchExact:
		return strings.TrimSpace(target) == strings.TrimSpace(keyword)
	case models.TriggerMatchStartWith:
		return strings.HasPrefix(strings.TrimSpace(target), keyword)
	case models.TriggerMatchRegex:
		// Regex simples sem cache — chamado raramente.
		// Usamos regexp da std; em prod talvez convém pré-compilar.
		return regexMatch(keyword, target)
	default: // contains
		return strings.Contains(target, keyword)
	}
}

// regexMatch isola o import de regexp pra não poluir o resto do arquivo.
func regexMatch(pattern, text string) bool {
	// Falha de compile = não bate.
	re, err := compileRegex(pattern)
	if err != nil || re == nil {
		return false
	}
	return re.MatchString(text)
}
