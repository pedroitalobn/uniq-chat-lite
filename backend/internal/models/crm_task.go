package models

import (
	"time"

	"github.com/google/uuid"
	"encoding/json"

	"gorm.io/gorm"
)

// CrmTaskType e CrmTaskStatus refletem o vocabulário comum em CRMs
// (HubSpot/Pipedrive). Mantemos enums em string pra ser amigável em
// JSON/queries e permitir extensão sem migration.
type CrmTaskType string
type CrmTaskStatus string
type CrmTaskPriority string
type CrmTaskAssignee string

const (
	TaskTypeCall        CrmTaskType = "call"
	TaskTypeFollowUp    CrmTaskType = "follow_up"
	TaskTypeMessage     CrmTaskType = "message"
	TaskTypeMeetingPrep CrmTaskType = "meeting_prep"
	TaskTypeEmail       CrmTaskType = "email"
	TaskTypeCustom      CrmTaskType = "custom"

	TaskStatusPending    CrmTaskStatus = "pending"
	TaskStatusInProgress CrmTaskStatus = "in_progress"
	TaskStatusCompleted  CrmTaskStatus = "completed"
	TaskStatusCancelled  CrmTaskStatus = "cancelled"

	TaskPriorityLow    CrmTaskPriority = "low"
	TaskPriorityMedium CrmTaskPriority = "medium"
	TaskPriorityHigh   CrmTaskPriority = "high"

	TaskAssigneeUser  CrmTaskAssignee = "user"
	TaskAssigneeAgent CrmTaskAssignee = "agent"
)

// CrmTask representa uma tarefa do CRM. Pode ser executada por um
// usuário humano ou delegada a um agente IA — neste último caso o
// worker (cmd/task_runner) dispara as ações descritas em
// AgentInstructions quando DueAt chega (ex.: "enviar mensagem
// confirmando reunião"). O resultado fica em AgentResult pra audit.
type CrmTask struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	CreatedByID uuid.UUID `gorm:"type:uuid;not null;index" json:"created_by_id"`

	Title       string          `gorm:"type:varchar(200);not null" json:"title"`
	Description string          `gorm:"type:text" json:"description,omitempty"`
	Type        CrmTaskType     `gorm:"type:varchar(20);default:'custom';index" json:"type"`
	Status      CrmTaskStatus   `gorm:"type:varchar(20);default:'pending';index" json:"status"`
	Priority    CrmTaskPriority `gorm:"type:varchar(10);default:'medium'" json:"priority"`

	DueAt       *time.Time `gorm:"index" json:"due_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`

	// Atribuição: user (humano) ou agent (IA). Quando agent, o worker
	// cuida da execução automática.
	AssigneeType    CrmTaskAssignee `gorm:"type:varchar(10);default:'user';index" json:"assignee_type"`
	AssigneeUserID  *uuid.UUID      `gorm:"type:uuid;index" json:"assignee_user_id,omitempty"`
	AssigneeAgentID *uuid.UUID      `gorm:"type:uuid;index" json:"assignee_agent_id,omitempty"`

	// Vínculos com entidades CRM — todos opcionais; UI usa pra mostrar
	// a tarefa nos drawers de Deal/Contact/Company.
	ContactID      *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`
	CompanyID      *uuid.UUID `gorm:"type:uuid;index" json:"company_id,omitempty"`
	DealID         *uuid.UUID `gorm:"type:uuid;index" json:"deal_id,omitempty"`
	MeetingID      *uuid.UUID `gorm:"type:uuid;index" json:"meeting_id,omitempty"`
	ConversationID *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`

	// Execução por agente IA — instructions é texto livre que o LLM usa
	// como prompt; channel/instance opcional pra escolher por onde sair.
	AgentInstructions string         `gorm:"type:text" json:"agent_instructions,omitempty"`
	AgentInstanceID   *uuid.UUID     `gorm:"type:uuid" json:"agent_instance_id,omitempty"`
	AgentExecutedAt   *time.Time     `json:"agent_executed_at,omitempty"`
	AgentResult       string         `gorm:"type:text" json:"agent_result,omitempty"`
	AgentError        string         `gorm:"type:text" json:"agent_error,omitempty"`
	Metadata          json.RawMessage `gorm:"type:jsonb" json:"metadata,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (t *CrmTask) BeforeCreate(_ *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	if t.Status == "" {
		t.Status = TaskStatusPending
	}
	if t.Type == "" {
		t.Type = TaskTypeCustom
	}
	if t.Priority == "" {
		t.Priority = TaskPriorityMedium
	}
	if t.AssigneeType == "" {
		t.AssigneeType = TaskAssigneeUser
	}
	return nil
}

func (CrmTask) TableName() string { return "crm_tasks" }
