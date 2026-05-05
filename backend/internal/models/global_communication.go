package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// GlobalCommunicationSettings holds platform-wide communication provider config.
// Singleton record with id = "default".
type GlobalCommunicationSettings struct {
	ID string `json:"id" gorm:"primaryKey;default:'default'"` // always "default"

	// OTP / verification channel
	OTPProvider    string     `json:"otp_provider" gorm:"size:50;default:'email'"` // "email" | "whatsapp" | "sms"
	OTPInstanceID  *uuid.UUID `json:"otp_instance_id,omitempty" gorm:"type:uuid"`  // WhatsApp instance for OTP
	OTPSMSProvider string     `json:"otp_sms_provider" gorm:"size:50"`             // e.g. "twilio", "vonage"
	OTPSMSKey      string     `json:"otp_sms_key,omitempty" gorm:"size:255"`
	OTPSMSSecret   string     `json:"otp_sms_secret,omitempty" gorm:"size:255"`
	OTPSMSFrom     string     `json:"otp_sms_from" gorm:"size:50"`

	// Automated messages channel
	AutoMsgProvider   string     `json:"auto_msg_provider" gorm:"size:50;default:'email'"` // "email" | "whatsapp"
	AutoMsgInstanceID *uuid.UUID `json:"auto_msg_instance_id,omitempty" gorm:"type:uuid"`  // WhatsApp instance

	// Instagram for communication
	InstagramAccountID *uuid.UUID `json:"instagram_account_id,omitempty" gorm:"type:uuid"`

	UpdatedAt time.Time `json:"updated_at"`
	CreatedAt time.Time `json:"created_at"`
}

func (g *GlobalCommunicationSettings) BeforeCreate(_ *gorm.DB) error {
	if g.ID == "" {
		g.ID = "default"
	}
	return nil
}
