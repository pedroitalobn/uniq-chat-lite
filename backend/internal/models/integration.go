package models

import (
	"encoding/json"
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
	ProviderMistral    IntegrationProvider = "mistral"
)

// AuthType define como a integração autentica com o provider.
type AuthType string

const (
	AuthTypeAPIKey AuthType = "api_key"
	AuthTypeOAuth  AuthType = "oauth" // Claude.ai, Google accounts, etc.
)

// UserIntegration stores an LLM/tool integration scoped to a workspace (preferred)
// or to a user (legacy/personal). WorkspaceID, when set, means the integration
// belongs to that workspace and all its members can use it.
type UserIntegration struct {
	ID          uuid.UUID           `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID           `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID *uuid.UUID          `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Provider    IntegrationProvider `gorm:"type:varchar(50);not null" json:"provider"`
	Name        string              `gorm:"type:varchar(100);not null" json:"name"`
	// Autenticação: api_key (default, legado) ou oauth (Claude.ai, etc.)
	AuthType  AuthType `gorm:"type:varchar(20);default:'api_key'" json:"auth_type"`
	APIKey    string   `gorm:"type:text" json:"-"`            // never exposed in JSON
	MaskedKey string   `gorm:"-" json:"masked_key,omitempty"` // computed on read
	// OAuth tokens (criptografados no runtime; json:"-" para nunca sair na API)
	OAuthAccessToken  string     `gorm:"type:text" json:"-"`
	OAuthRefreshToken string     `gorm:"type:text" json:"-"`
	OAuthExpiresAt    *time.Time `json:"oauth_expires_at,omitempty"`
	OAuthAccount      string     `gorm:"type:varchar(255)" json:"oauth_account,omitempty"` // email/ID legível
	OAuthScope        string     `gorm:"type:varchar(512)" json:"oauth_scope,omitempty"`
	BaseURL           string     `gorm:"type:varchar(255)" json:"base_url,omitempty"`
	Models            string     `gorm:"type:text" json:"models,omitempty"`              // JSON array of model names, e.g. ["gpt-4o","gpt-4o-mini"]
	Config            string     `gorm:"type:text;default:'{}'" json:"config,omitempty"` // JSON extra config
	IsActive          bool       `gorm:"default:true" json:"is_active"`
	LastTestedAt      *time.Time `json:"last_tested_at,omitempty"`
	TestStatus        string     `gorm:"type:varchar(20)" json:"test_status,omitempty"` // "ok" | "failed" | ""
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// HasOAuth retorna true se a integração tem tokens OAuth válidos.
func (i *UserIntegration) HasOAuth() bool {
	return i.AuthType == AuthTypeOAuth && i.OAuthAccessToken != ""
}

// IsOAuthExpired retorna true se o access token OAuth está expirado (ou prestes a expirar em 60s).
func (i *UserIntegration) IsOAuthExpired() bool {
	if i.OAuthExpiresAt == nil {
		return false // sem expiração conhecida, assume válido
	}
	return time.Now().Add(60 * time.Second).After(*i.OAuthExpiresAt)
}

func (i *UserIntegration) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}

// GetModels returns the models as a slice of strings.
func (i *UserIntegration) GetModels() []string {
	if i.Models == "" || i.Models == "[]" {
		return nil
	}
	var models []string
	if err := json.Unmarshal([]byte(i.Models), &models); err != nil {
		return nil
	}
	return models
}

// GetFirstModel returns the first model in the list.
func (i *UserIntegration) GetFirstModel() string {
	models := i.GetModels()
	if len(models) > 0 {
		return models[0]
	}
	return ""
}

// MaskAPIKey returns the last 4 chars of the API key with stars prefix.
func MaskAPIKey(key string) string {
	if len(key) <= 4 {
		return "****"
	}
	return "****" + key[len(key)-4:]
}

// InstanceAgent stores agent/LLM config attached to a specific instance.
//
// Multi-agente: cada instância pode ter N agentes (atendimento, fechamento,
// pós-venda etc). InstanceID NÃO é mais uniqueIndex — substituído por uma
// flag IsPrimary que marca o agente fallback quando a conversa ainda não
// foi atribuída via handoff.
type InstanceAgent struct {
	ID                      uuid.UUID        `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID              uuid.UUID        `gorm:"type:uuid;not null;index" json:"instance_id"`
	IntegrationID           *uuid.UUID       `gorm:"type:uuid" json:"integration_id,omitempty"`
	Integration             *UserIntegration `gorm:"foreignKey:IntegrationID" json:"integration,omitempty"`
	Model                   string           `gorm:"type:varchar(120)" json:"model,omitempty"`
	SystemPrompt            string           `gorm:"type:text" json:"system_prompt,omitempty"`
	AgentName               string           `gorm:"type:varchar(120)" json:"agent_name,omitempty"`
	Identity                string           `gorm:"type:text" json:"identity,omitempty"`
	Objective               string           `gorm:"type:text" json:"objective,omitempty"`
	CommunicationGuidelines string           `gorm:"type:text" json:"communication_guidelines,omitempty"`
	ServiceInstructions     string           `gorm:"type:text" json:"service_instructions,omitempty"`
	Restrictions            string           `gorm:"type:text" json:"restrictions,omitempty"`
	KnowledgeBase           string           `gorm:"type:text" json:"knowledge_base,omitempty"`
	FAQ                     string           `gorm:"type:text;default:'[]'" json:"faq,omitempty"`
	Variables               string           `gorm:"type:text;default:'[]'" json:"variables,omitempty"`
	Voice                   string           `gorm:"type:text;default:'{}'" json:"voice,omitempty"`
	Skills                  string           `gorm:"type:text;default:'[]'" json:"skills,omitempty"`
	AppAccess               string           `gorm:"type:text;default:'[]'" json:"app_access,omitempty"`
	RAGEnabled              bool             `gorm:"default:true" json:"rag_enabled"`
	IsActive                bool             `gorm:"default:false" json:"is_active"`
	// Multi-agente — Role classifica a função (atendimento/fechamento/pós-venda),
	// Priority desempata quando múltiplos podem responder, IsPrimary marca o
	// fallback quando a conversa ainda não tem agente pinado.
	Role        string `gorm:"type:varchar(40);default:'primary'" json:"role,omitempty"`
	Priority    int    `gorm:"default:100" json:"priority,omitempty"`
	IsPrimary   bool   `gorm:"default:false;index" json:"is_primary"`
	// HandoffSkills — lista JSON de "skills" que outros agentes podem invocar
	// pra transferir a conversa pra este agente (ex: ["fechamento", "vendas"]).
	HandoffSkills string `gorm:"type:text;default:'[]'" json:"handoff_skills,omitempty"`
	// ActionConfirmation — política padrão pra ações que o agente executa
	// (agendar, criar campanha, tag CRM): "client" exige confirmação no
	// próprio chat WhatsApp; "auto" executa sem perguntar; "human" pede
	// aprovação no painel. Default conservador.
	ActionConfirmation string `gorm:"type:varchar(20);default:'client'" json:"action_confirmation,omitempty"`
	// n8n / webhook passthrough
	WebhookURL    string `gorm:"type:varchar(255)" json:"webhook_url,omitempty"`
	WebhookSecret string `gorm:"type:varchar(255)" json:"webhook_secret,omitempty"`
	// MCP server URL (for MCP tool calling)
	MCPServerURL string       `gorm:"type:varchar(255)" json:"mcp_server_url,omitempty"`
	Assets       []AgentAsset `gorm:"foreignKey:InstanceAgentID" json:"assets,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}

func (a *InstanceAgent) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
