// Package queue manages an internal RabbitMQ-based message queue for WhatsApp sends.
// Each WhatsApp instance gets its own AMQP queue, ensuring sends are serialized
// per instance and processed with anti-ban delays.
package queue

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/rs/zerolog/log"
)

// ── Constants ─────────────────────────────────────────────────────────────────

const (
	ExchangeName = "uniqchat"        // main topic exchange
	DLXName      = "uniqchat.dlx"   // dead-letter exchange (fanout)
	DLQName      = "uniqchat.dlq"   // dead-letter queue
	queuePrefix  = "uniqchat.send." // per-instance queue prefix
	routingPfx   = "send."           // routing key prefix
	maxRetries   = 3
)

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageType string

const (
	TypeText     MessageType = "text"
	TypeImage    MessageType = "image"
	TypeDocument MessageType = "document"
	TypeAudio    MessageType = "audio"
	TypeVideo    MessageType = "video"
	TypeLocation MessageType = "location"
	TypeReaction MessageType = "reaction"
	TypeRevoke   MessageType = "revoke"
)

// SendOptions controls anti-ban behavior for a single message.
type SendOptions struct {
	// DelayMs is the mandatory pause AFTER the message is sent (ms).
	// A random jitter of 0–500 ms is always added on top.
	DelayMs int `json:"delay_ms"`

	// SimulateTyping sends a typing presence indicator before the message.
	SimulateTyping bool `json:"simulate_typing"`

	// TypingDurationMs overrides the auto-computed typing duration.
	// When 0, duration is computed as min(len(text)*60ms, 5000ms), min 800ms.
	TypingDurationMs int `json:"typing_duration_ms,omitempty"`
}

// SendPayload carries the message content for any message type.
type SendPayload struct {
	To           string  `json:"to"`
	Text         string  `json:"text,omitempty"`
	Caption      string  `json:"caption,omitempty"`
	MediaB64     string  `json:"media_b64,omitempty"`
	MediaURL     string  `json:"media_url,omitempty"` // MinIO/S3 URL (preferred over B64)
	MimeType     string  `json:"mime_type,omitempty"`
	Filename     string  `json:"filename,omitempty"`
	Latitude     float64 `json:"latitude,omitempty"`
	Longitude    float64 `json:"longitude,omitempty"`
	LocationName string  `json:"location_name,omitempty"`
	MessageID    string  `json:"message_id,omitempty"` // reaction / revoke target
	SenderJID    string  `json:"sender_jid,omitempty"`
	Reaction     string  `json:"reaction,omitempty"`
	PTT          bool    `json:"ptt,omitempty"`
}

// SendJob is the unit of work placed on the queue.
type SendJob struct {
	ID         uuid.UUID   `json:"id"`
	InstanceID string      `json:"instance_id"`
	Type       MessageType `json:"type"`
	Payload    SendPayload `json:"payload"`
	Options    SendOptions `json:"options"`
	RetryCount int         `json:"retry_count"`
	CreatedAt  time.Time   `json:"created_at"`
}

// ── Manager ───────────────────────────────────────────────────────────────────

// Manager owns the single persistent AMQP connection and a shared publish channel.
// Each instance gets its own consumer goroutine with a dedicated channel.
type Manager struct {
	url     string
	mu      sync.Mutex
	conn    *amqp.Connection
	pubCh   *amqp.Channel // shared publish channel (mutex-protected)
	queues  map[string]struct{}
	done    chan struct{}
	once    sync.Once
}

// GlobalQueue is the application-wide singleton.
var GlobalQueue *Manager

// NewManager creates a Manager but does not connect yet.
func NewManager(amqpURL string) *Manager {
	m := &Manager{
		url:    amqpURL,
		queues: make(map[string]struct{}),
		done:   make(chan struct{}),
	}
	GlobalQueue = m
	return m
}

// Connect establishes the AMQP connection and topology. Idempotent.
func (m *Manager) Connect() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.conn != nil && !m.conn.IsClosed() {
		return nil // already connected
	}

	conn, err := amqp.Dial(m.url)
	if err != nil {
		return fmt.Errorf("rabbitmq: dial %s: %w", m.url, err)
	}

	if err := m.setupTopology(conn); err != nil {
		conn.Close()
		return err
	}

	m.conn = conn
	m.queues = make(map[string]struct{}) // reset known queues on reconnect

	log.Info().Msg("rabbitmq: connected")
	go m.watchReconnect(conn)
	return nil
}

func (m *Manager) setupTopology(conn *amqp.Connection) error {
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("rabbitmq: open topology channel: %w", err)
	}
	defer ch.Close()

	// Main topic exchange
	if err := ch.ExchangeDeclare(ExchangeName, "topic", true, false, false, false, nil); err != nil {
		return fmt.Errorf("rabbitmq: declare exchange: %w", err)
	}
	// Dead-letter exchange
	if err := ch.ExchangeDeclare(DLXName, "fanout", true, false, false, false, nil); err != nil {
		return fmt.Errorf("rabbitmq: declare DLX: %w", err)
	}
	// Dead-letter queue
	if _, err := ch.QueueDeclare(DLQName, true, false, false, false, nil); err != nil {
		return fmt.Errorf("rabbitmq: declare DLQ: %w", err)
	}
	if err := ch.QueueBind(DLQName, "#", DLXName, false, nil); err != nil {
		return fmt.Errorf("rabbitmq: bind DLQ: %w", err)
	}

	// Dedicated publish channel
	pubCh, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("rabbitmq: open publish channel: %w", err)
	}
	m.pubCh = pubCh
	return nil
}

func (m *Manager) watchReconnect(conn *amqp.Connection) {
	reason := <-conn.NotifyClose(make(chan *amqp.Error, 1))
	select {
	case <-m.done:
		return
	default:
	}
	if reason != nil {
		log.Warn().Str("reason", reason.Reason).Msg("rabbitmq: connection lost, reconnecting")
	}
	m.mu.Lock()
	m.conn = nil
	m.pubCh = nil
	m.mu.Unlock()

	for {
		select {
		case <-m.done:
			return
		case <-time.After(5 * time.Second):
		}
		if err := m.Connect(); err != nil {
			log.Warn().Err(err).Msg("rabbitmq: reconnect failed, retrying in 5s")
		} else {
			log.Info().Msg("rabbitmq: reconnected")
			return
		}
	}
}

// IsConnected returns whether the connection is alive.
func (m *Manager) IsConnected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.conn != nil && !m.conn.IsClosed()
}

// ensureQueue declares the per-instance queue (idempotent, cached).
func (m *Manager) ensureQueue(instanceID string) error {
	qName := queuePrefix + instanceID
	if _, ok := m.queues[qName]; ok {
		return nil
	}
	if m.conn == nil || m.conn.IsClosed() {
		return fmt.Errorf("rabbitmq: not connected")
	}
	ch, err := m.conn.Channel()
	if err != nil {
		return err
	}
	defer ch.Close()

	args := amqp.Table{
		"x-dead-letter-exchange": DLXName,
		"x-message-ttl":          int64(24 * 60 * 60 * 1000), // 24h
	}
	if _, err := ch.QueueDeclare(qName, true, false, false, false, args); err != nil {
		return fmt.Errorf("rabbitmq: declare queue %s: %w", qName, err)
	}
	if err := ch.QueueBind(qName, routingPfx+instanceID, ExchangeName, false, nil); err != nil {
		return fmt.Errorf("rabbitmq: bind queue %s: %w", qName, err)
	}
	m.queues[qName] = struct{}{}
	return nil
}

// Enqueue publishes a SendJob to the instance's queue.
// Returns an error if the queue is unavailable; callers should fall back to direct send.
func (m *Manager) Enqueue(job SendJob) error {
	if job.ID == uuid.Nil {
		job.ID = uuid.New()
	}
	if job.CreatedAt.IsZero() {
		job.CreatedAt = time.Now()
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.conn == nil || m.conn.IsClosed() {
		return fmt.Errorf("rabbitmq: not connected")
	}
	if err := m.ensureQueue(job.InstanceID); err != nil {
		return err
	}

	body, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("queue: marshal: %w", err)
	}

	// Recreate publish channel if closed
	if m.pubCh == nil {
		m.pubCh, err = m.conn.Channel()
		if err != nil {
			return fmt.Errorf("rabbitmq: reopen publish channel: %w", err)
		}
	}

	return m.pubCh.Publish(ExchangeName, routingPfx+job.InstanceID, false, false, amqp.Publishing{
		ContentType:  "application/json",
		Body:         body,
		DeliveryMode: amqp.Persistent,
		Timestamp:    job.CreatedAt,
		MessageId:    job.ID.String(),
		Headers: amqp.Table{
			"X-Instance-ID":   job.InstanceID,
			"X-Message-Type":  string(job.Type),
			"X-Retry-Count":   int64(job.RetryCount),
		},
	})
}

// StartConsumer launches a per-instance consumer goroutine.
// handler is called synchronously for each job (so one message at a time per instance).
// The goroutine exits when ctx is cancelled.
func (m *Manager) StartConsumer(ctx context.Context, instanceID string, handler func(SendJob) error) {
	go m.runConsumer(ctx, instanceID, handler)
}

func (m *Manager) runConsumer(ctx context.Context, instanceID string, handler func(SendJob) error) {
	qName := queuePrefix + instanceID
	log.Info().Str("instance", instanceID).Msg("queue: consumer starting")

	for {
		select {
		case <-ctx.Done():
			log.Info().Str("instance", instanceID).Msg("queue: consumer stopped")
			return
		default:
		}

		if !m.IsConnected() {
			time.Sleep(2 * time.Second)
			continue
		}

		m.mu.Lock()
		if err := m.ensureQueue(instanceID); err != nil {
			m.mu.Unlock()
			time.Sleep(3 * time.Second)
			continue
		}
		ch, err := m.conn.Channel()
		m.mu.Unlock()
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}

		// Process one message at a time per instance (anti-ban serialization)
		if err := ch.Qos(1, 0, false); err != nil {
			ch.Close()
			time.Sleep(2 * time.Second)
			continue
		}

		deliveries, err := ch.Consume(qName, "uniqchat."+instanceID, false, false, false, false, nil)
		if err != nil {
			ch.Close()
			time.Sleep(2 * time.Second)
			continue
		}

		log.Info().Str("instance", instanceID).Str("queue", qName).Msg("queue: consuming")

		for {
			select {
			case <-ctx.Done():
				ch.Close()
				return

			case d, ok := <-deliveries:
				if !ok {
					// Channel closed — reconnect loop
					ch.Close()
					goto nextConn
				}

				var job SendJob
				if err := json.Unmarshal(d.Body, &job); err != nil {
					log.Error().Err(err).Msg("queue: invalid message body")
					d.Nack(false, false) // → DLQ
					continue
				}

				if err := handler(job); err != nil {
					log.Warn().Err(err).
						Str("job", job.ID.String()).
						Str("instance", instanceID).
						Int("retry", job.RetryCount).
						Msg("queue: job failed")

					d.Ack(false) // remove from queue regardless
					if job.RetryCount < maxRetries {
						job.RetryCount++
						// Re-enqueue after a back-off
						go func(j SendJob) {
							time.Sleep(time.Duration(j.RetryCount*5) * time.Second)
							if err := m.Enqueue(j); err != nil {
								log.Error().Err(err).Str("job", j.ID.String()).Msg("queue: requeue failed")
								// Publish directly to DLQ
								m.sendToDLQ(j)
							}
						}(job)
					} else {
						m.sendToDLQ(job)
					}
				} else {
					d.Ack(false)
				}
			}
		}

	nextConn:
		time.Sleep(2 * time.Second)
	}
}

func (m *Manager) sendToDLQ(job SendJob) {
	body, _ := json.Marshal(job)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pubCh == nil {
		return
	}
	_ = m.pubCh.Publish(DLXName, "", false, false, amqp.Publishing{
		ContentType:  "application/json",
		Body:         bytes.Clone(body),
		DeliveryMode: amqp.Persistent,
	})
}

// Close shuts down the manager.
func (m *Manager) Close() {
	m.once.Do(func() {
		close(m.done)
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.pubCh != nil {
			m.pubCh.Close()
		}
		if m.conn != nil && !m.conn.IsClosed() {
			m.conn.Close()
		}
	})
}

// QueueLength returns the approximate number of messages waiting for a given instance.
func (m *Manager) QueueLength(instanceID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.conn == nil || m.conn.IsClosed() {
		return 0, fmt.Errorf("not connected")
	}
	ch, err := m.conn.Channel()
	if err != nil {
		return 0, err
	}
	defer ch.Close()
	q, err := ch.QueueInspect(queuePrefix + instanceID)
	if err != nil {
		return 0, err
	}
	return q.Messages, nil
}
