package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// EmailSettings stores Maileroo configuration
type EmailSettings struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	APIKey      string    `json:"api_key,omitempty" gorm:"size:255"`
	SenderEmail string    `json:"sender_email" gorm:"size:255"`
	SenderName  string    `json:"sender_name" gorm:"size:255"`
	IsEnabled   bool      `json:"is_enabled" gorm:"default:true"`
	UpdatedAt   time.Time `json:"updated_at"`
	CreatedAt   time.Time `json:"created_at"`
}

func (e *EmailSettings) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}

// EmailTemplate stores email templates
type EmailTemplate struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Slug        string    `json:"slug" gorm:"uniqueIndex;size:100"` // welcome, password_reset, etc.
	Name        string    `json:"name" gorm:"size:255"`
	Subject     string    `json:"subject" gorm:"size:255"`
	HTMLContent string    `json:"html_content" gorm:"type:text"`
	IsActive    bool      `json:"is_active" gorm:"default:true"`
	UpdatedAt   time.Time `json:"updated_at"`
	CreatedAt   time.Time `json:"created_at"`
}

func (e *EmailTemplate) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}

// EmailLog stores email sending history
type EmailLog struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	To          string     `json:"to" gorm:"size:255;index"`
	Subject     string     `json:"subject" gorm:"size:500"`
	EmailType   string     `json:"email_type" gorm:"size:100;index"` // welcome, password_reset, etc.
	Status      string     `json:"status" gorm:"size:50"`            // sent, failed, pending
	ReferenceID string     `json:"reference_id" gorm:"size:255"`
	Error       string     `json:"error,omitempty" gorm:"type:text"`
	UserID      *uuid.UUID `json:"user_id,omitempty" gorm:"type:uuid"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (e *EmailLog) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}
