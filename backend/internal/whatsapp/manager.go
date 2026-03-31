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
	if err := m.db.Find(&instances, "status = ?", models.StatusConnected).Error; err != nil {
		log.Error().Err(err).Msg("failed to load instances")
		return
	}

	for i := range instances {
		// Mark as connecting while we attempt to restore the session
		m.db.Model(&instances[i]).Update("status", models.StatusConnecting)
		if err := m.StartInstance(&instances[i]); err != nil {
			log.Error().Err(err).Str("instance", instances[i].ID.String()).Msg("failed to start instance on boot")
			m.db.Model(&instances[i]).Update("status", models.StatusDisconnected)
		}
	}
	log.Info().Int("count", len(instances)).Msg("loaded WhatsApp instances")
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
		if status == "connected" {
			now := time.Now()
			m.db.Model(&models.Instance{}).Where("id = ?", instanceID).Updates(map[string]interface{}{
				"status":       models.StatusConnected,
				"connected_at": now,
			})
		} else {
			m.db.Model(&models.Instance{}).Where("id = ?", instanceID).Update("status", models.StatusDisconnected)
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
func (m *Manager) CheckJourneys(instanceID, fromJID, fromName, groupJID, messageText string) {
	instUUID, err := uuid.Parse(instanceID)
	if err != nil {
		return
	}

	var journeys []models.Journey
	if err := m.db.Preload("Instance").Where("instance_id = ? AND status = 'active'", instUUID).Find(&journeys).Error; err != nil {
		return
	}

	for i := range journeys {
		journey := &journeys[i]
		if !journey.ShouldTrigger(messageText, groupJID) {
			continue
		}

		// Se a jornada tem fluxo multi-step, usar o executor
		if journey.HasFlow() {
			go func(j *models.Journey) {
				m.executeJourneyWithFlow(j, fromJID, fromName, groupJID, messageText)
			}(journey)
		} else {
			go func(j *models.Journey) {
				if err := m.executeJourney(j, fromJID, fromName, messageText); err != nil {
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

func (m *Manager) executeJourney(journey *models.Journey, fromJID, fromName, messageText string) error {
	client := m.GetInstance(journey.InstanceID)
	if client == nil {
		return fmt.Errorf("instance not running")
	}

	responseMsg := buildJourneyResponse(journey, fromName, messageText)

	recipientJID := fromJID
	if !strings.Contains(fromJID, "@") {
		recipientJID = fromJID + "@s.whatsapp.net"
	}

	if _, err := client.SendTextMessage(recipientJID, responseMsg); err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	now := time.Now()
	m.db.Model(journey).Updates(map[string]interface{}{
		"invocations": journey.Invocations + 1,
		"last_run_at": now,
	})

	log.Info().Str("journey", journey.ID).Str("to", recipientJID).Msg("journey executed")
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
