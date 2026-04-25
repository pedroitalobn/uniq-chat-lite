package handlers

import (
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
	manager  *whatsapp.Manager
}

func NewAdminHandler(db *gorm.DB, emailSvc *email.Service) *AdminHandler {
	return &AdminHandler{db: db, emailSvc: emailSvc}
}

// SetManager injeta o whatsapp.Manager usado para reiniciar instâncias após
// mudanças de proxy global. Chamado no bootstrap (opcional — sem manager, o
// handler apenas não reinicia automaticamente).
func (h *AdminHandler) SetManager(m *whatsapp.Manager) { h.manager = m }

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

// ListAllServers godoc
// GET /admin/inspect/servers - List all servers for super admin support
func (h *AdminHandler) ListAllServers(c *fiber.Ctx) error {
	var servers []models.Server
	if err := h.db.Preload("User").Order("created_at DESC").Find(&servers).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar servidores"})
	}
	return c.JSON(servers)
}

// ListAllInstances godoc
// GET /admin/inspect/instances - List all instances for super admin support
func (h *AdminHandler) ListAllInstances(c *fiber.Ctx) error {
	var instances []models.Instance
	if err := h.db.Preload("User").Preload("Workspace").Order("created_at DESC").Find(&instances).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar instâncias"})
	}
	return c.JSON(instances)
}

// GetInstance godoc
// GET /admin/inspect/instances/:id - Get instance details for support
func (h *AdminHandler) GetInstance(c *fiber.Ctx) error {
	instID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	var instance models.Instance
	if err := h.db.Preload("User").Preload("Workspace").First(&instance, "id = ?", instID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	return c.JSON(instance)
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

// ─── Platform Proxies (admin) ────────────────────────────────────────────
// Proxies da plataforma (is_platform=true) — gerenciados pelo admin e
// disponíveis pra todos os users selecionarem no server deles.

// GetGlobalProxyConfig godoc
// GET /admin/proxy-config  — lista proxies da plataforma
//
// Inclui também proxies "órfãos" (owner_id IS NULL) sem o flag is_platform —
// são relíquias do refactor de proxies (commit 583de31) que nunca foram
// migradas. O backfillOrphanPlatformProxies no boot promove esses, mas
// o OR garante que aparecem mesmo se o backfill falhou (cenários de read-
// only DB, race no boot, etc.). Servers que apontam pra esses proxies
// continuam funcionando — o painel só não os listava.
func (h *AdminHandler) GetGlobalProxyConfig(c *fiber.Ctx) error {
	var proxies []models.Proxy
	if err := h.db.
		Where("is_platform = ? OR owner_id IS NULL", true).
		Order("created_at DESC").
		Find(&proxies).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar proxies"})
	}

	result := make([]fiber.Map, len(proxies))
	for i, p := range proxies {
		host := p.Host
		port := p.Port
		user := p.Username
		pType := p.ProxyType
		if p.UseEnv {
			if envHost := os.Getenv("BRIGHTDATA_HOST"); envHost != "" {
				host = envHost
			}
			if envUser := os.Getenv("BRIGHTDATA_USER"); envUser != "" {
				user = envUser
			}
			if pType == "" {
				pType = "http"
			}
			if port == 0 {
				port = 33335
			}
		}
		result[i] = fiber.Map{
			"id":           p.ID,
			"name":         p.Name,
			"provider":     p.Provider,
			"proxy_type":   pType,
			"host":         host,
			"port":         port,
			"username":     user,
			"use_env":      p.UseEnv,
			"is_active":    p.IsActive,
			"is_platform":  p.IsPlatform,
			"has_password": p.Password != "" || os.Getenv("BRIGHTDATA_PASS") != "",
			"country":      p.Country,
			"created_at":   p.CreatedAt,
		}
	}
	return c.JSON(result)
}

// TestGlobalProxy godoc
// POST /admin/proxy-test — testa um proxy de plataforma
func (h *AdminHandler) TestGlobalProxy(c *fiber.Ctx) error {
	// Aceita tanto { id } (testa um proxy já salvo) quanto credenciais
	// inline { host, port, username, password, proxy_type } — útil pra
	// "testar antes de salvar" sem ter que criar um proxy temporário no DB.
	var req struct {
		ID        string `json:"id"`
		Host      string `json:"host"`
		Port      int    `json:"port"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		ProxyType string `json:"proxy_type"`
	}
	_ = c.BodyParser(&req)

	var cfg *whatsapp.ProxyConfig
	source := "inline"

	if req.Host != "" && req.Port > 0 {
		pType := req.ProxyType
		if pType == "" {
			pType = "http"
		}
		cfg = &whatsapp.ProxyConfig{
			Enabled:  true,
			Type:     pType,
			Host:     req.Host,
			Port:     req.Port,
			Username: req.Username,
			Password: req.Password, // plaintext — nunca persistido nesse caminho
		}
	} else {
		var p models.Proxy
		q := h.db.Model(&models.Proxy{}).Where("is_platform = ?", true)
		if req.ID != "" {
			q = q.Where("id = ?", req.ID)
		} else {
			q = q.Where("is_active = ?", true).Order("created_at DESC")
		}
		if err := q.First(&p).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
		}
		var ok bool
		cfg, source, ok = whatsapp.BuildProxyConfigExported(&p)
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"success": false,
				"error":   "host ou porta vazios após resolução",
				"source":  source,
			})
		}
	}

	externalIP, latencyMs, err := whatsapp.TestProxy(cfg)
	if err != nil {
		return c.JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
			"source":  source,
		})
	}
	// Resolve país server-side pelo IP externo pra evitar lookup cross-origin
	// no browser. Falha silenciosa — o test continua "success" mesmo sem país.
	country, _ := whatsapp.DetectCountryByIP(externalIP)
	return c.JSON(fiber.Map{
		"success":     true,
		"external_ip": externalIP,
		"latency_ms":  latencyMs,
		"country":     country,
		"source":      source,
		"tested_at":   time.Now(),
	})
}

// UpdateGlobalProxyConfig godoc
// PUT /admin/proxy-config — cria ou atualiza um proxy de plataforma
func (h *AdminHandler) UpdateGlobalProxyConfig(c *fiber.Ctx) error {
	var req struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
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

	if req.ID == "" {
		// Create new platform proxy
		p := models.Proxy{
			IsPlatform: true,
			Name:       req.Name,
			Provider:   req.Provider,
			ProxyType:  req.ProxyType,
			Host:       req.Host,
			Port:       req.Port,
			Username:   req.Username,
			UseEnv:     req.UseEnv != nil && *req.UseEnv,
			IsActive:   req.IsActive == nil || *req.IsActive,
			Country:    req.Country,
		}
		if p.Name == "" {
			p.Name = "Proxy " + p.Country
		}
		if p.Country == "" {
			p.Country = "br"
		}
		if p.ProxyType == "" {
			p.ProxyType = "http"
		}
		if p.Provider == "" {
			p.Provider = "manual"
		}
		if req.Password != "" {
			enc, err := whatsapp.EncryptProxyPassword(req.Password)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criptografar senha"})
			}
			p.Password = enc
		}
		if err := h.db.Create(&p).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar proxy"})
		}
		return h.GetGlobalProxyConfig(c)
	}

	// Update existing
	pid, err := uuid.Parse(req.ID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.Proxy
	if err := h.db.Where("id = ? AND is_platform = ?", pid, true).First(&p).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}
	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
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
		enc, err := whatsapp.EncryptProxyPassword(req.Password)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criptografar senha"})
		}
		updates["password"] = enc
	}
	if req.UseEnv != nil {
		updates["use_env"] = *req.UseEnv
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.Country != "" {
		updates["country"] = req.Country
	}
	if len(updates) > 0 {
		if err := h.db.Model(&p).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar"})
		}
	}
	go h.restartInstancesUsingProxy(p.ID)
	return h.GetGlobalProxyConfig(c)
}

// restartInstancesUsingProxy reinicia instâncias cujo server aponta pro proxy
// atualizado, pra aplicar as novas credenciais no whatsmeow.
func (h *AdminHandler) restartInstancesUsingProxy(proxyID uuid.UUID) {
	if h.manager == nil {
		return
	}
	var serverIDs []uuid.UUID
	h.db.Model(&models.Server{}).Where("proxy_id = ?", proxyID).Pluck("id", &serverIDs)
	if len(serverIDs) == 0 {
		return
	}
	var instances []models.Instance
	if err := h.db.Where("server_id IN ?", serverIDs).Find(&instances).Error; err != nil {
		return
	}
	for i := range instances {
		inst := &instances[i]
		if !h.manager.IsRunning(inst.ID.String()) {
			continue
		}
		_ = h.manager.RestartWithProxy(inst)
	}
}

// DELETE /admin/proxy-config/:id
func (h *AdminHandler) DeleteGlobalProxyConfig(c *fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	// Detach servers still pointing to this proxy
	h.db.Model(&models.Server{}).Where("proxy_id = ?", id).Update("proxy_id", nil)
	if err := h.db.Where("id = ? AND is_platform = ?", id, true).Delete(&models.Proxy{}).Error; err != nil {
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
	// Instâncias cujo server tem proxy (plataforma ou custom)
	h.db.Raw(`
		SELECT COUNT(*) FROM instances i
		JOIN servers s ON s.id = i.server_id
		WHERE s.proxy_id IS NOT NULL
	`).Scan(&stats.GlobalProxyInstances)
	h.db.Model(&models.User{}).Joins("JOIN plans ON plans.id = users.plan_id").Where("plans.allow_proxy = ?", true).Count(&stats.EligibleUsersByPlan)
	// Connected samples: instâncias conectadas usando proxy
	h.db.Raw(`
		SELECT COUNT(*) FROM instances i
		JOIN servers s ON s.id = i.server_id
		WHERE s.proxy_id IS NOT NULL AND i.status = 'connected'
	`).Scan(&stats.ConnectedProxySamples)

	var rows []models.ProxyUserUsage
	h.db.Raw(`
		SELECT u.id as user_id, u.name, u.email, COALESCE(p.name, 'Sem plano') as plan_name,
			COUNT(i.id) as instances,
			SUM(CASE WHEN i.status = 'connected' THEN 1 ELSE 0 END) as connected,
			MAX(i.updated_at) as last_updated_at
		FROM users u
		LEFT JOIN plans p ON p.id = u.plan_id
		LEFT JOIN instances i ON i.user_id = u.id
		LEFT JOIN servers sv ON sv.id = i.server_id AND sv.proxy_id IS NOT NULL
		WHERE sv.id IS NOT NULL
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
