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
// resolveDefaultWorkspaceID devolve o workspace padrão do usuário — o primeiro
// onde ele é owner. Se o usuário não tem workspace ainda (cenário legado),
// retorna uuid.Nil e o caller deixa workspace_id como NULL.
func resolveDefaultWorkspaceID(db *gorm.DB, userID uuid.UUID) uuid.UUID {
	var uw models.UserWorkspace
	if err := db.Where("user_id = ? AND is_owner = ?", userID, true).
		Order("joined_at ASC").First(&uw).Error; err == nil {
		return uw.WorkspaceID
	}
	// Fallback: qualquer workspace em que o usuário está
	if err := db.Where("user_id = ?", userID).
		Order("joined_at ASC").First(&uw).Error; err == nil {
		return uw.WorkspaceID
	}
	return uuid.Nil
}

func (h *ServerHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	workspaceID := c.Query("workspace_id")

	var servers []models.Server
	q := h.db.Preload("Proxy").Order("created_at DESC")

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

	// Validate workspace if provided, else fall back to the user's default.
	var wsUUID *uuid.UUID
	if req.WorkspaceID != nil && *req.WorkspaceID != "" {
		parsed, err := uuid.Parse(*req.WorkspaceID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id inválido"})
		}
		wsUUID = &parsed
		var uw models.UserWorkspace
		if err := h.db.Where("user_id = ? AND workspace_id = ?", user.ID, parsed).First(&uw).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
		}
	} else {
		if def := resolveDefaultWorkspaceID(h.db, user.ID); def != uuid.Nil {
			wsUUID = &def
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
		Name         string `json:"name"`
		Description  string `json:"description"`
		IsActive     *bool  `json:"is_active"`
		WebhookURL   string `json:"webhook_url"`
		ApplyWebhook bool   `json:"apply_webhook"` // apply webhook to all instances
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
	if req.WebhookURL != "" {
		updates["webhook_url"] = req.WebhookURL
	}

	h.db.Model(server).Updates(updates)

	if req.ApplyWebhook && server.WebhookURL != "" {
		h.db.Model(&models.Instance{}).Where("server_id = ?", server.ID).Update("webhook_url", server.WebhookURL)
	}

	h.db.Preload("Proxy").First(server)
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
	if err := h.db.Preload("Proxy").First(&server, "id = ?", serverID).Error; err != nil {
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
//
// Toda instância do server herda o proxy configurado aqui. O server aponta
// para exatamente um Proxy do catálogo (models.Proxy) via ProxyID, ou nenhum
// (nil) pra conexão direta. Não há mais modos manual/global/residencial/inherit
// — só "tem um proxy" ou "não tem".

// GetProxy godoc
// GET /servers/:id/proxy
func (h *ServerHandler) GetProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	if server.ProxyID == nil {
		return c.JSON(fiber.Map{"has_proxy": false})
	}
	var p models.Proxy
	if err := h.db.First(&p, "id = ?", *server.ProxyID).Error; err != nil {
		return c.JSON(fiber.Map{"has_proxy": false, "error": "proxy referenciado não encontrado"})
	}
	resp := fiber.Map{
		"has_proxy":   true,
		"proxy_id":    p.ID,
		"name":        p.Name,
		"country":     p.Country,
		"type":        p.ProxyType,
		"is_platform": p.IsPlatform,
		"is_active":   p.IsActive,
	}
	if !p.IsPlatform {
		resp["host"] = p.Host
		resp["port"] = p.Port
		resp["username"] = p.Username
	}
	return c.JSON(resp)
}

// SetProxy godoc
// PUT /servers/:id/proxy
// Body: { proxy_id: uuid | null }
// Aponta o server pra um Proxy do catálogo (plataforma ou custom do usuário),
// ou limpa com null pra "sem proxy".
func (h *ServerHandler) SetProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	user := middleware.GetCurrentUser(c)

	var req struct {
		ProxyID *string `json:"proxy_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	if req.ProxyID == nil || *req.ProxyID == "" {
		h.db.Model(server).Update("proxy_id", nil)
		go h.restartServerInstances(server.ID)
		return c.JSON(fiber.Map{"ok": true, "has_proxy": false})
	}

	pid, err := uuid.Parse(*req.ProxyID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "proxy_id inválido"})
	}
	var p models.Proxy
	if err := h.db.First(&p, "id = ? AND is_active = ?", pid, true).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "proxy não encontrado ou inativo"})
	}
	if !p.VisibleTo(user.ID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão pra usar este proxy"})
	}

	h.db.Model(server).Update("proxy_id", pid)
	go h.restartServerInstances(server.ID)
	return c.JSON(fiber.Map{"ok": true, "has_proxy": true, "proxy_id": pid})
}

// DeleteProxy godoc
// DELETE /servers/:id/proxy — remove o proxy do server (conexão direta)
func (h *ServerHandler) DeleteProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	h.db.Model(server).Update("proxy_id", nil)
	go h.restartServerInstances(server.ID)
	return c.JSON(fiber.Map{"ok": true, "has_proxy": false})
}

// TestProxy godoc
// POST /servers/:id/proxy/test — testa o proxy associado ao server
func (h *ServerHandler) TestProxy(c *fiber.Ctx) error {
	server := h.getOwned(c)
	if server == nil {
		return nil
	}
	if server.ProxyID == nil {
		return c.JSON(fiber.Map{"success": false, "error": "server não tem proxy configurado"})
	}
	var p models.Proxy
	if err := h.db.First(&p, "id = ?", *server.ProxyID).Error; err != nil {
		return c.JSON(fiber.Map{"success": false, "error": "proxy do server não encontrado"})
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
		"url":         whatsapp.FormatProxyURL(cfg, true),
	})
}

// restartServerInstances reconecta todas as instâncias do server pra aplicar
// a nova configuração de proxy no whatsmeow (que só muda em Disconnect+Connect).
func (h *ServerHandler) restartServerInstances(serverID uuid.UUID) {
	mgr := whatsapp.GlobalManager
	if mgr == nil {
		return
	}
	var instances []models.Instance
	if err := h.db.Where("server_id = ?", serverID).Find(&instances).Error; err != nil {
		return
	}
	for i := range instances {
		inst := &instances[i]
		if mgr.IsRunning(inst.ID.String()) {
			_ = mgr.RestartWithProxy(inst)
		}
	}
}
