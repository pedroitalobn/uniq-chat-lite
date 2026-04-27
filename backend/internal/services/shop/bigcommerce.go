package shop

import (
	"context"
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

// BigCommerce — Stores REST API v3.
//
// Auth: API Account (X-Auth-Token) gerado em
// Settings → API Accounts. Mais simples que OAuth — token nunca expira
// até ser revogado.
//
// Cliente cola no Config:
//   { "store_hash": "abc123", "access_token": "..." }
//
// AuthMode: APIKey.
//
// Endpoints (v3):
//   GET https://api.bigcommerce.com/stores/{store_hash}/v3/catalog/products?limit=250&page=N
//   GET .../catalog/products/{id}/images

func init() {
	RegisterProvider(&bigcommerceProvider{})
}

type bigcommerceProvider struct{}

type bcCreds struct {
	StoreHash   string `json:"store_hash"`
	AccessToken string `json:"access_token"`
}

type bcConfig struct {
	StoreHash   string `json:"store_hash,omitempty"`
	AccessToken string `json:"access_token,omitempty"` // limpo após callback
}

func (p *bigcommerceProvider) ID() string          { return "bigcommerce" }
func (p *bigcommerceProvider) DisplayName() string { return "BigCommerce" }
func (p *bigcommerceProvider) AuthMode() AuthMode  { return AuthAPIKey }

func (p *bigcommerceProvider) AuthorizeURL(_ context.Context, _ *models.ShopIntegration, _, _ string) (string, error) {
	return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("BigCommerce usa Access Token — gere em Settings → API Accounts")}
}

func (p *bigcommerceProvider) HandleCallback(_ context.Context, integration *models.ShopIntegration, _, _ string) error {
	var cfg bcConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.StoreHash == "" || cfg.AccessToken == "" {
		return errors.New("config deve conter store_hash e access_token")
	}
	creds := bcCreds{
		StoreHash:   strings.TrimSpace(cfg.StoreHash),
		AccessToken: cfg.AccessToken,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	cfg.AccessToken = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *bigcommerceProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, "/v3/catalog/products?limit=1")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bc test %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

func (p *bigcommerceProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	const pageSize = 250
	pageNum := 1
	for {
		path := fmt.Sprintf("/v3/catalog/products?limit=%d&page=%d&include=images", pageSize, pageNum)
		resp, err := p.apiGet(ctx, c, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("bc list %d: %s", resp.StatusCode, string(raw))
		}
		var page struct {
			Data []bcProductDTO `json:"data"`
			Meta struct {
				Pagination struct {
					TotalPages  int `json:"total_pages"`
					CurrentPage int `json:"current_page"`
				} `json:"pagination"`
			} `json:"meta"`
		}
		if err := json.Unmarshal(raw, &page); err != nil {
			return stats, err
		}
		if len(page.Data) == 0 {
			break
		}
		stats.Pulled += len(page.Data)
		for i := range page.Data {
			created, err := p.upsertProduct(db, &shop, &page.Data[i])
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
		if pageNum >= page.Meta.Pagination.TotalPages {
			break
		}
		pageNum++
	}
	return stats, nil
}

func (p *bigcommerceProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *bigcommerceProvider) creds(integration *models.ShopIntegration) (*bcCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — cole store_hash + access_token")
	}
	var c bcCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.StoreHash == "" || c.AccessToken == "" {
		return nil, errors.New("credenciais BigCommerce incompletas")
	}
	return &c, nil
}

func (p *bigcommerceProvider) apiGet(ctx context.Context, c *bcCreds, path string) (*http.Response, error) {
	full := "https://api.bigcommerce.com/stores/" + c.StoreHash + path
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	req.Header.Set("X-Auth-Token", c.AccessToken)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

type bcProductDTO struct {
	ID            int     `json:"id"`
	Name          string  `json:"name"`
	SKU           string  `json:"sku"`
	Description   string  `json:"description"`
	Price         float64 `json:"price"`
	RetailPrice   float64 `json:"retail_price"`
	InventoryLvl  int     `json:"inventory_level"`
	IsVisible     bool    `json:"is_visible"`
	Images        []struct {
		URLStandard string `json:"url_standard"`
		URLZoom     string `json:"url_zoom"`
	} `json:"images"`
}

func (p *bigcommerceProvider) upsertProduct(db *gorm.DB, shop *models.Shop, prod *bcProductDTO) (bool, error) {
	rawJSON, _ := json.Marshal(prod)
	urls := []string{}
	for _, img := range prod.Images {
		u := img.URLZoom
		if u == "" {
			u = img.URLStandard
		}
		if u != "" {
			urls = append(urls, u)
		}
	}
	mainImage := ""
	if len(urls) > 0 {
		mainImage = urls[0]
	}
	externalID := strconv.Itoa(prod.ID)

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "bigcommerce", externalID).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              prod.SKU,
			Name:             prod.Name,
			Description:      prod.Description,
			Type:             models.ProductTypePhysical,
			Price:            prod.Price,
			CompareAtPrice:   prod.RetailPrice,
			Currency:         shop.Currency,
			StockQuantity:    prod.InventoryLvl,
			TrackStock:       true,
			MainImage:        mainImage,
			IsActive:         prod.IsVisible,
			ExternalProvider: "bigcommerce",
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
		"description":      prod.Description,
		"price":            prod.Price,
		"compare_at_price": prod.RetailPrice,
		"stock_quantity":   prod.InventoryLvl,
		"main_image":       mainImage,
		"is_active":        prod.IsVisible,
		"external_data":    string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, urls)
	return false, nil
}

func (p *bigcommerceProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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
