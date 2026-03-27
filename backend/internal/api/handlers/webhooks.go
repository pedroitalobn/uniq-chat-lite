package handlers

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type WebhookHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewWebhookHandler(db *gorm.DB, manager *whatsapp.Manager) *WebhookHandler {
	return &WebhookHandler{db: db, manager: manager}
}

type webhookRequest struct {
	Name          string   `json:"name"`
	URL           string   `json:"url"`
	Events        []string `json:"events"`
	IsActive      *bool    `json:"is_active"`
	IgnoreGroups  bool     `json:"ignore_groups"`
	IgnoreSelf    bool     `json:"ignore_self"`
	IgnoreAPISent bool     `json:"ignore_api_sent"`
	// RabbitMQ bridge
	RabbitMQEnabled bool   `json:"rabbitmq_enabled"`
	AMQPURL         string `json:"amqp_url"`
	Exchange        string `json:"exchange"`
	RoutingKey      string `json:"routing_key"`
	// NATS bridge
	NATSEnabled bool   `json:"nats_enabled"`
	NATSURL     string `json:"nats_url"`
	NATSSubject string `json:"nats_subject"`
	NATSToken   string `json:"nats_token"`
	// WebSocket client bridge
	WSEnabled     bool   `json:"ws_enabled"`
	WSClientURL   string `json:"ws_client_url"`
	WSClientToken string `json:"ws_client_token"`
}

// List godoc
// GET /instances/:id/webhooks
func (h *WebhookHandler) List(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var webhooks []models.Webhook
	if err := h.db.Where("instance_id = ?", instance.ID).Order("created_at ASC").Find(&webhooks).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar webhooks"})
	}
	return c.JSON(webhooks)
}

// Create godoc
// POST /instances/:id/webhooks
func (h *WebhookHandler) Create(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req webhookRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'url' é obrigatório"})
	}

	eventsJSON := "[]"
	if len(req.Events) > 0 {
		b, _ := json.Marshal(req.Events)
		eventsJSON = string(b)
	}

	secret, _ := models.GenerateSecret()

	wh := models.Webhook{
		InstanceID:      instance.ID,
		Name:            req.Name,
		IsActive:        true,
		Events:          eventsJSON,
		IgnoreGroups:    req.IgnoreGroups,
		IgnoreSelf:      req.IgnoreSelf,
		IgnoreAPISent:   req.IgnoreAPISent,
		URL:             req.URL,
		Secret:          secret,
		RabbitMQEnabled: req.RabbitMQEnabled,
		AMQPURL:         req.AMQPURL,
		Exchange:        req.Exchange,
		RoutingKey:      req.RoutingKey,
		NATSEnabled:     req.NATSEnabled,
		NATSURL:         req.NATSURL,
		NATSSubject:     req.NATSSubject,
		NATSToken:       req.NATSToken,
		WSEnabled:       req.WSEnabled,
		WSClientURL:     req.WSClientURL,
		WSClientToken:   req.WSClientToken,
	}

	if err := h.db.Create(&wh).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar webhook"})
	}

	h.manager.RefreshWebhooks(instance.ID.String())

	// Return secret only on creation
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":               wh.ID,
		"name":             wh.Name,
		"is_active":        wh.IsActive,
		"url":              wh.URL,
		"secret":           secret,
		"events":           req.Events,
		"ignore_groups":    wh.IgnoreGroups,
		"ignore_self":      wh.IgnoreSelf,
		"ignore_api_sent":  wh.IgnoreAPISent,
		"rabbitmq_enabled": wh.RabbitMQEnabled,
		"amqp_url":         wh.AMQPURL,
		"exchange":         wh.Exchange,
		"routing_key":      wh.RoutingKey,
		"nats_enabled":     wh.NATSEnabled,
		"nats_url":         wh.NATSURL,
		"nats_subject":     wh.NATSSubject,
		"ws_enabled":       wh.WSEnabled,
		"ws_client_url":    wh.WSClientURL,
		"created_at":       wh.CreatedAt,
	})
}

// Update godoc
// PUT /instances/:id/webhooks/:webhookId
func (h *WebhookHandler) Update(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	webhookID, err := uuid.Parse(c.Params("webhookId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	var wh models.Webhook
	if err := h.db.First(&wh, "id = ? AND instance_id = ?", webhookID, instance.ID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	var req webhookRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	isActive := wh.IsActive
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	updates := map[string]interface{}{
		"name":             req.Name,
		"is_active":        isActive,
		"url":              req.URL,
		"ignore_groups":    req.IgnoreGroups,
		"ignore_self":      req.IgnoreSelf,
		"ignore_api_sent":  req.IgnoreAPISent,
		"rabbitmq_enabled": req.RabbitMQEnabled,
		"amqp_url":         req.AMQPURL,
		"exchange":         req.Exchange,
		"routing_key":      req.RoutingKey,
		"nats_enabled":     req.NATSEnabled,
		"nats_url":         req.NATSURL,
		"nats_subject":     req.NATSSubject,
		"ws_enabled":       req.WSEnabled,
		"ws_client_url":    req.WSClientURL,
	}
	if len(req.Events) > 0 {
		b, _ := json.Marshal(req.Events)
		updates["events"] = string(b)
	}
	if req.NATSToken != "" {
		updates["nats_token"] = req.NATSToken
	}
	if req.WSClientToken != "" {
		updates["ws_client_token"] = req.WSClientToken
	}

	if err := h.db.Model(&wh).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar webhook"})
	}

	h.manager.RefreshWebhooks(instance.ID.String())

	h.db.First(&wh, "id = ?", wh.ID)
	return c.JSON(wh)
}

// Delete godoc
// DELETE /instances/:id/webhooks/:webhookId
func (h *WebhookHandler) Delete(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	webhookID, err := uuid.Parse(c.Params("webhookId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if err := h.db.Delete(&models.Webhook{}, "id = ? AND instance_id = ?", webhookID, instance.ID).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar webhook"})
	}

	h.manager.RefreshWebhooks(instance.ID.String())
	return c.JSON(fiber.Map{"message": "webhook removido"})
}
