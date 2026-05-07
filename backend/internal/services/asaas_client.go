package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// AsaasClient encapsula chamadas REST pra Asaas. Reutilizável fora do
// handler asaas.go (billing/upgrade/cancel precisam disso).
//
// Resolve baseURL e API key de PaymentSettings (DB) com fallback pra
// config.AppConfig (env) — mesma lógica do handler original.
type AsaasClient struct {
	db *gorm.DB
}

func NewAsaasClient(db *gorm.DB) *AsaasClient {
	return &AsaasClient{db: db}
}

func (c *AsaasClient) baseURL() string {
	var settings models.PaymentSettings
	env := config.AppConfig.AsaasEnvironment
	if err := c.db.First(&settings).Error; err == nil && settings.AsaasEnvironment != "" {
		env = settings.AsaasEnvironment
	}
	if env == "production" {
		return "https://www.asaas.com"
	}
	return "https://sandbox.asaas.com"
}

func (c *AsaasClient) apiKey() string {
	var settings models.PaymentSettings
	if err := c.db.First(&settings).Error; err == nil && settings.AsaasAPIKey != "" {
		return settings.AsaasAPIKey
	}
	return config.AppConfig.AsaasAPIKey
}

// Request faz a chamada REST e devolve o body. statusCode é separado
// pra caller decidir como tratar 4xx/5xx (Asaas devolve mensagem útil
// no body que vale repassar pra UI).
func (c *AsaasClient) Request(method, endpoint string, body []byte) (statusCode int, respBody []byte, err error) {
	url := c.baseURL() + endpoint
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	// Asaas aceita o token nos dois formatos (legacy access_token +
	// Bearer mais novo). Mandar os dois é seguro e cobre contas que
	// só aceitam um deles.
	apiKey := c.apiKey()
	req.Header.Set("access_token", apiKey)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("User-Agent", "uniq-chat/1.0")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	respBody, err = io.ReadAll(resp.Body)
	return resp.StatusCode, respBody, err
}

// ─── Tipagens dos endpoints relevantes pra billing ────────────────────

type AsaasSubscription struct {
	ID            string  `json:"id"`
	Customer      string  `json:"customer"`
	Value         float64 `json:"value"`
	NextDueDate   string  `json:"nextDueDate"`   // YYYY-MM-DD
	Cycle         string  `json:"cycle"`         // MONTHLY
	Status        string  `json:"status"`        // ACTIVE / EXPIRED / etc
	BillingType   string  `json:"billingType"`   // CREDIT_CARD / BOLETO / PIX
	Description   string  `json:"description,omitempty"`
}

type AsaasSubscriptionUpdate struct {
	Value       *float64 `json:"value,omitempty"`
	NextDueDate string   `json:"nextDueDate,omitempty"`
	Description string   `json:"description,omitempty"`
}

type AsaasPaymentRequest struct {
	Customer    string  `json:"customer"`
	BillingType string  `json:"billingType"` // CREDIT_CARD / BOLETO / PIX / UNDEFINED
	Value       float64 `json:"value"`
	DueDate     string  `json:"dueDate"`     // YYYY-MM-DD
	Description string  `json:"description"`
	ExternalReference string `json:"externalReference,omitempty"`
}

type AsaasPaymentResponse struct {
	ID         string  `json:"id"`
	Status     string  `json:"status"`
	Value      float64 `json:"value"`
	InvoiceURL string  `json:"invoiceUrl"`
	BankSlipURL string `json:"bankSlipUrl"`
}

// ─── Operations ──────────────────────────────────────────────────────

// GetSubscription — GET /api/v3/subscriptions/:id
func (c *AsaasClient) GetSubscription(id string) (*AsaasSubscription, error) {
	status, body, err := c.Request("GET", "/api/v3/subscriptions/"+id, nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("asaas %d: %s", status, string(body))
	}
	var sub AsaasSubscription
	if err := json.Unmarshal(body, &sub); err != nil {
		return nil, err
	}
	return &sub, nil
}

// UpdateSubscription — POST /api/v3/subscriptions/:id (Asaas usa POST pra update)
func (c *AsaasClient) UpdateSubscription(id string, patch AsaasSubscriptionUpdate) (*AsaasSubscription, error) {
	body, err := json.Marshal(patch)
	if err != nil {
		return nil, err
	}
	status, resp, err := c.Request("POST", "/api/v3/subscriptions/"+id, body)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("asaas update %d: %s", status, string(resp))
	}
	var sub AsaasSubscription
	if err := json.Unmarshal(resp, &sub); err != nil {
		return nil, err
	}
	return &sub, nil
}

// DeleteSubscription — DELETE /api/v3/subscriptions/:id (cancela imediatamente)
func (c *AsaasClient) DeleteSubscription(id string) error {
	status, body, err := c.Request("DELETE", "/api/v3/subscriptions/"+id, nil)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("asaas delete %d: %s", status, string(body))
	}
	return nil
}

// CreatePayment — POST /api/v3/payments (cobrança avulsa, não recorrente).
// Usado pra cobrar a diferença prorated num upgrade.
func (c *AsaasClient) CreatePayment(req AsaasPaymentRequest) (*AsaasPaymentResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	status, resp, err := c.Request("POST", "/api/v3/payments", body)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("asaas payment %d: %s", status, string(resp))
	}
	var payment AsaasPaymentResponse
	if err := json.Unmarshal(resp, &payment); err != nil {
		return nil, err
	}
	return &payment, nil
}

// CalculateProration — calcula o valor prorated (centavos) pra trocar de
// plano dentro do ciclo. Retorna positivo se cobrar, negativo se creditar.
//
// Lógica: (price_novo - price_velho) * dias_restantes / dias_ciclo
// Ciclo Asaas é MENSAL → 30 dias. nextDueDate da sub atual marca o fim.
func CalculateAsaasProration(oldPrice, newPrice float64, nextDueDate time.Time) int64 {
	now := time.Now()
	if !nextDueDate.After(now) {
		return 0 // sub vencida — sem proration, vai pro novo ciclo
	}
	remainingDays := nextDueDate.Sub(now).Hours() / 24
	cycleDays := 30.0
	if remainingDays > cycleDays {
		remainingDays = cycleDays
	}
	delta := (newPrice - oldPrice) * (remainingDays / cycleDays)
	return int64(delta * 100)
}
