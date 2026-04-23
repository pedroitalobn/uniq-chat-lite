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
	ID             uuid.UUID        `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID     uuid.UUID        `gorm:"type:uuid;not null;index" json:"instance_id"`
	Instance       *Instance        `gorm:"foreignKey:InstanceID" json:"instance,omitempty"`
	WorkspaceID    *uuid.UUID       `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	UserID         *uuid.UUID       `gorm:"type:uuid;index" json:"user_id,omitempty"`
	ConversationID *uuid.UUID       `gorm:"type:uuid;index" json:"conversation_id,omitempty"`
	Direction      MessageDirection `gorm:"type:varchar(5);not null" json:"direction"`
	Type           string           `gorm:"type:varchar(30);not null" json:"type"`
	ToJID          string           `gorm:"column:to_jid;type:varchar(100)" json:"to_jid,omitempty"`
	ContactName    string           `gorm:"type:varchar(255)" json:"contact_name,omitempty"`
	ContactAvatar  string           `gorm:"type:text" json:"contact_avatar,omitempty"`
	SenderJID      string           `gorm:"column:sender_jid;type:varchar(100)" json:"sender_jid,omitempty"`
	SenderName     string           `gorm:"type:varchar(255)" json:"sender_name,omitempty"`
	Content        string           `gorm:"type:text" json:"content"`
	Status         MessageStatus    `gorm:"type:varchar(20);default:'pending'" json:"status"`
	IsPinned       bool             `gorm:"default:false" json:"is_pinned"`
	IsFavorite     bool             `gorm:"default:false" json:"is_favorite"`
	IsArchived     bool             `gorm:"default:false" json:"is_archived"`
	IsDeleted      bool             `gorm:"default:false" json:"is_deleted"`
	IsInternalNote bool             `gorm:"default:false" json:"is_internal_note"`
	ReplyToID      *uuid.UUID       `gorm:"type:uuid;index" json:"reply_to_id,omitempty"`
	CreatedAt      time.Time        `json:"created_at"`
}

func (m *MessageLog) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.InstanceID != uuid.Nil && (m.WorkspaceID == nil || m.UserID == nil) {
		var instance Instance
		if err := tx.First(&instance, "id = ?", m.InstanceID).Error; err == nil {
			if m.UserID == nil {
				m.UserID = &instance.UserID
			}
			if m.WorkspaceID == nil {
				m.WorkspaceID = instance.WorkspaceID
			}
		}
	}
	return nil
}
