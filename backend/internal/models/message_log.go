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
	// ExternalMessageID — id da msg no canal externo (ex.: stanza_id WhatsApp,
	// message_id Instagram). Indexed por (instance_id, external_message_id)
	// pra lookup O(log n) ao correlacionar quotes/replies.
	ExternalMessageID string `gorm:"type:varchar(120);index" json:"external_message_id,omitempty"`
	// Timestamps de receipt — preenchidos quando chega events.Receipt do
	// whatsmeow (ou equivalente WABA/IG). DeliveredAt = 2 ticks cinzas,
	// ReadAt = 2 ticks azuis. Status string acompanha pro front simples.
	DeliveredAt *time.Time `json:"delivered_at,omitempty"`
	ReadAt      *time.Time `json:"read_at,omitempty"`
	// IsEdited — flag pra mostrar selo "editada" na bubble. Atualizado
	// quando chega events.Message com IsEdit=true matching a MessageLog
	// existente via reply_to/external_id.
	IsEdited      bool   `gorm:"default:false" json:"is_edited"`
	DeliveryError string `gorm:"type:text" json:"delivery_error,omitempty"`
	// Transcription preenchido async pra mensagens type=audio. Workflow:
	//   1. Audio chega → MessageLog persistida com Transcription="" e
	//      TranscriptionStatus="pending".
	//   2. Goroutine baixa o blob, transcreve via Whisper (provider da
	//      Uniq AI) e atualiza estes campos.
	//   3. WS broadcast "message.transcribed" notifica o front pra
	//      atualizar a bubble in-place.
	// Status possíveis: pending | done | failed | unsupported.
	Transcription       string `gorm:"type:text" json:"transcription,omitempty"`
	TranscriptionStatus string `gorm:"type:varchar(20);index" json:"transcription_status,omitempty"`
	CreatedAt     time.Time `json:"created_at"`

	// ReplyTo é um snapshot in-memory da mensagem citada — preenchido pelo
	// Timeline handler em batch. Não é persistido. Permite ao frontend
	// renderizar o "quoted preview" sem N+1 queries.
	ReplyTo *MessageLogReplyPreview `gorm:"-" json:"reply_to,omitempty"`
}

// MessageLogReplyPreview — versão enxuta usada como snapshot citado.
// Conteúdo limitado ao essencial pra renderizar a quote (sender, texto curto,
// preview de mídia). Não traz status/flags/timestamps detalhados.
type MessageLogReplyPreview struct {
	ID         uuid.UUID        `json:"id"`
	Direction  MessageDirection `json:"direction"`
	Type       string           `json:"type"`
	Text       string           `json:"text,omitempty"`
	SenderName string           `json:"sender_name,omitempty"`
	MediaURL   string           `json:"media_url,omitempty"`
	MimeType   string           `json:"mime_type,omitempty"`
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
