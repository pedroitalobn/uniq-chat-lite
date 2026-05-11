package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	stripe "github.com/stripe/stripe-go/v76"
	stripeprice "github.com/stripe/stripe-go/v76/price"
	"github.com/uniq-chat/backend/internal/api/middleware"
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

	// Configured = key salva no DB. NÃO significa "credencial válida" —
	// pra isso vem o test_status setado pelo PUT/Test endpoint que
	// realmente bate no provider. UI deve preferir test_status quando
	// existir; "configured" é apenas o estado mais fraco "tem algo no
	// DB".
	stripeConfigured := settings.StripeSecretKey != ""
	asaasConfigured := settings.AsaasAPIKey != ""
	abacatepayConfigured := settings.AbacatepayAPIKey != ""

	// Active provider is exactly what was saved in the panel
	activeProvider := string(settings.ActiveProvider)
	if activeProvider == "" {
		activeProvider = "stripe"
	}

	// Build webhook URLs — webhook é endpoint do BACKEND (api.uniq.chat),
	// não do frontend. APIURL é configurado via env API_URL/BACKEND_URL;
	// se não estiver setado cai pra AppURL como fallback (dev local).
	apiURL := strings.TrimRight(config.AppConfig.APIURL, "/")
	if apiURL == "" {
		apiURL = strings.TrimRight(config.AppConfig.AppURL, "/")
	}
	stripeWebhookURL := apiURL + "/stripe/webhook"
	asaasWebhookURL := apiURL + "/asaas/webhook"
	abacatepayWebhookURL := apiURL + "/abacatepay/webhook"
	if settings.AbacatepayWebhookSecret != "" {
		abacatepayWebhookURL = abacatepayWebhookURL + "?webhookSecret=" + settings.AbacatepayWebhookSecret
	}

	return c.JSON(fiber.Map{
		"id":                   settings.ID,
		"active_provider":      activeProvider,
		"stripe_checkout_type": settings.StripeCheckoutType,
		"asaas_environment":    settings.AsaasEnvironment,
		"asaas_checkout_type":  settings.AsaasCheckoutType,
		"abacatepay_environment":  settings.AbacatepayEnvironment,
		"abacatepay_checkout_type": settings.AbacatepayCheckoutType,
		// Previews mascarados — UI mostra os primeiros/últimos 4
		// chars pra admin saber qual chave/ambiente está salvo
		// (ex.: sk_live_*** vs sk_test_***) sem expor o segredo.
		// Não retornamos a key crua na resposta.
		"stripe_secret_key_preview":      maskCredential(settings.StripeSecretKey),
		"stripe_secret_key_env":          detectStripeEnv(settings.StripeSecretKey),
		"stripe_webhook_secret_preview":  maskCredential(settings.StripeWebhookSecret),
		"asaas_api_key_preview":          maskCredential(settings.AsaasAPIKey),
		"asaas_webhook_secret_preview":   maskCredential(settings.AsaasWebhookSecret),
		"abacatepay_api_key_preview":     maskCredential(settings.AbacatepayAPIKey),
		"abacatepay_webhook_secret_preview": maskCredential(settings.AbacatepayWebhookSecret),
		// Status de configuração: existe credencial salva (estado fraco).
		"stripe_configured":    stripeConfigured,
		"asaas_configured":     asaasConfigured,
		"abacatepay_configured": abacatepayConfigured,
		// Status real de conectividade — populado por Test/auto-test.
		// UI deve mostrar isso como "Conectado/Falhou/Não testado" e
		// só dizer "Pronto pra cobrar" quando test_status == "ok".
		"stripe_test_status":     settings.StripeTestStatus,
		"stripe_tested_at":       settings.StripeTestedAt,
		"stripe_test_error":      settings.StripeTestError,
		"asaas_test_status":      settings.AsaasTestStatus,
		"asaas_tested_at":        settings.AsaasTestedAt,
		"asaas_test_error":       settings.AsaasTestError,
		"abacatepay_test_status": settings.AbacatepayTestStatus,
		"abacatepay_tested_at":   settings.AbacatepayTestedAt,
		"abacatepay_test_error":  settings.AbacatepayTestError,
		// Webhook URLs
		"stripe_webhook_url":     stripeWebhookURL,
		"asaas_webhook_url":      asaasWebhookURL,
		"abacatepay_webhook_url": abacatepayWebhookURL,
	})
}

// testPaymentProvider faz uma chamada read-only no provider pra confirmar
// que a credencial é aceita. Stripe: GET /v1/balance (precisa da secret).
// Asaas: GET /api/v3/customers?limit=1 (lista trivial). Retorna ok=true
// se a chamada bateu auth corretamente, false + razão se falhou.
// Best-effort: usa client.Timeout=10s pra não travar o save quando o
// provider está fora do ar.
func (h *AdminHandler) testPaymentProvider(provider string, settings *models.PaymentSettings) (ok bool, errMsg string) {
	client := &http.Client{Timeout: 10 * time.Second}
	switch provider {
	case "stripe":
		key := strings.TrimSpace(settings.StripeSecretKey)
		if key == "" {
			return false, "secret_key vazia"
		}
		req, _ := http.NewRequest("GET", "https://api.stripe.com/v1/balance", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := client.Do(req)
		if err != nil {
			return false, "erro de rede: " + err.Error()
		}
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			return true, ""
		}
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Sprintf("HTTP %d — %s", resp.StatusCode, truncErr(string(body), 200))
	case "asaas":
		key := strings.TrimSpace(settings.AsaasAPIKey)
		if key == "" {
			return false, "api_key vazia"
		}
		// Antes usávamos https://api.asaas.com com path /api/v3/... que
		// resultava em https://api.asaas.com/api/v3/customers (404).
		// Asaas tem dois hosts canônicos:
		//   prod    → https://www.asaas.com/api/v3/...
		//   sandbox → https://sandbox.asaas.com/api/v3/...
		// (resto do código já usa www.asaas.com em asaas_client.go +
		//  asaas.go handler — alinhamos aqui pra evitar mismatch de
		//  ambiente entre teste de conexão e webhook real.)
		baseURL := "https://www.asaas.com"
		if settings.AsaasEnvironment == "sandbox" {
			baseURL = "https://sandbox.asaas.com"
		}
		req, _ := http.NewRequest("GET", baseURL+"/api/v3/customers?limit=1", nil)
		// Asaas aceita o token em access_token (legacy) E Authorization
		// Bearer (mais novo). Mandamos os dois pra cobrir tokens
		// gerados em qualquer época do painel.
		req.Header.Set("access_token", key)
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "uniq-chat/1.0")
		resp, err := client.Do(req)
		if err != nil {
			return false, "erro de rede: " + err.Error()
		}
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			return true, ""
		}
		body, _ := io.ReadAll(resp.Body)
		hint := ""
		if resp.StatusCode == 401 {
			hint = " (chave inválida — confira se copiou inteira do painel)"
		} else if resp.StatusCode == 403 {
			hint = " (chave válida mas sem permissão — verifique escopo no painel Asaas)"
		} else if resp.StatusCode == 404 {
			hint = " (endpoint não encontrado — provavelmente ambiente errado: prod vs sandbox)"
		}
		return false, fmt.Sprintf("HTTP %d%s — %s", resp.StatusCode, hint, truncErr(string(body), 200))
	case "abacatepay":
		key := strings.TrimSpace(settings.AbacatepayAPIKey)
		if key == "" {
			return false, "api_key vazia"
		}
		// AbacatePay usa URL única — o ambiente (dev/production) é
		// determinado pela API key, não pela URL. O endpoint /v2/checkout?limit=1
		baseURL := "https://api.abacatepay.com"
		req, _ := http.NewRequest("GET", baseURL+"/v2/checkout?limit=1", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return false, "erro de rede: " + err.Error()
		}
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			return true, ""
		}
		body, _ := io.ReadAll(resp.Body)
		hint := ""
		if resp.StatusCode == 401 {
			hint = " (api_key inválida — confira se copiou inteira do painel AbacatePay)"
		} else if resp.StatusCode == 403 {
			hint = " (api_key válida mas sem permissão)"
		}
		return false, fmt.Sprintf("HTTP %d%s — %s", resp.StatusCode, hint, truncErr(string(body), 200))
	}
	return false, "provider não suportado"
}

func truncErr(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// maskCredential devolve um preview seguro da credencial — primeiros 4 e
// últimos 4 caracteres com bullets no meio. Permite ao admin
// confirmar visualmente qual chave está salva (ex.: distinguir
// sk_live_… de sk_test_…) sem expor o segredo completo na UI/network.
func maskCredential(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return strings.Repeat("•", len(s))
	}
	return s[:4] + "••••••••" + s[len(s)-4:]
}

// detectStripeEnv inspeciona o prefixo da secret key. Stripe usa
// sk_live_/rk_live_ para produção e sk_test_/rk_test_ para teste —
// é a forma mais confiável de saber em qual ambiente estamos.
func detectStripeEnv(s string) string {
	s = strings.TrimSpace(s)
	switch {
	case strings.HasPrefix(s, "sk_live_"), strings.HasPrefix(s, "rk_live_"), strings.HasPrefix(s, "pk_live_"):
		return "live"
	case strings.HasPrefix(s, "sk_test_"), strings.HasPrefix(s, "rk_test_"), strings.HasPrefix(s, "pk_test_"):
		return "test"
	}
	return ""
}

// UpdatePaymentSettings godoc
// PUT /admin/payment-settings
func (h *AdminHandler) UpdatePaymentSettings(c *fiber.Ctx) error {
	var req struct {
		ActiveProvider         string `json:"active_provider"`
		StripeSecretKey        string `json:"stripe_secret_key"`
		StripeWebhookSecret    string `json:"stripe_webhook_secret"`
		StripeCheckoutType     string `json:"stripe_checkout_type"`
		AsaasAPIKey            string `json:"asaas_api_key"`
		AsaasEnvironment       string `json:"asaas_environment"`
		AsaasWebhookSecret     string `json:"asaas_webhook_secret"`
		AsaasCheckoutType      string `json:"asaas_checkout_type"`
		AbacatepayAPIKey       string `json:"abacatepay_api_key"`
		AbacatepayWebhookSecret string `json:"abacatepay_webhook_secret"`
		AbacatepayEnvironment   string `json:"abacatepay_environment"`
		AbacatepayCheckoutType  string `json:"abacatepay_checkout_type"`
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
	if req.AbacatepayAPIKey != "" {
		updates["abacatepay_api_key"] = req.AbacatepayAPIKey
	}
	if req.AbacatepayWebhookSecret != "" {
		updates["abacatepay_webhook_secret"] = req.AbacatepayWebhookSecret
	}
	if req.AbacatepayEnvironment != "" {
		updates["abacatepay_environment"] = req.AbacatepayEnvironment
	}
	if req.AbacatepayCheckoutType != "" {
		updates["abacatepay_checkout_type"] = req.AbacatepayCheckoutType
	}

	if len(updates) > 0 {
		if err := h.db.Model(&settings).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar configurações"})
		}
	}

	h.db.First(&settings, "id = ?", "default")

	// Auto-teste das credenciais que MUDARAM nesta request. Roda síncrono
	// porque o admin tá esperando a resposta e quer ver na hora se a
	// credencial foi aceita pelo provider — antes a UI mostrava
	// "configurado ✓" mesmo com chave errada (porque só checava se o
	// secret_key estava preenchido no DB).
	now := time.Now()
	if req.StripeSecretKey != "" {
		ok, errMsg := h.testPaymentProvider("stripe", &settings)
		patch := map[string]any{"stripe_tested_at": now, "stripe_test_error": errMsg}
		if ok {
			patch["stripe_test_status"] = "ok"
		} else {
			patch["stripe_test_status"] = "failed"
		}
		h.db.Model(&settings).Updates(patch)
	}
	if req.AsaasAPIKey != "" {
		ok, errMsg := h.testPaymentProvider("asaas", &settings)
		patch := map[string]any{"asaas_tested_at": now, "asaas_test_error": errMsg}
		if ok {
			patch["asaas_test_status"] = "ok"
		} else {
			patch["asaas_test_status"] = "failed"
		}
		h.db.Model(&settings).Updates(patch)
	}
	if req.AbacatepayAPIKey != "" {
		ok, errMsg := h.testPaymentProvider("abacatepay", &settings)
		patch := map[string]any{"abacatepay_tested_at": now, "abacatepay_test_error": errMsg}
		if ok {
			patch["abacatepay_test_status"] = "ok"
		} else {
			patch["abacatepay_test_status"] = "failed"
		}
		h.db.Model(&settings).Updates(patch)
	}
	h.db.First(&settings, "id = ?", "default")

	return c.JSON(fiber.Map{
		"id":                                  settings.ID,
		"active_provider":                     string(settings.ActiveProvider),
		"stripe_checkout_type":                settings.StripeCheckoutType,
		"stripe_test_status":                  settings.StripeTestStatus,
		"stripe_tested_at":                    settings.StripeTestedAt,
		"stripe_test_error":                   settings.StripeTestError,
		"asaas_environment":                   settings.AsaasEnvironment,
		"asaas_checkout_type":                 settings.AsaasCheckoutType,
		"asaas_test_status":                   settings.AsaasTestStatus,
		"asaas_tested_at":                     settings.AsaasTestedAt,
		"asaas_test_error":                    settings.AsaasTestError,
		"abacatepay_environment":              settings.AbacatepayEnvironment,
		"abacatepay_checkout_type":            settings.AbacatepayCheckoutType,
		"abacatepay_test_status":              settings.AbacatepayTestStatus,
		"abacatepay_tested_at":                settings.AbacatepayTestedAt,
		"abacatepay_test_error":               settings.AbacatepayTestError,
		"stripe_secret_key_preview":           maskCredential(settings.StripeSecretKey),
		"stripe_secret_key_env":               detectStripeEnv(settings.StripeSecretKey),
		"stripe_webhook_secret_preview":       maskCredential(settings.StripeWebhookSecret),
		"asaas_api_key_preview":               maskCredential(settings.AsaasAPIKey),
		"asaas_webhook_secret_preview":        maskCredential(settings.AsaasWebhookSecret),
		"abacatepay_api_key_preview":          maskCredential(settings.AbacatepayAPIKey),
		"abacatepay_webhook_secret_preview":   maskCredential(settings.AbacatepayWebhookSecret),
	})
}

// TestPaymentProvider POST /admin/payment-settings/test/:provider
// Roda o test de conectividade na hora pra um provider específico,
// sem precisar re-salvar credenciais. Útil quando admin quer revalidar
// uma config antiga (ex.: rotação de chave do lado do provider).
func (h *AdminHandler) TestPaymentProvider(c *fiber.Ctx) error {
	provider := c.Params("provider")
	if provider != "stripe" && provider != "asaas" && provider != "abacatepay" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider inválido (use stripe|asaas|abacatepay)"})
	}
	var settings models.PaymentSettings
	if err := h.db.Where("id = ?", "default").First(&settings).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "configurações não encontradas"})
	}
	ok, errMsg := h.testPaymentProvider(provider, &settings)
	now := time.Now()
	patch := map[string]any{}
	switch provider {
	case "stripe":
		patch["stripe_tested_at"] = now
		patch["stripe_test_error"] = errMsg
		if ok {
			patch["stripe_test_status"] = "ok"
		} else {
			patch["stripe_test_status"] = "failed"
		}
	case "asaas":
		patch["asaas_tested_at"] = now
		patch["asaas_test_error"] = errMsg
		if ok {
			patch["asaas_test_status"] = "ok"
		} else {
			patch["asaas_test_status"] = "failed"
		}
	case "abacatepay":
		patch["abacatepay_tested_at"] = now
		patch["abacatepay_test_error"] = errMsg
		if ok {
			patch["abacatepay_test_status"] = "ok"
		} else {
			patch["abacatepay_test_status"] = "failed"
		}
	}
	h.db.Model(&settings).Updates(patch)
	return c.JSON(fiber.Map{
		"ok":        ok,
		"error":     errMsg,
		"tested_at": now,
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

	h.emailSvc.SendAdminCreatedAccount(email.AdminCreatedAccountInput{
		To:           user.Email,
		Name:         user.Name,
		UserEmail:    user.Email,
		TempPassword: plainPassword,
	})

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
	// Aceita só roles válidas. Antes esse check usava "admin"/"user"
	// (legado de antes da renomeação) e silenciosamente ignorava
	// qualquer mudança de role vinda do front — bug.
	switch req.Role {
	case string(models.RoleSuperAdmin), string(models.RoleCustomer), string(models.RoleLead), string(models.RoleValidate):
		updates["role"] = req.Role
	case "":
		// não veio no payload — não toca no role
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "role inválido — use super_admin, customer, lead ou validate",
		})
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

	// Sprint billing F — audit log quando admin troca o plano de um user.
	// Captura plano anterior + novo + email do admin que executou.
	if pidNew, ok := updates["plan_id"].(uuid.UUID); ok && (user.PlanID == nil || *user.PlanID != pidNew) {
		actor := middleware.GetCurrentUser(c)
		var oldPlan, newPlan models.Plan
		if user.PlanID != nil {
			h.db.First(&oldPlan, "id = ?", *user.PlanID)
		}
		h.db.First(&newPlan, "id = ?", pidNew)

		// Downgrade: detecta violação dos novos limites e loga aviso.
		// Não auto-pausa instâncias/campanhas (decisão UX delicada —
		// pode quebrar fluxo crítico do user); o banner de usage no
		// frontend pega `usage > limit` e mostra alerta.
		var instCount, campaignCount int64
		h.db.Model(&models.Instance{}).Where("user_id = ?", user.ID).Count(&instCount)
		h.db.Model(&models.Campaign{}).Where("user_id = ? AND status NOT IN ?", user.ID,
			[]string{"completed", "cancelled", "failed"}).Count(&campaignCount)
		if newPlan.MaxInstances > 0 && int(instCount) > newPlan.MaxInstances {
			log.Warn().Str("user_id", user.ID.String()).
				Int("instances_atual", int(instCount)).Int("limite_novo", newPlan.MaxInstances).
				Msg("plan downgrade: usuário excede limite de instâncias — banner de upgrade no frontend cobre")
		}
		if newPlan.MaxCampaigns > 0 && int(campaignCount) > newPlan.MaxCampaigns {
			log.Warn().Str("user_id", user.ID.String()).
				Int("campanhas_atual", int(campaignCount)).Int("limite_novo", newPlan.MaxCampaigns).
				Msg("plan downgrade: usuário excede limite de campanhas")
		}

		entry := models.PlanChangeLog{
			UserID:       user.ID,
			FromPlanID:   user.PlanID,
			ToPlanID:     &pidNew,
			FromPlanName: oldPlan.Name,
			ToPlanName:   newPlan.Name,
			Source:       models.PlanChangeSourceAdmin,
		}
		if actor != nil {
			entry.ActorID = &actor.ID
			entry.ActorEmail = actor.Email
		}
		h.db.Create(&entry)
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
// DELETE /admin/users/:id?purge=true
//
// Soft delete (default): marca deleted_at no user e nas suas
// workspaces/dependentes que tenham coluna deleted_at. Sem FK
// violation (nada some fisicamente), dados continuam recuperáveis,
// queries normais ignoram via scope global do GORM.
//
// purge=true: hard delete (descobre FKs via information_schema e
// remove fisicamente em cascata). Use só pra cumprir LGPD/right-to-be-forgotten;
// é destrutivo e irreversível.
func (h *AdminHandler) DeleteUser(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	// Aceita ?purge=true ou ?cascade=true (alias legado)
	purge := c.Query("purge") == "true" || c.Query("cascade") == "true"

	// ────────────────────────────────────────────────────────────
	// SOFT DELETE — caminho padrão. Marca deleted_at, sem mexer em
	// FK. As tabelas dependentes que também têm deleted_at são
	// marcadas em cascata pelo GORM via association cascade ou
	// pelos UPDATEs auxiliares abaixo.
	// ────────────────────────────────────────────────────────────
	if !purge {
		err = h.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Delete(&models.User{}, "id = ?", userID).Error; err != nil {
				return err
			}
			// Workspaces owned pelo user → soft delete em cascata pra
			// sumirem das listas dos outros members também.
			tx.Where("owner_id = ?", userID).Delete(&models.Workspace{})
			return nil
		})
		if err != nil {
			log.Error().Err(err).Str("user_id", userID.String()).Msg("admin: soft delete user failed")
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":  "erro ao deletar usuário",
				"detail": err.Error(),
			})
		}
		LogAudit(h.db, c, "user.delete",
			AuditTarget{Type: "user", ID: &userID},
			map[string]any{"soft": true})
		return c.JSON(fiber.Map{
			"message": "usuário removido (soft delete — recuperável)",
			"soft":    true,
		})
	}

	// ────────────────────────────────────────────────────────────
	// HARD DELETE / PURGE — só com purge=true explícito. Remove
	// fisicamente o user e todas as dependências. Irreversível.
	// ────────────────────────────────────────────────────────────
	cleaned := map[string]int64{}
	err = h.db.Transaction(func(tx *gorm.DB) error {
		var ownerWsIDs []string
		tx.Raw(`SELECT id::text FROM workspaces WHERE owner_id = ?`, userID).Scan(&ownerWsIDs)

		if len(ownerWsIDs) > 0 {
			if err := cascadeDeleteByFK(tx, "workspaces", "id", ownerWsIDs, cleaned); err != nil {
				return err
			}
			res := tx.Exec(`DELETE FROM workspaces WHERE id::text IN (` + buildIDList(ownerWsIDs) + `)`)
			if res.Error != nil {
				return res.Error
			}
			cleaned["workspaces"] += res.RowsAffected
		}

		if err := cascadeDeleteByFK(tx, "users", "id", []string{userID.String()}, cleaned); err != nil {
			return err
		}

		res := tx.Exec(`DELETE FROM users WHERE id = ?`, userID)
		if res.Error != nil {
			return res.Error
		}
		cleaned["users"] = res.RowsAffected
		return nil
	})
	if err != nil {
		log.Error().Err(err).Str("user_id", userID.String()).Msg("admin: purge user failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "erro no purge",
			"detail":  err.Error(),
			"hint":    "Veja os logs do backend pra identificar a tabela/coluna que falhou.",
			"cleaned": cleaned,
		})
	}
	LogAudit(h.db, c, "user.purge",
		AuditTarget{Type: "user", ID: &userID},
		map[string]any{"purge": true, "deleted": cleaned})
	return c.JSON(fiber.Map{
		"message": "usuário e dependências removidos fisicamente",
		"deleted": cleaned,
		"purge":   true,
	})
}

// UserDeleteDiagnose godoc
// GET /admin/users/:id/delete-diagnose
// Retorna quais tabelas têm registros vinculados ao user (dry-run do cascade).
func (h *AdminHandler) UserDeleteDiagnose(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	type rowCount struct {
		Table  string `json:"table"`
		Column string `json:"column"`
		Count  int64  `json:"count"`
		Via    string `json:"via,omitempty"`
	}
	var result []rowCount

	// Workspaces do user
	var wsIDs []string
	h.db.Raw(`SELECT id::text FROM workspaces WHERE owner_id = ?`, userID).Scan(&wsIDs)

	collectCounts := func(parentTable, parentCol string, parentIDs []string, via string) {
		if len(parentIDs) == 0 {
			return
		}
		type fk struct{ Table, Column string }
		var fks []fk
		h.db.Raw(`
			SELECT cl.relname AS table, att.attname AS column
			FROM pg_constraint con
			JOIN pg_class cl   ON cl.oid  = con.conrelid
			JOIN pg_class pcl  ON pcl.oid = con.confrelid
			JOIN pg_attribute att  ON att.attrelid  = cl.oid  AND att.attnum  = ANY(con.conkey)
			JOIN pg_attribute patt ON patt.attrelid = pcl.oid AND patt.attnum = ANY(con.confkey)
			WHERE con.contype = 'f' AND pcl.relname = ? AND patt.attname = ?`,
			parentTable, parentCol).Scan(&fks)

		idList := buildIDList(parentIDs)
		for _, f := range fks {
			var cnt int64
			h.db.Raw(fmt.Sprintf(`SELECT COUNT(*) FROM "%s" WHERE "%s"::text IN (%s)`, f.Table, f.Column, idList)).Scan(&cnt)
			if cnt > 0 {
				result = append(result, rowCount{Table: f.Table, Column: f.Column, Count: cnt, Via: via})
			}
		}
	}

	if len(wsIDs) > 0 {
		collectCounts("workspaces", "id", wsIDs, "workspace")
	}
	collectCounts("users", "id", []string{userID.String()}, "user")

	return c.JSON(fiber.Map{
		"user_id":     userID,
		"workspaces":  wsIDs,
		"dependents":  result,
	})
}

// cascadeDeleteByFK deleta recursivamente todos os dependentes de (parentTable.parentCol)
// antes de retornar — permitindo que o caller delete o próprio parent sem violar FKs.
// Usa recursão em profundidade: para cada filho, coleta os IDs afetados e desce na
// hierarquia antes de executar o DELETE nessa tabela.
func cascadeDeleteByFK(tx *gorm.DB, parentTable, parentCol string, ids []string, counts map[string]int64) error {
	return cascadeDeleteRecursive(tx, parentTable, parentCol, ids, counts, map[string]bool{}, 0)
}

func cascadeDeleteRecursive(tx *gorm.DB, parentTable, parentCol string, ids []string, counts map[string]int64, visited map[string]bool, depth int) error {
	if len(ids) == 0 || depth > 20 {
		return nil
	}

	type fkRef struct {
		Table  string
		Column string
	}
	var fks []fkRef
	q := `
		SELECT
			cl.relname  AS table,
			att.attname AS column
		FROM pg_constraint con
		JOIN pg_class cl  ON cl.oid = con.conrelid
		JOIN pg_class pcl ON pcl.oid = con.confrelid
		JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = ANY(con.conkey)
		JOIN pg_attribute patt ON patt.attrelid = pcl.oid AND patt.attnum = ANY(con.confkey)
		WHERE con.contype = 'f'
		  AND pcl.relname = ?
		  AND patt.attname = ?
	`
	if err := tx.Raw(q, parentTable, parentCol).Scan(&fks).Error; err != nil {
		return err
	}

	idList := buildIDList(ids)

	for _, f := range fks {
		if f.Table == parentTable {
			// FK auto-referente (ex.: users.invited_by_id → users.id).
			// Se ignorarmos, o DELETE no parent quebra com FK violation.
			// Estratégia: tentar setar NULL no parente ainda existente
			// (column nullable) ANTES de deletar o user. Se a coluna for
			// NOT NULL, deletamos os filhos recursivamente.
			nullable := false
			tx.Raw(`SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
				f.Table, f.Column).Scan(&nullable)
			if nullable {
				stmt := fmt.Sprintf(`UPDATE "%s" SET "%s" = NULL WHERE "%s"::text IN (%s)`, f.Table, f.Column, f.Column, idList)
				if res := tx.Exec(stmt); res.Error != nil {
					return fmt.Errorf("self-fk null %s.%s: %w", f.Table, f.Column, res.Error)
				}
				log.Debug().Str("table", f.Table).Str("col", f.Column).Msg("cascade: nulled self-fk")
			} else {
				// Coluna NOT NULL — pega os filhos cujo FK aponta pro
				// parent que estamos deletando e remove eles também.
				var childPKs []string
				pkQ := fmt.Sprintf(`SELECT id::text FROM "%s" WHERE "%s"::text IN (%s) AND id::text NOT IN (%s)`, f.Table, f.Column, idList, idList)
				_ = tx.Raw(pkQ).Scan(&childPKs).Error
				if len(childPKs) > 0 {
					if err := cascadeDeleteRecursive(tx, f.Table, "id", childPKs, counts, visited, depth+1); err != nil {
						return err
					}
				}
			}
			continue
		}
		visitKey := f.Table + "." + f.Column + "<-" + parentTable + "." + parentCol
		if visited[visitKey] {
			continue
		}
		visited[visitKey] = true

		log.Debug().
			Str("table", f.Table).Str("col", f.Column).
			Str("parent", parentTable).Int("depth", depth).
			Msg("cascade: checking child table")

		// Verifica ANTES se a tabela tem coluna "id" via information_schema.
		// Tentar SELECT id direto numa join table aborta a transação inteira
		// (Postgres SQLSTATE 25P02 — current transaction is aborted) e
		// propaga em todos os DELETEs seguintes.
		hasIDCol := false
		tx.Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = 'id')`, f.Table).Scan(&hasIDCol)

		if hasIDCol {
			var childPKs []string
			pkQ := fmt.Sprintf(`SELECT id::text FROM "%s" WHERE "%s"::text IN (%s)`, f.Table, f.Column, idList)
			if err := tx.Raw(pkQ).Scan(&childPKs).Error; err != nil {
				return fmt.Errorf("scan children %s.%s: %w", f.Table, f.Column, err)
			}
			if len(childPKs) > 0 {
				if err := cascadeDeleteRecursive(tx, f.Table, "id", childPKs, counts, visited, depth+1); err != nil {
					return err
				}
			}
		} else {
			// Join table — DELETE direto resolve, ela mesma não tem
			// dependentes (sem PK próprio que outras tabelas referenciem).
			log.Debug().Str("table", f.Table).Msg("cascade: join table (no id), direct delete")
		}

		stmt := fmt.Sprintf(`DELETE FROM "%s" WHERE "%s"::text IN (%s)`, f.Table, f.Column, idList)
		log.Debug().Str("stmt_prefix", fmt.Sprintf("DELETE FROM \"%s\" WHERE \"%s\"", f.Table, f.Column)).Msg("cascade: executing delete")
		res := tx.Exec(stmt)
		if res.Error != nil {
			log.Error().Err(res.Error).Str("table", f.Table).Str("col", f.Column).Msg("cascade: delete failed")
			return fmt.Errorf("delete %s.%s: %w", f.Table, f.Column, res.Error)
		}
		log.Debug().Str("table", f.Table).Int64("rows", res.RowsAffected).Msg("cascade: deleted")
		counts[f.Table] += res.RowsAffected
	}
	return nil
}

func buildIDList(ids []string) string {
	quoted := make([]string, len(ids))
	for i, id := range ids {
		quoted[i] = "'" + strings.ReplaceAll(id, "'", "") + "'"
	}
	return strings.Join(quoted, ",")
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
		MaxAgents         int     `json:"max_agents"`
		MaxJourneys       int     `json:"max_journeys"`
		MaxCampaigns      int     `json:"max_campaigns"`
		MaxTriggers       int     `json:"max_triggers"`
		MaxWebhooks       int     `json:"max_webhooks"`
		MaxContacts       int     `json:"max_contacts"`
		MaxDeals          int     `json:"max_deals"`
		MaxShops          int     `json:"max_shops"`
		MaxProducts       int     `json:"max_products"`
		MaxShopIntegrations int   `json:"max_shop_integrations"`
		MaxInstancesPerProxy int  `json:"max_instances_per_proxy"`
		MaxProxyPool      int     `json:"max_proxy_pool"`
		Features          string  `json:"features"`
		AllowAI           bool    `json:"allow_ai"`
		AllowJourneys     bool    `json:"allow_journeys"`
		AllowCRM          bool    `json:"allow_crm"`
		AllowInbox        bool    `json:"allow_inbox"`
		AllowCampaigns    bool    `json:"allow_campaigns"`
		AllowTriggers     bool    `json:"allow_triggers"`
		AllowWarmup       bool    `json:"allow_warmup"`
		AllowNewsletters  bool    `json:"allow_newsletters"`
		AllowCommunities  bool    `json:"allow_communities"`
		AllowInstagram    bool    `json:"allow_instagram"`
		AllowTikTok       bool    `json:"allow_tiktok"`
		AllowAPIAccess    bool    `json:"allow_api_access"`
		AllowGlobalWebhook bool   `json:"allow_global_webhook"`
		AllowShop         bool    `json:"allow_shop"`
		AllowProxy        bool    `json:"allow_proxy"`
		AllowProxyResidencial bool `json:"allow_proxy_residencial"`
		StripePriceID     string  `json:"stripe_price_id"`
		AsaasProductID    string  `json:"asaas_product_id"`
		AbacatepayProductID string `json:"abacatepay_product_id"`
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
		MaxAgents:         req.MaxAgents,
		MaxJourneys:       req.MaxJourneys,
		MaxCampaigns:      req.MaxCampaigns,
		MaxTriggers:       req.MaxTriggers,
		MaxWebhooks:       req.MaxWebhooks,
		MaxContacts:       req.MaxContacts,
		MaxDeals:          req.MaxDeals,
		MaxShops:          req.MaxShops,
		MaxProducts:       req.MaxProducts,
		MaxShopIntegrations: req.MaxShopIntegrations,
		MaxInstancesPerProxy: req.MaxInstancesPerProxy,
		MaxProxyPool:      req.MaxProxyPool,
		Features:          features,
		AllowAI:           req.AllowAI,
		AllowJourneys:     req.AllowJourneys,
		AllowCRM:          req.AllowCRM,
		AllowInbox:        req.AllowInbox,
		AllowCampaigns:    req.AllowCampaigns,
		AllowTriggers:     req.AllowTriggers,
		AllowWarmup:       req.AllowWarmup,
		AllowNewsletters:  req.AllowNewsletters,
		AllowCommunities:  req.AllowCommunities,
		AllowInstagram:    req.AllowInstagram,
		AllowTikTok:       req.AllowTikTok,
		AllowAPIAccess:    req.AllowAPIAccess,
		AllowGlobalWebhook: req.AllowGlobalWebhook,
		AllowShop:         req.AllowShop,
		AllowProxy:        req.AllowProxy,
		AllowProxyResidencial: req.AllowProxyResidencial,
		StripePriceID:     req.StripePriceID,
		AsaasProductID:    req.AsaasProductID,
		AbacatepayProductID: req.AbacatepayProductID,
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
		Slug              string   `json:"slug"`
		Price             *float64 `json:"price"`
		MaxInstances      *int     `json:"max_instances"`
		MaxMessagesPerDay *int     `json:"max_messages_per_day"`
		MaxUsers          *int     `json:"max_users"`
		MaxWorkspaces     *int     `json:"max_workspaces"`
		MaxAgents         *int     `json:"max_agents"`
		MaxJourneys       *int     `json:"max_journeys"`
		MaxCampaigns      *int     `json:"max_campaigns"`
		MaxTriggers       *int     `json:"max_triggers"`
		MaxWebhooks       *int     `json:"max_webhooks"`
		MaxContacts       *int     `json:"max_contacts"`
		MaxDeals          *int     `json:"max_deals"`
		Features          string   `json:"features"`
		// Sistema de créditos (Fase 1+) — sem isso o admin não consegue
		// editar limit/topup/overage do plano: o handler ignorava o
		// payload e o front via os campos zerarem após save.
		AICreditsIncludedPerCycle      *int64 `json:"ai_credits_included_per_cycle"`
		VoiceCreditsIncludedPerCycle   *int64 `json:"voice_credits_included_per_cycle"`
		MessageCreditsIncludedPerCycle *int64 `json:"message_credits_included_per_cycle"`
		OverageAllowedDefault          *bool  `json:"overage_allowed_default"`
		OverageMillicentsPerCredit     *int64 `json:"overage_millicents_per_credit"`
		AllowAI           *bool    `json:"allow_ai"`
		AllowVoice        *bool    `json:"allow_voice"`
		AllowJourneys     *bool    `json:"allow_journeys"`
		AllowCRM          *bool    `json:"allow_crm"`
		AllowInbox        *bool    `json:"allow_inbox"`
		AllowCampaigns    *bool    `json:"allow_campaigns"`
		AllowTriggers     *bool    `json:"allow_triggers"`
		AllowWarmup       *bool    `json:"allow_warmup"`
		AllowNewsletters  *bool    `json:"allow_newsletters"`
		AllowCommunities  *bool    `json:"allow_communities"`
		AllowWhatsAppQR   *bool    `json:"allow_whatsapp_qr"`
		AllowWABA         *bool    `json:"allow_waba"`
		AllowInstagram    *bool    `json:"allow_instagram"`
		AllowTikTok       *bool    `json:"allow_tiktok"`
		AllowAPIAccess    *bool    `json:"allow_api_access"`
		AllowGlobalWebhook *bool   `json:"allow_global_webhook"`
		AllowHelpDesk     *bool    `json:"allow_helpdesk"`
		AllowWebChat      *bool    `json:"allow_webchat"`
		AllowProxy        *bool    `json:"allow_proxy"`
		AllowProxyResidencial *bool `json:"allow_proxy_residencial"`
		AllowShop         *bool    `json:"allow_shop"`
		MaxShops          *int     `json:"max_shops"`
		MaxProducts       *int     `json:"max_products"`
		MaxShopIntegrations *int   `json:"max_shop_integrations"`
		MaxInstancesPerProxy *int  `json:"max_instances_per_proxy"`
		MaxProxyPool      *int     `json:"max_proxy_pool"`
		IsActive          *bool    `json:"is_active"`
		StripePriceID     string   `json:"stripe_price_id"`
		AsaasProductID    string   `json:"asaas_product_id"`
		AbacatepayProductID string `json:"abacatepay_product_id"`
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
	if req.Slug != "" {
		updates["slug"] = req.Slug
	}
	if req.MaxAgents != nil {
		updates["max_agents"] = *req.MaxAgents
	}
	if req.MaxJourneys != nil {
		updates["max_journeys"] = *req.MaxJourneys
	}
	if req.MaxCampaigns != nil {
		updates["max_campaigns"] = *req.MaxCampaigns
	}
	if req.MaxTriggers != nil {
		updates["max_triggers"] = *req.MaxTriggers
	}
	if req.MaxWebhooks != nil {
		updates["max_webhooks"] = *req.MaxWebhooks
	}
	if req.MaxContacts != nil {
		updates["max_contacts"] = *req.MaxContacts
	}
	if req.MaxDeals != nil {
		updates["max_deals"] = *req.MaxDeals
	}
	// Sistema de créditos — limites + overage por ciclo
	if req.AICreditsIncludedPerCycle != nil {
		updates["ai_credits_included_per_cycle"] = *req.AICreditsIncludedPerCycle
	}
	if req.VoiceCreditsIncludedPerCycle != nil {
		updates["voice_credits_included_per_cycle"] = *req.VoiceCreditsIncludedPerCycle
	}
	if req.MessageCreditsIncludedPerCycle != nil {
		updates["message_credits_included_per_cycle"] = *req.MessageCreditsIncludedPerCycle
	}
	if req.OverageAllowedDefault != nil {
		updates["overage_allowed_default"] = *req.OverageAllowedDefault
	}
	if req.OverageMillicentsPerCredit != nil {
		updates["overage_millicents_per_credit"] = *req.OverageMillicentsPerCredit
	}
	// Feature flags (pointer pra distinguir false explícito de não-enviado)
	if req.AllowAI != nil {
		updates["allow_ai"] = *req.AllowAI
	}
	if req.AllowVoice != nil {
		updates["allow_voice"] = *req.AllowVoice
	}
	if req.AllowJourneys != nil {
		updates["allow_journeys"] = *req.AllowJourneys
	}
	if req.AllowCRM != nil {
		updates["allow_crm"] = *req.AllowCRM
	}
	if req.AllowInbox != nil {
		updates["allow_inbox"] = *req.AllowInbox
	}
	if req.AllowCampaigns != nil {
		updates["allow_campaigns"] = *req.AllowCampaigns
	}
	if req.AllowTriggers != nil {
		updates["allow_triggers"] = *req.AllowTriggers
	}
	if req.AllowWarmup != nil {
		updates["allow_warmup"] = *req.AllowWarmup
	}
	if req.AllowNewsletters != nil {
		updates["allow_newsletters"] = *req.AllowNewsletters
	}
	if req.AllowCommunities != nil {
		updates["allow_communities"] = *req.AllowCommunities
	}
	if req.AllowWhatsAppQR != nil {
		updates["allow_whatsapp_qr"] = *req.AllowWhatsAppQR
	}
	if req.AllowWABA != nil {
		updates["allow_waba"] = *req.AllowWABA
	}
	if req.AllowInstagram != nil {
		updates["allow_instagram"] = *req.AllowInstagram
	}
	if req.AllowTikTok != nil {
		updates["allow_tiktok"] = *req.AllowTikTok
	}
	if req.AllowAPIAccess != nil {
		updates["allow_api_access"] = *req.AllowAPIAccess
	}
	if req.AllowGlobalWebhook != nil {
		updates["allow_global_webhook"] = *req.AllowGlobalWebhook
	}
	if req.AllowHelpDesk != nil {
		updates["allow_helpdesk"] = *req.AllowHelpDesk
	}
	if req.AllowWebChat != nil {
		updates["allow_webchat"] = *req.AllowWebChat
	}
	if req.AllowProxy != nil {
		updates["allow_proxy"] = *req.AllowProxy
	}
	if req.AllowProxyResidencial != nil {
		updates["allow_proxy_residencial"] = *req.AllowProxyResidencial
	}
	if req.AllowShop != nil {
		updates["allow_shop"] = *req.AllowShop
	}
	if req.MaxShops != nil {
		updates["max_shops"] = *req.MaxShops
	}
	if req.MaxProducts != nil {
		updates["max_products"] = *req.MaxProducts
	}
	if req.MaxShopIntegrations != nil {
		updates["max_shop_integrations"] = *req.MaxShopIntegrations
	}
	if req.MaxInstancesPerProxy != nil {
		updates["max_instances_per_proxy"] = *req.MaxInstancesPerProxy
	}
	if req.MaxProxyPool != nil {
		updates["max_proxy_pool"] = *req.MaxProxyPool
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.StripePriceID != "" {
		// Guard contra Plan.Price divergir do unit_amount real do
		// Stripe Price. Sem isso, admin pode setar Price=99 no DB
		// mas o checkout cobra 199 (porque o Stripe Price é 199).
		// Valida via API: stripeprice.Get e compara em centavos.
		// Se Stripe não está configurado (key vazia), pula a checagem
		// — admin assume responsabilidade.
		loadStripeConfigFromDB(h.db)
		if stripeKey != "" {
			stripe.Key = stripeKey
			sp, err := stripeprice.Get(req.StripePriceID, nil)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error":   "stripe_price_invalid",
					"message": "Price ID '" + req.StripePriceID + "' não existe na conta Stripe configurada (verifique modo test/live)",
				})
			}
			expectedCents := req.Price
			actualCents := float64(sp.UnitAmount) // unit_amount is in minor units
			expected := 0.0
			if expectedCents != nil {
				expected = *expectedCents * 100
			} else {
				expected = plan.Price * 100
			}
			if actualCents != expected {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error":   "stripe_price_mismatch",
					"message": fmt.Sprintf("Price '%s' está como %.2f no Stripe mas o plano está como %.2f no DB. Atualize um dos lados antes de salvar.", req.StripePriceID, actualCents/100, expected/100),
					"stripe":  actualCents / 100,
					"db":      expected / 100,
				})
			}
		}
		updates["stripe_price_id"] = req.StripePriceID
	}
	if req.AsaasProductID != "" {
		updates["asaas_product_id"] = req.AsaasProductID
	}
	if req.AbacatepayProductID != "" {
		updates["abacatepay_product_id"] = req.AbacatepayProductID
	}

	if err := h.db.Model(&plan).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar plano"})
	}

	h.db.First(&plan, "id = ?", plan.ID)
	return c.JSON(plan)
}

// PlanChangeLog GET /admin/users/:id/plan-changes
//
// Histórico de mudanças de plano de um user específico. Útil pra suporte
// debugar "por que esse cliente caiu de Pro pra Free?".
func (h *AdminHandler) ListUserPlanChanges(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	limit := c.QueryInt("limit", 50)
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var logs []models.PlanChangeLog
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Limit(limit).Find(&logs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": logs, "total": len(logs)})
}

// AllPlanChanges GET /admin/plan-changes
//
// Audit log global de TODAS mudanças. Filtros: ?source=stripe|admin|self,
// ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?limit, ?offset.
func (h *AdminHandler) AllPlanChanges(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 100)
	if limit > 500 {
		limit = 500
	}
	offset := c.QueryInt("offset", 0)
	q := h.db.Model(&models.PlanChangeLog{})
	if src := c.Query("source"); src != "" {
		q = q.Where("source = ?", src)
	}
	if from := c.Query("from"); from != "" {
		q = q.Where("created_at >= ?", from)
	}
	if to := c.Query("to"); to != "" {
		q = q.Where("created_at <= ?", to)
	}

	var total int64
	q.Count(&total)
	var logs []models.PlanChangeLog
	q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&logs)
	return c.JSON(fiber.Map{"data": logs, "total": total, "limit": limit, "offset": offset})
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
			"api_key":         "",
			"api_key_preview": "",
			"sender_email":    "mail@uniq.chat",
			"sender_name":     "Uniq.chat",
			"is_enabled":      true,
			"has_api_key":     false,
		})
	}
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar configurações"})
	}

	// Não retorna a chave real (segurança), mas devolve preview mascarado
	// (primeiros 4 + últimos 4 caracteres) pra admin confirmar qual chave
	// está configurada no momento sem ter que rotacionar.
	return c.JSON(fiber.Map{
		"api_key":         "",
		"api_key_preview": maskCredential(settings.APIKey),
		"sender_email":    settings.SenderEmail,
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

	// Defaults — antes a API rejeitava sender_email vazio com 400, mas
	// o GET retorna ""=mascarado em alguns casos e o frontend nunca via
	// erro claro (toast genérico "Erro ao salvar"). Agora aceitamos
	// vazio e caímos em fallback do domínio principal.
	if req.SenderEmail == "" {
		req.SenderEmail = "mail@uniq.chat"
	}
	if req.SenderName == "" {
		req.SenderName = "Uniq.chat"
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
		if err := h.db.Create(&settings).Error; err != nil {
			return SafeErr(c, fiber.StatusInternalServerError, "email_settings_create_failed",
				"erro ao salvar configurações de email — verifique se a tabela email_settings existe (execute migração)", err)
		}
	} else if result.Error != nil {
		return SafeErr(c, fiber.StatusInternalServerError, "email_settings_read_failed",
			"erro ao ler configurações de email", result.Error)
	} else {
		// Update existing - só sobrescreve APIKey se for fornecida.
		// (GET mascara como "" — sem essa proteção a UI zerava a chave
		// existente no salvamento.)
		if req.APIKey != "" {
			settings.APIKey = req.APIKey
		}
		settings.SenderEmail = req.SenderEmail
		settings.SenderName = req.SenderName
		settings.IsEnabled = req.IsEnabled
		if err := h.db.Save(&settings).Error; err != nil {
			return SafeErr(c, fiber.StatusInternalServerError, "email_settings_update_failed",
				"erro ao atualizar configurações de email", err)
		}
	}

	// Update the email service config
	if h.emailSvc != nil {
		apiKey := settings.APIKey
		if apiKey == "" {
			apiKey = req.APIKey // Use new API key if just set
		}
		h.emailSvc.SetConfig(apiKey, settings.SenderEmail, settings.SenderName)
	}

	return c.JSON(fiber.Map{
		"message":      "configurações atualizadas",
		"sender_email": settings.SenderEmail,
		"sender_name":  settings.SenderName,
		"is_enabled":   settings.IsEnabled,
		"has_api_key":  settings.APIKey != "",
	})
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

	if h.emailSvc == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error":   "email_service_unavailable",
			"message": "serviço de email não está inicializado — reinicie o backend após salvar a config",
		})
	}

	// Garante que o emailSvc está sincronizado com a config persistida.
	// Em primeira ativação (sem reinício do servidor), o admin acabou
	// de salvar a chave em /admin/email-settings → emailSvc tem a chave
	// nova injetada via SetConfig, mas se o save tiver falhado em algum
	// step intermediário, podemos estar com chave antiga. Refresh aqui
	// é defensivo.
	var settings models.EmailSettings
	if err := h.db.First(&settings).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "email_not_configured",
			"message": "configure o email em /admin/providers → Email primeiro",
		})
	}

	if !settings.IsEnabled {
		// Test deliberadamente IGNORA is_enabled=false. Admin precisa
		// poder testar a chave antes de marcar "Habilitado" e expor o
		// envio pra todos os fluxos (welcome, forgot, etc). Loga apenas.
		log.Info().Str("to", req.To).Msg("test email: enviando mesmo com is_enabled=false (teste é exceção)")
	}

	if strings.TrimSpace(settings.APIKey) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "email_api_key_missing",
			"message": "API key do Maileroo não configurada — adicione em /admin/providers → Email",
		})
	}

	// Sincroniza o emailSvc com o que está no DB nesse instante (cobre o
	// caso de Save ter persistido mas o singleton ainda estar com a
	// chave antiga em memória — race entre dois admins editando).
	h.emailSvc.SetConfig(settings.APIKey, settings.SenderEmail, settings.SenderName)

	// Send test email
	htmlContent := email.TestHTML("Uniq.chat")
	err := h.emailSvc.SyncSend(req.To, "Teste do Uniq.chat", htmlContent, "test")
	if err != nil {
		// Erro do Maileroo já vem com hint (HTTP 401/403/422 + razão).
		// Loga internamente também pra sysadmin.
		log.Error().Err(err).Str("to", req.To).Str("from", settings.SenderEmail).
			Msg("test email: falhou no Maileroo")
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "maileroo_send_failed",
			"message": "falha ao enviar via Maileroo: " + err.Error(),
		})
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

// ─── Platform AI (Uniq AI) ────────────────────────────────────────────────────

// ListPlatformAI GET /v1/admin/platform-ai
// Retorna todas as configs de Uniq AI (sem API key).
func (h *AdminHandler) ListPlatformAI(c *fiber.Ctx) error {
	var cfgs []models.PlatformAI
	if err := h.db.Order("created_at ASC").Find(&cfgs).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao buscar configs"})
	}
	out := make([]fiber.Map, 0, len(cfgs))
	for _, cfg := range cfgs {
		out = append(out, fiber.Map{
			"id":             cfg.ID,
			"provider":       cfg.Provider,
			"name":           cfg.Name,
			"base_url":       cfg.BaseURL,
			"models":         cfg.Models,
			"config":         cfg.Config,
			"is_active":      cfg.IsActive,
			"test_status":    cfg.TestStatus,
			"last_tested_at": cfg.LastTestedAt,
			"has_api_key":    cfg.APIKey != "",
		})
	}
	return c.JSON(out)
}

// CreatePlatformAI POST /v1/admin/platform-ai
// Cria uma nova config de Uniq AI.
func (h *AdminHandler) CreatePlatformAI(c *fiber.Ctx) error {
	var body struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIKey   string `json:"api_key"`
		BaseURL  string `json:"base_url"`
		Models   string `json:"models"`
		Config   string `json:"config"`
		IsActive *bool  `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if body.Provider == "" {
		return c.Status(400).JSON(fiber.Map{"error": "provider é obrigatório"})
	}

	cfg := models.PlatformAI{
		Provider: models.IntegrationProvider(body.Provider),
		Name:     body.Name,
		APIKey:   body.APIKey,
		BaseURL:  body.BaseURL,
		Models:   body.Models,
		Config:   body.Config,
		IsActive: true,
	}
	if cfg.Name == "" {
		cfg.Name = "Uniq AI"
	}
	if body.IsActive != nil {
		cfg.IsActive = *body.IsActive
	}

	if err := h.db.Create(&cfg).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao criar config"})
	}
	return c.Status(201).JSON(fiber.Map{"ok": true, "id": cfg.ID})
}

// UpdatePlatformAIByID PUT /v1/admin/platform-ai/:id
// Atualiza uma config específica de Uniq AI.
func (h *AdminHandler) UpdatePlatformAIByID(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}

	var body struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIKey   string `json:"api_key"`
		BaseURL  string `json:"base_url"`
		Models   string `json:"models"`
		Config   string `json:"config"`
		IsActive *bool  `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var cfg models.PlatformAI
	if err := h.db.First(&cfg, "id = ?", id).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "config não encontrada"})
	}

	if body.Provider != "" {
		cfg.Provider = models.IntegrationProvider(body.Provider)
	}
	if body.Name != "" {
		cfg.Name = body.Name
	}
	if body.APIKey != "" {
		cfg.APIKey = body.APIKey
	}
	cfg.BaseURL = body.BaseURL
	if body.Models != "" {
		cfg.Models = body.Models
	}
	if body.Config != "" {
		cfg.Config = body.Config
	}
	if body.IsActive != nil {
		cfg.IsActive = *body.IsActive
	}

	if err := h.db.Save(&cfg).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao salvar config"})
	}
	return c.JSON(fiber.Map{"ok": true, "id": cfg.ID})
}

// DeletePlatformAI DELETE /v1/admin/platform-ai/:id
// Remove uma config de Uniq AI.
func (h *AdminHandler) DeletePlatformAI(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}

	if err := h.db.Delete(&models.PlatformAI{}, "id = ?", id).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao deletar config"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// TestPlatformAIByID POST /v1/admin/platform-ai/:id/test
// Testa a conexão com o provider de uma config específica.
func (h *AdminHandler) TestPlatformAIByID(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}

	var cfg models.PlatformAI
	if err := h.db.First(&cfg, "id = ?", id).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "config não encontrada"})
	}
	if cfg.APIKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "API key não configurada"})
	}

	ok, msg := testPlatformAIConnection(&cfg)
	now := time.Now()
	status := "ok"
	if !ok {
		status = "failed"
	}
	h.db.Model(&cfg).Updates(map[string]any{
		"test_status":    status,
		"last_tested_at": now,
	})

	return c.JSON(fiber.Map{"ok": ok, "message": msg})
}

// ListPlatformAIPublic GET /v1/integrations/platform-ai
// Lista configs ativas da Uniq AI pra o ModelSelector. Visibilidade
// difere por papel:
//   - super_admin: vê tudo (provider, name, models) pra debug e
//     gestão da plataforma.
//   - usuário comum: vê APENAS um item genérico "Uniq AI" — sem
//     provider, sem nome interno, sem lista de modelos. Antes
//     vazava OpenAI/Claude/etc no badge do ModelSelector e o
//     cliente final descobria a stack por trás.
func (h *AdminHandler) ListPlatformAIPublic(c *fiber.Ctx) error {
	var cfgs []models.PlatformAI
	if err := h.db.Where("is_active = true").Order("created_at ASC").Find(&cfgs).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro"})
	}

	// Resolve papel do caller. Se não vier user (rota é autenticada
	// mas pode ter cache), assume não-admin por segurança.
	user := middleware.GetCurrentUser(c)
	isAdmin := user != nil && user.Role == models.RoleSuperAdmin

	if !isAdmin {
		// Colapsa todas as configs ativas num único item "Uniq AI".
		// Sem essa abstração, ter 2+ configs (ex: GPT-4 + Claude)
		// faria o ModelSelector listar 2 opções com badges de provider
		// — vazando a stack interna pro user final.
		if len(cfgs) == 0 {
			return c.JSON([]fiber.Map{})
		}
		return c.JSON([]fiber.Map{{
			"id":          cfgs[0].ID,
			"provider":    "uniq",
			"name":        "Uniq AI",
			"is_active":   true,
			"test_status": "ok",
			"models":      []string{"uniq-default"},
		}})
	}

	// Admin: lista completa com detalhes.
	out := make([]fiber.Map, 0, len(cfgs))
	for _, cfg := range cfgs {
		out = append(out, fiber.Map{
			"id":          cfg.ID,
			"provider":    cfg.Provider,
			"name":        cfg.Name,
			"is_active":   cfg.IsActive,
			"test_status": cfg.TestStatus,
			"models":      cfg.Models,
		})
	}
	return c.JSON(out)
}

// testPlatformAIConnection testa a conexão com o provider configurado.
func testPlatformAIConnection(cfg *models.PlatformAI) (bool, string) {
	integration := &models.UserIntegration{
		Provider: cfg.Provider,
		APIKey:   cfg.APIKey,
		BaseURL:  cfg.BaseURL,
	}

	switch cfg.Provider {
	case models.ProviderClaude:
		req, _ := http.NewRequest(http.MethodGet, "https://api.anthropic.com/v1/models", nil)
		req.Header.Set("anthropic-version", "2023-06-01")
		req.Header.Set("x-api-key", cfg.APIKey)
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return false, "falha de conexão: " + err.Error()
		}
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			return true, "Conexão com Claude API bem-sucedida"
		}
		return false, fmt.Sprintf("Claude API retornou status %d", resp.StatusCode)
	case models.ProviderGemini:
		return testGemini(cfg.APIKey)
	case models.ProviderN8N, models.ProviderWebhook:
		if cfg.BaseURL == "" {
			return false, "URL não configurada"
		}
		return true, "URL configurada (não testável automaticamente)"
	default:
		// OpenAI-compatible (OpenAI, DeepSeek, Mistral, etc.)
		return testOpenAICompat(integration)
	}
}

// GetCommunicationSettings godoc
// GET /admin/communication-settings
func (h *AdminHandler) GetCommunicationSettings(c *fiber.Ctx) error {
	var settings models.GlobalCommunicationSettings
	if err := h.db.First(&settings, "id = ?", "default").Error; err != nil {
		// Return empty defaults
		return c.JSON(models.GlobalCommunicationSettings{ID: "default", OTPProvider: "email", AutoMsgProvider: "email"})
	}
	return c.JSON(settings)
}

// UpdateCommunicationSettings godoc
// PUT /admin/communication-settings
func (h *AdminHandler) UpdateCommunicationSettings(c *fiber.Ctx) error {
	var req models.GlobalCommunicationSettings
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.ID = "default"

	var existing models.GlobalCommunicationSettings
	if h.db.First(&existing, "id = ?", "default").Error != nil {
		if err := h.db.Create(&req).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar"})
		}
		return c.JSON(req)
	}
	if err := h.db.Model(&existing).Updates(map[string]interface{}{
		"otp_provider":         req.OTPProvider,
		"otp_instance_id":      req.OTPInstanceID,
		"otp_sms_provider":     req.OTPSMSProvider,
		"otp_sms_key":          req.OTPSMSKey,
		"otp_sms_secret":       req.OTPSMSSecret,
		"otp_sms_from":         req.OTPSMSFrom,
		"auto_msg_provider":    req.AutoMsgProvider,
		"auto_msg_instance_id": req.AutoMsgInstanceID,
		"instagram_account_id": req.InstagramAccountID,
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar"})
	}
	h.db.First(&existing, "id = ?", "default")
	return c.JSON(existing)
}
