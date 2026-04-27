package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UsageCounter rastreia uso diário por user (não por instance) — pra
// limites de plano (MaxMessagesPerDay) que são por conta. Granularidade
// dia + tipo. Persiste mesmo após reset (histórico).
//
// Tipos:
//   "messages_sent"  — mensagens outbound do dia (todas instâncias do user)
//   "messages_recv"  — inbound (informativo, não tem limite)
//   "ai_invocations" — chamadas LLM (futuro: limit por plano)
//   "campaign_recipients" — destinatários processados em campanhas
type UsageCounter struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_usage_user_day,priority:1" json:"user_id"`
	Day    string    `gorm:"type:varchar(10);not null;index:idx_usage_user_day,priority:2" json:"day"` // "2026-04-27"
	Type   string    `gorm:"type:varchar(30);not null;index:idx_usage_user_day,priority:3" json:"type"`
	Count  int       `gorm:"default:0" json:"count"`

	// AlertedAt: quando atingiu 80% (alerta enviado). Nil = ainda não.
	// Usado pra evitar disparar várias notificações no mesmo dia.
	AlertedAt *time.Time `json:"alerted_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (u *UsageCounter) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

const (
	UsageTypeMessagesSent       = "messages_sent"
	UsageTypeMessagesReceived   = "messages_recv"
	UsageTypeAIInvocations      = "ai_invocations"
	UsageTypeCampaignRecipients = "campaign_recipients"
)
