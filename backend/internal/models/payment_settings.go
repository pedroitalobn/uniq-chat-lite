package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PaymentProvider enum
type PaymentProvider string

const (
	PaymentProviderStripe  PaymentProvider = "stripe"
	PaymentProviderAsaas   PaymentProvider = "asaas"
	PaymentProviderHotmart PaymentProvider = "hotmart"
)

// PaymentSettings holds global payment provider configuration
type PaymentSettings struct {
	ID             string          `gorm:"type:text;primaryKey" json:"id"`
	ActiveProvider PaymentProvider `gorm:"type:varchar(20);default:'stripe'" json:"active_provider"`

	// Stripe
	StripeSecretKey     string `gorm:"type:text" json:"stripe_secret_key,omitempty"`
	StripeWebhookSecret string `gorm:"type:text" json:"stripe_webhook_secret,omitempty"`
	StripeCheckoutType  string `gorm:"type:varchar(20);default:'redirect'" json:"stripe_checkout_type"`

	// Asaas
	AsaasAPIKey        string `gorm:"type:text" json:"asaas_api_key,omitempty"`
	AsaasWebhookSecret string `gorm:"type:text" json:"asaas_webhook_secret,omitempty"`
	AsaasEnvironment   string `gorm:"type:varchar(20);default:'sandbox'" json:"asaas_environment"`
	AsaasCheckoutType  string `gorm:"type:varchar(20);default:'transparent'" json:"asaas_checkout_type"`

	// Hotmart (reserved for future)
	HotmartAPIKey        string `gorm:"type:text" json:"hotmart_api_key,omitempty"`
	HotmartWebhookSecret string `gorm:"type:text" json:"hotmart_webhook_secret,omitempty"`

	// Status do último teste de conectividade por provider. UI usa pra
	// distinguir "credencial salva no DB" vs "credencial valida que o
	// provider aceita". Antes a UI mostrava "configurado ✓" só porque
	// o secret_key existia no DB — mesmo que fosse inválido. Setado por
	// PUT /admin/payment-settings (auto-test) e POST /admin/payment-settings/test/:provider.
	// Valores: "" (nunca testado) | "ok" | "failed"
	StripeTestStatus    string     `gorm:"type:varchar(20)" json:"stripe_test_status,omitempty"`
	StripeTestedAt      *time.Time `json:"stripe_tested_at,omitempty"`
	StripeTestError     string     `gorm:"type:text" json:"stripe_test_error,omitempty"`
	AsaasTestStatus     string     `gorm:"type:varchar(20)" json:"asaas_test_status,omitempty"`
	AsaasTestedAt       *time.Time `json:"asaas_tested_at,omitempty"`
	AsaasTestError      string     `gorm:"type:text" json:"asaas_test_error,omitempty"`
	HotmartTestStatus   string     `gorm:"type:varchar(20)" json:"hotmart_test_status,omitempty"`
	HotmartTestedAt     *time.Time `json:"hotmart_tested_at,omitempty"`
	HotmartTestError    string     `gorm:"type:text" json:"hotmart_test_error,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (p *PaymentSettings) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}
