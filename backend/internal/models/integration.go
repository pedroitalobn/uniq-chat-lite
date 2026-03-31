package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// IntegrationProvider identifies the LLM or tool being integrated.
type IntegrationProvider string

const (
	ProviderClaude     IntegrationProvider = "claude"
	ProviderOpenAI     IntegrationProvider = "openai"
	ProviderDeepSeek   IntegrationProvider = "deepseek"
	ProviderGemini     IntegrationProvider = "gemini"
	ProviderOpenRouter IntegrationProvider = "openrouter"
	ProviderN8N        IntegrationProvider = "n8n"
	ProviderWebhook    IntegrationProvider = "webhook"
	ProviderKilo       IntegrationProvider = "kilo"
	ProviderZai        IntegrationProvider = "zai"
	ProviderKimi       IntegrationProvider = "kimi"
	ProviderQwen       IntegrationProvider = "qwen"
	ProviderMiniMax    IntegrationProvider = "minimax"
	ProviderManus      IntegrationProvider = "manus"
)

// UserIntegration stores an account-level LLM/tool integration.
type UserIntegration struct {
	ID           uuid.UUID           `gorm:"type:uuid;primaryKey" json:"id"`
	UserID       uuid.UUID           `gorm:"type:uuid;not null;index" json:"user_id"`
	Provider     IntegrationProvider `gorm:"type:varchar(50);not null" json:"provider"`
	Name         string              `gorm:"type:varchar(100);not null" json:"name"`
	APIKey       string              `gorm:"type:text" json:"-"`            // never exposed in JSON
	MaskedKey    string              `gorm:"-" json:"masked_key,omitempty"` // computed on read
	BaseURL      string              `gorm:"type:varchar(255)" json:"base_url,omitempty"`
	Model        string              `gorm:"type:varchar(100)" json:"model,omitempty"`
	Config       string              `gorm:"type:text;default:'{}'" json:"config,omitempty"` // JSON extra config
	IsActive     bool                `gorm:"default:true" json:"is_active"`
	LastTestedAt *time.Time          `json:"last_tested_at,omitempty"`
	TestStatus   string              `gorm:"type:varchar(20)" json:"test_status,omitempty"` // "ok" | "failed" | ""
	CreatedAt    time.Time           `json:"created_at"`
	UpdatedAt    time.Time           `json:"updated_at"`
}

func (i *UserIntegration) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}

// MaskAPIKey returns the last 4 chars of the API key with stars prefix.
func MaskAPIKey(key string) string {
	if len(key) <= 4 {
		return "****"
	}
	return "****" + key[len(key)-4:]
}

// InstanceAgent stores agent/LLM config attached to a specific instance.
type InstanceAgent struct {
	ID            uuid.UUID        `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID    uuid.UUID        `gorm:"type:uuid;not null;uniqueIndex" json:"instance_id"`
	IntegrationID *uuid.UUID       `gorm:"type:uuid" json:"integration_id,omitempty"`
	Integration   *UserIntegration `gorm:"foreignKey:IntegrationID" json:"integration,omitempty"`
	SystemPrompt  string           `gorm:"type:text" json:"system_prompt,omitempty"`
	IsActive      bool             `gorm:"default:false" json:"is_active"`
	// n8n / webhook passthrough
	WebhookURL    string `gorm:"type:varchar(255)" json:"webhook_url,omitempty"`
	WebhookSecret string `gorm:"type:varchar(255)" json:"webhook_secret,omitempty"`
	// MCP server URL (for MCP tool calling)
	MCPServerURL string    `gorm:"type:varchar(255)" json:"mcp_server_url,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (a *InstanceAgent) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
