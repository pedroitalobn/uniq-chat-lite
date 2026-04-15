package handlers

import (
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
}

func NewAdminHandler(db *gorm.DB, emailSvc *email.Service) *AdminHandler {
	return &AdminHandler{db: db, emailSvc: emailSvc}
}

// --- Payment Settings ---

// GetPaymentSettings godoc
// GET /admin/payment-settings
func (h *AdminHandler) GetPaymentSettings(c *fiber.Ctx) error {
	var settings models.PaymentSettings

	// Usar Where em vez de First para evitar problemas de tipo
	err := h.db.Where("id = ?", "default").First(&settings).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Criar configuração padrão se não existir
			settings = models.PaymentSettings{
				ID:                 "default",
				ActiveProvider:     models.PaymentProviderStripe,
				AsaasEnvironment:   "sandbox",
				AsaasCheckoutType:  "transparent",
				StripeCheckoutType: "redirect",
			}
			if createErr := h.db.Create(&settings).Error; createErr != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar configurações: " + createErr.Error()})
			}
		} else {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar configurações: " + err.Error()})
		}
	}

	// Check if keys are configured (DB or env fallback)
	stripeConfigured := settings.StripeSecretKey != "" || config.AppConfig.StripeSecretKey != ""
	asaasConfigured := settings.AsaasAPIKey != "" || config.AppConfig.AsaasAPIKey != ""
	hotmartConfigured := settings.HotmartAPIKey != ""

	// Determine active provider based on what's configured
	activeProvider := string(settings.ActiveProvider)
	if activeProvider == "stripe" && !stripeConfigured {
		// Stripe selected but not configured, check others
		if asaasConfigured {
			activeProvider = "asaas"
		} else if hotmartConfigured {
			activeProvider = "hotmart"
		}
	} else if activeProvider == "asaas" && !asaasConfigured {
		if stripeConfigured {
			activeProvider = "stripe"
		} else if hotmartConfigured {
			activeProvider = "hotmart"
		}
	}

	// Build webhook URLs
	appURL := strings.TrimRight(config.AppConfig.AppURL, "/")
	stripeWebhookURL := appURL + "/api/stripe/webhook"
	asaasWebhookURL := appURL + "/api/asaas/webhook"

	return c.JSON(fiber.Map{
		"id":                     settings.ID,
		"active_provider":        activeProvider,
		"stripe_secret_key":      settings.StripeSecretKey,
		"stripe_webhook_secret":  settings.StripeWebhookSecret,
		"stripe_checkout_type":   settings.StripeCheckoutType,
		"asaas_api_key":          settings.AsaasAPIKey,
		"asaas_environment":      settings.AsaasEnvironment,
		"asaas_webhook_secret":   settings.AsaasWebhookSecret,
		"asaas_checkout_type":    settings.AsaasCheckoutType,
		"hotmart_api_key":        settings.HotmartAPIKey,
		"hotmart_webhook_secret": settings.HotmartWebhookSecret,
		// Status de configuração
		"stripe_configured":  stripeConfigured,
		"asaas_configured":   asaasConfigured,
		"hotmart_configured": hotmartConfigured,
		// Webhook URLs
		"stripe_webhook_url": stripeWebhookURL,
		"asaas_webhook_url":  asaasWebhookURL,
	})
}

// UpdatePaymentSettings godoc
// PUT /admin/payment-settings
func (h *AdminHandler) UpdatePaymentSettings(c *fiber.Ctx) error {
	var req struct {
		ActiveProvider       string `json:"active_provider"`
		StripeSecretKey      string `json:"stripe_secret_key"`
		StripeWebhookSecret  string `json:"stripe_webhook_secret"`
		StripeCheckoutType   string `json:"stripe_checkout_type"`
		AsaasAPIKey          string `json:"asaas_api_key"`
		AsaasEnvironment     string `json:"asaas_environment"`
		AsaasWebhookSecret   string `json:"asaas_webhook_secret"`
		AsaasCheckoutType    string `json:"asaas_checkout_type"`
		HotmartAPIKey        string `json:"hotmart_api_key"`
		HotmartWebhookSecret string `json:"hotmart_webhook_secret"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var settings models.PaymentSettings
	err := h.db.Where("id = ?", "default").First(&settings).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			settings = models.PaymentSettings{ID: "default"}
			if err := h.db.Create(&settings).Error; err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar configurações: " + err.Error()})
			}
		} else {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar configurações: " + err.Error()})
		}
	}

	updates := map[string]interface{}{}
	if req.ActiveProvider != "" {
		updates["active_provider"] = req.ActiveProvider
	}
	if req.StripeSecretKey != "" {
		updates["stripe_secret_key"] = req.StripeSecretKey
	}
	if req.StripeWebhookSecret != "" {
		updates["stripe_webhook_secret"] = req.StripeWebhookSecret
	}
	if req.StripeCheckoutType != "" {
		updates["stripe_checkout_type"] = req.StripeCheckoutType
	}
	if req.AsaasAPIKey != "" {
		updates["asaas_api_key"] = req.AsaasAPIKey
	}
	if req.AsaasEnvironment != "" {
		updates["asaas_environment"] = req.AsaasEnvironment
	}
	if req.AsaasWebhookSecret != "" {
		updates["asaas_webhook_secret"] = req.AsaasWebhookSecret
	}
	if req.AsaasCheckoutType != "" {
		updates["asaas_checkout_type"] = req.AsaasCheckoutType
	}
	if req.HotmartAPIKey != "" {
		updates["hotmart_api_key"] = req.HotmartAPIKey
	}
	if req.HotmartWebhookSecret != "" {
		updates["hotmart_webhook_secret"] = req.HotmartWebhookSecret
	}

	if len(updates) > 0 {
		if err := h.db.Model(&settings).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar configurações"})
		}
	}

	h.db.First(&settings, "id = ?", "default")
	return c.JSON(fiber.Map{
		"id":                     settings.ID,
		"active_provider":        string(settings.ActiveProvider),
		"stripe_secret_key":      settings.StripeSecretKey,
		"stripe_webhook_secret":  settings.StripeWebhookSecret,
		"stripe_checkout_type":   settings.StripeCheckoutType,
		"asaas_api_key":          settings.AsaasAPIKey,
		"asaas_environment":      settings.AsaasEnvironment,
		"asaas_webhook_secret":   settings.AsaasWebhookSecret,
		"asaas_checkout_type":    settings.AsaasCheckoutType,
		"hotmart_api_key":        settings.HotmartAPIKey,
		"hotmart_webhook_secret": settings.HotmartWebhookSecret,
	})
}

// --- Users ---

// ListUsers godoc
// GET /admin/users
func (h *AdminHandler) ListUsers(c *fiber.Ctx) error {
	var users []models.User
	if err := h.db.Preload("Plan").Order("created_at DESC").Find(&users).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar usuários"})
	}
	return c.JSON(users)
}

// CreateUser godoc
// POST /admin/users
func (h *AdminHandler) CreateUser(c *fiber.Ctx) error {
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
		PlanID   string `json:"plan_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Name == "" || req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, email e password são obrigatórios"})
	}

	role := models.RoleCustomer
	if req.Role == "super_admin" {
		role = models.RoleSuperAdmin
	}

	user := models.User{
		Name:     req.Name,
		Email:    req.Email,
		Role:     role,
		IsActive: true,
	}
	if req.Username != "" {
		uname := req.Username
		user.Username = &uname
	}

	if req.PlanID != "" {
		pid, err := uuid.Parse(req.PlanID)
		if err == nil {
			user.PlanID = &pid
		}
	} else {
		var freePlan models.Plan
		if h.db.First(&freePlan, "name = 'Free'").Error == nil {
			user.PlanID = &freePlan.ID
		}
	}

	plainPassword := req.Password
	if err := user.SetPassword(req.Password); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
	}

	if err := h.db.Create(&user).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar usuário"})
	}

	h.emailSvc.SendAdminCreatedAccount(user.Email, user.Name, user.Email, plainPassword)

	h.db.Preload("Plan").First(&user, "id = ?", user.ID)
	return c.Status(fiber.StatusCreated).JSON(user)
}

// ResetPassword godoc
// POST /admin/users/:id/reset-password
func (h *AdminHandler) ResetPassword(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "senha deve ter ao menos 8 caracteres"})
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "usuário não encontrado"})
	}

	plainPassword := req.Password
	if err := user.SetPassword(req.Password); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
	}
	h.db.Model(&user).Update("password_hash", user.PasswordHash)

	h.emailSvc.SendAdminResetPassword(user.Email, user.Name, plainPassword)

	return c.JSON(fiber.Map{"message": "senha redefinida com sucesso"})
}

// UpdateUser godoc
// PUT /admin/users/:id
func (h *AdminHandler) UpdateUser(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "usuário não encontrado"})
	}

	var req struct {
		Name         string  `json:"name"`
		Role         string  `json:"role"`
		IsBeta       *bool   `json:"is_beta"`
		PlanID       string  `json:"plan_id"`
		IsActive     *bool   `json:"is_active"`
		BlockedUntil *string `json:"blocked_until"` // ISO 8601 or null to unblock
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Role == "admin" || req.Role == "user" {
		updates["role"] = req.Role
	}
	if req.IsBeta != nil {
		updates["is_beta"] = *req.IsBeta
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.PlanID != "" {
		pid, err := uuid.Parse(req.PlanID)
		if err == nil {
			updates["plan_id"] = pid
		}
	}
	if req.BlockedUntil != nil {
		if *req.BlockedUntil == "" || *req.BlockedUntil == "null" {
			updates["blocked_until"] = nil
		} else {
			t, err := time.Parse(time.RFC3339, *req.BlockedUntil)
			if err == nil {
				updates["blocked_until"] = t
			}
		}
	}

	if err := h.db.Model(&user).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar usuário"})
	}

	h.db.Preload("Plan").First(&user, "id = ?", user.ID)
	return c.JSON(user)
}

// DeleteUser godoc
// DELETE /admin/users/:id
func (h *AdminHandler) DeleteUser(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	if err := h.db.Delete(&models.User{}, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar usuário"})
	}

	return c.JSON(fiber.Map{"message": "usuário removido"})
}

// --- Plans ---

// ListPlans godoc
// GET /admin/plans
func (h *AdminHandler) ListPlans(c *fiber.Ctx) error {
	var plans []models.Plan
	if err := h.db.Order("price ASC").Find(&plans).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar planos"})
	}
	return c.JSON(plans)
}

// CreatePlan godoc
// POST /admin/plans
func (h *AdminHandler) CreatePlan(c *fiber.Ctx) error {
	var req struct {
		Name              string  `json:"name"`
		Price             float64 `json:"price"`
		MaxInstances      int     `json:"max_instances"`
		MaxMessagesPerDay int     `json:"max_messages_per_day"`
		MaxUsers          int     `json:"max_users"`
		MaxWorkspaces     int     `json:"max_workspaces"`
		Features          string  `json:"features"`
		AllowProxy        bool    `json:"allow_proxy"`
		StripePriceID     string  `json:"stripe_price_id"`
		AsaasProductID    string  `json:"asaas_product_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}

	features := req.Features
	if features == "" {
		features = "{}"
	}

	plan := models.Plan{
		Name:              req.Name,
		Price:             req.Price,
		MaxInstances:      req.MaxInstances,
		MaxMessagesPerDay: req.MaxMessagesPerDay,
		MaxUsers:          req.MaxUsers,
		MaxWorkspaces:     req.MaxWorkspaces,
		Features:          features,
		AllowProxy:        req.AllowProxy,
		StripePriceID:     req.StripePriceID,
		AsaasProductID:    req.AsaasProductID,
		IsActive:          true,
	}

	if err := h.db.Create(&plan).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar plano"})
	}

	return c.Status(fiber.StatusCreated).JSON(plan)
}

// UpdatePlan godoc
// PUT /admin/plans/:id
func (h *AdminHandler) UpdatePlan(c *fiber.Ctx) error {
	planID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	var plan models.Plan
	if err := h.db.First(&plan, "id = ?", planID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}

	var req struct {
		Name              string   `json:"name"`
		Price             *float64 `json:"price"`
		MaxInstances      *int     `json:"max_instances"`
		MaxMessagesPerDay *int     `json:"max_messages_per_day"`
		MaxUsers          *int     `json:"max_users"`
		MaxWorkspaces     *int     `json:"max_workspaces"`
		Features          string   `json:"features"`
		AllowProxy        *bool    `json:"allow_proxy"`
		IsActive          *bool    `json:"is_active"`
		StripePriceID     string   `json:"stripe_price_id"`
		AsaasProductID    string   `json:"asaas_product_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Price != nil {
		updates["price"] = *req.Price
	}
	if req.MaxInstances != nil {
		updates["max_instances"] = *req.MaxInstances
	}
	if req.MaxMessagesPerDay != nil {
		updates["max_messages_per_day"] = *req.MaxMessagesPerDay
	}
	if req.MaxUsers != nil {
		updates["max_users"] = *req.MaxUsers
	}
	if req.MaxWorkspaces != nil {
		updates["max_workspaces"] = *req.MaxWorkspaces
	}
	if req.Features != "" {
		updates["features"] = req.Features
	}
	if req.AllowProxy != nil {
		updates["allow_proxy"] = *req.AllowProxy
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.StripePriceID != "" {
		updates["stripe_price_id"] = req.StripePriceID
	}
	if req.AsaasProductID != "" {
		updates["asaas_product_id"] = req.AsaasProductID
	}

	if err := h.db.Model(&plan).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar plano"})
	}

	h.db.First(&plan, "id = ?", plan.ID)
	return c.JSON(plan)
}

// GetGlobalProxyConfig godoc
// GET /admin/proxy-config
func (h *AdminHandler) GetGlobalProxyConfig(c *fiber.Ctx) error {
	var cfgs []models.GlobalProxyConfig
	if err := h.db.Order("created_at DESC").Find(&cfgs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar configurações de proxy"})
	}

	if len(cfgs) == 0 {
		cfg := models.GlobalProxyConfig{ID: "default", Enabled: false, Provider: "manual", ProxyType: "http", UseEnv: true, IsActive: true, Country: "br", Name: "Default"}
		if createErr := h.db.Create(&cfg).Error; createErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar configuração de proxy global"})
		}
		cfgs = append(cfgs, cfg)
	}

	result := make([]fiber.Map, len(cfgs))
	for i, cfg := range cfgs {
		username := cfg.Username
		host := cfg.Host
		port := cfg.Port
		proxyType := cfg.ProxyType
		if cfg.UseEnv {
			host = os.Getenv("BRIGHTDATA_HOST")
			if host == "" {
				host = cfg.Host
			}
			proxyType = "http"
			if username == "" {
				username = os.Getenv("BRIGHTDATA_USER")
			}
			if port == 0 {
				port = 33335
			}
		}

		result[i] = fiber.Map{
			"id":           cfg.ID,
			"name":         cfg.Name,
			"enabled":      cfg.Enabled,
			"is_default":   cfg.IsDefault,
			"provider":     cfg.Provider,
			"proxy_type":   proxyType,
			"host":         host,
			"port":         port,
			"username":     username,
			"use_env":      cfg.UseEnv,
			"is_active":    cfg.IsActive,
			"has_password": cfg.Password != "" || os.Getenv("BRIGHTDATA_PASS") != "",
			"country":      cfg.Country,
		}
	}

	return c.JSON(result)
}

// UpdateGlobalProxyConfig godoc
// PUT /admin/proxy-config
// Can create new proxy (if id is missing) or update existing
func (h *AdminHandler) UpdateGlobalProxyConfig(c *fiber.Ctx) error {
	var req struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Enabled   *bool  `json:"enabled"`
		IsDefault *bool  `json:"is_default"`
		Provider  string `json:"provider"`
		ProxyType string `json:"proxy_type"`
		Host      string `json:"host"`
		Port      int    `json:"port"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		UseEnv    *bool  `json:"use_env"`
		IsActive  *bool  `json:"is_active"`
		Country   string `json:"country"`
	}
	if err := c.BodyParser(&req); err != nil {
		log.Error().Err(err).Msg("proxy-config: failed to parse body")
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	log.Info().Str("id", req.ID).Str("name", req.Name).Msg("proxy-config update request")

	// Create new proxy if no id provided
	if req.ID == "" {
		req.ID = uuid.New().String()

		// If setting as default, clear other defaults first
		if req.IsDefault != nil && *req.IsDefault {
			h.db.Model(&models.GlobalProxyConfig{}).Where("is_default = ?", true).Update("is_default", false)
		}

		cfg := models.GlobalProxyConfig{
			ID:        req.ID,
			Name:      req.Name,
			Enabled:   req.Enabled != nil && *req.Enabled,
			IsDefault: req.IsDefault != nil && *req.IsDefault,
			Provider:  req.Provider,
			ProxyType: req.ProxyType,
			Host:      req.Host,
			Port:      req.Port,
			Username:  req.Username,
			UseEnv:    req.UseEnv != nil && *req.UseEnv,
			IsActive:  req.IsActive != nil && *req.IsActive,
			Country:   req.Country,
		}
		if req.Password != "" {
			encrypted, err := whatsapp.EncryptProxyPassword(req.Password)
			if err != nil {
				log.Error().Err(err).Msg("proxy-config: failed to encrypt password")
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criptografar senha"})
			}
			cfg.Password = encrypted
		}
		if cfg.Name == "" {
			cfg.Name = "Proxy " + cfg.Country
		}
		if cfg.Country == "" {
			cfg.Country = "br"
		}
		log.Info().Msg("proxy-config: creating new config")
		log.Info().Any("config", cfg).Msg("proxy-config: config struct")
		if err := h.db.Create(&cfg).Error; err != nil {
			log.Error().Err(err).Msg("proxy-config: failed to create config")
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar configuração"})
		}
		return h.GetGlobalProxyConfig(c)
	}

	// Update existing
	var cfg models.GlobalProxyConfig
	if err := h.db.Where("id = ?", req.ID).First(&cfg).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.Provider != "" {
		updates["provider"] = req.Provider
	}
	if req.ProxyType != "" {
		updates["proxy_type"] = req.ProxyType
	}
	if req.Host != "" {
		updates["host"] = req.Host
	}
	if req.Port > 0 {
		updates["port"] = req.Port
	}
	if req.Username != "" {
		updates["username"] = req.Username
	}
	if req.Password != "" {
		encrypted, err := whatsapp.EncryptProxyPassword(req.Password)
		if err != nil {
			log.Error().Err(err).Msg("proxy-config: failed to encrypt password on update")
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criptografar senha"})
		}
		updates["password"] = encrypted
	}
	if req.UseEnv != nil {
		updates["use_env"] = *req.UseEnv
	}
	if req.IsDefault != nil {
		if *req.IsDefault {
			h.db.Model(&models.GlobalProxyConfig{}).Where("is_default = ? AND id != ?", true, cfg.ID).Update("is_default", false)
		}
		updates["is_default"] = *req.IsDefault
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.Country != "" {
		updates["country"] = req.Country
	}

	if len(updates) > 0 {
		if err := h.db.Model(&cfg).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar configuração"})
		}
	}

	return h.GetGlobalProxyConfig(c)
}

// DELETE /admin/proxy-config/:id
func (h *AdminHandler) DeleteGlobalProxyConfig(c *fiber.Ctx) error {
	id := c.Params("id")

	// First check if proxy exists
	var proxy models.GlobalProxyConfig
	if err := h.db.Where("id = ?", id).First(&proxy).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}

	// Check if proxy is being used by any instance
	var count int64
	h.db.Model(&models.Instance{}).Where("use_global_proxy = ? AND proxy_enabled = ?", true, true).Count(&count)

	// If proxy is "default" and enabled and being used, block deletion
	if id == "default" && proxy.Enabled && count > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "não é possível remover - proxy está em uso por instâncias"})
	}

	if err := h.db.Where("id = ?", id).Delete(&models.GlobalProxyConfig{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao remover proxy"})
	}

	return c.JSON(fiber.Map{"success": true})
}

// GetGlobalProxyStats godoc
// GET /admin/proxy-stats
func (h *AdminHandler) GetGlobalProxyStats(c *fiber.Ctx) error {
	stats := models.ProxyUsageStats{}
	h.db.Model(&models.User{}).Count(&stats.TotalUsers)
	h.db.Model(&models.Instance{}).Count(&stats.TotalInstances)
	h.db.Model(&models.Instance{}).Where("use_global_proxy = ?", true).Count(&stats.GlobalProxyInstances)
	h.db.Model(&models.User{}).Joins("JOIN plans ON plans.id = users.plan_id").Where("plans.allow_proxy = ?", true).Count(&stats.EligibleUsersByPlan)
	h.db.Model(&models.Instance{}).Where("use_global_proxy = ? AND proxy_status = ?", true, models.ProxyStatusOK).Count(&stats.ConnectedProxySamples)

	var rows []models.ProxyUserUsage
	h.db.Raw(`
		SELECT u.id as user_id, u.name, u.email, COALESCE(p.name, 'Sem plano') as plan_name,
			COUNT(i.id) as instances,
			SUM(CASE WHEN i.status = 'connected' THEN 1 ELSE 0 END) as connected,
			MAX(i.updated_at) as last_updated_at
		FROM users u
		LEFT JOIN plans p ON p.id = u.plan_id
		LEFT JOIN instances i ON i.user_id = u.id AND i.use_global_proxy = true
		GROUP BY u.id, u.name, u.email, p.name
		HAVING COUNT(i.id) > 0
		ORDER BY COUNT(i.id) DESC
	`).Scan(&rows)

	return c.JSON(fiber.Map{
		"summary": stats,
		"users":   rows,
	})
}

// Stats godoc
// GET /admin/stats
func (h *AdminHandler) Stats(c *fiber.Ctx) error {
	var totalUsers, activeUsers, totalInstances, connectedInstances, totalMessages int64

	h.db.Model(&models.User{}).Count(&totalUsers)
	h.db.Model(&models.User{}).Where("is_active = true").Count(&activeUsers)
	h.db.Model(&models.Instance{}).Count(&totalInstances)
	h.db.Model(&models.Instance{}).Where("status = 'connected'").Count(&connectedInstances)
	h.db.Model(&models.MessageLog{}).Count(&totalMessages)

	var todayMessages int64
	h.db.Model(&models.MessageLog{}).
		Where("created_at >= NOW() - INTERVAL '24 hours'").
		Count(&todayMessages)

	return c.JSON(fiber.Map{
		"users": fiber.Map{
			"total":  totalUsers,
			"active": activeUsers,
		},
		"instances": fiber.Map{
			"total":     totalInstances,
			"connected": connectedInstances,
		},
		"messages": fiber.Map{
			"total": totalMessages,
			"today": todayMessages,
		},
	})
}

// --- Email Settings ---

// GetEmailSettings godoc
// GET /admin/email-settings
func (h *AdminHandler) GetEmailSettings(c *fiber.Ctx) error {
	var settings models.EmailSettings

	// Try to get existing settings, or return defaults
	result := h.db.First(&settings)
	if result.Error == gorm.ErrRecordNotFound {
		// Return default settings
		return c.JSON(fiber.Map{
			"api_key":      "",
			"sender_email": "mail@uniq.chat",
			"sender_name":  "Uniq.chat",
			"is_enabled":   true,
		})
	}
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar configurações"})
	}

	// Don't return the actual API key for security
	return c.JSON(fiber.Map{
		"api_key":      "",
		"sender_email": settings.SenderEmail,
		"sender_name":  settings.SenderName,
		"is_enabled":   settings.IsEnabled,
		"has_api_key":  settings.APIKey != "",
	})
}

// UpdateEmailSettings godoc
// PUT /admin/email-settings
func (h *AdminHandler) UpdateEmailSettings(c *fiber.Ctx) error {
	var req struct {
		APIKey      string `json:"api_key"`
		SenderEmail string `json:"sender_email"`
		SenderName  string `json:"sender_name"`
		IsEnabled   bool   `json:"is_enabled"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.SenderEmail == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sender_email é obrigatório"})
	}

	var settings models.EmailSettings
	result := h.db.First(&settings)

	if result.Error == gorm.ErrRecordNotFound {
		// Create new settings
		settings = models.EmailSettings{
			APIKey:      req.APIKey,
			SenderEmail: req.SenderEmail,
			SenderName:  req.SenderName,
			IsEnabled:   req.IsEnabled,
		}
		h.db.Create(&settings)
	} else if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar configurações"})
	} else {
		// Update existing - only update APIKey if provided
		if req.APIKey != "" {
			settings.APIKey = req.APIKey
		}
		settings.SenderEmail = req.SenderEmail
		settings.SenderName = req.SenderName
		settings.IsEnabled = req.IsEnabled
		h.db.Save(&settings)
	}

	// Update the email service config
	if h.emailSvc != nil {
		apiKey := settings.APIKey
		if apiKey == "" {
			apiKey = req.APIKey // Use new API key if just set
		}
		h.emailSvc.SetConfig(apiKey, settings.SenderEmail, settings.SenderName)
	}

	return c.JSON(fiber.Map{"message": "configurações atualizadas"})
}

// TestEmail godoc
// POST /admin/email-settings/test
func (h *AdminHandler) TestEmail(c *fiber.Ctx) error {
	var req struct {
		To string `json:"to"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.To == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "e-mail de destino é obrigatório"})
	}

	// Get current settings
	var settings models.EmailSettings
	if err := h.db.First(&settings).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "configure o e-mail primeiro"})
	}

	if !settings.IsEnabled {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "e-mail está desabilitado"})
	}

	// Send test email
	htmlContent := email.TestHTML("Uniq.chat")
	err := h.emailSvc.SyncSend(req.To, "Teste do Uniq.chat", htmlContent, "test")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao enviar: " + err.Error()})
	}

	return c.JSON(fiber.Map{"message": "e-mail de teste enviado com sucesso"})
}

// ListEmailTemplates godoc
// GET /admin/email-templates
func (h *AdminHandler) ListEmailTemplates(c *fiber.Ctx) error {
	var templates []models.EmailTemplate
	h.db.Order("slug ASC").Find(&templates)

	// If no templates exist, return defaults
	if len(templates) == 0 {
		templates = getDefaultTemplates()
	}

	return c.JSON(fiber.Map{"data": templates})
}

// GetEmailTemplate godoc
// GET /admin/email-templates/:slug
func (h *AdminHandler) GetEmailTemplate(c *fiber.Ctx) error {
	slug := c.Params("slug")

	var template models.EmailTemplate
	result := h.db.Where("slug = ?", slug).First(&template)
	if result.Error == gorm.ErrRecordNotFound {
		// Return default template
		defaults := getDefaultTemplates()
		for _, t := range defaults {
			if t.Slug == slug {
				return c.JSON(t)
			}
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "template não encontrado"})
	}
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar template"})
	}

	return c.JSON(template)
}

// UpdateEmailTemplate godoc
// PUT /admin/email-templates/:slug
func (h *AdminHandler) UpdateEmailTemplate(c *fiber.Ctx) error {
	slug := c.Params("slug")

	var req struct {
		Subject     string `json:"subject"`
		HTMLContent string `json:"html_content"`
		IsActive    bool   `json:"is_active"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	var template models.EmailTemplate
	result := h.db.Where("slug = ?", slug).First(&template)

	if result.Error == gorm.ErrRecordNotFound {
		// Create new template
		template = models.EmailTemplate{
			Slug:        slug,
			Name:        getTemplateName(slug),
			Subject:     req.Subject,
			HTMLContent: req.HTMLContent,
			IsActive:    req.IsActive,
		}
		h.db.Create(&template)
	} else if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar template"})
	} else {
		template.Subject = req.Subject
		template.HTMLContent = req.HTMLContent
		template.IsActive = req.IsActive
		h.db.Save(&template)
	}

	return c.JSON(fiber.Map{"message": "template atualizado"})
}

// TestEmailTemplate godoc
// POST /admin/email-templates/:slug/test
func (h *AdminHandler) TestEmailTemplate(c *fiber.Ctx) error {
	slug := c.Params("slug")
	var req struct {
		To string `json:"to"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.To == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "e-mail de destino é obrigatório"})
	}

	var settings models.EmailSettings
	if err := h.db.First(&settings).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "configure o e-mail primeiro"})
	}
	if !settings.IsEnabled {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "e-mail está desabilitado"})
	}

	var subject, html string

	// Prefer custom template from DB
	var custom models.EmailTemplate
	if err := h.db.Where("slug = ?", slug).First(&custom).Error; err == nil {
		subject = strings.TrimSpace(custom.Subject)
		html = strings.TrimSpace(custom.HTMLContent)
	}

	if subject == "" || html == "" {
		// fallback to default template
		defaults := getDefaultTemplates()
		found := false
		for _, t := range defaults {
			if t.Slug == slug {
				subject = t.Subject
				html = t.HTMLContent
				found = true
				break
			}
		}
		if !found {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "template não encontrado"})
		}
	}

	// placeholder replacements for test payload
	replacer := strings.NewReplacer(
		"{{app_name}}", "Uniq.chat",
		"{{name}}", "Usuário Teste",
		"{{app_url}}", "https://uniq.chat",
		"{{reset_link}}", "https://uniq.chat/reset-password?token=test",
		"{{plan_name}}", "Pro",
		"{{amount}}", "99.90",
		"{{old_plan}}", "Starter",
		"{{new_plan}}", "Pro",
		"{{billing_url}}", "https://uniq.chat/billing",
		"{{plans_url}}", "https://uniq.chat/plans",
		"{{instance_name}}", "Vendas",
		"{{phone}}", "+55 11 99999-0000",
		"{{email}}", req.To,
		"{{temp_password}}", "Temp#1234",
		"{{new_password}}", "New#1234",
	)
	subject = replacer.Replace(subject)
	html = replacer.Replace(html)

	if err := h.emailSvc.SyncSend(req.To, subject, html, "test_"+slug); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao enviar: " + err.Error()})
	}

	return c.JSON(fiber.Map{"message": "e-mail de teste do template enviado com sucesso"})
}

// GetEmailLogs godoc
// GET /admin/email-logs
func (h *AdminHandler) GetEmailLogs(c *fiber.Ctx) error {
	var logs []models.EmailLog
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	h.db.Order("created_at DESC").Limit(limit).Offset(offset).Find(&logs)

	var total int64
	h.db.Model(&models.EmailLog{}).Count(&total)

	return c.JSON(fiber.Map{
		"data":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// Helper functions
func getTemplateName(slug string) string {
	names := map[string]string{
		"welcome":               "Bem-vindo",
		"password_reset":        "Redefinição de Senha",
		"password_changed":      "Senha Alterada",
		"payment_confirmed":     "Pagamento Confirmado",
		"payment_failed":        "Pagamento Falhou",
		"plan_changed":          "Plano Atualizado",
		"subscription_canceled": "Assinatura Cancelada",
		"instance_banned":       "Instância Banida",
		"admin_created_account": "Conta Criada por Admin",
		"admin_reset_password":  "Senha Resetada por Admin",
	}
	if name, ok := names[slug]; ok {
		return name
	}
	return slug
}

func getDefaultTemplates() []models.EmailTemplate {
	base := func(title, body string) string {
		return `<div style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Arial,sans-serif;">` +
			`<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">` +
			`<tr><td align="center">` +
			`<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">` +
			`<tr><td style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:26px 28px;text-align:center;">` +
			`<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{app_name}}</h1>` +
			`</td></tr>` +
			`<tr><td style="padding:28px;">` +
			`<h2 style="margin:0 0 12px;color:#1e293b;font-size:24px;">` + title + `</h2>` +
			`<p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">Olá, <strong>{{name}}</strong>!</p>` +
			body +
			`</td></tr>` +
			`<tr><td style="background:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;text-align:center;">` +
			`<p style="margin:0;color:#64748b;font-size:12px;">© 2026 {{app_name}} • Todos os direitos reservados</p>` +
			`<p style="margin:6px 0 0;"><a href="{{app_url}}/unsubscribe" style="color:#6366f1;font-size:12px;">Cancelar inscrição</a></p>` +
			`</td></tr>` +
			`</table></td></tr></table></div>`
	}

	return []models.EmailTemplate{
		{Slug: "welcome", Name: "Bem-vindo", Subject: "Bem-vindo ao {{app_name}}!", HTMLContent: base("Bem-vindo ao {{app_name}}", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Sua conta foi criada com sucesso. Estamos felizes em ter você conosco.</p>`), IsActive: true},
		{Slug: "password_reset", Name: "Redefinição de Senha", Subject: "Redefinir sua senha", HTMLContent: base("Redefinir senha", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Recebemos uma solicitação de redefinição. Use este link: <a href="{{reset_link}}" style="color:#6366f1;">{{reset_link}}</a></p>`), IsActive: true},
		{Slug: "password_changed", Name: "Senha Alterada", Subject: "Sua senha foi alterada", HTMLContent: base("Senha alterada", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Sua senha foi alterada com sucesso. Se não foi você, contate o suporte imediatamente.</p>`), IsActive: true},
		{Slug: "payment_confirmed", Name: "Pagamento Confirmado", Subject: "Pagamento confirmado!", HTMLContent: base("Pagamento confirmado", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Seu pagamento foi processado com sucesso para o plano <strong>{{plan_name}}</strong> no valor de <strong>R$ {{amount}}</strong>.</p>`), IsActive: true},
		{Slug: "payment_failed", Name: "Pagamento Falhou", Subject: "Falha no pagamento", HTMLContent: base("Falha no pagamento", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Não foi possível processar seu pagamento. Atualize seus dados em <a href="{{billing_url}}" style="color:#6366f1;">{{billing_url}}</a>.</p>`), IsActive: true},
		{Slug: "plan_changed", Name: "Plano Atualizado", Subject: "Seu plano foi atualizado", HTMLContent: base("Plano atualizado", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Seu plano foi alterado de <strong>{{old_plan}}</strong> para <strong>{{new_plan}}</strong>.</p>`), IsActive: true},
		{Slug: "subscription_canceled", Name: "Assinatura Cancelada", Subject: "Assinatura cancelada", HTMLContent: base("Assinatura cancelada", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Sua assinatura foi cancelada. Você pode reativar quando quiser em <a href="{{plans_url}}" style="color:#6366f1;">{{plans_url}}</a>.</p>`), IsActive: true},
		{Slug: "instance_banned", Name: "Instância Banida", Subject: "Instância banida", HTMLContent: base("Instância banida", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">A instância <strong>{{instance_name}}</strong> ({{phone}}) foi banida. Entre em contato com o suporte.</p>`), IsActive: true},
		{Slug: "admin_created_account", Name: "Conta Criada por Admin", Subject: "Sua conta foi criada", HTMLContent: base("Conta criada", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Sua conta foi criada. E-mail: <strong>{{email}}</strong> • Senha temporária: <strong>{{temp_password}}</strong>.</p>`), IsActive: true},
		{Slug: "admin_reset_password", Name: "Senha Resetada por Admin", Subject: "Sua senha foi redefinida", HTMLContent: base("Senha redefinida", `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Sua nova senha temporária é: <strong>{{new_password}}</strong>.</p>`), IsActive: true},
	}
}
