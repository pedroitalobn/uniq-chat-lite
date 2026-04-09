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

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (p *PaymentSettings) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}
