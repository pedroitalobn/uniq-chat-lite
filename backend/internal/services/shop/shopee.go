package shop

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// Shopee Open Platform — Partner API v2.
//
// Auth: OAuth2 com HMAC signature em todas as chamadas. Cada request
// precisa de partner_id + timestamp + path + access_token + shop_id +
// signature(HMAC-SHA256 da concat).
//
// Modelo BSP (Modelo A — preferido): partner_id+partner_key vivem em
// SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY (env). Fallback Modelo B:
// cliente cola no Config (raríssimo — Shopee só libera Partner pra
// empresas aprovadas).
//
// Endpoints (v2):
//   GET  /api/v2/shop/auth_partner   (gera URL OAuth)
//   POST /api/v2/auth/token/get      (troca code por access_token)
//   POST /api/v2/auth/access_token/get?... (refresh)
//   POST /api/v2/product/get_item_list
//   POST /api/v2/product/get_item_base_info

const shopeeAPIBase = "https://partner.shopeemobile.com"

func init() {
	RegisterProvider(&shopeeProvider{})
}

type shopeeProvider struct{}

type shopeeCreds struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ShopID       int64  `json:"shop_id"`
	ExpiresAt    int64  `json:"expires_at"` // unix
}

type shopeeConfig struct {
	PartnerID  string `json:"partner_id,omitempty"`
	PartnerKey string `json:"partner_key,omitempty"`
	ShopID     int64  `json:"shop_id,omitempty"`
}

func (p *shopeeProvider) ID() string          { return "shopee" }
func (p *shopeeProvider) DisplayName() string { return "Shopee" }
func (p *shopeeProvider) AuthMode() AuthMode  { return AuthOAuth2 }

func (p *shopeeProvider) AuthorizeURL(_ context.Context, integration *models.ShopIntegration, state, redirectURI string) (string, error) {
	partnerID, _, err := p.partnerCreds(integration)
	if err != nil {
		return "", err
	}
	ts := time.Now().Unix()
	path := "/api/v2/shop/auth_partner"
	sig := p.signBase(partnerID, p.partnerKey(integration), path, ts)
	v := url.Values{}
	v.Set("partner_id", partnerID)
	v.Set("redirect", redirectURI)
	v.Set("timestamp", strconv.FormatInt(ts, 10))
	v.Set("sign", sig)
	v.Set("state", state)
	return shopeeAPIBase + path + "?" + v.Encode(), nil
}

func (p *shopeeProvider) HandleCallback(ctx context.Context, integration *models.ShopIntegration, code, _ string) error {
	partnerID, partnerKey, err := p.partnerCreds(integration)
	if err != nil {
		return err
	}
	var cfg shopeeConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.ShopID == 0 {
		return errors.New("shop_id obrigatório no Config (Shopee retorna no callback)")
	}
	ts := time.Now().Unix()
	path := "/api/v2/auth/token/get"
	sig := p.signBase(partnerID, partnerKey, path, ts)

	body, _ := json.Marshal(map[string]any{
		"code":       code,
		"shop_id":    cfg.ShopID,
		"partner_id": atoi64(partnerID),
	})
	full := fmt.Sprintf("%s%s?partner_id=%s&timestamp=%d&sign=%s",
		shopeeAPIBase, path, partnerID, ts, sig)
	req, _ := http.NewRequestWithContext(ctx, "POST", full, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("shopee token %d: %s", resp.StatusCode, string(raw))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpireIn     int64  `json:"expire_in"`
		Error        string `json:"error"`
		Message      string `json:"message"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return err
	}
	if tok.Error != "" {
		return fmt.Errorf("shopee: %s — %s", tok.Error, tok.Message)
	}
	creds := shopeeCreds{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		ShopID:       cfg.ShopID,
		ExpiresAt:    time.Now().Unix() + tok.ExpireIn,
	}
	enc, err := MarshalCredentials(creds)
	if err != nil {
		return err
	}
	integration.Credentials = enc
	// Limpa partner_key do Config (segurança); mantém shop_id.
	cfg.PartnerKey = ""
	clean, _ := json.Marshal(cfg)
	integration.Config = string(clean)
	integration.IsActive = true
	return nil
}

func (p *shopeeProvider) TestConnection(ctx context.Context, integration *models.ShopIntegration) error {
	c, err := p.creds(integration)
	if err != nil {
		return err
	}
	_, _, err = p.itemList(ctx, integration, c, 0, 10)
	return err
}

func (p *shopeeProvider) SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, _ *string) (SyncStats, error) {
	stats := SyncStats{}
	c, err := p.creds(integration)
	if err != nil {
		return stats, err
	}
	var shop models.Shop
	if err := db.First(&shop, "id = ?", integration.ShopID).Error; err != nil {
		return stats, err
	}

	const pageSize = 50
	offset := 0
	for {
		ids, hasMore, err := p.itemList(ctx, integration, c, offset, pageSize)
		if err != nil {
			return stats, err
		}
		if len(ids) == 0 {
			break
		}
		items, err := p.itemBaseInfo(ctx, integration, c, ids)
		if err != nil {
			return stats, err
		}
		stats.Pulled += len(items)
		for i := range items {
			created, err := p.upsertItem(db, &shop, &items[i])
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
		if !hasMore {
			break
		}
		offset += pageSize
	}
	return stats, nil
}

func (p *shopeeProvider) HandleWebhook(_ context.Context, _ *gorm.DB, _ *models.ShopIntegration, _ map[string]string, _ []byte) error {
	return nil
}

// ─── internals ────────────────────────────────────────────────────────

func (p *shopeeProvider) partnerCreds(integration *models.ShopIntegration) (string, string, error) {
	id := os.Getenv("SHOPEE_PARTNER_ID")
	key := os.Getenv("SHOPEE_PARTNER_KEY")
	if id != "" && key != "" {
		return id, key, nil
	}
	// Fallback Modelo B: cfg do workspace.
	var cfg shopeeConfig
	if integration.Config != "" {
		_ = json.Unmarshal([]byte(integration.Config), &cfg)
	}
	if cfg.PartnerID != "" && cfg.PartnerKey != "" {
		return cfg.PartnerID, cfg.PartnerKey, nil
	}
	return "", "", errors.New("shopee: defina SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY ou cole no Config")
}

func (p *shopeeProvider) partnerKey(integration *models.ShopIntegration) string {
	_, k, _ := p.partnerCreds(integration)
	return k
}

func (p *shopeeProvider) creds(integration *models.ShopIntegration) (*shopeeCreds, error) {
	if integration.Credentials == "" {
		return nil, errors.New("credenciais ausentes — autorize via OAuth")
	}
	var c shopeeCreds
	if err := UnmarshalCredentials(integration.Credentials, &c); err != nil {
		return nil, err
	}
	if c.AccessToken == "" || c.ShopID == 0 {
		return nil, errors.New("credenciais Shopee incompletas")
	}
	return &c, nil
}

// signBase é a assinatura pra endpoints públicos (auth_partner / token/get).
// HMAC-SHA256(partner_key, partner_id+path+timestamp).
func (p *shopeeProvider) signBase(partnerID, partnerKey, path string, ts int64) string {
	base := partnerID + path + strconv.FormatInt(ts, 10)
	h := hmac.New(sha256.New, []byte(partnerKey))
	h.Write([]byte(base))
	return hex.EncodeToString(h.Sum(nil))
}

// signShop é pra endpoints de shop autenticado.
// HMAC-SHA256(partner_key, partner_id+path+timestamp+access_token+shop_id).
func (p *shopeeProvider) signShop(partnerID, partnerKey, path string, ts int64, accessToken string, shopID int64) string {
	base := partnerID + path + strconv.FormatInt(ts, 10) + accessToken + strconv.FormatInt(shopID, 10)
	h := hmac.New(sha256.New, []byte(partnerKey))
	h.Write([]byte(base))
	return hex.EncodeToString(h.Sum(nil))
}

func (p *shopeeProvider) signedURL(integration *models.ShopIntegration, c *shopeeCreds, path string, extra url.Values) (string, error) {
	partnerID, partnerKey, err := p.partnerCreds(integration)
	if err != nil {
		return "", err
	}
	ts := time.Now().Unix()
	sig := p.signShop(partnerID, partnerKey, path, ts, c.AccessToken, c.ShopID)
	v := url.Values{}
	v.Set("partner_id", partnerID)
	v.Set("timestamp", strconv.FormatInt(ts, 10))
	v.Set("sign", sig)
	v.Set("access_token", c.AccessToken)
	v.Set("shop_id", strconv.FormatInt(c.ShopID, 10))
	for k, vs := range extra {
		for _, x := range vs {
			v.Add(k, x)
		}
	}
	return shopeeAPIBase + path + "?" + v.Encode(), nil
}

func (p *shopeeProvider) itemList(ctx context.Context, integration *models.ShopIntegration, c *shopeeCreds, offset, pageSize int) ([]int64, bool, error) {
	path := "/api/v2/product/get_item_list"
	extra := url.Values{}
	extra.Set("offset", strconv.Itoa(offset))
	extra.Set("page_size", strconv.Itoa(pageSize))
	extra.Set("item_status", "NORMAL")
	full, err := p.signedURL(integration, c, path, extra)
	if err != nil {
		return nil, false, err
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, false, fmt.Errorf("shopee item_list %d: %s", resp.StatusCode, string(raw))
	}
	var r struct {
		Error    string `json:"error"`
		Message  string `json:"message"`
		Response struct {
			Item []struct {
				ItemID int64 `json:"item_id"`
			} `json:"item"`
			HasNextPage bool `json:"has_next_page"`
		} `json:"response"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, false, err
	}
	if r.Error != "" {
		return nil, false, fmt.Errorf("shopee: %s — %s", r.Error, r.Message)
	}
	ids := make([]int64, 0, len(r.Response.Item))
	for _, it := range r.Response.Item {
		ids = append(ids, it.ItemID)
	}
	return ids, r.Response.HasNextPage, nil
}

type shopeeItemDTO struct {
	ItemID      int64  `json:"item_id"`
	ItemSKU     string `json:"item_sku"`
	ItemName    string `json:"item_name"`
	Description string `json:"description"`
	ItemStatus  string `json:"item_status"`
	PriceInfo   []struct {
		CurrentPrice  float64 `json:"current_price"`
		OriginalPrice float64 `json:"original_price"`
		Currency      string  `json:"currency"`
	} `json:"price_info"`
	StockInfoV2 struct {
		SummaryInfo struct {
			TotalAvailableStock int `json:"total_available_stock"`
		} `json:"summary_info"`
	} `json:"stock_info_v2"`
	Image struct {
		ImageURLList []string `json:"image_url_list"`
	} `json:"image"`
}

func (p *shopeeProvider) itemBaseInfo(ctx context.Context, integration *models.ShopIntegration, c *shopeeCreds, ids []int64) ([]shopeeItemDTO, error) {
	path := "/api/v2/product/get_item_base_info"
	idsStr := ""
	for i, id := range ids {
		if i > 0 {
			idsStr += ","
		}
		idsStr += strconv.FormatInt(id, 10)
	}
	extra := url.Values{}
	extra.Set("item_id_list", idsStr)
	full, err := p.signedURL(integration, c, path, extra)
	if err != nil {
		return nil, err
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", full, nil)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("shopee item_info %d: %s", resp.StatusCode, string(raw))
	}
	var r struct {
		Error    string `json:"error"`
		Message  string `json:"message"`
		Response struct {
			ItemList []shopeeItemDTO `json:"item_list"`
		} `json:"response"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	if r.Error != "" {
		return nil, fmt.Errorf("shopee: %s — %s", r.Error, r.Message)
	}
	return r.Response.ItemList, nil
}

func (p *shopeeProvider) upsertItem(db *gorm.DB, shop *models.Shop, it *shopeeItemDTO) (bool, error) {
	rawJSON, _ := json.Marshal(it)
	urls := it.Image.ImageURLList
	mainImage := ""
	if len(urls) > 0 {
		mainImage = urls[0]
	}
	price, original := 0.0, 0.0
	if len(it.PriceInfo) > 0 {
		price = it.PriceInfo[0].CurrentPrice
		original = it.PriceInfo[0].OriginalPrice
	}
	externalID := strconv.FormatInt(it.ItemID, 10)

	var existing models.Product
	err := db.Where("workspace_id = ? AND external_provider = ? AND external_id = ?",
		shop.WorkspaceID, "shopee", externalID).First(&existing).Error
	if err != nil {
		newProd := models.Product{
			WorkspaceID:      shop.WorkspaceID,
			ShopID:           shop.ID,
			SKU:              it.ItemSKU,
			Name:             it.ItemName,
			Description:      it.Description,
			Type:             models.ProductTypePhysical,
			Price:            price,
			CompareAtPrice:   original,
			Currency:         shop.Currency,
			StockQuantity:    it.StockInfoV2.SummaryInfo.TotalAvailableStock,
			TrackStock:       true,
			MainImage:        mainImage,
			IsActive:         it.ItemStatus == "NORMAL",
			ExternalProvider: "shopee",
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
		"name":             it.ItemName,
		"description":      it.Description,
		"price":            price,
		"compare_at_price": original,
		"stock_quantity":   it.StockInfoV2.SummaryInfo.TotalAvailableStock,
		"main_image":       mainImage,
		"is_active":        it.ItemStatus == "NORMAL",
		"external_data":    string(rawJSON),
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		return false, err
	}
	p.replaceImages(db, existing.ID, urls)
	return false, nil
}

func (p *shopeeProvider) replaceImages(db *gorm.DB, productID uuid.UUID, urls []string) {
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

// ─── helpers ──────────────────────────────────────────────────────────

func atoi64(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}
