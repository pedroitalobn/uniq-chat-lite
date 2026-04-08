package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type PaymentHandler struct {
	db      *gorm.DB
	stripeH *StripeHandler
	asaasH  *AsaasHandler
}

func NewPaymentHandler(db *gorm.DB, stripeH *StripeHandler, asaasH *AsaasHandler) *PaymentHandler {
	return &PaymentHandler{db: db, stripeH: stripeH, asaasH: asaasH}
}

// getActiveProvider returns the active provider saved in the DB, defaulting to stripe
func (h *PaymentHandler) getActiveProvider() string {
	var settings models.PaymentSettings
	if err := h.db.First(&settings).Error; err == nil && settings.ActiveProvider != "" {
		return string(settings.ActiveProvider)
	}
	return string(models.PaymentProviderStripe) // default
}

// ListPlans proxy
func (h *PaymentHandler) ListPlans(c *fiber.Ctx) error {
	provider := h.getActiveProvider()
	if provider == string(models.PaymentProviderAsaas) {
		return h.asaasH.ListPlans(c)
	}
	return h.stripeH.ListPlans(c)
}

// CreateCheckout proxy
func (h *PaymentHandler) CreateCheckout(c *fiber.Ctx) error {
	provider := h.getActiveProvider()
	if provider == string(models.PaymentProviderAsaas) {
		return h.asaasH.CreateCheckout(c)
	}
	return h.stripeH.CreateCheckout(c)
}

// GetSubscription proxy
func (h *PaymentHandler) GetSubscription(c *fiber.Ctx) error {
	provider := h.getActiveProvider()
	if provider == string(models.PaymentProviderAsaas) {
		return h.asaasH.GetSubscription(c)
	}
	return h.stripeH.GetSubscription(c)
}
