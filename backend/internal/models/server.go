package models

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Server is a workspace that groups multiple instances.
// It has a system-wide unique slug used as subdomain.
type Server struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	User        *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	WorkspaceID *uuid.UUID `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Workspace   *Workspace `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Name        string     `gorm:"not null" json:"name"`
	Slug        string     `gorm:"uniqueIndex;not null" json:"slug"` // subdomain-safe, e.g. "acme-corp"
	Description string     `gorm:"type:text" json:"description,omitempty"`
	IsActive    bool       `gorm:"default:true" json:"is_active"`

	// ── Proxy configuration (server-level, herded by instances with mode=inherit) ──
	// ProxyMode determina qual estratégia aplicar; default "inherit" = segue o global padrão.
	ProxyMode     ProxyMode  `gorm:"type:varchar(20);default:'inherit'" json:"proxy_mode"`
	ProxyPoolID   *uuid.UUID `gorm:"type:uuid" json:"proxy_pool_id,omitempty"` // para mode=residencial (legado + pool residencial)
	ProxyPool     *ProxyPool `gorm:"foreignKey:ProxyPoolID" json:"proxy_pool,omitempty"`
	GlobalProxyID *string    `gorm:"type:varchar(32)" json:"global_proxy_id,omitempty"`   // para mode=global
	GlobalProxy   *GlobalProxyConfig `gorm:"foreignKey:GlobalProxyID" json:"global_proxy,omitempty"`
	// Campos para mode=manual no server (proxy custom)
	ProxyType     ProxyType `gorm:"type:varchar(10)" json:"proxy_type,omitempty"`
	ProxyHost     string    `gorm:"type:varchar(255)" json:"proxy_host,omitempty"`
	ProxyPort     int       `json:"proxy_port,omitempty"`
	ProxyUsername string    `gorm:"type:varchar(255)" json:"proxy_username,omitempty"`
	ProxyPassword string    `gorm:"type:varchar(512)" json:"-"` // encrypted

	WebhookURL string    `gorm:"type:varchar(500)" json:"webhook_url,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (s *Server) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.Slug == "" {
		s.Slug = SlugFrom(s.Name)
	}
	return nil
}

var slugRe = regexp.MustCompile(`[^a-z0-9-]`)

// SlugFrom converts an arbitrary name to a URL/subdomain-safe slug.
func SlugFrom(name string) string {
	s := strings.ToLower(name)
	s = strings.ReplaceAll(s, " ", "-")
	s = slugRe.ReplaceAllString(s, "")
	// collapse multiple dashes
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	s = strings.Trim(s, "-")
	if len(s) > 63 {
		s = s[:63]
	}
	if s == "" {
		s = uuid.New().String()[:8]
	}
	return s
}
