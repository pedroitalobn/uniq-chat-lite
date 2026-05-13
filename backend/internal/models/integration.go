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
	OAuthAccessToken  string         `gorm:"type:text" json:"-"`
	OAuthRefreshToken string         `gorm:"type:text" json:"-"`
	OAuthExpiresAt    *time.Time     `json:"oauth_expires_at,omitempty"`
	OAuthAccount      string         `gorm:"type:varchar(255)" json:"oauth_account,omitempty"` // email/ID legível
	OAuthScope        string         `gorm:"type:varchar(512)" json:"oauth_scope,omitempty"`
	BaseURL           string         `gorm:"type:varchar(255)" json:"base_url,omitempty"`
	Models            string         `gorm:"type:text" json:"models,omitempty"`              // JSON array of model names, e.g. ["gpt-4o","gpt-4o-mini"]
	Config            string         `gorm:"type:text;default:'{}'" json:"config,omitempty"` // JSON extra config
	IsActive          bool           `gorm:"default:true" json:"is_active"`
	LastTestedAt      *time.Time     `json:"last_tested_at,omitempty"`
	TestStatus        string         `gorm:"type:varchar(20)" json:"test_status,omitempty"` // "ok" | "failed" | ""
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"-"`
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
	IsActive                bool             `gorm:"default:true" json:"is_active"`
	// Multi-agente — Role classifica a função (atendimento/fechamento/pós-venda),
	// Priority desempata quando múltiplos podem responder, IsPrimary marca o
	// fallback quando a conversa ainda não tem agente pinado.
	Role      string `gorm:"type:varchar(40);default:'primary'" json:"role,omitempty"`
	Priority  int    `gorm:"default:100" json:"priority,omitempty"`
	IsPrimary bool   `gorm:"default:false;index" json:"is_primary"`
	// HandoffSkills — lista JSON de "skills" que outros agentes podem invocar
	// pra transferir a conversa pra este agente (ex: ["fechamento", "vendas"]).
	HandoffSkills string `gorm:"type:text;default:'[]'" json:"handoff_skills,omitempty"`
	// ActionConfirmation — política padrão pra ações que o agente executa
	// (agendar, criar campanha, tag CRM): "client" exige confirmação no
	// próprio chat WhatsApp; "auto" executa sem perguntar; "human" pede
	// aprovação no painel. Default conservador.
	ActionConfirmation string `gorm:"type:varchar(20);default:'client'" json:"action_confirmation,omitempty"`
	// Janelas de ativação — quando o agente responde:
	//   "always"            → 24/7 enquanto IsActive=true (default).
	//   "business_hours"    → só durante horário configurado em Schedule.
	//   "off_hours"         → o oposto (responde só FORA do horário,
	//                          útil pra cobrir noite/fim de semana).
	//   "new_contact_only"  → só responde se Contact.MessageCount<=1.
	//   "custom"            → combina Schedule + regras adicionais em
	//                          ContextRules (JSON livre, hoje opcional).
	// Default "always" preserva comportamento legado.
	ActivationMode string `gorm:"type:varchar(30);default:'always'" json:"activation_mode,omitempty"`
	// Schedule — JSON com timezone + ranges por dia da semana. Formato:
	//   { "timezone": "America/Sao_Paulo",
	//     "days": { "mon": [{"from":"09:00","to":"18:00"}], "tue": [...] } }
	// Dias ausentes/empty = fora da janela. Idiomático no business_hours/
	// off_hours/custom; ignorado em always/new_contact_only.
	Schedule string `gorm:"type:text;default:'{}'" json:"schedule,omitempty"`
	// ContextRules — JSON livre pra regras compostas no modo "custom":
	//   { "min_messages": 0, "max_messages": null, "only_unassigned": true,
	//     "skip_if_human_replied_within_min": 30 }
	// Por enquanto só serializa pra evolução incremental sem migration.
	ContextRules string `gorm:"type:text;default:'{}'" json:"context_rules,omitempty"`
	// Trigger — em QUE CONDIÇÕES o agente abre/responde a conversa.
	// Complementa ActivationMode (que é o gate de horário/contexto):
	//   "any"     → responde qualquer mensagem inbound (default).
	//   "keyword" → só responde quando a mensagem casa com TriggerKeywords
	//                (substring case-insensitive contra a última msg do
	//                cliente). Útil pra agente especialista em pré-venda
	//                ativado por "preço", "comprar", etc.
	//   "webhook" → NÃO responde mensagens inbound; só dispara via
	//                POST /v1/webhooks/agent-trigger/:slug com payload.
	//                Útil pra integrações (form site → agent inicia
	//                conversa no WhatsApp).
	TriggerMode string `gorm:"type:varchar(20);default:'any'" json:"trigger_mode,omitempty"`
	// TriggerKeywords — JSON array de strings minúsculas. Match por
	// substring (case-insensitive) na última mensagem inbound.
	TriggerKeywords string `gorm:"type:text;default:'[]'" json:"trigger_keywords,omitempty"`
	// TriggerMessageTypes — JSON array com os tipos de mensagem inbound que
	// podem acionar o agente. Default efetivo quando vazio: ["text"].
	// Exemplos: text, image, video, audio, document, sticker, location,
	// contact, poll, gif. Isso evita agente reagir a status/mídia qualquer.
	TriggerMessageTypes string `gorm:"type:text;default:'[\"text\"]'" json:"trigger_message_types,omitempty"`
	// TriggerWebhookSlug — identificador único do webhook deste agente.
	// Path final: POST /v1/webhooks/agent-trigger/<slug>. Auto-gerado
	// quando agent.TriggerMode = "webhook" e ainda vazio.
	TriggerWebhookSlug string `gorm:"type:varchar(64);uniqueIndex" json:"trigger_webhook_slug,omitempty"`
	// TriggerWebhookSecret — opcional. Se preenchido, requests precisam
	// trazer header X-Uniq-Signature = HMAC-SHA256(body, secret) hex.
	TriggerWebhookSecret string `gorm:"type:varchar(128)" json:"trigger_webhook_secret,omitempty"`
	// ResponsePace — ritmo das respostas (delay de "digitação" + cooldowns).
	//   "instant"     → mínimo de delay (~600ms base, anti-ban floor)
	//   "natural"     → padrão humano (~220ms/char, default)
	//   "thoughtful"  → pausa pra pensar (~400ms/char + cooldowns maiores)
	//   "very_human"  → bem devagar, parece atendente humano (~600ms/char)
	ResponsePace string `gorm:"type:varchar(20);default:'natural'" json:"response_pace,omitempty"`
	// PaceSettings — JSON com overrides finos por modo de ritmo.
	// Estrutura: { "instant": { "ms_per_char":40, "min_delay":600, "max_delay":4000,
	//   "jitter_pct":30, "cooldown_min":400, "cooldown_max":900,
	//   "first_msg_min":2000, "first_msg_max":4000 }, "natural": {...}, ... }
	// Campos ausentes usam o default hardcoded do paceProfileFor.
	PaceSettings string `gorm:"type:text;default:'{}'" json:"pace_settings,omitempty"`
	// ResponseLength — orienta o LLM sobre o tamanho da resposta. Injetado
	// no system prompt como diretriz dura. Não trunca a saída do LLM —
	// só guia o estilo.
	//   "concise"   → 1-2 frases curtas
	//   "balanced"  → mistura — detalha quando precisa (default)
	//   "detailed"  → respostas completas e didáticas
	ResponseLength string `gorm:"type:varchar(20);default:'balanced'" json:"response_length,omitempty"`
	// MessageBatching — debounce de mensagens sequenciais antes de responder.
	// Humano não responde linha por linha quando o outro lado manda "oi" "tudo
	// bem?" "queria saber X" em 3 mensagens em 5 segundos: ele LÊ tudo e
	// responde uma vez. Aqui modelamos isso:
	//   "off"     → comportamento legado, responde cada mensagem na hora
	//                (DEFAULT — opt-in pra não introduzir latência percebida
	//                em quem não pediu).
	//   "smart"   → aguarda ~6s de silêncio depois da última msg. Cada msg
	//                nova reseta o timer. Quando o cliente para,
	//                processamos o bloco todo de uma vez.
	//   "patient" → aguarda ~15s. Bom pra clientes que digitam devagar ou
	//                mandam áudios entremeados.
	MessageBatching string `gorm:"type:varchar(20);default:'off'" json:"message_batching,omitempty"`
	// AudioReplyMode — como o agente responde mensagens recebidas em áudio
	// (e, no caso "always", também as recebidas em texto):
	//   "text"        → sempre responde em texto (default).
	//   "audio"       → sempre tenta responder em áudio (TTS); se voz não
	//                    estiver configurada ou TTS falhar, faz fallback
	//                    pra texto automaticamente.
	//   "match_input" → espelha o tipo da mensagem do cliente: áudio in →
	//                    áudio out (com fallback pra texto); texto in →
	//                    texto out.
	AudioReplyMode string `gorm:"type:varchar(20);default:'text'" json:"audio_reply_mode,omitempty"`
	// n8n / webhook passthrough
	WebhookURL    string `gorm:"type:varchar(255)" json:"webhook_url,omitempty"`
	WebhookSecret string `gorm:"type:varchar(255)" json:"webhook_secret,omitempty"`
	// MCP server URL (for MCP tool calling)
	MCPServerURL string `gorm:"type:varchar(255)" json:"mcp_server_url,omitempty"`
	// Acesso da equipe — controle granular de quem pode editar este
	// agente específico. Por default desligado: qualquer um com
	// agents:manage no workspace pode editar (comportamento legado).
	// Quando AccessRestricted=true, edição fica limitada aos papéis
	// listados em EditorRoleIDs (+ dono do workspace + super-admin).
	AccessRestricted bool         `gorm:"default:false" json:"access_restricted"`
	EditorRoleIDs    string       `gorm:"type:text;default:'[]'" json:"editor_role_ids,omitempty"`
	Assets           []AgentAsset `gorm:"foreignKey:InstanceAgentID" json:"assets,omitempty"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

func (a *InstanceAgent) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
