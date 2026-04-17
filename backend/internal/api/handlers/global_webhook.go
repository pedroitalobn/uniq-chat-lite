package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type GlobalWebhookHandler struct {
	db *gorm.DB
}

func NewGlobalWebhookHandler(db *gorm.DB) *GlobalWebhookHandler {
	return &GlobalWebhookHandler{db: db}
}

// SystemEventItem é o shape retornado pela API (lista de eventos disponíveis).
type SystemEventItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

// SystemEvents — fonte única da verdade para eventos disponíveis.
// Adicione aqui antes de referenciar na UI.
var SystemEvents = []SystemEventItem{
	// User events
	{ID: "user.registered", Name: "Usuário Registrado", Description: "Quando um novo usuário se registra", Category: "Usuário"},
	{ID: "user.login", Name: "Login", Description: "Quando um usuário faz login", Category: "Usuário"},
	{ID: "user.logout", Name: "Logout", Description: "Quando um usuário faz logout", Category: "Usuário"},

	// Instance events
	{ID: "instance.created", Name: "Instância Criada", Description: "Quando uma nova instância é criada", Category: "Instância"},
	{ID: "instance.connected", Name: "Instância Conectada", Description: "Quando uma instância conecta ao WhatsApp", Category: "Instância"},
	{ID: "instance.disconnected", Name: "Instância Desconectada", Description: "Quando uma instância desconecta", Category: "Instância"},

	// Message events
	{ID: "message.received", Name: "Mensagem Recebida", Description: "Quando uma mensagem é recebida", Category: "Mensagem"},
	{ID: "message.sent", Name: "Mensagem Enviada", Description: "Quando uma mensagem é enviada", Category: "Mensagem"},

	// Workspace events
	{ID: "workspace.created", Name: "Workspace Criado", Description: "Quando um novo workspace é criado", Category: "Workspace"},
	{ID: "workspace.member_added", Name: "Membro Adicionado", Description: "Quando um membro é adicionado a um workspace", Category: "Workspace"},
	{ID: "workspace.member_removed", Name: "Membro Removido", Description: "Quando um membro é removido de um workspace", Category: "Workspace"},

	// CRM events
	{ID: "crm.contact.created", Name: "Contato Criado", Description: "Quando um novo contato é criado no CRM", Category: "CRM"},
	{ID: "crm.contact.updated", Name: "Contato Atualizado", Description: "Quando um contato é atualizado no CRM", Category: "CRM"},
	{ID: "crm.contact.deleted", Name: "Contato Deletado", Description: "Quando um contato é deletado do CRM", Category: "CRM"},
	{ID: "crm.tag.created", Name: "Tag Criada", Description: "Quando uma nova tag é criada", Category: "CRM"},
	{ID: "crm.tag.assigned", Name: "Tag Atribuída", Description: "Quando uma tag é atribuída a um contato", Category: "CRM"},
	{ID: "crm.stage.assigned", Name: "Stage Atribuído", Description: "Quando um stage é atribuído a um contato", Category: "CRM"},
	{ID: "crm.funnel.assigned", Name: "Funil Atribuído", Description: "Quando um funil é atribuído a um contato", Category: "CRM"},

	// Campaign events
	{ID: "campaign.created", Name: "Campanha Criada", Description: "Quando uma nova campanha é criada", Category: "Campanha"},
	{ID: "campaign.started", Name: "Campanha Iniciada", Description: "Quando uma campanha é iniciada", Category: "Campanha"},
	{ID: "campaign.paused", Name: "Campanha Pausada", Description: "Quando uma campanha é pausada", Category: "Campanha"},
	{ID: "campaign.completed", Name: "Campanha Finalizada", Description: "Quando uma campanha é finalizada", Category: "Campanha"},
	{ID: "campaign.failed", Name: "Campanha Falhou", Description: "Quando uma campanha falha", Category: "Campanha"},

	// Payment events
	{ID: "payment.success", Name: "Pagamento Succedido", Description: "Quando um pagamento é confirmado", Category: "Pagamento"},
	{ID: "payment.failed", Name: "Pagamento Falhou", Description: "Quando um pagamento falha", Category: "Pagamento"},
	{ID: "payment.refunded", Name: "Pagamento Estornado", Description: "Quando um pagamento é estornado", Category: "Pagamento"},

	// Webhook events
	{ID: "webhook.test", Name: "Teste de Webhook", Description: "Evento de teste disparado manualmente", Category: "Sistema"},
}

// validEventIDs retorna um set com todos os IDs válidos (para validar input).
func validEventIDs() map[string]bool {
	out := make(map[string]bool, len(SystemEvents))
	for _, e := range SystemEvents {
		out[e.ID] = true
	}
	return out
}

// resolveWebhookUserID extrai o userID dos Locals, tolerante ao tipo (ponteiro
// ou valor). Retorna uuid.Nil se não for possível.
// Evita o panic type-assertion que causava HTTP 500 quando o request vinha via
// API key (middleware salva models.User por valor) vs JWT (por ponteiro).
func resolveWebhookUserID(c *fiber.Ctx) (uuid.UUID, error) {
	raw := c.Locals("user")
	switch u := raw.(type) {
	case *models.User:
		if u == nil {
			return uuid.Nil, fmt.Errorf("usuário nulo")
		}
		return u.ID, nil
	case models.User:
		return u.ID, nil
	default:
		// fallback: user_id setado diretamente em alguns middlewares
		if uid, ok := c.Locals("user_id").(uuid.UUID); ok {
			return uid, nil
		}
		log.Error().Str("user_type", fmt.Sprintf("%T", raw)).Msg("webhooks/system: unexpected locals[user] type")
		return uuid.Nil, fmt.Errorf("não autenticado")
	}
}

// ListEvents GET /webhooks/system/events
func (h *GlobalWebhookHandler) ListEvents(c *fiber.Ctx) error {
	return c.JSON(SystemEvents)
}

// webhookResponse é o shape exposto pela API (esconde secret etc).
type webhookResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	IsActive  bool      `json:"is_active"`
	Events    []string  `json:"events"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toWebhookResponse(wh *models.GlobalWebhook) webhookResponse {
	var events []string
	if wh.Events != "" {
		if err := json.Unmarshal([]byte(wh.Events), &events); err != nil {
			events = []string{}
		}
	}
	if events == nil {
		events = []string{}
	}
	return webhookResponse{
		ID:        wh.ID,
		Name:      wh.Name,
		URL:       wh.URL,
		IsActive:  wh.IsActive,
		Events:    events,
		CreatedAt: wh.CreatedAt,
		UpdatedAt: wh.UpdatedAt,
	}
}

// List GET /webhooks/system
func (h *GlobalWebhookHandler) List(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	var webhooks []models.GlobalWebhook
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&webhooks).Error; err != nil {
		log.Error().Err(err).Str("user_id", userID.String()).Msg("webhooks/system list: db query failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar webhooks"})
	}

	result := make([]webhookResponse, len(webhooks))
	for i := range webhooks {
		result[i] = toWebhookResponse(&webhooks[i])
	}
	return c.JSON(result)
}

// validateEvents filtra e deduplica o array contra a lista canônica.
// Retorna erro se a lista ficar vazia após filtragem.
func validateEvents(events []string) ([]string, error) {
	valid := validEventIDs()
	seen := make(map[string]bool)
	filtered := make([]string, 0, len(events))
	invalid := make([]string, 0)

	for _, ev := range events {
		if seen[ev] {
			continue
		}
		seen[ev] = true
		if !valid[ev] {
			invalid = append(invalid, ev)
			continue
		}
		filtered = append(filtered, ev)
	}
	if len(filtered) == 0 {
		if len(invalid) > 0 {
			return nil, fmt.Errorf("nenhum evento válido — desconhecidos: %v", invalid)
		}
		return nil, fmt.Errorf("selecione ao menos um evento")
	}
	return filtered, nil
}

// Create POST /webhooks/system
func (h *GlobalWebhookHandler) Create(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	var req struct {
		Name     string   `json:"name"`
		URL      string   `json:"url"`
		Events   []string `json:"events"`
		IsActive *bool    `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Name == "" || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome e url são obrigatórios"})
	}

	cleanEvents, err := validateEvents(req.Events)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	eventsJSON, _ := json.Marshal(cleanEvents)

	secret, err := models.GenerateSecret()
	if err != nil {
		log.Error().Err(err).Msg("webhooks/system create: failed to generate secret")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar secret"})
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	wh := models.GlobalWebhook{
		UserID:   userID,
		Name:     req.Name,
		URL:      req.URL,
		Secret:   secret,
		IsActive: isActive,
		Events:   string(eventsJSON),
	}

	if err := h.db.Create(&wh).Error; err != nil {
		log.Error().Err(err).Str("user_id", userID.String()).Msg("webhooks/system create: db insert failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar webhook: " + err.Error()})
	}

	resp := toWebhookResponse(&wh)
	// Retorna o secret em texto claro APENAS na criação (única vez que ele é visível).
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":         resp.ID,
		"name":       resp.Name,
		"url":        resp.URL,
		"secret":     secret,
		"is_active":  resp.IsActive,
		"events":     resp.Events,
		"created_at": resp.CreatedAt,
		"updated_at": resp.UpdatedAt,
	})
}

// Update PUT /webhooks/system/:id — edita nome/url/events/is_active.
// Todos os campos são opcionais (patch semantics).
func (h *GlobalWebhookHandler) Update(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	webhookID := c.Params("id")
	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	var req struct {
		Name     *string   `json:"name"`
		URL      *string   `json:"url"`
		Events   *[]string `json:"events"`
		IsActive *bool     `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		if *req.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome não pode ser vazio"})
		}
		updates["name"] = *req.Name
	}
	if req.URL != nil {
		if *req.URL == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "url não pode ser vazia"})
		}
		updates["url"] = *req.URL
	}
	if req.Events != nil {
		cleanEvents, err := validateEvents(*req.Events)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		eventsJSON, _ := json.Marshal(cleanEvents)
		updates["events"] = string(eventsJSON)
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	if len(updates) == 0 {
		return c.JSON(toWebhookResponse(&wh))
	}

	if err := h.db.Model(&wh).Updates(updates).Error; err != nil {
		log.Error().Err(err).Str("webhook_id", wh.ID.String()).Msg("webhooks/system update: db update failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar"})
	}
	// Reload
	h.db.First(&wh, "id = ?", wh.ID)
	return c.JSON(toWebhookResponse(&wh))
}

// Delete DELETE /webhooks/system/:id
func (h *GlobalWebhookHandler) Delete(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}
	webhookID := c.Params("id")

	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	if err := h.db.Delete(&wh).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar webhook"})
	}

	return c.JSON(fiber.Map{"success": true})
}

// Test POST /webhooks/system/:id/test — dispara um evento "webhook.test"
func (h *GlobalWebhookHandler) Test(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}
	webhookID := c.Params("id")

	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	if !wh.IsActive {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "webhook está inativo"})
	}

	var events []string
	_ = json.Unmarshal([]byte(wh.Events), &events)

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
