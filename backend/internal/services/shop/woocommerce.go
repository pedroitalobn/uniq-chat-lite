package shop

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// WooCommerce — WordPress + WooCommerce REST API v3.
//
// Auth: Consumer Key + Consumer Secret gerados em
// WP Admin → WooCommerce → Settings → Advanced → REST API.
// Cliente cola no Config:
//   { "site_url": "https://loja.com", "consumer_key": "ck_...",
//     "consumer_secret": "cs_..." }
//
// AuthMode: Custom (par key+secret + URL do site, fluxo basic auth).
//
// Endpoints (WC REST API v3):
//   GET /wp-json/wc/v3/products?per_page=100&page=N
//   GET /wp-json/wc/v3/products/{id}
//
// Webhooks: configurados via WP Admin (não implementados nesta fase).

func init() {
	RegisterProvider(&wooProvider{})
}

type wooProvider struct{}

type wooCreds struct {
	SiteURL        string `json:"site_url"`
	ConsumerKey    string `json:"consumer_key"`
	ConsumerSecret string `json:"consumer_secret"`
}

type wooConfig struct {
	SiteURL        string `json:"site_url,omitempty"`
	ConsumerKey    string `json:"consumer_key,omitempty"`    // limpo após callback
	ConsumerSecret string `json:"consumer_secret,omitempty"` // limpo após callback
}

func (p *wooProvider) ID() string          { return "woocommerce" }
func (p *wooProvider) DisplayName() string { return "WooCommerce" }
func (p *wooProvider) AuthMode() AuthMode  { return AuthCustom }

func (p *wooProvider) AuthorizeURL(_ context.Context, _ *models.ShopIntegration, _, _ string) (string, error) {
	return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("WooCommerce usa key+secret — gere em WP Admin → WC → Advanced → REST API")}
}

func (p *wooProvider) HandleCallback(_ context.Context, integration *models.ShopIntegration, _, _ string) error {
	var cfg wooConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.SiteURL == "" || cfg.ConsumerKey == "" || cfg.ConsumerSecret == "" {
		return errors.New("config deve conter site_url, consumer_key e consumer_secret")
	}
	creds := wooCreds{
		SiteURL:        strings.TrimRight(cfg.SiteURL, "/"),
		ConsumerKey:    cfg.ConsumerKey,
		ConsumerSecret: cfg.ConsumerSecret,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	// Mantém só site_url no Config; zera secrets.
	cfg.ConsumerKey = ""
	cfg.ConsumerSecret = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *wooProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, "/wp-json/wc/v3/products?per_page=1")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("woo test %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

func (p *wooProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	const pageSize = 100
	page := 1
	for {
		path := fmt.Sprintf("/wp-json/wc/v3/products?per_page=%d&page=%d", pageSize, page)
		resp, err := p.apiGet(ctx, c, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("woo list %d: %s", resp.StatusCode, string(raw))
		}
		var batch []wooProductDTO
		if err := json.Unmarshal(raw, &batch); err != nil {
			return stats, err
		}
		if len(batch) == 0 {
			break
		}
		stats.Pulled += len(batch)
		for i := range batch {
			created, err := p.upsertProduct(db, &shop, &batch[i])
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
		if len(batch) < pageSize {
			break
		}
		page++
	}
	return stats, nil
}

func (p *wooProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *wooProvider) creds(integration *models.ShopIntegration) (*wooCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — cole site_url + consumer_key + consumer_secret")
	}
	var c wooCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.SiteURL == "" || c.ConsumerKey == "" || c.ConsumerSecret == "" {
		return nil, errors.New("credenciais WooCommerce incompletas")
	}
	return &c, nil
}

func (p *wooProvider) apiGet(ctx context.Context, c *wooCreds, path string) (*http.Response, error) {
	full := c.SiteURL + path
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	// Basic auth com key+secret (WC suporta nativamente sobre HTTPS).
	auth := base64.StdEncoding.EncodeToString([]byte(c.ConsumerKey + ":" + c.ConsumerSecret))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// wooProductDTO — subset relevante de WC products.
type wooProductDTO struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	Slug          string `json:"slug"`
	Status        string `json:"status"`
	Description   string `json:"description"`
	ShortDesc     string `json:"short_description"`
	SKU           string `json:"sku"`
	Price         string `json:"price"`
	RegularPrice  string `json:"regular_price"`
	StockQuantity *int   `json:"stock_quantity"`
	StockStatus   string `json:"stock_status"`
	Images        []struct {
		Src string `json:"src"`
	} `json:"images"`
}

func (p *wooProvider) upsertProduct(db *gorm.DB, shop *models.Shop, prod *wooProductDTO) (bool, error) {
	rawJSON, _ := json.Marshal(prod)
	urls := []string{}
	for _, img := range prod.Images {
		urls = append(urls, img.Src)
	}
	mainImage := ""
	if len(urls) > 0 {
		mainImage = urls[0]
	}
	price, _ := strconv.ParseFloat(prod.Price, 64)
	regular, _ := strconv.ParseFloat(prod.RegularPrice, 64)
	stock := 0
	if prod.StockQuantity != nil {
		stock = *prod.StockQuantity
	}
	desc := prod.Description
	if desc == "" {
		desc = prod.ShortDesc
	}
	externalID := strconv.Itoa(prod.ID)

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "woocommerce", externalID).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              prod.SKU,
			Name:             prod.Name,
			Description:      desc,
			Type:             models.ProductTypePhysical,
			Price:            price,
			CompareAtPrice:   regular,
			Currency:         shop.Currency,
			StockQuantity:    stock,
			TrackStock:       prod.StockQuantity != nil,
			MainImage:        mainImage,
			IsActive:         prod.Status == "publish" && prod.StockStatus != "outofstock",
			ExternalProvider: "woocommerce",
			ExternalID:       externalID,
			ExternalData:     string(rawJSON),
		}
		if err := db.Create(&newProd).Error; err != nil {
			return false, err
		}
		p.replaceImages(db, newProd.ID, urls)
		return true, nil
	}

	updates := map[string]any{
		"name":             prod.Name,
		"description":      desc,
		"price":            price,
		"compare_at_price": regular,
		"stock_quantity":   stock,
		"main_image":       mainImage,
		"is_active":        prod.Status == "publish" && prod.StockStatus != "outofstock",
		"external_data":    string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, urls)
	return false, nil
}

func (p *wooProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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
