package config

import (
	"gorm.io/gorm"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
)

func LoadPaymentSettings(db *gorm.DB) error {
	var settings models.PaymentSettings

	if err := db.First(&settings, "id = ?", "default").Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}

	if settings.StripeSecretKey != "" {
		AppConfig.StripeSecretKey = settings.StripeSecretKey
	}
	if settings.StripeWebhookSecret != "" {
		AppConfig.StripeWebhookSecret = settings.StripeWebhookSecret
	}
	if settings.AsaasAPIKey != "" {
		AppConfig.AsaasAPIKey = settings.AsaasAPIKey
	}
	if settings.AsaasWebhookSecret != "" {
		AppConfig.AsaasWebhookSecret = settings.AsaasWebhookSecret
	}
	if settings.AsaasEnvironment != "" {
		AppConfig.AsaasEnvironment = settings.AsaasEnvironment
	}
	if settings.AbacatepayAPIKey != "" {
		AppConfig.AbacatepayAPIKey = settings.AbacatepayAPIKey
	}
	if settings.AbacatepayWebhookSecret != "" {
		AppConfig.AbacatepayWebhookSecret = settings.AbacatepayWebhookSecret
	}
	if settings.AbacatepayEnvironment != "" {
		AppConfig.AbacatepayEnvironment = settings.AbacatepayEnvironment
	}

	log.Info().Msg("Payment settings loaded from database")
	return nil
}
