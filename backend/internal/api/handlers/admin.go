package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
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
