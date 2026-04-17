package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProxyMode determines how the instance connects.
type ProxyMode string

const (
	ProxyModeNone        ProxyMode = "none"        // instance/server explicitly without proxy
	ProxyModeManual      ProxyMode = "manual"      // custom host/port/user/pass on the entity
	ProxyModeResidencial ProxyMode = "residencial" // assigned from ProxyPool
	ProxyModeGlobal      ProxyMode = "global"      // points to a GlobalProxyConfig
	ProxyModeInherit     ProxyMode = "inherit"     // follow parent: server (for instance) or default global (for server)
)

// ProxyProvider identifies the residential proxy provider.
type ProxyProvider string

const (
	ProxyProviderBrightData ProxyProvider = "brightdata"
	ProxyProviderOxylabs    ProxyProvider = "oxylabs"
	ProxyProviderProxyCheap ProxyProvider = "proxy_cheap"
	ProxyProviderSmartProxy ProxyProvider = "smartproxy"
	ProxyProviderUniq       ProxyProvider = "uniq"
	ProxyProviderWebshare   ProxyProvider = "webshare"
	ProxyProviderManual     ProxyProvider = "manual"
)

// ProxyPoolStatus tracks whether a pool entry is usable.
type ProxyPoolStatus string

const (
	ProxyPoolActive   ProxyPoolStatus = "active"
	ProxyPoolInactive ProxyPoolStatus = "inactive"
	ProxyPoolRecycled ProxyPoolStatus = "recycled"
)

// ProxyProviderConfig stores API credentials for third-party proxy providers
type ProxyProviderConfig struct {
	ID            uuid.UUID     `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID     `gorm:"type:uuid;not null;index" json:"user_id"`
	Provider      ProxyProvider `gorm:"type:varchar(30);not null" json:"provider"`
	Name          string        `gorm:"not null" json:"name"`
	APIKey        string        `gorm:"type:varchar(512)" json:"-"`
	APIKeyMasked  string        `gorm:"type:varchar(50)" json:"api_key_masked"`
	Country       string        `gorm:"type:varchar(10);default:'br'" json:"country"`
	IsActive      bool          `gorm:"default:true" json:"is_active"`
	ProxyType     string        `gorm:"type:varchar(10)" json:"proxy_type"`
	ProxyHost     string        `gorm:"type:varchar(255)" json:"proxy_host"`
	ProxyPort     int           `json:"proxy_port"`
	ProxyUsername string        `gorm:"type:varchar(255)" json:"proxy_username"`
	ProxyPassword string        `gorm:"type:varchar(512)" json:"-"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

func (p *ProxyProviderConfig) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// ProxyPool represents a single residential proxy session that can serve multiple instances.
type ProxyPool struct {
	ID                uuid.UUID     `gorm:"type:uuid;primaryKey" json:"id"`
	Provider          ProxyProvider `gorm:"type:varchar(30);not null;default:'brightdata'" json:"provider"`
	SessionID         string        `gorm:"type:varchar(120);uniqueIndex;not null" json:"session_id"`
	Country           string        `gorm:"type:varchar(10);default:'br'" json:"country"`
	Host              string        `gorm:"type:varchar(255);not null" json:"host"`
	Port              int           `gorm:"not null;default:33335" json:"port"`
	Username          string        `gorm:"type:varchar(512);not null" json:"username"` // encrypted
	PasswordEncrypted string        `gorm:"type:varchar(512);not null" json:"-"`        // encrypted, never expose

	// Capacity
	MaxInstances     int `gorm:"not null;default:5" json:"max_instances"`
	CurrentInstances int `gorm:"not null;default:0" json:"current_instances"`

	Status    ProxyPoolStatus `gorm:"type:varchar(20);default:'active'" json:"status"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`

	// Relations
	Assignments []InstanceProxyAssignment `gorm:"foreignKey:ProxyPoolID" json:"assignments,omitempty"`
}

func (p *ProxyPool) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// HasCapacity returns true if the pool entry can still receive instances.
func (p *ProxyPool) HasCapacity() bool {
	return p.Status == ProxyPoolActive && p.CurrentInstances < p.MaxInstances
}

// InstanceProxyAssignment links an instance to a proxy pool entry.
type InstanceProxyAssignment struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	ProxyPoolID uuid.UUID  `gorm:"type:uuid;not null;index" json:"proxy_pool_id"`
	AssignedAt  time.Time  `gorm:"not null" json:"assigned_at"`
	ReleasedAt  *time.Time `json:"released_at,omitempty"`

	// For fast joins
	Instance  *Instance  `gorm:"foreignKey:InstanceID" json:"instance,omitempty"`
	ProxyPool *ProxyPool `gorm:"foreignKey:ProxyPoolID" json:"proxy_pool,omitempty"`
}

func (a *InstanceProxyAssignment) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	if a.AssignedAt.IsZero() {
		a.AssignedAt = time.Now()
	}
	return nil
}

// InstanceProxyConfig is stored as JSON in the Instance table for quick lookup.
type InstanceProxyConfig struct {
	Mode        ProxyMode `json:"mode"`          // none | manual | residencial
	ProxyPoolID string    `json:"proxy_pool_id"` // ID of the assigned proxy pool entry
	AssignedAt  string    `json:"assigned_at"`
}
