package shop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// Magalu Marketplace provider — Magazine Luiza Hub API.
//
// Auth: API key (Bearer token) gerada pelo seller em
// developer.magalu.com → My Apps → Client. Cliente cola no Config:
//   { "api_token": "...", "seller_id": "<ID>" }
//
// Não tem OAuth padrão pra terceiros — Magalu emite tokens diretamente
// no portal do parceiro. AuthMode = APIKey.
//
// Endpoints (Magalu Marketplace API v1):
//   GET /v1/sellers/{sellerId}/portfolios       — lista portfólios
//   GET /v1/sellers/{sellerId}/skus?limit=50    — lista SKUs do seller
//   GET /v1/skus/{sku}                          — detalhes do SKU
//
// Webhooks: configurados via portal Magalu, opcionais. Não implementados
// nesta fase.

const magaluAPIBase = "https://api.magalu.com"

func init() {
	RegisterProvider(&magaluProvider{})
}

type magaluProvider struct{}

type magaluCreds struct {
	APIToken string `json:"api_token"`
	SellerID string `json:"seller_id"`
}

type magaluConfig struct {
	APIToken string `json:"api_token,omitempty"` // limpo após /test → /HandleCallback
	SellerID string `json:"seller_id,omitempty"`
}

func (p *magaluProvider) ID() string          { return "magalu" }
func (p *magaluProvider) DisplayName() string { return "Magazine Luiza" }
func (p *magaluProvider) AuthMode() AuthMode  { return AuthAPIKey }

func (p *magaluProvider) AuthorizeURL(_ context.Context, _ *models.ShopIntegration, _, _ string) (string, error) {
	return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("Magalu usa API token — cole no Config + chame /test")}
}

// HandleCallback — migra api_token+seller_id do Config (texto puro)
// pra Credentials (criptografado).
func (p *magaluProvider) HandleCallback(_ context.Context, integration *models.ShopIntegration, _, _ string) error {
	var cfg magaluConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.APIToken == "" || cfg.SellerID == "" {
		return errors.New("config deve conter api_token e seller_id")
	}
	creds := magaluCreds{
		APIToken: cfg.APIToken,
		SellerID: cfg.SellerID,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	// Mantém só seller_id no Config pra UI exibir; zera token.
	cfg.APIToken = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *magaluProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, fmt.Sprintf("/v1/sellers/%s/portfolios", c.SellerID))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("magalu test %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

func (p *magaluProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	// Paginado: limit 50, offset cursor.
	const pageSize = 50
	offset := 0
	for {
		path := fmt.Sprintf("/v1/sellers/%s/skus?_limit=%d&_offset=%d", c.SellerID, pageSize, offset)
		resp, err := p.apiGet(ctx, c, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("magalu list %d: %s", resp.StatusCode, string(raw))
		}
		var page struct {
			Results []magaluSkuDTO `json:"results"`
			Meta    struct {
				Total int `json:"total"`
			} `json:"meta"`
		}
		if err := json.Unmarshal(raw, &page); err != nil {
			// Fallback: alguns endpoints retornam array direto
			var arr []magaluSkuDTO
			if err2 := json.Unmarshal(raw, &arr); err2 != nil {
				return stats, err
			}
			page.Results = arr
		}
		if len(page.Results) == 0 {
			break
		}
		stats.Pulled += len(page.Results)

		for i := range page.Results {
			created, err := p.upsertSku(db, &shop, &page.Results[i])
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

		if len(page.Results) < pageSize {
			break
		}
		offset += pageSize
	}
	return stats, nil
}

func (p *magaluProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil // Fase futura — Magalu webhooks via portal
}

// ─── internals ────────────────────────────────────────────────────────

func (p *magaluProvider) creds(integration *models.ShopIntegration) (*magaluCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — cole api_token + seller_id")
	}
	var c magaluCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.APIToken == "" || c.SellerID == "" {
		return nil, errors.New("credenciais Magalu incompletas")
	}
	return &c, nil
}

func (p *magaluProvider) apiGet(ctx context.Context, c *magaluCreds, path string) (*http.Response, error) {
	full := magaluAPIBase + path
	if strings.HasPrefix(path, "https://") {
		full = path
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	req.Header.Set("Authorization", "Bearer "+c.APIToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Seller-Id", c.SellerID)
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// magaluSkuDTO — subset comum de SKU do Magalu Hub.
type magaluSkuDTO struct {
	ID          string  `json:"sku"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Brand       string  `json:"brand"`
	Active      bool    `json:"active"`
	Price       float64 `json:"price"`
	ListPrice   float64 `json:"list_price"`
	Stock       int     `json:"stock_quantity"`
	Images      []struct {
		URL string `json:"url"`
	} `json:"images"`
}

func (p *magaluProvider) upsertSku(db *gorm.DB, shop *models.Shop, sku *magaluSkuDTO) (bool, error) {
	rawJSON, _ := json.Marshal(sku)
	mainImage := ""
	urls := []string{}
	for _, img := range sku.Images {
		urls = append(urls, img.URL)
	}
	if len(urls) > 0 {
		mainImage = urls[0]
	}

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "magalu", sku.ID).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              sku.ID,
			Name:             sku.Title,
			Description:      sku.Description,
			Type:             models.ProductTypePhysical,
			Price:            sku.Price,
			CompareAtPrice:   sku.ListPrice,
			Currency:         shop.Currency,
			StockQuantity:    sku.Stock,
			TrackStock:       true,
			MainImage:        mainImage,
			IsActive:         sku.Active,
			ExternalProvider: "magalu",
			ExternalID:       sku.ID,
			ExternalData:     string(rawJSON),
		}
		if err := db.Create(&newProd).Error; err != nil {
			return false, err
		}
		p.replaceImages(db, newProd.ID, urls)
		return true, nil
	}

	updates := map[string]any{
		"name":             sku.Title,
		"description":      sku.Description,
		"price":            sku.Price,
		"compare_at_price": sku.ListPrice,
		"stock_quantity":   sku.Stock,
		"main_image":       mainImage,
		"is_active":        sku.Active,
		"external_data":    string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, urls)
	return false, nil
}

func (p *magaluProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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
