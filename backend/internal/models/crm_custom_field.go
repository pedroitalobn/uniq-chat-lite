package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CrmCustomField — definição de um campo personalizado por workspace+entidade.
// Permite que cada cliente crie atributos próprios pra Deal/Contact/Company
// sem mudar schema (ex: "linkedin" tipo url no Deal, "score" tipo number no
// Contact). Os VALORES vivem na coluna `custom_fields jsonb` da entidade —
// mapa key→value indexado pelo `Key` daqui.
type CrmCustomField struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index:idx_ccf_ws_entity" json:"workspace_id"`
	EntityType  string    `gorm:"type:varchar(20);not null;index:idx_ccf_ws_entity" json:"entity_type"` // deal|contact|company

	// Key é o identificador estável usado nos valores (snake_case).
	// Slug-ado a partir do Name no create — depois imutável (mudar quebraria
	// referências nos values existentes).
	Key  string `gorm:"type:varchar(60);not null" json:"key"`
	Name string `gorm:"type:varchar(120);not null" json:"name"`

	// Type controla o input renderizado e a validação:
	//   text | textarea | number | date | url | select | multi | boolean
	Type string `gorm:"type:varchar(20);not null" json:"type"`

	// Options (JSON array) usado quando Type ∈ {select, multi}. Ex: ["lead","mql","sql"]
	Options string `gorm:"type:text" json:"options,omitempty"`

	Required bool `gorm:"default:false" json:"required"`
	Position int  `gorm:"default:0;index" json:"position"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (c *CrmCustomField) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// CustomFieldEntityTypes — valores aceitos em CrmCustomField.EntityType.
var CustomFieldEntityTypes = map[string]bool{
	"deal":    true,
	"contact": true,
	"company": true,
}

// CustomFieldTypes — valores aceitos em CrmCustomField.Type.
var CustomFieldTypes = map[string]bool{
	"text":     true,
	"textarea": true,
	"number":   true,
	"date":     true,
	"url":      true,
	"select":   true,
	"multi":    true,
	"boolean":  true,
}
