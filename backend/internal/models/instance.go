package models

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// GenerateInstanceToken creates a secure random token prefixed with "it_".
func GenerateInstanceToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		b = []byte(uuid.New().String() + uuid.New().String())
	}
	return "it_" + hex.EncodeToString(b)
}

type ChannelType string

const (
	ChannelWhatsApp  ChannelType = "whatsapp"
	ChannelInstagram ChannelType = "instagram"
	ChannelTelegram  ChannelType = "telegram"
	ChannelLinkedIn  ChannelType = "linkedin"
	ChannelTikTok    ChannelType = "tiktok"
	ChannelKwai      ChannelType = "kwai"
	ChannelWABA      ChannelType = "waba"
)

// ChannelMeta holds display info for each channel.
var ChannelMeta = map[ChannelType]struct {
	Label       string
	Color       string
	Description string
}{
	ChannelWhatsApp:  {Label: "WhatsApp", Color: "#25d366", Description: "Conecte números WhatsApp via QR ou código de pareamento"},
	ChannelInstagram: {Label: "Instagram", Color: "#e1306c", Description: "Conecte Instagram e gerencie DMs via instagram-private-api"},
	ChannelTelegram:  {Label: "Telegram", Color: "#229ed9", Description: "Crie bots e gerencie mensagens via Telegram Bot API"},
	ChannelLinkedIn:  {Label: "LinkedIn", Color: "#0a66c2", Description: "Automatize mensagens e InMails via LinkedIn API"},
	ChannelTikTok:    {Label: "TikTok", Color: "#ff0050", Description: "Mensagens diretas e comentários via TikTok"},
	ChannelKwai:      {Label: "Kwai", Color: "#ff6600", Description: "Mensagens e interações via Kwai"},
	ChannelWABA:      {Label: "WhatsApp Business", Color: "#25d366", Description: "Conecte números via WhatsApp Business API (WABA) com Embedded Signup"},
}

type InstanceStatus string

const (
	StatusDisconnected InstanceStatus = "disconnected"
	StatusConnecting   InstanceStatus = "connecting"
	StatusConnected    InstanceStatus = "connected"
	StatusBanned       InstanceStatus = "banned"
)

type ProxyType string

const (
	ProxyTypeHTTP   ProxyType = "http"
	ProxyTypeHTTPS  ProxyType = "https"
	ProxyTypeSOCKS5 ProxyType = "socks5"
)

type ProxyStatus string

const (
	ProxyStatusUntested ProxyStatus = "untested"
	ProxyStatusOK       ProxyStatus = "ok"
	ProxyStatusFailed   ProxyStatus = "failed"
)

type Instance struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	User        *User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
	WorkspaceID *uuid.UUID     `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Workspace   *Workspace     `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	ServerID    *uuid.UUID     `gorm:"type:uuid;index" json:"server_id,omitempty"`
	Server      *Server        `gorm:"foreignKey:ServerID" json:"server,omitempty"`
	Name        string         `gorm:"not null" json:"name"`
	Slug        string         `gorm:"type:varchar(63);index:idx_server_slug" json:"slug"`
	Token       string         `gorm:"type:varchar(67);index" json:"token,omitempty"`
	Channel     ChannelType    `gorm:"type:varchar(20);default:'whatsapp';index" json:"channel"`
	PhoneNumber string         `gorm:"index" json:"phone_number"`
	Status      InstanceStatus `gorm:"type:varchar(20);default:'disconnected'" json:"status"`

	// Proxy fields
	ProxyMode       ProxyMode   `gorm:"type:varchar(20);default:'none'" json:"proxy_mode"` // none | manual | residencial
	ProxyEnabled    bool        `gorm:"default:false" json:"proxy_enabled"`
	ProxyType       ProxyType   `gorm:"type:varchar(10)" json:"proxy_type,omitempty"`
	ProxyHost       string      `gorm:"type:varchar(255)" json:"proxy_host,omitempty"`
	ProxyPort       int         `json:"proxy_port,omitempty"`
	ProxyUsername   string      `gorm:"type:varchar(255)" json:"proxy_username,omitempty"`
	ProxyPassword   string      `gorm:"type:varchar(512)" json:"-"` // encrypted, never expose
	ProxyStatus     ProxyStatus `gorm:"type:varchar(20);default:'untested'" json:"proxy_status"`
	ProxyLastTested *time.Time  `json:"proxy_last_tested,omitempty"`
	ProxyError      string      `gorm:"type:text" json:"proxy_error,omitempty"`
	ProxyExternalIP string      `gorm:"type:varchar(64)" json:"proxy_external_ip,omitempty"`
	ProxyPoolID     *uuid.UUID  `gorm:"type:uuid" json:"proxy_pool_id,omitempty"` // for residencial mode
	UseGlobalProxy  bool        `gorm:"default:false" json:"use_global_proxy"`

	WebhookURL  string     `gorm:"type:text" json:"webhook_url,omitempty"`
	SessionData string     `gorm:"type:text" json:"-"`
	ConnectedAt *time.Time `json:"connected_at,omitempty"`

	// MCP server
	MCPEnabled bool `gorm:"default:false" json:"mcp_enabled"`

	// Advanced settings
	AlwaysOnline bool `gorm:"default:false" json:"always_online"`
	RejectCalls  bool `gorm:"default:false" json:"reject_calls"`
	ReadMessages bool `gorm:"default:false" json:"read_messages"`
	IgnoreGroups bool `gorm:"default:false" json:"ignore_groups"`
	IgnoreStatus bool `gorm:"default:false" json:"ignore_status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	WABA *WABAInstance `gorm:"foreignKey:InstanceID" json:"waba,omitempty"`

	InstagramUsername string     `gorm:"type:varchar(100)" json:"instagram_username,omitempty"`
	InstagramSession  string     `gorm:"type:text" json:"-"`
	InstagramDeviceID string     `gorm:"type:varchar(100)" json:"instagram_device_id,omitempty"`
	IsPaused          bool       `gorm:"default:false" json:"is_paused"`
	LastMessageAt     *time.Time `json:"last_message_at,omitempty"`
}

func (i *Instance) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	if i.Slug == "" {
		i.Slug = SlugFrom(i.Name)
	}
	if i.Token == "" {
		i.Token = GenerateInstanceToken()
	}
	return nil
}
