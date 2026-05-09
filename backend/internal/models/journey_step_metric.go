package models

import (
	"time"

	"github.com/google/uuid"
)

// JourneyStepMetric — agregação por (journey_id, step_id) usada pra
// montar funnel de conversão no dashboard de analytics.
//
// Estratégia: linha única por par; counters incrementados in-place via
// UPDATE atômico (sem race com SELECT-then-UPDATE). Sem grão temporal —
// quem precisa de timeseries usa journey_executions individuais.
//
// Por que não derivar tudo de journey_executions ao vivo?
//   • SELECT COUNT por step em flow com 20 steps × 10k execuções
//     fica caro pra cada open do dashboard.
//   • Aqui temos pre-agregação O(1) — increments síncronos no executor
//     são baratos (1 UPDATE WHERE com idx unique).
//
// Reset: dropar a linha re-zera contadores. Não há cleanup automático.
type JourneyStepMetric struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	JourneyID string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_journey_step,priority:1" json:"journey_id"`
	StepID    string    `gorm:"type:varchar(120);not null;uniqueIndex:idx_journey_step,priority:2" json:"step_id"`
	StepType  string    `gorm:"type:varchar(40)" json:"step_type"`
	StepLabel string    `gorm:"type:varchar(255)" json:"step_label,omitempty"`

	// Entered — toda vez que o executor INICIA esse step (chamada de
	// executeStep). Inclui re-visits (ex: goto/loop).
	Entered int64 `gorm:"default:0" json:"entered"`
	// Completed — step terminou com next != nil ou pause normal
	// (waiting_input/waiting). Não conta erro.
	Completed int64 `gorm:"default:0" json:"completed"`
	// Errored — step retornou err. Conta separadamente pra debug.
	Errored int64 `gorm:"default:0" json:"errored"`
	// Skipped — step nunca rodou porque branch anterior tomou outro
	// caminho (não incrementado hoje; reservado pra Multivariate
	// analytics futuras).
	Skipped int64 `gorm:"default:0" json:"skipped"`
	// LastErrorMessage — última mensagem de erro vista pra debug.
	// Truncado em 500 chars no service.
	LastErrorMessage string `gorm:"type:text" json:"last_error_message,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (m *JourneyStepMetric) TableName() string {
	return "journey_step_metrics"
}
