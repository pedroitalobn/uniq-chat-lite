package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// WebhookLogsHandler concentra os endpoints novos de:
//   1) /webhooks/.../deliveries — listar logs de tentativas
//   2) /webhooks/.../deliveries/:id/retry — reenviar um payload
//   3) /webhooks/events/:eventID/preview — mock do payload
//   4) /webhooks/.../test — disparar 1 evento escolhido (cobre Test + select event)
//
// Compartilhado entre webhooks de instância e webhooks globais. Cada
// handler verifica ownership pelo path (id da instância ou user owner do global).
type WebhookLogsHandler struct {
	db *gorm.DB
}

func NewWebhookLogsHandler(db *gorm.DB) *WebhookLogsHandler {
	return &WebhookLogsHandler{db: db}
}

// ─── Helpers ──────────────────────────────────────────────────────────

// findInstanceWebhook localiza o webhook + valida ownership da instance.
// Retorna 404 ou 403 se não bate.
func (h *WebhookLogsHandler) findInstanceWebhook(c *fiber.Ctx) (*models.Webhook, error) {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil, fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}
	webhookID, err := uuid.Parse(c.Params("webhookId"))
	if err != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "webhookId inválido")
	}
	var wh models.Webhook
	if err := h.db.Where("id = ? AND instance_id = ?", webhookID, instance.ID).First(&wh).Error; err != nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "webhook não encontrado")
	}
	return &wh, nil
}

// findGlobalWebhook idem pra global webhook (ownership = user_id).
func (h *WebhookLogsHandler) findGlobalWebhook(c *fiber.Ctx) (*models.GlobalWebhook, error) {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	webhookID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}
	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "webhook não encontrado")
	}
	return &wh, nil
}

// ─── Listagem de deliveries ──────────────────────────────────────────

// ListInstanceDeliveries — GET /v1/instances/:id/webhooks/:webhookId/deliveries
//
// Query params:
//   ?status=success|failed|pending|skipped (opcional)
//   ?event=message.received                (opcional)
//   ?limit=50&offset=0                     (default 50/0, máx 200)
func (h *WebhookLogsHandler) ListInstanceDeliveries(c *fiber.Ctx) error {
	wh, err := h.findInstanceWebhook(c)
	if err != nil {
		return err
	}
	return h.listDeliveries(c, "webhook_id = ?", wh.ID)
}

// ListGlobalDeliveries — GET /v1/webhooks/system/:id/deliveries
func (h *WebhookLogsHandler) ListGlobalDeliveries(c *fiber.Ctx) error {
	wh, err := h.findGlobalWebhook(c)
	if err != nil {
		return err
	}
	return h.listDeliveries(c, "global_webhook_id = ?", wh.ID)
}

func (h *WebhookLogsHandler) listDeliveries(c *fiber.Ctx, whereCol string, whereVal uuid.UUID) error {
	limit := c.QueryInt("limit", 50)
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := c.QueryInt("offset", 0)

	q := h.db.Where(whereCol, whereVal)
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		q = q.Where("status = ?", status)
	}
	if event := strings.TrimSpace(c.Query("event")); event != "" {
		q = q.Where("event = ?", event)
	}

	var total int64
	q.Model(&models.WebhookDelivery{}).Count(&total)

	var deliveries []models.WebhookDelivery
	if err := q.Order("created_at desc").Limit(limit).Offset(offset).Find(&deliveries).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"data":   deliveries,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// ─── Retry ────────────────────────────────────────────────────────────

// RetryInstanceDelivery — POST /v1/instances/:id/webhooks/:webhookId/deliveries/:deliveryId/retry
func (h *WebhookLogsHandler) RetryInstanceDelivery(c *fiber.Ctx) error {
	wh, err := h.findInstanceWebhook(c)
	if err != nil {
		return err
	}
	return h.retryDelivery(c, wh.URL, wh.Secret, &wh.ID, nil)
}

// RetryGlobalDelivery — POST /v1/webhooks/system/:id/deliveries/:deliveryId/retry
func (h *WebhookLogsHandler) RetryGlobalDelivery(c *fiber.Ctx) error {
	wh, err := h.findGlobalWebhook(c)
	if err != nil {
		return err
	}
	return h.retryDelivery(c, wh.URL, wh.Secret, nil, &wh.ID)
}

func (h *WebhookLogsHandler) retryDelivery(c *fiber.Ctx, url, secret string, instanceWebhookID, globalWebhookID *uuid.UUID) error {
	deliveryID, err := uuid.Parse(c.Params("deliveryId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "deliveryId inválido"})
	}
	var d models.WebhookDelivery
	q := h.db.Where("id = ?", deliveryID)
	if instanceWebhookID != nil {
		q = q.Where("webhook_id = ?", *instanceWebhookID)
	} else if globalWebhookID != nil {
		q = q.Where("global_webhook_id = ?", *globalWebhookID)
	}
	if err := q.First(&d).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "delivery não encontrada"})
	}

	// Reconstroi o payload original e dispara síncrono.
	var original whatsapp.WebhookPayload
	if err := json.Unmarshal([]byte(d.Payload), &original); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "payload original corrompido"})
	}
	result := whatsapp.DispatchWebhookSync(url, secret, original)

	// Grava nova delivery (retry_count = original + 1).
	whIDStr, gIDStr := "", ""
	if instanceWebhookID != nil {
		whIDStr = instanceWebhookID.String()
	}
	if globalWebhookID != nil {
		gIDStr = globalWebhookID.String()
	}
	whatsapp.RecordDelivery(whIDStr, gIDStr, original.Event, url, original, result, d.RetryCount+1)

	return c.JSON(fiber.Map{
		"success":    result.Success(),
		"status":     result.StatusCode,
		"latency_ms": result.LatencyMs,
		"error":      result.Error,
	})
}

// ─── Preview (mock payload) ───────────────────────────────────────────

// PreviewEvent — GET /v1/webhooks/events/:eventID/preview
//
// Retorna um exemplo do payload que seria enviado pra o evento. Útil
// pra cliente testar parsing antes de configurar o destino.
func (h *WebhookLogsHandler) PreviewEvent(c *fiber.Ctx) error {
	eventID := c.Params("eventID")
	mock := mockEventPayload(eventID)
	if mock == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "evento desconhecido", "event": eventID})
	}
	return c.JSON(whatsapp.WebhookPayload{
		Event:      eventID,
		InstanceID: "00000000-0000-0000-0000-000000000000",
		Timestamp:  time.Now(),
		Data:       mock,
	})
}

// mockEventPayload retorna um payload exemplo pra cada evento conhecido.
// Mantém shapes próximos do real pra cliente testar parsing.
func mockEventPayload(eventID string) interface{} {
	if !validEventIDs()[eventID] {
		return nil
	}

	// Defaults reutilizados
	contactJID := "5511999999999@s.whatsapp.net"
	groupJID := "120363xxxxxxxxxx@g.us"
	msgID := "ABCD1234567890"

	switch {
	case strings.HasPrefix(eventID, "message."):
		typ := strings.TrimPrefix(eventID, "message.")
		base := fiber.Map{
			"id":           msgID,
			"chat":         contactJID,
			"sender":       contactJID,
			"sender_name":  "João Silva",
			"from_me":      false,
			"timestamp":    time.Now().Unix(),
			"type":         typ,
		}
		switch typ {
		case "text", "received", "sent":
			base["text"] = "Olá, preciso de ajuda."
			base["type"] = "text"
		case "image", "video", "document", "audio", "sticker":
			base["media"] = fiber.Map{"url": "https://example.com/file.bin", "mime_type": "application/octet-stream"}
		case "location":
			base["location"] = fiber.Map{"latitude": -23.5505, "longitude": -46.6333, "name": "Av. Paulista"}
		case "reaction":
			base["reaction"] = fiber.Map{"emoji": "👍", "target_id": msgID}
		case "edited":
			base["edited_text"] = "Texto corrigido"
			base["original_id"] = msgID
		case "deleted":
			base["target_id"] = msgID
		case "status":
			base["target_id"] = msgID
			base["status"] = "delivered"
		case "button_response":
			base["button"] = fiber.Map{"id": "yes", "text": "Sim"}
		case "list_response":
			base["row"] = fiber.Map{"id": "support", "title": "Suporte"}
		case "poll_vote":
			base["selected_options"] = []string{"Opção A"}
		}
		return base

	case strings.HasPrefix(eventID, "instance."):
		return fiber.Map{
			"instance_id": "00000000-0000-0000-0000-000000000000",
			"phone":       "5511999999999",
			"status":      strings.TrimPrefix(eventID, "instance."),
		}

	case strings.HasPrefix(eventID, "conversation."):
		return fiber.Map{
			"conversation_id": uuid.New().String(),
			"contact":         fiber.Map{"jid": contactJID, "name": "João Silva"},
			"channel":         "whatsapp",
			"assigned_to":     fiber.Map{"user_id": uuid.New().String(), "name": "Agente Maria"},
			"queue":           "support",
		}

	case strings.HasPrefix(eventID, "deal."):
		return fiber.Map{
			"deal_id":  uuid.New().String(),
			"title":    "Plano Pro - Empresa X",
			"amount":   2400.00,
			"currency": "BRL",
			"stage":    "Proposta",
			"owner":    fiber.Map{"user_id": uuid.New().String(), "name": "Vendedor"},
		}

	case strings.HasPrefix(eventID, "crm."):
		return fiber.Map{
			"contact_id": uuid.New().String(),
			"name":       "João Silva",
			"phone":      "5511999999999",
			"email":      "joao@exemplo.com",
			"tags":       []string{"lead-quente"},
		}

	case strings.HasPrefix(eventID, "campaign."):
		return fiber.Map{
			"campaign_id":   uuid.New().String(),
			"name":          "Campanha Black Friday",
			"status":        strings.TrimPrefix(eventID, "campaign."),
			"total_count":   500,
			"sent_count":    312,
			"failed_count":  4,
		}

	case strings.HasPrefix(eventID, "journey."):
		return fiber.Map{
			"journey_id":    uuid.New().String(),
			"execution_id":  uuid.New().String(),
			"contact":       fiber.Map{"jid": contactJID, "name": "João Silva"},
			"current_step":  "send_welcome",
			"status":        strings.TrimPrefix(eventID, "journey."),
		}

	case strings.HasPrefix(eventID, "agent."):
		return fiber.Map{
			"agent_id":     uuid.New().String(),
			"agent_name":   "Atendente IA",
			"contact":      fiber.Map{"jid": contactJID},
			"reply":        "Posso ajudar com isso. Você gostaria de…",
			"tokens_used":  124,
		}

	case strings.HasPrefix(eventID, "trigger."):
		return fiber.Map{
			"trigger_id": uuid.New().String(),
			"keyword":    "preço",
			"action":     "reply",
			"contact":    contactJID,
		}

	case strings.HasPrefix(eventID, "warmup."):
		return fiber.Map{
			"session_id": uuid.New().String(),
			"day":        7,
			"sent_today": 65,
		}

	case strings.HasPrefix(eventID, "csat."):
		return fiber.Map{
			"survey_id":     uuid.New().String(),
			"contact":       contactJID,
			"score":         5,
			"comment":       "Atendimento ótimo, obrigado!",
		}

	case strings.HasPrefix(eventID, "group."):
		return fiber.Map{
			"group_jid":  groupJID,
			"actor":      contactJID,
			"action":     strings.TrimPrefix(eventID, "group."),
		}

	case strings.HasPrefix(eventID, "newsletter."):
		return fiber.Map{
			"newsletter_jid": "120363xxxxxxxx@newsletter",
			"event":          strings.TrimPrefix(eventID, "newsletter."),
		}

	case strings.HasPrefix(eventID, "call."):
		return fiber.Map{
			"call_id":   "abc-call-123",
			"caller":    contactJID,
			"is_video":  false,
			"timestamp": time.Now().Unix(),
		}

	case strings.HasPrefix(eventID, "payment.") || strings.HasPrefix(eventID, "subscription.") || strings.HasPrefix(eventID, "billing."):
		return fiber.Map{
			"customer_id":     uuid.New().String(),
			"plan":            "pro",
			"amount":          299.00,
			"currency":        "BRL",
			"status":          eventID,
			"transaction_id":  fmt.Sprintf("txn_%d", time.Now().Unix()),
		}

	case strings.HasPrefix(eventID, "user."):
		return fiber.Map{
			"user_id": uuid.New().String(),
			"email":   "joao@exemplo.com",
			"action":  strings.TrimPrefix(eventID, "user."),
		}

	case strings.HasPrefix(eventID, "workspace."):
		return fiber.Map{
			"workspace_id": uuid.New().String(),
			"action":       strings.TrimPrefix(eventID, "workspace."),
		}

	case strings.HasPrefix(eventID, "presence.") || strings.HasPrefix(eventID, "chat.") || strings.HasPrefix(eventID, "contact."):
		return fiber.Map{
			"jid":    contactJID,
			"event":  eventID,
			"online": true,
		}

	case eventID == "webhook.test":
		return fiber.Map{
			"type":    "test",
			"message": "Disparo manual via dashboard",
			"events":  []string{"webhook.test"},
		}
	}

	return fiber.Map{"event": eventID}
}

// ─── Test selecionado ────────────────────────────────────────────────

// TestInstanceWebhook — POST /v1/instances/:id/webhooks/:webhookId/test
//
// Body: { "event_id": "message.received" } — opcional. Se vazio, usa
// "webhook.test" como evento (compatível com o Test global atual).
func (h *WebhookLogsHandler) TestInstanceWebhook(c *fiber.Ctx) error {
	wh, err := h.findInstanceWebhook(c)
	if err != nil {
		return err
	}
	return h.testWebhook(c, wh.URL, wh.Secret, &wh.ID, nil)
}

// TestGlobalWebhook — POST /v1/webhooks/system/:id/test (versão nova com event_id)
func (h *WebhookLogsHandler) TestGlobalWebhook(c *fiber.Ctx) error {
	wh, err := h.findGlobalWebhook(c)
	if err != nil {
		return err
	}
	return h.testWebhook(c, wh.URL, wh.Secret, nil, &wh.ID)
}

func (h *WebhookLogsHandler) testWebhook(c *fiber.Ctx, url, secret string, instanceWebhookID, globalWebhookID *uuid.UUID) error {
	var req struct {
		EventID string `json:"event_id"`
	}
	_ = c.BodyParser(&req)
	eventID := strings.TrimSpace(req.EventID)
	if eventID == "" {
		eventID = "webhook.test"
	}
	if !validEventIDs()[eventID] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "evento desconhecido", "event": eventID})
	}

	mock := mockEventPayload(eventID)
	payload := whatsapp.WebhookPayload{
		Event:      eventID,
		InstanceID: "00000000-0000-0000-0000-000000000000",
		Timestamp:  time.Now(),
		Data:       mock,
	}
	result := whatsapp.DispatchWebhookSync(url, secret, payload)

	whIDStr, gIDStr := "", ""
	if instanceWebhookID != nil {
		whIDStr = instanceWebhookID.String()
	}
	if globalWebhookID != nil {
		gIDStr = globalWebhookID.String()
	}
	whatsapp.RecordDelivery(whIDStr, gIDStr, eventID, url, payload, result, 0)

	return c.JSON(fiber.Map{
		"success":    result.Success(),
		"status":     result.StatusCode,
		"latency_ms": result.LatencyMs,
		"error":      result.Error,
		"sent_event": eventID,
	})
}
