package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type CampaignStatus string

const (
	CampaignStatusDraft     CampaignStatus = "draft"
	CampaignStatusScheduled CampaignStatus = "scheduled"
	CampaignStatusRunning   CampaignStatus = "running"
	CampaignStatusPaused    CampaignStatus = "paused"
	CampaignStatusCompleted CampaignStatus = "completed"
	CampaignStatusFailed    CampaignStatus = "failed"
)

type RecipientStatus string

const (
	RecipientStatusPending   RecipientStatus = "pending"
	RecipientStatusSent      RecipientStatus = "sent"
	RecipientStatusFailed    RecipientStatus = "failed"
)

// Campaign represents a bulk-send campaign.
// Recipients can be CRM contacts (phone numbers) or WhatsApp groups (JIDs).
// The scheduler respects StartDate/EndDate, TimesPerDay and ScheduleHours.
type Campaign struct {
	ID           uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	UserID       uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	InstanceID   uuid.UUID      `gorm:"type:uuid;not null;index" json:"instance_id"`
	Name         string         `gorm:"not null" json:"name"`

	// "contacts" or "groups"
	RecipientType string `gorm:"type:varchar(20);default:'contacts'" json:"recipient_type"`

	// Message
	MessageType string `gorm:"type:varchar(20);default:'text'" json:"message_type"` // text|image|audio|document
	MessageText string `gorm:"type:text" json:"message_text"`
	Caption     string `gorm:"type:text" json:"caption,omitempty"` // for image/video
	MediaB64    string `gorm:"type:text" json:"-"`
	MediaMime   string `gorm:"type:varchar(100)" json:"media_mime,omitempty"`
	MediaName   string `gorm:"type:varchar(255)" json:"media_name,omitempty"`

	// Scheduling window
	StartDate *time.Time `json:"start_date,omitempty"`
	EndDate   *time.Time `json:"end_date,omitempty"`

	// Frequency
	TimesTotal   int    `gorm:"default:1" json:"times_total"`    // total sends per recipient
	TimesPerDay  int    `gorm:"default:1" json:"times_per_day"` // max per day per recipient
	ScheduleHours string `gorm:"type:varchar(100);default:'[]'" json:"schedule_hours"` // JSON int array, e.g. "[9,14,18]"; empty = any hour
	DelaySeconds int    `gorm:"default:3" json:"delay_seconds"` // pause between sends

	Status      CampaignStatus `gorm:"type:varchar(20);default:'draft'" json:"status"`
	ScheduledAt *time.Time     `json:"scheduled_at,omitempty"` // kept for backward compat
	StartedAt   *time.Time     `json:"started_at,omitempty"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`

	TotalCount  int `json:"total_count"`
	SentCount   int `json:"sent_count"`
	FailedCount int `json:"failed_count"`

	Recipients []CampaignRecipient `gorm:"foreignKey:CampaignID" json:"recipients,omitempty"`
	CreatedAt  time.Time           `json:"created_at"`
	UpdatedAt  time.Time           `json:"updated_at"`
}

func (c *Campaign) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.ScheduleHours == "" {
		c.ScheduleHours = "[]"
	}
	if c.TimesTotal < 1 {
		c.TimesTotal = 1
	}
	if c.TimesPerDay < 1 {
		c.TimesPerDay = 1
	}
	return nil
}

// CampaignRecipient is a single target in a campaign.
// For "contacts" campaigns: JID holds a phone number (e.g. "5511999999999").
// For "groups" campaigns: JID holds the WhatsApp group JID (e.g. "120363xxx@g.us").
type CampaignRecipient struct {
	ID         uuid.UUID       `gorm:"type:uuid;primaryKey" json:"id"`
	CampaignID uuid.UUID       `gorm:"type:uuid;not null;index" json:"campaign_id"`
	// Phone kept for backward compat; JID is the canonical field.
	Phone    string          `gorm:"type:varchar(100);not null" json:"phone"`
	Name     string          `gorm:"type:varchar(100)" json:"name,omitempty"`
	Status   RecipientStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`

	// Multi-send tracking
	SendCount    int    `gorm:"default:0" json:"send_count"`
	SentToday    int    `gorm:"default:0" json:"sent_today"`
	LastSentDate string `gorm:"type:varchar(10)" json:"last_sent_date,omitempty"` // "2006-01-02"

	MessageID string     `gorm:"type:varchar(100)" json:"message_id,omitempty"`
	Error     string     `gorm:"type:text" json:"error,omitempty"`
	SentAt    *time.Time `json:"sent_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

func (r *CampaignRecipient) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}
