package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type OTPStatus string

const (
	OTPStatusPending  OTPStatus = "pending"
	OTPStatusVerified OTPStatus = "verified"
	OTPStatusExpired  OTPStatus = "expired"
	OTPStatusFailed   OTPStatus = "failed" // max attempts exceeded
)

// OTPSession represents a single OTP verification request sent via WhatsApp.
type OTPSession struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	Phone      string     `gorm:"not null;index" json:"phone"`
	CodeHash   string     `gorm:"not null" json:"-"` // SHA-256 hex of the plain code
	Status     OTPStatus  `gorm:"type:varchar(20);default:'pending'" json:"status"`
	Attempts   int        `gorm:"default:0" json:"attempts"`
	Resends    int        `gorm:"default:0" json:"resends"`
	ExpiresAt  time.Time  `json:"expires_at"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (o *OTPSession) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}

func (o *OTPSession) IsExpired() bool {
	return time.Now().After(o.ExpiresAt)
}
