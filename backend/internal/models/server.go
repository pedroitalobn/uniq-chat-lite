package models

import (
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"
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

	// ── Proxy ──
	// O server aponta pra zero ou um Proxy do catálogo. Todas as instâncias
	// ligadas a este server compartilham esse proxy. Sem ProxyID = sem proxy.
	// Os demais campos proxy_* da tabela ficam apenas para backward-compat
	// durante a migração e não são mais lidos/escritos pelo código.
	ProxyID *uuid.UUID `gorm:"type:uuid;index" json:"proxy_id,omitempty"`
	Proxy   *Proxy     `gorm:"foreignKey:ProxyID" json:"proxy,omitempty"`

	WebhookURL string    `gorm:"type:varchar(500)" json:"webhook_url,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
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

var (
	slugRe        = regexp.MustCompile(`[^a-z0-9-]`)
	slugWhitespRe = regexp.MustCompile(`\s+`)
	// Transliteração explícita pra chars que NFKD não decompõe (ç → c não
	// vem de graça via NFD; ñ idem em alguns casos). Cobrimos também caps
	// pra ToLower já tratar antes, mas mantemos defensivo.
	slugTranslit = strings.NewReplacer(
		"ç", "c", "Ç", "c",
		"ñ", "n", "Ñ", "n",
		"ß", "ss",
		"æ", "ae", "Æ", "ae",
		"œ", "oe", "Œ", "oe",
		"ø", "o", "Ø", "o",
		"å", "a", "Å", "a",
		"ł", "l", "Ł", "l",
		"đ", "d", "Đ", "d",
		"&", "e", "@", "at", "+", "mais",
	)
)

// SlugFrom converts an arbitrary name to a URL/subdomain-safe slug.
//
// Aguenta nomes compostos com acentos ("João da Silva" → "joao-da-silva"),
// caracteres especiais Português/Espanhol/Alemão/Nórdicos, e normaliza
// whitespace (tabs, newlines, múltiplos espaços) pra um único hífen.
//
// Antes a regex `[^a-z0-9-]` simplesmente APAGAVA acentos — "José Silva"
// virava "jos-silva", o que era feio e causava colisões frequentes (vários
// nomes diferentes produziam o mesmo slug). Agora decompõe via NFKD e
// remove só os marks combinantes, preservando a letra base.
func SlugFrom(name string) string {
	s := strings.TrimSpace(name)
	// 1. Transliteração explícita de chars não-decomponíveis.
	s = slugTranslit.Replace(s)
	// 2. NFKD decompõe acentos: "á" → "a" + combining acute. Em seguida
	//    removemos os combining marks (categoria Unicode Mn).
	s = norm.NFKD.String(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) {
			continue // diacrítico combinante — descarta
		}
		b.WriteRune(r)
	}
	s = b.String()
	// 3. Lowercase + colapsa qualquer whitespace (tab/newline/múltiplos espaços)
	//    em um único hífen.
	s = strings.ToLower(s)
	s = slugWhitespRe.ReplaceAllString(s, "-")
	// 4. Remove qualquer char restante fora de [a-z0-9-].
	s = slugRe.ReplaceAllString(s, "")
	// 5. Colapsa hífens duplicados e trim das pontas.
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	s = strings.Trim(s, "-")
	if len(s) > 63 {
		s = strings.Trim(s[:63], "-")
	}
	if s == "" {
		s = uuid.New().String()[:8]
	}
	return s
}
