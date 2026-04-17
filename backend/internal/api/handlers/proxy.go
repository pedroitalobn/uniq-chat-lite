package handlers

import (
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ProxyHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewProxyHandler(db *gorm.DB, manager *whatsapp.Manager) *ProxyHandler {
	return &ProxyHandler{db: db, manager: manager}
}

type proxyConfigRequest struct {
	Enabled  bool   `json:"enabled"`
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// checkProxyPlanAccess returns 403 if the user's plan doesn't allow proxy.
func checkProxyPlanAccess(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user.Plan == nil || !user.Plan.AllowProxy {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error":   "seu plano não permite uso de proxy",
			"upgrade": "Faça upgrade para o plano Pro ou Enterprise para usar proxies",
		})
	}
	return nil
}

// Effective godoc
// GET /instances/:id/proxy/effective
// Retorna exatamente o proxy que seria aplicado à instância pelo resolver
// (same logic used by buildProxyCfg before Connect). Útil para debug.
// Senha nunca é exposta — apenas marker "p***" se houver.
func (h *ProxyHandler) Effective(c *fiber.Ctx) error {
	if err := checkProxyPlanAccess(c); err != nil {
		return err
	}
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	cfg, source := h.manager.ResolveEffectiveProxyExported(instance)
	resp := fiber.Map{
		"instance_id":      instance.ID,
		"proxy_mode":       instance.ProxyMode,
		"proxy_enabled":    instance.ProxyEnabled,
		"use_global_proxy": instance.UseGlobalProxy,
		"global_proxy_id":  instance.GlobalProxyID,
		"pool_id":          instance.ProxyPoolID,
		"running":          h.manager.IsRunning(instance.ID.String()),
		"source":           source,
	}
	if cfg == nil || !cfg.Enabled {
		resp["effective"] = nil
		resp["note"] = "nenhum proxy será aplicado — conexão direta"
		return c.JSON(resp)
	}
	passMarker := ""
	if cfg.Password != "" {
		passMarker = "p***"
	}
	resp["effective"] = fiber.Map{
		"enabled":  cfg.Enabled,
		"type":     cfg.Type,
		"host":     cfg.Host,
		"port":     cfg.Port,
		"username": cfg.Username,
		"password": passMarker,
		"url":      maskedProxyURL(cfg),
	}
	return c.JSON(resp)
}

// maskedProxyURL monta a URL completa sem revelar senha
func maskedProxyURL(cfg *whatsapp.ProxyConfig) string {
	if cfg == nil || !cfg.Enabled {
		return ""
	}
	scheme := cfg.Type
	auth := ""
	if cfg.Username != "" {
		mask := ""
		if cfg.Password != "" {
			mask = ":***"
		}
		auth = cfg.Username + mask + "@"
	}
	return scheme + "://" + auth + cfg.Host + ":" + strconv.Itoa(cfg.Port)
}

// Get godoc
// GET /instances/:id/proxy
func (h *ProxyHandler) Get(c *fiber.Ctx) error {
	if err := checkProxyPlanAccess(c); err != nil {
		return err
	}

	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	maskedPassword := ""
	if instance.ProxyPassword != "" {
		maskedPassword = "p***"
	}

	return c.JSON(fiber.Map{
		"enabled":     instance.ProxyEnabled,
		"type":        instance.ProxyType,
		"host":        instance.ProxyHost,
		"port":        instance.ProxyPort,
		"username":    instance.ProxyUsername,
		"password":    maskedPassword,
		"status":      instance.ProxyStatus,
		"last_tested": instance.ProxyLastTested,
		"external_ip": instance.ProxyExternalIP,
		"error":       instance.ProxyError,
	})
}

// Set godoc
// PUT /instances/:id/proxy
func (h *ProxyHandler) Set(c *fiber.Ctx) error {
	if err := checkProxyPlanAccess(c); err != nil {
		return err
	}

	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req proxyConfigRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	// Validate
	if req.Enabled {
		if req.Type != "http" && req.Type != "https" && req.Type != "socks5" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tipo de proxy inválido: use http, https ou socks5"})
		}
		if req.Host == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "host é obrigatório"})
		}
		if req.Port <= 0 || req.Port > 65535 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "porta inválida"})
		}
	}

	// Encrypt password
	encryptedPassword := ""
	if req.Password != "" {
		var err error
		encryptedPassword, err = whatsapp.EncryptProxyPassword(req.Password)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criptografar senha do proxy"})
		}
	} else if instance.ProxyPassword != "" && req.Enabled {
		// Keep existing password if not provided
		encryptedPassword = instance.ProxyPassword
	}

	updates := map[string]interface{}{
		"proxy_enabled":  req.Enabled,
		"proxy_type":     req.Type,
		"proxy_host":     req.Host,
		"proxy_port":     req.Port,
		"proxy_username": req.Username,
		"proxy_password": encryptedPassword,
		"proxy_status":   models.ProxyStatusUntested,
		"proxy_error":    "",
		// Proxy manual tem precedência: desabilita qualquer herança do proxy global
		// ou do pool residencial para manter um único source-of-truth por instância.
		"use_global_proxy": false,
		"global_proxy_id":  nil,
		"proxy_pool_id":    nil,
		"proxy_mode": func() models.ProxyMode {
			if req.Enabled {
				return models.ProxyModeManual
			}
			return models.ProxyModeNone
		}(),
	}

	if err := h.db.Model(instance).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar proxy"})
	}

	// Auto-test if enabled
	if req.Enabled {
		go h.runProxyTest(instance.ID.String(), &whatsapp.ProxyConfig{
			Enabled:  true,
			Type:     req.Type,
			Host:     req.Host,
			Port:     req.Port,
			Username: req.Username,
			Password: req.Password,
		})
	}

	// Reconnect if instance is running
	var fresh models.Instance
	if err := h.db.First(&fresh, "id = ?", instance.ID).Error; err == nil {
		if h.manager.IsRunning(instance.ID.String()) {
			go func() {
				_ = h.manager.RestartWithProxy(&fresh)
			}()
		}
	}

	return c.JSON(fiber.Map{
		"proxy_status": models.ProxyStatusUntested,
		"message":      "Proxy configurado. Testando conectividade em background...",
	})
}

// Test godoc
// POST /instances/:id/proxy/test
func (h *ProxyHandler) Test(c *fiber.Ctx) error {
	if err := checkProxyPlanAccess(c); err != nil {
		return err
	}

	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req proxyConfigRequest
	_ = c.BodyParser(&req) // Optional body

	var cfg *whatsapp.ProxyConfig

	if req.Host != "" {
		// Test with provided config (without saving)
		cfg = &whatsapp.ProxyConfig{
			Enabled:  true,
			Type:     req.Type,
			Host:     req.Host,
			Port:     req.Port,
			Username: req.Username,
			Password: req.Password,
		}
	} else if instance.ProxyEnabled {
		// Test existing saved proxy
		password := ""
		if instance.ProxyPassword != "" {
			dec, err := whatsapp.DecryptProxyPassword(instance.ProxyPassword)
			if err == nil {
				password = dec
			}
		}
		cfg = &whatsapp.ProxyConfig{
			Enabled:  true,
			Type:     string(instance.ProxyType),
			Host:     instance.ProxyHost,
			Port:     instance.ProxyPort,
			Username: instance.ProxyUsername,
			Password: password,
		}
	} else {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nenhum proxy configurado para testar"})
	}

	now := time.Now()
	externalIP, latencyMs, err := whatsapp.TestProxy(cfg)

	if err != nil {
		// Persist failure if testing saved proxy
		if req.Host == "" {
			h.db.Model(instance).Updates(map[string]interface{}{
				"proxy_status":      models.ProxyStatusFailed,
				"proxy_last_tested": now,
				"proxy_error":       err.Error(),
				"proxy_external_ip": "",
			})
		}
		return c.JSON(fiber.Map{
			"success":   false,
			"error":     err.Error(),
			"tested_at": now,
		})
	}

	// Persist success if testing saved proxy
	if req.Host == "" {
		h.db.Model(instance).Updates(map[string]interface{}{
			"proxy_status":      models.ProxyStatusOK,
			"proxy_last_tested": now,
			"proxy_error":       "",
			"proxy_external_ip": externalIP,
		})
	}

	return c.JSON(fiber.Map{
		"success":    true,
		"external_ip": externalIP,
		"latency_ms": latencyMs,
		"tested_at":  now,
	})
}

// Delete godoc
// DELETE /instances/:id/proxy
func (h *ProxyHandler) Delete(c *fiber.Ctx) error {
	if err := checkProxyPlanAccess(c); err != nil {
		return err
	}

	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if err := h.db.Model(instance).Updates(map[string]interface{}{
		"proxy_enabled":     false,
		"proxy_mode":        models.ProxyModeNone,
		"proxy_type":        "",
		"proxy_host":        "",
		"proxy_port":        0,
		"proxy_username":    "",
		"proxy_password":    "",
		"proxy_status":      models.ProxyStatusUntested,
		"proxy_last_tested": nil,
		"proxy_error":       "",
		"proxy_external_ip": "",
		// Limpa todas as origens herdadas para evitar estado inconsistente
		"use_global_proxy": false,
		"global_proxy_id":  nil,
		"proxy_pool_id":    nil,
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao remover proxy"})
	}

	// Restart without proxy if running
	var fresh models.Instance
	if err := h.db.First(&fresh, "id = ?", instance.ID).Error; err == nil {
		if h.manager.IsRunning(instance.ID.String()) {
			go func() {
				_ = h.manager.RestartWithProxy(&fresh)
			}()
		}
	}

	return c.JSON(fiber.Map{"message": "Proxy removido. Instância usará conexão direta."})
}

func (h *ProxyHandler) runProxyTest(instanceID string, cfg *whatsapp.ProxyConfig) {
	now := time.Now()
	externalIP, _, err := whatsapp.TestProxy(cfg)

	updates := map[string]interface{}{
		"proxy_last_tested": now,
	}

	if err != nil {
		updates["proxy_status"] = models.ProxyStatusFailed
		updates["proxy_error"] = err.Error()
		updates["proxy_external_ip"] = ""
	} else {
		updates["proxy_status"] = models.ProxyStatusOK
		updates["proxy_error"] = ""
		updates["proxy_external_ip"] = externalIP
	}

	h.db.Model(&models.Instance{}).Where("id = ?", instanceID).Updates(updates)
}
