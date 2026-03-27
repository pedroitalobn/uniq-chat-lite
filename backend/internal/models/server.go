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
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	User        *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Name        string    `gorm:"not null" json:"name"`
	Slug        string    `gorm:"uniqueIndex;not null" json:"slug"` // subdomain-safe, e.g. "acme-corp"
	Description string    `gorm:"type:text" json:"description,omitempty"`
	IsActive    bool      `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
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
