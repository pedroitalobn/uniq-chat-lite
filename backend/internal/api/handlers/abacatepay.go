package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type AbacatePayHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
}

func NewAbacatePayHandler(db *gorm.DB, emailSvc *email.Service) *AbacatePayHandler {
	return &AbacatePayHandler{
		db:       db,
		emailSvc: emailSvc,
	}
}

// abacatepayClient retorna o base URL configurado (sandbox ou produção).
func (h *AbacatePayHandler) abacatepayClient() string {
	var settings models.PaymentSettings
	env := "sandbox"
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayEnvironment != "" {
		env = settings.AbacatepayEnvironment
	}
	if env == "production" {
		return "https://api.abacatepay.com"
	}
	return "https://sandbox.abacatepay.com"
}

// getAPIKey retorna a API key configurada (DB > env).
func (h *AbacatePayHandler) getAPIKey() string {
	var settings models.PaymentSettings
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayAPIKey != "" {
		return settings.AbacatepayAPIKey
	}
	return config.AppConfig.AbacatepayAPIKey
}

// getWebhookSecret retorna o secret configurado para validar HMAC dos webhooks.
func (h *AbacatePayHandler) getWebhookSecret() string {
	var settings models.PaymentSettings
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayWebhookSecret != "" {
		return settings.AbacatepayWebhookSecret
	}
	return config.AppConfig.AbacatepayWebhookSecret
}

// checkoutMode retorna "transparent" ou "redirect" conforme configuração.
func (h *AbacatePayHandler) checkoutMode() string {
	var settings models.PaymentSettings
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayCheckoutType != "" {
		return settings.AbacatepayCheckoutType
	}
	return "transparent"
}

// apiRequest faz uma chamada HTTP autenticada na API AbacatePay.
func (h *AbacatePayHandler) apiRequest(method, path string, body []byte) ([]byte, error) {
	baseURL := h.abacatepayClient()
	url := baseURL + "/v2" + path
	req, err := http.NewRequest(method, url, io.NopCloser(strings.NewReader(string(body))))
	if err != nil {
		return nil, fmt.Errorf("erro ao criar request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+h.getAPIKey())
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("erro de rede: %w", err)
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// ─── Types ──────────────────────────────────────────────────────────────────

type abacatepayCheckoutRequest struct {
	ExternalReference string              `json:"external_reference,omitempty"`
	Amount            int64               `json:"amount"`                        // em centavos
	Currency          string              `json:"currency,omitempty"`           // "BRL"
	Description       string              `json:"description"`
	PaymentMethods    []string            `json:"payment_methods,omitempty"`    // ["pix"]
	Metadata          map[string]string   `json:"metadata,omitempty"`
	CallbackURL       string              `json:"callback_url,omitempty"`
}

type abacatepayCheckoutResponse struct {
	ID                string `json:"id"`
	ExternalReference string `json:"external_reference"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Status            string `json:"status"`       // pending, paid, cancelled, expired, partially_refunded, refunded
	PaymentLink       string `json:"payment_link"` // checkout hospedado URL
	BrCode            string `json:"br_code"`      // PIX EMV payload (transparente)
	BrCodeBase64      string `json:"-"`            // calculado localmente
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

type abacatepayQRRequest struct {
	Amount      int64  `json:"amount"`
	Description string `json:"description"`
}

type abacatepaySubscriptionRequest struct {
	PlanID       string `json:"plan_id"`       // ID do produto no AbacatePay
	ExternalID   string `json:"external_id"`   // user_id do uniq
	CallbackURL  string `json:"callback_url"`
}

type abacatepaySubscriptionResponse struct {
	ID         string `json:"id"`
	PlanID     string `json:"plan_id"`
	ExternalID string `json:"external_id"`
	Status     string `json:"status"` // pending, active, cancelled, past_due
	PaymentLink string `json:"payment_link"`
	BrCode     string `json:"br_code"`
}

// ─── Webhook ────────────────────────────────────────────────────────────────

// abacatepayWebhookPayload representa o payload de webhook da AbacatePay.
type abacatepayWebhookPayload struct {
	Event   string           `json:"event"`   // checkout.paid, checkout.cancelled, etc.
	Data    checkoutWebhookData `json:"data"`
}

type checkoutWebhookData struct {
	ID                string `json:"id"`
	ExternalReference string `json:"external_reference"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Status            string `json:"status"`
	PaymentMethod     string `json:"payment_method"` // pix, credit_card, etc.
	PaidAt            string `json:"paid_at"`
	Metadata          string `json:"metadata"`
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

// POST /abacatepay/checkout — create hosted / transparent checkout (protected)
func (h *AbacatePayHandler) CreateCheckout(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	apiKey := h.getAPIKey()
	if apiKey == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error":   "abacatepay_not_configured",
			"message": "AbacatePay não está configurado. Admin precisa setar a API key.",
		})
	}

	var req struct {
		PlanID string `json:"plan_id"`
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

	amount := int64(plan.Price * 100) // centavos
	mode := h.checkoutMode()

	// Monta request para AbacatePay.
	// O campo external_reference é o user_id para que o webhook possa
	// identificar quem pagou.
	paymentMethods := []string{"pix"}
	if c.Query("payment_method") != "" {
		pm := strings.ToLower(c.Query("payment_method"))
		switch pm {
		case "pix":
			paymentMethods = []string{"pix"}
		case "boleto":
			paymentMethods = []string{"boleto"}
		case "credit_card", "card":
			paymentMethods = []string{"credit_card"}
		default:
			paymentMethods = []string{pm}
		}
	}

	checkoutReq := abacatepayCheckoutRequest{
		ExternalReference: user.ID.String(),
		Amount:            amount,
		Currency:          "BRL",
		Description:       fmt.Sprintf("Assinatura %s — Uniq Chat", plan.Name),
		PaymentMethods:    paymentMethods,
		Metadata: map[string]string{
			"user_id":   user.ID.String(),
			"plan_id":   plan.ID.String(),
			"plan_name": plan.Name,
		},
		CallbackURL: c.BaseURL() + "/v1/abacatepay/webhook",
	}

	body, _ := json.Marshal(checkoutReq)
	respBytes, err := h.apiRequest("POST", "/checkout", body)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_checkout_failed",
			"message": "Erro ao criar checkout no AbacatePay: " + err.Error(),
		})
	}

	var checkoutResp abacatepayCheckoutResponse
	if err := json.Unmarshal(respBytes, &checkoutResp); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_invalid_response",
			"message": "Resposta inválida do AbacatePay",
		})
	}

	// Guarda referência no user para webhook confirmar.
	h.db.Model(user).Updates(map[string]any{
		"abacatepay_checkout_id": checkoutResp.ID,
	})

	out := fiber.Map{
		"checkout_type":     mode,
		"checkout_id":       checkoutResp.ID,
		"plan_name":         plan.Name,
		"plan_price":        plan.Price,
		"amount_cents":      amount,
		"status":            checkoutResp.Status,
	}

	if mode == "transparent" && checkoutResp.BrCode != "" {
		out["br_code"] = checkoutResp.BrCode
		out["br_code_base64"] = generateQRBase64(checkoutResp.BrCode)
		out["payment_method"] = "pix"
		out["message"] = "QR Code PIX gerado — escaneie com seu banco"
	} else {
		out["payment_link"] = checkoutResp.PaymentLink
		out["payment_method"] = "redirect"
		out["message"] = "Redirecione o usuário para o link de pagamento"
	}

	return c.JSON(out)
}

// POST /abacatepay/subscription — create recurring PIX subscription (protected)
func (h *AbacatePayHandler) CreateSubscriptionCheckout(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	apiKey := h.getAPIKey()
	if apiKey == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error":   "abacatepay_not_configured",
			"message": "AbacatePay não está configurado.",
		})
	}

	var req struct {
		PlanID string `json:"plan_id"`
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

	productID := plan.AbacatepayProductID
	if productID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "no_abacatepay_product",
			"message": "Plano não tem um produto AbacatePay vinculado. Admin deve configurar abacatepay_product_id.",
			"hint":    "Sete abacatepay_product_id no plano ou configure ABACATEPAY_PRODUCT_* no env.",
		})
	}

	subReq := abacatepaySubscriptionRequest{
		PlanID:     productID,
		ExternalID: user.ID.String(),
		CallbackURL: c.BaseURL() + "/v1/abacatepay/webhook",
	}

	body, _ := json.Marshal(subReq)
	respBytes, err := h.apiRequest("POST", "/subscriptions", body)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_subscription_failed",
			"message": "Erro ao criar assinatura: " + err.Error(),
		})
	}

	var subResp abacatepaySubscriptionResponse
	if err := json.Unmarshal(respBytes, &subResp); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_invalid_response",
			"message": "Resposta inválida do AbacatePay",
		})
	}

	// Marca pendente — webhook vai ativar quando confirmar pagamento
	h.db.Model(user).Updates(map[string]any{
		"abacatepay_subscription_id":     subResp.ID,
		"abacatepay_subscription_status": "PENDING_PAYMENT",
	})

	out := fiber.Map{
		"subscription_id":  subResp.ID,
		"plan_name":        plan.Name,
		"plan_price":       plan.Price,
		"status":           subResp.Status,
		"payment_method":   "pix",
		"recurrence":       "MONTHLY",
		"message":          "Assinatura PIX recorrente criada. Pague a primeira fatura pra ativar.",
	}

	if subResp.BrCode != "" {
		out["br_code"] = subResp.BrCode
		out["br_code_base64"] = generateQRBase64(subResp.BrCode)
	}
	if subResp.PaymentLink != "" {
		out["payment_link"] = subResp.PaymentLink
	}

	return c.JSON(out)
}

// POST /abacatepay/qr — gera QR code PIX imediato (payment avulso, sem subscription)
func (h *AbacatePayHandler) CreateQRCode(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	apiKey := h.getAPIKey()
	if apiKey == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error":   "abacatepay_not_configured",
			"message": "AbacatePay não está configurado.",
		})
	}

	var req struct {
		Amount      float64 `json:"amount"`
		Description string  `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Amount <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "amount deve ser maior que zero"})
	}

	amountCents := int64(req.Amount * 100)

	qrReq := abacatepayQRRequest{
		Amount:      amountCents,
		Description: req.Description,
	}

	body, _ := json.Marshal(qrReq)
	respBytes, err := h.apiRequest("POST", "/qrcode", body)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_qr_failed",
			"message": "Erro ao gerar QR Code: " + err.Error(),
		})
	}

	var qrResp struct {
		ID        string `json:"id"`
		BrCode    string `json:"br_code"`
		Amount    int64  `json:"amount"`
		Status    string `json:"status"`
		CreatedAt string `json:"created_at"`
	}
	if err := json.Unmarshal(respBytes, &qrResp); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_invalid_response",
			"message": "Resposta inválida do AbacatePay",
		})
	}

	return c.JSON(fiber.Map{
		"id":            qrResp.ID,
		"br_code":       qrResp.BrCode,
		"br_code_base64": generateQRBase64(qrResp.BrCode),
		"amount_cents":  qrResp.Amount,
		"amount":        req.Amount,
		"status":        qrResp.Status,
	})
}

// POST /abacatepay/webhook — handle AbacatePay webhook events (public)
func (h *AbacatePayHandler) HandleWebhook(c *fiber.Ctx) error {
	payload := c.Body()
	sigHeader := c.Get("X-AbacatePay-Signature")
	webhookSecret := h.getWebhookSecret()

	if webhookSecret == "" {
		log.Warn().Msg("abacatepay webhook recebido sem secret configurado — rejeitando")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "abacatepay webhook secret não configurado",
		})
	}

	// Valida HMAC-SHA256
	if sigHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "assinatura ausente"})
	}

	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write(payload)
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(sigHeader), []byte(expectedSig)) {
		log.Warn().Msg("abacatepay webhook: HMAC inválido")
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "assinatura inválida"})
	}

	var event abacatepayWebhookPayload
	if err := json.Unmarshal(payload, &event); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	// Idempotência
	if event.Data.ID != "" {
		res := h.db.Exec(
			"INSERT INTO processed_webhook_events (event_id, provider, processed_at) VALUES (?, 'abacatepay', ?) ON CONFLICT DO NOTHING",
			event.Data.ID, time.Now(),
		)
		if res.Error == nil && res.RowsAffected == 0 {
			return c.JSON(fiber.Map{"received": true, "duplicate": true})
		}
	}

	switch event.Event {
	case "checkout.paid":
		h.handleCheckoutPaid(&event.Data)
	case "checkout.cancelled", "checkout.expired":
		h.handleCheckoutCancelled(&event.Data)
	case "subscription.activated":
		h.handleSubscriptionActivated(&event.Data)
	case "subscription.cancelled", "subscription.expired":
		h.handleSubscriptionCancelled(&event.Data)
	case "chargeback.payment":
		h.handleChargeback(&event.Data)
	}

	return c.JSON(fiber.Map{"received": true})
}

// handleCheckoutPaid processa checkout pago (único, não recorrente).
// externalReference contém o user_id.
func (h *AbacatePayHandler) handleCheckoutPaid(data *checkoutWebhookData) {
	if data.ExternalReference == "" {
		return
	}

	userID := data.ExternalReference
	var user models.User
	if h.db.First(&user, "id = ?", userID).Error != nil {
		log.Warn().Str("user_id", userID).Msg("abacatepay webhook: user não encontrado")
		return
	}

	// Pega plan_id do metadata se existir
	var planIDStr string
	if data.Metadata != "" {
		var meta map[string]string
		if json.Unmarshal([]byte(data.Metadata), &meta) == nil {
			planIDStr = meta["plan_id"]
		}
	}

	if planIDStr != "" {
		var plan models.Plan
		if h.db.First(&plan, "id = ?", planIDStr).Error == nil {
			h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
				"plan_id":      plan.ID,
				"is_active":    true,
				"role":         models.RoleCustomer,
			})
			go h.emailSvc.SendPaymentConfirmed(user.Email, user.Name, plan.Name, plan.Price)
		}
	}
}

func (h *AbacatePayHandler) handleCheckoutCancelled(data *checkoutWebhookData) {
	if data.ExternalReference == "" {
		return
	}
	log.Info().Str("checkout_id", data.ID).Str("user_id", data.ExternalReference).
		Msg("abacatepay checkout cancelled/expired")
}

func (h *AbacatePayHandler) handleSubscriptionActivated(data *checkoutWebhookData) {
	if data.ExternalReference == "" {
		return
	}

	userID := data.ExternalReference
	var plan models.Plan

	// Tenta buscar plano pelo metadata
	if data.Metadata != "" {
		var meta map[string]string
		if json.Unmarshal([]byte(data.Metadata), &meta) == nil {
			if pid := meta["plan_id"]; pid != "" {
				h.db.First(&plan, "id = ?", pid)
			}
		}
	}

	updates := map[string]interface{}{
		"abacatepay_subscription_status": "active",
		"is_active": true,
		"role":      models.RoleCustomer,
	}

	if plan.ID != uuid.Nil {
		updates["plan_id"] = plan.ID
	}

	h.db.Model(&models.User{}).Where("id = ?", userID).Updates(updates)

	var user models.User
	if h.db.First(&user, "id = ?", userID).Error == nil && plan.ID != uuid.Nil {
		go h.emailSvc.SendPaymentConfirmed(user.Email, user.Name, plan.Name, plan.Price)
	}
}

func (h *AbacatePayHandler) handleSubscriptionCancelled(data *checkoutWebhookData) {
	if data.ExternalReference == "" {
		return
	}

	userID := data.ExternalReference
	var freePlan models.Plan

	if h.db.First(&freePlan, "name = 'Free'").Error == nil {
		h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
			"plan_id":                        freePlan.ID,
			"abacatepay_subscription_id":     "",
			"abacatepay_subscription_status": "canceled",
		})

		var user models.User
		if h.db.First(&user, "id = ?", userID).Error == nil {
			go h.emailSvc.SendSubscriptionCanceled(user.Email, user.Name)
		}
	}
}

func (h *AbacatePayHandler) handleChargeback(data *checkoutWebhookData) {
	if data.ExternalReference == "" {
		return
	}
	log.Warn().Str("checkout_id", data.ID).Str("user_id", data.ExternalReference).
		Msg("abacatepay chargeback detected")
}

// GET /abacatepay/plans — list plans with AbacatePay info (public)
func (h *AbacatePayHandler) ListPlans(c *fiber.Ctx) error {
	var plans []models.Plan
	if err := h.db.Where("is_active = true").Order("price ASC").Find(&plans).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar planos"})
	}
	return c.JSON(plans)
}

// GET /abacatepay/subscription — get subscription status (protected)
func (h *AbacatePayHandler) GetSubscription(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	if user.AbacatepaySubscriptionID == "" {
		return c.JSON(fiber.Map{
			"provider": "abacatepay",
			"has_subscription": false,
			"message": "Nenhuma assinatura AbacatePay encontrada",
		})
	}

	respBytes, err := h.apiRequest("GET", "/subscriptions/"+user.AbacatepaySubscriptionID, nil)
	if err != nil {
		return c.JSON(fiber.Map{
			"provider":           "abacatepay",
			"subscription_id":    user.AbacatepaySubscriptionID,
			"status":             user.AbacatepaySubscriptionStatus,
			"cached":             true,
			"message":            "Status via cache (API indisponível)",
		})
	}

	var subResp abacatepaySubscriptionResponse
	if err := json.Unmarshal(respBytes, &subResp); err != nil {
		return c.JSON(fiber.Map{
			"provider":        "abacatepay",
			"subscription_id": user.AbacatepaySubscriptionID,
			"status":          user.AbacatepaySubscriptionStatus,
			"cached":          true,
		})
	}

	return c.JSON(fiber.Map{
		"provider":        "abacatepay",
		"subscription_id": subResp.ID,
		"status":          subResp.Status,
		"plan_id":         subResp.PlanID,
		"br_code":         subResp.BrCode,
		"payment_link":    subResp.PaymentLink,
	})
}

// GET /abacatepay/test — testa conectividade com a API (protegido, admin)
func (h *AbacatePayHandler) TestConnection(c *fiber.Ctx) error {
	apiKey := h.getAPIKey()
	if apiKey == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "API key não configurada"})
	}

	baseURL := h.abacatepayClient()
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", baseURL+"/v2/ping", nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"ok":    false,
			"error": "erro de rede: " + err.Error(),
		})
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		return c.JSON(fiber.Map{"ok": true, "status": "connected"})
	}

	body, _ := io.ReadAll(resp.Body)
	return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
		"ok":    false,
		"error": fmt.Sprintf("HTTP %d — %s", resp.StatusCode, truncErr(string(body), 200)),
	})
}

// generateQRBase64 gera imagem PNG do QR code a partir do EMV payload.
// Usa uma lib leve de QR code para não adicionar dependência pesada.
func generateQRBase64(brCode string) string {
	// TODO: implementar geração real de QR code PNG e retornar base64.
	// Para MVP, retorna string vazia — o front pode renderizar o brCode
	// como texto copiável e usar uma lib JS (ex: qrcode.js) pra desenhar.
	return ""
}