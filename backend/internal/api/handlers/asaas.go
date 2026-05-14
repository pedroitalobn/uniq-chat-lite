package handlers

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type AsaasHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
}

func NewAsaasHandler(db *gorm.DB, emailSvc *email.Service) *AsaasHandler {
	return &AsaasHandler{
		db:       db,
		emailSvc: emailSvc,
	}
}

func (h *AsaasHandler) getAPIKey() string {
	var settings models.PaymentSettings
	if err := h.db.First(&settings).Error; err == nil && settings.AsaasAPIKey != "" {
		return settings.AsaasAPIKey
	}
	return config.AppConfig.AsaasAPIKey
}

func (h *AsaasHandler) getWebhookSecret() string {
	var settings models.PaymentSettings
	if err := h.db.First(&settings).Error; err == nil && settings.AsaasWebhookSecret != "" {
		return settings.AsaasWebhookSecret
	}
	return config.AppConfig.AsaasWebhookSecret
}

func (h *AsaasHandler) getBaseURL() string {
	var settings models.PaymentSettings
	env := config.AppConfig.AsaasEnvironment
	if err := h.db.First(&settings).Error; err == nil && settings.AsaasEnvironment != "" {
		env = settings.AsaasEnvironment
	}

	if env == "production" {
		return "https://www.asaas.com"
	}
	return "https://sandbox.asaas.com"
}

func (h *AsaasHandler) apiRequest(method, endpoint string, body []byte) ([]byte, error) {
	url := h.getBaseURL() + endpoint
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("access_token", h.getAPIKey())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}

// AsaasCustomerRequest — payload de POST /api/v3/customers. A API v3
// espera o documento em "cpfCnpj" (aceita CPF ou CNPJ). Quando o
// payload chega com a chave "cpf" o Asaas ignora silenciosamente e
// depois falha a criação da cobrança com
// "Para criar esta cobrança é necessário preencher o CPF ou CNPJ do
// cliente.". mobilePhone também é exigido em vários fluxos PIX.
type AsaasCustomerRequest struct {
	Name        string `json:"name"`
	Email       string `json:"email"`
	CpfCnpj     string `json:"cpfCnpj,omitempty"`
	MobilePhone string `json:"mobilePhone,omitempty"`
}

type AsaasCustomerResponse struct {
	ID string `json:"id"`
}

// AsaasSubscriptionRequest — payload de POST /api/v3/subscriptions.
// IMPORTANTE: os nomes JSON têm que bater EXATAMENTE com a API Asaas v3:
//   - billingType (era paymentMethod) — CREDIT_CARD | BOLETO | PIX | UNDEFINED.
//   - value       (era price)         — valor da cobrança recorrente.
// Asaas devolve invalid_billingType / invalid_value se vier qualquer outra
// chave. "plan" é opcional/ignorado em assinatura recorrente — mantemos
// como referência interna em externalReference.
type AsaasSubscriptionRequest struct {
	Customer          string  `json:"customer"`
	BillingType       string  `json:"billingType"`
	Value             float64 `json:"value"`
	Cycle             string  `json:"cycle"`
	NextDueDate       string  `json:"nextDueDate"`
	Description       string  `json:"description,omitempty"`
	ExternalReference string  `json:"externalReference,omitempty"`
	// Campos exigidos quando BillingType=CREDIT_CARD em modo transparente
	// (cobrança recorrente cartão sem redirect). Asaas tokeniza no primeiro
	// charge e usa o token nas próximas faturas — não precisamos guardar.
	CreditCard           *AsaasCreditCard           `json:"creditCard,omitempty"`
	CreditCardHolderInfo *AsaasCreditCardHolderInfo `json:"creditCardHolderInfo,omitempty"`
	RemoteIP             string                     `json:"remoteIp,omitempty"`
}

// AsaasCreditCard — dados do cartão pra cobrança transparente.
type AsaasCreditCard struct {
	HolderName  string `json:"holderName"`
	Number      string `json:"number"`
	ExpiryMonth string `json:"expiryMonth"`
	ExpiryYear  string `json:"expiryYear"`
	Ccv         string `json:"ccv"`
}

// AsaasCreditCardHolderInfo — dados do dono do cartão (antifraude). Asaas
// exige name/email/cpfCnpj/postalCode/addressNumber/phone como mínimo.
type AsaasCreditCardHolderInfo struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	CpfCnpj       string `json:"cpfCnpj"`
	PostalCode    string `json:"postalCode"`
	AddressNumber string `json:"addressNumber"`
	AddressComplement string `json:"addressComplement,omitempty"`
	Phone         string `json:"phone"`
	MobilePhone   string `json:"mobilePhone,omitempty"`
}

type AsaasSubscriptionResponse struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	InvoiceURL   string `json:"invoiceUrl,omitempty"`
	BankSlipLink string `json:"bankSlipLink,omitempty"`
	InvoiceID    string `json:"invoiceId,omitempty"`
}

type AsaasPaymentLinkRequest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Price          float64  `json:"price"`
	Active         bool     `json:"active"`
	PaymentMethods []string `json:"paymentMethods"`        // CREDIT_CARD, BOLETO, PIX
	RepeatEvery    int      `json:"repeatEvery,omitempty"` // 1 for monthly
	Recurrence     string   `json:"recurrence,omitempty"`  // MONTHLY
	BillingType    string   `json:"billingType"`           // RECURRING
}

type AsaasPaymentLinkResponse struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ShortCode string `json:"shortCode"`
	Status    string `json:"status"`
}

// POST /asaas/checkout — create Asaas payment (protected)
// CreateCheckout cria uma SUBSCRIPTION RECORRENTE em PIX no Asaas.
//
// Decisão de produto: Asaas só vende PIX recorrente. Boleto/cartão
// nunca via Asaas — pra cartão usar Stripe (/v1/stripe/checkout).
// Não vendemos PIX único nem boleto.
//
// Fluxo:
//  1. Cria customer no Asaas (idempotente — reusa se já existir)
//  2. Cria subscription com billingType=PIX, cycle=MONTHLY
//  3. Asaas gera a primeira fatura imediatamente; user recebe QR/copia-e-cola
//  4. Próximas faturas são geradas automaticamente todo mês
//
// Webhook Asaas atualiza user.asaas_subscription_id quando confirmar
// o primeiro pagamento (PAYMENT_RECEIVED → ativa o plano).
func (h *AsaasHandler) CreateCheckout(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	apiKey := h.getAPIKey()
	if apiKey == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Asaas não configurado"})
	}

	var req struct {
		PlanID string `json:"plan_id"`
		Cpf    string `json:"cpf"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var plan models.Plan
	if err := h.db.First(&plan, "id = ?", req.PlanID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}
	if plan.Price == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "use este endpoint apenas para planos pagos"})
	}

	// Customer (idempotente)
	customerID := user.AsaasCustomerID
	if customerID == "" {
		cpf := req.Cpf
		if cpf == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "cpf_required",
				"message": "CPF é obrigatório pra criar cliente Asaas (PIX exige CPF/CNPJ)",
			})
		}
		custReq := AsaasCustomerRequest{
			Name:        user.Name,
			Email:       user.Email,
			CpfCnpj:     cpf,
			MobilePhone: user.Phone,
		}
		custBody, _ := json.Marshal(custReq)
		custResp, err := h.apiRequest("POST", "/api/v3/customers", custBody)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar cliente Asaas"})
		}
		var cust AsaasCustomerResponse
		if err := json.Unmarshal(custResp, &cust); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar resposta Asaas"})
		}
		customerID = cust.ID
		h.db.Model(user).Update("asaas_customer_id", customerID)
	}

	// Subscription recorrente PIX. Asaas cria a primeira fatura na hora;
	// próximas saem automaticamente todo mês na nextDueDate.
	subReq := AsaasSubscriptionRequest{
		Customer:          customerID,
		BillingType:       "PIX",
		Value:             plan.Price,
		Cycle:             "MONTHLY",
		NextDueDate:       time.Now().AddDate(0, 0, 1).Format("2006-01-02"), // 1 dia
		Description:       "Assinatura " + plan.Name + " — Uniq Chat",
		ExternalReference: user.ID.String() + "|" + plan.ID.String(),
	}
	subBody, _ := json.Marshal(subReq)
	subRespBytes, err := h.apiRequest("POST", "/api/v3/subscriptions", subBody)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar assinatura: " + err.Error()})
	}
	var subResp AsaasSubscriptionResponse
	if err := json.Unmarshal(subRespBytes, &subResp); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "resposta Asaas inválida"})
	}
	if subResp.ID == "" {
		// Asaas devolveu erro detalhado no body (4xx)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":  "asaas_error",
			"detail": string(subRespBytes),
		})
	}

	// Marca pendente — vai virar ACTIVE quando o webhook PAYMENT_RECEIVED chegar.
	h.db.Model(user).Updates(map[string]any{
		"asaas_subscription_id":     subResp.ID,
		"asaas_subscription_status": "PENDING_PAYMENT",
	})

	// A primeira fatura tem QR PIX gerado pelo Asaas. Pra mostrar pro user
	// imediatamente, listamos os payments dessa subscription e pegamos o
	// invoice_url da primeira (mais recente).
	listResp, _ := h.apiRequest("GET", "/api/v3/payments?subscription="+subResp.ID+"&limit=1", nil)
	var listed struct {
		Data []struct {
			ID         string `json:"id"`
			InvoiceURL string `json:"invoiceUrl"`
			Status     string `json:"status"`
		} `json:"data"`
	}
	json.Unmarshal(listResp, &listed)

	out := fiber.Map{
		"checkout_type":    "subscription",
		"subscription_id":  subResp.ID,
		"plan_name":        plan.Name,
		"plan_price":       plan.Price,
		"payment_method":   "PIX",
		"recurrence":       "MONTHLY",
		"status":           subResp.Status,
		"message":          "Assinatura PIX recorrente criada. Pague a primeira fatura pra ativar.",
	}
	if len(listed.Data) > 0 {
		out["first_invoice_url"] = listed.Data[0].InvoiceURL
		out["first_payment_id"] = listed.Data[0].ID
	}
	return c.JSON(out)
}

// GET /asaas/subscription — get current user subscription status (protected)
func (h *AsaasHandler) GetSubscription(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	h.db.Preload("Plan").First(user, "id = ?", user.ID)

	return c.JSON(fiber.Map{
		"plan":               user.Plan,
		"asaas_subscription": user.AsaasSubscriptionID,
		"asaas_status":       user.AsaasSubscriptionStatus,
		"status":             user.AsaasSubscriptionStatus,
	})
}

// POST /asaas/webhook — handle Asaas events (public).
// Auth: Asaas envia o token configurado em "Token de autenticação" via
// header `asaas-access-token`. Antes a validação só checava se o header
// EXISTIA — atacante mandava qualquer string e ativava qualquer plano.
// Agora compara em tempo constante contra o secret configurado.
func (h *AsaasHandler) Webhook(c *fiber.Ctx) error {
	webhookSecret := strings.TrimSpace(h.getWebhookSecret())
	if webhookSecret == "" {
		// Sem secret configurado, recusa o webhook em vez de aceitar
		// payloads não autenticados. Admin precisa setar o token em
		// /admin/providers → Asaas pra ativar a integração.
		log.Warn().Msg("asaas webhook recebido sem secret configurado — rejeitando pra evitar fake events")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "asaas webhook secret não configurado — admin precisa setar em /admin/providers",
		})
	}
	// Asaas envia o token em `asaas-access-token` (hifen, lowercase).
	// Tentamos as duas grafias por compatibilidade com setups antigos.
	provided := strings.TrimSpace(c.Get("asaas-access-token"))
	if provided == "" {
		provided = strings.TrimSpace(c.Get("asaas-signature"))
	}
	if provided == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "token ausente"})
	}
	if subtle.ConstantTimeCompare([]byte(provided), []byte(webhookSecret)) != 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "token inválido"})
	}

	var event map[string]interface{}
	if err := c.BodyParser(&event); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	eventType, _ := event["event"].(string)
	paymentEvent, _ := event["payment"].(map[string]interface{})

	// Idempotência: Asaas pode reenviar webhook em retry. ID do evento
	// vem em event["id"] (UUID asaas). INSERT ON CONFLICT garante
	// processamento single.
	if eventID, _ := event["id"].(string); eventID != "" {
		res := h.db.Exec(
			"INSERT INTO processed_webhook_events (event_id, provider, processed_at) VALUES (?, 'asaas', ?) ON CONFLICT DO NOTHING",
			eventID, time.Now(),
		)
		if res.Error == nil && res.RowsAffected == 0 {
			return c.JSON(fiber.Map{"received": true, "duplicate": true})
		}
	}

	switch eventType {
	case "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED":
		externalRef, _ := paymentEvent["externalReference"].(string)
		// subscription ID vem em payment.subscription (não payment.id, que é
		// o payment do mês). Subscription só está presente em recorrentes.
		subscriptionID, _ := paymentEvent["subscription"].(string)

		if externalRef != "" {
			parts := strings.Split(externalRef, "|")
			if len(parts) >= 2 {
				userID := parts[0]
				planID := parts[1]

				var plan models.Plan
				var oldUser models.User
				_ = h.db.First(&oldUser, "id = ?", userID).Error
				if h.db.First(&plan, "id = ?", planID).Error == nil {
					updates := map[string]interface{}{
						"plan_id":                   plan.ID,
						"asaas_subscription_status": "active",
					}
					if subscriptionID != "" {
						updates["asaas_subscription_id"] = subscriptionID
					}
					h.db.Model(&models.User{}).Where("id = ?", userID).Updates(updates)

					// Audit: cria PlanChangeLog na primeira ativação. Pra
					// pagamentos subsequentes (renovação) o plano não muda
					// e o INSERT vira no-op via condição (oldUser.PlanID
					// já é o mesmo).
					if oldUser.PlanID == nil || *oldUser.PlanID != plan.ID {
						h.db.Create(&models.PlanChangeLog{
							UserID:       oldUser.ID,
							FromPlanID:   oldUser.PlanID,
							ToPlanID:     &plan.ID,
							ToPlanName:   plan.Name,
							Source:       models.PlanChangeSourceAsaas,
							ActorID:      &oldUser.ID,
							ActorEmail:   oldUser.Email,
							Notes:        "Ativação após pagamento PIX confirmado.",
						})
					}

					var user models.User
					if h.db.First(&user, "id = ?", userID).Error == nil {
						h.emailSvc.SendPaymentConfirmed(user.Email, user.Name, plan.Name, plan.Price)
					}
				}
			}
		}

	case "PAYMENT_OVERDUE", "PAYMENT_EXPIRED":
		externalRef, _ := paymentEvent["externalReference"].(string)
		if externalRef != "" {
			parts := strings.Split(externalRef, "|")
			if len(parts) >= 1 {
				userID := parts[0]
				h.db.Model(&models.User{}).Where("id = ?", userID).
					Update("asaas_subscription_status", "past_due")
			}
		}

	case "SUBSCRIPTION_CANCELED":
		subID, _ := paymentEvent["subscription"].(string)
		if subID != "" {
			var user models.User
			if h.db.Where("asaas_subscription_id = ?", subID).First(&user).Error == nil {
				var freePlan models.Plan
				if h.db.First(&freePlan, "name = 'Free'").Error == nil {
					h.db.Model(&user).Updates(map[string]interface{}{
						"plan_id":                   freePlan.ID,
						"asaas_subscription_id":     "",
						"asaas_subscription_status": "canceled",
					})

					h.emailSvc.SendSubscriptionCanceled(user.Email, user.Name)
				}
			}
		}
	}

	return c.JSON(fiber.Map{"received": true})
}

// GetPaymentStatus consulta o Asaas pra verificar se a primeira fatura de
// uma subscription recorrente foi paga. Retorna true se houver pelo menos
// um payment com status RECEIVED ou CONFIRMED.
func (h *AsaasHandler) GetPaymentStatus(subscriptionID string) (paid bool, err error) {
	if subscriptionID == "" {
		return false, nil
	}
	respBytes, err := h.apiRequest("GET", "/api/v3/payments?subscription="+subscriptionID+"&limit=10", nil)
	if err != nil {
		return false, err
	}
	var result struct {
		Data []struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return false, err
	}
	for _, p := range result.Data {
		if p.Status == "RECEIVED" || p.Status == "CONFIRMED" {
			return true, nil
		}
	}
	return false, nil
}

// GET /asaas/plans — list plans with Asaas info (public)
func (h *AsaasHandler) ListPlans(c *fiber.Ctx) error {
	var plans []models.Plan
	if err := h.db.Where("is_active = true").Order("price ASC").Find(&plans).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar planos"})
	}
	return c.JSON(plans)
}
