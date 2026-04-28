package models

import "time"

// ContactComputed — atributos derivados materializados pra cada contato.
// Atualizados por cron (services/computed_cron.go) a cada 1h.
//
// Inspirado em Customer.io computed attributes. Usado em:
//   - Segments (filtrar "ltv > 1000")
//   - Liquid templates ({{contact.computed.ltv}})
//   - Dashboards (top spenders)
//
// Tabela 1:1 com Contact pra evitar bloat na tabela principal.
type ContactComputed struct {
	ContactID   string    `gorm:"type:uuid;primaryKey" json:"contact_id"`
	WorkspaceID string    `gorm:"type:uuid;not null;index" json:"workspace_id"`

	// Pedidos (Shop)
	OrdersTotal       int     `gorm:"default:0" json:"orders_total"`
	OrdersPaid        int     `gorm:"default:0" json:"orders_paid"`
	OrdersLast30d     int     `gorm:"default:0" json:"orders_last_30d"`
	LifetimeValue     float64 `gorm:"type:decimal(12,2);default:0" json:"lifetime_value"`
	AvgTicket         float64 `gorm:"type:decimal(12,2);default:0" json:"avg_ticket"`
	LastOrderAt       *time.Time `json:"last_order_at,omitempty"`
	FirstOrderAt      *time.Time `json:"first_order_at,omitempty"`

	// Conversas (Inbox)
	ConversationsTotal int `gorm:"default:0" json:"conversations_total"`
	ConversationsOpen  int `gorm:"default:0" json:"conversations_open"`
	MessagesInbound    int `gorm:"default:0" json:"messages_inbound"`
	MessagesOutbound   int `gorm:"default:0" json:"messages_outbound"`
	LastMessageAt      *time.Time `json:"last_message_at,omitempty"`

	// Pipeline (CRM)
	DealsOpen   int     `gorm:"default:0" json:"deals_open"`
	DealsWon    int     `gorm:"default:0" json:"deals_won"`
	DealsLost   int     `gorm:"default:0" json:"deals_lost"`
	DealsValue  float64 `gorm:"type:decimal(12,2);default:0" json:"deals_value"`

	// Cadência (Journey)
	JourneysActive    int `gorm:"default:0" json:"journeys_active"`
	JourneysCompleted int `gorm:"default:0" json:"journeys_completed"`

	UpdatedAt time.Time `json:"updated_at"`
}

func (ContactComputed) TableName() string { return "contact_computed" }
