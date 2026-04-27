package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TriggerMatchMode controla COMO o keyword bate com a mensagem inbound.
type TriggerMatchMode string

const (
	TriggerMatchExact     TriggerMatchMode = "exact"     // texto idêntico (case-insensitive)
	TriggerMatchContains  TriggerMatchMode = "contains"  // substring
	TriggerMatchStartWith TriggerMatchMode = "starts"    // começa com
	TriggerMatchRegex     TriggerMatchMode = "regex"     // regex livre (cuidado)
)

// TriggerAction é o que disparar quando bate.
type TriggerAction string

const (
	TriggerActionReply       TriggerAction = "reply"        // texto fixo
	TriggerActionForwardAI   TriggerAction = "forward_ai"   // encaminha pro agente IA
	TriggerActionTag         TriggerAction = "tag"          // adiciona tag/label no contato
	TriggerActionStartJourney TriggerAction = "start_journey" // dispara uma journey
)

// Trigger é um autoresponder simples por keyword. Existe pra clientes
// não-técnicos terem reply automático sem aprender o journey builder.
//
// Avaliado em ordem de Priority (asc) — primeiro match dispara e os
// demais são ignorados (a não ser que MultiMatch=true). Cooldown evita
// loop quando o cliente fica repetindo a keyword.
type Trigger struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	InstanceID *uuid.UUID `gorm:"type:uuid;index" json:"instance_id,omitempty"` // nil = todas as instâncias do workspace
	Name       string     `gorm:"not null" json:"name"`
	IsActive   bool       `gorm:"default:true" json:"is_active"`

	// Match
	Keyword   string           `gorm:"not null" json:"keyword"`
	MatchMode TriggerMatchMode `gorm:"type:varchar(16);default:'contains'" json:"match_mode"`
	CaseSensitive bool         `gorm:"default:false" json:"case_sensitive"`

	// Action
	Action TriggerAction `gorm:"type:varchar(20);not null" json:"action"`
	// Para "reply": texto da resposta. Para "forward_ai": pode opcionalmente
	// fixar um agente específico (UUID); senão usa o default da instância.
	// Para "tag": nome da tag. Para "start_journey": UUID da journey.
	Payload string `gorm:"type:text" json:"payload"`

	// Comportamento
	Priority    int           `gorm:"default:100" json:"priority"`            // menor = mais prioritário
	MultiMatch  bool          `gorm:"default:false" json:"multi_match"`       // se true, não para no primeiro match
	CooldownSec int           `gorm:"default:300" json:"cooldown_sec"`        // segundos por contato
	OnlyDirect  bool          `gorm:"default:true" json:"only_direct"`        // ignora grupos
	HitCount    int           `gorm:"default:0" json:"hit_count"`             // estatística
	LastHitAt   *time.Time    `json:"last_hit_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (t *Trigger) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	if t.MatchMode == "" {
		t.MatchMode = TriggerMatchContains
	}
	if t.CooldownSec == 0 {
		t.CooldownSec = 300
	}
	if t.Priority == 0 {
		t.Priority = 100
	}
	return nil
}

// TriggerFire registra cada disparo de trigger pra evitar
// hammering (cooldown) e gerar relatório de uso.
type TriggerFire struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	TriggerID  uuid.UUID `gorm:"type:uuid;not null;index" json:"trigger_id"`
	ContactJID string    `gorm:"type:varchar(100);not null;index" json:"contact_jid"`
	FiredAt    time.Time `gorm:"index" json:"fired_at"`
}

func (f *TriggerFire) BeforeCreate(tx *gorm.DB) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	if f.FiredAt.IsZero() {
		f.FiredAt = time.Now()
	}
	return nil
}
