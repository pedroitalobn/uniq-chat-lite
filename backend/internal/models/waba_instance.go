package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WABAInstance struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID       uuid.UUID `gorm:"type:uuid;not null;index" json:"instance_id"`
	WABABusinessID   string    `gorm:"type:varchar(50)" json:"waba_business_id"`
	PhoneNumberID    string    `gorm:"type:varchar(50)" json:"phone_number_id"`
	PhoneNumber      string    `gorm:"type:varchar(30)" json:"phone_number"`
	AccessToken      string    `gorm:"type:text" json:"-"`
	WebhookURL       string    `gorm:"type:text" json:"webhook_url"`
	Status           string    `gorm:"type:varchar(20);default:'active'" json:"status"`
	VerifiedName     string    `gorm:"type:varchar(100)" json:"verified_name"`
	CodeVerification string    `gorm:"type:varchar(20)" json:"code_verification,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (w *WABAInstance) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}

func (w *WABAInstance) TableName() string {
	return "waba_instances"
}
