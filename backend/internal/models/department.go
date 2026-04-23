package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Department groups Teams and Queues under a business unit (Vendas, Suporte,
// Financeiro...). It is purely organizational; routing lives on Queue.
type Department struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Name        string    `gorm:"type:varchar(100);not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	Color       string    `gorm:"type:varchar(9);default:'#64748b'" json:"color"`
	Icon        string    `gorm:"type:varchar(50)" json:"icon,omitempty"`
	IsActive    bool      `gorm:"default:true;index" json:"is_active"`
	SortOrder   int       `gorm:"default:0" json:"sort_order"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (d *Department) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}
