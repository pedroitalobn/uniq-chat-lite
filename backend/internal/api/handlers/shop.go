package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services/shop"
	"gorm.io/gorm"
)

// ShopHandler concentra CRUD de Shop, Product, Category e ShopIntegration.
//
// Auth: todos os endpoints exigem JWT + workspace ativo (X-Workspace-ID).
// O middleware RequireFeature(FeatureShop) é aplicado no router pra
// gatear módulo inteiro pelo plano.
//
// Limite de count: criação de Shop/Product respeita Plan.MaxShops/MaxProducts.
type ShopHandler struct {
	db *gorm.DB
}

func NewShopHandler(db *gorm.DB) *ShopHandler {
	return &ShopHandler{db: db}
}

func (h *ShopHandler) workspaceID(c *fiber.Ctx) (uuid.UUID, error) {
	wsHdr := strings.TrimSpace(c.Get("X-Workspace-ID"))
	if wsHdr == "" {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "X-Workspace-ID é obrigatório")
	}
	id, err := uuid.Parse(wsHdr)
	if err != nil {
		return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "X-Workspace-ID inválido")
	}
	return id, nil
}

// slugify simples: lowercase + espaços→hífen + remove non-alnum.
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	out := make([]byte, 0, len(s))
	prevDash := false
	for _, ch := range s {
		switch {
		case ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9':
			out = append(out, byte(ch))
			prevDash = false
		case ch == ' ' || ch == '-' || ch == '_':
			if !prevDash {
				out = append(out, '-')
				prevDash = true
			}
		}
	}
	return strings.Trim(string(out), "-")
}

// ─── Shop CRUD ────────────────────────────────────────────────────────

// GET /v1/shops
func (h *ShopHandler) ListShops(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	var shops []models.Shop
	if err := h.db.Where("workspace_id = ?", wsID).Order("created_at DESC").Find(&shops).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": shops, "total": len(shops)})
}

// GET /v1/shops/:id
func (h *ShopHandler) GetShop(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var shop models.Shop
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&shop).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "shop não encontrado"})
	}
	return c.JSON(shop)
}

// POST /v1/shops
func (h *ShopHandler) CreateShop(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	user := getUserFromCtx(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	// Verificar limite do plano (MaxShops)
	if user.Plan != nil {
		limit := user.Plan.MaxShops
		if limit == 0 {
			return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{
				"error":       "feature_locked",
				"message":     "Seu plano não inclui criar lojas. Faça upgrade.",
				"upgrade_url": "/billing",
			})
		}
		if limit > 0 {
			var count int64
			h.db.Model(&models.Shop{}).Where("workspace_id = ?", wsID).Count(&count)
			if int(count) >= limit {
				return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{
					"error":       "limit_reached",
					"limit":       limit,
					"message":     "Você atingiu o limite de lojas do plano.",
					"upgrade_url": "/billing",
				})
			}
		}
	}

	var req struct {
		Name         string  `json:"name"`
		Slug         string  `json:"slug"`
		Description  string  `json:"description"`
		LogoURL      string  `json:"logo_url"`
		BannerURL    string  `json:"banner_url"`
		Currency     string  `json:"currency"`
		InstanceID   *string `json:"instance_id"`
		Visibility   string  `json:"visibility"`
		CustomDomain string  `json:"custom_domain"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	slug := req.Slug
	if slug == "" {
		slug = slugify(req.Name)
	}

	shop := models.Shop{
		WorkspaceID:  wsID,
		OwnerID:      user.ID,
		Name:         req.Name,
		Slug:         slug,
		Description:  req.Description,
		LogoURL:      req.LogoURL,
		BannerURL:    req.BannerURL,
		Currency:     req.Currency,
		Visibility:   req.Visibility,
		CustomDomain: req.CustomDomain,
		IsActive:     true,
	}
	if req.InstanceID != nil && *req.InstanceID != "" {
		if iid, err := uuid.Parse(*req.InstanceID); err == nil {
			shop.InstanceID = &iid
		}
	}
	if err := h.db.Create(&shop).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(shop)
}

// PATCH /v1/shops/:id
func (h *ShopHandler) UpdateShop(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var shop models.Shop
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&shop).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "shop não encontrado"})
	}
	var patch map[string]any
	if err := c.BodyParser(&patch); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	allowed := map[string]bool{
		"name": true, "description": true, "logo_url": true, "banner_url": true,
		"currency": true, "visibility": true, "custom_domain": true,
		"checkout_config": true, "is_active": true, "instance_id": true,
		"whatsapp_catalog_id": true,
	}
	updates := map[string]any{}
	for k, v := range patch {
		if allowed[k] {
			updates[k] = v
		}
	}
	if err := h.db.Model(&shop).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.First(&shop, "id = ?", shop.ID)
	return c.JSON(shop)
}

// DELETE /v1/shops/:id
func (h *ShopHandler) DeleteShop(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.Shop{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "shop não encontrado"})
	}
	return c.JSON(fiber.Map{"deleted": true})
}

// ─── Product CRUD ────────────────────────────────────────────────────

// GET /v1/shops/:shopId/products?limit=50&offset=0&q=texto&category=<id>
func (h *ShopHandler) ListProducts(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	shopID, err := uuid.Parse(c.Params("shopId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "shopId inválido"})
	}
	limit := c.QueryInt("limit", 50)
	if limit > 200 {
		limit = 200
	}
	offset := c.QueryInt("offset", 0)

	q := h.db.Model(&models.Product{}).Where("workspace_id = ? AND shop_id = ?", wsID, shopID)
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		q = q.Where("name ILIKE ? OR sku ILIKE ?", "%"+search+"%", "%"+search+"%")
	}
	if onlyActive := c.QueryBool("only_active", false); onlyActive {
		q = q.Where("is_active = ?", true)
	}
	var total int64
	q.Count(&total)
	var products []models.Product
	q.Preload("Images").Preload("Variants").Order("created_at DESC").Limit(limit).Offset(offset).Find(&products)
	return c.JSON(fiber.Map{"data": products, "total": total, "limit": limit, "offset": offset})
}

// GET /v1/shops/:shopId/products/:id
func (h *ShopHandler) GetProduct(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var product models.Product
	if err := h.db.Preload("Images").Preload("Variants").Preload("Categories").
		Where("id = ? AND workspace_id = ?", id, wsID).First(&product).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "produto não encontrado"})
	}
	return c.JSON(product)
}

// POST /v1/shops/:shopId/products
func (h *ShopHandler) CreateProduct(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	shopID, err := uuid.Parse(c.Params("shopId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "shopId inválido"})
	}
	user := getUserFromCtx(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	// Verifica MaxProducts do plano (count global do workspace).
	if user.Plan != nil && user.Plan.MaxProducts > 0 {
		var count int64
		h.db.Model(&models.Product{}).Where("workspace_id = ?", wsID).Count(&count)
		if int(count) >= user.Plan.MaxProducts {
			return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{
				"error":       "limit_reached",
				"limit":       user.Plan.MaxProducts,
				"message":     "Limite de produtos do plano atingido.",
				"upgrade_url": "/billing",
			})
		}
	}

	var req models.Product
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	req.WorkspaceID = wsID
	req.ShopID = shopID
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	}
	if req.Currency == "" {
		req.Currency = "BRL"
	}
	if err := h.db.Create(&req).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(req)
}

// PATCH /v1/shops/:shopId/products/:id
func (h *ShopHandler) UpdateProduct(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var product models.Product
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&product).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "produto não encontrado"})
	}
	var patch map[string]any
	if err := c.BodyParser(&patch); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	// Allow-list pra evitar cliente sobrescrever workspace_id/shop_id.
	allowed := map[string]bool{
		"name": true, "slug": true, "description": true, "type": true,
		"price": true, "compare_at_price": true, "cost_price": true, "currency": true,
		"sku": true, "stock_quantity": true, "track_stock": true, "allow_backorder": true,
		"main_image": true, "tags": true, "weight_grams": true, "width_mm": true,
		"height_mm": true, "length_mm": true, "attributes": true,
		"is_active": true, "is_featured": true,
	}
	updates := map[string]any{}
	for k, v := range patch {
		if allowed[k] {
			updates[k] = v
		}
	}
	if err := h.db.Model(&product).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.db.Preload("Images").Preload("Variants").First(&product, "id = ?", product.ID)
	return c.JSON(product)
}

// DELETE /v1/shops/:shopId/products/:id
func (h *ShopHandler) DeleteProduct(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.Product{})
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "produto não encontrado"})
	}
	return c.JSON(fiber.Map{"deleted": true})
}

// ─── Categories ──────────────────────────────────────────────────────

// GET /v1/shops/categories
func (h *ShopHandler) ListCategories(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	var cats []models.ProductCategory
	h.db.Where("workspace_id = ?", wsID).Order("position ASC, name ASC").Find(&cats)
	return c.JSON(fiber.Map{"data": cats, "total": len(cats)})
}

// POST /v1/shops/categories
func (h *ShopHandler) CreateCategory(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	var req models.ProductCategory
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	req.WorkspaceID = wsID
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	}
	if err := h.db.Create(&req).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(req)
}

// ─── Integrations CRUD ───────────────────────────────────────────────

// GET /v1/shops/:shopId/integrations
func (h *ShopHandler) ListIntegrations(c *fiber.Ctx) error {
	shopID, err := uuid.Parse(c.Params("shopId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "shopId inválido"})
	}
	var integrations []models.ShopIntegration
	h.db.Where("shop_id = ?", shopID).Order("created_at DESC").Find(&integrations)
	return c.JSON(fiber.Map{"data": integrations, "total": len(integrations)})
}

// POST /v1/shops/:shopId/integrations  — cria registro draft (sem credenciais).
// Pra OAuth, depois o cliente chama POST /integrations/:id/connect que retorna
// o auth_url do provider. Após callback, o webhook seta credenciais.
func (h *ShopHandler) CreateIntegration(c *fiber.Ctx) error {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return err
	}
	shopID, err := uuid.Parse(c.Params("shopId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "shopId inválido"})
	}
	// Confere ownership do shop
	var shop models.Shop
	if err := h.db.Where("id = ? AND workspace_id = ?", shopID, wsID).First(&shop).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "shop não encontrado"})
	}

	var req struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		Config   string `json:"config"`
	}
	if err := c.BodyParser(&req); err != nil || req.Provider == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'provider' é obrigatório"})
	}
	// Whitelist de providers conhecidos.
	switch models.ShopIntegrationProvider(req.Provider) {
	case models.ShopProviderShopify, models.ShopProviderMercadoLivre,
		models.ShopProviderVTEX, models.ShopProviderMagalu,
		models.ShopProviderAmazon, models.ShopProviderShopee,
		models.ShopProviderWooCommerce, models.ShopProviderBigCommerce,
		models.ShopProviderWhatsApp:
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider desconhecido"})
	}

	integ := models.ShopIntegration{
		ShopID:   shopID,
		Provider: models.ShopIntegrationProvider(req.Provider),
		Name:     req.Name,
		Config:   req.Config,
		IsActive: false, // ativa após OAuth callback
	}
	if integ.Config == "" {
		integ.Config = "{}"
	}
	if err := h.db.Create(&integ).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(integ)
}

// DELETE /v1/shops/:shopId/integrations/:id
func (h *ShopHandler) DeleteIntegration(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	res := h.db.Delete(&models.ShopIntegration{}, "id = ?", id)
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
	}
	return c.JSON(fiber.Map{"deleted": true})
}

// GET /v1/shops/integrations/providers — catálogo público dos providers
// suportados (UI mostra cards "Conectar Shopify", "Conectar VTEX", etc).
func (h *ShopHandler) ListProviders(c *fiber.Ctx) error {
	type provider struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Region      string `json:"region"`
		Description string `json:"description"`
		Status      string `json:"status"` // ready / coming_soon
	}
	providers := []provider{
		{ID: "shopify", Name: "Shopify", Region: "Global", Description: "Sincroniza produtos e pedidos via Admin API.", Status: "coming_soon"},
		{ID: "mercado_livre", Name: "Mercado Livre", Region: "BR / LATAM", Description: "Importa anúncios e recebe webhooks de pedidos.", Status: "coming_soon"},
		{ID: "vtex", Name: "VTEX", Region: "BR Enterprise", Description: "Catalog API + OMS — maior plataforma BR de grandes lojas.", Status: "coming_soon"},
		{ID: "magalu", Name: "Magazine Luiza Marketplace", Region: "BR", Description: "Marketplace BR — sync via API do parceiro.", Status: "coming_soon"},
		{ID: "shopee", Name: "Shopee", Region: "BR / SEA", Description: "Open Platform API.", Status: "coming_soon"},
		{ID: "amazon", Name: "Amazon SP-API", Region: "EUA / Global", Description: "Selling Partner API — catalog + orders.", Status: "coming_soon"},
		{ID: "woocommerce", Name: "WooCommerce", Region: "Global", Description: "REST API self-hosted (WordPress).", Status: "coming_soon"},
		{ID: "bigcommerce", Name: "BigCommerce", Region: "EUA / Global", Description: "Storefront + Catalog API.", Status: "coming_soon"},
		{ID: "whatsapp_catalog", Name: "WhatsApp Catalog", Region: "Global", Description: "Sincroniza produtos pro catálogo do WhatsApp Business.", Status: "coming_soon"},
	}
	return c.JSON(providers)
}

// ─── Integration ops (Fase 2) ────────────────────────────────────────

// findIntegration carrega integração + valida ownership do shop.
func (h *ShopHandler) findIntegration(c *fiber.Ctx) (*models.ShopIntegration, error) {
	wsID, err := h.workspaceID(c)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(c.Params("id"))
	if perr != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}
	var integ models.ShopIntegration
	if err := h.db.Joins("JOIN shops ON shops.id = shop_integrations.shop_id").
		Where("shop_integrations.id = ? AND shops.workspace_id = ?", id, wsID).
		First(&integ).Error; err != nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "integração não encontrada")
	}
	return &integ, nil
}

// POST /v1/shops/:shopId/integrations/:id/test — ping no provider.
func (h *ShopHandler) TestIntegration(c *fiber.Ctx) error {
	integ, err := h.findIntegration(c)
	if err != nil {
		return err
	}
	provider := shop.GetProvider(string(integ.Provider))
	if provider == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "provider_not_implemented",
			"message": "Esse provider ainda está em construção (coming_soon).",
		})
	}
	if err := provider.TestConnection(c.Context(), integ); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true})
}

// POST /v1/shops/:shopId/integrations/:id/sync — pull manual.
func (h *ShopHandler) SyncIntegration(c *fiber.Ctx) error {
	integ, err := h.findIntegration(c)
	if err != nil {
		return err
	}
	stats, syncErr := shop.RunSync(c.Context(), h.db, integ)
	if syncErr != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": syncErr.Error(), "stats": stats})
	}
	return c.JSON(fiber.Map{"success": true, "stats": stats})
}

// POST /v1/shops/:shopId/integrations/:id/connect — gera URL OAuth.
// Frontend abre num popup; provider redireciona pro callback abaixo.
func (h *ShopHandler) ConnectIntegration(c *fiber.Ctx) error {
	integ, err := h.findIntegration(c)
	if err != nil {
		return err
	}
	provider := shop.GetProvider(string(integ.Provider))
	if provider == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider_not_implemented"})
	}
	if provider.AuthMode() != shop.AuthOAuth2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "not_oauth",
			"message": "Esse provider usa API key, não OAuth. Use PATCH com credentials.",
		})
	}
	state := shop.GenerateOAuthState()
	// Persiste state no Config pra validar no callback.
	h.db.Model(integ).Update("config", `{"oauth_state":"`+state+`"}`)

	redirectURI := config.AppConfig.FrontendURL + "/integrations/shop/oauth/callback"
	authURL, err := provider.AuthorizeURL(c.Context(), integ, state, redirectURI)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"auth_url": authURL, "state": state})
}

// getUserFromCtx — helper que pega *models.User dos Locals com ambas as
// formas (ponteiro/valor) que diferentes middlewares usam.
func getUserFromCtx(c *fiber.Ctx) *models.User {
	raw := c.Locals("user")
	switch u := raw.(type) {
	case *models.User:
		return u
	case models.User:
		return &u
	}
	return nil
}
