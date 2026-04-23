package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Team is a group of agents that collaborate. A Team may (optionally) belong
// to a Department. Assignment and visibility ("/inbox/team") use this entity.
type Team struct {
	ID           uuid.UUID   `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID  uuid.UUID   `gorm:"type:uuid;not null;index" json:"workspace_id"`
	DepartmentID *uuid.UUID  `gorm:"type:uuid;index" json:"department_id,omitempty"`
	Department   *Department `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`
	Name         string      `gorm:"type:varchar(100);not null" json:"name"`
	Description  string      `gorm:"type:text" json:"description,omitempty"`
	LeaderUserID *uuid.UUID  `gorm:"type:uuid;index" json:"leader_user_id,omitempty"`
	IsActive     bool        `gorm:"default:true;index" json:"is_active"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (t *Team) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

// TeamMember is the (team_id, user_id) M2M relationship with a role flag.
type TeamMember struct {
	ID       uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	TeamID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:uk_team_user;index" json:"team_id"`
	UserID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:uk_team_user;index" json:"user_id"`
	Role     string    `gorm:"type:varchar(20);default:'member'" json:"role"` // member | lead | observer
	JoinedAt time.Time `gorm:"autoCreateTime" json:"joined_at"`
}

func (m *TeamMember) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}
