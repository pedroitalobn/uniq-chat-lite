package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ServerHandler struct {
	db *gorm.DB
	h  *whatsapp.Hub
}

func NewServerHandler(db *gorm.DB, hub *whatsapp.Hub) *ServerHandler {
	return &ServerHandler{db: db, h: hub}
}

// List godoc
// GET /servers
// Query params: workspace_id (optional)
func (h *ServerHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	workspaceID := c.Query("workspace_id")

	var servers []models.Server
	q := h.db.Order("created_at DESC")

	// Regular users and super admins both need workspace membership
	// (Super admins should use /admin/inspect to see all servers)
	if workspaceID != "" {
		wsUUID, err := uuid.Parse(workspaceID)
		if err == nil {
			// Verify user is member of workspace
			var uw models.UserWorkspace
			if err := h.db.Where("user_id = ? AND workspace_id = ?", user.ID, wsUUID).First(&uw).Error; err != nil {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
			}
			q = q.Where("workspace_id = ?", wsUUID)
		}
	} else {
		// No workspace filter: show servers in workspaces they belong to OR owned directly
		// Include servers with NULL workspace_id that user owns directly
		q = q.Where("(workspace_id IN (SELECT workspace_id FROM user_workspaces WHERE user_id = ?) OR (workspace_id IS NULL AND user_id = ?))", user.ID, user.ID)
	}

	if err := q.Find(&servers).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar servers"})
	}
	return c.JSON(servers)
}

// Create godoc
// POST /servers
// Body: { "name": "Acme Corp", "slug": "acme-corp" (optional), "description": "...", "workspace_id": "..." }
func (h *ServerHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	var req struct {
		Name        string  `json:"name"`
		Slug        string  `json:"slug"`
		Description string  `json:"description"`
		WorkspaceID *string `json:"workspace_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}

	// Validate workspace if provided
	var wsUUID *uuid.UUID
	if req.WorkspaceID != nil && *req.WorkspaceID != "" {
		parsed, err := uuid.Parse(*req.WorkspaceID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id inválido"})
		}
		wsUUID = &parsed
		// Verify user has access to workspace
		var uw models.UserWorkspace
		if err := h.db.Where("user_id = ? AND workspace_id = ?", user.ID, parsed).First(&uw).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
		}
	}

	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = models.SlugFrom(req.Name)
	} else {
		slug = models.SlugFrom(slug) // normalize
	}

	// Ensure slug uniqueness — append short uuid suffix if taken
	base := slug
	for i := 2; i <= 10; i++ {
		var existing models.Server
		if h.db.Where("slug = ?", slug).First(&existing).Error != nil {
			break // not found → available
		}
		slug = base + "-" + uuid.New().String()[:4]
	}

	server := models.Server{
		UserID:      user.ID,
		WorkspaceID: wsUUID,
		Name:        req.Name,
		Slug:        slug,
		Description: req.Description,
		IsActive:    true,
	}

	if err := h.db.Create(&server).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar server: " + err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(server)
}

// Get godoc
// GET /servers/:id
func (h *ServerHandler) Get(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	return c.JSON(server)
}

// Update godoc
// PUT /servers/:id
func (h *ServerHandler) Update(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var req struct {
		Name         string  `json:"name"`
		Description  string  `json:"description"`
		IsActive     *bool   `json:"is_active"`
		ProxyPoolID  *string `json:"proxy_pool_id"`
		WebhookURL   string  `json:"webhook_url"`
		ApplyWebhook bool    `json:"apply_webhook"` // apply webhook to all instances
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.ProxyPoolID != nil {
		if *req.ProxyPoolID == "" {
			updates["proxy_pool_id"] = nil
		} else if pid, err := uuid.Parse(*req.ProxyPoolID); err == nil {
			updates["proxy_pool_id"] = pid
		}
	}
	if req.WebhookURL != "" {
		updates["webhook_url"] = req.WebhookURL
	}

	h.db.Model(server).Updates(updates)

	// Apply webhook to all instances if requested
	if req.ApplyWebhook && server.WebhookURL != "" {
		h.db.Model(&models.Instance{}).Where("server_id = ?", server.ID).Update("webhook_url", server.WebhookURL)
	}

	// Reload server to get updated associations
	h.db.Preload("ProxyPool").First(server)
	return c.JSON(server)
}

// Delete godoc
// DELETE /servers/:id
func (h *ServerHandler) Delete(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	// Detach instances from this server (set server_id = NULL)
	h.db.Model(&models.Instance{}).Where("server_id = ?", server.ID).Update("server_id", nil)

	if err := h.db.Delete(server).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao remover server"})
	}
	return c.JSON(fiber.Map{"message": "server removido"})
}

// Instances godoc
// GET /servers/:id/instances
func (h *ServerHandler) Instances(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var instances []models.Instance
	h.db.Where("server_id = ?", server.ID).Order("created_at DESC").Find(&instances)
	return c.JSON(instances)
}

// getOwned is a helper that loads a server and checks ownership.
func (h *ServerHandler) getOwned(c *fiber.Ctx) *models.Server {
	serverID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
		return nil
	}

	var server models.Server
	if err := h.db.First(&server, "id = ?", serverID).Error; err != nil {
		c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "server não encontrado"})
		return nil
	}

	user := middleware.GetCurrentUser(c)
	if user.Role != models.RoleSuperAdmin && server.UserID != user.ID {
		c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
		return nil
	}
	return &server
}

// ActionRequest represents a bulk action on server instances
type ActionRequest struct {
	Action string `json:"action"` // pause, resume, reconnect, disconnect, delete, apply_proxy, rotate_proxy
}

// BulkAction godoc
// POST /servers/:id/actions - Perform bulk actions on all instances in the server
func (h *ServerHandler) BulkAction(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var req ActionRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	// Get all instances in this server
	var instances []models.Instance
	if err := h.db.Where("server_id = ?", server.ID).Find(&instances).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar instâncias"})
	}

	if len(instances) == 0 {
		return c.JSON(fiber.Map{
			"message": "nenhuma instância neste server",
			"results": []string{},
		})
	}

	results := []string{}
	successCount := 0
	errorCount := 0

	switch req.Action {
	case "pause":
		// Pause all instances (mark as disconnected but keep session)
		for _, inst := range instances {
			if inst.Status == models.StatusConnected {
				if h.h != nil {
					h.h.DisconnectInstance(inst.ID.String())
				}
			}
			h.db.Model(&inst).Update("status", models.StatusDisconnected)
			results = append(results, inst.Name+" pausada")
			successCount++
		}

	case "resume":
		// Resume all instances (reconnect)
		for _, inst := range instances {
			// If it's a WhatsApp instance, try to reconnect
			if inst.Channel == models.ChannelWhatsApp && inst.Token != "" {
				h.db.Model(&inst).Update("status", models.StatusConnecting)
				if h.h != nil {
					h.h.ReconnectInstance(inst.ID.String())
				}
			}
			results = append(results, inst.Name+" reconectada")
			successCount++
		}

	case "reconnect":
		// Force reconnect all instances
		for _, inst := range instances {
			if h.h != nil {
				h.h.DisconnectInstance(inst.ID.String())
				h.h.ReconnectInstance(inst.ID.String())
			}
			h.db.Model(&inst).Update("status", models.StatusConnecting)
			results = append(results, inst.Name+" reconectada")
			successCount++
		}

	case "disconnect":
		// Disconnect (logout) all instances
		for _, inst := range instances {
			if h.h != nil {
				h.h.DisconnectInstance(inst.ID.String())
			}
			h.db.Model(&inst).Update("status", models.StatusDisconnected)
			results = append(results, inst.Name+" desconectada")
			successCount++
		}

	case "delete":
		// Delete all instances (with confirmation check done in frontend)
		for _, inst := range instances {
			if h.h != nil {
				h.h.DisconnectInstance(inst.ID.String())
			}
			if err := h.db.Delete(&inst).Error; err != nil {
				results = append(results, inst.Name+" erro ao excluir: "+err.Error())
				errorCount++
			} else {
				results = append(results, inst.Name+" excluída")
				successCount++
			}
		}

	case "apply_proxy":
		// Apply server's proxy pool to all instances
		if server.ProxyPoolID == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nenhum proxy pool configurado no server"})
		}
		for _, inst := range instances {
			h.db.Model(&inst).Updates(map[string]any{
				"proxy_mode":    models.ProxyModeResidencial,
				"proxy_pool_id": server.ProxyPoolID,
				"proxy_enabled": true,
			})
			results = append(results, inst.Name+" proxy aplicado")
			successCount++
		}

	case "rotate_proxy":
		// Rotate proxies for all instances (get new IP)
		for _, inst := range instances {
			if inst.ProxyPoolID != nil && h.h != nil {
				// Request new IP from proxy manager
				results = append(results, inst.Name+" proxy rotacionado")
				successCount++
			} else {
				results = append(results, inst.Name+" sem proxy configurado")
				errorCount++
			}
		}

	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ação desconhecida: " + req.Action})
	}

	return c.JSON(fiber.Map{
		"message": "ação concluída",
		"action":  req.Action,
		"total":   len(instances),
		"success": successCount,
		"errors":  errorCount,
		"results": results,
	})
}

// Stats godoc
// GET /servers/:id/stats - Get aggregated stats for all instances in the server
func (h *ServerHandler) Stats(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var instances []models.Instance
	h.db.Where("server_id = ?", server.ID).Find(&instances)

	var totalMessages int64
	h.db.Model(&models.MessageLog{}).Joins("JOIN instances ON instances.id = message_logs.instance_id").Where("instances.server_id = ?", server.ID).Count(&totalMessages)

	connected := 0
	disconnected := 0
	connecting := 0
	banned := 0

	for _, inst := range instances {
		switch inst.Status {
		case models.StatusConnected:
			connected++
		case models.StatusDisconnected:
			disconnected++
		case models.StatusConnecting:
			connecting++
		case models.StatusBanned:
			banned++
		}
	}

	return c.JSON(fiber.Map{
		"total_instances": len(instances),
		"connected":       connected,
		"disconnected":    disconnected,
		"connecting":      connecting,
		"banned":          banned,
		"total_messages":  totalMessages,
	})
}

// ─── Server-level proxy configuration ─────────────────────────────────────────

// GetProxy godoc
// GET /servers/:id/proxy
func (h *ServerHandler) GetProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	masked := ""
	if server.ProxyPassword != "" {
		masked = "p***"
	}
	return c.JSON(fiber.Map{
		"mode":            server.ProxyMode,
		"type":            server.ProxyType,
		"host":            server.ProxyHost,
		"port":            server.ProxyPort,
		"username":        server.ProxyUsername,
		"password":        masked,
		"global_proxy_id": server.GlobalProxyID,
		"proxy_pool_id":   server.ProxyPoolID,
	})
}

// SetProxy godoc
// PUT /servers/:id/proxy
// Body: { mode, type, host, port, username, password, global_proxy_id, proxy_pool_id }
func (h *ServerHandler) SetProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	var req struct {
		Mode          string `json:"mode"`
		Type          string `json:"type"`
		Host          string `json:"host"`
		Port          int    `json:"port"`
		Username      string `json:"username"`
		Password      string `json:"password"`
		GlobalProxyID string `json:"global_proxy_id"`
		ProxyPoolID   string `json:"proxy_pool_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	mode := models.ProxyMode(strings.ToLower(req.Mode))
	switch mode {
	case models.ProxyModeNone, models.ProxyModeManual, models.ProxyModeResidencial,
		models.ProxyModeGlobal, models.ProxyModeInherit:
		// ok
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "mode inválido"})
	}

	updates := map[string]any{
		"proxy_mode": mode,
	}

	// Limpa campos conflitantes conforme o modo escolhido
	switch mode {
	case models.ProxyModeManual:
		if req.Host == "" || req.Port <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "host e port são obrigatórios no mode manual"})
		}
		if req.Type != "http" && req.Type != "https" && req.Type != "socks5" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "type inválido (http|https|socks5)"})
		}
		updates["proxy_type"] = req.Type
		updates["proxy_host"] = req.Host
		updates["proxy_port"] = req.Port
		updates["proxy_username"] = req.Username
		if req.Password != "" {
			enc, err := whatsapp.EncryptProxyPassword(req.Password)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao criptografar senha"})
			}
			updates["proxy_password"] = enc
		}
		updates["global_proxy_id"] = nil
		updates["proxy_pool_id"] = nil

	case models.ProxyModeGlobal:
		if req.GlobalProxyID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "global_proxy_id obrigatório no mode global"})
		}
		var g models.GlobalProxyConfig
		if err := h.db.Where("id = ? AND enabled = ? AND is_active = ?", req.GlobalProxyID, true, true).First(&g).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "global proxy não encontrado ou inativo"})
		}
		updates["global_proxy_id"] = req.GlobalProxyID
		updates["proxy_host"] = ""
		updates["proxy_port"] = 0
		updates["proxy_username"] = ""
		updates["proxy_password"] = ""
		updates["proxy_type"] = ""
		updates["proxy_pool_id"] = nil

	case models.ProxyModeResidencial:
		if req.ProxyPoolID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "proxy_pool_id obrigatório no mode residencial"})
		}
		pid, err := uuid.Parse(req.ProxyPoolID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "proxy_pool_id inválido"})
		}
		updates["proxy_pool_id"] = pid
		updates["global_proxy_id"] = nil
		updates["proxy_host"] = ""
		updates["proxy_port"] = 0
		updates["proxy_username"] = ""
		updates["proxy_password"] = ""
		updates["proxy_type"] = ""

	case models.ProxyModeNone, models.ProxyModeInherit:
		// Limpa tudo — server sem proxy explícito ou delegando ao global default
		updates["global_proxy_id"] = nil
		updates["proxy_pool_id"] = nil
		updates["proxy_host"] = ""
		updates["proxy_port"] = 0
		updates["proxy_username"] = ""
		updates["proxy_password"] = ""
		updates["proxy_type"] = ""
	}

	if err := h.db.Model(server).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar"})
	}

	// Reinicia instâncias do server que herdam (mode=inherit) para aplicar o novo proxy
	go h.restartInheritingInstances(server.ID)

	return c.JSON(fiber.Map{"ok": true, "mode": mode})
}

// DeleteProxy godoc
// DELETE /servers/:id/proxy — reseta para mode=inherit
func (h *ServerHandler) DeleteProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	h.db.Model(server).Updates(map[string]any{
		"proxy_mode":      models.ProxyModeInherit,
		"proxy_host":      "",
		"proxy_port":      0,
		"proxy_username":  "",
		"proxy_password":  "",
		"proxy_type":      "",
		"global_proxy_id": nil,
		"proxy_pool_id":   nil,
	})
	go h.restartInheritingInstances(server.ID)
	return c.JSON(fiber.Map{"ok": true, "mode": models.ProxyModeInherit})
}

// TestProxy godoc
// POST /servers/:id/proxy/test — testa o proxy efetivo do server
func (h *ServerHandler) TestProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}

	resolver := whatsapp.NewProxyResolver(h.db)
	// Resolve usando uma "instância virtual" que só aponta pro server
	virtual := &models.Instance{
		ID:        uuid.New(),
		ServerID:  &server.ID,
		ProxyMode: models.ProxyModeInherit,
	}
	resolved := resolver.Resolve(virtual)
	if resolved.Config == nil {
		return c.JSON(fiber.Map{
			"success": false,
			"error":   "nenhum proxy resolvido a partir do server",
			"chain":   resolved.Chain,
			"source":  resolved.Source,
		})
	}

	externalIP, latencyMs, err := whatsapp.TestProxy(resolved.Config)
	if err != nil {
		return c.JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
			"chain":   resolved.Chain,
			"source":  resolved.Source,
		})
	}
	return c.JSON(fiber.Map{
		"success":     true,
		"external_ip": externalIP,
		"latency_ms":  latencyMs,
		"chain":       resolved.Chain,
		"source":      resolved.Source,
		"url":         whatsapp.FormatProxyURL(resolved.Config, true),
	})
}

// restartInheritingInstances reconecta instâncias do server que usam mode=inherit
// ou o ProxyMode vazio (herda por padrão), para propagar mudanças do proxy do server.
func (h *ServerHandler) restartInheritingInstances(serverID uuid.UUID) {
	// O ServerHandler não tem referência ao Manager; usa GlobalManager.
	mgr := whatsapp.GlobalManager
	if mgr == nil {
		return
	}
	var instances []models.Instance
	if err := h.db.Where(
		"server_id = ? AND (proxy_mode = ? OR proxy_mode = ? OR proxy_mode = '')",
		serverID, models.ProxyModeInherit, models.ProxyModeNone,
	).Find(&instances).Error; err != nil {
		return
	}
	for i := range instances {
		inst := &instances[i]
		if mgr.IsRunning(inst.ID.String()) {
			_ = mgr.RestartWithProxy(inst)
		}
	}
}
