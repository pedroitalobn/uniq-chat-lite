package models

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PasswordResetToken struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	Token     string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"token"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

func (t *PasswordResetToken) BeforeCreate(_ *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	if t.Token == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		t.Token = hex.EncodeToString(b)
	}
	return nil
}

// IsValid returns true if the token has not been used and has not expired.
func (t *PasswordResetToken) IsValid() bool {
	return t.UsedAt == nil && time.Now().Before(t.ExpiresAt)
}
