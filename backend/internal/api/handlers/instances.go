package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type InstanceHandler struct {
	db        *gorm.DB
	manager   *whatsapp.Manager
	instagram *services.InstagramService
}

func NewInstanceHandler(db *gorm.DB, manager *whatsapp.Manager) *InstanceHandler {
	h := &InstanceHandler{db: db, manager: manager}
	h.instagram = services.NewInstagramService(db)
	return h
}

// resolveLiveStatus unifica a regra de "qual é o status real" da instância
// para List, Get e o polling de /status.
//
// Matriz de estados (client é o InstanceClient no manager):
//
//	IsConnected  IsLoggedIn   Status
//	true         true         connected     — WS autenticado, tudo OK
//	false        true         connecting    — sessão válida, whatsmeow
//	                                          tentando reconectar (auto
//	                                          reconnect em andamento)
//	true         false        connecting    — acabou de abrir WS, ainda
//	                                          fazendo handshake/login
//	false        false        disconnected  — sessão caiu sem ter
//	                                          autenticação guardada;
//	                                          o cliente está "vivo" no
//	                                          mapa mas sem conexão nem
//	                                          credencial válida
//
// Com essa matriz NUNCA reportamos "connecting" pra um cliente totalmente
// offline. O bug que estávamos vendo era: sessão expirava (QR/2FA), o
// InstanceClient continuava em memória e eu devolvia "connecting"
// eternamente. Agora só devolve connecting se houver pelo menos UMA
// evidência de vida (socket up OU sessão autenticada guardada).
//
// Quando nem IsRunning:
//   - DB "connecting" → stale (reconnect que morreu), promove pra
//     disconnected e persiste pra a UI oferecer reconectar.
//   - Caso contrário usa o status do DB.
func (h *InstanceHandler) resolveLiveStatus(inst *models.Instance) models.InstanceStatus {
	// Canais que não rodam no whatsmeow manager (WABA Cloud API, futuros
	// canais cloud-only): DB é fonte da verdade. Sem isso a função retornava
	// disconnected porque manager.IsRunning() é sempre false pra eles.
	if inst.Channel == models.ChannelWABA {
		// Defesa extra: se Instance.status diz disconnected mas existe uma
		// WABAInstance ativa pra ela, sincroniza (pode acontecer com fluxos
		// antigos onde o callback não persistiu o status corretamente).
		if inst.Status != models.StatusConnected {
			var wabaCount int64
			h.db.Model(&models.WABAInstance{}).
				Where("instance_id = ? AND status = ?", inst.ID, "active").
				Count(&wabaCount)
			if wabaCount > 0 {
				h.db.Model(inst).Update("status", models.StatusConnected)
				return models.StatusConnected
			}
		}
		return inst.Status
	}
	id := inst.ID.String()
	if h.manager.IsRunning(id) {
		client := h.manager.GetInstance(id)
		if client != nil {
			connected := client.IsConnected()
			loggedIn := client.IsLoggedIn()
			if connected && loggedIn {
				return models.StatusConnected
			}
			if connected || loggedIn {
				// Um dos dois verdadeiro = estado transitório real
				return models.StatusConnecting
			}
			// Client existe mas nem socket nem sessão — tá morto.
			// Persiste pra a UI não pedir polling infinito.
			if inst.Status != models.StatusDisconnected {
				h.db.Model(inst).Update("status", models.StatusDisconnected)
			}
			return models.StatusDisconnected
		}
	}
	// Manager não tem client em memória — DB é a fonte da verdade. Se o
	// DB ficou "connecting" mas não há client, é estado stale.
	if inst.Status == models.StatusConnecting {
		h.db.Model(inst).Update("status", models.StatusDisconnected)
		return models.StatusDisconnected
	}
	return inst.Status
}

func (h *InstanceHandler) getConnectedWhatsAppClient(c *fiber.Ctx) (*models.Instance, *whatsapp.InstanceClient, error) {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil, nil, fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}
	if instance.Channel != models.ChannelWhatsApp {
		return nil, nil, fiber.NewError(fiber.StatusBadRequest, "endpoint disponível apenas para instâncias WhatsApp")
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return nil, nil, fiber.NewError(fiber.StatusConflict, "instância não está em execução. Conecte primeiro.")
	}
	if !client.IsConnected() {
		return nil, nil, fiber.NewError(fiber.StatusConflict, "instância não está conectada ao WhatsApp")
	}

	return instance, client, nil
}

// List godoc
// GET /instances
// Query params: workspace_id (optional)
func (h *InstanceHandler) List(c *fiber.Ctx) error {
	startedAt := time.Now()
	user := middleware.GetCurrentUser(c)
	workspaceID := c.Query("workspace_id")

	var instances []models.Instance
	q := h.db.Preload("Server").Preload("Server.Proxy").Order("created_at DESC")

	// Regular users and super admins both need workspace membership
	// (Super admins should use /admin/inspect to see all instances)
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

	if err := q.Find(&instances).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar instâncias"})
	}

	// Enrich with live status from the WhatsApp manager (mesma regra do GET).
	for i := range instances {
		instances[i].Status = h.resolveLiveStatus(&instances[i])
	}

	elapsed := time.Since(startedAt).Milliseconds()
	if elapsed > 600 {
		log.Warn().
			Str("user_id", user.ID.String()).
			Str("workspace_id", workspaceID).
			Int64("instances_count", int64(len(instances))).
			Int64("duration_ms", elapsed).
			Msg("slow instances list request")
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

	// Server é obrigatório só pros canais que rodam em VPS própria
	// (whatsmeow, instagram, tiktok). WABA usa Cloud API da Meta direto,
	// não tem servidor; idem outros canais cloud-only futuros.
	channelNeedsServer := req.Channel != "waba"
	if channelNeedsServer && req.ServerID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "server é obrigatório"})
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

	// Check plan limits — membros de workspace herdam o plano do DONO do
	// workspace, não usam o próprio. Helper compartilhado entre instances
	// /shops/agents/journeys.
	planOwnerID, planOwnerPlan := resolveEffectivePlan(h.db, user, wsUUID)

	if planOwnerPlan != nil && !planOwnerPlan.IsUnlimitedInstances() {
		var count int64
		// Conta TODAS as instâncias dos workspaces do owner (criadas por
		// qualquer membro). Sem isso, members criavam instâncias com seus
		// user_id pessoais e não eram contabilizadas no limite do workspace.
		h.db.Model(&models.Instance{}).
			Where(
				"workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?) OR (workspace_id IS NULL AND user_id = ?)",
				planOwnerID, planOwnerID,
			).
			Count(&count)
		if int(count) >= planOwnerPlan.MaxInstances {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "limite de instâncias atingido para o plano do workspace",
				"limit": planOwnerPlan.MaxInstances,
			})
		}
	}

	channel := models.ChannelType(req.Channel)
	if channel == "" {
		channel = models.ChannelWhatsApp
	}
	switch channel {
	case models.ChannelWhatsApp, models.ChannelWABA, models.ChannelInstagram, models.ChannelTelegram, models.ChannelLinkedIn, models.ChannelTikTok, models.ChannelKwai:
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "canal inválido"})
	}

	instance := models.Instance{
		UserID:      user.ID,
		WorkspaceID: wsUUID,
		Name:        req.Name,
		Channel:     channel,
		Status:      models.StatusDisconnected,
	}

	log.Debug().Str("user", user.ID.String()).Str("name", req.Name).Msg("creating new instance with status=disconnected")

	// Link to server if provided. Validação ESTRITA por workspace:
	// server precisa pertencer ao MESMO workspace que a instância (ou ter
	// workspace_id NULL, caso legado/global). Antes aceitava também
	// "server_user_id == user_id" — o que permitia o user usar server de
	// outro workspace dele mesmo (vazamento entre workspaces).
	if req.ServerID != "" {
		if sid, err := uuid.Parse(req.ServerID); err == nil {
			var srv models.Server
			if h.db.First(&srv, "id = ?", sid).Error == nil {
				sameWS := wsUUID != nil && srv.WorkspaceID != nil && *srv.WorkspaceID == *wsUUID
				legacyGlobal := srv.WorkspaceID == nil && srv.UserID == user.ID
				if sameWS || legacyGlobal {
					instance.ServerID = &sid
				} else {
					return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
						"error": "server pertence a outro workspace",
					})
				}
			} else {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "server não encontrado"})
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

	// Instâncias não carregam mais proxy próprio — o proxy aplicado vem
	// do server vinculado (ver Server.ProxyID). Nada a fazer aqui.

	return c.Status(fiber.StatusCreated).JSON(instance)
}

// Get godoc
// GET /instances/:id
func (h *InstanceHandler) Get(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	// Live status usa a mesma regra do List — evita divergência entre card
	// (/instances) e tela do manager (/instances/:id).
	instance.Status = h.resolveLiveStatus(instance)

	return c.JSON(instance)
}

// Patch atualiza campos editáveis da instância (atualmente: name).
// PATCH /instances/:id  Body: { "name": "Novo nome" }
func (h *InstanceHandler) Patch(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		Name *string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	updates := map[string]interface{}{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome não pode ser vazio"})
		}
		if len(name) > 80 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome máximo 80 caracteres"})
		}
		updates["name"] = name
		instance.Name = name
	}
	if len(updates) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nada pra atualizar"})
	}
	if err := h.db.Model(instance).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
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

	// WABA: avisa Meta antes de apagar registros locais. Sem isso, Meta
	// continua mandando webhooks pra um phone_number_id que não existe
	// mais aqui (logs poluídos + risco de bug futuro). Best-effort: se
	// falhar, loga warn e prossegue com a remoção local mesmo assim.
	if instance.Channel == models.ChannelWABA {
		var waba models.WABAInstance
		if err := h.db.Where("instance_id = ?", instance.ID).First(&waba).Error; err == nil {
			h.unsubscribeWABA(&waba)
		}
	}

	// Clear session data BEFORE stopping (while client still exists)
	if client := h.manager.GetInstance(instance.ID.String()); client != nil {
		client.ClearSession()
	}

	// Stop the WhatsApp connection
	h.manager.StopInstance(instance.ID.String())

	// Cascade-clean child rows that reference this instance. Most tables
	// were created through AutoMigrate without ON DELETE CASCADE, so a
	// plain DELETE fails with FK violations in Postgres once any child
	// row exists (messages, webhooks, campaigns, etc.).
	instanceID := instance.ID

	// Clean conversation children before deleting conversations themselves.
	convSubquery := "SELECT id FROM conversations WHERE instance_id = ?"
	for _, t := range []string{"conversation_events", "conversation_assignments", "conversation_notes", "conversation_agent_states"} {
		if err := h.db.Exec("DELETE FROM "+t+" WHERE conversation_id IN ("+convSubquery+")", instanceID).Error; err != nil {
			log.Warn().Err(err).Str("table", t).Str("instance", instanceID.String()).
				Msg("failed to cleanup conversation child rows during instance delete (continuing)")
		}
	}
	// conversation_participants has a composite PK, same pattern.
	if err := h.db.Exec("DELETE FROM conversation_participants WHERE conversation_id IN ("+convSubquery+")", instanceID).Error; err != nil {
		log.Warn().Err(err).Str("table", "conversation_participants").Str("instance", instanceID.String()).
			Msg("failed to cleanup conversation_participants during instance delete (continuing)")
	}

	// Clean contact_group_memberships before contact_groups.
	if err := h.db.Exec(`
		DELETE FROM contact_group_memberships
		WHERE contact_group_id IN (SELECT id FROM contact_groups WHERE instance_id = ?)
	`, instanceID).Error; err != nil {
		log.Warn().Err(err).Str("table", "contact_group_memberships").Str("instance", instanceID.String()).
			Msg("failed to cleanup contact_group_memberships during instance delete (continuing)")
	}

	// Clean agent_assets before instance_agents.
	if err := h.db.Exec(`
		DELETE FROM agent_assets
		WHERE instance_agent_id IN (
			SELECT id FROM instance_agents WHERE instance_id = ?
		)
	`, instanceID).Error; err != nil {
		log.Warn().Err(err).Str("table", "agent_assets").Str("instance", instanceID.String()).
			Msg("failed to cleanup instance child rows")
	}

	childTables := []string{
		"conversations",
		"contact_groups",
		"warmup_sessions",
		"queue_channels",
		"journey_executions",
		"message_logs",
		"webhooks",
		"campaigns",
		"recoveries",
		"otps",
		"integrations",
		"instance_agents",
		"waba_instances",
		"proxy_pool_assignments",
	}
	for _, t := range childTables {
		if err := h.db.Exec("DELETE FROM "+t+" WHERE instance_id = ?", instanceID).Error; err != nil {
			log.Warn().Err(err).Str("table", t).Str("instance", instanceID.String()).
				Msg("failed to clean child rows during instance delete (continuing)")
		}
	}
	// media_files.instance_id is nullable — detach rather than delete.
	_ = h.db.Exec("UPDATE media_files SET instance_id = NULL WHERE instance_id = ?", instanceID).Error
	// contacts.instance_id is nullable — detach rather than delete so
	// CRM history is preserved.
	_ = h.db.Exec("UPDATE contacts SET instance_id = NULL WHERE instance_id = ?", instanceID).Error

	if err := h.db.Delete(instance).Error; err != nil {
		log.Error().Err(err).Str("instance", instanceID.String()).Msg("failed to delete instance row")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar instância: " + err.Error()})
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
	if instance.Channel != models.ChannelWhatsApp {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "QR disponível apenas para instâncias WhatsApp"})
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
	if instance.Channel != models.ChannelWhatsApp {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "disconnect disponível apenas para instâncias WhatsApp"})
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

	if fresh.Channel != models.ChannelWhatsApp {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "reconexão disponível apenas para instâncias WhatsApp"})
	}

	// An explicit user-triggered reconnect should override any stale
	// "connecting" state — otherwise StartInstance's defensive check
	// rejects the call and /reconnect 500s in a loop. We only leave
	// connected/disconnected rows alone so StartInstance can do its
	// normal restart flow.
	if fresh.Status != models.StatusConnected && fresh.Status != models.StatusDisconnected {
		h.db.Model(&fresh).Update("status", models.StatusDisconnected)
		fresh.Status = models.StatusDisconnected
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

	// Mesma regra de resolução que List/Get — mantém a UI consistente
	// entre o card da lista e a tela do manager.
	status := string(h.resolveLiveStatus(instance))
	running := h.manager.IsRunning(instance.ID.String())

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

// ContactInfo godoc
// POST /instances/:id/contact/info
func (h *InstanceHandler) ContactInfo(c *fiber.Ctx) error {
	_, client, err := h.getConnectedWhatsAppClient(c)
	if err != nil {
		return err
	}

	var req struct {
		Phone string `json:"phone"`
		JID   string `json:"jid"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	target := req.Phone
	if target == "" {
		target = req.JID
	}
	if target == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "envie 'phone' ou 'jid'"})
	}

	info, err := client.LookupContact(target)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(info)
}

// ContactAvatar godoc
// POST /instances/:id/contact/avatar
func (h *InstanceHandler) ContactAvatar(c *fiber.Ctx) error {
	_, client, err := h.getConnectedWhatsAppClient(c)
	if err != nil {
		return err
	}

	var req struct {
		Phone string `json:"phone"`
		JID   string `json:"jid"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	target := req.Phone
	if target == "" {
		target = req.JID
	}
	if target == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "envie 'phone' ou 'jid'"})
	}

	info, err := client.LookupContact(target)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"query":      info.Query,
		"exists":     info.Exists,
		"jid":        info.JID,
		"avatar_url": info.AvatarURL,
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

// ─── Instagram Handlers ─────────────────────────────────────────────────────

// InstagramLogin POST /instances/:id/instagram/login
func (h *InstanceHandler) InstagramLogin(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if instance.Channel != models.ChannelInstagram {
		return c.Status(400).JSON(fiber.Map{"error": "instância não é do Instagram"})
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "username e password são obrigatórios"})
	}

	// Resolve proxy from the instance's server using the shared resolver so that
	// UseEnv proxies (BrightData env vars) and encrypted passwords are handled correctly.
	proxyURL := ""
	if instance.Server != nil && instance.Server.ProxyID != nil {
		var proxy models.Proxy
		if h.db.First(&proxy, "id = ?", *instance.Server.ProxyID).Error == nil && proxy.IsActive {
			if cfg, _, ok := whatsapp.BuildProxyConfigExported(&proxy); ok {
				proxyURL = whatsapp.FormatProxyURL(cfg, false)
				log.Debug().Str("instance", instance.ID.String()).
					Str("proxy", whatsapp.FormatProxyURL(cfg, true)).
					Msg("instagram login: proxy resolved")
			}
		}
	}
	if proxyURL == "" {
		log.Debug().Str("instance", instance.ID.String()).Msg("instagram login: no proxy")
	}

	resp, err := h.instagram.Login(c.Context(), instance.ID.String(), req.Username, req.Password, proxyURL)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	if resp.Status == "challenge_required" {
		return c.JSON(fiber.Map{
			"status":                "challenge_required",
			"challenge_type":        resp.ChallengeType,
			"options":               resp.Options,
			"api_path":              resp.APIPath,
			"message":               resp.Message,
			"phone_mask":            resp.PhoneMask,
			"email_mask":            resp.EmailMask,
			"can_resend":            resp.CanResend,
			"external_verification": resp.ExternalVerification,
		})
	}

	h.db.Model(instance).Updates(map[string]interface{}{
		"instagram_username":  req.Username,
		"status":              models.StatusConnected,
		"instagram_device_id": generateDeviceID(req.Username),
	})

	return c.JSON(fiber.Map{
		"username": resp.Username,
		"pk":       resp.PK,
		"status":   "connected",
	})
}

// InstagramLogout POST /instances/:id/instagram/logout
func (h *InstanceHandler) InstagramLogout(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if err := h.instagram.Logout(c.Context(), instance.ID.String()); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	h.db.Model(instance).Update("status", models.StatusDisconnected)

	return c.JSON(fiber.Map{"message": "logged out", "status": "disconnected"})
}

// InstagramSendDM POST /instances/:id/instagram/dm
func (h *InstanceHandler) InstagramSendDM(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		Recipient string `json:"recipient"`
		Message   string `json:"message"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	resp, err := h.instagram.SendDM(c.Context(), instance.ID.String(), req.Recipient, req.Message)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	h.db.Model(instance).Update("last_message_at", time.Now())

	return c.JSON(resp)
}

// InstagramGetInbox GET /instances/:id/instagram/dm
func (h *InstanceHandler) InstagramGetInbox(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	inbox, err := h.instagram.GetInbox(c.Context(), instance.ID.String())
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(inbox)
}

// InstagramFollow POST /instances/:id/instagram/follow
func (h *InstanceHandler) InstagramFollow(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if err := h.instagram.Follow(c.Context(), instance.ID.String(), req.Target); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "ok", "target": req.Target})
}

// InstagramUnfollow POST /instances/:id/instagram/unfollow
func (h *InstanceHandler) InstagramUnfollow(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if err := h.instagram.Unfollow(c.Context(), instance.ID.String(), req.Target); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "ok", "target": req.Target})
}

// InstagramPause POST /instances/:id/instagram/pause
func (h *InstanceHandler) InstagramPause(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	h.db.Model(instance).Update("is_paused", true)
	return c.JSON(fiber.Map{"status": "paused"})
}

// InstagramResume POST /instances/:id/instagram/resume
func (h *InstanceHandler) InstagramResume(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	h.db.Model(instance).Update("is_paused", false)
	return c.JSON(fiber.Map{"status": "active"})
}

// InstagramPublishPost POST /instances/:id/instagram/post
func (h *InstanceHandler) InstagramPublishPost(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		ImageURL string `json:"image_url"`
		VideoURL string `json:"video_url"`
		Caption  string `json:"caption"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.ImageURL == "" && req.VideoURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "image_url ou video_url é obrigatório"})
	}

	resp, err := h.instagram.PublishPost(c.Context(), instance.ID.String(), req.ImageURL, req.VideoURL, req.Caption)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(resp)
}

// InstagramUploadStory POST /instances/:id/instagram/story
func (h *InstanceHandler) InstagramUploadStory(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		ImageURL string `json:"image_url"`
		VideoURL string `json:"video_url"`
		Caption  string `json:"caption"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.ImageURL == "" && req.VideoURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "image_url ou video_url é obrigatório"})
	}

	resp, err := h.instagram.UploadStory(c.Context(), instance.ID.String(), req.ImageURL, req.VideoURL, req.Caption)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(resp)
}

// InstagramGetUserMedia GET /instances/:id/instagram/media
func (h *InstanceHandler) InstagramGetUserMedia(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "username é obrigatório"})
	}

	resp, err := h.instagram.GetUserMedia(c.Context(), instance.ID.String(), username)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(resp)
}

// InstagramLikeMedia POST /instances/:id/instagram/like
func (h *InstanceHandler) InstagramLikeMedia(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		MediaID string `json:"media_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.MediaID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "media_id é obrigatório"})
	}

	if err := h.instagram.LikeMedia(c.Context(), instance.ID.String(), req.MediaID); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "ok"})
}

// InstagramChallenge POST /instances/:id/instagram/challenge
func (h *InstanceHandler) InstagramChallenge(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		APIPath string `json:"api_path"`
		Code    string `json:"code"`
		Method  string `json:"method"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.APIPath == "" || req.Code == "" {
		return c.Status(400).JSON(fiber.Map{"error": "api_path e code são obrigatórios"})
	}

	resp, err := h.instagram.ChallengeVerify(c.Context(), instance.ID.String(), req.APIPath, req.Code, req.Method)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(resp)
}

// InstagramChallengeResend POST /instances/:id/instagram/challenge/resend
func (h *InstanceHandler) InstagramChallengeResend(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance == nil {
		return c.Status(404).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		APIPath string `json:"api_path"`
		Method  string `json:"method"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	if req.APIPath == "" {
		return c.Status(400).JSON(fiber.Map{"error": "api_path é obrigatório"})
	}

	if err := h.instagram.ChallengeResend(c.Context(), instance.ID.String(), req.APIPath, req.Method); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"message": "código reenviado"})
}

func generateDeviceID(username string) string {
	return fmt.Sprintf("android-%s", uuid.New().String()[:8])
}

// suppress unused import
var _ = uuid.Nil

// unsubscribeWABA — chamado antes do Delete da instância WABA pra:
//   1. DELETE /{waba_id}/subscribed_apps  (Meta para de mandar webhooks)
//
// Best-effort: erros são logados mas não bloqueiam a deleção local.
func (h *InstanceHandler) unsubscribeWABA(waba *models.WABAInstance) {
	if waba == nil || waba.WABABusinessID == "" || waba.AccessToken == "" {
		return
	}
	url := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s/subscribed_apps",
		waba.WABABusinessID,
	)
	req, err := http.NewRequest("DELETE", url, nil)
	if err != nil {
		log.Warn().Err(err).Str("waba", waba.WABABusinessID).Msg("waba unsubscribe: build request failed")
		return
	}
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		log.Warn().Err(err).Str("waba", waba.WABABusinessID).Msg("waba unsubscribe: HTTP failed")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		log.Warn().Int("status", resp.StatusCode).Str("body", string(body)).
			Str("waba", waba.WABABusinessID).Msg("waba unsubscribe: Meta retornou erro (continuando deleção local)")
		return
	}
	log.Info().Str("waba", waba.WABABusinessID).Msg("waba unsubscribe: ok")
}
