package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PlatformAI armazena a configuração global de IA da plataforma (Uniq AI).
// Único registro — funciona como singleton. O admin configura qual LLM provider
// e credenciais usar; todos os usuários podem usar via integration virtual.
type PlatformAI struct {
	ID       uuid.UUID           `gorm:"type:uuid;primaryKey" json:"id"`
	Provider IntegrationProvider `gorm:"type:varchar(50);not null" json:"provider"`
	Name     string              `gorm:"type:varchar(100);not null;default:'Uniq AI'" json:"name"`
	APIKey   string              `gorm:"type:text" json:"-"` // nunca exposto na API
	BaseURL  string              `gorm:"type:varchar(255)" json:"base_url,omitempty"`
	Models   string              `gorm:"type:text" json:"models,omitempty"` // JSON array
	Config   string              `gorm:"type:text;default:'{}'" json:"config,omitempty"`
	IsActive bool                `gorm:"default:true" json:"is_active"`
	// Status do último teste
	TestStatus   string     `gorm:"type:varchar(20)" json:"test_status,omitempty"`
	LastTestedAt *time.Time `json:"last_tested_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (p *PlatformAI) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
