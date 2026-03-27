package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MessageDirection string
type MessageStatus string

const (
	DirectionIn  MessageDirection = "in"
	DirectionOut MessageDirection = "out"

	MessageStatusPending   MessageStatus = "pending"
	MessageStatusSent      MessageStatus = "sent"
	MessageStatusDelivered MessageStatus = "delivered"
	MessageStatusRead      MessageStatus = "read"
	MessageStatusFailed    MessageStatus = "failed"
)

type MessageLog struct {
	ID         uuid.UUID        `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID uuid.UUID        `gorm:"type:uuid;not null;index" json:"instance_id"`
	Direction  MessageDirection `gorm:"type:varchar(5);not null" json:"direction"`
	Type       string           `gorm:"type:varchar(30);not null" json:"type"`
	ToJID      string           `gorm:"type:varchar(100)" json:"to_jid,omitempty"`
	Content    string           `gorm:"type:text" json:"content"` // JSON
	Status     MessageStatus    `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt  time.Time        `json:"created_at"`
}

func (m *MessageLog) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}
