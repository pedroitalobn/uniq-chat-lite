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

// Amazon SP-API — Selling Partner API.
//
// Auth: Login with Amazon (LWA) OAuth2. App credentials (client_id +
// client_secret) ficam em AMAZON_LWA_CLIENT_ID/SECRET (Modelo A BSP).
// Cliente aprova o app via App Store da Amazon e backend recebe
// refresh_token via callback. Trocamos refresh por access_token a cada
// chamada (TTL 1h).
//
// Marketplace IDs comuns:
//   A2Q3Y263D00KWC = BR
//   ATVPDKIKX0DER  = US
//   APJ6JRA9NG5V4  = ES
//   A1F83G8C2ARO7P = UK
//
// Cliente deve informar marketplace_id + region (na-east, eu-west, fe).
//
// Endpoints (SP-API):
//   GET https://api.amazon.com/auth/o2/token         (LWA token exchange)
//   GET https://sellingpartnerapi-{region}.amazon.com/listings/2021-08-01/items/{sellerId}?marketplaceIds=...
//   GET .../catalog/2022-04-01/items/{asin}?marketplaceIds=...
//
// Esta fase NÃO usa AWS SigV4 (descontinuado em 2023 — SP-API agora aceita
// LWA puro). NÃO acessamos PII (sem RDT tokens).

const amazonLWATokenURL = "https://api.amazon.com/auth/o2/token"

func init() {
	RegisterProvider(&amazonProvider{})
}

type amazonProvider struct{}

type amazonCreds struct {
	RefreshToken  string `json:"refresh_token"`
	AccessToken   string `json:"access_token,omitempty"`
	ExpiresAt     int64  `json:"expires_at,omitempty"`
	SellerID      string `json:"seller_id"`
	MarketplaceID string `json:"marketplace_id"`
	Region        string `json:"region"` // na | eu | fe
}

type amazonConfig struct {
	ClientID      string `json:"client_id,omitempty"`
	ClientSecret  string `json:"client_secret,omitempty"`
	SellerID      string `json:"seller_id,omitempty"`
	MarketplaceID string `json:"marketplace_id,omitempty"`
	Region        string `json:"region,omitempty"`
	RefreshToken  string `json:"refresh_token,omitempty"` // limpo após callback
}

func (p *amazonProvider) ID() string          { return "amazon" }
func (p *amazonProvider) DisplayName() string { return "Amazon SP-API" }
func (p *amazonProvider) AuthMode() AuthMode  { return AuthOAuth2 }

func (p *amazonProvider) AuthorizeURL(_ context.Context, integration *models.ShopIntegration, state, redirectURI string) (string, error) {
	clientID, _, err := p.appCreds(integration)
	if err != nil {
		return "", err
	}
	appID := os.Getenv("AMAZON_SP_APP_ID")
	if appID == "" {
		// Fallback: pega do Config (Modelo B)
		var cfg amazonConfig
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
		appID = cfg.ClientID
	}
	v := url.Values{}
	v.Set("application_id", appID)
	v.Set("state", state)
	v.Set("redirect_uri", redirectURI)
	v.Set("version", "beta")
	// Marketplace seller central — usuário escolhe lá.
	_ = clientID
	return "https://sellercentral.amazon.com/apps/authorize/consent?" + v.Encode(), nil
}

func (p *amazonProvider) HandleCallback(ctx context.Context, integration *models.ShopIntegration, code, redirectURI string) error {
	clientID, clientSecret, err := p.appCreds(integration)
	if err != nil {
		return err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)

	req, _ := http.NewRequestWithContext(ctx, "POST", amazonLWATokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("amazon lwa %d: %s", resp.StatusCode, string(raw))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return err
	}

	var cfg amazonConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.SellerID == "" || cfg.MarketplaceID == "" {
		return errors.New("config deve conter seller_id e marketplace_id")
	}
	if cfg.Region == "" {
		cfg.Region = "na" // default norte-américa
	}
	creds := amazonCreds{
		RefreshToken:  tok.RefreshToken,
		AccessToken:   tok.AccessToken,
		ExpiresAt:     time.Now().Unix() + tok.ExpiresIn,
		SellerID:      cfg.SellerID,
		MarketplaceID: cfg.MarketplaceID,
		Region:        cfg.Region,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	cfg.ClientSecret = ""
	cfg.RefreshToken = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *amazonProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(ctx, integration)
	if err != nil {
		return err
	}
	resp, err := p.apiGet(ctx, c, fmt.Sprintf("/listings/2021-08-01/items/%s?marketplaceIds=%s&pageSize=1",
		c.SellerID, c.MarketplaceID))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("amazon test %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

func (p *amazonProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(ctx, integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	const pageSize = 20 // SP-API listings max 20 por página
	nextToken := ""
	for {
		path := fmt.Sprintf("/listings/2021-08-01/items/%s?marketplaceIds=%s&pageSize=%d&includedData=summaries,attributes,offers",
			c.SellerID, c.MarketplaceID, pageSize)
		if nextToken != "" {
			path += "&pageToken=" + url.QueryEscape(nextToken)
		}
		resp, err := p.apiGet(ctx, c, path)
		if err != nil {
			return stats, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return stats, fmt.Errorf("amazon list %d: %s", resp.StatusCode, string(raw))
		}
		var page struct {
			Items         []amazonListingDTO `json:"items"`
			NextPageToken string             `json:"nextPageToken"`
		}
		if err := json.Unmarshal(raw, &page); err != nil {
			return stats, err
		}
		if len(page.Items) == 0 {
			break
		}
		stats.Pulled += len(page.Items)
		for i := range page.Items {
			created, err := p.upsertListing(db, &shop, &page.Items[i])
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
		if page.NextPageToken == "" {
			break
		}
		nextToken = page.NextPageToken
	}
	return stats, nil
}

func (p *amazonProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	// Amazon usa SQS Notifications via AWS — fora do escopo MVP.
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *amazonProvider) appCreds(integration *models.ShopIntegration) (string, string, error) {
	id := os.Getenv("AMAZON_LWA_CLIENT_ID")
	sec := os.Getenv("AMAZON_LWA_CLIENT_SECRET")
	if id != "" && sec != "" {
		return id, sec, nil
	}
	var cfg amazonConfig
	if integration != nil && integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.ClientID != "" && cfg.ClientSecret != "" {
		return cfg.ClientID, cfg.ClientSecret, nil
	}
	return "", "", errors.New("amazon: defina AMAZON_LWA_CLIENT_ID/SECRET ou cole no Config")
}

func (p *amazonProvider) creds(ctx context.Context, integration *models.ShopIntegration) (*amazonCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — autorize via Seller Central")
	}
	var c amazonCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.RefreshToken == "" || c.SellerID == "" || c.MarketplaceID == "" {
		return nil, errors.New("credenciais Amazon incompletas")
	}
	if c.AccessToken == "" || time.Now().Unix() > c.ExpiresAt-60 {
		if err := p.refresh(ctx, integration, &c); err != nil {
			return nil, err
		}
	}
	return &c, nil
}

func (p *amazonProvider) refresh(ctx context.Context, integration *models.ShopIntegration, c *amazonCreds) error {
	clientID, clientSecret, err := p.appCreds(integration)
	if err != nil {
		return err
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", c.RefreshToken)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)

	req, _ := http.NewRequestWithContext(ctx, "POST", amazonLWATokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("amazon refresh %d: %s", resp.StatusCode, string(raw))
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

func (p *amazonProvider) regionHost(region string) string {
	switch region {
	case "eu":
		return "sellingpartnerapi-eu.amazon.com"
	case "fe":
		return "sellingpartnerapi-fe.amazon.com"
	default:
		return "sellingpartnerapi-na.amazon.com"
	}
}

func (p *amazonProvider) apiGet(ctx context.Context, c *amazonCreds, path string) (*http.Response, error) {
	full := "https://" + p.regionHost(c.Region) + path
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	req.Header.Set("x-amz-access-token", c.AccessToken)
	req.Header.Set("Accept", "application/json")
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}

// amazonListingDTO — subset relevante de Listings Items API.
type amazonListingDTO struct {
	SKU        string `json:"sku"`
	Summaries  []struct {
		MarketplaceID string `json:"marketplaceId"`
		ASIN          string `json:"asin"`
		ItemName      string `json:"itemName"`
		Status        []string `json:"status"`
		MainImage struct {
			Link string `json:"link"`
		} `json:"mainImage"`
	} `json:"summaries"`
	Attributes map[string]any `json:"attributes"`
	Offers     []struct {
		Price struct {
			Amount       float64 `json:"amount"`
			CurrencyCode string  `json:"currencyCode"`
		} `json:"price"`
	} `json:"offers"`
}

func (p *amazonProvider) upsertListing(db *gorm.DB, shop *models.Shop, it *amazonListingDTO) (bool, error) {
	rawJSON, _ := json.Marshal(it)
	name, mainImage, asin, status := "", "", "", ""
	for _, s := range it.Summaries {
		if name == "" {
			name = s.ItemName
		}
		if mainImage == "" {
			mainImage = s.MainImage.Link
		}
		if asin == "" {
			asin = s.ASIN
		}
		if len(s.Status) > 0 {
			status = s.Status[0]
		}
	}
	price := 0.0
	if len(it.Offers) > 0 {
		price = it.Offers[0].Price.Amount
	}
	urls := []string{}
	if mainImage != "" {
		urls = append(urls, mainImage)
	}

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "amazon", it.SKU).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              it.SKU,
			Name:             name,
			Description:      asin,
			Type:             models.ProductTypePhysical,
			Price:            price,
			Currency:         shop.Currency,
			MainImage:        mainImage,
			IsActive:         status == "BUYABLE" || status == "DISCOVERABLE",
			ExternalProvider: "amazon",
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
		"name":          name,
		"description":   asin,
		"price":         price,
		"main_image":    mainImage,
		"is_active":     status == "BUYABLE" || status == "DISCOVERABLE",
		"external_data": string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, urls)
	return false, nil
}

func (p *amazonProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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
