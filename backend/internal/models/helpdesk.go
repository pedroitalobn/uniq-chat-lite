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
	// HeroImageURL: imagem de capa renderizada no topo do artigo (hero
	// section) na central pública e nas listagens. Texto livre — pode ser
	// URL externa ou caminho do storage do workspace. Campo opcional.
	HeroImageURL string `gorm:"type:text" json:"hero_image_url,omitempty"`
	// Content guarda HTML produzido pelo editor rich-text (Tiptap). Antes
	// era Markdown; o renderer público renderiza HTML direto agora,
	// suportando imagens, vídeos, embeds (iframe), áudios, etc. Markdown
	// salvo previamente continua sendo entregue como texto bruto e o
	// editor importa transparente quando o user salva de novo.
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

// HelpDeskConfig holds the branding and access settings for a workspace's public Help Center.
type HelpDeskConfig struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID       uuid.UUID  `gorm:"type:uuid;uniqueIndex;not null" json:"workspace_id"`
	Title             string     `gorm:"type:varchar(120);default:'Central de Ajuda'" json:"title"`
	Description       string     `gorm:"type:varchar(500)" json:"description"`
	CustomSlug        string     `gorm:"type:varchar(120);uniqueIndex" json:"custom_slug,omitempty"`
	PrimaryColor      string     `gorm:"type:varchar(20);default:'#00d46a'" json:"primary_color"`
	LogoURL           string     `gorm:"type:varchar(500)" json:"logo_url"`
	WebchatInstanceID *uuid.UUID `gorm:"type:uuid" json:"webchat_instance_id,omitempty"`
	WidgetEnabled     bool       `gorm:"default:true" json:"widget_enabled"`
	// ThemeMode: "dark" | "light" | "system"
	ThemeMode string `gorm:"type:varchar(12);default:'dark'" json:"theme_mode"`
	// FontFamily: "inter" | "geist" | "manrope" | "jetbrains"
	FontFamily string `gorm:"type:varchar(20);default:'inter'" json:"font_family"`
	// CustomDomain: CNAME personalizado pra central (ex: ajuda.meusite.com)
	CustomDomain string `gorm:"type:varchar(255)" json:"custom_domain,omitempty"`
	// LayoutStyle: "default" | "glass" | "mintlify"
	LayoutStyle string `gorm:"type:varchar(20);default:'glass'" json:"layout_style"`
	// HideUniqBranding: esconde "Powered by Uniq Chat" no footer
	HideUniqBranding bool `gorm:"default:false" json:"hide_uniq_branding"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (h *HelpDeskConfig) BeforeCreate(tx *gorm.DB) error {
	if h.ID == uuid.Nil {
		h.ID = uuid.New()
	}
	if h.PrimaryColor == "" {
		h.PrimaryColor = "#00d46a"
	}
	if h.Title == "" {
		h.Title = "Central de Ajuda"
	}
	return nil
}
