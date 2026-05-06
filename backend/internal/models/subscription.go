package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SubscriptionTopic — categoria de comunicação do workspace (newsletter,
// promo, transacional, atualizacoes_produto…). Cada contato pode opt-in
// ou opt-out POR tópico via Subscription Center público.
//
// Inspirado em Customer.io subscription groups + topics.
type SubscriptionTopic struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Slug        string     `gorm:"type:varchar(60);not null;uniqueIndex:uk_topic_slug" json:"slug"`
	Name        string     `gorm:"type:varchar(120);not null" json:"name"`
	Description string     `gorm:"type:text" json:"description,omitempty"`
	// IsRequired: tópicos transacionais (ex: "atualizações de pedido")
	// não podem ser desativados pelo cliente. Default false.
	IsRequired  bool       `gorm:"default:false" json:"is_required"`
	// DefaultOptIn: novos contatos entram opt-in automático? false=opt-in
	// explícito (LGPD-strict), true=opt-out (precisa ativamente sair).
	DefaultOptIn bool      `gorm:"default:false" json:"default_opt_in"`
	IsActive    bool       `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (t *SubscriptionTopic) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

// ContactSubscription — preferência opt-in/opt-out de um contato pra um
// tópico. Ausência de registro = usa DefaultOptIn do tópico.
type ContactSubscription struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index:idx_subs_lookup" json:"workspace_id"`
	ContactID   uuid.UUID  `gorm:"type:uuid;not null;index:idx_subs_lookup" json:"contact_id"`
	TopicID     uuid.UUID  `gorm:"type:uuid;not null;index:idx_subs_lookup" json:"topic_id"`
	OptedIn     bool       `gorm:"default:true" json:"opted_in"`
	Source      string     `gorm:"type:varchar(40);default:'manual'" json:"source"` // manual/preference_center/api/journey
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (s *ContactSubscription) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// PreferenceLink — token público para acessar o Preference Center.
// Enviado em cada mensagem como link de descadastrar (LGPD).
type PreferenceLink struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Token       string     `gorm:"type:varchar(64);uniqueIndex" json:"token"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	ContactID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"contact_id"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"` // nil = permanente
	UsedCount   int        `gorm:"default:0" json:"used_count"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (l *PreferenceLink) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}
