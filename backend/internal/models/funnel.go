package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// FunnelType distinguishes between a pipeline that tracks contacts (leads
// sem valor monetário, estilo CRM de jornada) de um que rastreia Deals
// (oportunidades com valor/probabilidade, estilo Pipedrive).
type FunnelType string

const (
	FunnelTypeContacts FunnelType = "contacts"
	FunnelTypeDeals    FunnelType = "deals"
)

type Funnel struct {
	ID            uuid.UUID     `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID     `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID   *uuid.UUID    `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Name          string        `gorm:"type:varchar(120);not null" json:"name"`
	Description   string        `gorm:"type:text" json:"description,omitempty"`
	Color         string        `gorm:"type:varchar(20)" json:"color,omitempty"`
	IsDefault     bool          `gorm:"default:false" json:"is_default"`
	Type          FunnelType    `gorm:"type:varchar(20);default:'contacts'" json:"type"`
	ProbabilityOn bool          `gorm:"default:false" json:"probability_on"`
	Currency      string        `gorm:"type:varchar(8);default:'BRL'" json:"currency"`
	Stages        []FunnelStage `gorm:"foreignKey:FunnelID" json:"stages,omitempty"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

func (f *Funnel) BeforeCreate(tx *gorm.DB) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	return nil
}

type FunnelStage struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	FunnelID    uuid.UUID `gorm:"type:uuid;not null;index" json:"funnel_id"`
	Name        string    `gorm:"type:varchar(120);not null" json:"name"`
	Order       int       `gorm:"default:0" json:"order"`
	Color       string    `gorm:"type:varchar(20)" json:"color,omitempty"`
	Probability int       `gorm:"default:0" json:"probability"` // 0..100, % fechar
	RottenDays  int       `gorm:"default:0" json:"rotten_days"` // 0 desabilita
	IsWon       bool      `gorm:"default:false" json:"is_won"`
	IsLost      bool      `gorm:"default:false" json:"is_lost"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (fs *FunnelStage) BeforeCreate(tx *gorm.DB) error {
	if fs.ID == uuid.Nil {
		fs.ID = uuid.New()
	}
	return nil
}
