package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ContactSource string

const (
	SourceWhatsApp  ContactSource = "whatsapp"
	SourceWABA      ContactSource = "waba"
	SourceInstagram ContactSource = "instagram"
	SourceTelegram  ContactSource = "telegram"
	SourceLinkedIn  ContactSource = "linkedin"
	SourceTikTok    ContactSource = "tiktok"
	SourceKwai      ContactSource = "kwai"
	SourceManual    ContactSource = "manual"
)

var ContactSourceMeta = map[ContactSource]struct {
	Label  string
	Color  string
	Assets string
}{
	SourceWhatsApp:  {Label: "WhatsApp", Color: "#25d366", Assets: ""},
	SourceWABA:      {Label: "WhatsApp Business", Color: "#25d366", Assets: ""},
	SourceInstagram: {Label: "Instagram", Color: "#e1306c", Assets: ""},
	SourceTelegram:  {Label: "Telegram", Color: "#229ed9", Assets: ""},
	SourceLinkedIn:  {Label: "LinkedIn", Color: "#0a66c2", Assets: ""},
	SourceTikTok:    {Label: "TikTok", Color: "#ff0050", Assets: ""},
	SourceKwai:      {Label: "Kwai", Color: "#ff6600", Assets: ""},
	SourceManual:    {Label: "Manual", Color: "#64748b", Assets: ""},
}

type Contact struct {
	ID          uuid.UUID     `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID     `gorm:"type:uuid;not null;index" json:"user_id"`
	User        *User         `gorm:"foreignKey:UserID" json:"user,omitempty"`
	WorkspaceID *uuid.UUID    `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	OwnerID     *uuid.UUID    `gorm:"type:uuid;index" json:"owner_id,omitempty"`
	Owner       *User         `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Name        string        `gorm:"not null" json:"name"`
	Phone       string        `gorm:"not null;index" json:"phone"`
	Email       string        `gorm:"type:varchar(255)" json:"email,omitempty"`
	Notes       string        `gorm:"type:text" json:"notes,omitempty"`
	AvatarURL   string        `gorm:"type:text" json:"avatar_url,omitempty"`
	Source      ContactSource `gorm:"type:varchar(20);default:'manual'" json:"source,omitempty"`
	InstanceID  *uuid.UUID    `gorm:"type:uuid;index" json:"instance_id,omitempty"`
	// CRM pipeline fields
	Funnel     string `gorm:"type:varchar(120);index" json:"funnel,omitempty"`
	Stage      string `gorm:"type:varchar(120);index" json:"stage,omitempty"`
	Journey    string `gorm:"type:varchar(120)" json:"journey,omitempty"`
	ExternalID string `gorm:"type:varchar(255);index" json:"external_id,omitempty"`
	Tags       []Tag  `gorm:"many2many:contact_tags;joinForeignKey:ContactID;joinReferences:TagID" json:"tags,omitempty"`

	// Ticketing defaults — used by DispatchService as sticky preferences
	DefaultQueueID       *uuid.UUID `gorm:"type:uuid;index" json:"default_queue_id,omitempty"`
	PreferredChannelType string     `gorm:"type:varchar(30)" json:"preferred_channel_type,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (c *Contact) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

type Tag struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID *uuid.UUID `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Name        string     `gorm:"not null" json:"name"`
	Color       string     `gorm:"type:varchar(20);default:'#64748b'" json:"color"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (t *Tag) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

type PipelineStage struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Name        string    `gorm:"type:varchar(120);not null" json:"name"`
	Order       int       `gorm:"not null;default:0" json:"order"`
	Color       string    `gorm:"type:varchar(20);default:'#64748b'" json:"color"`
	IsDefault   bool      `gorm:"default:false" json:"is_default"`
	Funnel      string    `gorm:"type:varchar(120)" json:"funnel,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (p *PipelineStage) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

type ActivityType string

const (
	ActivityCreated     ActivityType = "created"
	ActivityStageChange ActivityType = "stage_changed"
	ActivityNoteAdded   ActivityType = "note_added"
	ActivityAssigned    ActivityType = "assigned"
	ActivityMessaged    ActivityType = "messaged"
)

type ContactActivity struct {
	ID          uuid.UUID    `gorm:"type:uuid;primaryKey" json:"id"`
	ContactID   uuid.UUID    `gorm:"type:uuid;not null;index" json:"contact_id"`
	Contact     *Contact     `gorm:"foreignKey:ContactID" json:"contact,omitempty"`
	UserID      uuid.UUID    `gorm:"type:uuid;not null;index" json:"user_id"`
	User        *User        `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Type        ActivityType `gorm:"type:varchar(30);not null" json:"type"`
	Description string       `gorm:"type:text" json:"description"`
	Metadata    string       `gorm:"type:text" json:"metadata,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}

func (a *ContactActivity) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
