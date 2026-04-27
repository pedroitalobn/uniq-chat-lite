package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Shop é uma loja virtual atrelada a um workspace e (opcionalmente) a uma
// instância. Pode ter integrações ativas com plataformas externas (Shopify,
// Mercado Livre, VTEX, etc.) ou ser self-managed (apenas catálogo próprio).
//
// Visibilidade:
//   - "private": só dono vê (UI interna)
//   - "link_only": acessível por link público <slug>.uniq.shop
//   - "public": indexado em diretório público (futuro)
type Shop struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	InstanceID  *uuid.UUID `gorm:"type:uuid;index" json:"instance_id,omitempty"` // opcional — atrela a 1 instância WhatsApp
	OwnerID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"owner_id"`     // user_id do dono (criador)

	Name        string `gorm:"type:varchar(180);not null" json:"name"`
	Slug        string `gorm:"type:varchar(80);uniqueIndex" json:"slug"`
	Description string `gorm:"type:text" json:"description,omitempty"`
	LogoURL     string `gorm:"type:text" json:"logo_url,omitempty"`
	BannerURL   string `gorm:"type:text" json:"banner_url,omitempty"`

	Currency       string `gorm:"type:varchar(3);default:'BRL'" json:"currency"`
	Visibility     string `gorm:"type:varchar(16);default:'private'" json:"visibility"` // private/link_only/public
	CustomDomain   string `gorm:"type:varchar(255)" json:"custom_domain,omitempty"`     // futuro

	// WhatsApp Business Catalog (Fase 5) — guarda o ID do catálogo na Meta
	// pra sync produto→catálogo + envio em mensagens interactive.
	WhatsAppCatalogID string `gorm:"type:varchar(120)" json:"whatsapp_catalog_id,omitempty"`

	// Configuração de checkout in-chat. JSON livre por enquanto — campos
	// como payment_methods, shipping_zones, tax_rules entram aqui depois.
	CheckoutConfig string `gorm:"type:text;default:'{}'" json:"checkout_config"`

	IsActive  bool      `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Shop) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.Currency == "" {
		s.Currency = "BRL"
	}
	if s.Visibility == "" {
		s.Visibility = "private"
	}
	return nil
}

// ProductType: physical/digital/service. Afeta UI (ex: physical exige
// estoque + frete; service não tem estoque, só agenda).
type ProductType string

const (
	ProductTypePhysical ProductType = "physical"
	ProductTypeDigital  ProductType = "digital" // ebook, curso, infoproduto
	ProductTypeService  ProductType = "service" // consultoria, atendimento
)

// Product é o item vendável. Pode ser self-managed ou sincronizado de uma
// integração externa (ExternalProvider + ExternalID identificam a fonte).
//
// Pra produtos com variantes (P/M/G × cor), Variants é populado e Stock/
// Price ficam nas variantes (Product.Stock vira a soma).
type Product struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	ShopID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"shop_id"`

	SKU         string      `gorm:"type:varchar(120);index" json:"sku,omitempty"`
	Name        string      `gorm:"type:varchar(255);not null" json:"name"`
	Slug        string      `gorm:"type:varchar(180);index" json:"slug"`
	Description string      `gorm:"type:text" json:"description,omitempty"`
	Type        ProductType `gorm:"type:varchar(20);default:'physical';index" json:"type"`

	// Pricing — Price é o atual; CompareAtPrice é o "de" (riscado).
	Price          float64 `gorm:"type:decimal(12,2);default:0" json:"price"`
	CompareAtPrice float64 `gorm:"type:decimal(12,2);default:0" json:"compare_at_price,omitempty"`
	CostPrice      float64 `gorm:"type:decimal(12,2);default:0" json:"cost_price,omitempty"` // pra margin reports
	Currency       string  `gorm:"type:varchar(3);default:'BRL'" json:"currency"`

	// Stock. Se TrackStock=false, mostra "ilimitado" (digital/serviço).
	StockQuantity int  `gorm:"default:0" json:"stock_quantity"`
	TrackStock    bool `gorm:"default:true" json:"track_stock"`
	AllowBackorder bool `gorm:"default:false" json:"allow_backorder"`

	// Mídia. MainImage é shortcut pro hero; Images[] é a galeria completa.
	MainImage string         `gorm:"type:text" json:"main_image,omitempty"`
	Images    []ProductImage `gorm:"foreignKey:ProductID" json:"images,omitempty"`

	// Categorização: M:N com ProductCategory; Tags em CSV simples.
	Categories []ProductCategory `gorm:"many2many:product_categories_products" json:"categories,omitempty"`
	Tags       string            `gorm:"type:varchar(500)" json:"tags,omitempty"` // CSV "novo,promo,frete-gratis"

	// Variantes (cor/tamanho). Vazio = produto simples.
	Variants []ProductVariant `gorm:"foreignKey:ProductID" json:"variants,omitempty"`

	// Atributos físicos pra cálculo de frete (só pra Type=physical).
	WeightGrams int `gorm:"default:0" json:"weight_grams,omitempty"`
	WidthMm     int `gorm:"default:0" json:"width_mm,omitempty"`
	HeightMm    int `gorm:"default:0" json:"height_mm,omitempty"`
	LengthMm    int `gorm:"default:0" json:"length_mm,omitempty"`

	// External provider — quando produto vem de Shopify/ML/VTEX/etc.
	ExternalProvider string `gorm:"type:varchar(30);index" json:"external_provider,omitempty"`
	ExternalID       string `gorm:"type:varchar(120);index" json:"external_id,omitempty"`
	ExternalData     string `gorm:"type:text" json:"-"` // cache do payload externo (debug)

	// JSON livre pra atributos custom da loja (cor, voltagem, autor, etc).
	Attributes string `gorm:"type:text;default:'{}'" json:"attributes"`

	IsActive   bool      `gorm:"default:true" json:"is_active"`
	IsFeatured bool      `gorm:"default:false" json:"is_featured"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (p *Product) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	if p.Currency == "" {
		p.Currency = "BRL"
	}
	if p.Type == "" {
		p.Type = ProductTypePhysical
	}
	return nil
}

// ProductVariant — uma combinação de opções (ex: "P / Vermelho"). SKU
// próprio + estoque + delta de preço relativo ao Product.Price.
type ProductVariant struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ProductID uuid.UUID `gorm:"type:uuid;not null;index" json:"product_id"`

	SKU            string  `gorm:"type:varchar(120)" json:"sku,omitempty"`
	Title          string  `gorm:"type:varchar(180)" json:"title"`             // ex: "P / Vermelho"
	Options        string  `gorm:"type:text;default:'{}'" json:"options"`      // JSON: {"size":"P","color":"vermelho"}
	PriceOverride  float64 `gorm:"type:decimal(12,2)" json:"price_override,omitempty"` // 0 = usa Product.Price
	StockQuantity  int     `gorm:"default:0" json:"stock_quantity"`
	ImageURL       string  `gorm:"type:text" json:"image_url,omitempty"`
	Position       int     `gorm:"default:0" json:"position"`

	ExternalID string `gorm:"type:varchar(120);index" json:"external_id,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (v *ProductVariant) BeforeCreate(tx *gorm.DB) error {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	return nil
}

// ProductImage — múltiplas imagens por produto, com ordem.
type ProductImage struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ProductID uuid.UUID `gorm:"type:uuid;not null;index" json:"product_id"`
	URL       string    `gorm:"type:text;not null" json:"url"`
	AltText   string    `gorm:"type:varchar(255)" json:"alt_text,omitempty"`
	Position  int       `gorm:"default:0" json:"position"`
	CreatedAt time.Time `json:"created_at"`
}

func (i *ProductImage) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}

// ProductCategory — árvore (parent_id self-ref). Slug único por workspace
// pra suportar "calçados/feminino" e "calçados/masculino".
type ProductCategory struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	ParentID    *uuid.UUID `gorm:"type:uuid;index" json:"parent_id,omitempty"`

	Name     string `gorm:"type:varchar(180);not null" json:"name"`
	Slug     string `gorm:"type:varchar(180);index" json:"slug"`
	ImageURL string `gorm:"type:text" json:"image_url,omitempty"`
	Position int    `gorm:"default:0" json:"position"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (c *ProductCategory) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// ShopIntegrationProvider — nomes canônicos dos providers suportados.
// Cada um tem seu próprio service em internal/services/shop/<provider>.go.
type ShopIntegrationProvider string

const (
	ShopProviderShopify     ShopIntegrationProvider = "shopify"
	ShopProviderMercadoLivre ShopIntegrationProvider = "mercado_livre"
	ShopProviderVTEX        ShopIntegrationProvider = "vtex"
	ShopProviderMagalu      ShopIntegrationProvider = "magalu"
	ShopProviderAmazon      ShopIntegrationProvider = "amazon"
	ShopProviderShopee      ShopIntegrationProvider = "shopee"
	ShopProviderWooCommerce ShopIntegrationProvider = "woocommerce"
	ShopProviderBigCommerce ShopIntegrationProvider = "bigcommerce"
	ShopProviderEbay        ShopIntegrationProvider = "ebay"
	ShopProviderWhatsApp    ShopIntegrationProvider = "whatsapp_catalog" // sync nosso → WA Business
)

// ShopIntegration é a configuração de uma fonte externa de produtos
// pra um Shop. Credenciais são encriptadas (futuro: usar AES via key
// no env). Por enquanto guardadas como JSON simples — TODO: encrypt.
type ShopIntegration struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ShopID uuid.UUID `gorm:"type:uuid;not null;index" json:"shop_id"`

	Provider ShopIntegrationProvider `gorm:"type:varchar(30);not null;index" json:"provider"`
	Name     string                  `gorm:"type:varchar(180)" json:"name"` // ex: "Minha loja Shopify principal"

	// Credenciais OAuth/API key — JSON serializado. Inclui access_token,
	// refresh_token, store_url/shop_domain, expires_at, etc.
	// TODO: encrypt at rest com chave do env.
	Credentials string `gorm:"type:text" json:"-"`

	// Config genérica (sync_frequency, default_category_id, mappings).
	Config string `gorm:"type:text;default:'{}'" json:"config"`

	IsActive     bool       `gorm:"default:true" json:"is_active"`
	LastSyncAt   *time.Time `json:"last_sync_at,omitempty"`
	LastSyncStatus string   `gorm:"type:varchar(20)" json:"last_sync_status,omitempty"` // success/failed/running
	LastSyncError  string   `gorm:"type:text" json:"last_sync_error,omitempty"`
	SyncedCount    int      `gorm:"default:0" json:"synced_count"` // quantos produtos sincronizados

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (i *ShopIntegration) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}

// OrderStatus reflete o ciclo de vida do pedido. Mapeamento por
// provider em services/shop/<provider>.go.
type OrderStatus string

const (
	OrderStatusPending   OrderStatus = "pending"
	OrderStatusPaid      OrderStatus = "paid"
	OrderStatusFulfilled OrderStatus = "fulfilled"
	OrderStatusShipped   OrderStatus = "shipped"
	OrderStatusDelivered OrderStatus = "delivered"
	OrderStatusCancelled OrderStatus = "cancelled"
	OrderStatusRefunded  OrderStatus = "refunded"
)

// Order — pedido criado in-chat (cart finalizado) ou recebido via
// webhook de provider externo. Conecta com Conversation/Agent/Journey/
// Campaign pra fechar o loop de atribuição de venda.
type Order struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ShopID uuid.UUID `gorm:"type:uuid;not null;index" json:"shop_id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`

	// Customer (pode ser contato CRM já existente OU lead novo)
	ContactID  *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`
	CustomerJID string    `gorm:"type:varchar(120);index" json:"customer_jid,omitempty"` // 5511...@s.whatsapp.net
	CustomerName string  `gorm:"type:varchar(255)" json:"customer_name,omitempty"`
	CustomerEmail string `gorm:"type:varchar(255)" json:"customer_email,omitempty"`
	CustomerPhone string `gorm:"type:varchar(40)" json:"customer_phone,omitempty"`

	OrderNumber string      `gorm:"type:varchar(40);index" json:"order_number"` // human-friendly: "U-0001"
	Status      OrderStatus `gorm:"type:varchar(20);default:'pending';index" json:"status"`

	// Items (JSON pra simplicidade — relacional vira OrderItem em Fase 2)
	ItemsJSON string `gorm:"type:text;default:'[]'" json:"items"`

	Subtotal float64 `gorm:"type:decimal(12,2)" json:"subtotal"`
	Shipping float64 `gorm:"type:decimal(12,2);default:0" json:"shipping"`
	Discount float64 `gorm:"type:decimal(12,2);default:0" json:"discount"`
	Total    float64 `gorm:"type:decimal(12,2)" json:"total"`
	Currency string  `gorm:"type:varchar(3);default:'BRL'" json:"currency"`

	PaymentMethod   string `gorm:"type:varchar(40)" json:"payment_method,omitempty"`     // pix, credit_card, boleto, ...
	PaymentStatus   string `gorm:"type:varchar(20)" json:"payment_status,omitempty"`     // pending/paid/failed
	PaymentProvider string `gorm:"type:varchar(40)" json:"payment_provider,omitempty"`   // stripe/asaas/mercado_pago/...
	PaymentExternalID string `gorm:"type:varchar(120)" json:"payment_external_id,omitempty"`

	ShippingAddressJSON string `gorm:"type:text" json:"shipping_address,omitempty"`
	BillingAddressJSON  string `gorm:"type:text" json:"billing_address,omitempty"`

	// Atribuição: qual conversa/agente/jornada/campanha gerou a venda?
	ConversationID *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`
	AgentID        *uuid.UUID `gorm:"type:uuid;index" json:"agent_id,omitempty"`
	JourneyID      *uuid.UUID `gorm:"type:uuid;index" json:"journey_id,omitempty"`
	CampaignID     *uuid.UUID `gorm:"type:uuid;index" json:"campaign_id,omitempty"`

	// Provider externo (Shopify/ML/etc)
	ExternalProvider  string `gorm:"type:varchar(30);index" json:"external_provider,omitempty"`
	ExternalOrderID   string `gorm:"type:varchar(120);index" json:"external_order_id,omitempty"`
	ExternalData      string `gorm:"type:text" json:"-"`

	Notes     string    `gorm:"type:text" json:"notes,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (o *Order) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	if o.Currency == "" {
		o.Currency = "BRL"
	}
	return nil
}

// Cart — carrinho efêmero in-chat. Persiste pra suportar abandoned-cart
// recovery (journey "abandoned_cart" reabre depois de N min sem fechar).
type Cart struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ShopID      uuid.UUID `gorm:"type:uuid;not null;index" json:"shop_id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	CustomerJID string    `gorm:"type:varchar(120);index:idx_cart_jid_shop,priority:1" json:"customer_jid"`
	ContactID   *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`

	ItemsJSON string  `gorm:"type:text;default:'[]'" json:"items"`
	Subtotal  float64 `gorm:"type:decimal(12,2)" json:"subtotal"`

	ConversationID *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`

	Status    string     `gorm:"type:varchar(20);default:'active';index" json:"status"` // active/abandoned/converted
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (c *Cart) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}
