package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
)

// ListTemplateDefaults — devolve os valores default por template
// (name+language) salvos pra esta instância. Usado pelo front pra
// auto-preencher os inputs do TemplatePicker, evitando o usuário
// digitar a URL da imagem em cada envio.
//
// GET /v1/instances/:id/waba/templates/defaults
func (h *WABAHandler) ListTemplateDefaults(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var defs []models.WABATemplateDefault
	if err := h.db.Where("instance_id = ?", inst.ID).Find(&defs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": defs})
}

// UpsertTemplateDefault — salva o default pra um template específico.
// Idempotente — atualiza se já existe, cria se não. Validação básica:
// pelo menos um dos campos de header precisa vir preenchido. Apaga
// quando todos vêm vazios (limpeza explícita).
//
// PUT /v1/instances/:id/waba/templates/defaults
// Body: { template_name, template_language, header_media_url?,
//         header_filename?, header_latitude?, header_longitude?,
//         header_location_name?, header_location_address? }
func (h *WABAHandler) UpsertTemplateDefault(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		TemplateName       string  `json:"template_name"`
		TemplateLanguage   string  `json:"template_language"`
		HeaderMediaURL     string  `json:"header_media_url"`
		HeaderFilename     string  `json:"header_filename"`
		HeaderLatitude     float64 `json:"header_latitude"`
		HeaderLongitude    float64 `json:"header_longitude"`
		HeaderLocationName string  `json:"header_location_name"`
		HeaderLocationAddr string  `json:"header_location_address"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	req.TemplateName = strings.TrimSpace(req.TemplateName)
	req.TemplateLanguage = strings.TrimSpace(req.TemplateLanguage)
	if req.TemplateName == "" || req.TemplateLanguage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "template_name e template_language são obrigatórios",
		})
	}

	allEmpty := strings.TrimSpace(req.HeaderMediaURL) == "" &&
		strings.TrimSpace(req.HeaderFilename) == "" &&
		req.HeaderLatitude == 0 &&
		req.HeaderLongitude == 0 &&
		strings.TrimSpace(req.HeaderLocationName) == "" &&
		strings.TrimSpace(req.HeaderLocationAddr) == ""

	// Limpeza explícita — todos os campos vazios = remover o default.
	if allEmpty {
		if err := h.db.Where(
			"instance_id = ? AND template_name = ? AND template_language = ?",
			inst.ID, req.TemplateName, req.TemplateLanguage,
		).Delete(&models.WABATemplateDefault{}).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"ok": true, "deleted": true})
	}

	// Upsert manual (FirstOrCreate + atualização) — evita
	// dependência de cláusula ON CONFLICT que difere entre dialetos.
	var existing models.WABATemplateDefault
	q := h.db.Where(
		"instance_id = ? AND template_name = ? AND template_language = ?",
		inst.ID, req.TemplateName, req.TemplateLanguage,
	)
	err := q.First(&existing).Error
	if err == nil {
		existing.HeaderMediaURL = strings.TrimSpace(req.HeaderMediaURL)
		existing.HeaderFilename = strings.TrimSpace(req.HeaderFilename)
		existing.HeaderLatitude = req.HeaderLatitude
		existing.HeaderLongitude = req.HeaderLongitude
		existing.HeaderLocationName = strings.TrimSpace(req.HeaderLocationName)
		existing.HeaderLocationAddr = strings.TrimSpace(req.HeaderLocationAddr)
		if err := h.db.Save(&existing).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(existing)
	}
	def := models.WABATemplateDefault{
		InstanceID:         inst.ID,
		TemplateName:       req.TemplateName,
		TemplateLanguage:   req.TemplateLanguage,
		HeaderMediaURL:     strings.TrimSpace(req.HeaderMediaURL),
		HeaderFilename:     strings.TrimSpace(req.HeaderFilename),
		HeaderLatitude:     req.HeaderLatitude,
		HeaderLongitude:    req.HeaderLongitude,
		HeaderLocationName: strings.TrimSpace(req.HeaderLocationName),
		HeaderLocationAddr: strings.TrimSpace(req.HeaderLocationAddr),
	}
	if err := h.db.Create(&def).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(def)
}
