package handlers

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/storage"
	"gorm.io/gorm"
)

// BrandingSettings — singleton (id=1) com toda a configuração visual
// editável pelo admin: cores, fontes, preset de tema, logos e nome do app.
type BrandingSettings struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	AppName        string    `gorm:"size:120;default:'qchat'" json:"app_name"`
	PrimaryColor   string    `gorm:"size:32;default:'#2563EB'" json:"primary_color"`
	SecondaryColor string    `gorm:"size:32;default:'#3B82F6'" json:"secondary_color"`
	AccentColor    string    `gorm:"size:32;default:'#0EA5E9'" json:"accent_color"`
	FontFamily     string    `gorm:"size:80;default:'inter'" json:"font_family"`
	ThemePreset    string    `gorm:"size:32;default:'modern'" json:"theme_preset"` // modern|classic|standard|minimal
	LogoLightURL   string    `json:"logo_light_url"`
	LogoDarkURL    string    `json:"logo_dark_url"`
	FaviconURL     string    `json:"favicon_url"`
	LoginBgURL     string    `json:"login_bg_url"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (BrandingSettings) TableName() string { return "branding_settings" }

// BrandingHandler agrupa as rotas de white-label.
type BrandingHandler struct {
	db    *gorm.DB
	store *storage.Client
}

func NewBrandingHandler(db *gorm.DB, store *storage.Client) *BrandingHandler {
	// AutoMigrate garante que a tabela exista mesmo sem rodar SQL migration
	// (útil em dev/SQLite).
	_ = db.AutoMigrate(&BrandingSettings{})
	// Garante singleton com defaults.
	var count int64
	db.Model(&BrandingSettings{}).Count(&count)
	if count == 0 {
		db.Create(&BrandingSettings{ID: 1})
	}
	return &BrandingHandler{db: db, store: store}
}

func (h *BrandingHandler) get() (*BrandingSettings, error) {
	var b BrandingSettings
	if err := h.db.First(&b, 1).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			b = BrandingSettings{ID: 1, AppName: "qchat", PrimaryColor: "#2563EB",
				SecondaryColor: "#3B82F6", AccentColor: "#0EA5E9",
				FontFamily: "inter", ThemePreset: "modern"}
			h.db.Create(&b)
			return &b, nil
		}
		return nil, err
	}
	return &b, nil
}

// Get — GET /v1/branding (auth required). Retorna config completa.
func (h *BrandingHandler) Get(c *fiber.Ctx) error {
	b, err := h.get()
	if err != nil {
		return fiber.NewError(500, err.Error())
	}
	return c.JSON(b)
}

// GetPublic — GET /v1/branding/public (sem auth). Subset seguro para
// renderizar a página de login e providers de tema.
func (h *BrandingHandler) GetPublic(c *fiber.Ctx) error {
	b, err := h.get()
	if err != nil {
		return fiber.NewError(500, err.Error())
	}
	return c.JSON(fiber.Map{
		"app_name":        b.AppName,
		"primary_color":   b.PrimaryColor,
		"secondary_color": b.SecondaryColor,
		"accent_color":    b.AccentColor,
		"font_family":     b.FontFamily,
		"theme_preset":    b.ThemePreset,
		"logo_light_url":  b.LogoLightURL,
		"logo_dark_url":   b.LogoDarkURL,
		"favicon_url":     b.FaviconURL,
		"login_bg_url":    b.LoginBgURL,
	})
}

type updateBrandingBody struct {
	AppName        *string `json:"app_name"`
	PrimaryColor   *string `json:"primary_color"`
	SecondaryColor *string `json:"secondary_color"`
	AccentColor    *string `json:"accent_color"`
	FontFamily     *string `json:"font_family"`
	ThemePreset    *string `json:"theme_preset"`
	LogoLightURL   *string `json:"logo_light_url"`
	LogoDarkURL    *string `json:"logo_dark_url"`
	FaviconURL     *string `json:"favicon_url"`
	LoginBgURL     *string `json:"login_bg_url"`
}

// Update — PUT /v1/branding (admin only). PATCH-like: aplica só os campos
// presentes no body.
func (h *BrandingHandler) Update(c *fiber.Ctx) error {
	var body updateBrandingBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(400, "invalid body")
	}
	b, err := h.get()
	if err != nil {
		return fiber.NewError(500, err.Error())
	}
	if body.AppName != nil {
		b.AppName = strings.TrimSpace(*body.AppName)
	}
	if body.PrimaryColor != nil {
		b.PrimaryColor = *body.PrimaryColor
	}
	if body.SecondaryColor != nil {
		b.SecondaryColor = *body.SecondaryColor
	}
	if body.AccentColor != nil {
		b.AccentColor = *body.AccentColor
	}
	if body.FontFamily != nil {
		b.FontFamily = *body.FontFamily
	}
	if body.ThemePreset != nil {
		preset := strings.ToLower(strings.TrimSpace(*body.ThemePreset))
		switch preset {
		case "modern", "classic", "standard", "minimal":
			b.ThemePreset = preset
		default:
			return fiber.NewError(400, "invalid theme_preset")
		}
	}
	if body.LogoLightURL != nil {
		b.LogoLightURL = *body.LogoLightURL
	}
	if body.LogoDarkURL != nil {
		b.LogoDarkURL = *body.LogoDarkURL
	}
	if body.FaviconURL != nil {
		b.FaviconURL = *body.FaviconURL
	}
	if body.LoginBgURL != nil {
		b.LoginBgURL = *body.LoginBgURL
	}
	b.UpdatedAt = time.Now()
	if err := h.db.Save(b).Error; err != nil {
		return fiber.NewError(500, err.Error())
	}
	return c.JSON(b)
}

// Upload — POST /v1/branding/upload (admin only). Form-data:
//   - kind: logo_light | logo_dark | favicon | login_bg
//   - file: binário
//
// Faz upload no MinIO e atualiza a URL correspondente em branding_settings.
func (h *BrandingHandler) Upload(c *fiber.Ctx) error {
	if h.store == nil {
		return fiber.NewError(500, "storage not configured")
	}
	kind := c.FormValue("kind")
	validKind := map[string]string{
		"logo_light": "logo_light_url",
		"logo_dark":  "logo_dark_url",
		"favicon":    "favicon_url",
		"login_bg":   "login_bg_url",
	}
	column, ok := validKind[kind]
	if !ok {
		return fiber.NewError(400, "invalid kind")
	}
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(400, "missing file")
	}
	src, err := file.Open()
	if err != nil {
		return fiber.NewError(500, err.Error())
	}
	defer src.Close()
	data, err := io.ReadAll(src)
	if err != nil {
		return fiber.NewError(500, err.Error())
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext == "" {
		ext = ".png"
	}
	objectName := fmt.Sprintf("branding/%s-%s%s", kind, uuid.NewString(), ext)
	ct := file.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	url, err := h.store.UploadBytes(ctx, objectName, data, ct)
	if err != nil {
		return fiber.NewError(500, err.Error())
	}
	// Atualiza a coluna correspondente.
	if err := h.db.Model(&BrandingSettings{}).Where("id = ?", 1).
		Update(column, url).Update("updated_at", time.Now()).Error; err != nil {
		return fiber.NewError(500, err.Error())
	}
	return c.JSON(fiber.Map{"url": url, "kind": kind})
}
