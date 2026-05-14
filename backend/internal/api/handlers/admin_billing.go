package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// AdminBillingHandler — endpoints administrativos pra área de billing
// inspecionar/agir sobre um user específico. Complementa o BillingHandler
// (self-serve) e o AdminHandler (settings + plan-history).
type AdminBillingHandler struct {
	db    *gorm.DB
	asaas *AsaasHandler
}

func NewAdminBillingHandler(db *gorm.DB, asaas *AsaasHandler) *AdminBillingHandler {
	return &AdminBillingHandler{db: db, asaas: asaas}
}

// resolveProvider — escolhe o provider ativo desse user usando a mesma
// regra do BillingHandler self-serve, mas sem precisar do session token.
// Prioridade Stripe > Asaas > Abacatepay > "" (nunca pagou ainda).
func resolveUserProvider(u *models.User) string {
	if u == nil {
		return ""
	}
	if strings.TrimSpace(u.StripeSubscriptionID) != "" {
		return "stripe"
	}
	if strings.TrimSpace(u.AsaasSubscriptionID) != "" {
		return "asaas"
	}
	if strings.TrimSpace(u.AbacatepaySubscriptionID) != "" {
		return "abacatepay"
	}
	return ""
}

// Overview GET /v1/admin/users/:id/billing/overview
// Devolve tudo que a UI de billing precisa numa só chamada:
//   - user resumido + plano atual
//   - provider ativo + IDs (customer/subscription/status/next_charge_at)
//   - histórico de mudanças de plano (PlanChangeLog) últimos 12
//   - quota corrente: limites/usados/overage_allowed/overage_acumulado
//   - histórico de top-ups extras (UsageTopup) — proxy de "faturas extras"
func (h *AdminBillingHandler) Overview(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var user models.User
	if err := h.db.Preload("Plan").First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user não encontrado"})
	}

	// Plano + provider
	provider := resolveUserProvider(&user)

	var changes []models.PlanChangeLog
	h.db.Where("user_id = ?", userID).Order("created_at DESC").Limit(12).Find(&changes)

	// Quota corrente — pega o ciclo mais recente do user
	var quota models.UsageQuota
	h.db.Where("user_id = ?", userID).Order("period_start DESC").First(&quota)

	var topups []models.UsageTopup
	h.db.Where("user_id = ?", userID).Order("created_at DESC").Limit(20).Find(&topups)

	return c.JSON(fiber.Map{
		"user": fiber.Map{
			"id":    user.ID,
			"email": user.Email,
			"name":  user.Name,
			"role":  user.Role,
		},
		"plan":     user.Plan,
		"provider": provider,
		"stripe": fiber.Map{
			"customer_id":      user.StripeCustomerID,
			"subscription_id":  user.StripeSubscriptionID,
			"status":           user.StripeSubscriptionStatus,
		},
		"asaas": fiber.Map{
			"customer_id":      user.AsaasCustomerID,
			"subscription_id":  user.AsaasSubscriptionID,
			"status":           user.AsaasSubscriptionStatus,
			"flow":             user.AsaasFlow,
			"next_charge_at":   user.AsaasNextChargeAt,
			"cancel_at":        user.AsaasCancelAt,
		},
		"abacatepay": fiber.Map{
			"checkout_id":     user.AbacatepayCheckoutID,
			"subscription_id": user.AbacatepaySubscriptionID,
			"status":          user.AbacatepaySubscriptionStatus,
		},
		"plan_history":   changes,
		"quota":          quota,
		"topups":         topups,
	})
}

// CreateCustomInvoice POST /v1/admin/users/:id/billing/custom-invoice
// Body: { value, description?, due_date? (YYYY-MM-DD), billing_type? (PIX|CREDIT_CARD|BOLETO) }
//
// Gera uma cobrança avulsa de valor personalizado no provider ativo do
// user. Use-case: faturar overage, vendas avulsas, ajustes, descontos.
//
// Por enquanto suportamos APENAS Asaas (PIX/Boleto). Pra Stripe seria
// necessário criar uma Invoice nativa via stripe-go — fica pra follow-up.
func (h *AdminBillingHandler) CreateCustomInvoice(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var req struct {
		Value       float64 `json:"value"`
		Description string  `json:"description"`
		DueDate     string  `json:"due_date"`
		BillingType string  `json:"billing_type"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.Value <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "value precisa ser > 0"})
	}
	billingType := strings.ToUpper(strings.TrimSpace(req.BillingType))
	if billingType == "" {
		billingType = "PIX"
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user não encontrado"})
	}

	provider := resolveUserProvider(&user)
	if provider != "asaas" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "provider_unsupported",
			"message": "Fatura personalizada disponível por enquanto apenas pra users com provider Asaas. Stripe será adicionado depois.",
			"current": provider,
		})
	}
	if strings.TrimSpace(user.AsaasCustomerID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "asaas_customer_missing",
			"message": "User ainda não tem customer Asaas — peça que finalize um cadastro pago primeiro.",
		})
	}

	dueDate := strings.TrimSpace(req.DueDate)
	if dueDate == "" {
		dueDate = time.Now().AddDate(0, 0, 3).Format("2006-01-02")
	}
	description := strings.TrimSpace(req.Description)
	if description == "" {
		description = "Cobrança avulsa — Uniq Chat"
	}

	payload := map[string]any{
		"customer":          user.AsaasCustomerID,
		"billingType":       billingType,
		"value":             req.Value,
		"dueDate":           dueDate,
		"description":       description,
		"externalReference": user.ID.String() + "|custom|" + time.Now().Format("20060102T150405"),
	}
	body, _ := json.Marshal(payload)
	respBytes, err := h.asaas.apiRequest("POST", "/api/v3/payments", body)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "asaas_request_failed",
			"message": err.Error(),
		})
	}
	var parsed struct {
		ID         string  `json:"id"`
		Status     string  `json:"status"`
		Value      float64 `json:"value"`
		DueDate    string  `json:"dueDate"`
		InvoiceURL string  `json:"invoiceUrl"`
		ErrorList  []struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":  "asaas_response_invalid",
			"detail": string(respBytes),
		})
	}
	if parsed.ID == "" {
		msg := "Asaas rejeitou a cobrança"
		if len(parsed.ErrorList) > 0 {
			msg = parsed.ErrorList[0].Description
		}
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "asaas_error",
			"message": msg,
			"detail":  string(respBytes),
		})
	}
	return c.JSON(fiber.Map{
		"ok":           true,
		"payment_id":   parsed.ID,
		"status":       parsed.Status,
		"value":        parsed.Value,
		"due_date":     parsed.DueDate,
		"invoice_url":  parsed.InvoiceURL,
		"billing_type": billingType,
	})
}

// ToggleOverage PATCH /v1/admin/users/:id/billing/overage
// Body: { allow: bool }
//
// Liga/desliga a permissão de cobranças extras ao cliente quando ele
// estourar a quota do ciclo. Espelha o /v1/usage/me/overage que o
// próprio user controla, mas permite o admin agir em nome dele.
func (h *AdminBillingHandler) ToggleOverage(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var req struct {
		Allow bool `json:"allow"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if err := h.db.Model(&models.UsageQuota{}).
		Where("user_id = ?", userID).
		Update("overage_allowed", req.Allow).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "overage_allowed": req.Allow})
}

// helper compilation guard
var _ = fmt.Sprintf
