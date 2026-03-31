package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AccountStatus represents the connection status of a social account
type AccountStatus string

const (
	AccountConnected    AccountStatus = "connected"
	AccountDisconnected AccountStatus = "disconnected"
	AccountBanned       AccountStatus = "banned"
	AccountPending      AccountStatus = "pending"
)

// InstagramAccount stores credentials and metadata for an Instagram account.
type InstagramAccount struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Username      string    `gorm:"type:varchar(100);not null;uniqueIndex" json:"username"`
	FullName      string    `gorm:"type:varchar(255)" json:"full_name,omitempty"`
	ProfilePicURL string    `gorm:"type:text" json:"profile_pic_url,omitempty"`
	Bio           string    `gorm:"type:text" json:"bio,omitempty"`

	// Instagram credentials (encrypted)
	SessionJSON string `gorm:"type:text" json:"-"`         // IG session cookies (encrypted)
	PasswordEnc string `gorm:"type:varchar(512)" json:"-"` // encrypted password

	// Status
	Status     AccountStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	IsVerified bool          `gorm:"default:false" json:"is_verified"`
	Followers  int           `gorm:"default:0" json:"followers"`
	Following  int           `gorm:"default:0" json:"following"`
	Posts      int           `gorm:"default:0" json:"posts"`

	// Settings
	AutoReply     bool       `gorm:"default:false" json:"auto_reply"`
	AIEnabled     bool       `gorm:"default:false" json:"ai_enabled"`
	IntegrationID *uuid.UUID `gorm:"type:uuid" json:"integration_id,omitempty"` // LLM integration

	// Taktik device assignment
	TaktikDeviceID string `gorm:"type:varchar(100)" json:"taktik_device_id,omitempty"`

	// API proxy for instagram-cli
	APIProxyURL string `gorm:"type:varchar(255)" json:"api_proxy_url,omitempty"`

	LastActive *time.Time `json:"last_active,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (a *InstagramAccount) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// TikTokAccount stores credentials and metadata for a TikTok account.
type TikTokAccount struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Username  string    `gorm:"type:varchar(100);not null;uniqueIndex" json:"username"`
	Nickname  string    `gorm:"type:varchar(255)" json:"nickname,omitempty"`
	AvatarURL string    `gorm:"type:text" json:"avatar_url,omitempty"`
	Bio       string    `gorm:"type:text" json:"bio,omitempty"`

	// TikTok credentials (encrypted)
	SessionJSON string `gorm:"type:text" json:"-"`         // TikTok session cookies (encrypted)
	PasswordEnc string `gorm:"type:varchar(512)" json:"-"` // encrypted password

	// Status
	Status    AccountStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	Followers int           `gorm:"default:0" json:"followers"`
	Following int           `gorm:"default:0" json:"following"`
	Likes     int           `gorm:"default:0" json:"likes"`
	Videos    int           `gorm:"default:0" json:"videos"`

	// Settings
	AutoReply     bool       `gorm:"default:false" json:"auto_reply"`
	AIEnabled     bool       `gorm:"default:false" json:"ai_enabled"`
	IntegrationID *uuid.UUID `gorm:"type:uuid" json:"integration_id,omitempty"` // LLM integration

	// Taktik device assignment
	TaktikDeviceID string `gorm:"type:varchar(100)" json:"taktik_device_id,omitempty"`

	LastActive *time.Time `json:"last_active,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (a *TikTokAccount) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// SocialDM represents a direct message from/to Instagram or TikTok
type SocialDM struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	AccountID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"account_id"`
	AccountType    string     `gorm:"type:varchar(20);not null" json:"account_type"` // instagram | tiktok
	ThreadID       string     `gorm:"type:varchar(100);index" json:"thread_id"`
	SenderID       string     `gorm:"type:varchar(100)" json:"sender_id"`
	SenderUsername string     `gorm:"type:varchar(100)" json:"sender_username"`
	Message        string     `gorm:"type:text" json:"message"`
	MediaURL       string     `gorm:"type:text" json:"media_url,omitempty"`
	IsIncoming     bool       `gorm:"default:true" json:"is_incoming"` // true = received, false = sent
	IsAIResponse   bool       `gorm:"default:false" json:"is_ai_response"`
	ReadAt         *time.Time `json:"read_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func (d *SocialDM) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}

// SocialTarget represents a scraped user profile from Instagram or TikTok
type SocialTarget struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Platform      string    `gorm:"type:varchar(20);not null" json:"platform"` // instagram | tiktok
	Username      string    `gorm:"type:varchar(100);not null" json:"username"`
	FullName      string    `gorm:"type:varchar(255)" json:"full_name,omitempty"`
	ProfilePicURL string    `gorm:"type:text" json:"profile_pic_url,omitempty"`
	Bio           string    `gorm:"type:text" json:"bio,omitempty"`
	Followers     int       `gorm:"default:0" json:"followers"`
	Following     int       `gorm:"default:0" json:"following"`
	Posts         int       `gorm:"default:0" json:"posts"`
	IsPrivate     bool      `gorm:"default:false" json:"is_private"`
	IsVerified    bool      `gorm:"default:false" json:"is_verified"`

	// CRM linking
	ContactID *uuid.UUID `gorm:"type:uuid" json:"contact_id,omitempty"` // linked CRM contact

	// Scraping metadata
	Source      string    `gorm:"type:varchar(50)" json:"source,omitempty"`        // followers, hashtag, post_url
	ScrapedFrom string    `gorm:"type:varchar(100)" json:"scraped_from,omitempty"` // target username or hashtag
	ScrapedAt   time.Time `json:"scraped_at"`

	// Tags for segmentation
	Tags []Tag `gorm:"many2many:social_target_tags" json:"tags,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (t *SocialTarget) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

// TaktikDevice represents an Android device/emulator running Taktik
type TaktikDevice struct {
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Name          string     `gorm:"type:varchar(100);not null" json:"name"`
	DeviceID      string     `gorm:"type:varchar(100);not null;uniqueIndex" json:"device_id"` // ADB device ID
	IP            string     `gorm:"type:varchar(50)" json:"ip,omitempty"`
	Port          int        `gorm:"default:5555" json:"port"`
	IsOnline      bool       `gorm:"default:false" json:"is_online"`
	AssignedTo    *uuid.UUID `gorm:"type:uuid" json:"assigned_to,omitempty"`     // instance/account ID
	Platform      string     `gorm:"type:varchar(20)" json:"platform,omitempty"` // instagram | tiktok
	LastHeartbeat *time.Time `json:"last_heartbeat,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

func (d *TaktikDevice) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}
