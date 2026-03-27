package models

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type APIKey struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	User       *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Name       string     `gorm:"not null" json:"name"`
	KeyHash    string     `gorm:"not null;uniqueIndex" json:"-"`
	KeyPrefix  string     `gorm:"not null" json:"key_prefix"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	IsActive   bool       `gorm:"default:true" json:"is_active"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (k *APIKey) BeforeCreate(tx *gorm.DB) error {
	if k.ID == uuid.Nil {
		k.ID = uuid.New()
	}
	return nil
}

// GenerateAPIKey creates a new random API key, returns (plaintext, hash, prefix)
func GenerateAPIKey() (plaintext, hash, prefix string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return
	}
	plaintext = "sk_" + hex.EncodeToString(b)
	prefix = plaintext[:10]
	sum := sha256.Sum256([]byte(plaintext))
	hash = fmt.Sprintf("%x", sum)
	return
}

// HashAPIKey returns the SHA-256 hash of a plaintext API key
func HashAPIKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return fmt.Sprintf("%x", sum)
}

// MaskKey masks everything after the prefix
func (k *APIKey) MaskKey() string {
	return k.KeyPrefix + "..." + "****"
}

// GenerateSecret generates a random webhook secret
func GenerateSecret() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
