package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// JourneyEnrollment — uma inscrição programada de contato numa journey.
// Diferente do trigger reativo (cliente manda msg → journey roda),
// enrollments são proativos: definidos por audiência (segment) ou
// upload manual, opcionalmente agendados pra rodar no futuro.
//
// Lifecycle:
//   pending  → scheduled_at no futuro, esperando o worker disparar
//   started  → executor já chamou StartFromCrmEvent, journey rodando
//   completed→ executor terminou (success path)
//   skipped  → re-entry rule violada / contato sem JID válido
//   failed   → erro ao iniciar (log no campo error)
//
// Idempotência: idx único (journey_id, contact_id, source) evita
// criar enrollment duplicado quando o segment é resolvido várias
// vezes pelo cron — só cria se não há linha pra esse trio.
type JourneyEnrollment struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	JourneyID   uuid.UUID  `gorm:"type:uuid;not null;index:idx_enroll_unique,priority:1;index" json:"journey_id"`
	ContactID   uuid.UUID  `gorm:"type:uuid;not null;index:idx_enroll_unique,priority:2;index" json:"contact_id"`
	// Source — identifica QUEM/COMO criou esta inscrição. Permite
	// múltiplas inscrições do mesmo contato no mesmo journey por fontes
	// diferentes (manual upload + segment resolution).
	//   "segment:<id>"   — vindo da resolução do segment X
	//   "manual:<user>"  — admin enrolou via POST /journeys/:id/enroll
	//   "csv:<batch_id>" — enrolamento em lote via CSV
	//   "api:<key>"      — integração externa via API key
	Source      string     `gorm:"type:varchar(120);not null;index:idx_enroll_unique,priority:3" json:"source"`
	Status      string     `gorm:"type:varchar(20);default:'pending';index" json:"status"`
	ScheduledAt time.Time  `gorm:"not null;index" json:"scheduled_at"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	// ExecutionID — preenche quando journey_executor cria a execution
	// real (link bidirecional pra debug/auditoria).
	ExecutionID *uuid.UUID `gorm:"type:uuid" json:"execution_id,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (e *JourneyEnrollment) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.ScheduledAt.IsZero() {
		e.ScheduledAt = time.Now()
	}
	if e.Status == "" {
		e.Status = "pending"
	}
	return nil
}

func (e *JourneyEnrollment) TableName() string {
	return "journey_enrollments"
}

const (
	JourneyEnrollmentPending   = "pending"
	JourneyEnrollmentStarted   = "started"
	JourneyEnrollmentCompleted = "completed"
	JourneyEnrollmentSkipped   = "skipped"
	JourneyEnrollmentFailed    = "failed"
)
