// Package services — link_preview gera/cacheia OG cards pra URLs detectadas
// em mensagens. Reutiliza por 7 dias; refresh em background. Fetch é
// best-effort — se falhar, marca cache negativo curto e não bloqueia o save.
package services

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"golang.org/x/net/html"
	"gorm.io/gorm"
)

const (
	linkPreviewCacheTTL    = 7 * 24 * time.Hour
	linkPreviewNegativeTTL = 1 * time.Hour
	linkPreviewMaxBytes    = 512 * 1024 // 512KB de HTML é mais que suficiente
)

// urlRegex captura URLs http/https em texto livre. Não cobre todos os edge
// cases do RFC, mas pega 99% dos links que aparecem em mensagens reais.
var urlRegex = regexp.MustCompile(`https?://[^\s<>"']+`)

// LinkPreviewService busca/cacheia metadados OG.
type LinkPreviewService struct {
	db   *gorm.DB
	http *http.Client
}

func NewLinkPreviewService(db *gorm.DB) *LinkPreviewService {
	return &LinkPreviewService{
		db: db,
		http: &http.Client{
			Timeout: 8 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return errors.New("muitos redirects")
				}
				return nil
			},
		},
	}
}

// ExtractURLs retorna a primeira URL única encontrada no texto. Whatsapp
// só renderiza preview da primeira URL — alinhamos comportamento.
func ExtractURLs(text string) []string {
	if text == "" {
		return nil
	}
	matches := urlRegex.FindAllString(text, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, raw := range matches {
		// Trim trailing punctuation comum
		raw = strings.TrimRight(raw, ".,);!?")
		if raw == "" {
			continue
		}
		if _, ok := seen[raw]; ok {
			continue
		}
		seen[raw] = struct{}{}
		out = append(out, raw)
		if len(out) >= 1 {
			break
		}
	}
	return out
}

// GetOrFetch busca o preview no cache; se ausente ou expirado, faz fetch
// inline. É síncrono — chame em goroutine se quiser não-bloqueante.
func (s *LinkPreviewService) GetOrFetch(ctx context.Context, rawURL string) (*models.LinkPreview, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("link preview service indisponível")
	}
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errors.New("url vazia")
	}

	var existing models.LinkPreview
	if err := s.db.Where("url = ?", rawURL).First(&existing).Error; err == nil {
		// Hit
		ttl := linkPreviewCacheTTL
		if existing.FetchErr != "" {
			ttl = linkPreviewNegativeTTL
		}
		if time.Since(existing.FetchedAt) < ttl {
			return &existing, nil
		}
		// Expirado — atualiza
	}

	preview := s.fetch(ctx, rawURL)
	// Upsert
	if existing.ID != uuid.Nil {
		preview.ID = existing.ID
		preview.CreatedAt = existing.CreatedAt
	} else {
		preview.ID = uuid.New()
	}
	preview.URL = rawURL
	preview.FetchedAt = time.Now()
	if err := s.db.Save(preview).Error; err != nil {
		log.Warn().Err(err).Msg("link preview: save falhou")
	}
	return preview, nil
}

// PrefetchURLsAsync extrai URLs do texto e dispara fetch em background.
// Útil pra chamar logo após salvar uma MessageLog — frontend pode fazer
// poll ou WS pra atualizar quando preview ficar pronto.
func (s *LinkPreviewService) PrefetchURLsAsync(text string) {
	urls := ExtractURLs(text)
	for _, u := range urls {
		go func(rawURL string) {
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			defer cancel()
			_, _ = s.GetOrFetch(ctx, rawURL)
		}(u)
	}
}

// fetch faz o HTTP GET + parsing OG/meta tags. Sempre retorna um *LinkPreview
// (com FetchErr preenchido em caso de falha) pra cache negativo funcionar.
func (s *LinkPreviewService) fetch(ctx context.Context, rawURL string) *models.LinkPreview {
	out := &models.LinkPreview{URL: rawURL}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		out.FetchErr = "url inválida"
		return out
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		out.FetchErr = err.Error()
		return out
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; UniqChatBot/1.0; +https://uniq.chat)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := s.http.Do(req)
	if err != nil {
		out.FetchErr = err.Error()
		return out
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		out.FetchErr = "status " + resp.Status
		return out
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "html") {
		out.FetchErr = "content-type não html: " + ct
		return out
	}

	body := io.LimitReader(resp.Body, linkPreviewMaxBytes)
	doc, err := html.Parse(body)
	if err != nil {
		out.FetchErr = "parse falhou"
		return out
	}

	parseMetaTags(doc, out)

	// Resolve relative image URLs
	if out.ImageURL != "" && !strings.HasPrefix(out.ImageURL, "http") {
		if u, err := parsed.Parse(out.ImageURL); err == nil {
			out.ImageURL = u.String()
		}
	}
	if out.FaviconURL != "" && !strings.HasPrefix(out.FaviconURL, "http") {
		if u, err := parsed.Parse(out.FaviconURL); err == nil {
			out.FaviconURL = u.String()
		}
	}
	// Fallback de favicon
	if out.FaviconURL == "" {
		out.FaviconURL = parsed.Scheme + "://" + parsed.Host + "/favicon.ico"
	}
	// Fallback de site_name
	if out.SiteName == "" {
		out.SiteName = parsed.Host
	}
	return out
}

// parseMetaTags percorre o HTML procurando OG/Twitter/title/meta tags
// relevantes pro preview.
func parseMetaTags(n *html.Node, out *models.LinkPreview) {
	if n.Type == html.ElementNode {
		switch n.Data {
		case "title":
			if out.Title == "" && n.FirstChild != nil {
				out.Title = strings.TrimSpace(n.FirstChild.Data)
			}
		case "meta":
			var name, property, content string
			for _, a := range n.Attr {
				switch a.Key {
				case "name":
					name = a.Val
				case "property":
					property = a.Val
				case "content":
					content = a.Val
				}
			}
			key := strings.ToLower(property)
			if key == "" {
				key = strings.ToLower(name)
			}
			switch key {
			case "og:title", "twitter:title":
				if content != "" {
					out.Title = content
				}
			case "og:description", "twitter:description", "description":
				if content != "" && out.Description == "" {
					out.Description = content
				}
			case "og:image", "twitter:image", "twitter:image:src":
				if content != "" && out.ImageURL == "" {
					out.ImageURL = content
				}
			case "og:site_name":
				if content != "" {
					out.SiteName = content
				}
			}
		case "link":
			var rel, href string
			for _, a := range n.Attr {
				switch a.Key {
				case "rel":
					rel = a.Val
				case "href":
					href = a.Val
				}
			}
			if (rel == "icon" || rel == "shortcut icon" || rel == "apple-touch-icon") && href != "" && out.FaviconURL == "" {
				out.FaviconURL = href
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		parseMetaTags(c, out)
	}
}
