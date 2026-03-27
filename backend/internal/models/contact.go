package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Contact struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name       string    `gorm:"not null" json:"name"`
	Phone      string    `gorm:"not null;index" json:"phone"`
	Email      string    `gorm:"type:varchar(255)" json:"email,omitempty"`
	Notes      string    `gorm:"type:text" json:"notes,omitempty"`
	AvatarURL  string    `gorm:"type:text" json:"avatar_url,omitempty"`
	// CRM pipeline fields
	Funnel     string    `gorm:"type:varchar(120);index" json:"funnel,omitempty"`
	Stage      string    `gorm:"type:varchar(120);index" json:"stage,omitempty"`
	Journey    string    `gorm:"type:varchar(120)" json:"journey,omitempty"`
	ExternalID string    `gorm:"type:varchar(255);index" json:"external_id,omitempty"`
	Owner      string    `gorm:"type:varchar(120)" json:"owner,omitempty"`
	Tags       []Tag     `gorm:"many2many:contact_tags;joinForeignKey:ContactID;joinReferences:TagID" json:"tags,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (c *Contact) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

type Tag struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name      string    `gorm:"not null" json:"name"`
	Color     string    `gorm:"type:varchar(20);default:'#64748b'" json:"color"`
	CreatedAt time.Time `json:"created_at"`
}

func (t *Tag) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}
