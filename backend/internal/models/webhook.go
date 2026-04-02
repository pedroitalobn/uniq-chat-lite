package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Webhook is an HTTP endpoint with optional bridges to RabbitMQ, NATS and WebSocket.
type Webhook struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID uuid.UUID `gorm:"type:uuid;not null;index" json:"instance_id"`

	Name     string `gorm:"type:varchar(100)" json:"name"`
	IsActive bool   `gorm:"default:true" json:"is_active"`
	Events   string `gorm:"type:text;default:'[]'" json:"events"` // JSON array

	// Filter flags
	IgnoreGroups  bool `gorm:"default:false" json:"ignore_groups"`
	IgnoreSelf    bool `gorm:"default:false" json:"ignore_self"`
	IgnoreAPISent bool `gorm:"default:false" json:"ignore_api_sent"`

	// HTTP endpoint (primary)
	URL    string `gorm:"type:text" json:"url,omitempty"`
	Secret string `gorm:"type:varchar(100)" json:"-"`

	// RabbitMQ bridge
	RabbitMQEnabled bool   `gorm:"column:rabbitmq_enabled;default:false" json:"rabbitmq_enabled"`
	AMQPURL         string `gorm:"type:text;column:amqp_url" json:"amqp_url,omitempty"`
	Exchange        string `gorm:"type:varchar(255)" json:"exchange,omitempty"`
	RoutingKey      string `gorm:"type:varchar(255)" json:"routing_key,omitempty"`

	// NATS bridge
	NATSEnabled bool   `gorm:"column:nats_enabled;default:false" json:"nats_enabled"`
	NATSURL     string `gorm:"type:text;column:nats_url" json:"nats_url,omitempty"`
	NATSSubject string `gorm:"type:varchar(255);column:nats_subject" json:"nats_subject,omitempty"`
	NATSToken   string `gorm:"type:varchar(255);column:nats_token" json:"-"`

	// WebSocket client bridge
	WSEnabled     bool   `gorm:"column:ws_enabled;default:false" json:"ws_enabled"`
	WSClientURL   string `gorm:"type:text;column:ws_client_url" json:"ws_client_url,omitempty"`
	WSClientToken string `gorm:"type:varchar(255);column:ws_client_token" json:"-"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (w *Webhook) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}

// GlobalWebhook is a system-wide webhook that fires on platform events
type GlobalWebhook struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name      string    `gorm:"type:varchar(100)" json:"name"`
	IsActive  bool      `gorm:"default:true" json:"is_active"`
	URL       string    `gorm:"type:text" json:"url"`
	Secret    string    `gorm:"type:varchar(100)" json:"-"`
	Events    string    `gorm:"type:text;default:'[]'" json:"events"` // JSON array
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (w *GlobalWebhook) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}
