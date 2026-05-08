package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PlatformVoice armazena a configuração global de TTS/voz da plataforma
// (Uniq Voice) — espelha o pattern de PlatformAI. Singleton-ish: o super
// admin pode ter múltiplos providers configurados (ex: OpenAI TTS pra
// inglês, ElevenLabs pra português) e o runtime decide qual usar pelo
// flag IsActive + heurística de língua/uso.
//
// Workspaces que não têm VoiceProvider próprio caem aqui SE o plano deles
// tiver AllowVoice=true. Sem isso, voz não funciona pra eles — mantém o
// modelo de billing por feature.
type PlatformVoice struct {
	ID       uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	// Provider é "openai_tts" | "elevenlabs" | "qwen_tts" | "azure_tts" | …
	// Não reusamos IntegrationProvider porque os providers de voz são
	// distintos dos de LLM (não há overlap real, e misturar torna
	// validação confusa).
	Provider string    `gorm:"type:varchar(50);not null" json:"provider"`
	Name     string    `gorm:"type:varchar(100);not null;default:'Uniq Voice'" json:"name"`
	APIKey   string    `gorm:"type:text" json:"-"` // nunca exposto na API
	BaseURL  string    `gorm:"type:varchar(255)" json:"base_url,omitempty"`
	// Voices é um JSON array com as vozes disponíveis nesse provider —
	// preenchido manualmente pelo super admin ou via sync. Cada item:
	// { "id": "voice_xxx", "name": "Maria", "language": "pt-BR", "gender": "female" }
	Voices       string `gorm:"type:text" json:"voices,omitempty"`
	Config       string `gorm:"type:text;default:'{}'" json:"config,omitempty"`
	IsActive     bool   `gorm:"default:true" json:"is_active"`
	TestStatus   string `gorm:"type:varchar(20)" json:"test_status,omitempty"`
	LastTestedAt *time.Time `json:"last_tested_at,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

func (p *PlatformVoice) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
