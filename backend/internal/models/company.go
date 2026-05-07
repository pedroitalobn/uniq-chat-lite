package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Company is the "organization" side of a CRM — groups multiple Contacts and
// can own Deals. Modeled after Pipedrive's Organization and Close's Lead
// (which they call "the primary object"). Optional on Contact, so personal
// contacts stay usable.
type Company struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	OwnerID     *uuid.UUID `gorm:"type:uuid;index" json:"owner_id,omitempty"`
	Owner       *User      `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`

	Name        string `gorm:"type:varchar(200);not null;index" json:"name"`
	LegalName   string `gorm:"type:varchar(200)" json:"legal_name,omitempty"`
	Domain      string `gorm:"type:varchar(190);index" json:"domain,omitempty"`
	Website     string `gorm:"type:text" json:"website,omitempty"`
	Industry    string `gorm:"type:varchar(120)" json:"industry,omitempty"`
	Size        string `gorm:"type:varchar(40)" json:"size,omitempty"` // 1-10, 11-50, 51-200, 201-1k, 1k+
	Description string `gorm:"type:text" json:"description,omitempty"`

	Phone        string `gorm:"type:varchar(40)" json:"phone,omitempty"`
	Email        string `gorm:"type:varchar(255)" json:"email,omitempty"`
	AddressLine  string `gorm:"type:varchar(255)" json:"address_line,omitempty"`
	City         string `gorm:"type:varchar(120)" json:"city,omitempty"`
	State        string `gorm:"type:varchar(120)" json:"state,omitempty"`
	Country      string `gorm:"type:varchar(120)" json:"country,omitempty"`
	PostalCode   string `gorm:"type:varchar(40)" json:"postal_code,omitempty"`
	TaxID        string `gorm:"type:varchar(40)" json:"tax_id,omitempty"` // CNPJ/CPF/EIN

	AnnualRevenue *int64 `gorm:"" json:"annual_revenue,omitempty"` // in minor currency units (cents)
	Currency      string `gorm:"type:varchar(8);default:'BRL'" json:"currency,omitempty"`

	LogoURL string `gorm:"type:text" json:"logo_url,omitempty"`

	// Denormalizations for fast listing without joins
	ContactCount int `gorm:"default:0" json:"contact_count"`
	DealCount    int `gorm:"default:0" json:"deal_count"`
	OpenDealSum  int64 `gorm:"default:0" json:"open_deal_sum"` // minor units

	// CustomFields — valores de campos personalizados (CrmCustomField,
	// entity_type=company). Mapa key→value; tipos validados no handler.
	CustomFields string `gorm:"type:jsonb;default:'{}'" json:"custom_fields,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (c *Company) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.Currency == "" {
		c.Currency = "BRL"
	}
	return nil
}
