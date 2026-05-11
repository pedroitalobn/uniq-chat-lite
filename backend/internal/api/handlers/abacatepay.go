package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/qr"
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

// AbacatePay public key for webhook HMAC signature verification.
const abacatepayPublicKey = "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9"

func (h *AbacatePayHandler) abacatepayClient() string {
	var settings models.PaymentSettings
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayEnvironment == "sandbox" {
		return "https://api-sandbox.abacatepay.com"
	}
	return "https://api.abacatepay.com"
}

func (h *AbacatePayHandler) getAPIKey() string {
	var settings models.PaymentSettings
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayAPIKey != "" {
		return settings.AbacatepayAPIKey
	}
	return config.AppConfig.AbacatepayAPIKey
}

func (h *AbacatePayHandler) getWebhookSecret() string {
	var settings models.PaymentSettings
	if h.db.Where("id = ?", "default").First(&settings).Error == nil && settings.AbacatepayWebhookSecret != "" {
		return settings.AbacatepayWebhookSecret
	}
	return config.AppConfig.AbacatepayWebhookSecret
}

func (h *AbacatePayHandler) webhookURL(baseURL string) string {
	u := baseURL + "/v1/abacatepay/webhook"
	secret := h.getWebhookSecret()
	if secret != "" {
		u += "?webhookSecret=" + secret
	}
	return u
}

// CheckoutMode retorna "transparent" ou "redirect" conforme configuração.
func (h *AbacatePayHandler) CheckoutMode() string {
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
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
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

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("erro ao ler resposta: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("abacatepay HTTP %d: %s", resp.StatusCode, truncErr(string(respBytes), 300))
	}

	return respBytes, nil
}

// apiRequestV2 chama apiRequest e desembrulha o envelope v2 {data, error, success}.
func (h *AbacatePayHandler) apiRequestV2(method, path string, body []byte, target interface{}) error {
	respBytes, err := h.apiRequest(method, path, body)
	if err != nil {
		return err
	}

	var envelope struct {
		Data    json.RawMessage `json:"data"`
		Error   *string         `json:"error"`
		Success bool            `json:"success"`
	}
	if err := json.Unmarshal(respBytes, &envelope); err != nil {
		return fmt.Errorf("erro ao decodificar envelope v2: %w", err)
	}

	if envelope.Error != nil && *envelope.Error != "" {
		return fmt.Errorf("abacatepay: %s", *envelope.Error)
	}

	if target != nil && envelope.Data != nil {
		if err := json.Unmarshal(envelope.Data, target); err != nil {
			return fmt.Errorf("erro ao decodificar data v2: %w", err)
		}
	}

	return nil
}

// ─── Types ──────────────────────────────────────────────────────────────────

// AbacatePayCheckoutResult é o retorno unificado de criação de checkout,
// independente do modo (redirect vs transparent).
type AbacatePayCheckoutResult struct {
	ID     string
	URL    string // link de pagamento hospedado (redirect)
	BrCode string // PIX EMV payload (transparent)
	Status string
	Amount int64 // centavos
}

type abacatepayItem struct {
	ID       string `json:"id"`
	Quantity int    `json:"quantity"`
}

// ─── v2 request types

type abacatepayCheckoutCreateRequest struct {
	Items         []abacatepayItem  `json:"items"`
	Methods       []string          `json:"methods"`
	CustomerID    string            `json:"customerId,omitempty"`
	ExternalID    string            `json:"externalId"`
	CompletionURL string            `json:"completionUrl"`
	ReturnURL     string            `json:"returnUrl,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

type abacatepayCustomer struct {
	Name      string            `json:"name,omitempty"`
	Cellphone string            `json:"cellphone,omitempty"`
	Email     string            `json:"email"`
	TaxID     string            `json:"taxId,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type abacatepayCustomerResponse struct {
	ID string `json:"id"`
}

type abacatepayCheckoutCreateResponse struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

type abacatepayTransparentRequest struct {
	Method string                    `json:"method"`
	Data   abacatepayTransparentData `json:"data"`
}

type abacatepayTransparentData struct {
	Amount      int64               `json:"amount"`
	Description string              `json:"description"`
	ExternalID  string              `json:"externalId"`
	Customer    *abacatepayCustomer `json:"customer,omitempty"`
	Metadata    map[string]string   `json:"metadata,omitempty"`
	ExpiresIn   int                 `json:"expiresIn,omitempty"`
}

type abacatepayTransparentResponse struct {
	ID        string `json:"id"`
	BrCode    string `json:"brCode"`
	Status    string `json:"status"`
	Amount    int64  `json:"amount"`
	CreatedAt string `json:"createdAt"`
}

type abacatepaySubscriptionCreateRequest struct {
	Items         []abacatepayItem `json:"items"`
	CustomerID    string           `json:"customerId,omitempty"`
	ExternalID    string           `json:"externalId"`
	CompletionURL string           `json:"completionUrl"`
	ReturnURL     string           `json:"returnUrl,omitempty"`
	Methods       []string         `json:"methods,omitempty"`
}

type abacatepaySubscriptionResponse struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	URL       string `json:"url,omitempty"`
	BrCode    string `json:"brCode,omitempty"`
	CreatedAt string `json:"createdAt"`
}

// ─── Webhook ────────────────────────────────────────────────────────────────

type abacatepayWebhookPayload struct {
	ID         string              `json:"id"`
	Event      string              `json:"event"`
	APIVersion int                 `json:"apiVersion"`
	DevMode    bool                `json:"devMode"`
	Data       checkoutWebhookData `json:"data"`
}

type checkoutWebhookData struct {
	ID                string `json:"id"`
	ExternalReference string `json:"external_reference"`
	ExternalID        string `json:"externalId"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Status            string `json:"status"`
	PaymentMethod     string `json:"payment_method"`
	PaidAt            string `json:"paid_at"`
	Metadata          string `json:"metadata"`
}

func (d *checkoutWebhookData) refID() string {
	if d.ExternalReference != "" {
		return d.ExternalReference
	}
	return d.ExternalID
}

func (h *AbacatePayHandler) abacatepayCustomerFromPending(p *models.PendingRegistration, metadata map[string]string) *abacatepayCustomer {
	if p == nil || strings.TrimSpace(p.Email) == "" {
		return nil
	}
	return &abacatepayCustomer{
		Name:      strings.TrimSpace(p.Name),
		Cellphone: formatAbacatePayCellphone(p.Phone),
		Email:     strings.TrimSpace(p.Email),
		TaxID:     formatAbacatePayTaxID(p.TaxID),
		Metadata:  metadata,
	}
}

func (h *AbacatePayHandler) abacatepayCustomerFromUser(u *models.User, metadata map[string]string) *abacatepayCustomer {
	if u == nil || strings.TrimSpace(u.Email) == "" {
		return nil
	}
	return &abacatepayCustomer{
		Name:      strings.TrimSpace(u.Name),
		Cellphone: formatAbacatePayCellphone(u.Phone),
		Email:     strings.TrimSpace(u.Email),
		TaxID:     formatAbacatePayTaxID(u.TaxID),
		Metadata:  metadata,
	}
}

func formatAbacatePayCellphone(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return ""
	}
	if strings.HasPrefix(phone, "+") {
		return phone
	}
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if digits == "" {
		return ""
	}
	return "+" + digits
}

func formatAbacatePayTaxID(taxID string) string {
	var b strings.Builder
	for _, r := range taxID {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	// AbacatePay valida taxId como CPF/CNPJ. Para IDs internacionais
	// (SSN/EIN/ITIN etc), mantemos no nosso cadastro mas não enviamos ao
	// provider brasileiro para não rejeitar o checkout.
	if len(digits) == 11 || len(digits) == 14 {
		return digits
	}
	return ""
}

func (h *AbacatePayHandler) ensureAbacatePayCustomer(customer *abacatepayCustomer) (string, error) {
	if customer == nil || strings.TrimSpace(customer.Email) == "" {
		return "", nil
	}
	body, _ := json.Marshal(customer)
	var resp abacatepayCustomerResponse
	if err := h.apiRequestV2("POST", "/customers/create", body, &resp); err != nil {
		// taxId é útil para CPF/CNPJ, mas não pode impedir o checkout se
		// o provider recusar o documento. Retentamos com nome/e-mail/celular.
		if strings.TrimSpace(customer.TaxID) != "" {
			retry := *customer
			retry.TaxID = ""
			body, _ = json.Marshal(retry)
			resp = abacatepayCustomerResponse{}
			if retryErr := h.apiRequestV2("POST", "/customers/create", body, &resp); retryErr == nil {
				return resp.ID, nil
			}
		}
		return "", err
	}
	return resp.ID, nil
}

func abacatepayFrontendBaseURL(fallbackBaseURL string) string {
	if frontendURL := resolveFrontendURL(); frontendURL != "" {
		return frontendURL
	}
	return strings.TrimRight(fallbackBaseURL, "/")
}

func abacatepayPendingSuccessURL(fallbackBaseURL, pendingID string) string {
	u := abacatepayFrontendBaseURL(fallbackBaseURL) + "/payment/success"
	if strings.TrimSpace(pendingID) != "" {
		u += "?pending_id=" + url.QueryEscape(pendingID)
	}
	return u
}

func abacatepayDashboardURL(fallbackBaseURL string) string {
	return abacatepayFrontendBaseURL(fallbackBaseURL) + "/dashboard"
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

	mode := h.CheckoutMode()
	customer := h.abacatepayCustomerFromUser(user, map[string]string{
		"user_id": user.ID.String(),
		"plan_id": plan.ID.String(),
	})

	successURL := abacatepayDashboardURL(c.BaseURL())
	result, err := h.createCheckout(plan, user.ID.String(), map[string]string{
		"user_id":   user.ID.String(),
		"plan_id":   plan.ID.String(),
		"plan_name": plan.Name,
		"email":     user.Email,
		"name":      user.Name,
		"phone":     user.Phone,
		"tax_id":    user.TaxID,
	}, customer, successURL, successURL, mode)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_checkout_failed",
			"message": "Erro ao criar checkout no AbacatePay: " + err.Error(),
		})
	}

	h.db.Model(user).Updates(map[string]any{
		"abacatepay_checkout_id": result.ID,
	})

	return c.JSON(h.buildCheckoutResponse(result, plan, mode))
}

// CreateCheckoutForPending cria um checkout AbacatePay para uma
// PendingRegistration, sem requerer usuário autenticado.
func (h *AbacatePayHandler) CreateCheckoutForPending(pending *models.PendingRegistration, plan *models.Plan, baseURL string) (*AbacatePayCheckoutResult, error) {
	apiKey := h.getAPIKey()
	if apiKey == "" {
		return nil, fmt.Errorf("abacatepay não configurado")
	}

	mode := h.CheckoutMode()
	amount := int64(plan.Price * 100)

	customer := h.abacatepayCustomerFromPending(pending, map[string]string{
		"pending_id": pending.ID.String(),
		"plan_id":    plan.ID.String(),
	})

	successURL := abacatepayPendingSuccessURL(baseURL, pending.ID.String())
	returnURL := abacatepayFrontendBaseURL(baseURL) + "/register/verify?token=" + url.QueryEscape(pending.Token)
	result, err := h.createCheckout(*plan, pending.ID.String(), map[string]string{
		"pending_id": pending.ID.String(),
		"plan_id":    plan.ID.String(),
		"plan_name":  plan.Name,
		"email":      pending.Email,
		"name":       pending.Name,
		"phone":      pending.Phone,
		"tax_id":     pending.TaxID,
	}, customer, successURL, returnURL, mode)
	if err != nil {
		return nil, err
	}

	// Guarda o checkout ID no pending pra webhook/fallback identificar.
	pending.AbaCustID = result.ID
	h.db.Model(pending).Update("aba_cust_id", result.ID)

	result.Amount = amount
	return result, nil
}

// createCheckout é o método interno que chama a API v2 correta conforme o modo.
func (h *AbacatePayHandler) createCheckout(plan models.Plan, externalID string, metadata map[string]string, customer *abacatepayCustomer, completionURL string, returnURL string, mode string) (*AbacatePayCheckoutResult, error) {
	switch mode {
	case "transparent":
		return h.createTransparentCheckout(plan, externalID, metadata, customer)
	default:
		return h.createRedirectCheckout(plan, externalID, metadata, customer, completionURL, returnURL)
	}
}

func (h *AbacatePayHandler) createRedirectCheckout(plan models.Plan, externalID string, metadata map[string]string, customer *abacatepayCustomer, completionURL string, returnURL string) (*AbacatePayCheckoutResult, error) {
	productID := plan.AbacatepayProductID
	if productID == "" {
		return nil, fmt.Errorf("plano não tem abacatepay_product_id configurado — necessário para checkout redirect")
	}

	customerID, err := h.ensureAbacatePayCustomer(customer)
	if err != nil {
		return nil, fmt.Errorf("erro ao criar cliente: %w", err)
	}

	req := abacatepayCheckoutCreateRequest{
		Items: []abacatepayItem{
			{ID: productID, Quantity: 1},
		},
		Methods:       []string{"CARD"},
		CustomerID:    customerID,
		ExternalID:    externalID,
		CompletionURL: completionURL,
		ReturnURL:     returnURL,
		Metadata:      metadata,
	}

	body, _ := json.Marshal(req)
	var resp abacatepayCheckoutCreateResponse
	if err := h.apiRequestV2("POST", "/checkouts/create", body, &resp); err != nil {
		return nil, fmt.Errorf("erro ao criar checkout: %w", err)
	}

	if resp.ID == "" {
		return nil, fmt.Errorf("checkout response sem ID — possivelmente API key inválida")
	}

	return &AbacatePayCheckoutResult{
		ID:     resp.ID,
		URL:    resp.URL,
		Status: resp.Status,
	}, nil
}

func (h *AbacatePayHandler) createTransparentCheckout(plan models.Plan, externalID string, metadata map[string]string, customer *abacatepayCustomer) (*AbacatePayCheckoutResult, error) {
	amount := int64(plan.Price * 100)

	req := abacatepayTransparentRequest{
		Method: "PIX",
		Data: abacatepayTransparentData{
			Amount:      amount,
			Description: fmt.Sprintf("Assinatura %s — Uniq Chat", plan.Name),
			ExternalID:  externalID,
			Customer:    customer,
			Metadata:    metadata,
			ExpiresIn:   3600,
		},
	}

	body, _ := json.Marshal(req)
	var resp abacatepayTransparentResponse
	if err := h.apiRequestV2("POST", "/transparents/create", body, &resp); err != nil {
		return nil, fmt.Errorf("erro ao criar PIX: %w", err)
	}

	if resp.ID == "" {
		return nil, fmt.Errorf("transparent response sem ID — possivelmente API key inválida")
	}

	return &AbacatePayCheckoutResult{
		ID:     resp.ID,
		BrCode: resp.BrCode,
		Status: resp.Status,
		Amount: resp.Amount,
	}, nil
}

func (h *AbacatePayHandler) buildCheckoutResponse(result *AbacatePayCheckoutResult, plan models.Plan, mode string) fiber.Map {
	amount := result.Amount
	if amount == 0 {
		amount = int64(plan.Price * 100)
	}

	out := fiber.Map{
		"checkout_type": mode,
		"checkout_id":   result.ID,
		"plan_name":     plan.Name,
		"plan_price":    plan.Price,
		"amount_cents":  amount,
		"status":        result.Status,
	}

	if mode == "transparent" && result.BrCode != "" {
		out["br_code"] = result.BrCode
		out["br_code_base64"] = generateQRBase64(result.BrCode)
		out["payment_method"] = "pix"
		out["message"] = "QR Code PIX gerado — escaneie com seu banco"
	} else {
		out["url"] = result.URL
		out["payment_link"] = result.URL
		out["payment_method"] = "redirect"
		out["message"] = "Redirecione o usuário para o link de pagamento"
	}

	return out
}

// HandleReturn keeps old AbacatePay links from landing on a JSON-only webhook URL.
// New checkouts use completionUrl/returnUrl pointing directly to the frontend.
func (h *AbacatePayHandler) HandleReturn(c *fiber.Ctx) error {
	return c.Redirect(abacatepayPendingSuccessURL(c.BaseURL(), c.Query("pending_id")), fiber.StatusFound)
}

// POST /abacatepay/subscription — create recurring subscription (protected)
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
		})
	}

	subReq := abacatepaySubscriptionCreateRequest{
		Items: []abacatepayItem{
			{ID: productID, Quantity: 1},
		},
		ExternalID:    user.ID.String(),
		CompletionURL: abacatepayDashboardURL(c.BaseURL()),
		ReturnURL:     abacatepayDashboardURL(c.BaseURL()),
		Methods:       []string{"CARD"},
	}

	body, _ := json.Marshal(subReq)
	var subResp abacatepaySubscriptionResponse
	if err := h.apiRequestV2("POST", "/subscriptions/create", body, &subResp); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_subscription_failed",
			"message": "Erro ao criar assinatura: " + err.Error(),
		})
	}

	h.db.Model(user).Updates(map[string]any{
		"abacatepay_subscription_id":     subResp.ID,
		"abacatepay_subscription_status": "PENDING_PAYMENT",
	})

	out := fiber.Map{
		"subscription_id": subResp.ID,
		"plan_name":       plan.Name,
		"plan_price":      plan.Price,
		"status":          subResp.Status,
		"payment_method":  "pix",
		"recurrence":      "MONTHLY",
		"message":         "Assinatura criada. Pague a primeira fatura pra ativar.",
	}

	if subResp.BrCode != "" {
		out["br_code"] = subResp.BrCode
		out["br_code_base64"] = generateQRBase64(subResp.BrCode)
	}
	if subResp.URL != "" {
		out["payment_link"] = subResp.URL
	}

	return c.JSON(out)
}

// POST /abacatepay/qr — gera QR code PIX avulso (sem subscription)
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

	qrReq := abacatepayTransparentRequest{
		Method: "PIX",
		Data: abacatepayTransparentData{
			Amount:      amountCents,
			Description: req.Description,
			ExternalID:  user.ID.String(),
		},
	}

	body, _ := json.Marshal(qrReq)
	var qrResp abacatepayTransparentResponse
	if err := h.apiRequestV2("POST", "/transparents/create", body, &qrResp); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "abacatepay_qr_failed",
			"message": "Erro ao gerar QR Code: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"id":             qrResp.ID,
		"br_code":        qrResp.BrCode,
		"br_code_base64": generateQRBase64(qrResp.BrCode),
		"amount_cents":   qrResp.Amount,
		"amount":         req.Amount,
		"status":         qrResp.Status,
	})
}

// ─── Webhook ────────────────────────────────────────────────────────────────

func (h *AbacatePayHandler) HandleWebhook(c *fiber.Ctx) error {
	querySecret := c.Query("webhookSecret")
	webhookSecret := h.getWebhookSecret()

	if webhookSecret == "" {
		log.Warn().Msg("abacatepay webhook: secret não configurado no servidor")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "abacatepay webhook secret não configurado",
		})
	}

	if querySecret != webhookSecret {
		log.Warn().Msg("abacatepay webhook: query param webhookSecret inválido")
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "secret inválido"})
	}

	payload := c.Body()
	sigHeader := c.Get("X-Webhook-Signature")
	if sigHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "assinatura ausente"})
	}

	mac := hmac.New(sha256.New, []byte(abacatepayPublicKey))
	mac.Write(payload)
	expectedSig := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	if subtle.ConstantTimeCompare([]byte(sigHeader), []byte(expectedSig)) != 1 {
		log.Warn().Msg("abacatepay webhook: HMAC inválido")
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "assinatura inválida"})
	}

	var event abacatepayWebhookPayload
	if err := json.Unmarshal(payload, &event); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	if event.ID != "" {
		res := h.db.Exec(
			"INSERT INTO processed_webhook_events (event_id, provider, processed_at) VALUES (?, 'abacatepay', ?) ON CONFLICT DO NOTHING",
			event.ID, time.Now(),
		)
		if res.Error == nil && res.RowsAffected == 0 {
			return c.JSON(fiber.Map{"received": true, "duplicate": true})
		}
	}

	switch event.Event {
	case "checkout.completed", "transparent.completed":
		h.handleCheckoutPaid(&event.Data)
	case "checkout.refunded", "checkout.disputed",
		"transparent.refunded", "transparent.disputed":
		h.handleCheckoutCancelled(&event.Data)
	case "subscription.completed":
		h.handleSubscriptionActivated(&event.Data)
	case "subscription.cancelled":
		h.handleSubscriptionCancelled(&event.Data)
	case "subscription.renewed":
		h.handleSubscriptionRenewed(&event.Data)
	}

	return c.JSON(fiber.Map{"received": true})
}

func (h *AbacatePayHandler) handleCheckoutPaid(data *checkoutWebhookData) {
	ref := data.refID()
	if ref == "" {
		return
	}

	var meta map[string]string
	if data.Metadata != "" {
		json.Unmarshal([]byte(data.Metadata), &meta)
	}

	if meta != nil && meta["pending_id"] != "" {
		h.materializePendingRegistration(meta["pending_id"], meta["plan_id"])
		return
	}

	userID := ref
	var user models.User
	if h.db.First(&user, "id = ?", userID).Error != nil {
		log.Warn().Str("user_id", userID).Msg("abacatepay webhook: user não encontrado")
		return
	}

	planIDStr := meta["plan_id"]
	if planIDStr != "" {
		var plan models.Plan
		if h.db.First(&plan, "id = ?", planIDStr).Error == nil {
			oldPlanID := user.PlanID
			h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
				"plan_id":   plan.ID,
				"is_active": true,
				"role":      models.RoleCustomer,
			})
			h.db.Create(&models.PlanChangeLog{
				UserID:       user.ID,
				FromPlanID:   oldPlanID,
				ToPlanID:     &plan.ID,
				FromPlanName: "",
				ToPlanName:   plan.Name,
				Source:       models.PlanChangeSourceAbacatepay,
			})
			h.sendPaymentConfirmedAsync(user.Email, user.Name, plan.Name, plan.Price)
		}
	}
}

func (h *AbacatePayHandler) materializePendingRegistration(pendingIDStr, planIDStr string) {
	pendingID, err := uuid.Parse(pendingIDStr)
	if err != nil {
		return
	}
	var pending models.PendingRegistration
	if err := h.db.First(&pending, "id = ?", pendingID).Error; err != nil {
		return
	}
	if pending.Name == "" || pending.PasswordHash == "" {
		return
	}

	now := time.Now()
	res := h.db.Model(&models.PendingRegistration{}).
		Where("id = ? AND completed_at IS NULL", pendingID).
		Update("completed_at", now)
	if res.Error != nil || res.RowsAffected == 0 {
		return
	}
	pending.CompletedAt = &now

	planID, _ := uuid.Parse(planIDStr)
	var plan models.Plan
	hasPlan := false
	if planID != uuid.Nil {
		if h.db.First(&plan, "id = ?", planID).Error == nil {
			hasPlan = true
		}
	}

	user := models.User{
		Name:         pending.Name,
		Email:        pending.Email,
		Phone:        pending.Phone,
		TaxID:        pending.TaxID,
		Role:         models.RoleCustomer,
		IsActive:     true,
		PasswordHash: pending.PasswordHash,
	}
	if pending.Username != "" {
		u := pending.Username
		user.Username = &u
	}
	if hasPlan {
		user.PlanID = &plan.ID
	}
	if err := h.db.Create(&user).Error; err != nil {
		return
	}

	if pending.InviteCode != "" {
		MarkInviteCodeUsed(h.db, pending.InviteCode, user.ID)
	}

	wsName := pending.WorkspaceName
	if wsName == "" {
		first := strings.Fields(pending.Name)
		if len(first) > 0 {
			wsName = first[0] + "'s Workspace"
		} else {
			wsName = "Meu Workspace"
		}
	}
	if ws := createDefaultWorkspace(h.db, &user, wsName); ws == nil {
		log.Error().Str("user_id", user.ID.String()).Str("workspace_name", wsName).
			Msg("abacatepay materializePendingRegistration: createDefaultWorkspace falhou")
	}

	if hasPlan {
		h.db.Create(&models.PlanChangeLog{
			UserID:     user.ID,
			ToPlanID:   &plan.ID,
			ToPlanName: plan.Name,
			Source:     models.PlanChangeSourceAbacatepay,
			Notes:      "materializado via webhook abacatepay",
		})
		h.sendPaymentConfirmedAsync(user.Email, user.Name, plan.Name, plan.Price)
	}
	go h.emailSvc.SendWelcome(user.Email, user.Name)
}

func (h *AbacatePayHandler) handleCheckoutCancelled(data *checkoutWebhookData) {
	if data.refID() == "" {
		return
	}
	log.Info().Str("checkout_id", data.ID).Str("ref", data.refID()).
		Msg("abacatepay checkout cancelled/expired")
}

func (h *AbacatePayHandler) handleSubscriptionActivated(data *checkoutWebhookData) {
	ref := data.refID()
	if ref == "" {
		return
	}

	userID := ref
	var plan models.Plan

	if data.Metadata != "" {
		var meta map[string]string
		if json.Unmarshal([]byte(data.Metadata), &meta) == nil {
			if pid := meta["plan_id"]; pid != "" {
				h.db.First(&plan, "id = ?", pid)
			}
		}
	}

	var user models.User
	h.db.First(&user, "id = ?", userID)

	updates := map[string]interface{}{
		"abacatepay_subscription_status": "active",
		"is_active":                      true,
		"role":                           models.RoleCustomer,
	}

	oldPlanID := user.PlanID
	if plan.ID != uuid.Nil {
		updates["plan_id"] = plan.ID
	}

	h.db.Model(&models.User{}).Where("id = ?", userID).Updates(updates)

	if plan.ID != uuid.Nil {
		h.db.Create(&models.PlanChangeLog{
			UserID:     user.ID,
			FromPlanID: oldPlanID,
			ToPlanID:   &plan.ID,
			ToPlanName: plan.Name,
			Source:     models.PlanChangeSourceAbacatepay,
		})
		h.sendPaymentConfirmedAsync(user.Email, user.Name, plan.Name, plan.Price)
	}
}

func (h *AbacatePayHandler) handleSubscriptionRenewed(data *checkoutWebhookData) {
	if data.refID() == "" {
		return
	}
	log.Info().Str("subscription_id", data.ID).Str("ref", data.refID()).
		Msg("abacatepay subscription renewed")
}

func (h *AbacatePayHandler) handleSubscriptionCancelled(data *checkoutWebhookData) {
	ref := data.refID()
	if ref == "" {
		return
	}

	userID := ref
	var freePlan models.Plan

	if h.db.First(&freePlan, "name = 'Free'").Error == nil {
		var user models.User
		h.db.First(&user, "id = ?", userID)
		oldPlanID := user.PlanID

		h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
			"plan_id":                        freePlan.ID,
			"abacatepay_subscription_id":     "",
			"abacatepay_subscription_status": "canceled",
		})

		h.db.Create(&models.PlanChangeLog{
			UserID:     user.ID,
			FromPlanID: oldPlanID,
			ToPlanID:   &freePlan.ID,
			ToPlanName: freePlan.Name,
			Source:     models.PlanChangeSourceAbacatepay,
		})

		go h.emailSvc.SendSubscriptionCanceled(user.Email, user.Name)
	}
}

// ─── Read endpoints ─────────────────────────────────────────────────────────

func (h *AbacatePayHandler) ListPlans(c *fiber.Ctx) error {
	var plans []models.Plan
	if err := h.db.Where("is_active = true").Order("price ASC").Find(&plans).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar planos"})
	}
	return c.JSON(plans)
}

func (h *AbacatePayHandler) GetSubscription(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	if user.AbacatepaySubscriptionID == "" {
		return c.JSON(fiber.Map{
			"provider":         "abacatepay",
			"has_subscription": false,
			"message":          "Nenhuma assinatura AbacatePay encontrada",
		})
	}

	var subResp abacatepaySubscriptionResponse
	if err := h.apiRequestV2("GET", "/subscriptions/"+user.AbacatepaySubscriptionID, nil, &subResp); err != nil {
		return c.JSON(fiber.Map{
			"provider":        "abacatepay",
			"subscription_id": user.AbacatepaySubscriptionID,
			"status":          user.AbacatepaySubscriptionStatus,
			"cached":          true,
			"message":         "Status via cache (API indisponível)",
		})
	}

	return c.JSON(fiber.Map{
		"provider":        "abacatepay",
		"subscription_id": subResp.ID,
		"status":          subResp.Status,
		"br_code":         subResp.BrCode,
		"payment_link":    subResp.URL,
	})
}

func (h *AbacatePayHandler) GetCheckoutStatus(checkoutID string) (status string, paid bool, err error) {
	var resp struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	escapedID := url.QueryEscape(checkoutID)
	err = h.apiRequestV2("GET", "/transparents/check?id="+escapedID, nil, &resp)
	if err != nil {
		err = h.apiRequestV2("GET", "/checkouts/get?id="+escapedID, nil, &resp)
	}
	if err != nil {
		return "", false, fmt.Errorf("erro ao consultar checkout: %w", err)
	}

	return resp.Status, abacatepayPaidStatus(resp.Status), nil
}

func abacatepayPaidStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PAID", "COMPLETED", "APPROVED":
		return true
	default:
		return false
	}
}

func (h *AbacatePayHandler) sendPaymentConfirmedAsync(to, name, planName string, amount float64) {
	if h.emailSvc == nil {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Error().Interface("panic", r).Str("to", to).Msg("abacatepay email: SendPaymentConfirmed panic")
			}
		}()
		h.emailSvc.SendPaymentConfirmed(to, name, planName, amount)
	}()
}

func (h *AbacatePayHandler) TestConnection(c *fiber.Ctx) error {
	apiKey := h.getAPIKey()
	if apiKey == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "API key não configurada"})
	}

	baseURL := h.abacatepayClient()
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", baseURL+"/v2/products/list?limit=1", nil)
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

func generateQRBase64(brCode string) string {
	matrix, err := qr.Encode(brCode, qr.M, qr.Auto)
	if err != nil {
		log.Error().Err(err).Str("brCode", brCode).Msg("falha ao gerar QR code PIX")
		return ""
	}
	// Scale para tamanho legível (quiet zone de 4 módulos já incluída pelo encoder)
	matrix, err = barcode.Scale(matrix, 256, 256)
	if err != nil {
		log.Error().Err(err).Msg("falha ao escalar QR code PIX")
		return ""
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, matrix); err != nil {
		log.Error().Err(err).Msg("falha ao codificar PNG do QR code PIX")
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}
