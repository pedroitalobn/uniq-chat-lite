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
	RecipientStatusPending RecipientStatus = "pending"
	RecipientStatusSent    RecipientStatus = "sent"
	RecipientStatusFailed  RecipientStatus = "failed"
)

// CampaignAction defines what the campaign does per recipient.
type CampaignAction string

const (
	CampaignActionSendMessage CampaignAction = "send_message" // WhatsApp / WABA / IG DM
	CampaignActionFollow      CampaignAction = "follow"        // Instagram follow
	CampaignActionUnfollow    CampaignAction = "unfollow"       // Instagram unfollow
	CampaignActionLike        CampaignAction = "like"           // Instagram like post
	CampaignActionComment     CampaignAction = "comment"        // Instagram comment on post
)

// Campaign represents a bulk-send/action campaign.
// Recipients can be CRM contacts, WhatsApp groups, CSV uploads or
// social-media audiences (followers, following, etc.).
// The scheduler respects StartDate/EndDate, TimesPerDay and ScheduleHours.
type Campaign struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID *uuid.UUID `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	InstanceID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	Name        string     `gorm:"not null" json:"name"`

	// Channel derived from the instance (whatsapp|waba|instagram|telegram…)
	Channel string `gorm:"type:varchar(30)" json:"channel,omitempty"`

	// Action to perform per recipient
	ActionType CampaignAction `gorm:"type:varchar(30);default:'send_message'" json:"action_type"`

	// Channel-specific config (JSON blob — e.g. post_url for like/comment)
	ChannelConfig string `gorm:"type:text;default:'{}'" json:"channel_config,omitempty"`

	// "contacts", "groups", "crm", "segment", "followers", "following"
	RecipientType string `gorm:"type:varchar(30);default:'contacts'" json:"recipient_type"`

	// CRM segmentation filters (JSON)
	SegmentFilter string `gorm:"type:text;default:'{}'" json:"segment_filter,omitempty"`

	// Message — para canais texto livre (whatsmeow, IG DM)
	MessageType string `gorm:"type:varchar(20);default:'text'" json:"message_type"` // text|image|audio|document|template
	MessageText string `gorm:"type:text" json:"message_text"`
	Caption     string `gorm:"type:text" json:"caption,omitempty"`
	MediaB64    string `gorm:"type:text" json:"-"`
	MediaMime   string `gorm:"type:varchar(100)" json:"media_mime,omitempty"`
	MediaName   string `gorm:"type:varchar(255)" json:"media_name,omitempty"`

	// WABA template — usado quando MessageType="template".
	// TemplateVariables é JSON map nome→valor (Liquid).
	TemplateName      string `gorm:"type:varchar(120)" json:"template_name,omitempty"`
	TemplateLanguage  string `gorm:"type:varchar(20)" json:"template_language,omitempty"`
	TemplateVariables string `gorm:"type:text;default:'{}'" json:"template_variables,omitempty"`
	TemplateHeaderURL string `gorm:"type:text" json:"template_header_url,omitempty"`

	// Scheduling window
	StartDate *time.Time `json:"start_date,omitempty"`
	EndDate   *time.Time `json:"end_date,omitempty"`

	// Frequency
	TimesTotal    int    `gorm:"default:1" json:"times_total"`
	TimesPerDay   int    `gorm:"default:1" json:"times_per_day"`
	ScheduleHours string `gorm:"type:varchar(100);default:'[]'" json:"schedule_hours"`

	// Safety / rate limiting
	DelaySeconds         int `gorm:"default:3" json:"delay_seconds"`          // fixed delay (legacy)
	DelayMinSeconds      int `gorm:"default:3" json:"delay_min_seconds"`       // randomized min delay
	DelayMaxSeconds      int `gorm:"default:10" json:"delay_max_seconds"`      // randomized max delay
	DailyLimitPerAccount int `gorm:"default:0" json:"daily_limit_per_account"` // 0 = unlimited

	Status      CampaignStatus `gorm:"type:varchar(20);default:'draft'" json:"status"`
	ScheduledAt *time.Time     `json:"scheduled_at,omitempty"`
	StartedAt   *time.Time     `json:"started_at,omitempty"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`

	TotalCount  int `json:"total_count"`
	SentCount   int `json:"sent_count"`
	FailedCount int `json:"failed_count"`

	Recipients []CampaignRecipient `gorm:"foreignKey:CampaignID" json:"recipients,omitempty"`
	CreatedAt  time.Time           `json:"created_at"`
	UpdatedAt  time.Time           `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
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
	if c.ActionType == "" {
		c.ActionType = CampaignActionSendMessage
	}
	if c.DelayMinSeconds < 1 {
		c.DelayMinSeconds = c.DelaySeconds
		if c.DelayMinSeconds < 1 {
			c.DelayMinSeconds = 3
		}
	}
	if c.DelayMaxSeconds < c.DelayMinSeconds {
		c.DelayMaxSeconds = c.DelayMinSeconds + 7
	}
	return nil
}

// CampaignRecipient is a single target in a campaign.
// For "contacts" campaigns: JID holds a phone number (e.g. "5511999999999").
// For "groups" campaigns: JID holds the WhatsApp group JID (e.g. "120363xxx@g.us").
type CampaignRecipient struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	CampaignID uuid.UUID `gorm:"type:uuid;not null;index" json:"campaign_id"`
	// Phone kept for backward compat; JID is the canonical field.
	Phone  string          `gorm:"type:varchar(100);not null" json:"phone"`
	Name   string          `gorm:"type:varchar(100)" json:"name,omitempty"`
	Status RecipientStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`

	// Multi-send tracking
	SendCount    int    `gorm:"default:0" json:"send_count"`
	SentToday    int    `gorm:"default:0" json:"sent_today"`
	LastSentDate string `gorm:"type:varchar(10)" json:"last_sent_date,omitempty"` // "2006-01-02"

	MessageID   string     `gorm:"type:varchar(120);index" json:"message_id,omitempty"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	SentAt      *time.Time `json:"sent_at,omitempty"`
	DeliveredAt *time.Time `json:"delivered_at,omitempty"` // webhook delivered (WABA)
	ReadAt      *time.Time `json:"read_at,omitempty"`      // webhook read (WABA)
	CreatedAt   time.Time  `json:"created_at"`
}

func (r *CampaignRecipient) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}
