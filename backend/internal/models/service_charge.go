package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ServiceCharge — cobrança de serviço extra ou avulso vendido pelo
// admin diretamente da área de Billing do user. Use-cases típicos:
//   - Implementação inicial / setup (one-off)
//   - Integração customizada (one-off ou recorrente)
//   - Hora de consultoria
//   - Pacote de mensagens/instâncias extras fora do plano
//   - Cobrança de overage (estouro de quota) faturada ao final do ciclo
//
// Provider-agnóstico: armazena qual provider foi usado pra emitir a
// cobrança (asaas/stripe/abacatepay) + o ID da cobrança lá. Status
// segue o ciclo de vida do provider (pending → paid → canceled/refunded).
type ServiceCharge struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID *uuid.UUID `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	// Quem criou a cobrança (admin/super-admin). Pra auditoria de quem
	// vendeu o serviço; pode ser nil quando criada pelo próprio cron
	// (ex: overage automatizado).
	CreatedByID *uuid.UUID `gorm:"type:uuid;index" json:"created_by_id,omitempty"`

	Name        string  `gorm:"type:varchar(160);not null" json:"name"`
	Description string  `gorm:"type:text" json:"description,omitempty"`
	Amount      float64 `gorm:"not null" json:"amount"`
	Currency    string  `gorm:"type:varchar(8);default:'BRL'" json:"currency"`
	// Category livre — "setup", "integration", "consulting", "overage",
	// "addon", etc. Frontend pode agrupar.
	Category string `gorm:"type:varchar(40);index" json:"category,omitempty"`

	// Recorrência opcional. Sem recurring_cycle → cobrança avulsa.
	// Com (ex: "MONTHLY") + recurring_count → assinatura limitada.
	RecurringCycle string `gorm:"type:varchar(20)" json:"recurring_cycle,omitempty"`
	RecurringCount int    `gorm:"default:0" json:"recurring_count,omitempty"`

	// Provider que processa a cobrança + IDs no provider.
	Provider           string `gorm:"type:varchar(20);index" json:"provider"` // asaas|stripe|abacatepay
	ProviderChargeID   string `gorm:"type:varchar(128)" json:"provider_charge_id,omitempty"`
	ProviderCheckoutID string `gorm:"type:varchar(128)" json:"provider_checkout_id,omitempty"`
	InvoiceURL         string `gorm:"type:text" json:"invoice_url,omitempty"`

	// Ciclo de vida observável pela UI.
	Status string `gorm:"type:varchar(20);default:'pending';index" json:"status"` // pending|sent|paid|canceled|refunded|failed

	SentByEmail bool       `gorm:"default:false" json:"sent_by_email"`
	PaidAt      *time.Time `json:"paid_at,omitempty"`
	CanceledAt  *time.Time `json:"canceled_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *ServiceCharge) BeforeCreate(_ *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.Currency == "" {
		s.Currency = "BRL"
	}
	if s.Status == "" {
		s.Status = "pending"
	}
	return nil
}
