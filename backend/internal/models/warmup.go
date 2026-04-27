package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// WarmupStatus controla o estado de uma sessão de aquecimento.
type WarmupStatus string

const (
	WarmupStatusIdle      WarmupStatus = "idle"
	WarmupStatusRunning   WarmupStatus = "running"
	WarmupStatusPaused    WarmupStatus = "paused"
	WarmupStatusCompleted WarmupStatus = "completed"
	WarmupStatusFailed    WarmupStatus = "failed"
)

// WarmupSession é o aquecimento ("warm-up") de uma instância nova.
//
// O WhatsApp Business banimento agressivo de números recém-conectados
// que enviam volume alto. A sessão simula tráfego humano gradual:
//
//   - Dia 1:  10 msg, intervalo 5-15min, só pra contatos "amigos"
//   - Dia 2:  20 msg
//   - Dia 7+: 200 msg/dia, distribuído em 8h "úteis"
//
// O scheduler escolhe contatos e mensagens aleatórias e envia em
// horários randomizados (jitter) dentro da janela. Comporta-se como
// um humano: presença, typing, intervalo entre mensagens.
type WarmupSession struct {
	ID         uuid.UUID    `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID   `gorm:"type:uuid;not null;index" json:"workspace_id"`
	InstanceID uuid.UUID    `gorm:"type:uuid;not null;index" json:"instance_id"`
	Status     WarmupStatus `gorm:"type:varchar(20);default:'idle';index" json:"status"`

	// Configuração
	DurationDays int `gorm:"default:14" json:"duration_days"`        // total da curva
	StartDay     int `gorm:"default:1" json:"start_day"`             // dia atual (1..DurationDays)
	DailyTarget  int `gorm:"default:200" json:"daily_target"`         // target ao final
	StartHour    int `gorm:"default:9" json:"start_hour"`            // janela ativa início (UTC-3 padrão BR)
	EndHour      int `gorm:"default:21" json:"end_hour"`             // janela ativa fim
	MinDelaySec  int `gorm:"default:60" json:"min_delay_sec"`        // intervalo mínimo entre msgs
	MaxDelaySec  int `gorm:"default:300" json:"max_delay_sec"`       // máximo

	// Pool de mensagens humanas (JSON array de strings)
	MessagePool string `gorm:"type:text;default:'[]'" json:"message_pool"`
	// Pool de contatos warm-up (outros números próprios ou de teste; JSON array)
	ContactPool string `gorm:"type:text;default:'[]'" json:"contact_pool"`

	// Estatística
	SentToday    int        `gorm:"default:0" json:"sent_today"`
	SentTotal    int        `gorm:"default:0" json:"sent_total"`
	LastSentAt   *time.Time `json:"last_sent_at,omitempty"`
	LastResetDay string     `gorm:"type:varchar(10)" json:"last_reset_day,omitempty"` // "2026-04-27"

	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (w *WarmupSession) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	if w.MessagePool == "" {
		w.MessagePool = "[]"
	}
	if w.ContactPool == "" {
		w.ContactPool = "[]"
	}
	if w.DurationDays == 0 {
		w.DurationDays = 14
	}
	if w.StartDay == 0 {
		w.StartDay = 1
	}
	if w.DailyTarget == 0 {
		w.DailyTarget = 200
	}
	if w.MinDelaySec == 0 {
		w.MinDelaySec = 60
	}
	if w.MaxDelaySec == 0 {
		w.MaxDelaySec = 300
	}
	if w.StartHour == 0 && w.EndHour == 0 {
		w.StartHour = 9
		w.EndHour = 21
	}
	return nil
}

// TargetForDay retorna quantas mensagens devem ser enviadas no dia atual
// seguindo curva linear-ish (10% no dia 1, 100% no dia DurationDays).
func (w *WarmupSession) TargetForDay() int {
	if w.DurationDays <= 1 {
		return w.DailyTarget
	}
	// Curva: dia 1 = 10% target, dia N = 100% target.
	// progress = (StartDay - 1) / (DurationDays - 1)  ∈ [0,1]
	progress := float64(w.StartDay-1) / float64(w.DurationDays-1)
	if progress < 0 {
		progress = 0
	}
	if progress > 1 {
		progress = 1
	}
	min := float64(w.DailyTarget) * 0.10
	max := float64(w.DailyTarget)
	return int(min + (max-min)*progress)
}
