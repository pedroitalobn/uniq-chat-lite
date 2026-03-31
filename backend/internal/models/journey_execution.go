package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// JourneyExecutionStatus representa o status de uma execução
type JourneyExecutionStatus string

const (
	ExecutionActive    JourneyExecutionStatus = "active"
	ExecutionCompleted JourneyExecutionStatus = "completed"
	ExecutionFailed    JourneyExecutionStatus = "failed"
	ExecutionWaiting   JourneyExecutionStatus = "waiting"
	ExecutionPaused    JourneyExecutionStatus = "paused"
)

// ExecutionMessage armazena uma mensagem trocada na execução
type ExecutionMessage struct {
	Direction string    `json:"direction"` // inbound, outbound
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	StepID    string    `json:"step_id,omitempty"`
}

// JourneyExecution representa uma execução individual de uma jornada
type JourneyExecution struct {
	ID           string                 `gorm:"primaryKey" json:"id"`
	JourneyID    string                 `gorm:"not null;index" json:"journey_id"`
	InstanceID   string                 `gorm:"not null;index" json:"instance_id"`
	ContactJID   string                 `gorm:"type:varchar(255);not null" json:"contact_jid"`
	ContactName  string                 `gorm:"type:varchar(255)" json:"contact_name"`
	GroupJID     string                 `gorm:"type:varchar(255)" json:"group_jid,omitempty"`
	GroupName    string                 `gorm:"type:varchar(255)" json:"group_name,omitempty"`
	Status       JourneyExecutionStatus `gorm:"type:varchar(20);not null;default:'active'" json:"status"`
	CurrentStep  string                 `gorm:"type:varchar(100)" json:"current_step,omitempty"`
	StepIndex    int                    `gorm:"not null;default:0" json:"step_index"`
	TotalSteps   int                    `gorm:"not null;default:0" json:"total_steps"`
	Messages     string                 `gorm:"type:text;default:'[]'" json:"messages,omitempty"`
	Metadata     string                 `gorm:"type:text;default:'{}'" json:"metadata,omitempty"`
	ErrorMessage string                 `gorm:"type:text" json:"error_message,omitempty"`
	StartedAt    time.Time              `json:"started_at"`
	CompletedAt  *time.Time             `json:"completed_at,omitempty"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

// AddMessage adiciona uma mensagem ao histórico da execução
func (e *JourneyExecution) AddMessage(direction, content, stepID string) error {
	var messages []ExecutionMessage
	if e.Messages != "" && e.Messages != "[]" {
		json.Unmarshal([]byte(e.Messages), &messages)
	}
	if messages == nil {
		messages = []ExecutionMessage{}
	}
	messages = append(messages, ExecutionMessage{
		Direction: direction,
		Content:   content,
		Timestamp: time.Now(),
		StepID:    stepID,
	})
	data, err := json.Marshal(messages)
	if err != nil {
		return err
	}
	e.Messages = string(data)
	return nil
}

// GetMessages retorna as mensagens parseadas
func (e *JourneyExecution) GetMessages() []ExecutionMessage {
	if e.Messages == "" || e.Messages == "[]" {
		return []ExecutionMessage{}
	}
	var messages []ExecutionMessage
	if err := json.Unmarshal([]byte(e.Messages), &messages); err != nil {
		return []ExecutionMessage{}
	}
	return messages
}

// GetStats retorna estatísticas de execuções
type JourneyStats struct {
	TotalJourneys   int64 `json:"total_journeys"`
	ActiveJourneys  int64 `json:"active_journeys"`
	PausedJourneys  int64 `json:"paused_journeys"`
	TotalExecutions int64 `json:"total_executions"`
	ActiveExecs     int64 `json:"active_executions"`
	CompletedExecs  int64 `json:"completed_executions"`
	FailedExecs     int64 `json:"failed_executions"`
	TodayExecs      int64 `json:"today_executions"`
	TotalMessages   int64 `json:"total_messages"`
}

// AgentStats estatísticas do centro de agentes
type AgentStats struct {
	Journeys        JourneyStats `json:"journeys"`
	InstancesActive int64        `json:"instances_active"`
	ExecutionsToday int64        `json:"executions_today"`
	ExecutionRate   float64      `json:"execution_rate"`
	RecentActivity  int64        `json:"recent_activity_last_hour"`
}

// ActivityItem representa um item na lista de atividade
type ActivityItem struct {
	JourneyName string                 `json:"journey_name"`
	InstanceID  uuid.UUID              `json:"instance_id"`
	ContactJID  string                 `json:"contact_jid"`
	ContactName string                 `json:"contact_name"`
	GroupName   string                 `json:"group_name,omitempty"`
	Status      JourneyExecutionStatus `json:"status"`
	CurrentStep string                 `json:"current_step"`
	StepIndex   int                    `json:"step_index"`
	TotalSteps  int                    `json:"total_steps"`
	LastMessage string                 `json:"last_message,omitempty"`
	StartedAt   time.Time              `json:"started_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}
