package shop

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// eBay Sell API — OAuth2 (User Token).
//
// Auth: OAuth Authorization Code flow. App credentials (client_id +
// client_secret) ficam em EBAY_CLIENT_ID/EBAY_CLIENT_SECRET (Modelo A
// BSP). Cada workspace autoriza e recebe access+refresh token.
//
// Modelo B fallback: cliente cola client_id+secret no Config.
//
// Endpoints (Sell API):
//   POST https://api.ebay.com/identity/v1/oauth2/token
//   GET  https://api.ebay.com/sell/inventory/v1/inventory_item?limit=100&offset=N
//
// Scopes mínimos: sell.inventory.readonly, sell.inventory

const (
	ebayAuthURL  = "https://auth.ebay.com/oauth2/authorize"
	ebayTokenURL = "https://api.ebay.com/identity/v1/oauth2/token"
	ebayAPIBase  = "https://api.ebay.com"
	ebayScopes   = "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory"
)

func init() {
	RegisterProvider(&ebayProvider{})
}

type ebayProvider struct{}

type ebayCreds struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

type ebayConfig struct {
	ClientID     string `json:"client_id,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
	RuName       string `json:"ru_name,omitempty"` // RuName cadastrado no eBay Developer
}

func (p *ebayProvider) ID() string          { return "ebay" }
func (p *ebayProvider) DisplayName() string { return "eBay" }
func (p *ebayProvider) AuthMode() AuthMode  { return AuthOAuth2 }

func (p *ebayProvider) AuthorizeURL(_ context.Context, integration *models.ShopIntegration, state, _ string) (string, error) {
	clientID, _, ruName, err := p.appCreds(integration)
	if err != nil {
		return "", err
	}
	if ruName == "" {
		return "", errors.New("ebay: ru_name obrigatório no Config (cadastrado no eBay Developer)")
	}
	v := url.Values{}
	v.Set("client_id", clientID)
	v.Set("response_type", "code")
	v.Set("redirect_uri", ruName)
	v.Set("scope", ebayScopes)
	v.Set("state", state)
	return ebayAuthURL + "?" + v.Encode(), nil
}

func (p *ebayProvider) HandleCallback(ctx context.Context, integration *models.ShopIntegration, code, _ string) error {
	clientID, clientSecret, ruName, err := p.appCreds(integration)
	if err != nil {
		return err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", ruName)

	req, _ := http.NewRequestWithContext(ctx, "POST", ebayTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	auth := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + clientSecret))
	req.Header.Set("Authorization", "Basic "+auth)

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ebay token %d: %s", resp.StatusCode, string(raw))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return err
	}
	creds := ebayCreds{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		ExpiresAt:    time.Now().Unix() + tok.ExpiresIn,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	// Limpa secret do Config; mantém client_id+ru_name pra refresh.
	var cfg ebayConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	cfg.ClientSecret = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *ebayProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(ctx, integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, "/sell/inventory/v1/inventory_item?limit=1")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ebay test %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

func (p *ebayProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(ctx, integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	const pageSize = 100
	offset := 0
	for {
		path := fmt.Sprintf("/sell/inventory/v1/inventory_item?limit=%d&offset=%d", pageSize, offset)
		resp, err := p.apiGet(ctx, c, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("ebay list %d: %s", resp.StatusCode, string(raw))
		}
		var page struct {
			InventoryItems []ebayInventoryDTO `json:"inventoryItems"`
			Total          int                `json:"total"`
		}
		if err := json.Unmarshal(raw, &page); err != nil {
			return stats, err
		}
		if len(page.InventoryItems) == 0 {
			break
		}
		stats.Pulled += len(page.InventoryItems)
		for i := range page.InventoryItems {
			created, err := p.upsertInventoryItem(db, &shop, &page.InventoryItems[i])
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
		offset += pageSize
		if offset >= page.Total {
			break
		}
	}
	return stats, nil
}

func (p *ebayProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *ebayProvider) appCreds(integration *models.ShopIntegration) (clientID, clientSecret, ruName string, err error) {
	id := os.Getenv("EBAY_CLIENT_ID")
	sec := os.Getenv("EBAY_CLIENT_SECRET")
	ru := os.Getenv("EBAY_RU_NAME")
	var cfg ebayConfig
	if integration != nil && integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	// Modelo A (env BSP) prioritário
	if id == "" {
		id = cfg.ClientID
	}
	if sec == "" {
		sec = cfg.ClientSecret
	}
	if ru == "" {
		ru = cfg.RuName
	}
	if id == "" || sec == "" {
		return "", "", "", errors.New("ebay: defina EBAY_CLIENT_ID/EBAY_CLIENT_SECRET ou cole no Config")
	}
	return id, sec, ru, nil
}

func (p *ebayProvider) creds(ctx context.Context, integration *models.ShopIntegration) (*ebayCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — autorize via OAuth")
	}
	var c ebayCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.AccessToken == "" {
		return nil, errors.New("access_token vazio")
	}
	// Refresh se expirado (com 60s de margem).
	if c.ExpiresAt > 0 && time.Now().Unix() > c.ExpiresAt-60 {
		if err := p.refresh(ctx, integration, &c); err != nil {
			return nil, err
		}
	}
	return &c, nil
}

func (p *ebayProvider) refresh(ctx context.Context, integration *models.ShopIntegration, c *ebayCreds) error {
	clientID, clientSecret, _, err := p.appCreds(integration)
	if err != nil {
		return err
	}
	if c.RefreshToken == "" {
		return errors.New("refresh_token ausente — reautorize")
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", c.RefreshToken)
	form.Set("scope", ebayScopes)

	req, _ := http.NewRequestWithContext(ctx, "POST", ebayTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	auth := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + clientSecret))
	req.Header.Set("Authorization", "Basic "+auth)

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ebay refresh %d: %s", resp.StatusCode, string(raw))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return err
	}
	c.AccessToken = tok.AccessToken
	c.ExpiresAt = time.Now().Unix() + tok.ExpiresIn
	enc, err := MarshalCredentials(*c)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	return nil
}

func (p *ebayProvider) apiGet(ctx context.Context, c *ebayCreds, path string) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", ebayAPIBase+path, nil)
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// ebayInventoryDTO — subset relevante de inventory_item.
type ebayInventoryDTO struct {
	SKU     string `json:"sku"`
	Locale  string `json:"locale"`
	Product struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		ImageURLs   []string `json:"imageUrls"`
		Brand       string   `json:"brand"`
	} `json:"product"`
	Availability struct {
		ShipToLocationAvailability struct {
			Quantity int `json:"quantity"`
		} `json:"shipToLocationAvailability"`
	} `json:"availability"`
	// eBay separa preço em offers (chamada distinta). Aqui price=0 inicial.
}

func (p *ebayProvider) upsertInventoryItem(db *gorm.DB, shop *models.Shop, it *ebayInventoryDTO) (bool, error) {
	rawJSON, _ := json.Marshal(it)
	urls := it.Product.ImageURLs
	mainImage := ""
	if len(urls) > 0 {
		mainImage = urls[0]
	}
	stock := it.Availability.ShipToLocationAvailability.Quantity

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "ebay", it.SKU).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              it.SKU,
			Name:             it.Product.Title,
			Description:      it.Product.Description,
			Type:             models.ProductTypePhysical,
			Currency:         shop.Currency,
			StockQuantity:    stock,
			TrackStock:       true,
			MainImage:        mainImage,
			IsActive:         stock > 0,
			ExternalProvider: "ebay",
			ExternalID:       it.SKU,
			ExternalData:     string(rawJSON),
		}
		if err := db.Create(&newProd).Error; err != nil {
			return false, err
		}
		p.replaceImages(db, newProd.ID, urls)
		return true, nil
	}

	updates := map[string]any{
		"name":           it.Product.Title,
		"description":    it.Product.Description,
		"stock_quantity": stock,
		"main_image":     mainImage,
		"is_active":      stock > 0,
		"external_data":  string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, urls)
	return false, nil
}

func (p *ebayProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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

// silence unused (strconv kept for future fields)
var _ = strconv.Itoa
