package main

import (
	"fmt"
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

	// Seed default permissions
	seedPermissions(db)

	// Seed super admin if configured via env vars
	log.Debug().Str("email", os.Getenv("SUPER_ADMIN_EMAIL")).Str("password_set", fmt.Sprintf("%v", os.Getenv("SUPER_ADMIN_PASSWORD") != "")).Msg("checking super admin env vars")
	if os.Getenv("SUPER_ADMIN_EMAIL") != "" && os.Getenv("SUPER_ADMIN_PASSWORD") != "" {
		var existing models.User
		if err := db.First(&existing, "email = ?", os.Getenv("SUPER_ADMIN_EMAIL")).Error; err == gorm.ErrRecordNotFound {
			user := models.User{
				Name:     os.Getenv("SUPER_ADMIN_NAME"),
				Email:    os.Getenv("SUPER_ADMIN_EMAIL"),
				Role:     models.RoleSuperAdmin,
				IsBeta:   true,
				IsActive: true,
			}
			if name := os.Getenv("SUPER_ADMIN_NAME"); name != "" {
				user.Name = name
			} else {
				user.Name = "Super Admin"
			}
			if err := user.SetPassword(os.Getenv("SUPER_ADMIN_PASSWORD")); err != nil {
				log.Fatal().Err(err).Msg("failed to hash super admin password")
			}
			if err := db.Create(&user).Error; err != nil {
				log.Fatal().Err(err).Msg("failed to create super admin user")
			}
			log.Info().Str("email", user.Email).Msg("super admin user created")
		} else if existing.Role != models.RoleSuperAdmin {
			existing.Role = models.RoleSuperAdmin
			existing.IsBeta = true
			db.Save(&existing)
			log.Info().Str("email", existing.Email).Msg("existing user promoted to super admin")
		}
	}

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

	// Start real-time event hub
	whatsapp.StartHub()

	// WhatsApp Manager
	manager := whatsapp.NewManager(cfg.SessionDir, db)
	manager.LoadAll()

	// Connect hub to manager for bulk actions
	if hub := whatsapp.GetHub(); hub != nil {
		hub.SetManager(manager)
	}

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
		&models.ProxyPool{},
		&models.ProxyProviderConfig{},
		&models.InstanceProxyAssignment{},
		&models.InstagramAccount{},
		&models.TikTokAccount{},
		&models.SocialDM{},
		&models.SocialTarget{},
		&models.TaktikDevice{},
		&models.Journey{},
		&models.JourneyExecution{},
		&models.Funnel{},
		&models.FunnelStage{},
		// Workspace / RBAC
		&models.Workspace{},
		&models.UserWorkspace{},
		&models.Role{},
		&models.Permission{},
		&models.RolePermission{},
		&models.Invite{},
		&models.InviteCode{},
		&models.SystemSetting{},
		// Payment
		&models.PaymentSettings{},
		&models.GlobalProxyConfig{},
		// WABA
		&models.WABAInstance{},
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
			Name:                  "Free",
			Price:                 0,
			MaxInstances:          1,
			MaxMessagesPerDay:     100,
			MaxUsers:              1,
			MaxWorkspaces:         1,
			Features:              `{"support":"community","channels":["whatsapp"]}`,
			AllowProxy:            false,
			AllowProxyResidencial: false,
			IsActive:              true,
		},
		{
			Name:                  "Starter",
			Price:                 29,
			MaxInstances:          1,
			MaxMessagesPerDay:     100,
			MaxUsers:              3,
			MaxWorkspaces:         1,
			Features:              `{"whatsapp":true,"instagram":false,"crm":true,"campaigns":false,"integrations":false,"api":false,"webhooks":false,"mcp":false,"description":"Para pequenos negócios","stripe_price_id":"price_1TFmWyGKxdRCOZrXWqqZU28y"}`,
			AllowProxy:            false,
			AllowProxyResidencial: false,
			IsActive:              true,
			StripePriceID:         "price_1TFmWyGKxdRCOZrXWqqZU28y",
		},
		{
			Name:                  "Pro",
			Price:                 99,
			MaxInstances:          150,
			MaxMessagesPerDay:     -1,
			MaxUsers:              5,
			MaxWorkspaces:         2,
			Features:              `{"support":"email","webhooks":true,"channels":["whatsapp","instagram"]}`,
			AllowProxy:            true,
			AllowProxyResidencial: true,
			MaxInstancesPerProxy:  5,
			MaxProxyPool:          10,
			IsActive:              true,
			StripePriceID:         os.Getenv("STRIPE_PRICE_PRO"),
		},
		{
			Name:                  "Business",
			Price:                 149,
			MaxInstances:          300,
			MaxMessagesPerDay:     -1,
			MaxUsers:              10,
			MaxWorkspaces:         -1,
			Features:              `{"support":"priority","webhooks":true,"channels":["whatsapp","instagram","telegram","linkedin"],"custom_domain":true,"mcp":true}`,
			AllowProxy:            true,
			AllowProxyResidencial: true,
			MaxInstancesPerProxy:  3,
			MaxProxyPool:          50,
			IsActive:              true,
			StripePriceID:         os.Getenv("STRIPE_PRICE_BUSINESS"),
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
				"price":                plans[i].Price,
				"max_instances":        plans[i].MaxInstances,
				"max_messages_per_day": plans[i].MaxMessagesPerDay,
				"max_users":            plans[i].MaxUsers,
				"max_workspaces":       plans[i].MaxWorkspaces,
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

func seedPermissions(db *gorm.DB) {
	perms := models.GetAllPermissions()
	for i := range perms {
		db.Where(models.Permission{Key: perms[i].Key}).
			Assign(models.Permission{
				Name:        perms[i].Name,
				Description: perms[i].Description,
				Category:    perms[i].Category,
			}).
			FirstOrCreate(&perms[i])
	}
	log.Info().Msg("permissions seeded")
}
