package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
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

// ─── Catálogo de Proxies (user + platform) ──────────────────────────────
// Retorna proxies visíveis pro usuário: is_platform=true (disponíveis pra
// todos) + is_platform=false com owner_id=user (proxies custom do usuário).

func (h *ProxyHandler) ListAvailable(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var proxies []models.Proxy
	if err := h.db.Where("is_platform = ? OR owner_id = ?", true, user.ID).
		Where("is_active = ?", true).
		Order("is_platform DESC, name ASC").
		Find(&proxies).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao listar proxies"})
	}
	return c.JSON(summarizeProxies(proxies))
}

func (h *ProxyHandler) ListMine(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var proxies []models.Proxy
	if err := h.db.Where("owner_id = ?", user.ID).Order("created_at DESC").Find(&proxies).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao listar proxies"})
	}
	return c.JSON(summarizeProxies(proxies))
}

func (h *ProxyHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if err := checkProxyPlanAccess(c); err != nil {
		return err
	}
	var req proxyCreateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Name == "" || req.Host == "" || req.Port <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, host e port são obrigatórios"})
	}
	pType := req.ProxyType
	if pType == "" {
		pType = "http"
	}
	country := req.Country
	if country == "" {
		country = "br"
	}
	ownerID := user.ID
	p := models.Proxy{
		OwnerID:    &ownerID,
		IsPlatform: false,
		Name:       req.Name,
		Country:    country,
		Provider:   "custom",
		ProxyType:  pType,
		Host:       req.Host,
		Port:       req.Port,
		Username:   req.Username,
		IsActive:   true,
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
	return c.Status(fiber.StatusCreated).JSON(summarizeProxy(&p))
}

func (h *ProxyHandler) Update(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.Proxy
	if err := h.db.First(&p, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}
	if !p.EditableBy(user.ID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão"})
	}
	var req proxyCreateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Country != "" {
		updates["country"] = req.Country
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
	if len(updates) > 0 {
		if err := h.db.Model(&p).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar"})
		}
	}
	// Reinicia instâncias cujo server usa este proxy, pra aplicar mudanças
	go restartServersUsingProxy(h.db, h.manager, p.ID)
	_ = h.db.First(&p, "id = ?", id).Error
	return c.JSON(summarizeProxy(&p))
}

func (h *ProxyHandler) Delete(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.Proxy
	if err := h.db.First(&p, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}
	if !p.EditableBy(user.ID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão"})
	}
	// Detach servers pointing here
	h.db.Model(&models.Server{}).Where("proxy_id = ?", id).Update("proxy_id", nil)
	if err := h.db.Delete(&p).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao remover"})
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *ProxyHandler) Test(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.Proxy
	if err := h.db.First(&p, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}
	if !p.VisibleTo(user.ID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão"})
	}
	cfg, source, ok := whatsapp.BuildProxyConfigExported(&p)
	if !ok {
		return c.JSON(fiber.Map{"success": false, "error": "host/porta vazios", "source": source})
	}
	externalIP, latencyMs, err := whatsapp.TestProxy(cfg)
	if err != nil {
		return c.JSON(fiber.Map{"success": false, "error": err.Error(), "source": source})
	}
	return c.JSON(fiber.Map{
		"success":     true,
		"external_ip": externalIP,
		"latency_ms":  latencyMs,
		"source":      source,
	})
}

// ─── Visão read-only pra uma instância ──────────────────────────────────
// A UI da instância mostra qual proxy ela está usando (e de qual server).
// Pra alterar, o usuário vai até o server.

// Effective godoc
// GET /instances/:id/proxy/effective
func (h *ProxyHandler) Effective(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	resolved := h.manager.ResolveEffectiveProxyDetailed(instance)

	resp := fiber.Map{
		"instance_id": instance.ID,
		"running":     h.manager.IsRunning(instance.ID.String()),
		"server_id":   instance.ServerID,
		"level":       resolved.Level,
		"chain":       resolved.Chain,
		"source":      resolved.Source,
	}
	if resolved.Config == nil {
		resp["effective"] = nil
		resp["note"] = "conexão direta (sem proxy)"
		return c.JSON(resp)
	}
	// Se veio de plataforma, ocultar host/port/user
	if resolved.Source == "platform" || resolved.Source == "platform_env" {
		resp["effective"] = fiber.Map{
			"enabled": resolved.Config.Enabled,
			"type":    resolved.Config.Type,
			"managed": true,
			"note":    "proxy gerenciado pela plataforma",
		}
	} else {
		resp["effective"] = fiber.Map{
			"enabled":  resolved.Config.Enabled,
			"type":     resolved.Config.Type,
			"host":     resolved.Config.Host,
			"port":     resolved.Config.Port,
			"username": resolved.Config.Username,
		}
	}
	return c.JSON(resp)
}

// Get godoc
// GET /instances/:id/proxy
// Read-only: retorna metadados do proxy que a instância usa (vem do server).
func (h *ProxyHandler) Get(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if instance.ServerID == nil {
		return c.JSON(fiber.Map{"has_proxy": false, "note": "instância sem server"})
	}
	var srv models.Server
	if err := h.db.Preload("Proxy").First(&srv, "id = ?", *instance.ServerID).Error; err != nil {
		return c.JSON(fiber.Map{"has_proxy": false})
	}
	if srv.ProxyID == nil || srv.Proxy == nil {
		return c.JSON(fiber.Map{
			"has_proxy":   false,
			"server_id":   srv.ID,
			"server_name": srv.Name,
			"note":        "o server dessa instância não tem proxy configurado",
		})
	}
	p := srv.Proxy
	resp := fiber.Map{
		"has_proxy":   true,
		"server_id":   srv.ID,
		"server_name": srv.Name,
		"country":     p.Country,
		"type":        p.ProxyType,
		"is_platform": p.IsPlatform,
		"name":        p.Name,
	}
	if !p.IsPlatform {
		// User owns (or shares via workspace) — mostra host/port/user
		resp["host"] = p.Host
		resp["port"] = p.Port
		resp["username"] = p.Username
	} else {
		resp["managed"] = true
	}
	return c.JSON(resp)
}

// ─── Helpers ─────────────────────────────────────────────────────────────

type proxyCreateRequest struct {
	Name      string `json:"name"`
	Country   string `json:"country"`
	ProxyType string `json:"proxy_type"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
}

func summarizeProxy(p *models.Proxy) fiber.Map {
	m := fiber.Map{
		"id":          p.ID,
		"name":        p.Name,
		"country":     p.Country,
		"type":        p.ProxyType,
		"is_platform": p.IsPlatform,
		"is_active":   p.IsActive,
		"created_at":  p.CreatedAt,
	}
	if !p.IsPlatform {
		m["host"] = p.Host
		m["port"] = p.Port
		m["username"] = p.Username
		m["has_password"] = p.Password != ""
	}
	return m
}

func summarizeProxies(ps []models.Proxy) []fiber.Map {
	out := make([]fiber.Map, len(ps))
	for i := range ps {
		out[i] = summarizeProxy(&ps[i])
	}
	return out
}

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

// restartServersUsingProxy reinicia as instâncias dos servers que usam um
// proxy específico, pra aplicar mudanças de credenciais.
func restartServersUsingProxy(db *gorm.DB, manager *whatsapp.Manager, proxyID uuid.UUID) {
	if manager == nil {
		return
	}
	var serverIDs []uuid.UUID
	db.Model(&models.Server{}).Where("proxy_id = ?", proxyID).Pluck("id", &serverIDs)
	if len(serverIDs) == 0 {
		return
	}
	var instances []models.Instance
	if err := db.Where("server_id IN ?", serverIDs).Find(&instances).Error; err != nil {
		return
	}
	for i := range instances {
		inst := &instances[i]
		if !manager.IsRunning(inst.ID.String()) {
			continue
		}
		if err := manager.RestartWithProxy(inst); err != nil {
			log.Warn().Err(err).Str("instance", inst.ID.String()).Msg("failed to restart instance on proxy update")
		}
	}
}

// maskedProxyURL é mantido pra compat (outros lugares podem importar).
func maskedProxyURL(cfg *whatsapp.ProxyConfig) string {
	if cfg == nil || !cfg.Enabled {
		return ""
	}
	auth := ""
	if cfg.Username != "" {
		mask := ""
		if cfg.Password != "" {
			mask = ":***"
		}
		auth = cfg.Username + mask + "@"
	}
	return cfg.Type + "://" + auth + cfg.Host + ":" + strconv.Itoa(cfg.Port)
}
