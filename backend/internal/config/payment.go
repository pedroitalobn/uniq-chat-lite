package config

import (
	"gorm.io/gorm"

	"github.com/rs/zerolog/log"
)

func LoadPaymentSettings(db *gorm.DB) error {
	var settings struct {
		StripeSecretKey     string
		StripeWebhookSecret string
		AsaasAPIKey         string
		AsaasWebhookSecret  string
		AsaasEnvironment    string
	}

	if err := db.First(&settings).Error; err != nil {
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

	log.Info().Msg("Payment settings loaded from database")
	return nil
}
