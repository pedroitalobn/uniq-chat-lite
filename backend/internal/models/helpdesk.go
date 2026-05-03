package models

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ArticleStatus represents the publication state of a help desk article.
type ArticleStatus string

const (
	ArticleDraft     ArticleStatus = "draft"
	ArticlePublished ArticleStatus = "published"
	ArticleArchived  ArticleStatus = "archived"
)

// slugify converts a string to a URL-friendly slug.
func slugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

// HelpDeskCategory groups articles in the knowledge base.
type HelpDeskCategory struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID      `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Name        string         `gorm:"type:varchar(120);not null" json:"name"`
	Description string         `gorm:"type:text" json:"description,omitempty"`
	Icon        string         `gorm:"type:varchar(60)" json:"icon,omitempty"`
	Slug        string         `gorm:"type:varchar(160);index" json:"slug"`
	Position    int            `gorm:"default:0" json:"position"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (c *HelpDeskCategory) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.Slug == "" && c.Name != "" {
		c.Slug = slugify(c.Name)
	}
	return nil
}

// HelpDeskArticle is a single knowledge base article.
type HelpDeskArticle struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID     `gorm:"type:uuid;not null;index" json:"workspace_id"`
	CategoryID *uuid.UUID     `gorm:"type:uuid;index" json:"category_id,omitempty"`
	Category   *HelpDeskCategory `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Title      string         `gorm:"type:varchar(255);not null" json:"title"`
	Slug       string         `gorm:"type:varchar(280);index" json:"slug"`
	Summary    string         `gorm:"type:varchar(500)" json:"summary,omitempty"`
	Content    string         `gorm:"type:text" json:"content,omitempty"`
	Status     ArticleStatus  `gorm:"type:varchar(20);default:'draft';index" json:"status"`
	ViewCount  int            `gorm:"default:0" json:"view_count"`
	AuthorID   *uuid.UUID     `gorm:"type:uuid;index" json:"author_id,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

func (a *HelpDeskArticle) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	if a.Slug == "" && a.Title != "" {
		a.Slug = slugify(a.Title)
	}
	if a.Status == "" {
		a.Status = ArticleDraft
	}
	return nil
}
