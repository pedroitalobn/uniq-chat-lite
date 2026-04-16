package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"gorm.io/gorm"
)

// Manager manages all active WhatsApp instance clients.
type Manager struct {
	mu         sync.RWMutex
	clients    map[string]*InstanceClient
	consumers  map[string]context.CancelFunc // instanceID → queue consumer cancel
	sessionDir string
	db         *gorm.DB
}

var GlobalManager *Manager

// NewManager creates and returns a new Manager.
func NewManager(sessionDir string, db *gorm.DB) *Manager {
	m := &Manager{
		clients:    make(map[string]*InstanceClient),
		consumers:  make(map[string]context.CancelFunc),
		sessionDir: sessionDir,
		db:         db,
	}
	GlobalManager = m
	return m
}

// StartInstance starts (or restarts) the WhatsApp client for the given instance.
func (m *Manager) StartInstance(instance *models.Instance) error {
	// Defensive check: only allow starting if status is connected or disconnected
	// prevent accidental auto-start for instances that were never paired
	if instance.Status != models.StatusConnected && instance.Status != models.StatusDisconnected {
		log.Warn().Str("instance", instance.ID.String()).Str("status", string(instance.Status)).
			Msg("refusing to start instance with invalid status")
		return fmt.Errorf("cannot start instance with status %s", instance.Status)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// If already running, stop first
	if existing, ok := m.clients[instance.ID.String()]; ok {
		existing.Disconnect()
		delete(m.clients, instance.ID.String())
	}
	// Cancel existing consumer if any
	if cancel, ok := m.consumers[instance.ID.String()]; ok {
		cancel()
		delete(m.consumers, instance.ID.String())
	}

	proxyCfg := m.buildProxyCfg(instance)
	webhooks := m.loadWebhooks(instance.ID.String())
	settings := instanceSettings(instance)

	client, err := NewInstanceClient(instance.ID.String(), m.sessionDir, proxyCfg, webhooks, settings)
	if err != nil {
		return fmt.Errorf("failed to create instance client: %w", err)
	}

	if err := client.Connect(); err != nil {
		return fmt.Errorf("failed to connect instance: %w", err)
	}

	m.clients[instance.ID.String()] = client
	log.Info().Str("instance", instance.ID.String()).Msg("WhatsApp instance started")

	// Watch for status updates and persist to DB
	go m.watchStatus(instance.ID.String(), client)

	// Start queue consumer for this instance (if RabbitMQ is configured)
	if queue.GlobalQueue != nil && queue.GlobalQueue.IsConnected() {
		ctx, cancel := context.WithCancel(context.Background())
		m.consumers[instance.ID.String()] = cancel
		queue.GlobalQueue.StartConsumer(ctx, instance.ID.String(), func(job queue.SendJob) error {
			ic := m.GetInstance(instance.ID.String())
			if ic == nil {
				return fmt.Errorf("instance not running")
			}
			return ic.ProcessQueueJob(job)
		})
	}

	return nil
}

// StopInstance disconnects and removes the instance client.
func (m *Manager) StopInstance(instanceID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, ok := m.clients[instanceID]; ok {
		client.Disconnect()
		delete(m.clients, instanceID)
		log.Info().Str("instance", instanceID).Msg("WhatsApp instance stopped")
	}
	if cancel, ok := m.consumers[instanceID]; ok {
		cancel()
		delete(m.consumers, instanceID)
	}
}

// GetInstance returns the active client for an instance ID, or nil if not running.
func (m *Manager) GetInstance(instanceID string) *InstanceClient {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[instanceID]
}

// IsRunning returns whether an instance has an active client.
func (m *Manager) IsRunning(instanceID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.clients[instanceID]
	return ok
}

// SaveMessage saves a message to the database for inbox display.
func (m *Manager) SaveMessage(instanceID string, toJID string, content string, direction models.MessageDirection, msgType string, pushName string, isGroup bool, senderJID string) error {
	if m.db == nil {
		return nil
	}

	rawJID := toJID
	toJID = canonicalJID(toJID)
	log.Printf("DEBUG SaveMessage: instanceID=%s, rawJID=%s, canonicalJID=%s, isGroup=%v", instanceID, rawJID, toJID, isGroup)

	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return err
	}

	contentJSON, _ := json.Marshal(content)

	// Extract phone from JID (for non-groups)
	phone := extractPhoneFromJID(toJID)

	// Try to get contact info
	var contactName string
	var contactAvatar string

	if isGroup {
		// For groups, get the group name from WhatsApp
		log.Printf("DEBUG: Processing group message, JID: %s", toJID)
		if client := m.GetInstance(instanceID); client != nil && client.IsConnected() {
			log.Printf("DEBUG: Instance connected, fetching group info for: %s", toJID)
			groupInfo, err := client.GetGroupInfo(toJID)
			if err == nil {
				log.Printf("DEBUG: Got group info: %+v", groupInfo)
				if name, ok := groupInfo["name"].(string); ok && name != "" {
					contactName = name
					log.Printf("DEBUG: Set group name to: %s", name)
				}
			} else {
				log.Printf("DEBUG: Error getting group info: %v", err)
			}
			// Fallback to group JID if name not found
			if contactName == "" {
				contactName = "Grupo " + phone
			}
		} else {
			log.Printf("DEBUG: Instance not connected, using fallback")
			contactName = "Grupo " + phone
		}
	} else {
		// For individual chats
		if direction == models.DirectionOut {
			// For sent messages (direction OUT), get recipient info
			// First try CRM
			var contact models.Contact
			if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
				contactName = contact.Name
			}
			// Fallback to phone number
			if contactName == "" {
				contactName = phone
			}
		} else {
			// For received messages, use push name from event
			if pushName != "" {
				contactName = pushName
			}

			// If no push name, try CRM
			if contactName == "" {
				var contact models.Contact
				if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
					contactName = contact.Name
				}
			}

			// Fallback to phone number
			if contactName == "" {
				contactName = phone
			}
		}
	}

	// Try to get avatar from WhatsApp (async, non-blocking for speed)
	if client := m.GetInstance(instanceID); client != nil && client.IsConnected() {
		if picURL := client.GetContactProfilePicture(toJID); picURL != "" {
			contactAvatar = picURL
		}
	}

	senderName := pushName
	if senderName == "" && senderJID != "" {
		senderName = extractPhoneFromJID(senderJID)
	}

	logEntry := models.MessageLog{
		ID:            uuid.New(),
		InstanceID:    instUUID,
		Direction:     direction,
		Type:          msgType,
		ToJID:         toJID,
		ContactName:   contactName,
		ContactAvatar: contactAvatar,
		SenderJID:     senderJID,
		SenderName:    senderName,
		Content:       string(contentJSON),
		Status:        models.MessageStatusSent,
	}

	// Check for duplicate - don't save if same message was saved in last 2 seconds
	var count int64
	m.db.Model(&models.MessageLog{}).Where(
		"instance_id = ? AND to_j_id = ? AND content = ? AND direction = ? AND created_at > datetime('now', '-2 seconds')",
		instUUID, toJID, string(contentJSON), direction,
	).Count(&count)

	if count > 0 {
		log.Printf("DEBUG: Skipping duplicate message for %s", toJID)
		return nil
	}

	return m.db.Create(&logEntry).Error
}

func extractPhoneFromJID(jid string) string {
	if idx := strings.Index(jid, "@"); idx > 0 {
		return jid[:idx]
	}
	return jid
}

// canonicalJID normalizes personal chats to @s.whatsapp.net to avoid split conversations
func canonicalJID(jid string) string {
	if jid == "" {
		return jid
	}
	if strings.HasSuffix(jid, "@g.us") || strings.HasSuffix(jid, "@newsletter") || jid == "status@broadcast" {
		return jid
	}
	phone := extractPhoneFromJID(jid)
	if phone == "" {
		return jid
	}
	return phone + "@s.whatsapp.net"
}

// RestartWithProxy stops the instance and restarts it with updated proxy configuration.
func (m *Manager) RestartWithProxy(instance *models.Instance) error {
	return m.StartInstance(instance)
}

// StartInstanceForPairing starts the instance in phone-pairing mode (no QR channel).
func (m *Manager) StartInstanceForPairing(instance *models.Instance) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.clients[instance.ID.String()]; ok {
		existing.Disconnect()
		delete(m.clients, instance.ID.String())
	}

	proxyCfg := m.buildProxyCfg(instance)
	webhooks := m.loadWebhooks(instance.ID.String())
	settings := instanceSettings(instance)

	client, err := NewInstanceClient(instance.ID.String(), m.sessionDir, proxyCfg, webhooks, settings)
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	if err := client.ConnectDirect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	m.clients[instance.ID.String()] = client
	go m.watchStatus(instance.ID.String(), client)

	if queue.GlobalQueue != nil && queue.GlobalQueue.IsConnected() {
		ctx, cancel := context.WithCancel(context.Background())
		m.consumers[instance.ID.String()] = cancel
		queue.GlobalQueue.StartConsumer(ctx, instance.ID.String(), func(job queue.SendJob) error {
			ic := m.GetInstance(instance.ID.String())
			if ic == nil {
				return fmt.Errorf("instance not running")
			}
			return ic.ProcessQueueJob(job)
		})
	}
	return nil
}

// LoadAll loads and starts all connected instances from the database.
func (m *Manager) LoadAll() {
	var instances []models.Instance

	// Only auto-start instances that were actually connected before restart.
	// Don't auto-start instances that are "connecting" (waiting for QR) or "disconnected".
	if err := m.db.Raw("SELECT * FROM instances WHERE status = 'connected'").Scan(&instances).Error; err != nil {
		log.Error().Err(err).Msg("failed to load connected instances")
		return
	}

	// Skip if nothing to load
	if len(instances) == 0 {
		log.Info().Msg("no instances to load")
		return
	}

	for i := range instances {
		m.db.Model(&instances[i]).Update("status", models.StatusConnecting)
		if err := m.StartInstance(&instances[i]); err != nil {
			log.Error().Err(err).Str("instance", instances[i].ID.String()).Msg("failed to start instance on boot")
			m.db.Model(&instances[i]).Update("status", models.StatusDisconnected)
		}
	}

	// Start background reconnection checker
	go m.startReconnectionChecker()

	log.Info().Int("count", len(instances)).Msg("loaded WhatsApp instances")
}

// startReconnectionChecker periodically checks disconnected instances and tries to reconnect them
func (m *Manager) startReconnectionChecker() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Check all instances that should be connected
		var instances []models.Instance
		m.db.Find(&instances, "status = ?", models.StatusConnected)

		for _, inst := range instances {
			m.mu.RLock()
			client, exists := m.clients[inst.ID.String()]
			m.mu.RUnlock()

			log.Debug().Str("instance", inst.ID.String()).Bool("exists_in_manager", exists).Msg("checking auto-reconnect")

			// If not in clients map or not connected, try to start
			if !exists || (client != nil && !client.IsConnected()) {
				log.Info().Str("instance", inst.ID.String()).Msg("attempting auto-reconnect")
				if err := m.StartInstance(&inst); err != nil {
					log.Error().Err(err).Str("instance", inst.ID.String()).Msg("auto-reconnect failed")
				}
			}
		}
	}
}

// ResetSession clears the WhatsApp session for an instance (logout + delete device store)
// so it can be re-paired with a new phone number. Message history is preserved in the DB.
func (m *Manager) ResetSession(instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, ok := m.clients[instanceID]; ok {
		if err := client.ClearSession(); err != nil {
			return fmt.Errorf("clear session: %w", err)
		}
		client.Disconnect()
		delete(m.clients, instanceID)
	}
	if cancel, ok := m.consumers[instanceID]; ok {
		cancel()
		delete(m.consumers, instanceID)
	}
	return nil
}

// RefreshSettings updates the behavior settings for a running instance without reconnecting.
func (m *Manager) RefreshSettings(instanceID string, instance *models.Instance) {
	m.mu.RLock()
	client, ok := m.clients[instanceID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	client.UpdateSettings(instanceSettings(instance))
}

// ReconnectAll triggers reconnection for all instances belonging to a specific user
func (m *Manager) ReconnectAll(userID string) {
	var instances []models.Instance
	m.db.Find(&instances, "user_id = ? AND status = ?", userID, models.StatusConnected)

	for _, inst := range instances {
		m.db.Model(&inst).Update("status", models.StatusConnecting)
		if err := m.StartInstance(&inst); err != nil {
			log.Error().Err(err).Str("instance", inst.ID.String()).Msg("failed to reconnect on login")
			m.db.Model(&inst).Update("status", models.StatusDisconnected)
		}
	}
}

// RefreshWebhooks updates the webhooks for a running instance without reconnecting.
func (m *Manager) RefreshWebhooks(instanceID string) {
	m.mu.RLock()
	client, ok := m.clients[instanceID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	client.UpdateWebhooks(m.loadWebhooks(instanceID))
}

// buildProxyCfg constructs a ProxyConfig from an instance model, decrypting the password.
func (m *Manager) buildProxyCfg(instance *models.Instance) *ProxyConfig {
	if !instance.ProxyEnabled {
		return nil
	}

	// Handle global proxy - fetch from GlobalProxyConfig
	if instance.UseGlobalProxy && instance.GlobalProxyID != nil {
		var gProxy models.GlobalProxyConfig
		if err := m.db.First(&gProxy, "id = ? AND enabled = ? AND is_active = ?", instance.GlobalProxyID.String(), true, true).Error; err != nil {
			log.Warn().Err(err).Str("instance", instance.ID.String()).Str("global_proxy_id", instance.GlobalProxyID.String()).Msg("global proxy config not found")
			return nil
		}

		password := ""
		if gProxy.Password != "" {
			dec, err := DecryptProxyPassword(gProxy.Password)
			if err != nil {
				log.Warn().Err(err).Str("instance", instance.ID.String()).Msg("failed to decrypt global proxy password")
			} else {
				password = dec
			}
		}

		return &ProxyConfig{
			Enabled:  true,
			Type:     gProxy.ProxyType,
			Host:     gProxy.Host,
			Port:     gProxy.Port,
			Username: gProxy.Username,
			Password: password,
		}
	}

	password := ""
	if instance.ProxyPassword != "" {
		dec, err := DecryptProxyPassword(instance.ProxyPassword)
		if err != nil {
			log.Warn().Err(err).Str("instance", instance.ID.String()).Msg("failed to decrypt proxy password")
		} else {
			password = dec
		}
	}

	return &ProxyConfig{
		Enabled:  true,
		Type:     string(instance.ProxyType),
		Host:     instance.ProxyHost,
		Port:     instance.ProxyPort,
		Username: instance.ProxyUsername,
		Password: password,
	}
}

func (m *Manager) loadWebhooks(instanceID string) []webhookEntry {
	var webhooks []models.Webhook
	if err := m.db.Find(&webhooks, "instance_id = ? AND is_active = true", instanceID).Error; err != nil {
		return nil
	}

	entries := make([]webhookEntry, 0, len(webhooks))
	for _, wh := range webhooks {
		evs := parseEventsJSON(wh.Events)
		entries = append(entries, webhookEntry{
			Events:        evs,
			IgnoreGroups:  wh.IgnoreGroups,
			IgnoreSelf:    wh.IgnoreSelf,
			IgnoreAPISent: wh.IgnoreAPISent,
			// HTTP
			URL:    wh.URL,
			Secret: wh.Secret,
			// RabbitMQ
			RabbitMQEnabled: wh.RabbitMQEnabled,
			AMQPURL:         wh.AMQPURL,
			Exchange:        wh.Exchange,
			RoutingKey:      wh.RoutingKey,
			// NATS
			NATSEnabled: wh.NATSEnabled,
			NATSURL:     wh.NATSURL,
			NATSSubject: wh.NATSSubject,
			NATSToken:   wh.NATSToken,
			// WS Client
			WSEnabled:     wh.WSEnabled,
			WSClientURL:   wh.WSClientURL,
			WSClientToken: wh.WSClientToken,
		})
	}
	return entries
}

func (m *Manager) watchStatus(instanceID string, client *InstanceClient) {
	// If the instance hasn't connected within 60 s, reset to disconnected.
	connectTimer := time.AfterFunc(60*time.Second, func() {
		if !client.IsConnected() {
			m.db.Model(&models.Instance{}).
				Where("id = ? AND status = ?", instanceID, models.StatusConnecting).
				Update("status", models.StatusDisconnected)
			log.Info().Str("instance", instanceID).Msg("connection timeout — reset to disconnected")
		}
	})

	for status := range client.GetStatusChan() {
		connectTimer.Stop()

		// Get phone number for the event
		var inst models.Instance
		var phone string
		if err := m.db.First(&inst, "id = ?", instanceID).Error; err == nil {
			phone = inst.PhoneNumber
		}

		if status == "connected" {
			now := time.Now()
			m.db.Model(&models.Instance{}).Where("id = ?", instanceID).Updates(map[string]interface{}{
				"status":       models.StatusConnected,
				"connected_at": now,
			})

			// Broadcast connection event
			if hub := GetHub(); hub != nil {
				hub.BroadcastInstanceStatus(instanceID, "connected", phone)
			}
		} else {
			m.db.Model(&models.Instance{}).Where("id = ?", instanceID).Update("status", models.StatusDisconnected)

			// Broadcast disconnection event
			if hub := GetHub(); hub != nil {
				hub.BroadcastInstanceStatus(instanceID, "disconnected", phone)
			}
		}
	}
}

func instanceSettings(instance *models.Instance) InstanceSettings {
	return InstanceSettings{
		AlwaysOnline: instance.AlwaysOnline,
		RejectCalls:  instance.RejectCalls,
		ReadMessages: instance.ReadMessages,
		IgnoreGroups: instance.IgnoreGroups,
		IgnoreStatus: instance.IgnoreStatus,
	}
}

func parseEventsJSON(raw string) []string {
	if raw == "" || raw == "[]" {
		return []string{"*"}
	}
	var events []string
	if err := json.Unmarshal([]byte(raw), &events); err != nil {
		return []string{"*"}
	}
	return events
}

// CheckJourneys checks if any journey should be triggered for the given message
// and executes them asynchronously.
func (m *Manager) CheckJourneys(instanceID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) {
	var journeys []models.Journey
	if err := m.db.Where("instance_id = ? AND status = 'active'", instanceID).Find(&journeys).Error; err != nil {
		log.Error().Err(err).Str("instance", instanceID).Msg("failed to query journeys")
		return
	}

	if len(journeys) == 0 {
		return
	}

	log.Info().
		Str("instance", instanceID).
		Str("from", fromJID).
		Str("group", groupJID).
		Str("message", messageText).
		Str("type", messageType).
		Bool("isGroup", isGroup).
		Int("journeys_found", len(journeys)).
		Msg("checking journeys")

	for i := range journeys {
		journey := &journeys[i]
		if !journey.ShouldTrigger(messageText, groupJID, messageType, isGroup) {
			log.Debug().Str("journey", journey.ID).Msg("journey not triggered")
			continue
		}

		log.Info().Str("journey", journey.ID).Str("name", journey.Name).Msg("triggering journey")

		// Se a jornada tem fluxo multi-step, usar o executor
		if journey.HasFlow() {
			go func(j *models.Journey) {
				m.executeJourneyWithFlow(j, fromJID, fromName, groupJID, messageText)
			}(journey)
		} else {
			go func(j *models.Journey) {
				if err := m.executeJourney(j, fromJID, fromName, groupJID, messageText, isGroup); err != nil {
					log.Error().Err(err).Str("journey", j.ID).Msg("failed to execute journey")
				}
			}(journey)
		}
	}
}

// executeJourneyWithFlow executa uma jornada com fluxo multi-step
func (m *Manager) executeJourneyWithFlow(journey *models.Journey, fromJID, fromName, groupJID, messageText string) {
	client := m.GetInstance(journey.InstanceID)
	if client == nil {
		log.Error().Str("journey", journey.ID).Msg("instance not running for journey with flow")
		return
	}

	// Criar executor
	sendFunc := func(instanceID, recipientJID, message string) error {
		c := m.GetInstance(instanceID)
		if c == nil {
			return fmt.Errorf("instance not running")
		}
		_, err := c.SendTextMessage(recipientJID, message)
		return err
	}

	// Importar o serviço - aqui fazemos uma referência circular que precisa ser resolvida
	// Por enquanto, usamos o método simples até que o executor seja injetado
	log.Info().
		Str("journey", journey.ID).
		Str("from", fromJID).
		Str("group", groupJID).
		Msg("executando jornada com fluxo")

	// Criar execução no banco
	execution := &models.JourneyExecution{
		JourneyID:   journey.ID,
		InstanceID:  journey.InstanceID,
		ContactJID:  fromJID,
		ContactName: fromName,
		GroupJID:    groupJID,
		Status:      models.ExecutionActive,
		StartedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	flow := journey.GetFlow()
	if flow != nil {
		execution.TotalSteps = len(flow.Steps)
		if flow.StartStep != "" {
			execution.CurrentStep = flow.StartStep
		} else if len(flow.Steps) > 0 {
			execution.CurrentStep = flow.Steps[0].ID
		}
	} else {
		execution.TotalSteps = 1
	}

	m.db.Create(execution)

	// Adicionar mensagem de entrada
	execution.AddMessage("inbound", messageText, "")
	m.db.Save(execution)

	// Executar cada passo do fluxo
	if flow != nil {
		m.executeFlowSteps(journey, execution, flow, fromJID, fromName, groupJID)
	} else {
		// Fallback: enviar a mensagem template como passo único
		responseMsg := buildJourneyResponse(journey, fromName, messageText)
		recipientJID := fromJID
		if journey.ResponseMode == "group" && groupJID != "" {
			recipientJID = groupJID
		} else if !strings.Contains(recipientJID, "@") {
			recipientJID = recipientJID + "@s.whatsapp.net"
		}

		if _, err := client.SendTextMessage(recipientJID, responseMsg); err == nil {
			execution.AddMessage("outbound", responseMsg, "")
		}
		m.completeExecution(execution, journey)
	}

	// Ativar sendFunc variável não usada
	_ = sendFunc
}

// executeFlowSteps executa os passos do fluxo
func (m *Manager) executeFlowSteps(journey *models.Journey, execution *models.JourneyExecution, flow *models.JourneyFlow, fromJID, fromName, groupJID string) {
	client := m.GetInstance(journey.InstanceID)
	if client == nil {
		m.failExecution(execution, "instance not running")
		return
	}

	for i, step := range flow.Steps {
		if execution.Status != models.ExecutionActive {
			break
		}

		execution.CurrentStep = step.ID
		execution.StepIndex = i
		execution.UpdatedAt = time.Now()
		m.db.Save(execution)

		switch step.Type {
		case models.StepTypeMessage:
			var config struct {
				Message string `json:"message"`
				Mode    string `json:"mode"`
			}
			if err := json.Unmarshal(step.Config, &config); err != nil {
				log.Error().Err(err).Str("step", step.ID).Msg("falha ao parsear config")
				continue
			}

			msg := strings.ReplaceAll(config.Message, "{{name}}", fromName)
			msg = strings.ReplaceAll(msg, "{{contact_name}}", fromName)

			recipientJID := fromJID
			if config.Mode == "group" && groupJID != "" {
				recipientJID = groupJID
			} else if !strings.Contains(recipientJID, "@") {
				recipientJID = recipientJID + "@s.whatsapp.net"
			}

			if _, err := client.SendTextMessage(recipientJID, msg); err != nil {
				log.Error().Err(err).Str("step", step.ID).Msg("falha ao enviar mensagem")
				continue
			}
			execution.AddMessage("outbound", msg, step.ID)
			m.db.Save(execution)

		case models.StepTypeWait:
			var config struct {
				Duration string `json:"duration"`
			}
			if err := json.Unmarshal(step.Config, &config); err == nil {
				duration, err := time.ParseDuration(config.Duration)
				if err != nil {
					duration = 5 * time.Second
				}
				if duration > 0 && duration <= 24*time.Hour {
					time.Sleep(duration)
				}
			}
		}

		// Pequeno delay entre passos
		time.Sleep(500 * time.Millisecond)
	}

	m.completeExecution(execution, journey)
}

// completeExecution marca uma execução como completa
func (m *Manager) completeExecution(execution *models.JourneyExecution, journey *models.Journey) {
	now := time.Now()
	execution.Status = models.ExecutionCompleted
	execution.CompletedAt = &now
	execution.UpdatedAt = now
	m.db.Save(execution)

	m.db.Model(journey).Updates(map[string]interface{}{
		"invocations":     journey.Invocations + 1,
		"completed_count": journey.CompletedCount + 1,
		"last_run_at":     now,
	})

	log.Info().
		Str("journey", journey.ID).
		Str("contato", execution.ContactJID).
		Msg("execução de jornada completa")
}

// failExecution marca uma execução como falha
func (m *Manager) failExecution(execution *models.JourneyExecution, errMsg string) {
	now := time.Now()
	execution.Status = models.ExecutionFailed
	execution.ErrorMessage = errMsg
	execution.UpdatedAt = now
	if execution.CompletedAt == nil {
		execution.CompletedAt = &now
	}
	m.db.Save(execution)

	log.Error().
		Str("execution", execution.ID).
		Str("erro", errMsg).
		Msg("execução de jornada falhou")
}

func (m *Manager) executeJourney(journey *models.Journey, fromJID, fromName, groupJID, messageText string, isGroup bool) error {
	client := m.GetInstance(journey.InstanceID)
	if client == nil {
		log.Error().Str("journey", journey.ID).Str("instance", journey.InstanceID).Msg("instance not running for journey")
		return fmt.Errorf("instance not running")
	}

	log.Info().
		Str("journey", journey.ID).
		Str("name", journey.Name).
		Str("from", fromJID).
		Str("fromName", fromName).
		Str("groupJID", groupJID).
		Bool("isGroup", isGroup).
		Str("messageTemplate", journey.MessageTemplate).
		Msg("executing journey - sending message")

	// Create execution record
	execution := &models.JourneyExecution{
		ID:          uuid.New().String(),
		JourneyID:   journey.ID,
		InstanceID:  journey.InstanceID,
		ContactJID:  fromJID,
		ContactName: fromName,
		GroupJID:    groupJID,
		Status:      models.ExecutionActive,
		TotalSteps:  1,
		CurrentStep: "send",
		StepIndex:   0,
		StartedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	m.db.Create(execution)

	// Add inbound message
	execution.AddMessage("inbound", messageText, "trigger")

	responseMsg := buildJourneyResponse(journey, fromName, messageText)

	// Determine recipient based on journey type and group context
	recipientJID := fromJID
	if isGroup && journey.GroupJID != "" {
		// For group triggers, send to the group
		recipientJID = journey.GroupJID
	} else if !strings.Contains(recipientJID, "@") {
		recipientJID = recipientJID + "@s.whatsapp.net"
	}

	if _, err := client.SendTextMessage(recipientJID, responseMsg); err != nil {
		log.Error().Err(err).Str("journey", journey.ID).Str("to", recipientJID).Msg("failed to send journey message")
		execution.Status = models.ExecutionFailed
		execution.ErrorMessage = err.Error()
		execution.UpdatedAt = time.Now()
		execution.CompletedAt = &execution.UpdatedAt
		m.db.Save(execution)
		return fmt.Errorf("failed to send message: %w", err)
	}

	// Add outbound message
	execution.AddMessage("outbound", responseMsg, "send")

	now := time.Now()
	execution.Status = models.ExecutionCompleted
	execution.CompletedAt = &now
	execution.UpdatedAt = now
	m.db.Save(execution)

	m.db.Model(journey).Updates(map[string]interface{}{
		"invocations":     gorm.Expr("invocations + 1"),
		"completed_count": gorm.Expr("completed_count + 1"),
		"last_run_at":     now,
	})

	log.Info().Str("journey", journey.ID).Str("to", recipientJID).Str("message", responseMsg).Msg("journey executed successfully")
	return nil
}

// executeCRMAction executes CRM-related actions for a journey
func (m *Manager) executeCRMAction(actionType models.ActionType, contactPhone, contactName, instanceID string, actionConfig map[string]interface{}) error {
	log.Info().Str("action", string(actionType)).Str("phone", contactPhone).Msg("executing CRM action")

	// Get phone without @s.whatsapp.net
	phone := contactPhone
	if idx := strings.Index(phone, "@"); idx > 0 {
		phone = phone[:idx]
	}

	switch actionType {
	case models.ActionCreateContact, models.ActionCreateLead:
		// Create or update contact in CRM
		instanceUUID, _ := uuid.Parse(instanceID)
		funnel := "Default"
		stage := "Novo"
		if f, ok := actionConfig["funnel"].(string); ok && f != "" {
			funnel = f
		}
		if s, ok := actionConfig["stage"].(string); ok && s != "" {
			stage = s
		}
		if fs, ok := actionConfig["funnel_stage"].(string); ok && fs != "" {
			parts := strings.Split(fs, "/")
			if len(parts) >= 1 && parts[0] != "" {
				funnel = parts[0]
			}
			if len(parts) >= 2 && parts[1] != "" {
				stage = parts[1]
			}
		}

		contactNameToSave := contactName
		if contactNameToSave == "" {
			contactNameToSave = "Cliente " + phone
		}

		// Check if contact exists
		var existing models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&existing).Error; err == nil {
			// Update existing contact
			existing.Funnel = funnel
			existing.Stage = stage
			m.db.Save(&existing)
			log.Info().Str("phone", phone).Str("funnel", funnel).Str("stage", stage).Msg("journey updated contact in CRM")
		} else {
			// Create new contact
			userID := uuid.Nil
			// Try to get user from instance
			var inst models.Instance
			if err := m.db.First(&inst, "id = ?", instanceUUID).Error; err == nil {
				userID = inst.UserID
			}
			contact := models.Contact{
				ID:     uuid.New(),
				UserID: userID,
				Phone:  phone,
				Name:   contactNameToSave,
				Funnel: funnel,
				Stage:  stage,
			}
			// Try to associate with workspace
			if inst.WorkspaceID != nil {
				contact.WorkspaceID = inst.WorkspaceID
			}
			if err := m.db.Create(&contact).Error; err != nil {
				log.Error().Err(err).Str("phone", phone).Msg("journey failed to create contact in CRM")
				return fmt.Errorf("failed to create contact: %w", err)
			}
			log.Info().Str("phone", phone).Str("funnel", funnel).Str("stage", stage).Msg("journey created contact in CRM")
		}

	case models.ActionAddTag:
		// Add tag to contact
		tagName := "Lead"
		if t, ok := actionConfig["tag"].(string); ok && t != "" {
			tagName = t
		}
		// Find or create tag
		var tag models.Tag
		if err := m.db.Where("name = ?", tagName).First(&tag).Error; err != nil {
			tag = models.Tag{Name: tagName, Color: "#00d46a"}
			m.db.Create(&tag)
		}
		// Add tag to contact
		var contact models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
			var contactTags []models.Tag
			m.db.Model(&contact).Association("Tags").Find(&contactTags)
			hasTag := false
			for _, t := range contactTags {
				if t.ID == tag.ID {
					hasTag = true
					break
				}
			}
			if !hasTag {
				m.db.Model(&contact).Association("Tags").Append(&tag)
				log.Info().Str("phone", phone).Str("tag", tagName).Msg("journey added tag to contact")
			}
		}

	case models.ActionUpdateStage:
		// Update contact stage
		funnel := "Default"
		stage := "Novo"
		if f, ok := actionConfig["funnel"].(string); ok && f != "" {
			funnel = f
		}
		if s, ok := actionConfig["stage"].(string); ok && s != "" {
			stage = s
		}
		var contact models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
			contact.Funnel = funnel
			contact.Stage = stage
			m.db.Save(&contact)
			log.Info().Str("phone", phone).Str("funnel", funnel).Str("stage", stage).Msg("journey updated contact stage")
		}

	case models.ActionAddToInbox:
		// Mark contact for inbox review by adding to journey field
		var contact models.Contact
		if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
			contact.Journey = "Aguardando atendimento - " + time.Now().Format("02/01/2006 15:04")
			m.db.Save(&contact)
			log.Info().Str("phone", phone).Msg("journey marked contact for inbox review")
		}

	case models.ActionAssignUser:
		// Assign contact to a user
		userID := ""
		if u, ok := actionConfig["user_id"].(string); ok && u != "" {
			userID = u
		} else if email, ok := actionConfig["user_email"].(string); ok && email != "" {
			var user models.User
			if err := m.db.Where("email = ?", email).First(&user).Error; err == nil {
				userID = user.ID.String()
			}
		}
		if userID != "" {
			var contact models.Contact
			if err := m.db.Where("phone LIKE ?", "%"+phone+"%").First(&contact).Error; err == nil {
				ownerUUID := uuid.MustParse(userID)
				contact.OwnerID = &ownerUUID
				m.db.Save(&contact)
				log.Info().Str("phone", phone).Str("user_id", userID).Msg("journey assigned contact to user")
			}
		}

	default:
		log.Debug().Str("action", string(actionType)).Msg("action not implemented in journey")
	}

	return nil
}

func buildJourneyResponse(journey *models.Journey, fromName, originalMessage string) string {
	if journey.MessageTemplate != "" {
		return strings.ReplaceAll(strings.ReplaceAll(journey.MessageTemplate, "{{name}}", fromName), "{{message}}", originalMessage)
	}

	defaultResponses := []string{
		"Olá " + fromName + "! Recebi sua mensagem. Como posso ajudar?",
		"Oi " + fromName + "! Obrigado por entrar em contato. Em que posso ser útil?",
		"Olá! " + fromName + ", agradecemos o contato. Retornaremos em breve!",
	}
	response := defaultResponses[time.Now().UnixNano()%int64(len(defaultResponses))]

	var rules struct {
		Trigger struct {
			Filter string `json:"filter"`
		} `json:"trigger"`
		Actions []struct {
			Text string `json:"text"`
		} `json:"actions"`
	}

	rulesJSON, _ := json.Marshal(journey.ParsedRules)
	if err := json.Unmarshal(rulesJSON, &rules); err == nil && len(rules.Actions) > 0 && rules.Actions[0].Text != "" {
		response = "Olá " + fromName + "! " + rules.Actions[0].Text
	}

	return response
}
