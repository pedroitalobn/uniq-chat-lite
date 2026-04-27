package shop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// WhatsApp Catalog provider — diferente dos outros: faz PUSH (Shop local
// → Meta Commerce Catalog), não pull. Fluxo:
//
//   1. Cliente cria catálogo no Meta Business Manager (manual, 1x).
//   2. Cliente cria System User Token de longa duração com escopos
//      catalog_management + whatsapp_business_management.
//   3. UI: cliente cola { catalog_id, access_token } no Config da
//      ShopIntegration (AuthMode=APIKey, sem OAuth).
//   4. SyncProducts envia todos produtos ativos pra catalog via
//      POST /{catalog_id}/items_batch (batch de até 500 items).
//   5. Após sync, Shop.WhatsAppCatalogID é populado — outras features
//      (carrossel de produtos in-chat, list message com items) podem
//      referenciar.
//
// Não tem webhook próprio — Meta não notifica mudanças no catalog.

const metaGraphBase = "https://graph.facebook.com/v19.0"

func init() {
	RegisterProvider(&waCatalogProvider{})
}

type waCatalogProvider struct{}

type waCatalogCreds struct {
	AccessToken string `json:"access_token"`
	CatalogID   string `json:"catalog_id"`
	BusinessID  string `json:"business_id,omitempty"`
}

func (p *waCatalogProvider) ID() string          { return "whatsapp_catalog" }
func (p *waCatalogProvider) DisplayName() string { return "WhatsApp Catalog" }
func (p *waCatalogProvider) AuthMode() AuthMode  { return AuthAPIKey }

// AuthorizeURL não se aplica — provider usa access_token direto.
func (p *waCatalogProvider) AuthorizeURL(_ context.Context, _ *models.ShopIntegration, _, _ string) (string, error) {
	return "", &ProviderError{Provider: p.ID(), Op: "authorize", Err: errors.New("WhatsApp Catalog usa API token, não OAuth — POST /credentials direto")}
}

// HandleCallback também não se aplica — em vez disso, criar endpoint
// PATCH /integrations/:id pra cliente colar { access_token, catalog_id }
// no Config, daí internamente migramos pra Credentials criptografado.
func (p *waCatalogProvider) HandleCallback(ctx context.Context, integration *models.ShopIntegration, _, _ string) error {
	// Lê o token+catalog do Config (UI cola lá), valida, criptografa,
	// salva em Credentials e limpa do Config (não fica em texto puro).
	var cfg map[string]string
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	creds := waCatalogCreds{
		AccessToken: cfg["access_token"],
		CatalogID:   cfg["catalog_id"],
		BusinessID:  cfg["business_id"],
	}
	if creds.AccessToken == "" || creds.CatalogID == "" {
		return errors.New("config deve conter access_token e catalog_id")
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	// Limpa secrets do Config
	cfg["access_token"] = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

// TestConnection — GET /{catalog_id}?fields=id,name valida.
func (p *waCatalogProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, "/"+c.CatalogID+"?fields=id,name,product_count")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("meta %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

// SyncProducts — push dos produtos LOCAIS ATIVOS da shop pro Meta
// catalog. Usa /items_batch que aceita até 500 items por request.
func (p *waCatalogProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	// Busca produtos ativos da shop. Push em batches de 500.
	const batchSize = 500
	offset := 0
	for {
		var products []models.Product
		err := db.Preload("Images").
			Where("shop_id = ? AND is_active = true", shop.ID).
			Order("created_at ASC").
			Limit(batchSize).Offset(offset).
			Find(&products).Error
		if err != nil {
			return stats, err
		}
		if len(products) == 0 {
			break
		}
		stats.Pulled += len(products)

		// Monta batch UPDATE no formato Meta items_batch.
		requests := make([]map[string]any, 0, len(products))
		for _, prod := range products {
			requests = append(requests, p.toMetaItem(&prod, &shop))
		}
		if err := p.sendBatch(ctx, c, requests); err != nil {
			stats.Failed += len(products)
		} else {
			stats.Updated += len(products) // Meta UPSERT — não distingue create/update
		}
		offset += batchSize
		if len(products) < batchSize {
			break
		}
	}

	// Atualiza shop.whatsapp_catalog_id pra UI saber que ta linkado.
	if shop.WhatsAppCatalogID != c.CatalogID {
		db.Model(&shop).Update("whatsapp_catalog_id", c.CatalogID)
	}
	return stats, nil
}

// HandleWebhook — não usado (Meta não notifica catalog). No-op.
func (p *waCatalogProvider) HandleWebhook(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *waCatalogProvider) creds(integration *models.ShopIntegration) (*waCatalogCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — cole access_token + catalog_id e chame /test")
	}
	var c waCatalogCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.AccessToken == "" || c.CatalogID == "" {
		return nil, errors.New("credenciais incompletas")
	}
	return &c, nil
}

func (p *waCatalogProvider) apiGet(ctx context.Context, c *waCatalogCreds, path string) (*http.Response, error) {
	full := metaGraphBase + path
	if strings.Contains(full, "?") {
		full += "&access_token=" + c.AccessToken
	} else {
		full += "?access_token=" + c.AccessToken
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// sendBatch — POST /{catalog_id}/items_batch com requests[] (UPDATE).
func (p *waCatalogProvider) sendBatch(ctx context.Context, c *waCatalogCreds, requests []map[string]any) error {
	body := map[string]any{
		"access_token": c.AccessToken,
		"requests":     requests,
		"item_type":    "PRODUCT_ITEM",
	}
	raw, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/%s/items_batch", metaGraphBase, c.CatalogID)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("meta items_batch %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// toMetaItem mapeia o Product local pro formato Meta Catalog.
// Spec: https://developers.facebook.com/docs/marketing-api/catalog/reference
func (p *waCatalogProvider) toMetaItem(prod *models.Product, shop *models.Shop) map[string]any {
	availability := "in stock"
	if prod.TrackStock && prod.StockQuantity <= 0 {
		availability = "out of stock"
	}
	condition := "new" // default — Product model não tem field; futuro
	imageURL := prod.MainImage
	if imageURL == "" && len(prod.Images) > 0 {
		imageURL = prod.Images[0].URL
	}

	// Meta Catalog retailer_id é unique key — usamos product UUID.
	data := map[string]any{
		"retailer_id":      prod.ID.String(),
		"availability":     availability,
		"brand":            shop.Name,
		"category":         "Geral", // futuro: usar primeira ProductCategory
		"description":      truncate(prod.Description, 9999),
		"image_url":        imageURL,
		"name":             prod.Name,
		"price":            int(prod.Price * 100), // Meta espera centavos
		"currency":         prod.Currency,
		"condition":        condition,
		"url":              fmt.Sprintf("https://uniq.chat/shop/%s/product/%s", shop.Slug, prod.ID.String()),
	}
	if prod.SKU != "" {
		data["item_group_id"] = prod.SKU
	}
	if prod.CompareAtPrice > 0 && prod.CompareAtPrice > prod.Price {
		data["sale_price"] = int(prod.Price * 100)
		data["price"] = int(prod.CompareAtPrice * 100)
	}

	return map[string]any{
		"method": "UPDATE", // Meta UPSERT — cria se não existe
		"data":   data,
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
