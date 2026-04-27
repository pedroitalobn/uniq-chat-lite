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

// VTEX provider — maior plataforma BR enterprise.
//
// Auth: AppKey + AppToken (NÃO OAuth). Cliente cria em
// vtex admin → Account Settings → Application Keys, copia o par.
// AuthMode = AuthCustom porque não bate nos buckets oauth/api_key
// padrão.
//
// Headers de cada request:
//   X-VTEX-API-AppKey:   <key>
//   X-VTEX-API-AppToken: <token>
//
// Endpoints usados:
//   GET /api/catalog_system/pvt/products/GetProductAndSkuIds
//        — paginado: ?_from=0&_to=49 (page de 50, max 50)
//        retorna { ProductId: [skuId1, ...] }
//   GET /api/catalog/pvt/product/{productId}        — detalhes do produto
//   GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId} — SKU
//   GET /api/pricing/prices/{skuId}                 — preço (Pricing API)
//
// Pra effort low: 1 query de SKU + preço por produto. Otimização (batch
// pricing) fica pra incremental futura.

func init() {
	RegisterProvider(&vtexProvider{})
}

type vtexProvider struct{}

type vtexCreds struct {
	AccountName string `json:"account_name"` // ex: "minhaloja"
	Environment string `json:"environment"`  // "vtexcommercestable" (default) | "myvtex"
	AppKey      string `json:"app_key"`
	AppToken    string `json:"app_token"`
}

// vtexConfig é guardado em Integration.Config (não criptografado) e
// recebe o account_name + environment. Após primeiro Connect/Test,
// o backend move app_key+app_token pra Credentials encriptados.
type vtexConfig struct {
	AccountName string `json:"account_name"`
	Environment string `json:"environment,omitempty"`
	AppKey      string `json:"app_key,omitempty"`   // limpo após HandleCallback
	AppToken    string `json:"app_token,omitempty"` // limpo após HandleCallback
}

func (p *vtexProvider) ID() string          { return "vtex" }
func (p *vtexProvider) DisplayName() string { return "VTEX" }
func (p *vtexProvider) AuthMode() AuthMode  { return AuthCustom }

func (p *vtexProvider) AuthorizeURL(_ context.Context, _ *models.ShopIntegration, _, _ string) (string, error) {
	return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("VTEX usa AppKey+AppToken, não OAuth — cole no Config + chame /test")}
}

// HandleCallback no VTEX é chamado depois de /test pra migrar
// credenciais do Config (texto puro) pra Credentials (criptografado).
func (p *vtexProvider) HandleCallback(_ context.Context, integration *models.ShopIntegration, _, _ string) error {
	var cfg vtexConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.AccountName == "" || cfg.AppKey == "" || cfg.AppToken == "" {
		return errors.New("config deve conter account_name, app_key e app_token")
	}
	env := cfg.Environment
	if env == "" {
		env = "vtexcommercestable"
	}
	creds := vtexCreds{
		AccountName: cfg.AccountName,
		Environment: env,
		AppKey:      cfg.AppKey,
		AppToken:    cfg.AppToken,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	// Limpa secrets do Config — mantém só account_name pra UI exibir.
	cfg.AppKey = ""
	cfg.AppToken = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *vtexProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, "/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=0&_to=0")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("vtex test %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

func (p *vtexProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	// Paginado: 50 produtos por request (max VTEX).
	const pageSize = 50
	from := 0
	for {
		path := fmt.Sprintf("/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=%d&_to=%d", from, from+pageSize-1)
		resp, err := p.apiGet(ctx, c, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 404 || len(raw) == 0 {
			break
		}
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("vtex list %d: %s", resp.StatusCode, string(raw))
		}
		// Resposta: { "1": [10001, 10002], "2": [10003] }
		var page map[string][]int64
		if err := json.Unmarshal(raw, &page); err != nil {
			return stats, err
		}
		if len(page) == 0 {
			break
		}
		stats.Pulled += len(page)

		for productIDStr, skus := range page {
			created, err := p.fetchAndUpsertProduct(ctx, db, c, &shop, productIDStr, skus)
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

		if len(page) < pageSize {
			break
		}
		from += pageSize
	}
	return stats, nil
}

// HandleWebhook — VTEX webhooks são opcionais e configurados via
// Catalog/OMS Hooks API. Por enquanto no-op — sync manual cobre. Fase
// futura: validar X-VTEX-Signature e processar product/order events.
func (p *vtexProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *vtexProvider) creds(integration *models.ShopIntegration) (*vtexCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — cole AppKey/AppToken no Config + chame /test")
	}
	var c vtexCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.AccountName == "" || c.AppKey == "" || c.AppToken == "" {
		return nil, errors.New("credenciais VTEX incompletas")
	}
	if c.Environment == "" {
		c.Environment = "vtexcommercestable"
	}
	return &c, nil
}

func (p *vtexProvider) apiGet(ctx context.Context, c *vtexCreds, path string) (*http.Response, error) {
	host := fmt.Sprintf("https://%s.%s.com.br", c.AccountName, c.Environment)
	full := host + path
	if strings.HasPrefix(path, "https://") {
		full = path
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	req.Header.Set("X-VTEX-API-AppKey", c.AppKey)
	req.Header.Set("X-VTEX-API-AppToken", c.AppToken)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

func (p *vtexProvider) fetchAndUpsertProduct(ctx context.Context, db *gorm.DB, c *vtexCreds, shop *models.Shop, productID string, skuIDs []int64) (bool, error) {
	// Detalhes do produto
	resp, err := p.apiGet(ctx, c, "/api/catalog/pvt/product/"+productID)
	if err != nil {
		return false, err
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return false, fmt.Errorf("vtex product %s: %d", productID, resp.StatusCode)
	}
	var prod vtexProductDTO
	if err := json.Unmarshal(raw, &prod); err != nil {
		return false, err
	}

	// SKU principal (primeiro) pra preço/estoque/sku
	var sku string
	var price, listPrice float64
	var stock int
	if len(skuIDs) > 0 {
		skuID := skuIDs[0]
		// SKU details
		skuResp, _ := p.apiGet(ctx, c, fmt.Sprintf("/api/catalog_system/pvt/sku/stockkeepingunitbyid/%d", skuID))
		if skuResp != nil {
			skuRaw, _ := io.ReadAll(skuResp.Body)
			skuResp.Body.Close()
			var skuObj vtexSkuDTO
			if json.Unmarshal(skuRaw, &skuObj) == nil {
				sku = skuObj.AlternateIds.RefId
				if sku == "" {
					sku = fmt.Sprintf("%d", skuID)
				}
			}
		}
		// Pricing
		priceResp, _ := p.apiGet(ctx, c, fmt.Sprintf("/api/pricing/prices/%d", skuID))
		if priceResp != nil {
			priceRaw, _ := io.ReadAll(priceResp.Body)
			priceResp.Body.Close()
			var priceObj struct {
				CostPrice float64 `json:"costPrice"`
				ListPrice float64 `json:"listPrice"`
				BasePrice float64 `json:"basePrice"`
			}
			if json.Unmarshal(priceRaw, &priceObj) == nil {
				price = priceObj.BasePrice
				if price == 0 {
					price = priceObj.ListPrice
				}
				listPrice = priceObj.ListPrice
			}
		}
	}

	rawJSON, _ := json.Marshal(prod)
	mainImage := ""
	images := []string{}
	if len(prod.Images) > 0 {
		mainImage = prod.Images[0].ImageURL
		for _, img := range prod.Images {
			images = append(images, img.ImageURL)
		}
	}

	var existing models.Product
	err = db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "vtex", productID).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              sku,
			Name:             prod.Name,
			Slug:             prod.LinkID,
			Description:      prod.Description,
			Type:             models.ProductTypePhysical,
			Price:            price,
			CompareAtPrice:   listPrice,
			Currency:         shop.Currency,
			StockQuantity:    stock,
			TrackStock:       true,
			MainImage:        mainImage,
			IsActive:         prod.IsActive,
			ExternalProvider: "vtex",
			ExternalID:       productID,
			ExternalData:     string(rawJSON),
		}
		if err := db.Create(&newProd).Error; err != nil {
			return false, err
		}
		p.replaceImages(db, newProd.ID, images)
		return true, nil
	}

	updates := map[string]any{
		"sku":              sku,
		"name":             prod.Name,
		"slug":             prod.LinkID,
		"description":      prod.Description,
		"price":            price,
		"compare_at_price": listPrice,
		"main_image":       mainImage,
		"is_active":        prod.IsActive,
		"external_data":    string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, images)
	return false, nil
}

func (p *vtexProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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

// vtexProductDTO — subset que mapeamos.
type vtexProductDTO struct {
	ID          int64  `json:"Id"`
	Name        string `json:"Name"`
	LinkID      string `json:"LinkId"`
	Description string `json:"Description"`
	IsActive    bool   `json:"IsActive"`
	BrandID     int    `json:"BrandId"`
	Images      []struct {
		ImageURL string `json:"imageUrl"`
		ImageName string `json:"imageName"`
	} `json:"images"`
}

type vtexSkuDTO struct {
	AlternateIds struct {
		Ean   string `json:"Ean"`
		RefId string `json:"RefId"`
	} `json:"AlternateIds"`
}
