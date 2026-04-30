package models

import (
	"time"

	"github.com/google/uuid"
)

// VoiceProviderType identifica o provedor de TTS.
type VoiceProviderType string

const (
	VoiceProviderElevenLabs VoiceProviderType = "elevenlabs"
	VoiceProviderQwenTTS    VoiceProviderType = "qwen_tts"
	VoiceProviderOpenAITTS  VoiceProviderType = "openai_tts"
)

// VoiceProvider armazena as credenciais de um provedor de TTS por workspace.
type VoiceProvider struct {
	ID          uuid.UUID         `json:"id"           gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	WorkspaceID uuid.UUID         `json:"workspace_id" gorm:"type:uuid;not null;index"`
	Provider    VoiceProviderType `json:"provider"     gorm:"type:varchar(40);not null"`
	Name        string            `json:"name"`
	APIKey      string            `json:"-"            gorm:"type:text"` // nunca serializado
	MaskedKey   string            `json:"masked_key"   gorm:"-"`         // computado na resposta
	IsActive    bool              `json:"is_active"    gorm:"default:true"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// WorkspaceVoice representa uma voz disponível no workspace.
// Pode ser uma voz preset listada do provider ou uma voz clonada.
type WorkspaceVoice struct {
	ID              uuid.UUID `json:"id"               gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	WorkspaceID     uuid.UUID `json:"workspace_id"     gorm:"type:uuid;not null;index"`
	VoiceProviderID uuid.UUID `json:"voice_provider_id" gorm:"type:uuid;not null;index"`
	ExternalID      string    `json:"external_id"`       // ID no provider (elevenlabs voice_id, etc.)
	Name            string    `json:"name"`
	PreviewURL      string    `json:"preview_url"`       // URL pública de preview do áudio
	Category        string    `json:"category"`          // "preset", "clone", "generated"
	Language        string    `json:"language"`          // "pt-BR", "en-US", etc.
	Gender          string    `json:"gender"`            // "female", "male", "neutral"
	Description     string    `json:"description"`
	IsActive        bool      `json:"is_active" gorm:"default:true"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	Provider *VoiceProvider `json:"provider,omitempty" gorm:"foreignKey:VoiceProviderID"`
}
