package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Segment — segmentação dinâmica de contatos. Inspirado em Customer.io
// data-driven segments + Close SmartViews.
//
// Filter (JSON) usa o mesmo shape do segment_filter de campanhas + DSL:
//   { "_op": "and",
//     "funnel": "Vendas",
//     "tags": ["vip"],
//     "purchased_min_total": 500,
//     "passed_agent_id": "<uuid>" }
//
// Type controla se é dinâmico (recalcula on-demand) ou manual (membros
// fixos via CSV/api).
type Segment struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	OwnerUserID uuid.UUID  `gorm:"type:uuid;not null;index" json:"owner_user_id"`
	Name        string     `gorm:"type:varchar(180);not null" json:"name"`
	Description string     `gorm:"type:text" json:"description,omitempty"`
	// Type: "dynamic" (filter SQL roda toda vez) ou "manual" (lista fixa).
	Type   string `gorm:"type:varchar(20);default:'dynamic';index" json:"type"`
	Filter string `gorm:"type:text;default:'{}'" json:"filter"`
	// MemberCount — populado por cron/refresh; cache pra UI.
	MemberCount int       `gorm:"default:0" json:"member_count"`
	LastRefreshedAt *time.Time `json:"last_refreshed_at,omitempty"`
	IsActive    bool       `gorm:"default:true" json:"is_active"`
	// Triggers — quando contato entra/sai do segment, dispara journey
	// configurada por TriggerJourneyID. Customer.io segment-as-trigger.
	TriggerJourneyID *uuid.UUID `gorm:"type:uuid" json:"trigger_journey_id,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (s *Segment) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// SegmentMember — apenas pra type=manual ou snapshot. Para dynamic
// não populamos (evita schema bloat).
type SegmentMember struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	SegmentID  uuid.UUID `gorm:"type:uuid;not null;index:idx_segment_member" json:"segment_id"`
	ContactID  uuid.UUID `gorm:"type:uuid;not null;index:idx_segment_member" json:"contact_id"`
	AddedAt    time.Time `json:"added_at"`
	Source     string    `gorm:"type:varchar(40);default:'manual'" json:"source"` // manual/csv/api/computed
}

func (m *SegmentMember) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

// ContactAlias — Identity Resolution (Customer.io). Permite mesmo
// contato ter múltiplos identificadores (phone, email, instagram_id,
// external_id). Merge resolve duplicatas via aliases.
type ContactAlias struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index:idx_alias_lookup" json:"workspace_id"`
	ContactID   uuid.UUID `gorm:"type:uuid;not null;index" json:"contact_id"`
	Kind        string    `gorm:"type:varchar(40);not null;index:idx_alias_lookup" json:"kind"` // phone/email/jid/instagram/external_id
	Value       string    `gorm:"type:varchar(255);not null;index:idx_alias_lookup" json:"value"`
	CreatedAt   time.Time `json:"created_at"`
}

func (a *ContactAlias) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
