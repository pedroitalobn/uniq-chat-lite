package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	GroupJoinStatusPending = "pending"
	GroupJoinStatusRunning = "running"
	GroupJoinStatusJoined  = "joined"
	GroupJoinStatusFailed  = "failed"
)

type GroupJoinJob struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	InviteLink  string     `gorm:"type:text" json:"invite_link"`
	InviteCode  string     `gorm:"type:varchar(255);not null;index" json:"invite_code"`
	GroupJID    string     `gorm:"type:varchar(120)" json:"group_jid,omitempty"`
	GroupName   string     `gorm:"type:varchar(255)" json:"group_name,omitempty"`
	Status      string     `gorm:"type:varchar(20);not null;default:'pending';index" json:"status"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	Attempts    int        `gorm:"default:0" json:"attempts"`
	ScheduledAt time.Time  `gorm:"index" json:"scheduled_at"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (j *GroupJoinJob) BeforeCreate(tx *gorm.DB) error {
	if j.ID == uuid.Nil {
		j.ID = uuid.New()
	}
	if j.Status == "" {
		j.Status = GroupJoinStatusPending
	}
	if j.ScheduledAt.IsZero() {
		j.ScheduledAt = time.Now()
	}
	return nil
}
