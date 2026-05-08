package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ContactMemory — memória de longo prazo do agente sobre um contato.
// Atualizada quando uma conversa fecha (worker pega o transcript, gera
// um resumo curto e merge com Summary/Facts existentes). Carregada como
// seção no system prompt em conversas futuras pra que o agente "lembre"
// de informações importantes (preferências, dores, contexto comercial)
// sem precisar reler todo o histórico.
//
// Diferente de:
//   - recentHistory (últimos 25 turnos da conversa atual)
//   - assets/RAG (knowledge base estática do agente)
//
// Esta tabela é o "perfil dinâmico" que melhora a cada interação.
type ContactMemory struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ContactID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"contact_id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`

	// Resumo em 3-6 linhas, escrito em PT-BR pelo LLM. É a representação
	// principal injetada no prompt.
	Summary string `gorm:"type:text" json:"summary,omitempty"`

	// Facts — array JSON de {key, value, learned_at}. Pra dados estruturados
	// que o agente pode citar literalmente (ex: nome da empresa, cargo,
	// produto preferido, valor da última cotação).
	// Exemplo: [{"key":"empresa","value":"Clínica Odonto SP","learned_at":"2026-05-08"}]
	Facts string `gorm:"type:text;default:'[]'" json:"facts,omitempty"`

	// LastSummarizedAt — última vez que o worker rodou pra esse contato.
	// Usado pra throttle: não regenerar se nada mudou desde a última.
	LastSummarizedAt *time.Time `json:"last_summarized_at,omitempty"`

	// MessageCountAtLastSummary — quantas mensagens existiam na última
	// sumarização. Próxima rodada só dispara se tiver +5 msgs novas
	// (evita rodar LLM por cada msg).
	MessageCountAtLastSummary int `gorm:"default:0" json:"message_count_at_last_summary,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (m *ContactMemory) BeforeCreate(_ *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.Facts == "" {
		m.Facts = "[]"
	}
	return nil
}
