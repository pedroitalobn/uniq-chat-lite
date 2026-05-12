package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type InstanceEventLog struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID uuid.UUID `gorm:"type:uuid;not null;index" json:"instance_id"`
	Level      string    `gorm:"type:varchar(20);not null;index" json:"level"`
	Source     string    `gorm:"type:varchar(50);not null;index" json:"source"`
	Event      string    `gorm:"type:varchar(80);not null;index" json:"event"`
	Message    string    `gorm:"type:text" json:"message"`
	Metadata   string    `gorm:"type:text" json:"metadata,omitempty"`
	CreatedAt  time.Time `gorm:"index" json:"created_at"`
}

func (l *InstanceEventLog) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}
