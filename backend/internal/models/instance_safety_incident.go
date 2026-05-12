package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type InstanceSafetyIncident struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	Status     string     `gorm:"type:varchar(20);not null;default:'active';index" json:"status"`
	Severity   string     `gorm:"type:varchar(20);not null;default:'high'" json:"severity"`
	Reason     string     `gorm:"type:varchar(80);not null;index" json:"reason"`
	Message    string     `gorm:"type:text" json:"message"`
	Metadata   string     `gorm:"type:text" json:"metadata,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `gorm:"index" json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (i *InstanceSafetyIncident) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	if i.Status == "" {
		i.Status = "active"
	}
	if i.Severity == "" {
		i.Severity = "high"
	}
	return nil
}
