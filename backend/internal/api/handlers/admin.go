package handlers

import (
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

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
		if err := h.db.Create(&cfg).Error; err != nil {
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
