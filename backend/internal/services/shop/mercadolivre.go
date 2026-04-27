package shop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// Mercado Livre provider — OAuth2 com refresh token rotativo.
//
// Env:
//   ML_CLIENT_ID
//   ML_CLIENT_SECRET
//   ML_AUTH_DOMAIN  (default: mercadolivre.com.br — MLB Brasil)
//
// Particularidades vs Shopify:
//   - Token expira em 6h. Refresh token vem na resposta — guardamos
//     pra renovar transparente quando 401.
//   - Listagem de items: 2 passos. Primeiro /users/{id}/items/search
//     retorna só IDs; depois /items?ids=A,B,C pra detalhe (max 20 por
//     request).
//   - Webhooks: payload mínimo { topic, resource, user_id }. Backend
//     deve fazer GET no resource pra buscar dados atualizados.

const (
	mlAPIBase = "https://api.mercadolibre.com"
)

func init() {
	RegisterProvider(&mlProvider{})
}

type mlProvider struct{}

type mlCreds struct {
	UserID       int64     `json:"user_id"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	SiteID       string    `json:"site_id"` // MLB, MLA, MLM, MLC, MCO, etc
}

func (p *mlProvider) ID() string          { return "mercado_livre" }
func (p *mlProvider) DisplayName() string { return "Mercado Livre" }
func (p *mlProvider) AuthMode() AuthMode  { return AuthOAuth2 }

func (p *mlProvider) authDomain() string {
	d := os.Getenv("ML_AUTH_DOMAIN")
	if d == "" {
		d = "mercadolivre.com.br" // default Brasil
	}
	return d
}

func (p *mlProvider) AuthorizeURL(_ context.Context, _ *models.ShopIntegration, state, redirectURI string) (string, error) {
	clientID := os.Getenv("ML_CLIENT_ID")
	if clientID == "" {
		return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("ML_CLIENT_ID não configurado")}
	}
	q := url.Values{
		"response_type": {"code"},
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"state":         {state},
	}
	return fmt.Sprintf("https://auth.%s/authorization?%s", p.authDomain(), q.Encode()), nil
}

func (p *mlProvider) HandleCallback(ctx context.Context, integration *models.ShopIntegration, code, redirectURI string) error {
	clientID := os.Getenv("ML_CLIENT_ID")
	clientSecret := os.Getenv("ML_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		return &ProviderError{Provider: p.ID(), Op: "callback", Err: errors.New("ML_CLIENT_ID/SECRET não configurados")}
	}
	body := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	tokenResp, err := p.tokenRequest(ctx, body)
	if err != nil {
		return err
	}
	creds := mlCreds{
		UserID:       tokenResp.UserID,
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
		SiteID:       p.siteFromDomain(),
	}
	encrypted, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = encrypted
	integration.IsActive = true
	return nil
}

func (p *mlProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	creds, err := p.creds(integration)
	if err != nil {
		return err
	}
	if _, err := p.refreshIfNeeded(ctx, integration, creds); err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, creds, "/users/me")
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ml test failed: %d", resp.StatusCode)
	}
	return nil
}

func (p *mlProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	creds, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	creds, err = p.refreshIfNeeded(ctx, integration, creds)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	// Step 1: pega IDs paginado.
	offset := 0
	limit := 50
	for {
		path := fmt.Sprintf("/users/%d/items/search?status=active&limit=%d&offset=%d", creds.UserID, limit, offset)
		resp, err := p.apiGet(ctx, creds, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("ml search %d: %s", resp.StatusCode, string(raw))
		}
		var search struct {
			Results []string `json:"results"`
			Paging  struct {
				Total  int `json:"total"`
				Offset int `json:"offset"`
				Limit  int `json:"limit"`
			} `json:"paging"`
		}
		if err := json.Unmarshal(raw, &search); err != nil {
			return stats, err
		}
		if len(search.Results) == 0 {
			break
		}
		stats.Pulled += len(search.Results)

		// Step 2: pega detalhes em batches de 20.
		for i := 0; i < len(search.Results); i += 20 {
			end := i + 20
			if end > len(search.Results) {
				end = len(search.Results)
			}
			ids := strings.Join(search.Results[i:end], ",")
			detResp, err := p.apiGet(ctx, creds, "/items?ids="+ids)
			if err != nil {
				stats.Failed += end - i
				continue
			}
			detRaw, _ := io.ReadAll(detResp.Body)
			detResp.Body.Close()
			var batch []struct {
				Code int             `json:"code"`
				Body mlItemDTO       `json:"body"`
			}
			if err := json.Unmarshal(detRaw, &batch); err != nil {
				stats.Failed += end - i
				continue
			}
			for _, item := range batch {
				if item.Code != 200 {
					stats.Failed++
					continue
				}
				created, err := p.upsertItem(db, &shop, &item.Body)
				if err != nil {
					stats.Failed++
					continue
				}
				if created {
					stats.Created++
				} else {
					stats.Updated++
				}
			}
		}

		offset += limit
		if offset >= search.Paging.Total {
			break
		}
	}
	return stats, nil
}

// HandleWebhook — ML manda { topic, resource, user_id }. Fazemos GET
// no resource e atualizamos o produto/order correspondente.
//
// Validação: não há HMAC oficial. Recomendação ML é restringir IP
// origem (gateway) — fora do escopo aqui. Pra produção, configurar
// IP allowlist no proxy/firewall com CIDR docs.mercadolibre.com.br/devsite.
func (p *mlProvider) HandleWebhook(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ map[string]string, body []byte) error {
	var ev struct {
		Topic    string `json:"topic"`
		Resource string `json:"resource"`
	}
	if err := json.Unmarshal(body, &ev); err != nil {
		return err
	}
	creds, err := p.creds(integration)
	if err != nil {
		return err
	}
	creds, err = p.refreshIfNeeded(ctx, integration, creds)
	if err != nil {
		return err
	}

	switch ev.Topic {
	case "items":
		// resource = /items/MLB123456 — fetch e upsert.
		resp, err := p.apiGet(ctx, creds, ev.Resource)
		if err != nil {
			return err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return fmt.Errorf("ml fetch %s: %d", ev.Resource, resp.StatusCode)
		}
		var item mlItemDTO
		if err := json.Unmarshal(raw, &item); err != nil {
			return err
		}
		var shop models.Shop
		if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
			return err
		}
		_, err = p.upsertItem(db, &shop, &item)
		return err
	}
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *mlProvider) siteFromDomain() string {
	switch p.authDomain() {
	case "mercadolibre.com.ar":
		return "MLA"
	case "mercadolibre.com.mx":
		return "MLM"
	case "mercadolibre.com.co":
		return "MCO"
	case "mercadolibre.cl":
		return "MLC"
	case "mercadolivre.com.br":
		return "MLB"
	}
	return "MLB"
}

func (p *mlProvider) creds(integration *models.ShopIntegration) (*mlCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("integração ML sem credenciais — refaça o OAuth")
	}
	var c mlCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.AccessToken == "" || c.UserID == 0 {
		return nil, errors.New("credenciais ML incompletas")
	}
	return &c, nil
}

// refreshIfNeeded renova o access_token quando faltam < 5min, e
// persiste as novas credenciais. Retorna os creds atualizados.
func (p *mlProvider) refreshIfNeeded(ctx context.Context, integration *models.ShopIntegration, c *mlCreds) (*mlCreds, error) {
	if time.Until(c.ExpiresAt) > 5*time.Minute {
		return c, nil
	}
	clientID := os.Getenv("ML_CLIENT_ID")
	clientSecret := os.Getenv("ML_CLIENT_SECRET")
	body := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"refresh_token": {c.RefreshToken},
	}
	tok, err := p.tokenRequest(ctx, body)
	if err != nil {
		return c, err
	}
	c.AccessToken = tok.AccessToken
	c.RefreshToken = tok.RefreshToken // ML rotaciona, sobrescreve
	c.ExpiresAt = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	encrypted, err := MarshalCredentials(*c)
	if err == nil {
		integration.Credentials = encrypted
	}
	return c, nil
}

type mlTokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	UserID       int64  `json:"user_id"`
	Scope        string `json:"scope"`
}

func (p *mlProvider) tokenRequest(ctx context.Context, form url.Values) (*mlTokenResp, error) {
	req, _ := http.NewRequestWithContext(ctx, "POST", mlAPIBase+"/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("ml token %d: %s", resp.StatusCode, string(raw))
	}
	var out mlTokenResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (p *mlProvider) apiGet(ctx context.Context, c *mlCreds, path string) (*http.Response, error) {
	full := mlAPIBase + path
	if strings.HasPrefix(path, "https://") || strings.HasPrefix(path, "http://") {
		full = path
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// mlItemDTO — subset do item do ML que mapeamos.
type mlItemDTO struct {
	ID                string  `json:"id"` // MLB1234567
	Title             string  `json:"title"`
	Price             float64 `json:"price"`
	OriginalPrice     float64 `json:"original_price"`
	CurrencyID        string  `json:"currency_id"`
	AvailableQuantity int     `json:"available_quantity"`
	Condition         string  `json:"condition"`
	Status            string  `json:"status"`     // active, paused, closed
	Permalink         string  `json:"permalink"`
	Thumbnail         string  `json:"thumbnail"`
	Pictures          []struct {
		URL string `json:"url"`
	} `json:"pictures"`
	Description string `json:"description"`
	Tags        []string `json:"tags"`
}

func (p *mlProvider) upsertItem(db *gorm.DB, shop *models.Shop, item *mlItemDTO) (bool, error) {
	pictures := make([]string, 0, len(item.Pictures))
	for _, pic := range item.Pictures {
		pictures = append(pictures, pic.URL)
	}
	mainImage := item.Thumbnail
	if mainImage == "" && len(pictures) > 0 {
		mainImage = pictures[0]
	}

	rawJSON, _ := json.Marshal(item)
	currency := item.CurrencyID
	if currency == "" {
		currency = shop.Currency
	}

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "mercado_livre", item.ID).First(&existing).Error
	if err != nil {
		prod := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			Name:             item.Title,
			Description:      item.Description,
			Type:             models.ProductTypePhysical,
			Price:            item.Price,
			CompareAtPrice:   item.OriginalPrice,
			Currency:         currency,
			StockQuantity:    item.AvailableQuantity,
			TrackStock:       true,
			MainImage:        mainImage,
			Tags:             strings.Join(item.Tags, ","),
			IsActive:         item.Status == "active",
			ExternalProvider: "mercado_livre",
			ExternalID:       item.ID,
			ExternalData:     string(rawJSON),
		}
		if err := db.Create(&prod).Error; err != nil {
			return false, err
		}
		p.replaceImages(db, prod.ID, pictures)
		return true, nil
	}

	updates := map[string]any{
		"name":             item.Title,
		"description":      item.Description,
		"price":            item.Price,
		"compare_at_price": item.OriginalPrice,
		"stock_quantity":   item.AvailableQuantity,
		"main_image":       mainImage,
		"tags":             strings.Join(item.Tags, ","),
		"is_active":        item.Status == "active",
		"external_data":    string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, pictures)
	return false, nil
}

func (p *mlProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
	db.Where("product_id = ?", productID).Delete(&models.ProductImage{})
	for i, u := range urls {
		db.Create(&models.ProductImage{
			ID:        uuid.New(),
			ProductID: productID,
			URL:       u,
			Position:  i,
		})
	}
}
