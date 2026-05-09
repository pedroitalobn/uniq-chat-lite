package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
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

	// Recuperação de coluna custom_fields corrompida — em alguns
	// deploys parciais o GORM criou a coluna com valores inválidos
	// (ex: literal "'{}'::jsonb" como string), o que faz qualquer
	// SELECT na tabela falhar com "invalid input syntax for type
	// json". Drop seguro com IF EXISTS antes da AutoMigrate; ela
	// recria limpa logo depois sem default. Idempotente.
	if db.Dialector.Name() == "postgres" {
		// Repara custom_fields corrompido (literal "'{}'::jsonb" como texto,
		// vazio, etc) drop+recreate. Hooks BeforeSave em Contact/Deal/Company
		// agora coercem zero-value pra "{}" prevenindo re-corrupção.
		// Idempotente — DROP IF EXISTS é no-op quando já tá ok.
		for _, table := range []string{"contacts", "deals", "companies"} {
			if err := db.Exec("ALTER TABLE " + table + " DROP COLUMN IF EXISTS custom_fields").Error; err != nil {
				log.Warn().Err(err).Str("table", table).Msg("repair: drop custom_fields falhou — seguindo")
			}
		}
		// LEGACY: backfill que limpava `name` quando igual ao phone/external_id.
		// Removido — rodava em todo restart e tinha risco de apagar nomes reais
		// em corner cases (e.g. user com nome puramente numérico igual ao
		// telefone). O ProfileSyncCron agora preenche corretamente a partir
		// do push_name das conversations e do MessageLog. Quem precisar dessa
		// limpeza pontual pode rodar manualmente:
		//
		//   UPDATE contacts SET name = '' WHERE name = phone OR name = external_id;

		// Multi-agente: remove o uniqueIndex legado em instance_agents.instance_id
		// pra permitir N agentes por instância. Idempotente — só roda se o
		// índice ainda existir. AutoMigrate logo abaixo recria como índice
		// não-único. Backfill de is_primary acontece depois.
		_ = db.Exec(`DO $$
			DECLARE idx_name text;
			BEGIN
				SELECT indexname INTO idx_name
				FROM pg_indexes
				WHERE schemaname='public' AND tablename='instance_agents'
				  AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%instance_id%'
				LIMIT 1;
				IF idx_name IS NOT NULL THEN
					EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(idx_name);
				END IF;
			END $$;`).Error
	}

	// Auto-migrate. Em prod uma migration ruim (ex: default JSONB
	// inválido, FK pendente) derrubava o boot inteiro — o que
	// disfarçava como "500 generic" do reverse proxy. Logamos como
	// erro alto pra alertar mas seguimos: rotas estáticas, CORS,
	// /health continuam respondendo enquanto a migration é
	// investigada nos logs.
	if err := autoMigrate(db); err != nil {
		log.Error().Err(err).Msg("AutoMigrate falhou — servidor segue de pé pra debug, mas tabelas podem estar fora de sync")
	}

	// Backfill multi-agente: cada instância que tinha 1 agente vira ele
	// is_primary=true. Idempotente. Roda só uma vez na prática — depois
	// que o flag está setado, o WHERE filtra.
	if db.Dialector.Name() == "postgres" {
		_ = db.Exec(`UPDATE instance_agents SET is_primary = true
			WHERE id IN (
				SELECT DISTINCT ON (instance_id) id
				FROM instance_agents
				WHERE instance_id NOT IN (SELECT instance_id FROM instance_agents WHERE is_primary = true)
				ORDER BY instance_id, created_at ASC
			)`).Error

		// Fix do índice único de trigger_webhook_slug — o `uniqueIndex` do
		// GORM cria índice global, e como o slug é "" (vazio) por default
		// pra agentes em modo any/keyword, o segundo agente criado batia
		// no constraint (todos compartilhando ""). Convertemos em índice
		// PARCIAL: só enforça unicidade quando o slug está preenchido.
		// Idempotente — DROP IF EXISTS + CREATE com nome próprio.
		_ = db.Exec(`DROP INDEX IF EXISTS idx_instance_agents_trigger_webhook_slug`).Error
		_ = db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_agents_trigger_webhook_slug
			ON instance_agents (trigger_webhook_slug)
			WHERE trigger_webhook_slug IS NOT NULL AND trigger_webhook_slug <> ''`).Error
	}

	// Apply raw-SQL ticketing indexes that AutoMigrate cannot express
	// (Postgres only — SQLite dev mode skips them).
	applyTicketingIndexes(db)

	// Ensure all extended plan columns exist (idempotent, Postgres-only).
	applyPlansMigration(db)

	// CRM v2 constraints (NOT NULL, cascade DELETE, hot-path indexes).
	applyCrmConstraints(db)

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

	// Backfill: MessageLog.Content que ficou double-encoded pelo bug da
	// Manager.SaveMessage (json.Marshal de string já-JSON). Roda 1x no
	// boot — corrigido no source, mídias novas já chegam corretas.
	backfillDoubleEncodedMediaContent(db)

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
	backfillMediaFiles(db)

	// Start real-time event hub
	whatsapp.StartHub()

	// WhatsApp Manager
	manager := whatsapp.NewManager(cfg.SessionDir, db)
	whatsapp.SetDeliveryDB(db) // habilita log de WebhookDelivery
	manager.LoadAll()

	// Connect hub to manager for bulk actions
	if hub := whatsapp.GetHub(); hub != nil {
		hub.SetManager(manager)
	}

	// Journey executor (ManyChat-style multi-step engine). LLM ganha
	// fallback automático pra PlatformAI ativa do admin (sem isso
	// jornadas com IA falhavam quando OPENAI_API_KEY estava vazio).
	journeyLLM := services.NewLLMService()
	journeyLLM.SetDB(db)
	journeySender := whatsapp.NewManagerSender(manager)
	journeyExec := services.NewJourneyExecutor(db, journeySender, journeyLLM)
	// Worker proativo de enrollments — varre segments-as-trigger e
	// enrollments pendentes a cada 60s. Roda em background, encerra
	// quando o ctx do server cancela.
	journeyExec.StartEnrollmentRunner(context.Background())
	ttsService := services.NewTTSService()
	agentRuntime := services.NewAgentRuntime(db, manager, journeyLLM, ttsService)
	manager.SetJourneyExecutor(journeyExec)
	manager.SetAgentRuntime(agentRuntime)

	// Ticketing inbound pipeline (converts raw inbound messages into
	// Conversations for the new atendimento module). Wired into the same
	// SaveMessage hook used by legacy Inbox — co-exists during migration.
	inboundPipeline := services.NewInboundPipeline(db, whatsapp.GetHub())
	// Sprint 8: keyword triggers (autoresponder simples)
	triggerSvc := services.NewTriggerService(db, manager)
	inboundPipeline.SetTriggerService(triggerSvc)
	manager.SetInboundProcessor(inboundPipeline)

	// WABA window keeper — envia mensagem automática antes da janela de 24h fechar
	windowKeeper := services.NewWindowKeeperService(db, inboundPipeline)
	go windowKeeper.Start(context.Background())

	// Sprint billing — usage counters + thresholds. Notifier dispara
	// webhook usage.threshold + WS pra UI mostrar banner.
	usageSvc := services.NewUsageService(db)
	usageSvc.SetNotifier(func(ctx context.Context, userID uuid.UUID, usageType string, percent int, current, limit int) {
		hub := whatsapp.GetHub()
		if hub != nil {
			hub.Broadcast(&whatsapp.Event{
				Type: "usage.threshold",
				Payload: map[string]any{
					"user_id": userID.String(),
					"type":    usageType,
					"percent": percent,
					"current": current,
					"limit":   limit,
				},
			})
		}
		log.Info().Str("user", userID.String()).Str("type", usageType).Int("percent", percent).
			Int("current", current).Int("limit", limit).Msg("usage threshold reached")
	})
	services.SetGlobalUsageService(usageSvc)

	// Sistema de créditos (Uniq Credits) — UsageRecorder grava
	// usage_events e atualiza usage_quotas/workspace_quotas atomic.
	// Coexiste com o UsageService legado (rate-limit anti-spam diário
	// continua usando UsageCounter). PricingConfig é seedado no primeiro
	// uso (lazy via pricing0).
	usageRecorder := services.NewUsageRecorder(db)
	services.SetGlobalUsageRecorder(usageRecorder)

	// Asaas cron — emula cancel_at_period_end via flag asaas_cancel_at.
	asaasCron := services.NewAsaasCron(db)
	asaasCron.Start()

	// Security cleanup cron — deleta contas não-verificadas após 14d.
	cleanupCron := services.NewCleanupCron(db)
	cleanupCron.Start()

	// Computed Attributes cron — recalcula contact_computed (LTV, orders,
	// conversations, deals) a cada hora pra Segments + Liquid templates.
	computedCron := services.NewComputedCron(db)
	computedCron.Start()

	// CRM Stats Sync — recalcula denormalizações de Company (contact_count,
	// deal_count, open_deal_sum) e Contact (deals_open, deals_won) a cada
	// 5 min. UI lê esses campos direto sem precisar de JOIN.
	services.NewCrmStatsSync(db).Start(context.Background())

	// Journey Event Dispatcher — singleton global pra outros services
	// emitirem eventos de Goal/ExitConditions (shop.order_paid, deal.won, …).
	services.NewJourneyEventDispatcher(db)

	// Ticketing periodic jobs: unsnoozer, presence sweep, pending redispatch,
	// resolve auto-close.
	ticketingScheduler := services.NewTicketingScheduler(db, services.NewDispatchService(db))
	ticketingScheduler.Start()

	// Proxy health monitor: testa proxies da plataforma a cada 5min e reinicia
	// instâncias afetadas automaticamente quando um proxy se recupera.
	proxyMonitor := services.NewProxyMonitor(db, manager)
	proxyMonitor.Start()

	// Profile sync cron — preenche avatar_url e push_name retroativamente em
	// conversas que ficaram sem (porque a captura era 100% reativa antes).
	// Também refresca avatares stale (>6h) pra contornar URLs assinadas
	// expiradas pela Meta. Roda a cada 20min, max ~200 lookups por tick.
	profileSyncCron := services.NewProfileSyncCron(db, manager)
	profileSyncCron.Start()

	// Overage invoice cron — roda 1x por dia. Pra cada UsageQuota com
	// period_end vencido E overage_cents_accumulated > 0 cria invoice
	// avulsa na Stripe + zera o acumulador. Free PAYG sem stripe_customer
	// é skipado (overage virou perda; user precisava de topup).
	overageCron := handlers.NewOverageInvoiceCron(db)
	overageCron.Start()

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
	app := api.SetupRouter(db, manager, agentRuntime)

	addr := ":" + cfg.Port
	log.Info().Str("addr", addr).Msg("Uniq.chat API starting")

	// Graceful shutdown — ouve SIGTERM/SIGINT e drena conexões antes de
	// matar o processo. Sem isso o Dokploy/K8s mata 30s depois e
	// requests em flight perdem (transações abortadas, webhooks
	// re-entregues como falhados, WS clients caem sem aviso). Janela de
	// 25s pra finalizar (LB tem 30s de drain default).
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
		<-quit
		log.Info().Msg("graceful shutdown: drenando conexões (até 25s)")
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := app.ShutdownWithContext(ctx); err != nil {
			log.Error().Err(err).Msg("graceful shutdown: erro durante drain")
		} else {
			log.Info().Msg("graceful shutdown: drain concluído")
		}
		// Fecha pool de DB pra liberar conexões antes do exit.
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	}()

	if err := app.Listen(addr); err != nil {
		log.Fatal().Err(err).Msg("server error")
	}
}

func connectDB(cfg *config.Config) (*gorm.DB, error) {
	gormCfg := &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	}

	if cfg.DatabaseURL != "" {
		db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), gormCfg)
		if err != nil {
			return nil, err
		}
		// Pool config — antes default (Postgres ~30 conns) saturava em
		// ~100 RPS porque cada request abre 1-2 queries em paralelo
		// (autenticação + handler + rate limit). Setting explícito:
		//   100 max — suporta ~50 req/s sustentado com headroom
		//   25 idle — manter pool quente, abre cold start menos
		//   1h lifetime — refresh conn pra evitar TCP keepalive issues
		//   30min idle timeout — libera conn ociosa pra economizar RAM
		if sqlDB, errDB := db.DB(); errDB == nil {
			sqlDB.SetMaxOpenConns(100)
			sqlDB.SetMaxIdleConns(25)
			sqlDB.SetConnMaxLifetime(time.Hour)
			sqlDB.SetConnMaxIdleTime(30 * time.Minute)
		}
		return db, nil
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
		&models.WebhookDelivery{},
		&models.MediaFile{},
		&models.MessageLog{},
		&models.MessageReceipt{},
		&models.LinkPreview{},
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
		&models.AgentExecution{},
		&models.ContactMemory{},
		&models.PasswordResetToken{},
		&models.Proxy{},
		&models.InstagramAccount{},
		&models.TikTokAccount{},
		&models.SocialDM{},
		&models.SocialTarget{},
		&models.TaktikDevice{},
		&models.Journey{},
		&models.JourneyEnrollment{},
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
		// Magic-link registration
		&models.PendingRegistration{},
		// Global communication settings
		&models.GlobalCommunicationSettings{},
		// WABA
		&models.WABAInstance{},
		&models.WABATemplateDefault{},
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
		&models.ConversationAgentState{},
		&models.QuickReply{},
		&models.UserPresence{},
		&models.CSATSurvey{},
		// CRM enhanced
		&models.Company{},
		&models.Deal{},
		&models.DealActivity{},
		&models.FunnelView{},
		&models.ContactGroup{},
		&models.CrmTask{},
		&models.CrmMeeting{},
		&models.ContactGroupMembership{},
		&models.CrmCustomField{},
		// Sprint 8 — triggers (autoresponder por keyword)
		&models.Trigger{},
		&models.TriggerFire{},
		// Sprint 7 — warm-up
		&models.WarmupSession{},
		// Sprint billing — usage counters
		&models.UsageCounter{},
		&models.PlanChangeLog{},
		// Webhook dedup (Stripe/Asaas/Hotmart event.id idempotência)
		&models.ProcessedWebhookEvent{},
		// Email/Maileroo config — tabela armazenada no /admin/providers
		&models.EmailSettings{},
		// Audit log de ações sensíveis (auth/admin/billing)
		&models.AuditLog{},
		// Customer.io-inspired: suppression, subscription, segments, identity, computed
		&models.Suppression{},
		&models.SubscriptionTopic{},
		&models.ContactSubscription{},
		&models.PreferenceLink{},
		&models.ContactComputed{},
		&models.Segment{},
		&models.SegmentMember{},
		&models.ContactAlias{},
		// Voice / TTS
		&models.VoiceProvider{},
		&models.WorkspaceVoice{},
		// Módulo Shop (Fase 1)
		&models.Shop{},
		&models.Product{},
		&models.ProductVariant{},
		&models.ProductImage{},
		&models.ProductCategory{},
		&models.ShopIntegration{},
		&models.Order{},
		&models.Cart{},
		// Platform AI (Uniq AI) — singleton config
		&models.PlatformAI{},
		&models.PlatformVoice{},
		&models.PricingConfig{},
		&models.UsageEvent{},
		&models.UsageQuota{},
		&models.WorkspaceQuota{},
		&models.UsageTopup{},
		// Help Desk (knowledge base)
		&models.HelpDeskCategory{},
		&models.HelpDeskArticle{},
		&models.HelpDeskConfig{},
		// WebChat widget
		&models.WebChatConfig{},
		&models.WebChatSession{},
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
			Features:              `{"whatsapp":true,"instagram":false,"crm":true,"campaigns":false,"integrations":false,"api":false,"webhooks":false,"mcp":false,"description":"Para pequenos negócios"}`,
			AllowProxy:            false,
			AllowProxyResidencial: false,
			IsActive:              true,
			// StripePriceID lido de STRIPE_PRICE_STARTER abaixo via setPriceID.
			// Antes ficava hardcoded num price antigo (price_1TFmWy...) que
			// sobreviveu pra rows existentes mesmo após o admin trocar o env.
			StripePriceID:         os.Getenv("STRIPE_PRICE_STARTER"),
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
		}
		// Existing plans are never overwritten — all fields are managed via the admin panel.
	}

	// Migrate legacy "Enterprise" plan → rename to "Business" (if Business doesn't already exist)
	var businessExists models.Plan
	if db.Where("name = 'Business'").First(&businessExists).Error != nil {
		db.Model(&models.Plan{}).Where("name = 'Enterprise'").Update("name", "Business")
	} else {
		// Business already exists — just delete the old Enterprise if present
		db.Where("name = 'Enterprise'").Delete(&models.Plan{})
	}

	// Self-heal: se Starter ainda tem o price antigo hardcoded de quando
	// estava no seed, limpa pra que o env/UI possam preencher na sequência.
	// Idempotente — só roda se a row ainda tem o price legado.
	db.Model(&models.Plan{}).
		Where("name = 'Starter' AND stripe_price_id = 'price_1TFmWyGKxdRCOZrXWqqZU28y'").
		Update("stripe_price_id", "")

	// Inject Stripe Price IDs from environment SOMENTE quando a row DB
	// estiver vazia. UI do admin é fonte da verdade — antes esse loop
	// sobrescrevia toda boot, o que apagava o que o admin tinha salvo
	// (e travava o checkout pra quem usava UI em vez de env).
	// Prioridade efetiva agora: UI/DB > env > vazio.
	setPriceIDIfEmpty := func(planName, envKey string) {
		priceID := os.Getenv(envKey)
		if priceID == "" {
			return
		}
		db.Model(&models.Plan{}).
			Where("name = ? AND (stripe_price_id IS NULL OR stripe_price_id = '')", planName).
			Update("stripe_price_id", priceID)
	}
	setPriceIDIfEmpty("Starter", "STRIPE_PRICE_STARTER")
	setPriceIDIfEmpty("Pro", "STRIPE_PRICE_PRO")
	setPriceIDIfEmpty("Business", "STRIPE_PRICE_BUSINESS")
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

// applyCrmConstraints aplica constraints físicas que reforçam a v2
// do CRM. Idempotente — todos com guard de existência.
//
// Inclui:
//   - deals.contact_id NOT NULL (já era no struct, garantia em prod)
//   - cascade ON DELETE em funnel_stages → funnels (drop do funil
//     remove os stages órfãos automaticamente)
//   - cascade ON DELETE em deal_activities → deals
//   - índice composto pra hot-path de busca por contact+status nos deals
func applyCrmConstraints(db *gorm.DB) {
	if db.Dialector.Name() != "postgres" {
		return
	}
	statements := []string{
		// 1. deals.contact_id NOT NULL — pré-condição: rows com contact_id
		//    nulo já não devem existir (struct GORM já era not null). Caso
		//    existam órfãos legados, fazemos UPDATE pra NULL→delete antes.
		`DELETE FROM deals WHERE contact_id IS NULL`,
		`ALTER TABLE deals ALTER COLUMN contact_id SET NOT NULL`,

		// 2. ON DELETE CASCADE: funnel_stages quando o funnel é apagado.
		//    Drop + recreate da FK pra adicionar a cláusula CASCADE.
		`ALTER TABLE funnel_stages DROP CONSTRAINT IF EXISTS fk_funnel_stages_funnel`,
		`ALTER TABLE funnel_stages
		   ADD CONSTRAINT fk_funnel_stages_funnel
		   FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE`,

		// 3. ON DELETE CASCADE: deal_activities quando o deal é apagado.
		`ALTER TABLE deal_activities DROP CONSTRAINT IF EXISTS fk_deal_activities_deal`,
		`ALTER TABLE deal_activities
		   ADD CONSTRAINT fk_deal_activities_deal
		   FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE`,

		// 4. Hot-path index — listar deals por contato + status (UI deal list).
		`CREATE INDEX IF NOT EXISTS idx_deals_contact_status
		   ON deals (contact_id, status)
		   WHERE deleted_at IS NULL`,
		// Hot-path: deals abertos por funnel/stage (kanban).
		`CREATE INDEX IF NOT EXISTS idx_deals_funnel_stage_open
		   ON deals (funnel_id, stage_id)
		   WHERE status = 'open' AND deleted_at IS NULL`,
		// Hot-path: tasks pendentes por workspace+due_at (TaskRunner agent).
		`CREATE INDEX IF NOT EXISTS idx_crm_tasks_pending_due
		   ON crm_tasks (workspace_id, due_at)
		   WHERE status = 'pending' AND deleted_at IS NULL`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			log.Warn().Err(err).Str("stmt", stmt[:min(80, len(stmt))]).
				Msg("crm constraint: failed to apply (non-fatal)")
		}
	}
	log.Info().Msg("crm constraints applied")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// applyPlansMigration garante que as colunas estendidas da tabela plans existam.
// Idempotente — usa IF NOT EXISTS em cada ALTER TABLE.
func applyPlansMigration(db *gorm.DB) {
	if db.Dialector.Name() != "postgres" {
		return
	}
	stmts := []string{
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS slug VARCHAR(60) DEFAULT ''`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_workspaces INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_agents INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_journeys INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_campaigns INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_triggers INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_webhooks INTEGER NOT NULL DEFAULT 5`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_contacts INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_deals INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_shops INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_products INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_shop_integrations INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_instances_per_proxy INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_proxy_pool INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_ai BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_journeys BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_crm BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_inbox BOOLEAN NOT NULL DEFAULT true`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_campaigns BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_triggers BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_warmup BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_newsletters BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_communities BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_instagram BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_tiktok BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_api_access BOOLEAN NOT NULL DEFAULT true`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_global_webhook BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_shop BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_proxy_residencial BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_helpdesk BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_webchat BOOLEAN NOT NULL DEFAULT false`,
		// Habilita helpdesk e webchat para planos Pro e Business
		`UPDATE plans SET allow_helpdesk = true, allow_webchat = true WHERE name IN ('Pro', 'Business') AND (allow_helpdesk = false OR allow_webchat = false)`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255)`,
		`ALTER TABLE plans ADD COLUMN IF NOT EXISTS asaas_product_id VARCHAR(255)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug) WHERE slug != ''`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			log.Warn().Err(err).Str("stmt", s[:40]).Msg("plans migration: failed (non-fatal)")
		}
	}
	log.Info().Msg("plans extended columns applied")
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

// backfillDoubleEncodedMediaContent corrige MessageLog.Content que ficou
// JSON-encoded duas vezes pelo bug da Manager.SaveMessage (json.Marshal
// numa string que já era JSON). Detecta padrão `"{...}"` e desembrulha
// pra `{...}`. Idempotente (depois de corrigido, o conteúdo não bate
// o filtro de novo). Roda 1x no boot.
//
// Cobre TODOS os tipos com payload JSON: mídias (image/video/audio/
// document/sticker) E tipos estruturados (location/live_location/
// contact/contacts/poll). Texto puro com aspas (`"oi"`) passa batido
// porque `unwrapped` não começa com `{`.
func backfillDoubleEncodedMediaContent(db *gorm.DB) {
	var rows []models.MessageLog
	jsonTypes := []string{
		"image", "video", "audio", "document", "sticker",
		"location", "live_location", "contact", "contacts", "poll",
	}
	if err := db.Where(`content LIKE '"%' AND type IN ?`, jsonTypes).
		Find(&rows).Error; err != nil {
		log.Warn().Err(err).Msg("backfill content: query falhou (não fatal)")
		return
	}
	if len(rows) == 0 {
		return
	}
	fixed := 0
	for _, row := range rows {
		var unwrapped string
		if err := json.Unmarshal([]byte(row.Content), &unwrapped); err != nil {
			continue // não é string JSON-encoded, deixa intacto
		}
		if !strings.HasPrefix(strings.TrimSpace(unwrapped), "{") {
			continue
		}
		if err := db.Model(&models.MessageLog{}).
			Where("id = ?", row.ID).
			Update("content", unwrapped).Error; err != nil {
			log.Warn().Err(err).Str("id", row.ID.String()).
				Msg("backfill content: update falhou")
			continue
		}
		fixed++
	}
	if fixed > 0 {
		log.Info().Int("fixed", fixed).Int("scanned", len(rows)).
			Msg("backfill content: JSON estruturado desembrulhado (location/contact/poll/etc)")
	}
}

func backfillMediaFiles(db *gorm.DB) {
	var rows []models.MessageLog
	if err := db.
		Where("content LIKE ? AND content NOT LIKE ?", "%\"media_key\"%", "%\"media_id\"%").
		Find(&rows).Error; err != nil {
		log.Warn().Err(err).Msg("media files backfill query failed")
		return
	}
	fixed := 0
	for i := range rows {
		row := &rows[i]
		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(row.Content), &payload); err != nil {
			continue
		}
		key, _ := payload["media_key"].(string)
		if key == "" {
			continue
		}
		var media models.MediaFile
		err := db.Where("object_key = ?", key).First(&media).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			log.Warn().Err(err).Str("key", key).Msg("media files backfill lookup failed")
			continue
		}
		if err == gorm.ErrRecordNotFound {
			media = models.MediaFile{
				WorkspaceID:  row.WorkspaceID,
				UserID:       row.UserID,
				InstanceID:   &row.InstanceID,
				MessageLogID: &row.ID,
				ObjectKey:    key,
				MediaType:    row.Type,
				MimeType:     stringPayload(payload, "mime_type"),
				Filename:     stringPayload(payload, "filename"),
				PublicURL:    stringPayload(payload, "url"),
				SizeBytes:    int64Payload(payload, "size_bytes"),
			}
			if storage.GlobalStorage != nil {
				media.Bucket = storage.GlobalStorage.BucketName()
				if media.PublicURL == "" {
					media.PublicURL = storage.GlobalStorage.PublicURL(key)
				}
			}
			if err := db.Create(&media).Error; err != nil {
				log.Warn().Err(err).Str("key", key).Msg("media files backfill create failed")
				continue
			}
		}
		payload["media_id"] = media.ID.String()
		payload["public_url"] = "/m/" + media.ID.String()
		payload["download_url"] = "/v1/media/files/" + media.ID.String() + "/download"
		payload["stream_url"] = "/v1/media/files/" + media.ID.String() + "/stream"
		out, err := json.Marshal(payload)
		if err != nil {
			continue
		}
		if err := db.Model(&models.MessageLog{}).Where("id = ?", row.ID).Update("content", string(out)).Error; err != nil {
			log.Warn().Err(err).Str("message_id", row.ID.String()).Msg("media files backfill content update failed")
			continue
		}
		fixed++
	}
	if len(rows) > 0 {
		log.Info().Int("fixed", fixed).Int("scanned", len(rows)).Msg("media files backfill done")
	}
}

func stringPayload(payload map[string]interface{}, key string) string {
	v, _ := payload[key].(string)
	return v
}

func int64Payload(payload map[string]interface{}, key string) int64 {
	switch v := payload[key].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	default:
		return 0
	}
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

