package api

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/uniq-chat/backend/internal/api/handlers"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
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
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, X-API-Key",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
	}))

	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "service": "uniq-chat"})
	})

	// Channels metadata (public — used by UI to list available channels)
	app.Get("/channels", func(c *fiber.Ctx) error {
		type channelInfo struct {
			ID          string `json:"id"`
			Label       string `json:"label"`
			Color       string `json:"color"`
			Description string `json:"description"`
			Available   bool   `json:"available"`
		}
		channels := []channelInfo{
			{ID: "whatsapp",  Label: "WhatsApp",  Color: "#25d366", Description: "Conecte números WhatsApp via QR ou código de pareamento",          Available: true},
			{ID: "instagram", Label: "Instagram", Color: "#e1306c", Description: "Conecte Instagram e gerencie DMs (instagram-cli / Meta Graph API)", Available: false},
			{ID: "facebook",  Label: "Facebook",  Color: "#1877f2", Description: "Gerencie mensagens do Facebook Messenger via Meta API",             Available: false},
			{ID: "telegram",  Label: "Telegram",  Color: "#229ed9", Description: "Crie bots e gerencie mensagens via Telegram Bot API",               Available: false},
			{ID: "linkedin",  Label: "LinkedIn",  Color: "#0a66c2", Description: "Automatize mensagens e InMails via LinkedIn API",                   Available: false},
			{ID: "tiktok",    Label: "TikTok",    Color: "#ff0050", Description: "Gerencie mensagens diretas e comentários via TikTok",               Available: false},
			{ID: "kwai",      Label: "Kwai",      Color: "#ff6600", Description: "Gerencie mensagens e interações via Kwai",                          Available: false},
		}
		return c.JSON(channels)
	})

	// Email service
	emailSvc := email.New(
		config.AppConfig.ResendAPIKey,
		config.AppConfig.FromEmail,
		config.AppConfig.AppName,
		config.AppConfig.AppURL,
	)
	handlers.SetAuthHandlerAppURL(config.AppConfig.AppURL)

	// Handlers
	authH := handlers.NewAuthHandler(db, emailSvc)
	stripeH := handlers.NewStripeHandler(db, emailSvc)
	instanceH := handlers.NewInstanceHandler(db, manager)
	proxyH := handlers.NewProxyHandler(db, manager)
	msgH := handlers.NewMessageHandler(db, manager)
	webhookH := handlers.NewWebhookHandler(db, manager)
	apiKeyH := handlers.NewAPIKeyHandler(db)
	adminH := handlers.NewAdminHandler(db, emailSvc)
	wsH := handlers.NewWSHandler(db, manager)
	mcpH := handlers.NewMCPHandler(db, manager)
	groupH := handlers.NewGroupHandler(db, manager)
	contactH := handlers.NewContactHandler(db)
	campaignH := handlers.NewCampaignHandler(db, manager)
	otpH := handlers.NewOTPHandler(db, manager)
	serverH := handlers.NewServerHandler(db)
	instagramH := handlers.NewInstagramHandler(db)
	integrationH := handlers.NewIntegrationHandler(db)
	recoveryH := handlers.NewRecoveryHandler(db, manager)

	// Plans (public — used by pricing/register page)
	app.Get("/stripe/plans", stripeH.ListPlans)

	// Stripe webhook (public — must receive raw body, Stripe signature verified internally)
	app.Post("/stripe/webhook", stripeH.Webhook)

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

	// ─── Protected routes ─────────────────────────────────────────────────────
	api := app.Group("/", middleware.RequireAuth(db), middleware.RateLimit(300))

	// Instances
	instances := api.Group("/instances")
	instances.Get("/", instanceH.List)
	instances.Post("/", instanceH.Create)

	// Instance-specific routes (with ownership check)
	instance := instances.Group("/:id", middleware.OwnsInstance(db))
	instance.Get("/", instanceH.Get)
	instance.Delete("/", instanceH.Delete)
	instance.Get("/qr", instanceH.GetQR)
	instance.Post("/pairing-code", instanceH.GetPairingCode)
	instance.Post("/disconnect", instanceH.Disconnect)
	instance.Post("/reconnect", instanceH.Reconnect)
	instance.Get("/status", instanceH.Status)
	instance.Get("/profile", instanceH.Profile)
	instance.Get("/settings", instanceH.GetSettings)
	instance.Put("/settings", instanceH.UpdateSettings)
	instance.Post("/regenerate-token", instanceH.RegenerateToken)

	// WebSocket
	instance.Get("/ws", wsH.InstanceWS)

	// MCP (Model Context Protocol)
	instance.Get("/mcp/sse", mcpH.SSE)
	instance.Post("/mcp/message", mcpH.Message)
	instance.Get("/mcp/tools", mcpH.Tools)

	// Proxy
	instance.Get("/proxy", proxyH.Get)
	instance.Put("/proxy", proxyH.Set)
	instance.Post("/proxy/test", proxyH.Test)
	instance.Delete("/proxy", proxyH.Delete)

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
	msgs.Post("/list", msgH.SendList)
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
	instance.Get("/chats", msgH.GetChats)
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

	// ─── Instagram channel routes ─────────────────────────────────────────────
	// Reuses OwnsInstance middleware — instance must have channel = "instagram"
	igInst := api.Group("/instagram/instances/:id", middleware.OwnsInstance(db))
	igInst.Post("/connect", instagramH.Connect)
	igInst.Post("/disconnect", instagramH.Disconnect)
	igInst.Get("/messages/dm", instagramH.GetDMs)
	igInst.Post("/messages/dm", instagramH.SendDM)

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

	// ─── Campaign routes ───────────────────────────────────────────────────────
	campaigns := api.Group("/campaigns")
	campaigns.Get("/", campaignH.List)
	campaigns.Post("/", campaignH.Create)
	campaigns.Get("/:id", campaignH.Get)
	campaigns.Post("/:id/start", campaignH.Start)
	campaigns.Post("/:id/pause", campaignH.Pause)
	campaigns.Post("/:id/cancel", campaignH.Cancel)
	campaigns.Delete("/:id", campaignH.Delete)

	// Stripe (protected)
	stripeRoutes := api.Group("/stripe")
	stripeRoutes.Post("/checkout", stripeH.CreateCheckout)
	stripeRoutes.Get("/subscription", stripeH.GetSubscription)

	// Integrations (account-level LLM/tool connections)
	integrations := api.Group("/integrations")
	integrations.Get("/", integrationH.List)
	integrations.Post("/", integrationH.Create)
	integrations.Put("/:id", integrationH.Update)
	integrations.Delete("/:id", integrationH.Delete)
	integrations.Post("/:id/test", integrationH.Test)

	// AI generation (uses user integrations)
	api.Post("/ai/generate", integrationH.GenerateVariations)

	// Instance agent (AI agent config per instance)
	instance.Get("/agent", integrationH.GetAgent)
	instance.Put("/agent", integrationH.UpdateAgent)

	// API Keys
	apiKeys := api.Group("/api-keys")
	apiKeys.Get("/", apiKeyH.List)
	apiKeys.Post("/", apiKeyH.Create)
	apiKeys.Delete("/:id", apiKeyH.Delete)

	// ─── Servers ──────────────────────────────────────────────────────────────
	servers := api.Group("/servers")
	servers.Get("/", serverH.List)
	servers.Post("/", serverH.Create)
	servers.Get("/:id", serverH.Get)
	servers.Put("/:id", serverH.Update)
	servers.Delete("/:id", serverH.Delete)
	servers.Get("/:id/instances", serverH.Instances)

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
	v1msgs.Post("/list", msgH.SendList)
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

	// ─── Admin routes ─────────────────────────────────────────────────────────
	admin := api.Group("/admin", middleware.RequireAdmin())
	admin.Get("/users", adminH.ListUsers)
	admin.Post("/users", adminH.CreateUser)
	admin.Put("/users/:id", adminH.UpdateUser)
	admin.Post("/users/:id/reset-password", adminH.ResetPassword)
	admin.Delete("/users/:id", adminH.DeleteUser)
	admin.Get("/plans", adminH.ListPlans)
	admin.Post("/plans", adminH.CreatePlan)
	admin.Put("/plans/:id", adminH.UpdatePlan)
	admin.Get("/stats", adminH.Stats)

	return app
}
