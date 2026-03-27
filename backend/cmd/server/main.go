package main

import (
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api"
	"github.com/uniq-chat/backend/internal/api/handlers"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/storage"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func main() {
	// Config
	cfg := config.Load()

	// Logging
	level, _ := zerolog.ParseLevel(cfg.LogLevel)
	zerolog.SetGlobalLevel(level)
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// Database
	db, err := connectDB(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}

	// Auto-migrate
	if err := autoMigrate(db); err != nil {
		log.Fatal().Err(err).Msg("failed to run migrations")
	}

	// Seed default plans
	seedPlans(db)

	// Backfill slug and token for existing instances that predate these fields
	backfillInstances(db)

	// Session directory
	if err := os.MkdirAll(cfg.SessionDir, 0755); err != nil {
		log.Fatal().Err(err).Msg("failed to create session directory")
	}

	// RabbitMQ (optional — graceful degradation if not configured)
	if cfg.RabbitMQURI != "" {
		qm := queue.NewManager(cfg.RabbitMQURI)
		if err := qm.Connect(); err != nil {
			log.Warn().Err(err).Msg("rabbitmq: failed to connect — running without queue (direct sends)")
		} else {
			log.Info().Msg("rabbitmq: queue manager ready")
		}
	} else {
		log.Warn().Msg("RABBITMQ_URI not set — running without internal queue (direct sends, no anti-ban delay)")
	}

	// MinIO (optional — graceful degradation if not configured)
	if cfg.MinIOEndpoint != "" {
		if _, err := storage.NewClient(
			cfg.MinIOEndpoint,
			cfg.MinIOAccessKey,
			cfg.MinIOSecretKey,
			cfg.MinIOBucket,
			cfg.MinIOPublicURL,
			cfg.MinIOUseSSL,
		); err != nil {
			log.Warn().Err(err).Msg("minio: failed to connect — media upload unavailable")
		}
	} else {
		log.Warn().Msg("MINIO_ENDPOINT not set — media storage disabled")
	}

	// WhatsApp Manager
	manager := whatsapp.NewManager(cfg.SessionDir, db)
	manager.LoadAll()

	// Scheduled recovery snapshots (check every hour)
	recoveryH := handlers.NewRecoveryHandler(db, manager)
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			recoveryH.RunScheduledSnapshots()
		}
	}()

	// Router
	app := api.SetupRouter(db, manager)

	addr := ":" + cfg.Port
	log.Info().Str("addr", addr).Msg("Uniq.chat API starting")

	if err := app.Listen(addr); err != nil {
		log.Fatal().Err(err).Msg("server error")
	}
}

func connectDB(cfg *config.Config) (*gorm.DB, error) {
	gormCfg := &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	}

	if cfg.DatabaseURL != "" {
		return gorm.Open(postgres.Open(cfg.DatabaseURL), gormCfg)
	}

	// Fallback to SQLite for dev
	log.Warn().Msg("DATABASE_URL not set, using SQLite (dev mode)")
	return gorm.Open(sqlite.Open("uniqdot_dev.db"), gormCfg)
}

func autoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.Plan{},
		&models.User{},
		&models.Instance{},
		&models.APIKey{},
		&models.Webhook{},
		&models.MessageLog{},
		&models.Contact{},
		&models.Tag{},
		&models.Campaign{},
		&models.CampaignRecipient{},
		&models.OTPSession{},
		&models.Server{},
		&models.UserIntegration{},
		&models.RecoverySnapshot{},
		&models.InstanceAgent{},
		&models.PasswordResetToken{},
	)
}

func backfillInstances(db *gorm.DB) {
	var instances []models.Instance
	db.Where("slug = '' OR token = ''").Find(&instances)
	for idx := range instances {
		inst := &instances[idx]
		updates := map[string]interface{}{}
		if inst.Slug == "" {
			slug := models.SlugFrom(inst.Name)
			// ensure uniqueness within server scope
			base := slug
			for i := 2; i <= 100; i++ {
				q := db.Where("slug = ? AND id != ?", slug, inst.ID)
				if inst.ServerID != nil {
					q = q.Where("server_id = ?", *inst.ServerID)
				} else {
					q = q.Where("server_id IS NULL")
				}
				var dup models.Instance
				if q.First(&dup).Error != nil {
					break
				}
				slug = models.SlugFrom(base + "-" + string(rune('a'+i-2)))
			}
			updates["slug"] = slug
		}
		if inst.Token == "" {
			updates["token"] = models.GenerateInstanceToken()
		}
		if len(updates) > 0 {
			db.Model(inst).Updates(updates)
		}
	}
}

func seedPlans(db *gorm.DB) {
	type planSeed struct {
		models.Plan
	}

	plans := []models.Plan{
		{
			Name:              "Free",
			Price:             0,
			MaxInstances:      1,
			MaxMessagesPerDay: 100,
			Features:          `{"support":"community","channels":["whatsapp"]}`,
			AllowProxy:        false,
			IsActive:          true,
			// StripePriceID: not needed for free plan
		},
		{
			Name:              "Pro",
			Price:             99,
			MaxInstances:      150,
			MaxMessagesPerDay: -1,
			Features:          `{"support":"email","webhooks":true,"channels":["whatsapp","instagram"]}`,
			AllowProxy:        true,
			IsActive:          true,
			// StripePriceID: set via STRIPE_PRICE_PRO env or admin panel after seeding
		},
		{
			Name:              "Business",
			Price:             149,
			MaxInstances:      -1,
			MaxMessagesPerDay: -1,
			Features:          `{"support":"priority","webhooks":true,"channels":["whatsapp","instagram","telegram","linkedin"],"custom_domain":true,"mcp":true}`,
			AllowProxy:        true,
			IsActive:          true,
			// StripePriceID: set via STRIPE_PRICE_BUSINESS env or admin panel after seeding
		},
	}

	for i := range plans {
		var existing models.Plan
		if db.Where("name = ?", plans[i].Name).First(&existing).Error != nil {
			db.Create(&plans[i])
		} else {
			// Update numeric limits only — do NOT overwrite features or allow_proxy
			// so that admin edits made via the panel are preserved across restarts.
			db.Model(&existing).Updates(map[string]interface{}{
				"price":               plans[i].Price,
				"max_instances":       plans[i].MaxInstances,
				"max_messages_per_day": plans[i].MaxMessagesPerDay,
			})
		}
	}

	// Migrate legacy "Enterprise" plan → rename to "Business" (if Business doesn't already exist)
	var businessExists models.Plan
	if db.Where("name = 'Business'").First(&businessExists).Error != nil {
		db.Model(&models.Plan{}).Where("name = 'Enterprise'").Update("name", "Business")
	} else {
		// Business already exists — just delete the old Enterprise if present
		db.Where("name = 'Enterprise'").Delete(&models.Plan{})
	}

	// Inject Stripe Price IDs from environment if set
	setPriceID := func(planName, envKey string) {
		if priceID := os.Getenv(envKey); priceID != "" {
			db.Model(&models.Plan{}).Where("name = ?", planName).Update("stripe_price_id", priceID)
		}
	}
	setPriceID("Pro", "STRIPE_PRICE_PRO")
	setPriceID("Business", "STRIPE_PRICE_BUSINESS")
}
