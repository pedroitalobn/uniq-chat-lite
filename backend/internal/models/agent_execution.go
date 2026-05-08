package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AgentExecution — log de cada vez que o agente foi acionado (ou tentou
// ser acionado). Permite ao admin abrir a aba "Logs" do agente e ver:
//   - quando disparou e por qual canal (inbound regular / webhook / fila)
//   - se respondeu, foi pulado ou falhou
//   - razão exata da pulada (fora da janela, trigger não bate, sem LLM…)
//   - preview do input e da resposta
//   - duração total
//
// Mantemos preview truncado em 500 chars pra evitar inflar o DB com
// histórias longas — pra debug profundo o user lê o inbox normal.
type AgentExecution struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	AgentID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"agent_id"`
	InstanceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	// Conversation/Contact são opcionais — webhook trigger pode não ter
	// uma conversa pré-existente.
	ConversationID *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`
	ContactID      *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`

	// Como o agente foi disparado.
	Trigger string `gorm:"type:varchar(20);not null;index" json:"trigger"` // "inbound" | "webhook"
	// Resultado final.
	Status string `gorm:"type:varchar(20);not null;index" json:"status"` // "success" | "skipped" | "failed"
	// Quando skipped: motivo curto (trigger_no_match, outside_window, no_llm,
	// integration_missing, dedup, group_msg, observing_mode, etc).
	SkipReason string `gorm:"type:varchar(60)" json:"skip_reason,omitempty"`
	// Quando failed: mensagem de erro.
	ErrorMessage string `gorm:"type:text" json:"error_message,omitempty"`

	InputPreview string `gorm:"type:varchar(500)" json:"input_preview,omitempty"`
	ReplyPreview string `gorm:"type:varchar(500)" json:"reply_preview,omitempty"`
	DurationMs   int    `json:"duration_ms"`

	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (e *AgentExecution) BeforeCreate(_ *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}
