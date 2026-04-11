package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Plan struct {
	ID                uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	Name              string    `gorm:"not null" json:"name"`
	Price             float64   `gorm:"not null;default:0" json:"price"`
	MaxInstances      int       `gorm:"not null;default:1" json:"max_instances"`
	MaxMessagesPerDay int       `gorm:"not null;default:100" json:"max_messages_per_day"`
	Features          string    `gorm:"type:text;default:'{}'" json:"features"`
	AllowProxy        bool      `gorm:"default:false" json:"allow_proxy"`
	IsActive          bool      `gorm:"default:true" json:"is_active"`

	// Payment providers - Stripe
	StripePriceID string `gorm:"type:varchar(255)" json:"stripe_price_id,omitempty"`

	// Payment providers - Asaas
	AsaasProductID string `gorm:"type:varchar(255)" json:"asaas_product_id,omitempty"`

	// Users & Workspaces
	MaxUsers      int `gorm:"not null;default:1" json:"max_users"`      // max users per workspace (-1 = unlimited)
	MaxWorkspaces int `gorm:"not null;default:1" json:"max_workspaces"` // max workspaces per user (-1 = unlimited)

	// Proxy residencial
	AllowProxyResidencial bool `gorm:"default:false" json:"allow_proxy_residencial"` // enables residential proxy option
	MaxInstancesPerProxy  int  `gorm:"default:0" json:"max_instances_per_proxy"`     // max instances sharing one proxy entry
	MaxProxyPool          int  `gorm:"default:0" json:"max_proxy_pool"`              // total proxy entries the user can consume

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (p *Plan) IsUnlimitedUsers() bool {
	return p.MaxUsers == -1
}

func (p *Plan) IsUnlimitedWorkspaces() bool {
	return p.MaxWorkspaces == -1
}

func (p *Plan) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// IsUnlimited returns true when MaxInstances or MaxMessagesPerDay is -1 (unlimited)
func (p *Plan) IsUnlimitedInstances() bool {
	return p.MaxInstances == -1
}

func (p *Plan) IsUnlimitedMessages() bool {
	return p.MaxMessagesPerDay == -1
}
