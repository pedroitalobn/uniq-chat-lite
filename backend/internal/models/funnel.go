package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Funnel struct {
	ID          uuid.UUID     `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID     `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID *uuid.UUID    `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Name        string        `gorm:"type:varchar(120);not null" json:"name"`
	Description string        `gorm:"type:text" json:"description,omitempty"`
	Color       string        `gorm:"type:varchar(20)" json:"color,omitempty"`
	IsDefault   bool          `gorm:"default:false" json:"is_default"`
	Stages      []FunnelStage `gorm:"foreignKey:FunnelID" json:"stages,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

func (f *Funnel) BeforeCreate(tx *gorm.DB) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	return nil
}

type FunnelStage struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	FunnelID  uuid.UUID `gorm:"type:uuid;not null;index" json:"funnel_id"`
	Name      string    `gorm:"type:varchar(120);not null" json:"name"`
	Order     int       `gorm:"default:0" json:"order"`
	Color     string    `gorm:"type:varchar(20)" json:"color,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (fs *FunnelStage) BeforeCreate(tx *gorm.DB) error {
	if fs.ID == uuid.Nil {
		fs.ID = uuid.New()
	}
	return nil
}
