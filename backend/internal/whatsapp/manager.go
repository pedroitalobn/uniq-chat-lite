package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"gorm.io/gorm"
)

// Manager manages all active WhatsApp instance clients.
type Manager struct {
	mu           sync.RWMutex
	clients      map[string]*InstanceClient
	consumers    map[string]context.CancelFunc // instanceID → queue consumer cancel
	sessionDir   string
	db           *gorm.DB
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
