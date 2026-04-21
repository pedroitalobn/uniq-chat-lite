package api

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/websocket/v2"
	"github.com/uniq-chat/backend/internal/api/handlers"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// SetupRouter configures all routes and returns the Fiber app.
func SetupRouter(db *gorm.DB, manager *whatsapp.Manager) *fiber.App {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": err.Error()})
		},
	})

	// Global middleware
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			// Allow configured frontend URL(s) — supports comma-separated list
			for _, allowed := range strings.Split(config.AppConfig.FrontendURL, ",") {
				if strings.TrimSpace(allowed) == origin {
					return true
				}
			}
			// Always allow any localhost origin for local development
			return strings.HasPrefix(origin, "http://localhost:") ||
				strings.HasPrefix(origin, "http://127.0.0.1:")
		},
		AllowCredentials: true,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, X-API-Key, Upgrade, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions",
		AllowMethods:     "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
	}))

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
			{ID: "whatsapp", Label: "WhatsApp", Color: "#25d366", Description: "Conecte números WhatsApp via QR ou código de pareamento", Available: true},
			{ID: "instagram", Label: "Instagram", Color: "#e1306c", Description: "DMs, follow/unfollow, publicação de conteúdo", Available: true},
			{ID: "tiktok", Label: "TikTok", Color: "#ff0050", Description: "DMs, scraping, follow/unfollow, interação com conteúdo", Available: false},
			{ID: "facebook", Label: "Facebook", Color: "#1877f2", Description: "Gerencie mensagens do Facebook Messenger via Meta API", Available: false},
			{ID: "telegram", Label: "Telegram", Color: "#229ed9", Description: "Crie bots e gerencie mensagens via Telegram Bot API", Available: false},
			{ID: "linkedin", Label: "LinkedIn", Color: "#0a66c2", Description: "Automatize mensagens e InMails via LinkedIn API", Available: false},
			{ID: "kwai", Label: "Kwai", Color: "#ff6600", Description: "Gerencie mensagens e interações via Kwai", Available: false},
			{ID: "waba", Label: "WhatsApp Business", Color: "#25d366", Description: "Conecte números via WhatsApp Business API (WABA)", Available: true},
		}
		return c.JSON(channels)
	}
	app.Get("/channels", channelsHandler)
	app.Get("/v1/channels", channelsHandler)

	// Email service
	emailSvc := email.New(
		config.AppConfig.ResendAPIKey,
		config.AppConfig.FromEmail,
		config.AppConfig.MailerooSenderName,
		config.AppConfig.AppName,
		config.AppConfig.AppURL,
	)
	handlers.SetAuthHandlerAppURL(config.AppConfig.AppURL)

	// Handlers
	authH := handlers.NewAuthHandler(db, emailSvc, manager)
	stripeH := handlers.NewStripeHandler(db, emailSvc)
	asaasH := handlers.NewAsaasHandler(db, emailSvc)
	paymentH := handlers.NewPaymentHandler(db, stripeH, asaasH)
	instanceH := handlers.NewInstanceHandler(db, manager)
	proxyH := handlers.NewProxyHandler(db, manager)
	msgH := handlers.NewMessageHandler(db, manager)
	webhookH := handlers.NewWebhookHandler(db, manager)
	globalWebhookH := handlers.NewGlobalWebhookHandler(db)
	apiKeyH := handlers.NewAPIKeyHandler(db)
	adminH := handlers.NewAdminHandler(db, emailSvc)
	adminH.SetManager(manager) // permite propagar mudanças de proxy global às instâncias em runtime
	wsH := handlers.NewWSHandler(db, manager)
	mcpH := handlers.NewMCPHandler(db, manager)
	contactH := handlers.NewContactHandler(db)
	groupH := handlers.NewGroupHandler(db, manager)
	campaignH := handlers.NewCampaignHandler(db, manager)
	otpH := handlers.NewOTPHandler(db, manager)
	serverH := handlers.NewServerHandler(db, whatsapp.GetHub())
	integrationH := handlers.NewIntegrationHandler(db)
	recoveryH := handlers.NewRecoveryHandler(db, manager)

	// TikTok automation (legacy taktik bridge)
	taktikSvc := services.NewTaktikService(db)
	tiktokH := handlers.NewTikTokHandler(db, taktikSvc)

	// AI Services
	llmService := services.NewLLMService()
	toolsH := handlers.NewToolsHandler(db, manager)
	chatH := handlers.NewChatHandler(db, llmService)
	chatH.SetToolsHandler(toolsH)
	journeyH := handlers.NewJourneyHandler(db, llmService, manager)
	agentH := handlers.NewAgentHandler(db)
	inboxH := handlers.NewInboxHandler(db, manager)
	workspaceH := handlers.NewWorkspaceHandler(db)
	roleH := handlers.NewRoleHandler(db)
	inviteH := handlers.NewInviteHandler(db)

	// WABA
	wabaH := handlers.NewWABAHandler(db)

	// Plans (public — used by pricing/register page)
	app.Get("/stripe/plans", paymentH.ListPlans)
	app.Get("/asaas/plans", paymentH.ListPlans)
	app.Get("/payments/plans", paymentH.ListPlans)

	// v1 aliases for plans (public, release 1.1 compatibility)
	app.Get("/v1/stripe/plans", paymentH.ListPlans)
	app.Get("/v1/asaas/plans", paymentH.ListPlans)
	app.Get("/v1/payments/plans", paymentH.ListPlans)

	// Stripe webhook (public — must receive raw body, Stripe signature verified internally)
	app.Post("/stripe/webhook", stripeH.Webhook)

	// Activate lead after payment (public)
	app.Post("/stripe/activate-lead", stripeH.ActivateLead)

	// Asaas webhook (public)
	app.Post("/asaas/webhook", asaasH.Webhook)

	// ─── Auth routes (public) ─────────────────────────────────────────────────
	auth := app.Group("/auth")
	auth.Post("/login", authH.Login)
	auth.Post("/register", authH.Register)
	auth.Post("/validate-key", authH.ValidateKey)
	auth.Post("/refresh", authH.Refresh)
	auth.Post("/logout", authH.Logout)
	auth.Post("/forgot-password", authH.ForgotPassword)
	auth.Post("/reset-password", authH.ResetPassword)
	auth.Get("/me", middleware.RequireAuth(db), authH.Me)
	auth.Put("/me", middleware.RequireAuth(db), authH.UpdateMe)
	auth.Post("/change-password", middleware.RequireAuth(db), authH.ChangePassword)

	// ─── Public v1 routes (no auth required) ─────────────────────────────────
	v1Public := app.Group("/v1")

	// Invite system (public)
	v1Public.Get("/invites/status", inviteH.GetStatus)
	v1Public.Post("/invites/validate", inviteH.Validate)

	// ─── Protected routes ─────────────────────────────────────────────────────
	api := app.Group("/v1", middleware.RequireAuth(db), middleware.RateLimit(300))

	// Workspaces
	workspaces := api.Group("/workspaces")
	workspaces.Get("/", workspaceH.List)
	workspaces.Post("/", workspaceH.Create)
	workspaces.Post("/accept-invite/:token", workspaceH.AcceptInvite)

	// Workspace-specific routes
	workspace := workspaces.Group("/:id")
	workspace.Get("/", workspaceH.Get)
	workspace.Put("/", workspaceH.Update)
	workspace.Delete("/", workspaceH.Delete)
	workspace.Get("/members", workspaceH.ListMembers)
	workspace.Delete("/members/:member_id", workspaceH.RemoveMember)
	workspace.Post("/invites", workspaceH.CreateInvite)
	workspace.Get("/invites", workspaceH.ListInvites)
	workspace.Delete("/invites/:invite_id", workspaceH.RevokeInvite)

	// Roles (nested under workspace)
	roles := workspace.Group("/roles")
	roles.Get("/", roleH.List)
	roles.Post("/", roleH.Create)
	roles.Get("/:role_id", roleH.Get)
	roles.Put("/:role_id", roleH.Update)
	roles.Delete("/:role_id", roleH.Delete)

	// Global System Webhooks
	systemWebhooks := api.Group("/webhooks/system")
	systemWebhooks.Get("/events", globalWebhookH.ListEvents)
	systemWebhooks.Get("/", globalWebhookH.List)
	systemWebhooks.Post("/", globalWebhookH.Create)
	systemWebhooks.Put("/:id", globalWebhookH.Update)
	systemWebhooks.Delete("/:id", globalWebhookH.Delete)
	systemWebhooks.Post("/:id/test", globalWebhookH.Test)

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
	instance.Delete("/", instanceH.Delete)
	instance.Get("/qr", instanceH.GetQR)
	instance.Post("/pairing-code", instanceH.GetPairingCode)
	instance.Post("/disconnect", instanceH.Disconnect)
	instance.Post("/reconnect", instanceH.Reconnect)
	instance.Get("/status", instanceH.Status)
	instance.Post("/contact/info", instanceH.ContactInfo)
	instance.Post("/contact/avatar", instanceH.ContactAvatar)

	// Instagram routes
	instance.Post("/instagram/login", instanceH.InstagramLogin)
	instance.Post("/instagram/logout", instanceH.InstagramLogout)
	instance.Post("/instagram/dm", instanceH.InstagramSendDM)
	instance.Get("/instagram/dm", instanceH.InstagramGetInbox)
	instance.Post("/instagram/follow", instanceH.InstagramFollow)
	instance.Post("/instagram/unfollow", instanceH.InstagramUnfollow)
	instance.Post("/instagram/pause", instanceH.InstagramPause)
	instance.Post("/instagram/resume", instanceH.InstagramResume)
	instance.Post("/instagram/post", instanceH.InstagramPublishPost)
	instance.Post("/instagram/story", instanceH.InstagramUploadStory)
	instance.Get("/instagram/media", instanceH.InstagramGetUserMedia)
	instance.Post("/instagram/like", instanceH.InstagramLikeMedia)
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

	// Public webhook (no auth required)
	wabaPost := app.Group("/waba/webhook")
	wabaPost.Post("/", wabaH.Webhook)

	// Instance-specific WABA routes
	instanceWaba := instance.Group("/waba")
	instanceWaba.Get("/", wabaH.GetWABA)
	instanceWaba.Delete("/", wabaH.DeleteWABA)
	instanceWaba.Get("/phone-numbers", wabaH.ListPhoneNumbers)
	instanceWaba.Post("/messages", wabaH.SendMessage)

	// Global WebSocket for real-time events
	app.Get("/ws/events", wsH.EventsWS)

	// WebSocket per instance (legacy, for specific instance events)
	instance.Get("/ws", wsH.InstanceWS)

	// MCP (Model Context Protocol)
	instance.Get("/mcp/sse", mcpH.SSE)
	instance.Post("/mcp/message", mcpH.Message)
	instance.Get("/mcp/tools", mcpH.Tools)

	// Proxy (read-only na instância — config fica no server)
	instance.Get("/proxy", proxyH.Get)
	instance.Get("/proxy/effective", proxyH.Effective)

	// Messages
	msgs := instance.Group("/messages")
	msgs.Get("/", msgH.GetMessages)
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
	msgs.Post("/menu", msgH.SendMenu)
	msgs.Post("/sticker", msgH.SendSticker)
	msgs.Post("/status", msgH.SendStatus)
	msgs.Post("/presence", msgH.SendPresence)
	msgs.Post("/payment-request", msgH.RequestPayment)
	msgs.Post("/revoke", msgH.RevokeMessage)
	msgs.Post("/typing", msgH.SendTyping)
	msgs.Post("/read", msgH.MarkRead)

	// Recovery
	recovery := instance.Group("/recovery")
	recovery.Get("/", recoveryH.Get)
	recovery.Post("/snapshot", recoveryH.Snapshot)
	recovery.Post("/reset", recoveryH.Reset)
	recovery.Put("/schedule", recoveryH.SetSchedule)

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
	crm := api.Group("/crm")
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
	funnels.Delete("/:id", contactH.DeleteFunnel)
	funnels.Get("/:id/stages", contactH.ListFunnelStages)
	funnels.Post("/:id/stages", contactH.CreateFunnelStage)
	funnels.Delete("/:id/stages/:stageId", contactH.DeleteFunnelStage)

	crm.Get("/journey-options", contactH.ListJourneyOptions)
	crm.Get("/stage-options", contactH.ListStageOptions)
	crm.Get("/funnel-options", contactH.ListFunnelOptions)

	// ─── Campaign routes ───────────────────────────────────────────────────────
	campaigns := api.Group("/campaigns")
	campaigns.Get("/", campaignH.List)
	campaigns.Post("/", campaignH.Create)
	campaigns.Get("/segment-options", campaignH.SegmentOptions)
	campaigns.Post("/segment-preview", campaignH.SegmentPreview)
	campaigns.Get("/:id", campaignH.Get)
	campaigns.Post("/:id/start", campaignH.Start)
	campaigns.Post("/:id/pause", campaignH.Pause)
	campaigns.Post("/:id/cancel", campaignH.Cancel)
	campaigns.Delete("/:id", campaignH.Delete)

	// Stripe (protected)
	stripeRoutes := api.Group("/stripe")
	stripeRoutes.Post("/checkout", paymentH.CreateCheckout)
	stripeRoutes.Get("/subscription", paymentH.GetSubscription)

	// Asaas (protected)
	asaasRoutes := api.Group("/asaas")
	asaasRoutes.Post("/checkout", paymentH.CreateCheckout)
	asaasRoutes.Get("/subscription", paymentH.GetSubscription)

	// Payments (protected)
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
	integrations.Put("/:id", integrationH.Update)
	integrations.Delete("/:id", integrationH.Delete)
	integrations.Post("/:id/test", integrationH.Test)
	integrations.Post("/:id/oauth/refresh", integrationH.RefreshClaudeOAuth)

	// AI generation (uses user integrations)
	api.Post("/ai/generate", integrationH.GenerateVariations)

	// AI Chat & Journeys
	api.Post("/ai/chat", chatH.HandleChat)
	api.Get("/ai/tools", chatH.GetTools)
	journeys := api.Group("/journeys")
	journeys.Get("/", journeyH.ListJourneys)
	journeys.Post("/", journeyH.CreateJourney)
	journeys.Get("/templates", journeyH.ListTemplates)
	journeys.Post("/from-template/:slug", journeyH.CreateFromTemplate)
	journeys.Patch("/:id/status", journeyH.ToggleStatus)
	journeys.Patch("/:id/flow", journeyH.UpdateFlow)
	journeys.Post("/:id/edit-llm", journeyH.EditFlowWithLLM)
	journeys.Post("/:id/simulate", journeyH.SimulateJourney)
	journeys.Delete("/:id", journeyH.DeleteJourney)
	journeys.Get("/:id", journeyH.GetJourney)
	journeys.Get("/:id/executions", agentH.GetJourneyExecutions)

	// Agent Center
	agent := api.Group("/agent")
	agent.Get("/stats", agentH.GetStats)
	agent.Get("/activity", agentH.GetActivity)
	agent.Get("/instances", agentH.GetInstances)
	agent.Post("/executions/:id/stop", agentH.StopExecution)

	// Agent WebSocket
	app.Get("/ws/agent-activity", websocket.New(func(c *websocket.Conn) {
		agentH.ActivityWS(c)
	}))

	// Instance agent (AI agent config per instance)
	instance.Get("/agent", integrationH.GetAgent)
	instance.Put("/agent", integrationH.UpdateAgent)

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
	proxies.Get("/", proxyH.ListAvailable)       // platform + próprios, pra usar no server
	proxies.Get("/mine", proxyH.ListMine)        // só os próprios (integrations)
	proxies.Post("/", proxyH.Create)             // criar custom (plano pago)
	proxies.Put("/:id", proxyH.Update)           // editar próprio
	proxies.Delete("/:id", proxyH.Delete)        // deletar próprio
	proxies.Post("/:id/test", proxyH.Test)       // testar qualquer visível
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

	// ─── Admin routes ─────────────────────────────────────────────────────────
	admin := api.Group("/admin", middleware.RequireAdmin())
	// Rotas específicas primeiro (sem parâmetros)
	admin.Get("/stats", adminH.Stats)
	admin.Get("/users", adminH.ListUsers)
	admin.Post("/users", adminH.CreateUser)
	admin.Get("/plans", adminH.ListPlans)
	admin.Post("/plans", adminH.CreatePlan)
	admin.Get("/payment-settings", adminH.GetPaymentSettings)
	admin.Put("/payment-settings", adminH.UpdatePaymentSettings)
	admin.Get("/proxy-config", adminH.GetGlobalProxyConfig)
	admin.Put("/proxy-config", adminH.UpdateGlobalProxyConfig)
	admin.Delete("/proxy-config/:id", adminH.DeleteGlobalProxyConfig)
	admin.Post("/proxy-test", adminH.TestGlobalProxy)
	admin.Get("/proxy-stats", adminH.GetGlobalProxyStats)
	// Inspect/Support routes - list all servers and instances for super admin support
	inspect := admin.Group("/inspect")
	inspect.Get("/servers", adminH.ListAllServers)
	inspect.Get("/instances", adminH.ListAllInstances)
	inspect.Get("/instances/:id", adminH.GetInstance)
	// Rotas com parâmetros por último
	admin.Put("/users/:id", adminH.UpdateUser)
	admin.Post("/users/:id/reset-password", adminH.ResetPassword)
	admin.Delete("/users/:id", adminH.DeleteUser)
	admin.Put("/plans/:id", adminH.UpdatePlan)
	admin.Post("/invites/toggle", inviteH.ToggleSystem)
	admin.Get("/invites", inviteH.AdminList)

	// ─── Public v1 API: /v1/:server_slug/:instance_slug/* ─────────────────────
	// Auth: Authorization: Bearer <instance_token>  OR  X-Instance-Token: <token>
	v1inst := app.Group("/v1/:server_slug/:instance_slug", middleware.ResolveV1Instance(db), middleware.RateLimit(300))

	// Messages
	v1msgs := v1inst.Group("/messages")
	v1msgs.Get("/", msgH.GetMessages)
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
	v1msgs.Post("/menu", msgH.SendMenu)
	v1msgs.Post("/sticker", msgH.SendSticker)
	v1msgs.Post("/status", msgH.SendStatus)
	v1msgs.Post("/presence", msgH.SendPresence)
	v1msgs.Post("/payment-request", msgH.RequestPayment)
	v1msgs.Post("/revoke", msgH.RevokeMessage)
	v1msgs.Post("/typing", msgH.SendTyping)
	v1msgs.Post("/read", msgH.MarkRead)

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
	v1groups.Get("/:jid", groupH.Get)
	v1groups.Put("/:jid", groupH.Update)
	v1groups.Post("/:jid/participants", groupH.UpdateParticipants)
	v1groups.Get("/:jid/invite", groupH.InviteLink)
	v1groups.Post("/:jid/leave", groupH.Leave)

	return app
}
