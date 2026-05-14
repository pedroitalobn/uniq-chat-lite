package api

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/websocket/v2"
	"github.com/uniq-chat/backend/internal/api/handlers"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/crmtasks"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/outbound"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/storage"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// SetupRouter configures all routes and returns the Fiber app.
func SetupRouter(db *gorm.DB, manager *whatsapp.Manager, agentRuntime *services.AgentRuntime) *fiber.App {
	app := fiber.New(fiber.Config{
		// CF-Connecting-IP é injetado pela Cloudflare com o IP real do cliente.
		// Sem isso, c.IP() retorna o IP do proxy (172.67.x.x) e TODOS os
		// usuários compartilham o mesmo contador de rate-limit — 2 pessoas
		// logando ao mesmo tempo estouram o limite.
		ProxyHeader: "CF-Connecting-IP",
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": err.Error()})
		},
	})

	// CORS hand-rolled — colocado ANTES de qualquer outro middleware
	// (até recover/logger) pra garantir que mesmo respostas de erro
	// (panic, 4xx, redirect HTTPS) carreguem os headers. O middleware
	// fiber/cors mostrou comportamento inconsistente em prod com
	// AllowCredentials+AllowOriginsFunc: o preflight chegava no
	// handler de erro sem nunca passar pelo middleware.
	corsAllowList := []string{
		"https://app.uniq.chat",
		"https://admin.uniq.chat",
		"https://www.uniq.chat",
		"https://uniq.chat",
	}
	for _, raw := range strings.Split(config.AppConfig.FrontendURL, ",") {
		trim := strings.TrimSpace(raw)
		if trim != "" {
			corsAllowList = append(corsAllowList, trim)
		}
	}
	corsAllowed := func(origin string) bool {
		if origin == "" {
			return false
		}
		for _, allowed := range corsAllowList {
			if allowed == origin {
				return true
			}
		}
		if strings.HasPrefix(origin, "http://localhost:") ||
			strings.HasPrefix(origin, "http://127.0.0.1:") {
			return true
		}
		if strings.HasPrefix(origin, "https://") && strings.HasSuffix(origin, ".uniq.chat") {
			return true
		}
		return false
	}

	const corsAllowHeaders = "Origin, Content-Type, Accept, Authorization, apikey, X-API-Key, X-Instance-Token, X-Workspace-ID, Upgrade, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions"
	const corsAllowMethods = "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD"

	app.Use(func(c *fiber.Ctx) error {
		origin := c.Get("Origin")
		if corsAllowed(origin) {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Vary", "Origin")
			c.Set("Access-Control-Allow-Credentials", "true")
		}
		// Preflight — responder direto, sem encadear no roteamento
		// (que pode dar 404 e perder os headers acima). Cache-Control:
		// no-store evita que edge proxies (Cloudflare, etc.) sirvam
		// uma resposta cacheada antiga sem os headers CORS.
		if c.Method() == fiber.MethodOptions {
			c.Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
			c.Set("Pragma", "no-cache")
			if corsAllowed(origin) {
				if reqHeaders := c.Get("Access-Control-Request-Headers"); reqHeaders != "" {
					c.Set("Access-Control-Allow-Headers", reqHeaders)
				} else {
					c.Set("Access-Control-Allow-Headers", corsAllowHeaders)
				}
				c.Set("Access-Control-Allow-Methods", corsAllowMethods)
				c.Set("Access-Control-Max-Age", "86400")
			}
			return c.SendStatus(fiber.StatusNoContent)
		}
		return c.Next()
	})

	// Endpoint de diagnóstico CORS — devolve o que o backend ESTÁ
	// respondendo pro origin do browser. Útil pra distinguir
	// "backend não setou header" de "edge proxy/CDN comeu o header".
	// GET /v1/cors-debug?origin=https://app.uniq.chat
	app.Get("/v1/cors-debug", func(c *fiber.Ctx) error {
		origin := c.Query("origin", c.Get("Origin"))
		return c.JSON(fiber.Map{
			"origin_received":      c.Get("Origin"),
			"origin_tested":        origin,
			"would_allow":          corsAllowed(origin),
			"cors_allow_list":      corsAllowList,
			"frontend_url_env":     config.AppConfig.FrontendURL,
			"response_acao_header": c.GetRespHeader("Access-Control-Allow-Origin"),
		})
	})

	// Global middleware
	app.Use(recover.New())
	app.Use(logger.New())

	// Force HTTPS in production. Trust X-Forwarded-Proto from the
	// reverse proxy (the TLS terminator forwards us plain HTTP) and
	// never redirect WebSocket upgrades — browsers don't follow 301
	// on WS, so the event channel would break.
	if config.AppConfig.AppURL != "" && strings.HasPrefix(config.AppConfig.AppURL, "https") {
		app.Use(func(c *fiber.Ctx) error {
			if strings.EqualFold(c.Get("Upgrade"), "websocket") {
				return c.Next()
			}
			if c.Protocol() == "https" {
				return c.Next()
			}
			if strings.EqualFold(c.Get("X-Forwarded-Proto"), "https") {
				return c.Next()
			}
			httpsURL := "https://" + c.Hostname() + c.OriginalURL()
			return c.Redirect(httpsURL, fiber.StatusMovedPermanently)
		})
	}

	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "service": "uniq-chat"})
	})

	// /ready — readiness check robusto pra load balancer / orchestrator
	// (Dokploy, K8s, ECS). Diferente do /health (liveness, "processo
	// está vivo"), /ready confirma que dependências críticas respondem
	// (DB, MinIO se configurado). Retorna 503 se algo essencial está
	// fora — load balancer remove o pod do roteamento até voltar.
	app.Get("/ready", func(c *fiber.Ctx) error {
		checks := map[string]string{}
		ready := true
		// DB ping com timeout curto pra não segurar o orchestrator.
		if sqlDB, err := db.DB(); err == nil {
			ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
			defer cancel()
			if err := sqlDB.PingContext(ctx); err != nil {
				checks["db"] = "down: " + err.Error()
				ready = false
			} else {
				checks["db"] = "ok"
			}
		} else {
			checks["db"] = "down: " + err.Error()
			ready = false
		}
		status := fiber.StatusOK
		if !ready {
			status = fiber.StatusServiceUnavailable
		}
		return c.Status(status).JSON(fiber.Map{
			"ready":  ready,
			"checks": checks,
		})
	})

	// Channels metadata (public — used by UI to list available channels)
	channelsHandler := func(c *fiber.Ctx) error {
		type channelInfo struct {
			ID          string `json:"id"`
			Label       string `json:"label"`
			Color       string `json:"color"`
			Description string `json:"description"`
			Available   bool   `json:"available"`
		}
		channels := []channelInfo{
			{ID: "whatsapp", Label: "WhatsApp Business", Color: "#25d366", Description: "Não-oficial via QR ou código de pareamento (whatsmeow)", Available: true},
			{ID: "waba", Label: "WhatsApp API", Color: "#0088ff", Description: "Cloud API oficial Meta (WABA) com Embedded Signup + templates HSM", Available: true},
			{ID: "instagram", Label: "Instagram Profile", Color: "#e1306c", Description: "Login não-oficial — DMs, scraping, follow/unfollow", Available: true},
			{ID: "instagram_api", Label: "Instagram API", Color: "#cc2366", Description: "Em breve — API oficial Meta (Messaging Graph API)", Available: false},
			{ID: "tiktok", Label: "TikTok", Color: "#ff0050", Description: "DMs, scraping, follow/unfollow", Available: false},
			{ID: "facebook", Label: "Facebook", Color: "#1877f2", Description: "Facebook Messenger via Meta API", Available: false},
			{ID: "telegram", Label: "Telegram", Color: "#229ed9", Description: "Bots via Telegram Bot API", Available: false},
			{ID: "linkedin", Label: "LinkedIn", Color: "#0a66c2", Description: "Mensagens via LinkedIn API", Available: false},
			{ID: "kwai", Label: "Kwai", Color: "#ff6600", Description: "Mensagens via Kwai", Available: false},
		}
		return c.JSON(channels)
	}
	app.Get("/channels", channelsHandler)
	app.Get("/v1/channels", channelsHandler)

	// Email service — Maileroo. Prioridade: DB (admin atualiza via UI) > env.
	// Se nenhum estiver configurado, `send()` retorna erro cedo e os handlers
	// só logam o erro (convite ainda é criado e o link é retornado pro usuário
	// compartilhar manualmente).
	emailAPIKey := config.AppConfig.MailerooAPIKey
	emailFrom := config.AppConfig.MailerooSenderEmail
	emailFromName := config.AppConfig.MailerooSenderName

	var dbEmailSettings models.EmailSettings
	if err := db.Order("updated_at DESC").First(&dbEmailSettings).Error; err == nil && dbEmailSettings.IsEnabled {
		if dbEmailSettings.APIKey != "" {
			emailAPIKey = dbEmailSettings.APIKey
		}
		if dbEmailSettings.SenderEmail != "" {
			emailFrom = dbEmailSettings.SenderEmail
		}
		if dbEmailSettings.SenderName != "" {
			emailFromName = dbEmailSettings.SenderName
		}
	}

	emailSvc := email.New(
		emailAPIKey,
		emailFrom,
		emailFromName,
		config.AppConfig.AppName,
		config.AppConfig.AppURL,
	)
	handlers.SetAuthHandlerAppURL(config.AppConfig.AppURL)
	// Plug email no journey executor pra StepTypeEmail (Fase 4). O
	// executor é criado no main.go como singleton — pegamos do global.
	if services.GlobalJourneyExecutor != nil {
		services.GlobalJourneyExecutor.SetEmail(emailSvc)
	}

	// Handlers
	stripeH := handlers.NewStripeHandler(db, emailSvc)
	asaasH := handlers.NewAsaasHandler(db, emailSvc)
	abacatepayH := handlers.NewAbacatePayHandler(db, emailSvc)
	authH := handlers.NewAuthHandler(db, emailSvc, manager, abacatepayH, asaasH)
	paymentH := handlers.NewPaymentHandler(db, emailSvc, stripeH, asaasH, abacatepayH)
	instanceH := handlers.NewInstanceHandler(db, manager)
	proxyH := handlers.NewProxyHandler(db, manager)
	msgH := handlers.NewMessageHandler(db, manager)
	webhookH := handlers.NewWebhookHandler(db, manager)
	globalWebhookH := handlers.NewGlobalWebhookHandler(db)
	webhookLogsH := handlers.NewWebhookLogsHandler(db)
	apiKeyH := handlers.NewAPIKeyHandler(db)
	adminH := handlers.NewAdminHandler(db, emailSvc)
	adminH.SetManager(manager) // permite propagar mudanças de proxy global às instâncias em runtime
	wsH := handlers.NewWSHandler(db, manager)
	mcpH := handlers.NewMCPHandler(db, manager)
	contactH := handlers.NewContactHandler(db)
	groupH := handlers.NewGroupHandler(db, manager)
	instanceLogH := handlers.NewInstanceLogHandler(db)
	campaignH := handlers.NewCampaignHandler(db, manager)
	triggerH := handlers.NewTriggerHandler(db)
	warmupH := handlers.NewWarmupHandler(db, manager)
	otpH := handlers.NewOTPHandler(db, manager)
	serverH := handlers.NewServerHandler(db, whatsapp.GetHub())
	integrationH := handlers.NewIntegrationHandler(db)
	recoveryH := handlers.NewRecoveryHandler(db, manager)

	// TikTok automation (legacy taktik bridge)
	taktikSvc := services.NewTaktikService(db)
	tiktokH := handlers.NewTikTokHandler(db, taktikSvc)

	// AI Services. Inject DB pra LLMService poder cair pra PlatformAI ativa
	// quando caller não passa UserIntegration (em vez de errar com
	// OPENAI_API_KEY ausente).
	llmService := services.NewLLMService()
	llmService.SetDB(db)
	// Injeta o LLM no integrationH pra alimentar o endpoint de preview
	// de agente — só funciona se a llmService já existir, então fica
	// depois da criação dela.
	integrationH.SetLLM(llmService)
	helpDeskH := handlers.NewHelpDeskHandler(db, llmService)
	webChatH := handlers.NewWebChatHandler(db, llmService)
	toolsH := handlers.NewToolsHandler(db, manager)
	chatH := handlers.NewChatHandler(db, llmService)
	chatH.SetToolsHandler(toolsH)
	journeyH := handlers.NewJourneyHandler(db, llmService, manager)
	agentH := handlers.NewAgentHandler(db)
	inboxH := handlers.NewInboxHandler(db, manager)
	workspaceH := handlers.NewWorkspaceHandler(db, emailSvc)
	roleH := handlers.NewRoleHandler(db)
	inviteH := handlers.NewInviteHandler(db)
	// Build outbound registry once and share across handlers.
	igSvc := services.NewInstagramService(db)
	outboundReg := outbound.NewRegistry(db, manager, igSvc, taktikSvc)
	// CRM task runner — executa CrmTasks com assignee_type=agent quando
	// due_at chega. Boot único; vive enquanto o servidor estiver up.
	crmtasks.NewCrmTaskRunner(db, llmService, outboundReg).Start(context.Background())
	// Shared pipeline reference so the backfill endpoint can run it on demand.
	conversationPipeline := services.NewInboundPipeline(db, whatsapp.GetHub())
	conversationPipeline.SetAutomationHandler(manager)
	conversationH := handlers.NewConversationHandler(db, manager, outboundReg, conversationPipeline, llmService)
	departmentH := handlers.NewDepartmentHandler(db)
	teamH := handlers.NewTeamHandler(db)
	queueH := handlers.NewQueueHandler(db)
	presenceH := handlers.NewPresenceHandler(db)
	quickReplyH := handlers.NewQuickReplyHandler(db)
	csatH := handlers.NewCSATHandler(db, manager)
	reportsH := handlers.NewReportsHandler(db)
	companyH := handlers.NewCompanyHandler(db)
	dealH := handlers.NewDealHandler(db)
	funnelViewH := handlers.NewFunnelViewHandler(db)
	contactGroupH := handlers.NewContactGroupHandler(db, manager)

	// WABA
	wabaH := handlers.NewWABAHandler(db)
	wabaH.SetInboundPipeline(conversationPipeline)
	campaignH.SetInboundPipeline(conversationPipeline)

	// Instagram inbound poller — faz polling de DMs a cada 30s e injeta
	// mensagens novas no pipeline (instagrapi não tem webhooks nativos).
	igPoller := services.NewInstagramPoller(db, igSvc, conversationPipeline)
	igPoller.Start()
	instanceH.SetInstagramPoller(igPoller)

	// Plans (public — used by pricing/register page)
	app.Get("/stripe/plans", paymentH.ListPlans)
	app.Get("/asaas/plans", paymentH.ListPlans)
	app.Get("/payments/plans", paymentH.ListPlans)

	// v1 aliases for plans (public, release 1.1 compatibility)
	app.Get("/v1/stripe/plans", paymentH.ListPlans)
	app.Get("/v1/asaas/plans", paymentH.ListPlans)
	app.Get("/v1/payments/plans", paymentH.ListPlans)

	mediaH := handlers.NewMediaHealthHandler(db)

	// Media proxy routes must be registered before the public wildcard below.
	// Otherwise /v1/media/download is treated as key="download" and the
	// query param with the real object key is ignored.
	app.Get("/v1/media/download", middleware.RequireAuth(db), middleware.RateLimit(1500), mediaH.Download)
	app.Get("/v1/media/stream", middleware.RequireAuth(db), middleware.RateLimit(1500), mediaH.Stream)
	app.Get("/v1/media/files", middleware.RequireAuth(db), middleware.RateLimit(1500), mediaH.FindFile)
	app.Get("/v1/media/files/:id", middleware.RequireAuth(db), middleware.RateLimit(1500), mediaH.GetFile)
	app.Get("/v1/media/files/:id/download", middleware.RequireAuth(db), middleware.RateLimit(1500), mediaH.DownloadFile)
	app.Get("/v1/media/files/:id/stream", middleware.RequireAuth(db), middleware.RateLimit(1500), mediaH.StreamFile)
	app.Get("/m/:id", middleware.RateLimit(1500), mediaH.PublicRedirectFile)
	app.Get("/m/:id/stream", middleware.RateLimit(1500), mediaH.PublicRedirectFile)
	app.Get("/m/:id/download", middleware.RateLimit(1500), mediaH.PublicDownloadFile)

	// Media by key — redireciona pra signed URL (TTL curto). Usado pelo
	// frontend quando o resolver server-side não conseguiu embedar a URL
	// resolvida no payload da mensagem (presign falhou, mídia muito antiga,
	// etc.). É público pra <audio src>/<img src> não precisar de auth header.
	//
	// Aceita key com `/` via wildcard (`*`) — necessário pro layout real do
	// bucket (`media/<instance_id>/<yyyy>/<mm>/<uuid>.<ext>`). O fallback
	// `:key` continua funcionando pra keys flat.
	mediaHandler := func(c *fiber.Ctx) error {
		key := c.Params("+")
		if key == "" {
			key = c.Params("*")
		}
		if key == "" {
			key = c.Params("key")
		}
		if key == "" {
			return c.Status(fiber.StatusBadRequest).SendString("missing key")
		}
		if storage.GlobalStorage == nil {
			return c.Status(fiber.StatusServiceUnavailable).SendString("storage não inicializado")
		}
		ctx, cancel := context.WithTimeout(c.Context(), 5*time.Second)
		defer cancel()
		signed, err := storage.GlobalStorage.PresignURL(ctx, key, 30*time.Minute)
		if err != nil {
			return c.Status(fiber.StatusNotFound).SendString("media not found")
		}
		return c.Redirect(signed, fiber.StatusFound)
	}
	app.Get("/v1/media/+", mediaHandler)
	app.Get("/media/+", mediaHandler)

	// Stripe webhook (public — must receive raw body, Stripe signature verified internally)
	app.Post("/stripe/webhook", stripeH.Webhook)
	// Aliases versionados/agnósticos — alinha com o resto da API e
	// segue o padrão de /v1/payments/* (provider-agnostic). Stripe/
	// Asaas configs no painel agora geram essa URL.
	app.Post("/v1/stripe/webhook", stripeH.Webhook)
	app.Post("/v1/payments/webhook/stripe", stripeH.Webhook)

	// Activate lead after payment (public). Rate limit anti-abuse:
	// é endpoint público que confere session_id da Stripe contra
	// pending — sem limite, atacante pode iterar IDs em busca de
	// pendings expostos. 10/min é suficiente pro flow legítimo
	// (1 chamada por user pós-checkout).
	app.Post("/stripe/activate-lead", middleware.RateLimit(10), stripeH.ActivateLead)

	// Endpoint genérico (provider-agnóstico) — webhook é o caminho
	// preferido (Stripe já materializou o user) e a consulta à API do
	// provider é fallback. Front faz poll curto até receber 200 ou desistir.
	app.Post("/v1/payments/finalize-registration", paymentH.FinalizeRegistration)
	app.Post("/payments/finalize-registration", paymentH.FinalizeRegistration)
	// Aliases legados (Stripe-específicos) — mantidos por compat
	app.Post("/stripe/finalize-registration", stripeH.FinalizeRegistration)
	app.Post("/v1/stripe/finalize-registration", stripeH.FinalizeRegistration)

	// Asaas webhook (public)
	app.Post("/asaas/webhook", asaasH.Webhook)
	app.Post("/v1/asaas/webhook", asaasH.Webhook)
	app.Post("/v1/payments/webhook/asaas", asaasH.Webhook)

	// AbacatePay webhook (public)
	app.Post("/abacatepay/webhook", abacatepayH.HandleWebhook)
	app.Post("/v1/abacatepay/webhook", abacatepayH.HandleWebhook)
	app.Get("/abacatepay/webhook", abacatepayH.HandleReturn)
	app.Get("/v1/abacatepay/webhook", abacatepayH.HandleReturn)

	// ─── Auth routes (public) ─────────────────────────────────────────────────
	// Rate limits separados por sensibilidade:
	//   register: 30/min — cada tentativa cria no máx 1 conta; email/username
	//     únicos já barram duplicatas. Limite alto pra não bloquear testes.
	//   forgot/reset: 5/min — alvo de enumeração de e-mails e força bruta.
	//   login: 30/min — typo de senha + múltiplos devices + SSO retries.
	//   validate/refresh: 60/min — chamados pela UI em polling contínuo.
	// Limites apertados em endpoints públicos pra mitigar brute-force,
	// enumeração de emails e DoS via cadastro em massa. Antes eram
	// generosos demais (30/min em register permitia 1800 tentativas/h
	// vindo de 1 IP — basta usar proxy pool pra escalar).
	// /register tem 3 endpoints sequenciais (/start, /verify, /complete)
	// + retries por OTP errado, então 10/min é o mínimo razoável sem
	// bloquear flow legítimo. RateLimit usa IP real (CF-Connecting-IP)
	// agora; antes todos compartilhavam o IP do proxy e 5/min estourava
	// com 1-2 users simultâneos no onboarding.
	authRegister := middleware.RateLimit(30)
	authSensitive := middleware.RateLimit(5) // forgot/reset/verify (anti-enum, mas não tão agressivo a ponto de bloquear sequência completa)
	authLogin := middleware.RateLimit(15)    // typo + multi-device + multi-aba toleráveis; brute force inviável (precisa senha correta)
	authValidate := middleware.RateLimit(60) // UI faz polling, mantém alto
	auth := app.Group("/auth")
	auth.Post("/login", authLogin, authH.Login)
	auth.Post("/register", authRegister, authH.Register)
	// Magic-link registration flow (new)
	auth.Post("/register/start", authRegister, authH.RegisterStart)
	auth.Post("/register/verify", authRegister, authH.RegisterVerify)
	auth.Post("/register/complete", authRegister, authH.RegisterComplete)
	auth.Post("/validate-key", authValidate, authH.ValidateKey)
	auth.Post("/refresh", authValidate, authH.Refresh)
	auth.Post("/logout", authH.Logout)
	auth.Post("/forgot-password", authSensitive, authH.ForgotPassword)
	auth.Post("/reset-password", authSensitive, authH.ResetPassword)
	auth.Post("/verify-email", authSensitive, authH.VerifyEmail)
	auth.Post("/resend-verification", authSensitive, authH.ResendVerification)
	// 2FA: setup/enable/disable são autenticados; verify é público (chamado
	// após /login retornar requires_2fa).
	auth.Post("/2fa/verify", authLogin, authH.Verify2FA)
	auth.Post("/2fa/setup", middleware.RequireAuth(db), authH.Setup2FA)
	auth.Post("/2fa/enable", middleware.RequireAuth(db), authH.Enable2FA)
	auth.Post("/2fa/disable", middleware.RequireAuth(db), authH.Disable2FA)
	auth.Get("/me", middleware.RequireAuth(db), authH.Me)
	auth.Put("/me", middleware.RequireAuth(db), authH.UpdateMe)
	auth.Post("/change-password", middleware.RequireAuth(db), authH.ChangePassword)

	// ─── Public v1 routes (no auth required) ─────────────────────────────────
	v1Public := app.Group("/v1")

	// Invite system (public) — rate limit pra evitar enumeração de tokens.
	v1Public.Get("/invites/status", inviteH.GetStatus)
	v1Public.Post("/invites/validate", middleware.RateLimit(10), inviteH.Validate)

	// Claude OAuth client metadata — público (Anthropic faz GET aqui para validar client_id)
	v1Public.Get("/integrations/claude/client-metadata", integrationH.ClaudeOAuthClientMetadata)

	// Workspace invite preview — público pra decidir se mandamos o
	// destinatário pra /login ou /register.
	v1Public.Get("/workspaces/invites/preview/:token", middleware.RateLimit(10), workspaceH.PreviewInvite)

	// Auth aliases em /v1/auth/* — o frontend chama com o prefixo /v1.
	// Mantemos os originais em /auth/* também (retrocompat com SDKs).
	v1PublicAuth := v1Public.Group("/auth")
	v1PublicAuth.Post("/login", authLogin, authH.Login)
	v1PublicAuth.Post("/register", authRegister, authH.Register)
	v1PublicAuth.Post("/register/start", authRegister, authH.RegisterStart)
	v1PublicAuth.Post("/register/verify", authRegister, authH.RegisterVerify)
	v1PublicAuth.Post("/register/complete", authRegister, authH.RegisterComplete)
	v1PublicAuth.Post("/validate-key", authValidate, authH.ValidateKey)
	v1PublicAuth.Post("/refresh", authValidate, authH.Refresh)
	v1PublicAuth.Post("/logout", authH.Logout)
	v1PublicAuth.Post("/forgot-password", authSensitive, authH.ForgotPassword)
	v1PublicAuth.Post("/reset-password", authSensitive, authH.ResetPassword)
	v1PublicAuth.Post("/verify-email", authSensitive, authH.VerifyEmail)
	v1PublicAuth.Post("/resend-verification", authSensitive, authH.ResendVerification)
	v1PublicAuth.Post("/2fa/verify", authLogin, authH.Verify2FA)
	v1PublicAuth.Post("/2fa/setup", middleware.RequireAuth(db), authH.Setup2FA)
	v1PublicAuth.Post("/2fa/enable", middleware.RequireAuth(db), authH.Enable2FA)
	v1PublicAuth.Post("/2fa/disable", middleware.RequireAuth(db), authH.Disable2FA)

	// Public WebChat endpoints (no auth — accessed by the widget in the browser)
	app.Get("/v1/public/webchat/:token", webChatH.PublicGetConfig)
	app.Post("/v1/public/webchat/:token/message", middleware.RateLimit(30), webChatH.PublicMessage)
	app.Get("/v1/public/webchat/:token/articles", webChatH.PublicListArticles)

	// Public Help Desk endpoints — OptionalAuth extracts user if present so
	// checkHelpDeskVisibility can enforce workspace_users / uniq_users access.
	app.Get("/v1/public/helpdesk/:workspace_slug/config", middleware.OptionalAuth(db), helpDeskH.PublicGetConfig)
	app.Post("/v1/public/helpdesk/:workspace_slug/verify-access", middleware.OptionalAuth(db), helpDeskH.PublicVerifyAccess)
	app.Get("/v1/public/helpdesk/:workspace_slug/categories", middleware.OptionalAuth(db), helpDeskH.PublicListCategories)
	app.Get("/v1/public/helpdesk/:workspace_slug/articles", middleware.OptionalAuth(db), helpDeskH.PublicListArticles)
	app.Get("/v1/public/helpdesk/:workspace_slug/articles/:slug", middleware.OptionalAuth(db), helpDeskH.PublicGetArticle)
	app.Post("/v1/public/helpdesk/:workspace_slug/ask", middleware.OptionalAuth(db), middleware.RateLimit(20), helpDeskH.PublicAsk)
	app.Post("/v1/public/helpdesk/:workspace_slug/articles/:article_slug/ask", middleware.OptionalAuth(db), middleware.RateLimit(20), helpDeskH.PublicAskArticle)

	// CSAT public endpoints (no auth — customer answers via tokenized link)
	app.Get("/csat/:token", csatH.GetPublic)
	app.Post("/csat/:token", csatH.SubmitPublic)
	app.Get("/v1/csat/:token", csatH.GetPublic)
	app.Post("/v1/csat/:token", csatH.SubmitPublic)

	// ─── Public v1 API: /v1/:server_slug/:instance_slug/* ─────────────────────
	// Pre-rotas autenticadas pra /v1/instances/<uuid>/messages/* — declaradas
	// ANTES do v1inst group pra ganhar prioridade no roteamento. Sem isso,
	// o pattern /v1/:server_slug/:instance_slug/messages/* (v1inst, declarado
	// logo abaixo) casa primeiro com server_slug="instances" e o handler
	// retorna 404 sem c.Locals("instance").
	//
	// Atenção: NÃO usar app.Group("/v1/instances/:id", ...) aqui — o group
	// faz o middleware (RequireAuth + OwnsInstance) rodar pra qualquer URL
	// /v1/instances/<id>/* mesmo sem rota matching dentro do group, e o
	// request fica pendurado/404 em rotas declaradas só no api group
	// (profile, qr, settings, etc). Por isso registramos handler-por-handler
	// pra escopar só ao path exato.
	preMsgChain := []fiber.Handler{
		middleware.RequireAuth(db),
		middleware.OwnsInstance(db),
		middleware.RateLimit(1500),
	}
	registerPreMsg := func(path string, h fiber.Handler) {
		full := "/v1/instances/:id/messages" + path
		app.Post(full, append(preMsgChain, h)...)
	}
	// GET por ID — declarado primeiro pra ganhar match sobre os POSTs
	// que vêm a seguir (Fiber matcha em ordem de registro).
	app.Get("/v1/instances/:id/messages/:msgID", append(preMsgChain, msgH.GetMessage)...)
	registerPreMsg("/text", msgH.SendText)
	registerPreMsg("/image", msgH.SendImage)
	registerPreMsg("/document", msgH.SendDocument)
	registerPreMsg("/audio", msgH.SendAudio)
	registerPreMsg("/video", msgH.SendVideo)
	registerPreMsg("/location", msgH.SendLocation)
	registerPreMsg("/contact", msgH.SendContact)
	registerPreMsg("/reaction", msgH.SendReaction)
	registerPreMsg("/poll", msgH.SendPoll)
	registerPreMsg("/buttons", msgH.SendButtons)
	registerPreMsg("/template", msgH.SendTemplate)
	registerPreMsg("/list", msgH.SendList)
	registerPreMsg("/pix", msgH.SendPix)
	registerPreMsg("/pix-button", msgH.SendPixButton)
	registerPreMsg("/carousel", msgH.SendCarousel)
	registerPreMsg("/menu", msgH.SendMenu)
	registerPreMsg("/sticker", msgH.SendSticker)

	// Demais paths /v1/instances/<uuid>/* que TAMBÉM são registrados no
	// v1inst group (e por isso são interceptados antes do api group sem
	// c.Locals("instance") setado). Mesmo bug das mensagens — pre-declara
	// com auth pra ganhar prioridade. Apenas paths em conflito real.
	registerPreInst := func(method, path string, h fiber.Handler) {
		full := "/v1/instances/:id" + path
		switch method {
		case "GET":
			app.Get(full, append(preMsgChain, h)...)
		case "POST":
			app.Post(full, append(preMsgChain, h)...)
		}
	}
	// WebChat config routes (per instance, pre-auth chain).
	app.Get("/v1/instances/:id/webchat", append(preMsgChain, webChatH.GetConfig)...)
	app.Put("/v1/instances/:id/webchat", append(preMsgChain, webChatH.UpsertConfig)...)
	app.Get("/v1/instances/:id/webchat/snippet", append(preMsgChain, webChatH.GetEmbedSnippet)...)

	registerPreInst("GET", "/profile", instanceH.Profile)
	registerPreInst("GET", "/status", instanceH.Status)
	registerPreInst("GET", "/safety", instanceH.SafetyStatus)
	registerPreInst("POST", "/safety/resume", instanceH.ResumeSafety)
	registerPreInst("POST", "/safety/review", instanceH.KeepSafetyPaused)
	registerPreInst("GET", "/qr", instanceH.GetQR)
	registerPreInst("GET", "/chats", msgH.GetChats)
	registerPreInst("GET", "/contacts", msgH.GetContacts)
	// Groups: o pattern /v1/:server_slug/:instance_slug/groups/ era
	// matchado primeiro pelo v1inst group, que bypassa em "instances"
	// (reserved namespace) sem setar c.Locals("instance") — handler
	// devolvia 404. Pre-registrando aqui ganhamos prioridade e o
	// OwnsInstance middleware seta o instance corretamente.
	registerPreInst("GET", "/groups", groupH.List)
	registerPreInst("POST", "/groups", groupH.Create)
	registerPreInst("GET", "/groups/join-jobs", groupH.ListJoinJobs)
	registerPreInst("POST", "/groups/join-link", groupH.JoinLink)
	registerPreInst("POST", "/groups/join-links", groupH.JoinLinks)
	registerPreInst("GET", "/groups/:jid", groupH.Get)
	registerPreInst("POST", "/groups/:jid/participants", groupH.UpdateParticipants)
	registerPreInst("GET", "/groups/:jid/invite", groupH.InviteLink)
	registerPreInst("POST", "/groups/:jid/leave", groupH.Leave)
	app.Put("/v1/instances/:id/groups/:jid", append(preMsgChain, groupH.Update)...)
	// Calls — mesmo bug do groups (route hijacked pelo v1inst).
	registerPreInst("POST", "/calls/offer", msgH.OfferCall)
	registerPreInst("POST", "/calls/reject", msgH.RejectCall)
	registerPreInst("POST", "/pairing-code", instanceH.GetPairingCode)
	registerPreInst("POST", "/contact/info", instanceH.ContactInfo)
	registerPreInst("POST", "/contact/avatar", instanceH.ContactAvatar)
	registerPreInst("POST", "/media/upload", msgH.UploadMedia)
	registerPreInst("POST", "/check-number", msgH.CheckNumber)
	registerPreInst("POST", "/bulk-check", msgH.BulkCheckNumbers)

	// Help Desk + WebChat routes — pre-registradas antes do v1inst group para
	// evitar que /v1/:server_slug/:instance_slug/* intercepte /v1/helpdesk/*.
	hdChain := []fiber.Handler{
		middleware.RequireAuth(db),
		middleware.RateLimit(1500),
		middleware.RequireFeature(db, models.FeatureHelpDesk),
	}
	app.Get("/v1/helpdesk/config", append(hdChain, helpDeskH.GetConfig)...)
	app.Put("/v1/helpdesk/config", append(hdChain, helpDeskH.UpdateConfig)...)
	app.Get("/v1/helpdesk/categories", append(hdChain, helpDeskH.ListCategories)...)
	app.Post("/v1/helpdesk/categories", append(hdChain, helpDeskH.CreateCategory)...)
	app.Patch("/v1/helpdesk/categories/:id", append(hdChain, helpDeskH.UpdateCategory)...)
	app.Delete("/v1/helpdesk/categories/:id", append(hdChain, helpDeskH.DeleteCategory)...)
	app.Get("/v1/helpdesk/articles", append(hdChain, helpDeskH.ListArticles)...)
	app.Post("/v1/helpdesk/articles/generate", append(hdChain, helpDeskH.GenerateArticle)...)
	app.Post("/v1/helpdesk/articles/upload-hero", append(hdChain, helpDeskH.UploadHeroImage)...)
	app.Post("/v1/helpdesk/articles", append(hdChain, helpDeskH.CreateArticle)...)
	app.Get("/v1/helpdesk/articles/:id", append(hdChain, helpDeskH.GetArticle)...)
	app.Patch("/v1/helpdesk/articles/:id", append(hdChain, helpDeskH.UpdateArticle)...)
	app.Delete("/v1/helpdesk/articles/:id", append(hdChain, helpDeskH.DeleteArticle)...)
	app.Post("/v1/helpdesk/articles/:id/publish", append(hdChain, helpDeskH.PublishArticle)...)

	// Helpdesk widget endpoints — config do widget embarcável (GET/PUT).
	// GET auto-provisiona Instance(webchat) + WebChatConfig se não existirem.
	app.Get("/v1/helpdesk/widget", append(hdChain, helpDeskH.GetWidget)...)
	app.Put("/v1/helpdesk/widget", append(hdChain, helpDeskH.UpdateWidget)...)

	// Auth: apikey / X-Instance-Token / Authorization: Bearer <instance_token>.
	// IMPORTANT: registered BEFORE the protected /v1 group because Fiber's
	// Group middlewares only apply to routes registered AFTER them — declaring
	// this first keeps instance-token auth from being short-circuited by
	// RequireAuth (which would misread the instance token as an API key).
	// 600/min pra n8n/SDK externos — outbound massivo é o caso de uso
	// (envio de mensagens em campanha). Por instance token = um cliente.
	v1inst := app.Group("/v1/:server_slug/:instance_slug", middleware.ResolveV1Instance(db), middleware.RateLimit(600))

	// Messages
	v1msgs := v1inst.Group("/messages")
	v1msgs.Get("/", msgH.GetMessages)
	v1msgs.Get("/:msgID", msgH.GetMessage)
	v1msgs.Post("/text", msgH.SendText)
	v1msgs.Post("/image", msgH.SendImage)
	v1msgs.Post("/document", msgH.SendDocument)
	v1msgs.Post("/audio", msgH.SendAudio)
	v1msgs.Post("/video", msgH.SendVideo)
	v1msgs.Post("/location", msgH.SendLocation)
	v1msgs.Post("/contact", msgH.SendContact)
	v1msgs.Post("/reaction", msgH.SendReaction)
	v1msgs.Post("/poll", msgH.SendPoll)
	v1msgs.Post("/buttons", msgH.SendButtons)
	v1msgs.Post("/template", msgH.SendTemplate)
	v1msgs.Post("/list", msgH.SendList)
	v1msgs.Post("/pix", msgH.SendPix)
	v1msgs.Post("/pix-button", msgH.SendPixButton)
	v1msgs.Post("/carousel", msgH.SendCarousel)
	v1msgs.Post("/menu", msgH.SendMenu)
	v1msgs.Post("/sticker", msgH.SendSticker)
	v1msgs.Post("/status", msgH.SendStatus)
	v1msgs.Post("/presence", msgH.SendPresence)
	v1msgs.Post("/payment-request", msgH.RequestPayment)
	v1msgs.Post("/revoke", msgH.RevokeMessage)
	v1msgs.Post("/typing", msgH.SendTyping)
	v1msgs.Post("/read", msgH.MarkRead)
	v1msgs.Post("/link", msgH.SendLink)
	v1msgs.Post("/edit", msgH.EditMessage)

	// Paridade Evo-Go no SDK público
	v1chat := v1inst.Group("/chat")
	v1chat.Post("/pin", msgH.PinChat)
	v1chat.Post("/archive", msgH.ArchiveChat)
	v1chat.Post("/mute", msgH.MuteChat)
	v1chat.Post("/history-sync", msgH.HistorySync)

	v1profile := v1inst.Group("/profile")
	v1profile.Put("/name", msgH.UpdateProfileName)
	v1profile.Put("/status", msgH.UpdateProfileStatus)
	v1profile.Put("/picture", msgH.UpdateProfilePicture)

	v1inst.Post("/block", msgH.BlockUser)
	v1inst.Post("/unblock", msgH.UnblockUser)
	v1inst.Get("/blocklist", msgH.GetBlocklist)

	v1groupOps := v1inst.Group("/group-ops")
	v1groupOps.Put("/photo", msgH.SetGroupPhoto)
	v1groupOps.Put("/announce", msgH.SetGroupAnnounceMode)
	v1groupOps.Put("/locked", msgH.SetGroupLockedMode)

	v1labels := v1inst.Group("/labels")
	v1labels.Post("/chat", msgH.LabelChat)
	v1labels.Post("/message", msgH.LabelMessage)
	v1labels.Post("/edit", msgH.EditLabel)

	v1privacy := v1inst.Group("/privacy")
	v1privacy.Get("/", msgH.GetPrivacy)
	v1privacy.Put("/", msgH.SetPrivacy)

	v1inst.Post("/force-reconnect", msgH.ForceReconnect)

	v1communities := v1inst.Group("/communities")
	v1communities.Post("/", msgH.CreateCommunity)
	v1communities.Post("/link", msgH.LinkCommunityGroup)
	v1communities.Post("/unlink", msgH.UnlinkCommunityGroup)
	v1communities.Get("/:jid/groups", msgH.ListCommunityGroups)

	v1newsletters := v1inst.Group("/newsletters")
	v1newsletters.Post("/", msgH.CreateNewsletter)
	v1newsletters.Get("/", msgH.ListNewsletters)
	v1newsletters.Get("/:jid", msgH.GetNewsletterInfo)
	v1newsletters.Post("/:jid/follow", msgH.FollowNewsletter)
	v1newsletters.Post("/:jid/unfollow", msgH.UnfollowNewsletter)
	v1newsletters.Get("/:jid/messages", msgH.GetNewsletterMessages)

	v1inst.Post("/calls/reject", msgH.RejectCall)
	v1inst.Post("/calls/offer", msgH.OfferCall)

	// Extras whatsmeow no SDK público
	v1inst.Get("/business-profile/:jid", msgH.GetBusinessProfile)
	v1inst.Post("/disappearing", msgH.SetDisappearing)
	v1inst.Post("/disappearing/default", msgH.SetDisappearingDefault)
	v1inst.Post("/groups/join-with-invite", msgH.JoinGroupViaInvite)
	v1inst.Post("/groups/preview-invite", msgH.PreviewGroupInvite)
	v1inst.Get("/groups/preview-link", msgH.PreviewGroupLink)
	v1inst.Get("/groups/:jid/requests", msgH.ListGroupRequests)
	v1inst.Post("/groups/:jid/requests", msgH.UpdateGroupRequests)
	v1inst.Get("/communities/:jid/participants", msgH.ListCommunityParticipants)
	v1newsletters.Post("/:jid/mark-viewed", msgH.NewsletterMarkViewed)
	v1newsletters.Post("/:jid/react", msgH.NewsletterReact)
	v1newsletters.Post("/:jid/mute", msgH.NewsletterMute)
	v1inst.Post("/tos/accept", msgH.AcceptTOS)
	v1inst.Get("/status-privacy", msgH.GetStatusPrivacy)
	v1inst.Get("/resolve/business-link", msgH.ResolveBusinessLink)
	v1inst.Get("/resolve/contact-qr", msgH.ResolveContactQR)
	v1inst.Get("/qr-link", msgH.GetSelfQRLink)

	v1inst.Post("/media/upload", msgH.UploadMedia)
	v1inst.Get("/chats", msgH.GetChats)
	v1inst.Get("/contacts", msgH.GetContacts)
	v1inst.Post("/check-number", msgH.CheckNumber)
	v1inst.Post("/bulk-check", msgH.BulkCheckNumbers)

	// Instance state
	v1inst.Get("/status", instanceH.Status)
	v1inst.Get("/profile", instanceH.Profile)
	v1inst.Get("/qr", instanceH.GetQR)
	v1inst.Post("/pairing-code", instanceH.GetPairingCode)
	v1inst.Post("/contact/info", instanceH.ContactInfo)
	v1inst.Post("/contact/avatar", instanceH.ContactAvatar)

	// OTP
	v1otp := v1inst.Group("/otp")
	v1otp.Post("/send", otpH.Send)
	v1otp.Post("/verify", otpH.Verify)
	v1otp.Post("/resend", otpH.Resend)
	v1otp.Get("/sessions", otpH.Sessions)

	// Groups
	v1groups := v1inst.Group("/groups")
	v1groups.Get("/", groupH.List)
	v1groups.Post("/", groupH.Create)
	v1groups.Get("/join-jobs", groupH.ListJoinJobs)
	v1groups.Post("/join-link", groupH.JoinLink)
	v1groups.Post("/join-links", groupH.JoinLinks)
	v1groups.Get("/:jid", groupH.Get)
	v1groups.Put("/:jid", groupH.Update)
	v1groups.Post("/:jid/participants", groupH.UpdateParticipants)
	v1groups.Get("/:jid/invite", groupH.InviteLink)
	v1groups.Post("/:jid/leave", groupH.Leave)

	// ─── Protected routes ─────────────────────────────────────────────────────
	// 1500/min pra UI da plataforma — inbox tem várias queries
	// concorrentes (list + count + stats + timeline + WS invalidations
	// + media presign), 300/min era apertado e quebrava UX.
	api := app.Group("/v1", middleware.RequireAuth(db), middleware.RateLimit(1500))

	// Workspaces
	workspaces := api.Group("/workspaces")
	workspaces.Get("/", workspaceH.List)
	workspaces.Post("/", workspaceH.Create)
	workspaces.Post("/accept-invite/:token", workspaceH.AcceptInvite)
	// Convites pendentes endereçados ao user atual — alimenta o banner in-app
	// que avisa "você foi convidado pra um workspace" sem depender só do email.
	workspaces.Get("/my-invites", workspaceH.MyPendingInvites)

	// Workspace-specific routes
	workspace := workspaces.Group("/:id")
	workspace.Get("/", workspaceH.Get)
	workspace.Put("/", workspaceH.Update)
	workspace.Delete("/", workspaceH.Delete)
	workspace.Get("/members", workspaceH.ListMembers)
	workspace.Patch("/members/:member_id", workspaceH.UpdateMember)
	workspace.Delete("/members/:member_id", workspaceH.RemoveMember)
	workspace.Post("/invites", workspaceH.CreateInvite)
	workspace.Get("/invites", workspaceH.ListInvites)
	workspace.Delete("/invites/:invite_id", workspaceH.RevokeInvite)
	workspace.Post("/invites/:invite_id/resend", workspaceH.ResendInvite)

	// Roles (nested under workspace)
	roles := workspace.Group("/roles")
	roles.Get("/", roleH.List)
	roles.Post("/", roleH.Create)
	roles.Get("/:role_id", roleH.Get)
	roles.Put("/:role_id", roleH.Update)
	roles.Delete("/:role_id", roleH.Delete)

	// Global System Webhooks
	// Billing — upgrade/cancel/preview com Stripe proration nativo.
	billingH := handlers.NewBillingHandler(db)
	billing := api.Group("/billing")
	billing.Get("/status", billingH.Status)
	billing.Get("/preview/:planId", billingH.PreviewUpgrade)
	billing.Post("/upgrade", billingH.Upgrade)
	billing.Post("/cancel", billingH.Cancel)
	billing.Post("/resume", billingH.Resume)

	// Usage / Credits — painel de consumo do user (estilo Claude Code).
	// Recorder vem do singleton seedado no main.go; se ainda não tiver
	// (boot order) cai pra um vazio inocente.
	usageH := handlers.NewUsageHandler(db, services.GetGlobalUsageRecorder())
	usage := api.Group("/usage")
	usage.Get("/me", usageH.GetMyUsage)
	usage.Get("/me/events", usageH.ListMyEvents)
	usage.Get("/me/timeseries", usageH.GetMyTimeseries)
	usage.Get("/me/topups", usageH.ListMyTopups)
	usage.Post("/me/overage", usageH.SetOverage)
	// Top-up checkout — gera Stripe Checkout Session em mode=payment
	// pra comprar créditos avulsos. Webhook handleCheckoutCompleted
	// detecta type=topup e aplica via ApplyTopupFromCheckout.
	usage.Post("/me/topup-checkout", usageH.CreateTopupCheckout)
	usage.Get("/topup-packs", usageH.ListTopupPacks)

	systemWebhooks := api.Group("/webhooks/system")
	systemWebhooks.Get("/events", globalWebhookH.ListEvents)
	systemWebhooks.Get("/events/:eventID/preview", webhookLogsH.PreviewEvent)
	systemWebhooks.Get("/", globalWebhookH.List)
	systemWebhooks.Post("/", globalWebhookH.Create)
	systemWebhooks.Put("/:id", globalWebhookH.Update)
	systemWebhooks.Delete("/:id", globalWebhookH.Delete)
	systemWebhooks.Post("/:id/test", webhookLogsH.TestGlobalWebhook) // versão nova com event_id
	systemWebhooks.Get("/:id/deliveries", webhookLogsH.ListGlobalDeliveries)
	systemWebhooks.Post("/:id/deliveries/:deliveryId/retry", webhookLogsH.RetryGlobalDelivery)

	// Permissions (global)
	api.Get("/permissions", roleH.ListPermissions)
	api.Post("/permissions/seed", middleware.RequireAdmin(), roleH.SeedPermissions)

	// Invite system (protected)
	api.Post("/invites/generate", inviteH.Generate)
	api.Get("/invites/mine", inviteH.ListMine)

	// Instances
	instances := api.Group("/instances")
	instances.Get("/", middleware.RequireAuth(db), instanceH.List)
	instances.Post("/", middleware.RequireAuth(db), instanceH.Create)

	// Instance-specific routes (with ownership check)
	instance := instances.Group("/:id", middleware.OwnsInstance(db))
	instance.Get("/", instanceH.Get)
	instance.Patch("/", instanceH.Patch)
	instance.Delete("/", instanceH.Delete)
	instance.Get("/qr", instanceH.GetQR)
	instance.Post("/pairing-code", instanceH.GetPairingCode)
	instance.Post("/disconnect", instanceH.Disconnect)
	instance.Post("/reconnect", instanceH.Reconnect)
	instance.Get("/status", instanceH.Status)
	instance.Get("/safety", instanceH.SafetyStatus)
	instance.Post("/safety/resume", instanceH.ResumeSafety)
	instance.Post("/safety/review", instanceH.KeepSafetyPaused)
	instance.Post("/contact/info", instanceH.ContactInfo)
	instance.Post("/contact/avatar", instanceH.ContactAvatar)

	// Instagram routes
	instance.Post("/instagram/login", instanceH.InstagramLogin)
	instance.Post("/instagram/logout", instanceH.InstagramLogout)
	instance.Post("/instagram/dm", instanceH.InstagramSendDM)
	instance.Get("/instagram/dm", instanceH.InstagramGetInbox)
	instance.Post("/instagram/dm/reply", instanceH.InstagramDMReply)
	instance.Get("/instagram/dm/thread", instanceH.InstagramGetThread)
	instance.Post("/instagram/follow", instanceH.InstagramFollow)
	instance.Post("/instagram/unfollow", instanceH.InstagramUnfollow)
	instance.Post("/instagram/pause", instanceH.InstagramPause)
	instance.Post("/instagram/resume", instanceH.InstagramResume)
	instance.Post("/instagram/post", instanceH.InstagramPublishPost)
	instance.Post("/instagram/story", instanceH.InstagramUploadStory)
	instance.Get("/instagram/media", instanceH.InstagramGetUserMedia)
	instance.Post("/instagram/like", instanceH.InstagramLikeMedia)
	instance.Post("/instagram/unlike", instanceH.InstagramUnlike)
	instance.Post("/instagram/comment", instanceH.InstagramComment)
	instance.Get("/instagram/comments", instanceH.InstagramGetComments)
	instance.Get("/instagram/search/users", instanceH.InstagramSearchUsers)
	instance.Get("/instagram/hashtag", instanceH.InstagramHashtag)
	instance.Get("/instagram/profile", instanceH.InstagramGetProfile)
	instance.Post("/instagram/challenge", instanceH.InstagramChallenge)
	instance.Post("/instagram/challenge/resend", instanceH.InstagramChallengeResend)
	instance.Get("/profile", instanceH.Profile)
	instance.Get("/settings", instanceH.GetSettings)
	instance.Put("/settings", instanceH.UpdateSettings)
	instance.Post("/regenerate-token", instanceH.RegenerateToken)

	// WABA routes
	waba := api.Group("/waba")
	waba.Get("/auth-url", wabaH.GetAuthURL)
	waba.Post("/callback", wabaH.Callback)

	// Public webhook (no auth required) — Meta envia GET para validar (hub.challenge)
	// e POST com eventos. Registra ambos métodos em "/waba/webhook" e "/waba/webhook/".
	wabaWebhook := app.Group("/waba/webhook")
	wabaWebhook.Get("/", wabaH.Webhook)
	wabaWebhook.Post("/", wabaH.Webhook)
	app.Get("/waba/webhook", wabaH.Webhook)
	app.Post("/waba/webhook", wabaH.Webhook)

	// Instance-specific WABA routes
	instanceWaba := instance.Group("/waba")
	instanceWaba.Get("/", wabaH.GetWABA)
	instanceWaba.Delete("/", wabaH.DeleteWABA)
	instanceWaba.Get("/phone-numbers", wabaH.ListPhoneNumbers)
	instanceWaba.Get("/templates", wabaH.ListTemplates)
	instanceWaba.Post("/templates", wabaH.CreateTemplate)
	// Template defaults — usuário salva URL de mídia/local uma vez por
	// template+idioma e o front auto-preenche em chamadas futuras
	// (Meta exige um link/handle fresco em cada envio, mas a fonte da
	// URL pode vir do nosso DB sem digitação repetida).
	instanceWaba.Get("/templates/defaults", wabaH.ListTemplateDefaults)
	instanceWaba.Put("/templates/defaults", wabaH.UpsertTemplateDefault)
	// Upload direto de mídia pra usar como header de template — sobe
	// pro MinIO da Uniq e devolve URL pública pronta pra Meta. Elimina
	// dependência de S3/Cloudinary externo do user.
	instanceWaba.Post("/templates/upload-media", wabaH.UploadTemplateMedia)
	instanceWaba.Get("/templates/:templateId", wabaH.GetTemplate)
	instanceWaba.Post("/templates/:templateId", wabaH.EditTemplate)
	instanceWaba.Delete("/templates/:name", wabaH.DeleteTemplate)
	instanceWaba.Post("/messages", wabaH.SendMessage)
	instanceWaba.Post("/messages/:messageId/read", wabaH.MarkAsRead)
	// Diagnóstico: ajuda a entender por que mensagens ficam em "sent" e
	// nunca avançam pra delivered (sintoma típico de webhook não
	// configurado no Meta App Settings).
	instanceWaba.Get("/diagnostics", wabaH.GetDiagnostics)
	// Painel de logs de envio: lista mensagens outbound com filtro por
	// status (sent/delivered/read/failed), busca por número/nome,
	// paginação. Permite ao usuário ver "esse número recebeu? falhou?
	// por quê?" sem entrar em cada conversa.
	instanceWaba.Get("/messages-log", wabaH.GetMessagesLog)
	// Business Profile
	instanceWaba.Get("/business-profile", wabaH.GetBusinessProfile)
	instanceWaba.Patch("/business-profile", wabaH.UpdateBusinessProfile)
	// Media (CDN Meta)
	instanceWaba.Post("/media", wabaH.UploadMedia)
	instanceWaba.Get("/media/:mediaId", wabaH.GetMedia)
	instanceWaba.Delete("/media/:mediaId", wabaH.DeleteMedia)
	// Phone number verification
	instanceWaba.Post("/phone-numbers/:phoneId/request-code", wabaH.RequestVerificationCode)
	instanceWaba.Post("/phone-numbers/:phoneId/verify-code", wabaH.VerifyCode)
	// Analytics
	instanceWaba.Get("/analytics", wabaH.GetAnalytics)
	// QR Codes
	instanceWaba.Get("/qr-codes", wabaH.ListQRCodes)
	instanceWaba.Post("/qr-codes", wabaH.CreateQRCode)
	instanceWaba.Get("/qr-codes/:qrId", wabaH.GetQRCode)
	instanceWaba.Delete("/qr-codes/:qrId", wabaH.DeleteQRCode)
	// Tech Provider flow — chamados após Embedded Signup pra ativar
	// recebimento de mensagens (subscribe) e envio (register).
	instanceWaba.Post("/subscribe", wabaH.SubscribeApp)
	instanceWaba.Post("/register", wabaH.RegisterPhone)

	// Global WebSocket for real-time events
	app.Get("/ws/events", wsH.EventsWS)

	// WebSocket per instance (legacy, for specific instance events)
	instance.Get("/ws", wsH.InstanceWS)

	// MCP (Model Context Protocol)
	instance.Get("/mcp/sse", mcpH.SSE)
	instance.Post("/mcp/message", mcpH.Message)
	instance.Get("/mcp/tools", mcpH.Tools)

	instance.Get("/safety", instanceH.SafetyStatus)
	instance.Post("/safety/resume", instanceH.ResumeSafety)
	instance.Post("/safety/review", instanceH.KeepSafetyPaused)

	// Proxy (read-only na instância — config fica no server)
	instance.Get("/proxy", proxyH.Get)
	instance.Get("/proxy/effective", proxyH.Effective)

	// Messages
	msgs := instance.Group("/messages")
	msgs.Get("/", msgH.GetMessages)
	msgs.Get("/:msgID", msgH.GetMessage)
	msgs.Post("/text", msgH.SendText)
	msgs.Post("/image", msgH.SendImage)
	msgs.Post("/document", msgH.SendDocument)
	msgs.Post("/audio", msgH.SendAudio)
	msgs.Post("/video", msgH.SendVideo)
	msgs.Post("/location", msgH.SendLocation)
	msgs.Post("/contact", msgH.SendContact)
	msgs.Post("/reaction", msgH.SendReaction)
	msgs.Post("/poll", msgH.SendPoll)
	msgs.Post("/buttons", msgH.SendButtons)
	msgs.Post("/template", msgH.SendTemplate)
	msgs.Post("/list", msgH.SendList)
	msgs.Post("/pix", msgH.SendPix)
	msgs.Post("/pix-button", msgH.SendPixButton)
	msgs.Post("/carousel", msgH.SendCarousel)
	msgs.Post("/menu", msgH.SendMenu)
	msgs.Post("/sticker", msgH.SendSticker)
	msgs.Post("/status", msgH.SendStatus)
	msgs.Post("/presence", msgH.SendPresence)
	msgs.Post("/payment-request", msgH.RequestPayment)
	msgs.Post("/revoke", msgH.RevokeMessage)
	msgs.Post("/typing", msgH.SendTyping)
	msgs.Post("/read", msgH.MarkRead)
	// Paridade Evolution-Go (interno)
	msgs.Post("/link", msgH.SendLink)
	msgs.Post("/edit", msgH.EditMessage)

	// Chat operations (pin/archive/mute) — paridade Evo-Go
	chat := instance.Group("/chat")
	chat.Post("/pin", msgH.PinChat)
	chat.Post("/archive", msgH.ArchiveChat)
	chat.Post("/mute", msgH.MuteChat)
	chat.Post("/history-sync", msgH.HistorySync)

	// Self profile (do dono da instância conectada)
	profile := instance.Group("/profile")
	profile.Put("/name", msgH.UpdateProfileName)
	profile.Put("/status", msgH.UpdateProfileStatus)
	profile.Put("/picture", msgH.UpdateProfilePicture)

	// Block / unblock
	instance.Post("/block", msgH.BlockUser)
	instance.Post("/unblock", msgH.UnblockUser)
	instance.Get("/blocklist", msgH.GetBlocklist)

	// Group attributes (foto, announce, locked)
	groupOps := instance.Group("/group-ops")
	groupOps.Put("/photo", msgH.SetGroupPhoto)
	groupOps.Put("/announce", msgH.SetGroupAnnounceMode)
	groupOps.Put("/locked", msgH.SetGroupLockedMode)

	// Labels
	labels := instance.Group("/labels")
	labels.Post("/chat", msgH.LabelChat)
	labels.Post("/message", msgH.LabelMessage)
	labels.Post("/edit", msgH.EditLabel)

	// Privacy
	privacy := instance.Group("/privacy")
	privacy.Get("/", msgH.GetPrivacy)
	privacy.Put("/", msgH.SetPrivacy)

	// Force reconnect (instância "viva" mas sem trafegar)
	instance.Post("/force-reconnect", msgH.ForceReconnect)

	// Communities
	communities := instance.Group("/communities")
	communities.Post("/", msgH.CreateCommunity)
	communities.Post("/link", msgH.LinkCommunityGroup)
	communities.Post("/unlink", msgH.UnlinkCommunityGroup)
	communities.Get("/:jid/groups", msgH.ListCommunityGroups)

	// Newsletters (channels)
	newsletters := instance.Group("/newsletters")
	newsletters.Post("/", msgH.CreateNewsletter)
	newsletters.Get("/", msgH.ListNewsletters)
	newsletters.Get("/:jid", msgH.GetNewsletterInfo)
	newsletters.Post("/:jid/follow", msgH.FollowNewsletter)
	newsletters.Post("/:jid/unfollow", msgH.UnfollowNewsletter)
	newsletters.Get("/:jid/messages", msgH.GetNewsletterMessages)

	// Calls
	instance.Post("/calls/reject", msgH.RejectCall)
	instance.Post("/calls/offer", msgH.OfferCall)

	// ─── Extras whatsmeow (nem Evo-Go expõe) ──────────────────────
	// Business profile + disappearing + group invites avançados +
	// newsletter advanced + TOS + QR resolvers.
	instance.Get("/business-profile/:jid", msgH.GetBusinessProfile)
	instance.Post("/disappearing", msgH.SetDisappearing)
	instance.Post("/disappearing/default", msgH.SetDisappearingDefault)
	instance.Post("/groups/join-with-invite", msgH.JoinGroupViaInvite)
	instance.Post("/groups/preview-invite", msgH.PreviewGroupInvite)
	instance.Get("/groups/preview-link", msgH.PreviewGroupLink)
	instance.Get("/groups/:jid/requests", msgH.ListGroupRequests)
	instance.Post("/groups/:jid/requests", msgH.UpdateGroupRequests)
	instance.Get("/communities/:jid/participants", msgH.ListCommunityParticipants)
	newsletters.Post("/:jid/mark-viewed", msgH.NewsletterMarkViewed)
	newsletters.Post("/:jid/react", msgH.NewsletterReact)
	newsletters.Post("/:jid/mute", msgH.NewsletterMute)
	instance.Post("/tos/accept", msgH.AcceptTOS)
	instance.Get("/status-privacy", msgH.GetStatusPrivacy)
	instance.Get("/resolve/business-link", msgH.ResolveBusinessLink)
	instance.Get("/resolve/contact-qr", msgH.ResolveContactQR)
	instance.Get("/qr-link", msgH.GetSelfQRLink)

	// Recovery
	recovery := instance.Group("/recovery")
	recovery.Get("/", recoveryH.Get)
	recovery.Post("/snapshot", recoveryH.Snapshot)
	recovery.Post("/reset", recoveryH.Reset)
	recovery.Put("/schedule", recoveryH.SetSchedule)
	instance.Get("/logs/events", instanceLogH.List)

	instance.Post("/media/upload", msgH.UploadMedia)
	instance.Get("/contacts", msgH.GetContacts)
	instance.Post("/check-number", msgH.CheckNumber)
	instance.Post("/bulk-check", msgH.BulkCheckNumbers)

	// OTP
	otp := instance.Group("/otp")
	otp.Post("/send", otpH.Send)
	otp.Post("/verify", otpH.Verify)
	otp.Post("/resend", otpH.Resend)
	otp.Get("/sessions", otpH.Sessions)

	// Groups
	groups := instance.Group("/groups")
	groups.Get("/", groupH.List)
	groups.Post("/", groupH.Create)
	groups.Get("/join-jobs", groupH.ListJoinJobs)
	groups.Post("/join-link", groupH.JoinLink)
	groups.Post("/join-links", groupH.JoinLinks)
	groups.Get("/:jid", groupH.Get)
	groups.Put("/:jid", groupH.Update)
	groups.Post("/:jid/participants", groupH.UpdateParticipants)
	groups.Get("/:jid/invite", groupH.InviteLink)
	groups.Post("/:jid/leave", groupH.Leave)

	// Webhooks
	webhooks := instance.Group("/webhooks")
	webhooks.Get("/", webhookH.List)
	webhooks.Post("/", webhookH.Create)
	webhooks.Put("/:webhookId", webhookH.Update)
	webhooks.Delete("/:webhookId", webhookH.Delete)
	webhooks.Get("/:webhookId/deliveries", webhookLogsH.ListInstanceDeliveries)
	webhooks.Post("/:webhookId/deliveries/:deliveryId/retry", webhookLogsH.RetryInstanceDelivery)
	webhooks.Post("/:webhookId/test", webhookLogsH.TestInstanceWebhook)

	// ─── TikTok routes ──────────────────────────────────────────────────────
	tk := api.Group("/tiktok")
	tk.Get("/health", tiktokH.Health)
	tk.Get("/accounts", tiktokH.List)
	tk.Post("/accounts", tiktokH.Create)
	tk.Get("/accounts/:id", tiktokH.Get)
	tk.Delete("/accounts/:id", tiktokH.Delete)
	tk.Put("/accounts/:id/settings", tiktokH.UpdateSettings)
	tk.Post("/accounts/:id/connect", tiktokH.Connect)
	tk.Post("/accounts/:id/disconnect", tiktokH.Disconnect)
	tk.Post("/accounts/:id/dm", tiktokH.SendDM)
	tk.Get("/accounts/:id/dm", tiktokH.ReadDMs)
	tk.Post("/accounts/:id/follow", tiktokH.Follow)
	tk.Post("/accounts/:id/unfollow", tiktokH.Unfollow)
	tk.Post("/accounts/:id/scrape/followers", tiktokH.ScrapeFollowers)
	tk.Post("/accounts/:id/scrape/hashtag", tiktokH.ScrapeHashtag)
	tk.Get("/targets", tiktokH.ListTargets)
	tk.Get("/dms", tiktokH.ListDMs)

	// ─── CRM routes ───────────────────────────────────────────────────────────
	crm := api.Group("/crm", middleware.RequireFeature(db, models.FeatureCRM))
	contacts := crm.Group("/contacts")
	contacts.Get("/", contactH.ListContacts)
	contacts.Post("/", contactH.CreateContact)
	contacts.Get("/:id", contactH.GetContact)
	contacts.Put("/:id", contactH.UpdateContact)
	contacts.Delete("/:id", contactH.DeleteContact)
	contacts.Put("/:id/tags", contactH.AssignTags)

	tags := crm.Group("/tags")
	tags.Get("/", contactH.ListTags)
	tags.Post("/", contactH.CreateTag)
	tags.Delete("/:id", contactH.DeleteTag)

	funnels := crm.Group("/funnels")
	funnels.Get("/", contactH.ListFunnels)
	funnels.Post("/", contactH.CreateFunnel)
	funnels.Put("/:id", contactH.UpdateFunnel)
	funnels.Delete("/:id", contactH.DeleteFunnel)
	funnels.Get("/:id/stages", contactH.ListFunnelStages)
	funnels.Post("/:id/stages", contactH.CreateFunnelStage)
	funnels.Put("/:id/stages/:stageId", contactH.UpdateFunnelStage)
	funnels.Delete("/:id/stages/:stageId", contactH.DeleteFunnelStage)

	crm.Get("/journey-options", contactH.ListJourneyOptions)
	crm.Get("/stage-options", contactH.ListStageOptions)
	crm.Get("/funnel-options", contactH.ListFunnelOptions)

	// ─── CRM v2 — Companies, Deals, Views, Groups ─────────────────────────────
	// Each resource under /v1/crm/* requires workspace_id via X-Workspace-ID.
	// Permissions are new (companies:*, deals:*, funnels:manage); legacy
	// crm:* keys stay in the seed as a fallback during migration.
	companies := crm.Group("/companies")
	companies.Get("/", middleware.RequireWorkspacePermission(db, models.PermCompaniesView), companyH.List)
	companies.Post("/", middleware.RequireWorkspacePermission(db, models.PermCompaniesCreate), companyH.Create)
	companies.Get("/:id", middleware.RequireWorkspacePermission(db, models.PermCompaniesView), companyH.Get)
	companies.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermCompaniesEdit), companyH.Patch)
	companies.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermCompaniesDelete), companyH.Delete)
	companies.Get("/:id/contacts", middleware.RequireWorkspacePermission(db, models.PermCompaniesView), companyH.Contacts)
	companies.Get("/:id/deals", middleware.RequireWorkspacePermission(db, models.PermCompaniesView), companyH.Deals)

	deals := crm.Group("/deals")
	deals.Get("/", middleware.RequireWorkspacePermission(db, models.PermDealsView), dealH.List)
	deals.Get("/summary", middleware.RequireWorkspacePermission(db, models.PermDealsView), dealH.Summary)
	deals.Post("/", middleware.RequireWorkspacePermission(db, models.PermDealsCreate), dealH.Create)
	deals.Get("/:id", middleware.RequireWorkspacePermission(db, models.PermDealsView), dealH.Get)
	deals.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermDealsEdit), dealH.Patch)
	deals.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermDealsDelete), dealH.Delete)
	deals.Post("/:id/move", middleware.RequireWorkspacePermission(db, models.PermDealsMoveStage), dealH.Move)
	deals.Post("/:id/win", middleware.RequireWorkspacePermission(db, models.PermDealsEdit), dealH.Win)
	deals.Post("/:id/lose", middleware.RequireWorkspacePermission(db, models.PermDealsEdit), dealH.Lose)
	deals.Post("/:id/reopen", middleware.RequireWorkspacePermission(db, models.PermDealsEdit), dealH.Reopen)
	deals.Get("/:id/timeline", middleware.RequireWorkspacePermission(db, models.PermDealsView), dealH.Timeline)
	deals.Post("/:id/notes", middleware.RequireWorkspacePermission(db, models.PermDealsEdit), dealH.AddNote)

	// Saved views per funnel
	funnels.Get("/:id/views", middleware.RequireWorkspacePermission(db, models.PermFunnelsManage), funnelViewH.List)
	funnels.Post("/:id/views", middleware.RequireWorkspacePermission(db, models.PermFunnelsManage), funnelViewH.Create)
	funnels.Patch("/:id/views/:vid", middleware.RequireWorkspacePermission(db, models.PermFunnelsManage), funnelViewH.Patch)
	funnels.Delete("/:id/views/:vid", middleware.RequireWorkspacePermission(db, models.PermFunnelsManage), funnelViewH.Delete)

	// Contact groups (WhatsApp groups persisted for CRM enrichment)
	crmGroups := crm.Group("/groups")
	crmGroups.Get("/", middleware.RequireWorkspacePermission(db, models.PermCRMView), contactGroupH.List)
	crmGroups.Post("/sync", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), contactGroupH.Sync)
	crmGroups.Get("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMView), contactGroupH.Get)
	crmGroups.Get("/:id/members", middleware.RequireWorkspacePermission(db, models.PermCRMView), contactGroupH.Members)
	crm.Get("/contacts/:id/groups", middleware.RequireWorkspacePermission(db, models.PermCRMView), contactGroupH.ContactGroups)

	// CRM Tasks — tarefas humanas/agente vinculadas a Deal/Contact/Company.
	// Reusam a permissão genérica de CRM (view/edit) — não há perm
	// dedicada por enquanto.
	crmTaskH := handlers.NewCrmTaskHandler(db)
	tasks := crm.Group("/tasks")
	tasks.Get("/", middleware.RequireWorkspacePermission(db, models.PermCRMView), crmTaskH.List)
	tasks.Post("/", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmTaskH.Create)
	tasks.Get("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMView), crmTaskH.Get)
	tasks.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmTaskH.Update)
	tasks.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmTaskH.Delete)
	tasks.Post("/:id/complete", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmTaskH.Complete)

	// CRM Meetings — agendamentos vinculados a Deal/Contact/Company,
	// com slots pra sync de Google Calendar/Outlook (campos external_*).
	crmMeetingH := handlers.NewCrmMeetingHandler(db)
	meetings := crm.Group("/meetings")
	meetings.Get("/", middleware.RequireWorkspacePermission(db, models.PermCRMView), crmMeetingH.List)
	meetings.Post("/", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmMeetingH.Create)
	meetings.Get("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMView), crmMeetingH.Get)
	meetings.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmMeetingH.Update)
	meetings.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmMeetingH.Delete)

	// CRM Timeline — feed unificado de eventos cross-entity (Contact + Deal).
	// Filtros opcionais: contact_id, deal_id, company_id.
	crmTimelineH := handlers.NewCrmTimelineHandler(db)
	crm.Get("/timeline", middleware.RequireWorkspacePermission(db, models.PermCRMView), crmTimelineH.List)

	// CRM Custom Fields — definições de atributos personalizados por
	// entidade (deal/contact/company). Os VALORES vivem na coluna
	// custom_fields jsonb das entidades; aqui só CRUD do schema.
	crmCustomFieldH := handlers.NewCrmCustomFieldHandler(db)
	customFields := crm.Group("/custom-fields")
	customFields.Get("/", middleware.RequireWorkspacePermission(db, models.PermCRMView), crmCustomFieldH.List)
	customFields.Post("/", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmCustomFieldH.Create)
	customFields.Put("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmCustomFieldH.Update)
	customFields.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermCRMEdit), crmCustomFieldH.Delete)

	// ─── Ticketing / Atendimento ──────────────────────────────────────────────
	// All routes require an active workspace passed via X-Workspace-ID header
	// (or ?workspace_id=). RequireWorkspacePermission enforces the RBAC key.
	conversations := api.Group("/conversations", middleware.RequireFeature(db, models.FeatureInbox))
	// Health — deliberately NO workspace permission so the UI can distinguish
	// "route missing / old deploy" from "route exists, something else broken".
	conversations.Get("/health", conversationH.Health)
	// Listagem/leitura aceita tickets:view OU inbox:view_conversations.
	// Permite que admins criem roles tipo "operador inbox" sem precisar
	// liberar o módulo inteiro de tickets.
	convoViewPerms := []string{models.PermTicketsView, models.PermInboxViewConversations}
	conversations.Get("/", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.List)
	conversations.Post("/", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.StartConversation)
	conversations.Get("/count", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.Count)
	conversations.Get("/inbox-stats", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.InboxStats)
	conversations.Get("/messages/search", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.SearchMessages)
	conversations.Post("/backfill", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.Backfill)
	conversations.Get("/:id", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.Get)
	conversations.Get("/:id/timeline", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.Timeline)
	conversations.Get("/:id/send-constraints", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.SendConstraints)
	conversations.Get("/:id/shop-context", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.ShopContext)
	api.Get("/contacts/:id/orders", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.ContactOrders)
	conversations.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.Patch)
	conversations.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.Delete)
	conversations.Post("/:id/messages", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.SendMessage)
	conversations.Patch("/:id/messages/:msgId", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.PatchMessage)
	conversations.Delete("/:id/messages/:msgId", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.RevokeMessage)
	conversations.Patch("/:id/messages/:msgId/content", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.EditMessage)
	conversations.Post("/:id/messages/:msgId/react", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.ReactToMessage)
	conversations.Post("/:id/messages/:msgId/forward", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.ForwardMessage)
	conversations.Get("/:id/messages/:msgId/receipts", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.GetMessageReceipts)
	// Re-tenta transcrição manualmente. Usado pra mensagens que chegaram
	// antes do PlatformAI estar configurado (status=unsupported) ou que
	// falharam por erro transitório (status=failed). Sem permissão de send,
	// um operador pode pedir a transcrição.
	conversations.Post("/:id/messages/:msgId/transcribe", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.RetryTranscription)
	conversations.Post("/:id/typing", middleware.RequireWorkspacePermission(db, models.PermInboxSend), conversationH.Typing)
	conversations.Post("/:id/read", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.MarkRead)
	conversations.Post("/:id/unread", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.MarkUnread)
	conversations.Post("/:id/take", middleware.RequireWorkspacePermission(db, models.PermTicketsAssign), conversationH.Take)
	// Bulk actions: assign/transfer/resolve/close/reopen/snooze/read/unread/archive/pin/mute em N conversas.
	conversations.Post("/bulk", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.Bulk)
	conversations.Post("/:id/assign", middleware.RequireWorkspacePermission(db, models.PermTicketsAssign), conversationH.Assign)
	conversations.Post("/:id/unassign", middleware.RequireWorkspacePermission(db, models.PermTicketsAssign), conversationH.Unassign)
	conversations.Post("/:id/transfer", middleware.RequireWorkspacePermission(db, models.PermTicketsTransfer), conversationH.Transfer)
	conversations.Post("/:id/resolve", middleware.RequireWorkspacePermission(db, models.PermTicketsClose), conversationH.Resolve)
	conversations.Post("/:id/close", middleware.RequireWorkspacePermission(db, models.PermTicketsClose), conversationH.Close)
	conversations.Post("/:id/reopen", middleware.RequireWorkspacePermission(db, models.PermTicketsReopen), conversationH.Reopen)
	conversations.Post("/:id/snooze", middleware.RequireWorkspacePermission(db, models.PermTicketsSnooze), conversationH.Snooze)
	conversations.Post("/:id/unsnooze", middleware.RequireWorkspacePermission(db, models.PermTicketsSnooze), conversationH.Unsnooze)
	conversations.Post("/:id/bot/enable", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.EnableBot)
	conversations.Post("/:id/bot/disable", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.DisableBot)
	// Agent state per conversation
	conversations.Get("/:id/agent-state", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.GetAgentState)
	conversations.Patch("/:id/agent-state", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.SetAgentState)
	conversations.Post("/:id/agent/suggest", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.SuggestAgentReply)
	conversations.Post("/:id/agent-command", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.AgentCommand)
	conversations.Delete("/:id/agent-memory", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.ResetAgentMemory)
	conversations.Delete("/agent-memory/all", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.ResetAllAgentMemory)
	// WABA window keeper — toggle automático para manter janela de 24h aberta
	conversations.Patch("/:id/window-keeper", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.SetWindowKeeper)

	// Tags on conversations
	conversations.Get("/:id/tags", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.ListTags)
	conversations.Post("/:id/tags", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.AddTag)
	conversations.Delete("/:id/tags/:tagId", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.RemoveTag)
	// Participants (followers/collaborators)
	conversations.Get("/:id/participants", middleware.RequireAnyWorkspacePermission(db, convoViewPerms...), conversationH.ListParticipants)
	conversations.Post("/:id/participants", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.AddParticipant)
	conversations.Delete("/:id/participants/:userId", middleware.RequireWorkspacePermission(db, models.PermTicketsUpdate), conversationH.RemoveParticipant)
	// Audit: assignment history + raw event feed
	conversations.Get("/:id/assignments", middleware.RequireWorkspacePermission(db, models.PermTicketsView), conversationH.ListAssignments)
	conversations.Get("/:id/events", middleware.RequireWorkspacePermission(db, models.PermTicketsView), conversationH.ListEvents)
	// CSAT per conversation
	conversations.Get("/:id/csat", middleware.RequireWorkspacePermission(db, models.PermTicketsView), csatH.ListForConversation)
	conversations.Post("/:id/csat", middleware.RequireWorkspacePermission(db, models.PermTicketsClose), csatH.Send)

	// Notes
	conversations.Get("/:id/notes", middleware.RequireWorkspacePermission(db, models.PermNotesView), conversationH.ListNotes)
	conversations.Post("/:id/notes", middleware.RequireWorkspacePermission(db, models.PermNotesCreate), conversationH.CreateNote)
	conversations.Patch("/:id/notes/:noteId", middleware.RequireWorkspacePermission(db, models.PermNotesUpdate), conversationH.UpdateNote)
	conversations.Delete("/:id/notes/:noteId", middleware.RequireWorkspacePermission(db, models.PermNotesDelete), conversationH.DeleteNote)

	// Departments
	departments := api.Group("/departments")
	departments.Get("/", middleware.RequireWorkspacePermission(db, models.PermDepartmentsView), departmentH.List)
	departments.Post("/", middleware.RequireWorkspacePermission(db, models.PermDepartmentsManage), departmentH.Create)
	departments.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermDepartmentsManage), departmentH.Patch)
	departments.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermDepartmentsManage), departmentH.Delete)

	// Teams
	teams := api.Group("/teams")
	teams.Get("/", middleware.RequireWorkspacePermission(db, models.PermTeamsView), teamH.List)
	teams.Post("/", middleware.RequireWorkspacePermission(db, models.PermTeamsManage), teamH.Create)
	teams.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermTeamsManage), teamH.Patch)
	teams.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermTeamsManage), teamH.Delete)
	teams.Get("/:id/members", middleware.RequireWorkspacePermission(db, models.PermTeamsView), teamH.ListMembers)
	teams.Post("/:id/members", middleware.RequireWorkspacePermission(db, models.PermTeamsManage), teamH.AddMember)
	teams.Delete("/:id/members/:userId", middleware.RequireWorkspacePermission(db, models.PermTeamsManage), teamH.RemoveMember)

	// Queues
	queues := api.Group("/queues")
	queues.Get("/", middleware.RequireWorkspacePermission(db, models.PermQueuesView), queueH.List)
	queues.Post("/", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.Create)
	queues.Get("/:id", middleware.RequireWorkspacePermission(db, models.PermQueuesView), queueH.Get)
	queues.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.Patch)
	queues.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.Delete)
	queues.Get("/:id/stats", middleware.RequireWorkspacePermission(db, models.PermQueuesView), queueH.Stats)
	queues.Get("/:id/members", middleware.RequireWorkspacePermission(db, models.PermQueuesView), queueH.ListMembers)
	queues.Post("/:id/members", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.AddMember)
	queues.Patch("/:id/members/:userId", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.UpdateMember)
	queues.Delete("/:id/members/:userId", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.RemoveMember)
	queues.Get("/:id/channels", middleware.RequireWorkspacePermission(db, models.PermQueuesView), queueH.ListChannels)
	queues.Post("/:id/channels", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.AddChannel)
	queues.Delete("/:id/channels/:instanceId", middleware.RequireWorkspacePermission(db, models.PermQueuesManage), queueH.RemoveChannel)

	// Quick replies
	quickReplies := api.Group("/quick-replies")
	quickReplies.Get("/", middleware.RequireWorkspacePermission(db, models.PermQuickRepliesView), quickReplyH.List)
	quickReplies.Get("/search", middleware.RequireWorkspacePermission(db, models.PermQuickRepliesView), quickReplyH.Search)
	// Create falls back to personal when shared=false; when shared=true the route-level
	// permission below would normally need to be manage_shared, but since body is parsed
	// inside the handler we keep manage_own here and do a secondary check there.
	quickReplies.Post("/", middleware.RequireWorkspacePermission(db, models.PermQuickRepliesManageOwn), quickReplyH.Create)
	quickReplies.Patch("/:id", middleware.RequireWorkspacePermission(db, models.PermQuickRepliesManageOwn), quickReplyH.Patch)
	quickReplies.Delete("/:id", middleware.RequireWorkspacePermission(db, models.PermQuickRepliesManageOwn), quickReplyH.Delete)
	quickReplies.Post("/:id/use", middleware.RequireWorkspacePermission(db, models.PermQuickRepliesView), quickReplyH.Use)

	// Reports — métricas do inbox. Aceita reports:view (perm específica) OU
	// tickets:view / inbox:view (qualquer atendente vê os números do próprio
	// trabalho). Owner/super-admin bypassam.
	reportsPerms := []string{models.PermReportsView, models.PermTicketsView, models.PermInboxView}
	reports := api.Group("/reports")
	reports.Get("/overview", middleware.RequireAnyWorkspacePermission(db, reportsPerms...), reportsH.Overview)
	reports.Get("/by-queue", middleware.RequireAnyWorkspacePermission(db, reportsPerms...), reportsH.ByQueue)
	reports.Get("/by-user", middleware.RequireAnyWorkspacePermission(db, reportsPerms...), reportsH.ByUser)
	reports.Get("/csat", middleware.RequireAnyWorkspacePermission(db, reportsPerms...), reportsH.CSAT)
	reports.Get("/sla", middleware.RequireAnyWorkspacePermission(db, reportsPerms...), reportsH.SLA)

	// Presence / workload (me + supervisor view)
	me := api.Group("/me")
	// GetMine/UpdateMine require any of tickets:view — minimum atendente permission
	me.Get("/presence", middleware.RequireWorkspacePermission(db, models.PermTicketsView), presenceH.GetMine)
	me.Put("/presence", middleware.RequireWorkspacePermission(db, models.PermTicketsView), presenceH.UpdateMine)
	me.Get("/workload", middleware.RequireWorkspacePermission(db, models.PermTicketsView), presenceH.MyWorkload)
	// Supervisor view of all agents' presence
	workspace.Get("/presence", middleware.RequireWorkspacePermission(db, models.PermPresenceViewOthers), presenceH.ListWorkspacePresence)

	// ─── Campaign routes ───────────────────────────────────────────────────────
	campaigns := api.Group("/campaigns", middleware.RequireFeature(db, models.FeatureCampaigns))
	campaigns.Get("/", campaignH.List)
	campaigns.Post("/", campaignH.Create)
	campaigns.Get("/segment-options", campaignH.SegmentOptions)
	campaigns.Post("/segment-preview", campaignH.SegmentPreview)
	campaigns.Get("/:id", campaignH.Get)
	campaigns.Post("/:id/start", campaignH.Start)
	campaigns.Post("/:id/pause", campaignH.Pause)
	campaigns.Post("/:id/resume", campaignH.Resume)
	campaigns.Post("/:id/cancel", campaignH.Cancel)
	campaigns.Post("/:id/abort", campaignH.Cancel) // alias UazAPI-style
	campaigns.Post("/:id/clear-sent", campaignH.ClearSent)
	campaigns.Get("/:id/messages", campaignH.ListMessageStatus)
	campaigns.Get("/:id/diagnose", campaignH.Diagnose)
	campaigns.Post("/:id/run-now", campaignH.RunNow)

	// ─── Voice / TTS ─────────────────────────────────────────────────
	ttsForVoice := services.NewTTSService()
	voiceH := handlers.NewVoiceHandler(db, ttsForVoice)
	voices := api.Group("/voices")
	voices.Get("/providers", voiceH.ListProviders)
	voices.Post("/providers", voiceH.CreateProvider)
	voices.Delete("/providers/:id", voiceH.DeleteProvider)
	voices.Post("/providers/:id/test", voiceH.TestProvider)
	voices.Get("/providers/:id/usage", voiceH.GetUsage)
	voices.Post("/providers/:id/sync", voiceH.SyncVoices)
	voices.Post("/providers/:id/clone", voiceH.CloneVoice)
	voices.Post("/uniq/clone", voiceH.CloneUniqVoice)
	voices.Get("/", voiceH.ListVoices)
	voices.Patch("/:id", voiceH.ToggleVoice)
	voices.Delete("/:id", voiceH.DeleteVoice)
	voices.Post("/test", voiceH.TestTTS)

	// ─── Shop module (Fase 1) ─────────────────────────────────────────
	shopH := handlers.NewShopHandler(db)
	// Catálogo público de providers — antes do gate pra UI poder listar
	// sem ainda ter plano (mostrar "faça upgrade pra conectar").
	api.Get("/shops/integrations/providers", shopH.ListProviders)
	api.Get("/shop/providers", shopH.ListProviders) // alias mais curto

	// OAuth callback genérico (autenticado — só dono finaliza OAuth dele).
	api.Get("/shops/integrations/oauth/callback", shopH.OAuthCallback)

	// Webhooks dos providers (público, validado por HMAC do próprio provider).
	app.Post("/v1/shop/webhooks/:provider/:integrationId", shopH.HandleProviderWebhook)

	shops := api.Group("/shops", middleware.RequireFeature(db, models.FeatureShop))
	shops.Get("/", shopH.ListShops)
	shops.Post("/", shopH.CreateShop)
	shops.Get("/categories", shopH.ListCategories)
	shops.Post("/categories", shopH.CreateCategory)
	shops.Get("/:id", shopH.GetShop)
	shops.Patch("/:id", shopH.UpdateShop)
	shops.Delete("/:id", shopH.DeleteShop)
	shops.Get("/:shopId/products", shopH.ListProducts)
	shops.Post("/:shopId/products", shopH.CreateProduct)
	shops.Get("/:shopId/products/:id", shopH.GetProduct)
	shops.Patch("/:shopId/products/:id", shopH.UpdateProduct)
	shops.Delete("/:shopId/products/:id", shopH.DeleteProduct)
	shops.Get("/:shopId/integrations", shopH.ListIntegrations)
	shops.Post("/:shopId/integrations", shopH.CreateIntegration)
	shops.Delete("/:shopId/integrations/:id", shopH.DeleteIntegration)
	shops.Patch("/:shopId/integrations/:id", shopH.PatchIntegration)
	shops.Post("/:shopId/integrations/:id/test", shopH.TestIntegration)
	shops.Post("/:shopId/integrations/:id/sync", shopH.SyncIntegration)
	shops.Post("/:shopId/integrations/:id/connect", shopH.ConnectIntegration)

	// Sprint 8 — keyword triggers (autoresponder simples gap UazAPI)
	triggers := api.Group("/triggers", middleware.RequireFeature(db, models.FeatureTriggers))
	triggers.Get("/", triggerH.List)
	triggers.Post("/", triggerH.Create)
	triggers.Get("/:id", triggerH.Get)
	triggers.Put("/:id", triggerH.Update)
	triggers.Delete("/:id", triggerH.Delete)
	triggers.Post("/:id/test", triggerH.Test)

	// Sprint 7 — warmup (anti-ban) per instance
	warmup := instance.Group("/warmup")
	warmup.Get("/", warmupH.Get)
	warmup.Post("/", warmupH.Upsert)
	warmup.Post("/start", warmupH.Start)
	warmup.Post("/pause", warmupH.Pause)
	warmup.Post("/resume", warmupH.Resume)
	warmup.Post("/stop", warmupH.Stop)
	campaigns.Delete("/:id", campaignH.Delete)

	// Stripe (protected) — ramo direto, sempre cartão. UI usa esse pra
	// botão "Pagar com cartão" independente do active_provider global.
	stripeRoutes := api.Group("/stripe")
	stripeRoutes.Post("/checkout", stripeH.CreateCheckout)
	stripeRoutes.Get("/subscription", stripeH.GetSubscription)

	// Asaas (protected) — ramo direto, sempre PIX recorrente.
	asaasRoutes := api.Group("/asaas")
	asaasRoutes.Post("/checkout", asaasH.CreateCheckout)
	asaasRoutes.Get("/subscription", asaasH.GetSubscription)

	// AbacatePay (protected) — PIX transparente e checkout hospedado.
	abacatepayRoutes := api.Group("/abacatepay")
	abacatepayRoutes.Post("/checkout", abacatepayH.CreateCheckout)
	abacatepayRoutes.Post("/subscription", abacatepayH.CreateSubscriptionCheckout)
	abacatepayRoutes.Post("/qr", abacatepayH.CreateQRCode)
	abacatepayRoutes.Get("/subscription", abacatepayH.GetSubscription)
	abacatepayRoutes.Get("/test", abacatepayH.TestConnection)

	// Payments (protected) — proxy que escolhe provider via active_provider
	// (default Stripe). Mantido pra compat. Novos clientes devem usar
	// /v1/stripe/checkout ou /v1/asaas/checkout direto.
	paymentRoutes := api.Group("/payments")
	paymentRoutes.Post("/checkout", paymentH.CreateCheckout)
	paymentRoutes.Get("/subscription", paymentH.GetSubscription)

	// Asaas plans (public)
	app.Get("/asaas/plans", paymentH.ListPlans)

	// Integrations (account-level LLM/tool connections)
	integrations := api.Group("/integrations")
	integrations.Get("/", integrationH.List)
	integrations.Post("/", integrationH.Create)
	// Claude OAuth (claude.ai account login — alternativa a API key)
	integrations.Post("/claude/oauth/start", integrationH.StartClaudeOAuth)
	integrations.Post("/claude/oauth/callback", integrationH.CompleteClaudeOAuth)
	integrations.Post("/claude/oauth/callback-auto", integrationH.CompleteClaudeOAuthAuto)
	// OpenRouter OAuth PKCE — devolve API key persistente vinculada à conta
	integrations.Post("/openrouter/oauth/start", integrationH.StartOpenRouterOAuth)
	integrations.Post("/openrouter/oauth/callback", integrationH.CompleteOpenRouterOAuth)
	integrations.Put("/:id", integrationH.Update)
	integrations.Delete("/:id", integrationH.Delete)
	integrations.Post("/:id/test", integrationH.Test)
	integrations.Post("/:id/oauth/refresh", integrationH.RefreshClaudeOAuth)
	integrations.Get("/platform-ai", adminH.ListPlatformAIPublic)
	integrations.Get("/platform-voice", adminH.ListPlatformVoicePublic)

	// AI generation (uses user integrations)
	api.Post("/ai/generate", integrationH.GenerateVariations)

	// AI Chat & Journeys
	api.Post("/ai/chat", chatH.HandleChat)
	api.Get("/ai/tools", chatH.GetTools)
	journeys := api.Group("/journeys", middleware.RequireFeature(db, models.FeatureJourneys))
	journeys.Get("/", journeyH.ListJourneys)
	journeys.Post("/", journeyH.CreateJourney)
	journeys.Get("/templates", journeyH.ListTemplates)
	journeys.Post("/from-template/:slug", journeyH.CreateFromTemplate)
	journeys.Patch("/:id/status", journeyH.ToggleStatus)
	journeys.Patch("/:id/flow", journeyH.UpdateFlow)
	journeys.Patch("/:id/trigger", journeyH.UpdateTrigger)
	journeys.Post("/:id/edit-llm", journeyH.EditFlowWithLLM)
	journeys.Post("/:id/simulate", journeyH.SimulateJourney)
	journeys.Delete("/:id", journeyH.DeleteJourney)
	journeys.Get("/:id", journeyH.GetJourney)
	journeys.Get("/:id/executions", agentH.GetJourneyExecutions)
	// Enrollment proativo (Fase 2 do redesign de Jornadas) — admin
	// enrola contatos em lote (manual/csv) ou checa enrollments
	// criados pelo worker via segment-as-trigger.
	journeys.Post("/:id/enroll", journeyH.EnrollContacts)
	journeys.Get("/:id/enrollments", journeyH.ListEnrollments)
	// Analytics dashboard (Fase 5) — funnel + totals + holdout lift.
	journeys.Get("/:id/analytics", journeyH.GetAnalytics)

	// Help Desk (knowledge base)
	// Help Desk routes ficam registradas APENAS no chain top-level
	// (linhas 442-462 com hdChain) pra evitar registro duplicado. O bloco
	// removido aqui declarava /v1/helpdesk/* uma segunda vez via api.Group,
	// causando ambiguidade de roteamento (mesma URL com middleware levemente
	// diferente). Mantemos só uma fonte de verdade.

	// Agent Center
	agent := api.Group("/agent", middleware.RequireFeature(db, models.FeatureAI))
	agent.Get("/stats", agentH.GetStats)
	agent.Get("/activity", agentH.GetActivity)
	agent.Get("/instances", agentH.GetInstances)
	agent.Post("/executions/:id/stop", agentH.StopExecution)

	// Agent WebSocket
	app.Get("/ws/agent-activity", websocket.New(func(c *websocket.Conn) {
		agentH.ActivityWS(c)
	}))

	// Instance agent (AI agent config per instance)
	// Singular /agent endpoints continuam batendo no agente PRIMÁRIO da
	// instância (compat single-agent). Suportam ?agent_id= pra editar
	// agentes secundários.
	instance.Get("/agent", integrationH.GetAgent)
	instance.Put("/agent", integrationH.UpdateAgent)
	instance.Post("/agent/assets", integrationH.UploadAgentAsset)
	instance.Delete("/agent/assets/:assetId", integrationH.DeleteAgentAsset)
	// Preview / dry-run — chama a LLM com a config salva sem persistir
	// nada. Suporta histórico in-memory passado pelo cliente.
	instance.Post("/agent/preview", integrationH.PreviewAgent)
	// Sprint 9 — RAG ingestion sem upload de arquivo
	instance.Post("/agent/ingest-url", integrationH.IngestAgentURL)
	instance.Post("/agent/ingest-text", integrationH.IngestAgentText)
	// Multi-agente: lista/cria/remove/promove agentes da instância.
	instance.Get("/agents", integrationH.ListInstanceAgents)
	instance.Post("/agents", integrationH.CreateInstanceAgent)
	instance.Delete("/agents/:agent_id", integrationH.DeleteInstanceAgent)
	instance.Post("/agents/:agent_id/set-primary", integrationH.SetPrimaryInstanceAgent)
	// Wizard simplificado: gera prompts (identity/objective/etc) a partir de
	// 7 respostas curtas via LLM da conta.
	instance.Post("/agent/generate-from-quiz", integrationH.GenerateAgentFromQuiz)
	// Logs de execução do agente — alimenta a aba "Logs" no editor.
	instance.Get("/agent/logs", integrationH.ListAgentLogs)

	// Webhook trigger pra agentes — endpoint público (autenticado por slug
	// + opcional HMAC). Permite integrações externas dispararem o agente.
	agentWebhookH := handlers.NewAgentWebhookHandler(db, agentRuntime)
	app.Post("/v1/webhooks/agent-trigger/:slug", agentWebhookH.Trigger)

	// DEPRECATED legacy inbox routes (WhatsApp-style per-instance chat).
	// Mantidas para clientes externos via API key — o dashboard já migrou
	// 100% para /v1/conversations. Não adicionar nada novo aqui; novas
	// features de atendimento pertencem ao ConversationHandler.
	// Inbox (WhatsApp-style chat interface) - must be before /messages
	inbox := instance.Group("/inbox")
	inbox.Get("/chats", inboxH.GetChats)
	inbox.Get("/chats/:jid", inboxH.GetChat)
	inbox.Get("/chats/:jid/messages", inboxH.GetMessages)
	inbox.Post("/chats/:jid/messages", inboxH.SendMessage)
	inbox.Post("/chats/:jid/messages/media", inboxH.SendMedia)
	inbox.Post("/chats/:jid/read", inboxH.MarkRead)
	inbox.Post("/chats/:jid/typing", inboxH.Typing)
	inbox.Put("/contacts/:id", inboxH.UpdateContact)
	inbox.Patch("/messages/:id", inboxH.UpdateMessage)
	inbox.Post("/messages/:msgID/resend", inboxH.Resend)

	// Legacy chats endpoint
	instance.Get("/chats", msgH.GetChats)

	// API Keys
	apiKeys := api.Group("/api-keys")
	apiKeys.Get("/", apiKeyH.List)
	apiKeys.Post("/", apiKeyH.Create)
	apiKeys.Delete("/:id", apiKeyH.Delete)

	// ─── Proxies (catálogo) ──────────────────────────────────────────────────
	// Plataforma (is_platform=true, admin-managed) + custom do usuário.
	proxies := api.Group("/proxies")
	proxies.Get("/", proxyH.ListAvailable)          // platform + próprios, pra usar no server
	proxies.Get("/platform", proxyH.ListPlatform)   // proxies Uniq ativos (só name/country/provider)
	proxies.Get("/mine", proxyH.ListMine)           // só os próprios (integrations)
	proxies.Post("/", proxyH.Create)                // criar custom (plano pago)
	proxies.Put("/:id", proxyH.Update)              // editar próprio
	proxies.Delete("/:id", proxyH.Delete)           // deletar próprio
	proxies.Post("/:id/test", proxyH.Test)          // testar qualquer visível
	proxies.Post("/test-inline", proxyH.TestInline) // testar credenciais sem persistir
	// Alias legado: /proxy/global (admin) continua funcionando pra UI antiga
	api.Get("/proxy/global", middleware.RequireAdmin(), adminH.GetGlobalProxyConfig)
	api.Put("/proxy/global", middleware.RequireAdmin(), adminH.UpdateGlobalProxyConfig)

	// ─── Servers ──────────────────────────────────────────────────────────────
	servers := api.Group("/servers")
	servers.Get("/", serverH.List)
	servers.Post("/", serverH.Create)
	servers.Get("/:id", serverH.Get)
	servers.Put("/:id", serverH.Update)
	servers.Delete("/:id", serverH.Delete)
	servers.Get("/:id/instances", serverH.Instances)
	servers.Post("/:id/actions", serverH.BulkAction)
	servers.Get("/:id/stats", serverH.Stats)
	// Server-level proxy configuration (herded by child instances with mode=inherit)
	servers.Get("/:id/proxy", serverH.GetProxy)
	servers.Put("/:id/proxy", serverH.SetProxy)
	servers.Delete("/:id/proxy", serverH.DeleteProxy)
	servers.Post("/:id/proxy/test", serverH.TestProxy)

	// Link preview — fetcha OG/Twitter card metadata. Cache 7d.
	linkPreviewSvc := services.NewLinkPreviewService(db)
	linkPreviewH := handlers.NewLinkPreviewHandler(linkPreviewSvc)
	api.Get("/link-preview", linkPreviewH.Get)

	admin := api.Group("/admin", middleware.RequireAdmin())
	// Diagnostic: media storage health check (upload+presign+fetch)
	admin.Get("/media/health", mediaH.Check)
	// Rotas específicas primeiro (sem parâmetros)
	admin.Get("/stats", adminH.Stats)
	admin.Get("/audit-logs", adminH.ListAuditLogs)
	admin.Get("/users", adminH.ListUsers)
	admin.Post("/users", adminH.CreateUser)
	admin.Get("/plans", adminH.ListPlans)
	admin.Post("/plans", adminH.CreatePlan)
	admin.Get("/payment-settings", adminH.GetPaymentSettings)
	admin.Put("/payment-settings", adminH.UpdatePaymentSettings)
	// Test endpoint: chama o provider em read-only pra confirmar que a
	// credencial é aceita. Atualiza test_status que a UI consome.
	admin.Post("/payment-settings/test/:provider", adminH.TestPaymentProvider)
	// Email provider & templates
	admin.Get("/email-settings", adminH.GetEmailSettings)
	admin.Put("/email-settings", adminH.UpdateEmailSettings)
	admin.Post("/email-settings/test", adminH.TestEmail)
	admin.Get("/email-templates", adminH.ListEmailTemplates)
	admin.Get("/email-templates/:id", adminH.GetEmailTemplate)
	admin.Put("/email-templates/:id", adminH.UpdateEmailTemplate)
	admin.Post("/email-templates/:id/test", adminH.TestEmailTemplate)
	admin.Get("/email-logs", adminH.GetEmailLogs)
	// Communication settings (OTP + automated messages)
	admin.Get("/communication-settings", adminH.GetCommunicationSettings)
	admin.Put("/communication-settings", adminH.UpdateCommunicationSettings)
	admin.Get("/proxy-config", adminH.GetGlobalProxyConfig)
	admin.Put("/proxy-config", adminH.UpdateGlobalProxyConfig)
	admin.Delete("/proxy-config/:id", adminH.DeleteGlobalProxyConfig)
	admin.Post("/proxy-test", adminH.TestGlobalProxy)
	admin.Get("/proxy-stats", adminH.GetGlobalProxyStats)
	// Sprint billing F — audit de mudanças de plano
	admin.Get("/plan-changes", adminH.AllPlanChanges)
	admin.Get("/users/:id/plan-changes", adminH.ListUserPlanChanges)
	// Inspect/Support routes - list all servers and instances for super admin support
	inspect := admin.Group("/inspect")
	inspect.Get("/servers", adminH.ListAllServers)
	inspect.Get("/instances", adminH.ListAllInstances)
	inspect.Get("/instances/:id", adminH.GetInstance)
	// Rotas com parâmetros por último
	admin.Put("/users/:id", adminH.UpdateUser)
	admin.Post("/users/:id/reset-password", adminH.ResetPassword)
	// Billing link — gera URL Stripe pra cobrar/atualizar assinatura de
	// user existente. Faz upgrade/downgrade in-place quando já há sub
	// ativa (subscription.Update + proration); senão, devolve checkout.
	admin.Post("/users/:id/billing-link", stripeH.AdminCreateBillingLink)

	// Admin Billing — visão consolidada + ações cirúrgicas sobre o
	// faturamento de um user (overview, criar fatura avulsa, toggle de
	// cobranças extras). Frontend: BillingPanelModal em /admin/users.
	adminBillingH := handlers.NewAdminBillingHandler(db, asaasH)
	admin.Get("/users/:id/billing/overview", adminBillingH.Overview)
	admin.Post("/users/:id/billing/custom-invoice", adminBillingH.CreateCustomInvoice)
	admin.Patch("/users/:id/billing/overage", adminBillingH.ToggleOverage)

	admin.Delete("/users/:id", adminH.DeleteUser)
	admin.Get("/users/:id/delete-diagnose", adminH.UserDeleteDiagnose)
	admin.Put("/plans/:id", adminH.UpdatePlan)
	admin.Post("/invites/toggle", inviteH.ToggleSystem)
	admin.Get("/invites", inviteH.AdminList)
	// Platform AI (Uniq AI) — configuração global de IA (multi-config)
	admin.Get("/platform-ai", adminH.ListPlatformAI)
	admin.Post("/platform-ai", adminH.CreatePlatformAI)
	admin.Put("/platform-ai/:id", adminH.UpdatePlatformAIByID)
	admin.Delete("/platform-ai/:id", adminH.DeletePlatformAI)
	admin.Post("/platform-ai/:id/test", adminH.TestPlatformAIByID)
	// Uniq Voice — TTS gerenciado pela plataforma. Espelha o pattern do
	// platform-ai: super admin configura providers globais (OpenAI TTS,
	// ElevenLabs, etc) que viram a "Uniq Voice" pros workspaces que têm
	// allow_voice no plano e não configuraram VoiceProvider próprio.
	admin.Get("/platform-voice", adminH.ListPlatformVoice)
	admin.Post("/platform-voice", adminH.CreatePlatformVoice)
	admin.Put("/platform-voice/:id", adminH.UpdatePlatformVoiceByID)
	admin.Delete("/platform-voice/:id", adminH.DeletePlatformVoice)
	admin.Post("/platform-voice/:id/test", adminH.TestPlatformVoice)

	// Pricing config (singleton — margens dinâmicas, custo bruto por
	// provider, top-up packs publicados). UpdatePricingConfig invalida
	// o cache do UsageRecorder pra refletir mudança em <5s.
	admin.Get("/pricing-config", adminH.GetPricingConfig)
	admin.Put("/pricing-config", adminH.UpdatePricingConfig)

	// Usage admin — inspeção de quota por user, grant manual de créditos,
	// reset de ciclo, dashboard global de consumo.
	admin.Get("/users/:id/usage", adminH.GetUserUsage)
	admin.Post("/users/:id/topup-grant", adminH.GrantTopup)
	admin.Post("/users/:id/usage-reset", adminH.ResetUserCycle)
	admin.Get("/usage/global", adminH.GetGlobalUsage)

	// ─── Customer.io / Close-inspired modules ──────────────────────────
	segH := handlers.NewSegmentHandler(db)
	supH := handlers.NewSuppressionHandler(db)
	subH := handlers.NewSubscriptionHandler(db)
	importH := handlers.NewCRMImportHandler(db)

	// Segments (CRM)
	segs := api.Group("/segments", middleware.RequireFeature(db, models.FeatureCRM))
	segs.Get("/", segH.List)
	segs.Post("/", segH.Create)
	segs.Patch("/:id", segH.Update)
	segs.Delete("/:id", segH.Delete)
	segs.Post("/preview", segH.Preview)
	segs.Post("/overlap", segH.Overlap)
	segs.Post("/:id/import-csv", segH.CSVImport)

	// Suppression list (LGPD opt-out global)
	supps := api.Group("/suppressions")
	supps.Get("/", supH.List)
	supps.Post("/", supH.Create)
	supps.Delete("/:id", supH.Delete)

	// Subscription topics + Preference Center
	subs := api.Group("/subscription-topics")
	subs.Get("/", subH.ListTopics)
	subs.Post("/", subH.CreateTopic)
	subs.Patch("/:id", subH.UpdateTopic)
	subs.Delete("/:id", subH.DeleteTopic)
	api.Post("/contacts/:id/preference-link", subH.GeneratePreferenceLink)
	// Preference Center público (sem auth)
	app.Get("/p/preferences/:token", subH.PublicGet)
	app.Post("/p/preferences/:token", subH.PublicUpdate)

	// CRM Import (CSV) — contatos / empresas / deals
	crmImport := api.Group("/crm", middleware.RequireFeature(db, models.FeatureCRM))
	crmImport.Post("/contacts/import", importH.ImportContacts)
	crmImport.Post("/companies/import", importH.ImportCompanies)
	crmImport.Post("/deals/import", importH.ImportDeals)

	// Identity Resolution — merge contatos duplicados
	api.Get("/contacts/duplicates", conversationH.FindDuplicates)
	api.Post("/contacts/merge", conversationH.MergeContacts)

	// MCP server (Uniq tools via JSON-RPC pra Claude Desktop / Cursor / n8n)
	uniqMCP := handlers.NewUniqMCPHandler(db, toolsH)
	api.Post("/mcp", uniqMCP.HandleRPC)

	return app
}
