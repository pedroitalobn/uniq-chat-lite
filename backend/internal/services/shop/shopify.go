package shop

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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

// Shopify provider — OAuth2 + Admin REST API.
//
// Credenciais necessárias no env:
//   SHOPIFY_CLIENT_ID
//   SHOPIFY_CLIENT_SECRET
//   SHOPIFY_SCOPES        (opcional, default: read_products,read_orders,read_inventory)
//
// Auth flow:
//   1. UI chama POST /shops/.../integrations/:id/connect com config={"shop_domain":"xxx.myshopify.com"}
//   2. Backend gera AuthorizeURL → user redireciona pro Shopify
//   3. Shopify volta com ?code=...&shop=...&state=... no callback
//   4. HandleCallback troca code por access_token, salva criptografado

const shopifyAPIVersion = "2024-04"

func init() {
	RegisterProvider(&shopifyProvider{})
}

type shopifyProvider struct{}

type shopifyCreds struct {
	ShopDomain  string `json:"shop_domain"`            // xxxx.myshopify.com
	AccessToken string `json:"access_token,omitempty"` // populado após OAuth
	Scope       string `json:"scope,omitempty"`
}

type shopifyConfig struct {
	ShopDomain   string `json:"shop_domain"`
	OAuthState   string `json:"oauth_state,omitempty"`
	// Per-workspace OAuth app (Modelo B). Quando vazio, cai no env do
	// SaaS (Modelo A — Business Solution Provider). Cliente avançado
	// cola seu próprio app pra ter escopos custom / branding próprio.
	ClientID     string `json:"client_id,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
	Scopes       string `json:"scopes,omitempty"`
}

// shopifyAppCreds resolve client_id/secret/scopes priorizando o que o
// workspace setou no Config; fallback no env do SaaS.
func (p *shopifyProvider) shopifyAppCreds(cfg *shopifyConfig) (clientID, clientSecret, scopes string) {
	clientID = cfg.ClientID
	if clientID == "" {
		clientID = os.Getenv("SHOPIFY_CLIENT_ID")
	}
	clientSecret = cfg.ClientSecret
	if clientSecret == "" {
		clientSecret = os.Getenv("SHOPIFY_CLIENT_SECRET")
	}
	scopes = cfg.Scopes
	if scopes == "" {
		scopes = os.Getenv("SHOPIFY_SCOPES")
	}
	if scopes == "" {
		scopes = "read_products,write_products,read_orders,read_inventory"
	}
	return
}

func (p *shopifyProvider) ID() string                  { return "shopify" }
func (p *shopifyProvider) DisplayName() string         { return "Shopify" }
func (p *shopifyProvider) AuthMode() AuthMode          { return AuthOAuth2 }

// AuthorizeURL — Shopify exige saber o shop_domain ANTES de redirecionar
// (o domínio é parte da URL). UI passa shop_domain no Config.
func (p *shopifyProvider) AuthorizeURL(_ context.Context, integration *models.ShopIntegration, state, redirectURI string) (string, error) {
	var cfg shopifyConfig
	_ = json.Unmarshal([]byte(integration.Config), &cfg)
	clientID, _, scopes := p.shopifyAppCreds(&cfg)
	if clientID == "" {
		return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("client_id não configurado: nem no workspace, nem no env SHOPIFY_CLIENT_ID")}
	}
	if cfg.ShopDomain == "" {
		return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("config.shop_domain ausente — UI deve enviar 'minhaloja.myshopify.com'")}
	}
	domain := strings.TrimSuffix(strings.TrimPrefix(cfg.ShopDomain, "https://"), "/")
	q := url.Values{
		"client_id":    {clientID},
		"scope":        {scopes},
		"redirect_uri": {redirectURI},
		"state":        {state},
	}
	return fmt.Sprintf("https://%s/admin/oauth/authorize?%s", domain, q.Encode()), nil
}

// HandleCallback troca o ?code=... por access_token via Shopify token endpoint.
// shop_domain vem do query (?shop=) ou do Config.
func (p *shopifyProvider) HandleCallback(ctx context.Context, integration *models.ShopIntegration, code, redirectURI string) error {
	var cfg shopifyConfig
	_ = json.Unmarshal([]byte(integration.Config), &cfg)
	clientID, clientSecret, _ := p.shopifyAppCreds(&cfg)
	if clientID == "" || clientSecret == "" {
		return &ProviderError{Provider: p.ID(), Op: "callback", Err: errors.New("client_id/secret não configurados (workspace nem env)")}
	}
	if cfg.ShopDomain == "" {
		return &ProviderError{Provider: p.ID(), Op: "callback", Err: errors.New("shop_domain ausente no config")}
	}

	body := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
	}
	tokenURL := fmt.Sprintf("https://%s/admin/oauth/access_token", cfg.ShopDomain)
	req, _ := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(body.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return &ProviderError{Provider: p.ID(), Op: "callback", Err: err}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return &ProviderError{Provider: p.ID(), Op: "callback", Err: fmt.Errorf("shopify %d: %s", resp.StatusCode, string(raw))}
	}
	var out struct {
		AccessToken string `json:"access_token"`
		Scope       string `json:"scope"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return err
	}
	if out.AccessToken == "" {
		return &ProviderError{Provider: p.ID(), Op: "callback", Err: errors.New("access_token vazio na resposta Shopify")}
	}

	creds := shopifyCreds{
		ShopDomain:  cfg.ShopDomain,
		AccessToken: out.AccessToken,
		Scope:       out.Scope,
	}
	encrypted, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = encrypted
	integration.IsActive = true
	return nil
}

// TestConnection — GET /shop.json valida access_token + permissões.
func (p *shopifyProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	creds, err := p.creds(integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, creds, "/shop.json")
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return &ProviderError{Provider: p.ID(), Op: "test", Err: fmt.Errorf("shopify %d", resp.StatusCode)}
	}
	return nil
}

// SyncProducts — paginado via Link header (Shopify 2024-04 usa cursor).
// Limit 250 por página (max). UPSERT em models.Product via external_id.
func (p *shopifyProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, since *string) (SyncStats, error) {
	stats := SyncStats{}
	creds, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	pageURL := "/products.json?limit=250"
	if since != nil && *since != "" {
		pageURL += "&updated_at_min=" + url.QueryEscape(*since)
	}

	// Carrega o shop pai pra usar workspace_id + shop_id na inserção.
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	for pageURL != "" {
		resp, err := p.apiGet(ctx, creds, pageURL)
		if err != nil {
			return stats, err
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("shopify sync %d: %s", resp.StatusCode, string(body))
		}

		var page struct {
			Products []shopifyProductDTO `json:"products"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return stats, err
		}
		stats.Pulled += len(page.Products)

		for _, sp := range page.Products {
			created, err := p.upsertProduct(db, &shop, &sp)
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

		// Pagination via Link header
		pageURL = parseShopifyNextLink(resp.Header.Get("Link"))
	}
	return stats, nil
}

// HandleWebhook — Shopify envia HMAC SHA-256 base64 em X-Shopify-Hmac-Sha256.
// Secret vem do app — Modelo A (env) ou Modelo B (per-workspace config).
func (p *shopifyProvider) HandleWebhook(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, headers map[string]string, body []byte) error {
	var cfg shopifyConfig
	_ = json.Unmarshal([]byte(integration.Config), &cfg)
	_, secret, _ := p.shopifyAppCreds(&cfg)
	if secret == "" {
		return errors.New("client_secret não configurado (workspace nem env)")
	}
	sig := headers["X-Shopify-Hmac-Sha256"]
	if sig == "" {
		sig = headers["x-shopify-hmac-sha256"]
	}
	if !verifyShopifyHMAC(secret, body, sig) {
		return errors.New("hmac inválido — webhook rejeitado")
	}
	topic := headers["X-Shopify-Topic"]
	if topic == "" {
		topic = headers["x-shopify-topic"]
	}

	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return err
	}

	switch {
	case strings.HasPrefix(topic, "products/"):
		var sp shopifyProductDTO
		if err := json.Unmarshal(body, &sp); err != nil {
			return err
		}
		if topic == "products/delete" {
			db.Where("external_provider = ? AND external_id = ? AND workspace_id = ?",
				"shopify", fmt.Sprintf("%d", sp.ID), shop.WorkspaceID).
				Delete(&models.Product{})
			return nil
		}
		_, err := p.upsertProduct(db, &shop, &sp)
		return err
	}
	return nil
}

// ─── Internals ────────────────────────────────────────────────────────

func (p *shopifyProvider) creds(integration *models.ShopIntegration) (*shopifyCreds, error) {
	if integration.Credentials == "" {
		return nil, &ProviderError{Provider: p.ID(), Op: "creds", Err: errors.New("integração sem credenciais — refaça o OAuth")}
	}
	var c shopifyCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.AccessToken == "" || c.ShopDomain == "" {
		return nil, errors.New("credenciais Shopify incompletas")
	}
	return &c, nil
}

func (p *shopifyProvider) apiGet(ctx context.Context, c *shopifyCreds, path string) (*http.Response, error) {
	full := fmt.Sprintf("https://%s/admin/api/%s%s", c.ShopDomain, shopifyAPIVersion, path)
	if strings.HasPrefix(path, "https://") {
		full = path // pageURL absoluto vindo do Link header
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	req.Header.Set("X-Shopify-Access-Token", c.AccessToken)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// shopifyProductDTO é o subset do produto Shopify que mapeamos.
type shopifyProductDTO struct {
	ID         int64                   `json:"id"`
	Title      string                  `json:"title"`
	Handle     string                  `json:"handle"` // slug
	BodyHTML   string                  `json:"body_html"`
	Status     string                  `json:"status"` // active/draft/archived
	Tags       string                  `json:"tags"`
	Vendor     string                  `json:"vendor"`
	ProductType string                 `json:"product_type"`
	Variants   []shopifyVariantDTO     `json:"variants"`
	Images     []struct {
		Src string `json:"src"`
		Alt string `json:"alt"`
	} `json:"images"`
}

type shopifyVariantDTO struct {
	ID                int64  `json:"id"`
	SKU               string `json:"sku"`
	Title             string `json:"title"`
	Price             string `json:"price"`           // string em decimal
	CompareAtPrice    string `json:"compare_at_price"`
	InventoryQuantity int    `json:"inventory_quantity"`
	Grams             int    `json:"grams"`
}

// upsertProduct cria/atualiza um Product local a partir do Shopify DTO.
// Retorna (created bool, err). Lookup manual por (workspace, provider, ext_id).
func (p *shopifyProvider) upsertProduct(db *gorm.DB, shop *models.Shop, sp *shopifyProductDTO) (bool, error) {
	externalID := fmt.Sprintf("%d", sp.ID)

	var price, compareAt float64
	var stock int
	var sku string
	if len(sp.Variants) > 0 {
		v := sp.Variants[0]
		fmt.Sscanf(v.Price, "%f", &price)
		fmt.Sscanf(v.CompareAtPrice, "%f", &compareAt)
		stock = v.InventoryQuantity
		sku = v.SKU
	}
	mainImage := ""
	if len(sp.Images) > 0 {
		mainImage = sp.Images[0].Src
	}
	rawJSON, _ := json.Marshal(sp)

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "shopify", externalID).First(&existing).Error

	if err != nil {
		// Não achou → INSERT.
		prod := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              sku,
			Name:             sp.Title,
			Slug:             sp.Handle,
			Description:      sp.BodyHTML,
			Type:             models.ProductTypePhysical,
			Price:            price,
			CompareAtPrice:   compareAt,
			Currency:         shop.Currency,
			StockQuantity:    stock,
			TrackStock:       true,
			MainImage:        mainImage,
			Tags:             sp.Tags,
			IsActive:         sp.Status == "active",
			ExternalProvider: "shopify",
			ExternalID:       externalID,
			ExternalData:     string(rawJSON),
		}
		if err := db.Create(&prod).Error; err != nil {
			return false, err
		}
		p.replaceImages(db, prod.ID, sp.Images)
		return true, nil
	}

	// UPDATE
	updates := map[string]any{
		"sku":               sku,
		"name":              sp.Title,
		"slug":              sp.Handle,
		"description":       sp.BodyHTML,
		"price":             price,
		"compare_at_price":  compareAt,
		"stock_quantity":    stock,
		"main_image":        mainImage,
		"tags":              sp.Tags,
		"is_active":         sp.Status == "active",
		"external_data":     string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, sp.Images)
	return false, nil
}

// replaceImages — Shopify é fonte da verdade, substitui o conjunto.
func (p *shopifyProvider) replaceImages(db *gorm.DB, productID uuid.UUID, images []struct {
	Src string `json:"src"`
	Alt string `json:"alt"`
}) {
	db.Where("product_id = ?", productID).Delete(&models.ProductImage{})
	for i, img := range images {
		db.Create(&models.ProductImage{
			ID:        uuid.New(),
			ProductID: productID,
			URL:       img.Src,
			AltText:   img.Alt,
			Position:  i,
		})
	}
}

// parseShopifyNextLink extrai a URL "next" do Link header da paginação.
// Format: <https://...>; rel="next", <https://...>; rel="previous"
func parseShopifyNextLink(link string) string {
	if link == "" {
		return ""
	}
	for _, part := range strings.Split(link, ",") {
		seg := strings.TrimSpace(part)
		if !strings.Contains(seg, `rel="next"`) {
			continue
		}
		if i := strings.Index(seg, "<"); i >= 0 {
			if j := strings.Index(seg[i:], ">"); j > 0 {
				return seg[i+1 : i+j]
			}
		}
	}
	return ""
}

// verifyShopifyHMAC valida o body contra a assinatura HMAC SHA-256.
func verifyShopifyHMAC(secret string, body []byte, sigB64 string) bool {
	if sigB64 == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(sigB64))
}
