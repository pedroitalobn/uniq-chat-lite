package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// JourneyDeferredStep — registro persistente de uma execução pausada
// num step de wait longo. Substitui o time.Sleep em goroutine, que
// tinha 2 problemas críticos:
//
//   1. Cap de 24h hard-coded — wait acima disso era truncado.
//   2. Crash do processo matava todas as goroutines em flight; quando
//      o servidor voltava, jornadas no meio do wait sumiam pra sempre.
//
// Com defer, o stepWait:
//   - Cria uma linha aqui com fire_at = now + duration
//   - Marca a execution.status = "waiting" + grava CurrentStep = nextStepID
//   - Sai da goroutine — recursos livres
//
// O worker DeferredStepRunner roda a cada 30s, pega entradas com
// fire_at <= now, marca processing (atomicamente em transação) e
// chama resumeDeferred() que reconstrói o execCtx e continua o flow
// do NextStepID. Idempotente: status="processing" impede duplo
// disparo se múltiplos pods rodam.
//
// Persistência total: pode reiniciar o server, dormir 30 dias, vai
// continuar de onde parou. Sem cap de duração — limitado só pela
// reliabilidade do DB.
type JourneyDeferredStep struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	JourneyID   string    `gorm:"type:varchar(64);not null;index" json:"journey_id"`
	ExecutionID string    `gorm:"type:varchar(64);not null;index" json:"execution_id"`
	InstanceID  string    `gorm:"type:varchar(64);not null;index" json:"instance_id"`
	ContactJID  string    `gorm:"type:varchar(255);not null" json:"contact_jid"`
	ContactName string    `gorm:"type:varchar(255)" json:"contact_name,omitempty"`
	GroupJID    string    `gorm:"type:varchar(255)" json:"group_jid,omitempty"`
	// NextStepID — id do step a executar quando o wait expirar. Não é
	// o step do wait em si (esse já passou); é o que vem DEPOIS dele.
	NextStepID string `gorm:"type:varchar(120);not null" json:"next_step_id"`
	// FireAt — instante em UTC que o step deve disparar. Indexado pra
	// o worker varrer "WHERE fire_at <= now AND status = 'pending'"
	// barato.
	FireAt time.Time `gorm:"not null;index" json:"fire_at"`
	// Status:
	//   pending     — esperando fire_at chegar
	//   processing  — worker pegou e tá retomando o flow
	//   completed   — flow continuou e terminou (ou bateu em outro wait)
	//   failed      — erro irrecuperável (ex: journey deletada)
	//   skipped     — execution não existe mais ou foi cancelada
	Status string `gorm:"type:varchar(20);default:'pending';index" json:"status"`
	Error  string `gorm:"type:text" json:"error,omitempty"`
	// FromStepID — id do step de wait que originou o defer. Útil pra
	// debug / logs. Não usado pelo runner.
	FromStepID string `gorm:"type:varchar(120)" json:"from_step_id,omitempty"`

	CreatedAt   time.Time      `json:"created_at"`
	ProcessedAt *time.Time     `json:"processed_at,omitempty"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (d *JourneyDeferredStep) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	if d.Status == "" {
		d.Status = "pending"
	}
	return nil
}

func (d *JourneyDeferredStep) TableName() string {
	return "journey_deferred_steps"
}

const (
	JourneyDeferredPending    = "pending"
	JourneyDeferredProcessing = "processing"
	JourneyDeferredCompleted  = "completed"
	JourneyDeferredFailed     = "failed"
	JourneyDeferredSkipped    = "skipped"
)
