package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"
)

type Config struct {
	Port               string
	DatabaseURL        string
	JWTSecret          string
	JWTRefreshSecret   string
	FrontendURL        string
	LogLevel           string
	SessionDir         string
	ProxyEncryptionKey string

	// RabbitMQ — internal message queue
	RabbitMQURI string // e.g. amqp://guest:guest@localhost:5672/

	// MinIO / S3 — media storage
	MinIOEndpoint  string // e.g. localhost:9000
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	MinIOPublicURL string // public base URL, e.g. http://localhost:9000
	MinIOUseSSL    bool

	// Stripe — payments
	StripeSecretKey     string
	StripeWebhookSecret string

	// Resend — transactional email
	ResendAPIKey string
	FromEmail    string
	AppName      string
	AppURL       string

	// Bright Data — residential proxy
	BrightDataCustomerID string
	BrightDataZone       string
	BrightDataPassword   string
	BrightDataHost       string
	BrightDataPort       int

	// Taktik — Instagram/TikTok automation
	TaktikBaseURL string
}

var AppConfig *Config

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Debug().Msg("No .env file found, using environment variables")
	}

	isProduction := getEnv("ENV", "development") == "production"

	cfg := &Config{
		Port:               getEnv("PORT", "8080"),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		JWTSecret:          getEnv("JWT_SECRET", "change_me_in_production_jwt_secret"),
		JWTRefreshSecret:   getEnv("JWT_REFRESH_SECRET", "change_me_in_production_refresh"),
		FrontendURL:        getEnv("FRONTEND_URL", "http://localhost:3000"),
		LogLevel:           getEnv("LOG_LEVEL", "info"),
		SessionDir:         getEnv("SESSION_DIR", "./sessions"),
		ProxyEncryptionKey: getEnv("PROXY_ENCRYPTION_KEY", "12345678901234567890123456789012"),

		// RabbitMQ
		RabbitMQURI: getEnv("RABBITMQ_URI", ""),

		// MinIO
		MinIOEndpoint:  getEnv("MINIO_ENDPOINT", ""),
		MinIOAccessKey: getEnv("MINIO_ACCESS_KEY", "uniqchat"),
		MinIOSecretKey: getEnv("MINIO_SECRET_KEY", "uniqchat123"),
		MinIOBucket:    getEnv("MINIO_BUCKET", "uniqchat-media"),
		MinIOPublicURL: getEnv("MINIO_PUBLIC_URL", "http://localhost:9000"),
		MinIOUseSSL:    getEnv("MINIO_USE_SSL", "") == "true",

		// Stripe
		StripeSecretKey:     getEnv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: getEnv("STRIPE_WEBHOOK_SECRET", ""),

		// Resend
		ResendAPIKey: getEnv("RESEND_API_KEY", ""),
		FromEmail:    getEnv("FROM_EMAIL", "mail@mrstpry.org"),
		AppName:      getEnv("APP_NAME", "Uniq.chat"),
		AppURL:       getEnv("APP_URL", getEnv("FRONTEND_URL", "http://localhost:3000")),

		// Bright Data
		BrightDataCustomerID: getEnv("BRIGHTDATA_CUSTOMER_ID", ""),
		BrightDataZone:       getEnv("BRIGHTDATA_ZONE", "residential"),
		BrightDataPassword:   getEnv("BRIGHTDATA_PASSWORD", ""),
		BrightDataHost:       getEnv("BRIGHTDATA_HOST", "brd.superproxy.io"),
		BrightDataPort:       getEnvInt("BRIGHTDATA_PORT", 33335),

		// Taktik — Instagram/TikTok automation
		TaktikBaseURL: getEnv("TAKTIK_BASE_URL", "http://localhost:8090"),
	}

	// Validate critical secrets in production
	if isProduction {
		if cfg.JWTSecret == "change_me_in_production_jwt_secret" {
			log.Fatal().Msg("FATAL: JWT_SECRET must be set in production!")
		}
		if cfg.JWTRefreshSecret == "change_me_in_production_refresh" {
			log.Fatal().Msg("FATAL: JWT_REFRESH_SECRET must be set in production!")
		}
		if cfg.DatabaseURL == "" {
			log.Fatal().Msg("FATAL: DATABASE_URL must be set in production!")
		}
		log.Info().Msg("Production mode: critical secrets validated")
	}

	AppConfig = cfg
	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
