package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api"
	"github.com/uniq-chat/backend/internal/api/handlers"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/services"
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

	// Apply raw-SQL ticketing indexes that AutoMigrate cannot express
	// (Postgres only — SQLite dev mode skips them).
	applyTicketingIndexes(db)

	// Seed default plans
	seedPlans(db)

	// Seed default permissions
	seedPermissions(db)

	// Ensure Admin role in each workspace has every permission (picks up any new keys)
	backfillAdminRolePermissions(db)

	// Seed ticketing roles (agent, supervisor, agent_read_only) on every workspace
	seedTicketingRoles(db)

	// Backfill: proxies sem owner_id que ficaram com is_platform=false são
	// relíquias da migração legada (global_proxy_configs → proxies). Promove
	// pra is_platform=true pra reaparecerem em /admin/proxy. Idempotente.
	backfillOrphanPlatformProxies(db)

	// Seed super admin if configured via env vars
	log.Info().Str("email", os.Getenv("SUPER_ADMIN_EMAIL")).Str("password_set", fmt.Sprintf("%v", os.Getenv("SUPER_ADMIN_PASSWORD") != "")).Msg("checking super admin env vars")
	if os.Getenv("SUPER_ADMIN_EMAIL") != "" && os.Getenv("SUPER_ADMIN_PASSWORD") != "" {
		var existing models.User
		if err := db.First(&existing, "email = ?", os.Getenv("SUPER_ADMIN_EMAIL")).Error; err == gorm.ErrRecordNotFound {
			username := strings.ToLower(strings.ReplaceAll(os.Getenv("SUPER_ADMIN_NAME"), " ", ""))
			user := models.User{
				Name:     os.Getenv("SUPER_ADMIN_NAME"),
				Username: &username,
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
		} else if err != nil {
			log.Error().Err(err).Msg("failed to query for existing super admin")
		} else {
			// Update username if not set
			if existing.Username == nil || *existing.Username == "" {
				username := strings.ToLower(strings.ReplaceAll(os.Getenv("SUPER_ADMIN_NAME"), " ", ""))
				existing.Username = &username
				db.Save(&existing)
				log.Info().Str("email", existing.Email).Str("username", username).Msg("super admin username updated")
			}
			log.Info().Str("email", existing.Email).Str("role", string(existing.Role)).Msg("super admin user already exists")
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

	// Journey executor (ManyChat-style multi-step engine)
	journeyLLM := services.NewLLMService()
	journeySender := whatsapp.NewManagerSender(manager)
	journeyExec := services.NewJourneyExecutor(db, journeySender, journeyLLM)
	agentRuntime := services.NewAgentRuntime(db, manager, journeyLLM)
	manager.SetJourneyExecutor(journeyExec)
	manager.SetAgentRuntime(agentRuntime)

	// Ticketing inbound pipeline (converts raw inbound messages into
	// Conversations for the new atendimento module). Wired into the same
	// SaveMessage hook used by legacy Inbox — co-exists during migration.
	inboundPipeline := services.NewInboundPipeline(db, whatsapp.GetHub())
	manager.SetInboundProcessor(inboundPipeline)

	// Ticketing periodic jobs: unsnoozer, presence sweep, pending redispatch,
	// resolve auto-close.
	ticketingScheduler := services.NewTicketingScheduler(db, services.NewDispatchService(db))
	ticketingScheduler.Start()

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
		&models.GlobalWebhook{},
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
		&models.AgentAsset{},
		&models.PasswordResetToken{},
		&models.Proxy{},
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
		// WABA
		&models.WABAInstance{},
		// Ticketing / Atendimento
		&models.Department{},
		&models.Team{},
		&models.TeamMember{},
		&models.Queue{},
		&models.QueueMember{},
		&models.QueueChannel{},
		&models.Conversation{},
		&models.ConversationEvent{},
		&models.ConversationAssignment{},
		&models.ConversationNote{},
		&models.ConversationParticipant{},
		&models.QuickReply{},
		&models.UserPresence{},
		&models.CSATSurvey{},
		// CRM enhanced
		&models.Company{},
		&models.Deal{},
		&models.DealActivity{},
		&models.FunnelView{},
		&models.ContactGroup{},
		&models.ContactGroupMembership{},
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
			// Update numeric limits only — do NOT overwrite price, features or allow_proxy
			// so that admin edits made via the panel are preserved across restarts.
			db.Model(&existing).Updates(map[string]interface{}{
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

// applyTicketingIndexes installs the partial unique index and hot-path
// composite indexes for conversations. Postgres-only; skipped on SQLite (dev).
func applyTicketingIndexes(db *gorm.DB) {
	name := db.Dialector.Name()
	if name != "postgres" {
		return
	}
	statements := []string{
		`DO $$
		BEGIN
		  IF NOT EXISTS (
		    SELECT 1 FROM pg_indexes
		    WHERE schemaname = 'public' AND indexname = 'uk_conv_live_per_channel'
		  ) THEN
		    CREATE UNIQUE INDEX uk_conv_live_per_channel
		      ON conversations (workspace_id, instance_id, channel_key)
		      WHERE status IN ('open','pending','snoozed')
		        AND deleted_at IS NULL;
		  END IF;
		END $$;`,
		`CREATE INDEX IF NOT EXISTS idx_conv_mine
		   ON conversations (workspace_id, status, assigned_user_id, last_message_at DESC)
		   WHERE deleted_at IS NULL;`,
		`CREATE INDEX IF NOT EXISTS idx_conv_queue
		   ON conversations (workspace_id, status, queue_id, last_message_at DESC)
		   WHERE deleted_at IS NULL;`,
		`CREATE INDEX IF NOT EXISTS idx_conv_contact_status
		   ON conversations (workspace_id, contact_id, status)
		   WHERE deleted_at IS NULL;`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			log.Warn().Err(err).Msg("ticketing index: failed to apply (non-fatal)")
		}
	}
	log.Info().Msg("ticketing indexes applied")
}

// backfillAdminRolePermissions picks up any permission keys added after a
// workspace was created and grants them to that workspace's Admin role.
// Idempotent: skips existing (role, permission) pairs.
func backfillAdminRolePermissions(db *gorm.DB) {
	var admins []models.Role
	db.Where("name = ? AND is_default = ?", "Admin", true).Find(&admins)
	if len(admins) == 0 {
		return
	}
	var perms []models.Permission
	db.Find(&perms)
	if len(perms) == 0 {
		return
	}
	for _, role := range admins {
		for _, p := range perms {
			var exists int64
			db.Model(&models.RolePermission{}).
				Where("role_id = ? AND permission_id = ?", role.ID, p.ID).
				Count(&exists)
			if exists == 0 {
				db.Create(&models.RolePermission{RoleID: role.ID, PermissionID: p.ID})
			}
		}
	}
	log.Info().Int("roles", len(admins)).Int("perms", len(perms)).Msg("admin role permissions backfilled")
}

// seedTicketingRoles is a thin wrapper over the reusable helper in
// models — moved there so WorkspaceHandler.Create can seed a new
// workspace's default roles in-line (sem depender de boot).
func seedTicketingRoles(db *gorm.DB) {
	n := models.SeedDefaultRolesForAllWorkspaces(db)
	log.Info().Int("workspaces", n).Msg("ticketing roles seeded")
}

// backfillOrphanPlatformProxies promove pra is_platform=true qualquer Proxy
// sem owner_id que ficou com is_platform=false. Caso típico: ambiente que
// existia antes do refactor de proxies (commit 583de31) e migrou pelo
// AutoMigrate sem rodar proxies_refactor.sql — os globals ficaram na tabela
// `proxies` mas sem o flag, sumindo do /admin/proxy embora os servers
// ainda os referenciem normalmente.
func backfillOrphanPlatformProxies(db *gorm.DB) {
	res := db.Model(&models.Proxy{}).
		Where("owner_id IS NULL AND is_platform = ?", false).
		Update("is_platform", true)
	if res.Error != nil {
		log.Warn().Err(res.Error).Msg("backfill proxies: skipped (table missing or older schema)")
		return
	}
	if res.RowsAffected > 0 {
		log.Info().Int64("rows", res.RowsAffected).Msg("backfilled orphan proxies → is_platform=true")
	}
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
