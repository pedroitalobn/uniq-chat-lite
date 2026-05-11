package models

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PendingRegistration stores a magic-link token before the user completes signup.
// Flow: /register/start → email sent → /register/verify (token) → /register/complete (profile).
type PendingRegistration struct {
	ID                   uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Token                string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"`
	Email                string     `gorm:"type:varchar(255);not null;index" json:"email"`
	PlanID               *uuid.UUID `gorm:"type:uuid" json:"plan_id,omitempty"`
	InviteCode           string     `gorm:"type:varchar(64)" json:"invite_code,omitempty"`
	WorkspaceInviteToken string     `gorm:"type:varchar(64)" json:"workspace_invite_token,omitempty"`
	ExpiresAt            time.Time  `json:"expires_at"`
	VerifiedAt           *time.Time `json:"verified_at,omitempty"`  // set after magic link click
	CompletedAt          *time.Time `json:"completed_at,omitempty"` // set after profile submitted (paid plans: só após webhook de pagamento)
	CreatedAt            time.Time  `json:"created_at"`

	// Snapshot do form da etapa /register/complete pra planos pagos —
	// guardamos aqui tudo que é necessário pra materializar User+Workspace
	// depois que o Stripe confirmar o pagamento via webhook. Antes a conta
	// era criada inativa antes do checkout, agora só existe se o pagamento
	// passou.
	Name             string `gorm:"type:varchar(255)" json:"-"`
	Phone            string `gorm:"type:varchar(30)" json:"-"`
	CountryCode      string `gorm:"type:varchar(2)" json:"-"`
	TaxID            string `gorm:"type:varchar(64)" json:"-"`
	Username         string `gorm:"type:varchar(60)" json:"-"`
	WorkspaceName    string `gorm:"type:varchar(120)" json:"-"`
	PasswordHash     string `gorm:"type:varchar(255)" json:"-"`
	StripeCustomerID string `gorm:"type:varchar(64);index" json:"-"`
	StripeSessionID  string `gorm:"type:varchar(128);index" json:"-"`
	StripePIID       string `gorm:"type:varchar(128);index" json:"-"`
	AbaCustID        string `gorm:"type:varchar(128);index" json:"-"`
}

func (p *PendingRegistration) BeforeCreate(_ *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	if p.Token == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		p.Token = hex.EncodeToString(b)
	}
	return nil
}

func (p *PendingRegistration) IsExpired() bool {
	return time.Now().After(p.ExpiresAt)
}

func (p *PendingRegistration) IsVerified() bool {
	return p.VerifiedAt != nil
}

func (p *PendingRegistration) IsCompleted() bool {
	return p.CompletedAt != nil
}
