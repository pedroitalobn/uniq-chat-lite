package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

type AsaasHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
	proxyMgr *services.ProxyManager
}

func NewAsaasHandler(db *gorm.DB, emailSvc *email.Service) *AsaasHandler {
	return &AsaasHandler{
		db:       db,
		emailSvc: emailSvc,
		proxyMgr: services.NewProxyManager(db),
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

type AsaasCustomerRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Cpf   string `json:"cpf,omitempty"`
}

type AsaasCustomerResponse struct {
	ID string `json:"id"`
}

type AsaasSubscriptionRequest struct {
	Customer          string  `json:"customer"`
	Plan              string  `json:"plan"`
	Price             float64 `json:"price"`
	Cycle             string  `json:"cycle"`         // MONTHLY
	PaymentMethod     string  `json:"paymentMethod"` // CREDIT_CARD, BOLETO, PIX
	NextDueDate       string  `json:"nextDueDate"`
	Description       string  `json:"description,omitempty"`
	ExternalReference string  `json:"externalReference,omitempty"`
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
func (h *AsaasHandler) CreateCheckout(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	if h.getAPIKey() == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Asaas não configurado"})
	}

	var req struct {
		PlanID        string `json:"plan_id"`
		PaymentMethod string `json:"payment_method"` // CREDIT_CARD, BOLETO, PIX
		Cpf           string `json:"cpf"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var plan models.Plan
	if err := h.db.First(&plan, "id = ?", req.PlanID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}
	if plan.AsaasProductID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plano sem produto Asaas configurado"})
	}
	if plan.Price == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "use este endpoint apenas para planos pagos"})
	}

	paymentMethod := "PIX"
	if req.PaymentMethod != "" {
		paymentMethod = req.PaymentMethod
	}

	customerID := user.AsaasCustomerID
	if customerID == "" {
		cpf := req.Cpf
		if cpf == "" {
			cpf = "00000000000"
		}

		custReq := AsaasCustomerRequest{
			Name:  user.Name,
			Email: user.Email,
			Cpf:   cpf,
		}
		custBody, _ := json.Marshal(custReq)
		custResp, err := h.apiRequest("POST", "/api/v3/customers", custBody)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar cliente Asaas"})
		}

		var cust AsaasCustomerResponse
		if err := json.Unmarshal(custResp, &cust); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar resposta"})
		}
		customerID = cust.ID
		h.db.Model(user).Update("asaas_customer_id", customerID)
	}

	nextDueDate := time.Now().AddDate(0, 1, 1).Format("2006-01-02")

	subReq := AsaasSubscriptionRequest{
		Customer:          customerID,
		Plan:              plan.AsaasProductID,
		Price:             plan.Price,
		Cycle:             "MONTHLY",
		PaymentMethod:     paymentMethod,
		NextDueDate:       nextDueDate,
		Description:       "Assinatura " + plan.Name,
		ExternalReference: user.ID.String() + "|" + plan.ID.String(),
	}

	subBody, _ := json.Marshal(subReq)
	subResp, err := h.apiRequest("POST", "/api/v3/subscriptions", subBody)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar assinatura Asaas"})
	}

	var sub AsaasSubscriptionResponse
	if err := json.Unmarshal(subResp, &sub); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar assinatura"})
	}

	return c.JSON(fiber.Map{
		"subscription_id": sub.ID,
		"status":          sub.Status,
		"invoice_url":     sub.InvoiceURL,
		"boleto_link":     sub.BankSlipLink,
		"invoice_id":      sub.InvoiceID,
		"url":             sub.InvoiceURL,
	})
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

// POST /asaas/webhook — handle Asaas events (public)
func (h *AsaasHandler) Webhook(c *fiber.Ctx) error {
	webhookSecret := h.getWebhookSecret()
	if webhookSecret != "" {
		signature := c.Get("asaas-signature")
		if signature == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "assinatura ausente"})
		}
	}

	var event map[string]interface{}
	if err := c.BodyParser(&event); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	eventType, _ := event["event"].(string)
	paymentEvent, _ := event["payment"].(map[string]interface{})

	switch eventType {
	case "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED":
		externalRef, _ := paymentEvent["externalReference"].(string)
		if externalRef != "" {
			parts := strings.Split(externalRef, "|")
			if len(parts) >= 2 {
				userID := parts[0]
				planID := parts[1]

				var plan models.Plan
				if h.db.First(&plan, "id = ?", planID).Error == nil {
					h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
						"plan_id":                   plan.ID,
						"asaas_subscription_id":     paymentEvent["id"],
						"asaas_subscription_status": "active",
					})

					if plan.AllowProxyResidencial {
						if uid, err := uuid.Parse(userID); err == nil {
							h.proxyMgr.EnsurePoolHasCapacity(uid, &plan)
						}
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

					if uid, err := uuid.Parse(user.ID.String()); err == nil {
						h.proxyMgr.ReleaseAllForUser(uid)
					}

					h.emailSvc.SendSubscriptionCanceled(user.Email, user.Name)
				}
			}
		}
	}

	return c.JSON(fiber.Map{"received": true})
}

// GET /asaas/plans — list plans with Asaas info (public)
func (h *AsaasHandler) ListPlans(c *fiber.Ctx) error {
	var plans []models.Plan
	if err := h.db.Where("is_active = true").Order("price ASC").Find(&plans).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar planos"})
	}
	return c.JSON(plans)
}
