package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

// ResidencialProxyHandler manages residential proxy pool endpoints.
type ResidencialProxyHandler struct {
	db *gorm.DB
	pm *services.ProxyManager
}

func NewResidencialProxyHandler(db *gorm.DB, pm *services.ProxyManager) *ResidencialProxyHandler {
	return &ResidencialProxyHandler{db: db, pm: pm}
}

// checkProxyResidencialAccess validates the user's plan allows residential proxy.
func (h *ResidencialProxyHandler) checkProxyResidencialAccess(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user.Plan == nil || !user.Plan.AllowProxyResidencial {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error":   "seu plano não permite proxy residencial",
			"upgrade": "Faça upgrade para um plano com proxy residencial",
		})
	}
	return nil
}

// GET /proxy/pool — list proxy pool entries available to the user
func (h *ResidencialProxyHandler) ListPool(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	// Only admins can see the full pool; users see only their assignments
	if user.Role != "admin" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso restrito"})
	}

	var pools []models.ProxyPool
	h.db.Order("current_instances DESC").Find(&pools)
	return c.JSON(pools)
}

// GET /proxy/my-proxy — get the proxy config assigned to a specific instance
func (h *ResidencialProxyHandler) GetInstanceProxy(c *fiber.Ctx) error {
	if err := h.checkProxyResidencialAccess(c); err != nil {
		return err
	}

	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if instance.ProxyMode != models.ProxyModeResidencial {
		return c.JSON(fiber.Map{
			"mode": instance.ProxyMode,
			"host": nil,
			"port": nil,
		})
	}

	// Get proxy from pool
	var proxy models.ProxyPool
	if instance.ProxyPoolID == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "nenhum proxy vinculado"})
	}

	if err := h.db.First(&proxy, *instance.ProxyPoolID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "proxy não encontrado"})
	}

	return c.JSON(fiber.Map{
		"mode":        "residencial",
		"provider":    proxy.Provider,
		"country":     proxy.Country,
		"host":        proxy.Host,
		"port":        proxy.Port,
		"username":    proxy.Username,
		"status":      instance.ProxyStatus,
		"external_ip": instance.ProxyExternalIP,
		"session_id":  proxy.SessionID,
	})
}

// POST /proxy/assign/:id — assign a residential proxy to an instance
func (h *ResidencialProxyHandler) AssignProxy(c *fiber.Ctx) error {
	if err := h.checkProxyResidencialAccess(c); err != nil {
		return err
	}

	user := middleware.GetCurrentUser(c)
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	// Verify ownership
	if instance.UserID != user.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	proxy, err := h.pm.AssignProxy(instance.ID, user.Plan)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"mode":       "residencial",
		"proxy_id":   proxy.ID,
		"session_id": proxy.SessionID,
		"host":       proxy.Host,
		"port":       proxy.Port,
		"username":   proxy.Username,
		"country":    proxy.Country,
	})
}

// DELETE /proxy/release/:id — release an instance from its residential proxy
func (h *ResidencialProxyHandler) ReleaseProxy(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if instance.UserID != user.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	if err := h.pm.ReleaseProxy(instance.ID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"message": "Proxy residencial removido da instância"})
}

// GET /proxy/stats — get proxy pool stats for observability
func (h *ResidencialProxyHandler) GetPoolStats(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	stats := h.pm.GetPoolStats(user.ID)
	return c.JSON(stats)
}

// PUT /proxy/mode/:id — change instance proxy mode (none | manual | residencial)
func (h *ResidencialProxyHandler) SetProxyMode(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if instance.UserID != user.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}

	var req struct {
		Mode string `json:"mode"` // none | manual | residencial
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	oldMode := instance.ProxyMode
	newMode := models.ProxyMode(req.Mode)

	// If switching away from residencial, release the proxy
	if oldMode == models.ProxyModeResidencial && newMode != models.ProxyModeResidencial {
		h.pm.ReleaseProxy(instance.ID)
	}

	// If switching to residencial, assign a proxy
	if newMode == models.ProxyModeResidencial && oldMode != models.ProxyModeResidencial {
		if user.Plan == nil || !user.Plan.AllowProxyResidencial {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "seu plano não permite proxy residencial"})
		}
		proxy, err := h.pm.AssignProxy(instance.ID, user.Plan)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{
			"mode":       "residencial",
			"proxy_id":   proxy.ID,
			"session_id": proxy.SessionID,
			"host":       proxy.Host,
			"port":       proxy.Port,
		})
	}

	// If switching to none, clear proxy fields
	if newMode == models.ProxyModeNone {
		h.db.Model(instance).Updates(map[string]interface{}{
			"proxy_mode":        models.ProxyModeNone,
			"proxy_enabled":     false,
			"proxy_pool_id":     nil,
			"proxy_host":        "",
			"proxy_port":        0,
			"proxy_username":    "",
			"proxy_password":    "",
			"proxy_status":      models.ProxyStatusUntested,
			"proxy_last_tested": nil,
			"proxy_error":       "",
			"proxy_external_ip": "",
		})
	}

	return c.JSON(fiber.Map{"mode": newMode})
}
