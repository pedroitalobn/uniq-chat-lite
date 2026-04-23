package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// QuickReply is a reusable response template. OwnerUserID nil means shared
// across the workspace (requires quickreplies:manage_shared). Otherwise it is
// personal to that user.
type QuickReply struct {
	ID           uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	OwnerUserID  *uuid.UUID `gorm:"type:uuid;index" json:"owner_user_id,omitempty"`
	Shortcut     string     `gorm:"type:varchar(50);index" json:"shortcut"` // "/saudacao"
	Title        string     `gorm:"type:varchar(120)" json:"title,omitempty"`
	Body         string     `gorm:"type:text;not null" json:"body"`
	MediaURL     string     `gorm:"type:text" json:"media_url,omitempty"`
	MediaType    string     `gorm:"type:varchar(30)" json:"media_type,omitempty"`
	VariablesCSV string     `gorm:"type:text" json:"variables,omitempty"` // comma-separated "contact.name,agent.name"
	DepartmentID *uuid.UUID `gorm:"type:uuid;index" json:"department_id,omitempty"`
	QueueID      *uuid.UUID `gorm:"type:uuid;index" json:"queue_id,omitempty"`
	UsageCount   int        `gorm:"default:0" json:"usage_count"`
	IsActive     bool       `gorm:"default:true" json:"is_active"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (q *QuickReply) BeforeCreate(tx *gorm.DB) error {
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	return nil
}
