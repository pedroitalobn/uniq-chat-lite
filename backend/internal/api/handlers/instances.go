package handlers

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type InstanceHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewInstanceHandler(db *gorm.DB, manager *whatsapp.Manager) *InstanceHandler {
	return &InstanceHandler{db: db, manager: manager}
}

// List godoc
// GET /instances
// Query params: workspace_id (optional)
func (h *InstanceHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	workspaceID := c.Query("workspace_id")

	var instances []models.Instance
	q := h.db.Preload("Server").Order("created_at DESC")

	// SuperAdmins can see all or filter by workspace
	if user.Role == models.RoleSuperAdmin {
		if workspaceID != "" {
			wsUUID, err := uuid.Parse(workspaceID)
			if err == nil {
				q = q.Where("workspace_id = ?", wsUUID)
			}
		}
	} else {
		// For regular users, check if they have workspace membership
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
			// No workspace filter: show owned instances OR instances in workspaces they belong to
			q = q.Where("user_id = ? OR workspace_id IN (SELECT workspace_id FROM user_workspaces WHERE user_id = ?)", user.ID, user.ID)
		}
	}

	if err := q.Find(&instances).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar instâncias"})
	}

	// Enrich with live status from the WhatsApp manager.
	for i := range instances {
		id := instances[i].ID.String()
		if h.manager.IsRunning(id) {
			client := h.manager.GetInstance(id)
			if client != nil && client.IsConnected() {
				instances[i].Status = models.StatusConnected
			} else if client != nil {
				// Running but not yet connected → keep as connecting
				instances[i].Status = models.StatusConnecting
			}
		} else {
			// Manager is NOT running for this instance.
			// If DB says "connecting", it's a stale state from a previous
			// failed reconnect — reset to disconnected so the frontend
			// can trigger a fresh reconnect.
			if instances[i].Status == models.StatusConnecting {
				instances[i].Status = models.StatusDisconnected
				h.db.Model(&instances[i]).Update("status", models.StatusDisconnected)
			}
		}
	}

	return c.JSON(instances)
}

// Create godoc
// POST /instances
// Body: { "name": "...", "server_id": "...", "token": "...", "channel": "...", "workspace_id": "..." }
func (h *InstanceHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var req struct {
		Name        string  `json:"name"`
		ServerID    string  `json:"server_id"`
		Token       string  `json:"token"`
		Channel     string  `json:"channel"`
		WorkspaceID *string `json:"workspace_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
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

	// Check plan limits
	if user.Plan != nil && !user.Plan.IsUnlimitedInstances() {
		var count int64
		h.db.Model(&models.Instance{}).Where("user_id = ?", user.ID).Count(&count)
		if int(count) >= user.Plan.MaxInstances {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "limite de instâncias atingido para o seu plano",
				"limit": user.Plan.MaxInstances,
			})
		}
	}

	channel := models.ChannelType(req.Channel)
	if channel == "" {
		channel = models.ChannelWhatsApp
	}
	switch channel {
	case models.ChannelWhatsApp, models.ChannelInstagram, models.ChannelTelegram, models.ChannelLinkedIn:
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "canal inválido: use whatsapp, instagram, telegram ou linkedin"})
	}

	instance := models.Instance{
		UserID:      user.ID,
		WorkspaceID: wsUUID,
		Name:        req.Name,
		Channel:     channel,
		Status:      models.StatusDisconnected,
	}

	// Link to server if provided (and accessible by user)
	if req.ServerID != "" {
		if sid, err := uuid.Parse(req.ServerID); err == nil {
			var srv models.Server
			// Check server ownership OR workspace membership
			if h.db.First(&srv, "id = ?", sid).Error == nil {
				// Server must be in same workspace or owned by user
				if srv.UserID == user.ID || (srv.WorkspaceID != nil && wsUUID != nil && *srv.WorkspaceID == *wsUUID) {
					instance.ServerID = &sid
				}
			}
		}
	}

	// Generate unique slug within the server scope
	baseSlug := models.SlugFrom(req.Name)
	slug := baseSlug
	for i := 2; i <= 50; i++ {
		q := h.db.Where("slug = ?", slug)
		if instance.ServerID != nil {
			q = q.Where("server_id = ?", *instance.ServerID)
		} else {
			q = q.Where("server_id IS NULL")
		}
		var existing models.Instance
		if q.First(&existing).Error != nil {
			break // available
		}
		slug = fmt.Sprintf("%s-%d", baseSlug, i)
	}
	instance.Slug = slug
	if req.Token != "" {
		instance.Token = req.Token
	} else {
		instance.Token = models.GenerateInstanceToken()
	}

	if err := h.db.Create(&instance).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar instância"})
	}

	return c.Status(fiber.StatusCreated).JSON(instance)
}

// Get godoc
// GET /instances/:id
func (h *InstanceHandler) Get(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	// Live status — only override DB when truly connected
	if h.manager.IsRunning(instance.ID.String()) {
		client := h.manager.GetInstance(instance.ID.String())
		if client != nil && client.IsConnected() {
			instance.Status = models.StatusConnected
		}
	}

	return c.JSON(instance)
}

// RegenerateToken godoc
// POST /instances/:id/regenerate-token
func (h *InstanceHandler) RegenerateToken(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	newToken := models.GenerateInstanceToken()
	if err := h.db.Model(instance).Update("token", newToken).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao regenerar token"})
	}
	instance.Token = newToken
	return c.JSON(fiber.Map{"token": newToken, "instance_id": instance.ID})
}

// Delete godoc
// DELETE /instances/:id
func (h *InstanceHandler) Delete(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	// Clear session data BEFORE stopping (while client still exists)
	if client := h.manager.GetInstance(instance.ID.String()); client != nil {
		client.ClearSession()
	}

	// Stop the WhatsApp connection
	h.manager.StopInstance(instance.ID.String())

	// Delete from database
	if err := h.db.Delete(instance).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar instância"})
	}

	return c.JSON(fiber.Map{"message": "instância removida com sucesso"})
}

// GetQR godoc
// GET /instances/:id/qr
func (h *InstanceHandler) GetQR(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	client := h.manager.GetInstance(instance.ID.String())

	// If not running, start it now
	if client == nil {
		if err := h.manager.StartInstance(instance); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao iniciar instância: " + err.Error()})
		}
		// Give it a moment to connect
		time.Sleep(500 * time.Millisecond)
		client = h.manager.GetInstance(instance.ID.String())
	}

	if client == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "cliente não encontrado"})
	}

	// Already logged in - don't generate new QR
	if client.IsLoggedIn() {
		return c.JSON(fiber.Map{"message": "instância já está conectada"})
	}

	// Make sure it's in connecting state in DB
	h.db.Model(instance).Update("status", models.StatusConnecting)

	// Wait for QR with timeout
	select {
	case code := <-client.GetQRChan():
		return c.JSON(fiber.Map{
			"qr":         code,
			"expires_at": time.Now().Add(60 * time.Second),
		})
	case <-time.After(30 * time.Second):
		return c.Status(fiber.StatusRequestTimeout).JSON(fiber.Map{"error": "timeout aguardando QR code"})
	}
}

// Disconnect godoc
// POST /instances/:id/disconnect
func (h *InstanceHandler) Disconnect(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	// Logout from WhatsApp and clear session so user needs to re-scan QR on reconnect
	if client := h.manager.GetInstance(instance.ID.String()); client != nil {
		client.ClearSession()
	}

	h.manager.StopInstance(instance.ID.String())
	h.db.Model(instance).Updates(map[string]interface{}{
		"status":       models.StatusDisconnected,
		"connected_at": nil,
	})

	return c.JSON(fiber.Map{"message": "instância desconectada"})
}

// Reconnect godoc
// POST /instances/:id/reconnect
func (h *InstanceHandler) Reconnect(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	// Reload fresh from DB to get latest proxy config
	var fresh models.Instance
	if err := h.db.First(&fresh, "id = ?", instance.ID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if err := h.manager.StartInstance(&fresh); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao reconectar: " + err.Error()})
	}

	h.db.Model(&fresh).Update("status", models.StatusConnecting)

	return c.JSON(fiber.Map{"message": "reconexão iniciada"})
}

// Status godoc
// GET /instances/:id/status
func (h *InstanceHandler) Status(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	status := string(instance.Status)
	running := h.manager.IsRunning(instance.ID.String())

	if running {
		client := h.manager.GetInstance(instance.ID.String())
		if client != nil {
			if client.IsConnected() {
				status = "connected"
			} else {
				status = "connecting"
			}
		}
	}

	return c.JSON(fiber.Map{
		"id":           instance.ID,
		"name":         instance.Name,
		"status":       status,
		"phone_number": instance.PhoneNumber,
		"connected_at": instance.ConnectedAt,
		"running":      running,
	})
}

// Profile godoc
// GET /instances/:id/profile
func (h *InstanceHandler) Profile(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	client := h.manager.GetInstance(instance.ID.String())
	phoneNumber := instance.PhoneNumber
	profilePicURL := ""

	if client != nil && client.IsConnected() {
		if pn := client.GetPhoneNumber(); pn != "" {
			phoneNumber = pn
			// Persist phone number if changed
			if pn != instance.PhoneNumber {
				h.db.Model(instance).Update("phone_number", pn)
			}
		}
		profilePicURL = client.GetProfilePicture()
	}

	// Count distinct conversations from message_logs
	var convCount int64
	h.db.Raw(`SELECT COUNT(DISTINCT to_jid) FROM message_logs WHERE instance_id = ? AND to_jid != ''`, instance.ID).Scan(&convCount)

	return c.JSON(fiber.Map{
		"phone_number":    phoneNumber,
		"profile_pic_url": profilePicURL,
		"conversations":   convCount,
		"status":          instance.Status,
		"connected_at":    instance.ConnectedAt,
	})
}

// GetSettings godoc
// GET /instances/:id/settings
func (h *InstanceHandler) GetSettings(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	return c.JSON(fiber.Map{
		"always_online": instance.AlwaysOnline,
		"reject_calls":  instance.RejectCalls,
		"read_messages": instance.ReadMessages,
		"ignore_groups": instance.IgnoreGroups,
		"ignore_status": instance.IgnoreStatus,
		"mcp_enabled":   instance.MCPEnabled,
	})
}

// UpdateSettings godoc
// PUT /instances/:id/settings
func (h *InstanceHandler) UpdateSettings(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		AlwaysOnline *bool `json:"always_online"`
		RejectCalls  *bool `json:"reject_calls"`
		ReadMessages *bool `json:"read_messages"`
		IgnoreGroups *bool `json:"ignore_groups"`
		IgnoreStatus *bool `json:"ignore_status"`
		MCPEnabled   *bool `json:"mcp_enabled"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.AlwaysOnline != nil {
		updates["always_online"] = *req.AlwaysOnline
		instance.AlwaysOnline = *req.AlwaysOnline
	}
	if req.RejectCalls != nil {
		updates["reject_calls"] = *req.RejectCalls
		instance.RejectCalls = *req.RejectCalls
	}
	if req.ReadMessages != nil {
		updates["read_messages"] = *req.ReadMessages
		instance.ReadMessages = *req.ReadMessages
	}
	if req.IgnoreGroups != nil {
		updates["ignore_groups"] = *req.IgnoreGroups
		instance.IgnoreGroups = *req.IgnoreGroups
	}
	if req.IgnoreStatus != nil {
		updates["ignore_status"] = *req.IgnoreStatus
		instance.IgnoreStatus = *req.IgnoreStatus
	}
	if req.MCPEnabled != nil {
		updates["mcp_enabled"] = *req.MCPEnabled
		instance.MCPEnabled = *req.MCPEnabled
	}

	if len(updates) > 0 {
		if err := h.db.Model(instance).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar configurações"})
		}
		h.manager.RefreshSettings(instance.ID.String(), instance)
	}

	return c.JSON(fiber.Map{
		"always_online": instance.AlwaysOnline,
		"reject_calls":  instance.RejectCalls,
		"read_messages": instance.ReadMessages,
		"ignore_groups": instance.IgnoreGroups,
		"ignore_status": instance.IgnoreStatus,
		"mcp_enabled":   instance.MCPEnabled,
	})
}

// GetPairingCode godoc
// POST /instances/:id/pairing-code
func (h *InstanceHandler) GetPairingCode(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		PhoneNumber string `json:"phone_number"`
	}
	if err := c.BodyParser(&req); err != nil || req.PhoneNumber == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "phone_number é obrigatório (ex: 5511999999999)"})
	}

	// Always restart in pairing mode to avoid conflict with QR channel
	if err := h.manager.StartInstanceForPairing(instance); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao iniciar instância: " + err.Error()})
	}
	h.db.Model(instance).Update("status", models.StatusConnecting)

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "cliente não encontrado"})
	}

	// Wait for the WebSocket connection to WhatsApp to establish (up to 15 s)
	for i := 0; i < 15; i++ {
		if client.IsConnected() {
			break
		}
		time.Sleep(time.Second)
	}

	code, err := client.RequestPairingCode(req.PhoneNumber)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"code": code})
}

// suppress unused import
var _ = uuid.Nil
