package handlers

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// CrmCustomFieldHandler — CRUD das definições de campos personalizados.
// Os VALORES vivem na coluna `custom_fields` da entidade (deal/contact/
// company) e são gravados pelos handlers dessas entidades; aqui mexemos
// só na schema (definir o atributo, listar, deletar).
type CrmCustomFieldHandler struct{ db *gorm.DB }

func NewCrmCustomFieldHandler(db *gorm.DB) *CrmCustomFieldHandler {
	return &CrmCustomFieldHandler{db: db}
}

func (h *CrmCustomFieldHandler) resolveWorkspaceID(c *fiber.Ctx) (uuid.UUID, error) {
	if wsID := middleware.GetWorkspaceID(c); wsID != uuid.Nil {
		return wsID, nil
	}
	raw := strings.TrimSpace(c.Get("X-Workspace-ID"))
	if raw == "" {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "X-Workspace-ID é obrigatório")
	}
	return uuid.Parse(raw)
}

// GET /v1/crm/custom-fields?entity_type=deal|contact|company
func (h *CrmCustomFieldHandler) List(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	q := h.db.Where("workspace_id = ?", wsID)
	if et := c.Query("entity_type"); et != "" {
		if !models.CustomFieldEntityTypes[et] {
			return fiber.NewError(fiber.StatusBadRequest, "entity_type inválido")
		}
		q = q.Where("entity_type = ?", et)
	}
	var rows []models.CrmCustomField
	if err := q.Order("entity_type, position, created_at").Find(&rows).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(fiber.Map{"items": rows})
}

type customFieldInput struct {
	EntityType string   `json:"entity_type"`
	Name       string   `json:"name"`
	Key        string   `json:"key,omitempty"`
	Type       string   `json:"type"`
	Options    []string `json:"options,omitempty"`
	Required   bool     `json:"required,omitempty"`
	Position   int      `json:"position,omitempty"`
}

// POST /v1/crm/custom-fields
func (h *CrmCustomFieldHandler) Create(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	var in customFieldInput
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "JSON inválido")
	}
	in.Name = strings.TrimSpace(in.Name)
	in.EntityType = strings.TrimSpace(in.EntityType)
	in.Type = strings.TrimSpace(in.Type)
	if in.Name == "" {
		return fiber.NewError(fiber.StatusBadRequest, "name é obrigatório")
	}
	if !models.CustomFieldEntityTypes[in.EntityType] {
		return fiber.NewError(fiber.StatusBadRequest, "entity_type inválido (deal|contact|company)")
	}
	if !models.CustomFieldTypes[in.Type] {
		return fiber.NewError(fiber.StatusBadRequest, "type inválido")
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		key = slugifyCustomField(in.Name)
	}
	if key == "" {
		return fiber.NewError(fiber.StatusBadRequest, "name não gerou key válido")
	}

	// Unicidade (workspace, entity, key) — evita colisão.
	var existing int64
	h.db.Model(&models.CrmCustomField{}).
		Where("workspace_id = ? AND entity_type = ? AND key = ?", wsID, in.EntityType, key).
		Count(&existing)
	if existing > 0 {
		return fiber.NewError(fiber.StatusConflict, "já existe um campo com esse nome nessa entidade")
	}

	optionsJSON := ""
	if in.Type == "select" || in.Type == "multi" {
		clean := make([]string, 0, len(in.Options))
		for _, o := range in.Options {
			o = strings.TrimSpace(o)
			if o != "" {
				clean = append(clean, o)
			}
		}
		if len(clean) == 0 {
			return fiber.NewError(fiber.StatusBadRequest, "options é obrigatório para select/multi")
		}
		b, _ := json.Marshal(clean)
		optionsJSON = string(b)
	}

	row := models.CrmCustomField{
		WorkspaceID: wsID,
		EntityType:  in.EntityType,
		Name:        in.Name,
		Key:         key,
		Type:        in.Type,
		Options:     optionsJSON,
		Required:    in.Required,
		Position:    in.Position,
	}
	if err := h.db.Create(&row).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.Status(fiber.StatusCreated).JSON(row)
}

// PUT /v1/crm/custom-fields/:id
func (h *CrmCustomFieldHandler) Update(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}
	var row models.CrmCustomField
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&row).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "campo não encontrado")
	}
	var in customFieldInput
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "JSON inválido")
	}
	updates := map[string]any{"updated_at": time.Now()}
	if v := strings.TrimSpace(in.Name); v != "" {
		updates["name"] = v
	}
	if in.Position != 0 {
		updates["position"] = in.Position
	}
	updates["required"] = in.Required
	// Type+Options podem mudar mas mantemos Key estável (referenciada nos values).
	if v := strings.TrimSpace(in.Type); v != "" && models.CustomFieldTypes[v] {
		updates["type"] = v
		if v == "select" || v == "multi" {
			clean := make([]string, 0, len(in.Options))
			for _, o := range in.Options {
				o = strings.TrimSpace(o)
				if o != "" {
					clean = append(clean, o)
				}
			}
			b, _ := json.Marshal(clean)
			updates["options"] = string(b)
		} else {
			updates["options"] = ""
		}
	}
	if err := h.db.Model(&row).Updates(updates).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	h.db.First(&row, "id = ?", id)
	return c.JSON(row)
}

// DELETE /v1/crm/custom-fields/:id
func (h *CrmCustomFieldHandler) Delete(c *fiber.Ctx) error {
	wsID, err := h.resolveWorkspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}
	res := h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.CrmCustomField{})
	if res.Error != nil {
		return fiber.NewError(fiber.StatusInternalServerError, res.Error.Error())
	}
	if res.RowsAffected == 0 {
		return fiber.NewError(fiber.StatusNotFound, "campo não encontrado")
	}
	// Os values órfãos ficam no jsonb das entidades — leitura ignora keys
	// que não têm definição correspondente, então não precisa varrer.
	return c.SendStatus(fiber.StatusNoContent)
}

var customFieldSlugRe = regexp.MustCompile(`[^a-z0-9_]+`)

// slugifyCustomField — gera key snake_case do nome digitado pelo user.
// Renomeado pra não colidir com o `slugify` do shop.go.
func slugifyCustomField(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "_")
	s = customFieldSlugRe.ReplaceAllString(s, "")
	s = strings.Trim(s, "_")
	if len(s) > 60 {
		s = s[:60]
	}
	return s
}

// ValidateCustomFields — utilidade chamada pelos handlers de Deal/Contact/
// Company antes de gravar. Recebe o map vindo do payload e a lista de
// definições; retorna o JSON serializado pra gravar na coluna ou erro.
func ValidateCustomFields(db *gorm.DB, wsID uuid.UUID, entityType string, raw map[string]any) (string, error) {
	if raw == nil {
		return "{}", nil
	}
	var defs []models.CrmCustomField
	if err := db.Where("workspace_id = ? AND entity_type = ?", wsID, entityType).Find(&defs).Error; err != nil {
		return "", err
	}
	defByKey := make(map[string]models.CrmCustomField, len(defs))
	for _, d := range defs {
		defByKey[d.Key] = d
	}
	cleaned := make(map[string]any, len(raw))
	for k, v := range raw {
		def, ok := defByKey[k]
		if !ok {
			// key sem definição — ignora (provavelmente foi deletada).
			continue
		}
		if v == nil {
			continue
		}
		switch def.Type {
		case "boolean":
			if b, ok := v.(bool); ok {
				cleaned[k] = b
			}
		case "number":
			switch n := v.(type) {
			case float64:
				cleaned[k] = n
			case int:
				cleaned[k] = n
			}
		case "multi":
			if arr, ok := v.([]any); ok {
				vals := make([]string, 0, len(arr))
				for _, a := range arr {
					if s, ok := a.(string); ok && s != "" {
						vals = append(vals, s)
					}
				}
				cleaned[k] = vals
			}
		default:
			if s, ok := v.(string); ok {
				cleaned[k] = strings.TrimSpace(s)
			}
		}
	}
	b, err := json.Marshal(cleaned)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
