package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentMode define o comportamento do agente numa conversa específica.
type AgentMode string

const (
	// AgentModeActive: agente responde automaticamente a cada mensagem.
	AgentModeActive AgentMode = "active"
	// AgentModeObserving: agente gera sugestão mas não envia — humano decide.
	AgentModeObserving AgentMode = "observing"
	// AgentModeDisabled: agente silenciado nesta conversa.
	AgentModeDisabled AgentMode = "disabled"
)

// ConversationAgentState guarda o estado operacional do agente por conversa.
// Resolve a precedência: este registro (se existir) sobrepõe is_bot_active e
// o agente da fila/instância, permitindo atribuição e modo independentes.
type ConversationAgentState struct {
	ID             uuid.UUID  `json:"id"              gorm:"type:uuid;primaryKey"`
	ConversationID uuid.UUID  `json:"conversation_id" gorm:"type:uuid;uniqueIndex;not null"`
	AgentID        *uuid.UUID `json:"agent_id"        gorm:"type:uuid"` // nil = usa resolução padrão (queue/instância)

	Mode          AgentMode `json:"mode"           gorm:"type:varchar(20);default:'active';not null"`
	HandoffReason string    `json:"handoff_reason"` // motivo do último handoff registrado

	// Contexto personalizado do operador para esta conversa — injetado no system prompt.
	CustomContext string `json:"custom_context" gorm:"type:text"`

	// Última sugestão gerada em modo "observing" — exibida no inbox ao humano.
	LastSuggestion  string     `json:"last_suggestion"`
	SuggestionAt    *time.Time `json:"suggestion_at"`
	SuggestionMsgID string     `json:"suggestion_msg_id"` // msg que originou a sugestão

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Preloads
	Agent *InstanceAgent `json:"agent,omitempty" gorm:"foreignKey:AgentID"`
}

func (ConversationAgentState) TableName() string { return "conversation_agent_states" }

func (s *ConversationAgentState) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}
