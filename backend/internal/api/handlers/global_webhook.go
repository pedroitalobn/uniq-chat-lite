package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type GlobalWebhookHandler struct {
	db *gorm.DB
}

func NewGlobalWebhookHandler(db *gorm.DB) *GlobalWebhookHandler {
	return &GlobalWebhookHandler{db: db}
}

// Available system events
var SystemEvents = []struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}{
	{ID: "user.registered", Name: "Usuário Registrado", Description: "Quando um novo usuário se registra"},
	{ID: "user.login", Name: "Login", Description: "Quando um usuário faz login"},
	{ID: "user.logout", Name: "Logout", Description: "Quando um usuário faz logout"},
	{ID: "instance.created", Name: "Instância Criada", Description: "Quando uma nova instância é criada"},
	{ID: "instance.connected", Name: "Instância Conectada", Description: "Quando uma instância conecta ao WhatsApp"},
	{ID: "instance.disconnected", Name: "Instância Desconectada", Description: "Quando uma instância desconecta"},
	{ID: "workspace.created", Name: "Workspace Criado", Description: "Quando um novo workspace é criado"},
	{ID: "workspace.member_added", Name: "Membro Adicionado", Description: "Quando um membro é adicionado a um workspace"},
	{ID: "payment.success", Name: "Pagamento Succedido", Description: "Quando um pagamento é confirmado"},
	{ID: "payment.failed", Name: "Pagamento Falhou", Description: "Quando um pagamento falha"},
}

// List available system events
// GET /webhooks/system/events
func (h *GlobalWebhookHandler) ListEvents(c *fiber.Ctx) error {
	return c.JSON(SystemEvents)
}

// List global webhooks
// GET /webhooks/system
func (h *GlobalWebhookHandler) List(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)

	var webhooks []models.GlobalWebhook
	if err := h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&webhooks).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar webhooks"})
	}

	// Parse events JSON
	type webhookResponse struct {
		ID        uuid.UUID `json:"id"`
		Name      string    `json:"name"`
		URL       string    `json:"url"`
		IsActive  bool      `json:"is_active"`
		Events    []string  `json:"events"`
		CreatedAt time.Time `json:"created_at"`
	}

	result := make([]webhookResponse, len(webhooks))
	for i, wh := range webhooks {
		var events []string
		json.Unmarshal([]byte(wh.Events), &events)
		result[i] = webhookResponse{
			ID:        wh.ID,
			Name:      wh.Name,
			URL:       wh.URL,
			IsActive:  wh.IsActive,
			Events:    events,
			CreatedAt: wh.CreatedAt,
		}
	}

	return c.JSON(result)
}

// Create global webhook
// POST /webhooks/system
func (h *GlobalWebhookHandler) Create(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)

	var req struct {
		Name   string   `json:"name"`
		URL    string   `json:"url"`
		Events []string `json:"events"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Name == "" || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome e url são obrigatórios"})
	}

	eventsJSON := "[]"
	if len(req.Events) > 0 {
		b, _ := json.Marshal(req.Events)
		eventsJSON = string(b)
	}

	secret, _ := models.GenerateSecret()

	wh := models.GlobalWebhook{
		UserID:   user.ID,
		Name:     req.Name,
		URL:      req.URL,
		Secret:   secret,
		IsActive: true,
		Events:   eventsJSON,
	}

	if err := h.db.Create(&wh).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar webhook"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":         wh.ID,
		"name":       wh.Name,
		"url":        wh.URL,
		"secret":     secret,
		"is_active":  wh.IsActive,
		"events":     req.Events,
		"created_at": wh.CreatedAt,
	})
}

// Delete global webhook
// DELETE /webhooks/system/:id
func (h *GlobalWebhookHandler) Delete(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	webhookID := c.Params("id")

	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, user.ID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	if err := h.db.Delete(&wh).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar webhook"})
	}

	return c.JSON(fiber.Map{"success": true})
}

// Test global webhook - send a test event
// POST /webhooks/system/:id/test
func (h *GlobalWebhookHandler) Test(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	webhookID := c.Params("id")

	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, user.ID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	if !wh.IsActive {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "webhook está inativo"})
	}

	// Parse events to determine test payload
	var events []string
	json.Unmarshal([]byte(wh.Events), &events)

	// Create test payload
	testEvent := fiber.Map{
		"event":      "webhook.test",
		"timestamp":  time.Now().Unix(),
		"webhook_id": wh.ID.String(),
		"data": fiber.Map{
			"type":    "test",
			"message": "Teste de webhook",
			"events":  events,
		},
	}

	// Send test request
	payload, _ := json.Marshal(testEvent)

	req, err := http.NewRequest("POST", wh.URL, bytes.NewBuffer(payload))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "URL inválida"})
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", wh.Secret)
	req.Header.Set("X-Webhook-Event", "webhook.test")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao enviar teste: " + err.Error()})
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return c.JSON(fiber.Map{
			"success": true,
			"message": "Teste enviado com sucesso",
			"status":  resp.StatusCode,
		})
	}

	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"success": false,
		"message": "Teste enviado mas endpoint retornou erro",
		"status":  resp.StatusCode,
	})
}
