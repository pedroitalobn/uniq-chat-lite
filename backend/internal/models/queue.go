package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// QueueAssignmentStrategy dictates how DispatchService picks the next agent.
type QueueAssignmentStrategy string

const (
	QueueStrategyRoundRobin   QueueAssignmentStrategy = "round_robin"
	QueueStrategyLeastBusy    QueueAssignmentStrategy = "least_busy"
	QueueStrategyLoadBalanced QueueAssignmentStrategy = "load_balanced"
	QueueStrategyManual       QueueAssignmentStrategy = "manual"
	QueueStrategyStickyOwner  QueueAssignmentStrategy = "sticky_owner"
)

// Queue is a logical routing bucket; conversations land in one Queue and
// DispatchService picks an agent based on AssignmentStrategy.
// A Queue may reference a Department, a Team, or neither (workspace-wide).
type Queue struct {
	ID           uuid.UUID   `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID  uuid.UUID   `gorm:"type:uuid;not null;index" json:"workspace_id"`
	DepartmentID *uuid.UUID  `gorm:"type:uuid;index" json:"department_id,omitempty"`
	Department   *Department `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`
	TeamID       *uuid.UUID  `gorm:"type:uuid;index" json:"team_id,omitempty"`
	Team         *Team       `gorm:"foreignKey:TeamID" json:"team,omitempty"`

	Name        string `gorm:"type:varchar(100);not null" json:"name"`
	Description string `gorm:"type:text" json:"description,omitempty"`
	Color       string `gorm:"type:varchar(9);default:'#64748b'" json:"color"`

	AssignmentStrategy   QueueAssignmentStrategy `gorm:"type:varchar(30);default:'round_robin'" json:"assignment_strategy"`
	MaxConcurrentPerUser int                     `gorm:"default:0" json:"max_concurrent_per_user"`
	AutoAssignOnOpen     bool                    `gorm:"default:true" json:"auto_assign_on_open"`
	AutoCloseAfterHours  int                     `gorm:"default:0" json:"auto_close_after_hours"`
	ReopenWindowMinutes  int                     `gorm:"default:120" json:"reopen_window_minutes"`

	EnableChatbot  bool       `gorm:"default:false" json:"enable_chatbot"`
	ChatbotAgentID *uuid.UUID `gorm:"type:uuid" json:"chatbot_agent_id,omitempty"`

	BusinessHoursJSON string `gorm:"type:text" json:"business_hours,omitempty"` // JSON {mon:{start,end},...}
	TimezoneTZ        string `gorm:"type:varchar(50);default:'America/Sao_Paulo'" json:"timezone"`
	OffHoursMessage   string `gorm:"type:text" json:"off_hours_message,omitempty"`

	FirstResponseSLAMinutes int `gorm:"default:0" json:"first_response_sla_minutes"`
	ResolutionSLAMinutes    int `gorm:"default:0" json:"resolution_sla_minutes"`

	Priority int  `gorm:"default:0" json:"priority"`
	IsActive bool `gorm:"default:true;index" json:"is_active"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (q *Queue) BeforeCreate(tx *gorm.DB) error {
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	if q.AssignmentStrategy == "" {
		q.AssignmentStrategy = QueueStrategyRoundRobin
	}
	if q.ReopenWindowMinutes == 0 {
		q.ReopenWindowMinutes = 120
	}
	if q.TimezoneTZ == "" {
		q.TimezoneTZ = "America/Sao_Paulo"
	}
	return nil
}

// QueueMember is the explicit (queue_id, user_id) membership — decided per
// user-request: team membership does NOT cascade into queue membership.
type QueueMember struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	QueueID        uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:uk_queue_user;index" json:"queue_id"`
	UserID         uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:uk_queue_user;index" json:"user_id"`
	CanReceive     bool       `gorm:"default:true" json:"can_receive"`
	Priority       int        `gorm:"default:0" json:"priority"`
	LastAssignedAt *time.Time `gorm:"index" json:"last_assigned_at,omitempty"`
	JoinedAt       time.Time  `gorm:"autoCreateTime" json:"joined_at"`
}

func (m *QueueMember) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

// QueueChannel binds an Instance to a Queue. An Instance may feed 1..N Queues.
// The flag IsDefault selects the landing Queue when a message has no other
// routing rule applicable.
type QueueChannel struct {
	QueueID    uuid.UUID `gorm:"type:uuid;primaryKey" json:"queue_id"`
	InstanceID uuid.UUID `gorm:"type:uuid;primaryKey;index" json:"instance_id"`
	IsDefault  bool      `gorm:"default:false" json:"is_default"`
	CreatedAt  time.Time `json:"created_at"`
}
