package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Plan é o template de assinatura. Define limites quantitativos (Max*),
// flags de feature (Allow*) e os preços dos providers de pagamento
// (Stripe é prioritário; Asaas pode adaptar depois).
//
// Convenção: int(-1) = ilimitado em qualquer Max*.
type Plan struct {
	ID    uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	Name  string    `gorm:"not null" json:"name"`
	Slug  string    `gorm:"type:varchar(60);uniqueIndex" json:"slug"` // free / starter / pro / enterprise
	Price float64   `gorm:"not null;default:0" json:"price"`

	// ── Limites quantitativos ─────────────────────────────────────────
	MaxInstances      int `gorm:"not null;default:1" json:"max_instances"`
	MaxMessagesPerDay int `gorm:"not null;default:100" json:"max_messages_per_day"`
	MaxUsers          int `gorm:"not null;default:1" json:"max_users"`      // por workspace
	MaxWorkspaces     int `gorm:"not null;default:1" json:"max_workspaces"` // por user

	// Sub-limites por módulo. -1 = ilimitado, 0 = bloqueado.
	MaxAgents    int `gorm:"default:0" json:"max_agents"`     // agentes IA (instance agent)
	MaxJourneys  int `gorm:"default:0" json:"max_journeys"`   // automações
	MaxCampaigns int `gorm:"default:0" json:"max_campaigns"`  // campanhas em paralelo
	MaxTriggers  int `gorm:"default:0" json:"max_triggers"`   // autoresponders
	MaxWebhooks  int `gorm:"default:5" json:"max_webhooks"`   // total webhooks (instance + global)
	MaxContacts  int `gorm:"default:0" json:"max_contacts"`   // CRM (-1 = ilimitado)
	MaxDeals     int `gorm:"default:0" json:"max_deals"`      // pipeline

	// ── Feature flags (módulos liga/desliga) ──────────────────────────
	AllowAI            bool `gorm:"default:false" json:"allow_ai"`             // /agents, RAG, OpenRouter, MCP
	AllowJourneys      bool `gorm:"default:false" json:"allow_journeys"`       // /journeys
	AllowCRM           bool `gorm:"default:false" json:"allow_crm"`            // /crm/contacts/companies/deals
	AllowInbox         bool `gorm:"default:true"  json:"allow_inbox"`          // /inbox + queues + departments + SLA
	AllowCampaigns     bool `gorm:"default:false" json:"allow_campaigns"`      // /campaigns
	AllowTriggers      bool `gorm:"default:false" json:"allow_triggers"`       // Sprint 8 — keyword
	AllowWarmup        bool `gorm:"default:false" json:"allow_warmup"`         // Sprint 7 — anti-ban
	AllowNewsletters   bool `gorm:"default:false" json:"allow_newsletters"`    // Channels
	AllowCommunities   bool `gorm:"default:false" json:"allow_communities"`    // WhatsApp Communities
	AllowInstagram     bool `gorm:"default:false" json:"allow_instagram"`      // multi-canal IG
	AllowTikTok        bool `gorm:"default:false" json:"allow_tiktok"`         // multi-canal TikTok
	AllowAPIAccess     bool `gorm:"default:true"  json:"allow_api_access"`     // SDK REST + instance token
	AllowGlobalWebhook bool `gorm:"default:false" json:"allow_global_webhook"` // /webhooks/system (workspace-wide)

	// Proxy
	AllowShop          bool `gorm:"default:false" json:"allow_shop"`           // módulo /shops + /products
	AllowHelpDesk      bool `gorm:"column:allow_helpdesk;default:false" json:"allow_helpdesk"` // módulo /helpdesk
	AllowWebChat       bool `gorm:"column:allow_webchat;default:false" json:"allow_webchat"`   // widget de webchat
	MaxShops           int  `gorm:"default:0" json:"max_shops"`                // -1 ilimitado, 0 bloqueado
	MaxProducts        int  `gorm:"default:0" json:"max_products"`             // total de produtos por workspace
	MaxShopIntegrations int  `gorm:"default:0" json:"max_shop_integrations"`   // ex: Shopify + ML simultâneo

	AllowProxy            bool `gorm:"default:false" json:"allow_proxy"`             // proxy padrão
	AllowProxyResidencial bool `gorm:"default:false" json:"allow_proxy_residencial"` // residencial premium
	MaxInstancesPerProxy  int  `gorm:"default:0" json:"max_instances_per_proxy"`     // instâncias por entry
	MaxProxyPool          int  `gorm:"default:0" json:"max_proxy_pool"`              // total entries

	// ── Provider IDs ──────────────────────────────────────────────────
	StripePriceID  string `gorm:"type:varchar(255)" json:"stripe_price_id,omitempty"`
	AsaasProductID string `gorm:"type:varchar(255)" json:"asaas_product_id,omitempty"`

	// JSON livre pra atributos custom (display_order, color, badge, etc).
	// Não é usado pra autorização — só metadata UI.
	Features string `gorm:"type:text;default:'{}'" json:"features"`

	IsActive  bool      `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// FeatureKey é o catálogo de features verificáveis pelo middleware
// RequireFeature. Centralizar evita typo.
type FeatureKey string

const (
	FeatureAI            FeatureKey = "ai"
	FeatureJourneys      FeatureKey = "journeys"
	FeatureCRM           FeatureKey = "crm"
	FeatureInbox         FeatureKey = "inbox"
	FeatureCampaigns     FeatureKey = "campaigns"
	FeatureTriggers      FeatureKey = "triggers"
	FeatureWarmup        FeatureKey = "warmup"
	FeatureNewsletters   FeatureKey = "newsletters"
	FeatureCommunities   FeatureKey = "communities"
	FeatureInstagram     FeatureKey = "instagram"
	FeatureTikTok        FeatureKey = "tiktok"
	FeatureAPIAccess     FeatureKey = "api_access"
	FeatureGlobalWebhook FeatureKey = "global_webhook"
	FeatureProxy         FeatureKey = "proxy"
	FeatureProxyResidencial FeatureKey = "proxy_residencial"
	FeatureShop          FeatureKey = "shop"
	FeatureHelpDesk      FeatureKey = "helpdesk"
	FeatureWebChat       FeatureKey = "webchat"
)

// HasFeature retorna true se o plano libera a feature.
// Plano nil (user sem plano) cai no default (free) — acesso só
// a Inbox + APIAccess básicos.
func (p *Plan) HasFeature(key FeatureKey) bool {
	if p == nil {
		// Default conservador: free user só tem inbox e api access.
		return key == FeatureInbox || key == FeatureAPIAccess
	}
	switch key {
	case FeatureAI:
		return p.AllowAI
	case FeatureJourneys:
		return p.AllowJourneys
	case FeatureCRM:
		return p.AllowCRM
	case FeatureInbox:
		return p.AllowInbox
	case FeatureCampaigns:
		return p.AllowCampaigns
	case FeatureTriggers:
		return p.AllowTriggers
	case FeatureWarmup:
		return p.AllowWarmup
	case FeatureNewsletters:
		return p.AllowNewsletters
	case FeatureCommunities:
		return p.AllowCommunities
	case FeatureInstagram:
		return p.AllowInstagram
	case FeatureTikTok:
		return p.AllowTikTok
	case FeatureAPIAccess:
		return p.AllowAPIAccess
	case FeatureGlobalWebhook:
		return p.AllowGlobalWebhook
	case FeatureProxy:
		return p.AllowProxy
	case FeatureProxyResidencial:
		return p.AllowProxyResidencial
	case FeatureShop:
		return p.AllowShop
	case FeatureHelpDesk:
		return p.AllowHelpDesk
	case FeatureWebChat:
		return p.AllowWebChat
	}
	return false
}

// LimitFor retorna o limite numérico da feature (-1 = unlimited, 0 = bloqueado).
// Pra limites globais como MaxInstances/MaxMessagesPerDay, use os campos diretos.
func (p *Plan) LimitFor(key FeatureKey) int {
	if p == nil {
		return 0
	}
	switch key {
	case FeatureAI:
		return p.MaxAgents
	case FeatureJourneys:
		return p.MaxJourneys
	case FeatureCampaigns:
		return p.MaxCampaigns
	case FeatureTriggers:
		return p.MaxTriggers
	case FeatureGlobalWebhook:
		return p.MaxWebhooks
	case FeatureShop:
		return p.MaxShops
	}
	return -1
}

// Helpers de "ilimitado" pro shim numérico.
func (p *Plan) IsUnlimitedUsers() bool      { return p.MaxUsers == -1 }
func (p *Plan) IsUnlimitedWorkspaces() bool { return p.MaxWorkspaces == -1 }
func (p *Plan) IsUnlimitedInstances() bool  { return p.MaxInstances == -1 }
func (p *Plan) IsUnlimitedMessages() bool   { return p.MaxMessagesPerDay == -1 }

func (p *Plan) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
