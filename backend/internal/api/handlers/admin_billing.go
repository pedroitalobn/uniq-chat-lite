package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// AdminBillingHandler — endpoints administrativos pra área de billing
// inspecionar/agir sobre um user específico. Complementa o BillingHandler
// (self-serve) e o AdminHandler (settings + plan-history).
type AdminBillingHandler struct {
	db       *gorm.DB
	asaas    *AsaasHandler
	emailSvc *email.Service
}

func NewAdminBillingHandler(db *gorm.DB, asaas *AsaasHandler, emailSvc *email.Service) *AdminBillingHandler {
	return &AdminBillingHandler{db: db, asaas: asaas, emailSvc: emailSvc}
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

	// Últimos pagamentos no provider. Pra Asaas listamos via API; pra
	// Stripe/Abacatepay esse passo fica vazio (handler de cada provider
	// pode estender depois). Inclui o "último pagamento recebido" que o
	// operador quer ver em destaque.
	payments := []map[string]any{}
	var lastReceived map[string]any
	if resolveUserProvider(&user) == "asaas" && strings.TrimSpace(user.AsaasCustomerID) != "" {
		listResp, err := h.asaas.apiRequest("GET",
			"/api/v3/payments?customer="+user.AsaasCustomerID+"&limit=20&order=desc", nil)
		if err == nil {
			var listed struct {
				Data []map[string]any `json:"data"`
			}
			if json.Unmarshal(listResp, &listed) == nil {
				payments = listed.Data
				for _, p := range listed.Data {
					if s, _ := p["status"].(string); s == "RECEIVED" || s == "CONFIRMED" {
						lastReceived = p
						break
					}
				}
			}
		}
	}

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
		"payments":       payments,
		"last_received":  lastReceived,
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

// RefundPayment POST /v1/admin/users/:id/billing/refund
// Body: { payment_id, value? (partial em BRL), description? }
//
// Reembolsa uma cobrança avulsa do user via Asaas. payment_id é o ID
// da cobrança no Asaas (vem do overview.payments). Sem value, refunda
// o valor total da cobrança original.
func (h *AdminBillingHandler) RefundPayment(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var req struct {
		PaymentID   string  `json:"payment_id"`
		Value       float64 `json:"value"`
		Description string  `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.PaymentID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "payment_id é obrigatório"})
	}
	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user não encontrado"})
	}
	if resolveUserProvider(&user) != "asaas" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Refund por enquanto disponível apenas pra provider Asaas.",
		})
	}
	payload := map[string]any{}
	if req.Value > 0 {
		payload["value"] = req.Value
	}
	if d := strings.TrimSpace(req.Description); d != "" {
		payload["description"] = d
	}
	body, _ := json.Marshal(payload)
	respBytes, err := h.asaas.apiRequest("POST",
		"/api/v3/payments/"+req.PaymentID+"/refund", body)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	var parsed map[string]any
	_ = json.Unmarshal(respBytes, &parsed)
	if errs, _ := parsed["errors"].([]any); len(errs) > 0 {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":  "asaas_refund_failed",
			"detail": parsed["errors"],
		})
	}
	log.Info().Str("user", user.ID.String()).Str("payment", req.PaymentID).
		Float64("value", req.Value).Msg("admin billing: refund executado")
	return c.JSON(fiber.Map{"ok": true, "refund": parsed})
}

// CreateCheckoutLink POST /v1/admin/users/:id/billing/checkout-link
// Body: { value, description?, plan_name?, charge_types? (DETACHED|RECURRENT),
//         subscription_cycle? (MONTHLY), send_email? (bool), copy_only? (bool) }
//
// Cria uma sessão Asaas Checkout (PIX + Cartão lado a lado) pro user e
// devolve a URL hospedada. Quando send_email=true, dispara um email com
// o link pro user. copy_only=true só devolve a URL pro admin colar onde
// quiser. Os dois flags podem ser true ao mesmo tempo.
func (h *AdminBillingHandler) CreateCheckoutLink(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var req struct {
		Value             float64 `json:"value"`
		Description       string  `json:"description"`
		PlanName          string  `json:"plan_name"`
		ChargeType        string  `json:"charge_type"` // DETACHED (uma vez) | RECURRENT
		SubscriptionCycle string  `json:"subscription_cycle"`
		SendEmail         bool    `json:"send_email"`
		CopyOnly          bool    `json:"copy_only"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.Value <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "value > 0"})
	}
	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user não encontrado"})
	}
	chargeType := strings.ToUpper(strings.TrimSpace(req.ChargeType))
	if chargeType == "" {
		chargeType = "DETACHED"
	}
	cycle := strings.ToUpper(strings.TrimSpace(req.SubscriptionCycle))
	if chargeType == "RECURRENT" && cycle == "" {
		cycle = "MONTHLY"
	}
	planName := strings.TrimSpace(req.PlanName)
	if planName == "" {
		planName = "Cobrança Uniq Chat"
	}
	description := strings.TrimSpace(req.Description)
	if description == "" {
		description = "Pagamento — " + planName
	}

	checkoutReq := AsaasCheckoutRequest{
		BillingTypes:      []string{"PIX", "CREDIT_CARD"},
		ChargeTypes:       []string{chargeType},
		Customer:          user.AsaasCustomerID,
		SubscriptionCycle: cycle,
		Items: []AsaasCheckoutItem{{
			Name:     planName,
			Quantity: 1,
			Value:    req.Value,
		}},
		ExternalReference: user.ID.String() + "|admin-link|" + time.Now().Format("20060102T150405"),
	}
	// Se não há customer_id Asaas ainda, manda os dados conhecidos do user
	// pra Asaas materializar o customer dentro do checkout.
	if checkoutReq.Customer == "" {
		checkoutReq.CustomerData = &AsaasCheckoutCustomerData{
			Name:    user.Name,
			Email:   user.Email,
			CpfCnpj: user.TaxID,
			Phone:   user.Phone,
		}
	}
	co, raw, err := h.asaas.CreateAsaasCheckout(checkoutReq)
	if err != nil || co == nil || co.URL == "" {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":  "asaas_checkout_failed",
			"detail": string(raw),
		})
	}

	emailed := false
	if req.SendEmail {
		subject := "Link de pagamento — " + planName
		html := buildCheckoutLinkEmail(user.Name, planName, req.Value, co.URL, description)
		if err := h.emailSvc.SyncSend(user.Email, subject, html, "billing_checkout_link"); err != nil {
			log.Warn().Err(err).Str("user", user.ID.String()).Msg("admin billing: envio de email falhou")
		} else {
			emailed = true
		}
	}
	return c.JSON(fiber.Map{
		"ok":           true,
		"checkout_id":  co.ID,
		"url":          co.URL,
		"emailed":      emailed,
		"sent_to":      user.Email,
		"copy_only":    req.CopyOnly,
	})
}

// SendCheckoutLink POST /v1/admin/users/:id/billing/send-link
// Body: { url, subject?, message? }
//
// Reenvia um link de pagamento já criado pro email do user. Use-case:
// admin criou o checkout, copiou o link, depois mudou de ideia e quer
// que a Uniq mande direto pro cliente.
func (h *AdminBillingHandler) SendCheckoutLink(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var req struct {
		URL     string `json:"url"`
		Subject string `json:"subject"`
		Message string `json:"message"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "url é obrigatório"})
	}
	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user não encontrado"})
	}
	subject := strings.TrimSpace(req.Subject)
	if subject == "" {
		subject = "Link de pagamento — Uniq Chat"
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "A equipe Uniq Chat gerou um link de pagamento pra você."
	}
	html := buildCheckoutLinkEmail(user.Name, "Pagamento solicitado", 0, req.URL, message)
	if err := h.emailSvc.SyncSend(user.Email, subject, html, "billing_checkout_link"); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":  "email_send_failed",
			"detail": err.Error(),
		})
	}
	return c.JSON(fiber.Map{"ok": true, "sent_to": user.Email})
}

// buildCheckoutLinkEmail — HTML simples e seguro. Mantém estilo
// minimalista pra evitar Spam Assassin reclamar de muito CSS.
func buildCheckoutLinkEmail(name, planName string, value float64, url, message string) string {
	greeting := strings.TrimSpace(name)
	if greeting == "" {
		greeting = "Cliente"
	}
	valStr := ""
	if value > 0 {
		valStr = fmt.Sprintf("<p style=\"margin:0 0 16px 0;color:#475569;\">Valor: <strong>R$ %.2f</strong></p>", value)
	}
	return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e293b;">
<h2 style="margin:0 0 12px 0;">Olá, ` + greeting + `</h2>
<p style="margin:0 0 12px 0;">` + message + `</p>
<p style="margin:0 0 6px 0;color:#475569;">Cobrança: <strong>` + planName + `</strong></p>
` + valStr + `
<p style="margin:24px 0;text-align:center;">
  <a href="` + url + `" style="display:inline-block;padding:12px 28px;background:#00d46a;color:#03170a;border-radius:10px;text-decoration:none;font-weight:600;">Pagar agora</a>
</p>
<p style="font-size:12px;color:#64748b;margin:24px 0 0 0;">Ou abra esse endereço no navegador: <br/><a href="` + url + `" style="color:#0ea5e9;word-break:break-all;">` + url + `</a></p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Pagamento processado com segurança pelo Asaas — autorizado pelo BACEN.</p>
</div>`
}
