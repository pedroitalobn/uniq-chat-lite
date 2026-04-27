package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PlanChangeSource indica de onde veio a mudança de plano.
type PlanChangeSource string

const (
	PlanChangeSourceStripe PlanChangeSource = "stripe"
	PlanChangeSourceAsaas  PlanChangeSource = "asaas"
	PlanChangeSourceAdmin  PlanChangeSource = "admin"  // troca manual via /admin/users
	PlanChangeSourceSelf   PlanChangeSource = "self"   // user clicou Upgrade
	PlanChangeSourceTrial  PlanChangeSource = "trial"  // expirou trial → downgrade automático
	PlanChangeSourceSignup PlanChangeSource = "signup" // novo cadastro
)

// PlanChangeLog registra TODA mudança de plano de um user — pra audit
// e suporte. Permite responder "quando o cliente subiu pra Pro?" e
// "quem aprovou o downgrade?".
type PlanChangeLog struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	FromPlanID *uuid.UUID `gorm:"type:uuid" json:"from_plan_id,omitempty"`
	ToPlanID   *uuid.UUID `gorm:"type:uuid" json:"to_plan_id,omitempty"`
	FromPlanName string  `gorm:"type:varchar(120)" json:"from_plan_name,omitempty"`
	ToPlanName   string  `gorm:"type:varchar(120)" json:"to_plan_name,omitempty"`

	Source     PlanChangeSource `gorm:"type:varchar(20);not null;index" json:"source"`
	ActorID    *uuid.UUID       `gorm:"type:uuid" json:"actor_id,omitempty"` // quem fez (admin/self user_id)
	ActorEmail string           `gorm:"type:varchar(255)" json:"actor_email,omitempty"`

	// Stripe context (quando source=stripe)
	StripeSubscriptionID string `gorm:"type:varchar(255)" json:"stripe_subscription_id,omitempty"`
	ProrationAmount      int64  `json:"proration_amount,omitempty"` // centavos. + = cobrado, - = creditado.

	// Notas livres (motivo do admin, etc).
	Notes string `gorm:"type:text" json:"notes,omitempty"`

	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (l *PlanChangeLog) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}
