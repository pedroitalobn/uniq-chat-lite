package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─── Sistema de Consumo (Usage / Credits) ────────────────────────────────────
//
// Modelo de 5 tabelas + extensões em Plan:
//
//   1. usage_events    — fato append-only. Toda ação consumível grava aqui.
//   2. usage_quotas    — agregado rolling por USER (account-wide).
//   3. workspace_quotas— agregado rolling por WORKSPACE (sub-pool).
//   4. usage_topups    — top-ups comprados (account ou workspace).
//   5. pricing_configs — singleton com tabela de custo + margem (super admin
//      edita pra ajustar precificação dinamicamente).
//
// Conversão de unidade unificada: CRÉDITOS.
//   - Usuário final só vê créditos nos painéis (UI familiar tipo Claude Code).
//   - 1 crédito ~ $0.001 USD (configurável via PricingConfig.CreditUnitMicros).
//   - Cada evento computa custo em créditos = raw_cost_micros *
//     (100 + margin_pct) / 100 / credit_unit_micros.
//   - Margem é dinâmica por tipo de recurso (ai/voice/message/proxy)
//     pra super admin ajustar margem de qualquer um sem mexer nos outros.
//
// Hierarquia de saldo:
//   - Account (User) tem allowance mensal vindo do Plan + topups.
//   - Workspace pode ter sub-pool: alocado pelo dono da conta OU comprado
//     diretamente pelo workspace.
//   - Consumo de um workspace tenta primeiro o pool dele, depois cai pro
//     pool da conta. Free plan zera allowance = 100% PAYG.
//
// Soft stop: quando esgota AI, só AI bloqueia (mensagens seguem). Cada tipo
// de recurso tem hard_stopped_at independente.

// UsageEventType cataloga os tipos de eventos consumíveis. Centraliza pra
// evitar typo nos call sites.
type UsageEventType string

const (
	EventAITokens          UsageEventType = "ai.tokens"          // LLM tokens (input+output combinados na quantity)
	EventVoiceTTSChars     UsageEventType = "voice.tts_chars"    // chars sintetizados em TTS
	EventVoiceSTTSeconds   UsageEventType = "voice.stt_seconds"  // segundos de áudio transcritos
	EventMessageOutbound   UsageEventType = "message.outbound"   // msg saída pelo canal
	EventMessageInbound    UsageEventType = "message.inbound"    // msg recebida (geralmente custo zero)
	EventInstanceDay       UsageEventType = "instance.day"       // 1 evento/dia/instância ativa (cron)
	EventProxyBytes        UsageEventType = "proxy.bytes"        // bytes trafegados (fase 5)
	EventCampaignRecipient UsageEventType = "campaign.recipient" // disparo de campanha por destinatário
)

// UsageEventCategory agrupa eventos pra UI/quota. AI/Voice/Message são as
// categorias principais que viram colunas no quotas (independentes).
type UsageEventCategory string

const (
	CategoryAI      UsageEventCategory = "ai"
	CategoryVoice   UsageEventCategory = "voice"
	CategoryMessage UsageEventCategory = "message"
	CategoryProxy   UsageEventCategory = "proxy"
	CategoryOther   UsageEventCategory = "other"
)

// CategoryFor retorna a categoria de um event_type — usado pra atualizar
// a coluna correta em usage_quotas/workspace_quotas.
func CategoryFor(t UsageEventType) UsageEventCategory {
	switch t {
	case EventAITokens:
		return CategoryAI
	case EventVoiceTTSChars, EventVoiceSTTSeconds:
		return CategoryVoice
	case EventMessageOutbound, EventMessageInbound, EventCampaignRecipient:
		return CategoryMessage
	case EventProxyBytes:
		return CategoryProxy
	}
	return CategoryOther
}

// UsageEvent — tabela de fato (append-only). Toda ação consumível grava
// 1 linha. Index por (user_id, period_yyyymm) e (event_type, period_yyyymm)
// pra agregação rápida no painel.
//
// Nunca atualiza/deleta linhas existentes — auditável e fácil de re-agregar
// se acharmos bug em ComputeCredits.
type UsageEvent struct {
	ID            uuid.UUID          `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID          `gorm:"type:uuid;not null;index:idx_usage_events_user_period,priority:1" json:"user_id"`
	WorkspaceID   *uuid.UUID         `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	EventType     UsageEventType     `gorm:"type:varchar(40);not null;index:idx_usage_events_type_period,priority:1" json:"event_type"`
	Category      UsageEventCategory `gorm:"type:varchar(20);not null;index" json:"category"`
	// Resource — provider/model/voice_id/instance_id pra granularidade
	// na agregação por provider. Ex: "openai:gpt-4o", "elevenlabs:rachel".
	Resource string `gorm:"type:varchar(100)" json:"resource,omitempty"`
	// Quantity — em UNIDADE NATIVA do recurso:
	//   ai.tokens        → tokens (input+output somados)
	//   voice.tts_chars  → chars
	//   voice.stt_seconds→ segundos
	//   message.*        → 1 por mensagem
	//   proxy.bytes      → bytes
	Quantity int64 `gorm:"not null" json:"quantity"`
	// CostUsdMicro — custo REAL ao Uniq em USD micros (1 USD = 1_000_000).
	// Usado pro dashboard global do super admin (quanto a Uniq paga aos
	// providers). NÃO é o que o user paga — esse é o credits abaixo.
	CostUsdMicro int64 `gorm:"not null;default:0" json:"cost_usd_micro"`
	// Credits — custo cobrado do user (cost_usd_micro * margem / unit).
	// Soft int — pode ser 0 pra eventos free (ex: message inbound).
	Credits int64 `gorm:"not null;default:0" json:"credits"`
	// IsOverage — true quando a allowance acabou e o evento foi gravado
	// como overage (cobrado extra no fim do ciclo).
	IsOverage bool `gorm:"default:false;index" json:"is_overage"`
	// Period — primeiro dia do ciclo (anniversary-based, NÃO calendar).
	// Permite filtrar consumo do ciclo atual sem JOIN com user.
	PeriodStart time.Time `gorm:"index:idx_usage_events_user_period,priority:2;index:idx_usage_events_type_period,priority:2" json:"period_start"`
	Metadata    string    `gorm:"type:text;default:'{}'" json:"metadata,omitempty"`
	OccurredAt  time.Time `gorm:"index" json:"occurred_at"`
	CreatedAt   time.Time `json:"created_at"`
}

func (e *UsageEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.OccurredAt.IsZero() {
		e.OccurredAt = time.Now()
	}
	return nil
}

func (UsageEvent) TableName() string { return "usage_events" }

// UsageQuota — agregado rolling por USER (account-wide). Atualizado
// atomicamente ao gravar UsageEvent. Uma linha por (user_id, period_start).
// Reseta criando linha nova quando o user inicia novo ciclo (Plan
// anniversary-based).
//
// hard_stopped_at é per-categoria pro soft-stop: quando AI esgota e
// overage_allowed=false, gravamos timestamp em ai_hard_stopped_at e
// CanConsume(ai) retorna false. Mas voice/message seguem normais.
type UsageQuota struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_usage_quotas_user_period,priority:1" json:"user_id"`
	PeriodStart time.Time  `gorm:"not null;uniqueIndex:idx_usage_quotas_user_period,priority:2" json:"period_start"`
	PeriodEnd   time.Time  `gorm:"not null" json:"period_end"`

	// Allowance — vem do Plan no início do ciclo (snapshot, pra evitar
	// que mudança de plano no meio do ciclo afete consumo já feito).
	AICreditsLimit      int64 `gorm:"not null;default:0" json:"ai_credits_limit"`
	VoiceCreditsLimit   int64 `gorm:"not null;default:0" json:"voice_credits_limit"`
	MessageCreditsLimit int64 `gorm:"not null;default:0" json:"message_credits_limit"`

	// Used — incrementado a cada UsageEvent. Pode ultrapassar Limit se
	// overage_allowed=true. Cap-ish: race conditions podem ultrapassar
	// um pouco em bursts (gravamos warning mas seguimos).
	AICreditsUsed      int64 `gorm:"not null;default:0" json:"ai_credits_used"`
	VoiceCreditsUsed   int64 `gorm:"not null;default:0" json:"voice_credits_used"`
	MessageCreditsUsed int64 `gorm:"not null;default:0" json:"message_credits_used"`

	// Topups — comprados extra (não resetam no ciclo seguinte). Somam
	// na disponibilidade total: limit + topup - used.
	AITopupCredits      int64 `gorm:"not null;default:0" json:"ai_topup_credits"`
	VoiceTopupCredits   int64 `gorm:"not null;default:0" json:"voice_topup_credits"`
	MessageTopupCredits int64 `gorm:"not null;default:0" json:"message_topup_credits"`

	// Overage — quando user ativou "deixar passar" e estourou limit+topup.
	// Cobrado em fatura no fim do ciclo.
	OverageAllowed         bool  `gorm:"not null;default:false" json:"overage_allowed"`
	AIOverageCredits       int64 `gorm:"not null;default:0" json:"ai_overage_credits"`
	VoiceOverageCredits    int64 `gorm:"not null;default:0" json:"voice_overage_credits"`
	MessageOverageCredits  int64 `gorm:"not null;default:0" json:"message_overage_credits"`
	OverageCentsAccumulated int64 `gorm:"not null;default:0" json:"overage_cents_accumulated"`

	// Notificação progressiva — flags evitam mandar 100 emails do mesmo
	// alerta. Setados na primeira vez que cruza cada threshold.
	NotifiedAt50  *time.Time `json:"notified_at_50,omitempty"`
	NotifiedAt80  *time.Time `json:"notified_at_80,omitempty"`
	NotifiedAt95  *time.Time `json:"notified_at_95,omitempty"`
	NotifiedAt100 *time.Time `json:"notified_at_100,omitempty"`

	// Hard stop por categoria (soft stop pattern) — quando seta, esse
	// tipo bloqueia. Demais tipos seguem normais. Limpa no início do
	// próximo ciclo OU ao recarregar topup.
	AIHardStoppedAt      *time.Time `json:"ai_hard_stopped_at,omitempty"`
	VoiceHardStoppedAt   *time.Time `json:"voice_hard_stopped_at,omitempty"`
	MessageHardStoppedAt *time.Time `json:"message_hard_stopped_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (q *UsageQuota) BeforeCreate(tx *gorm.DB) error {
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	return nil
}

func (UsageQuota) TableName() string { return "usage_quotas" }

// AICreditsAvailable — saldo restante (positivo) do tipo. Negativo se
// estourou e está em overage.
func (q *UsageQuota) AICreditsAvailable() int64 {
	return q.AICreditsLimit + q.AITopupCredits - q.AICreditsUsed
}
func (q *UsageQuota) VoiceCreditsAvailable() int64 {
	return q.VoiceCreditsLimit + q.VoiceTopupCredits - q.VoiceCreditsUsed
}
func (q *UsageQuota) MessageCreditsAvailable() int64 {
	return q.MessageCreditsLimit + q.MessageTopupCredits - q.MessageCreditsUsed
}

// WorkspaceQuota — sub-pool por workspace. Conta-mãe pode alocar parte do
// allowance dela pra um workspace específico (limite de gasto), e/ou o
// workspace pode comprar topups isolados.
//
// Resolução de saldo no consumo:
//   1. Tenta workspace.topup_<categoria>
//   2. Tenta workspace.allocated_<categoria>
//   3. Cai pro account (UsageQuota do user)
//
// Sem workspace_quota row → workspace usa account direto. Criar a row é
// opcional, só pra controle granular.
type WorkspaceQuota struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_ws_quotas_period,priority:1" json:"workspace_id"`
	PeriodStart time.Time  `gorm:"not null;uniqueIndex:idx_ws_quotas_period,priority:2" json:"period_start"`
	PeriodEnd   time.Time  `gorm:"not null" json:"period_end"`

	// Alocado pela conta-mãe (User dono) — sai do allowance dela.
	AICreditsAllocated      int64 `gorm:"not null;default:0" json:"ai_credits_allocated"`
	VoiceCreditsAllocated   int64 `gorm:"not null;default:0" json:"voice_credits_allocated"`
	MessageCreditsAllocated int64 `gorm:"not null;default:0" json:"message_credits_allocated"`

	// Comprado direto pelo workspace via top-up isolado.
	AITopupCredits      int64 `gorm:"not null;default:0" json:"ai_topup_credits"`
	VoiceTopupCredits   int64 `gorm:"not null;default:0" json:"voice_topup_credits"`
	MessageTopupCredits int64 `gorm:"not null;default:0" json:"message_topup_credits"`

	// Used dentro deste workspace.
	AICreditsUsed      int64 `gorm:"not null;default:0" json:"ai_credits_used"`
	VoiceCreditsUsed   int64 `gorm:"not null;default:0" json:"voice_credits_used"`
	MessageCreditsUsed int64 `gorm:"not null;default:0" json:"message_credits_used"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (q *WorkspaceQuota) BeforeCreate(tx *gorm.DB) error {
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	return nil
}

func (WorkspaceQuota) TableName() string { return "workspace_quotas" }

// UsageTopup — registro de top-up comprado. Pode ser scope=account
// (somam em UsageQuota.*TopupCredits) ou scope=workspace (somam em
// WorkspaceQuota.*TopupCredits).
type UsageTopup struct {
	ID            uuid.UUID          `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID          `gorm:"type:uuid;not null;index" json:"user_id"`
	WorkspaceID   *uuid.UUID         `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	Scope         string             `gorm:"type:varchar(20);not null" json:"scope"` // "account" | "workspace"
	Category      UsageEventCategory `gorm:"type:varchar(20);not null" json:"category"`
	CreditsAmount int64              `gorm:"not null" json:"credits_amount"`
	PriceCents    int64              `gorm:"not null" json:"price_cents"`
	StripeInvoiceID string           `gorm:"type:varchar(100);index" json:"stripe_invoice_id,omitempty"`
	Status        string             `gorm:"type:varchar(20);not null;default:'pending'" json:"status"` // pending | paid | refunded | failed
	CreatedAt     time.Time          `json:"created_at"`
	PaidAt        *time.Time         `json:"paid_at,omitempty"`
}

func (t *UsageTopup) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

func (UsageTopup) TableName() string { return "usage_topups" }

// PricingConfig — singleton. Define custo bruto que o Uniq paga aos
// providers + margem (em %) aplicada por categoria pra computar créditos
// cobrados do user.
//
// Margem é dinâmica: super admin altera margin_pct_ai e o impacto é
// imediato em todos os events futuros — não invalida events passados,
// só muda o pricing dos novos.
//
// Default seedado no AutoMigrate (createDefaultPricingIfMissing) com
// valores conservadores baseados em pricing público dos providers.
type PricingConfig struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`

	// CreditUnitMicros — quantos USD micros valem 1 crédito (apos margem).
	// Default: 1000 = $0.001 USD por crédito.
	// Mais baixo = créditos vão mais rápido (UI mostra números maiores);
	// mais alto = créditos duram mais (números menores). Escolha de UX.
	CreditUnitMicros int64 `gorm:"not null;default:1000" json:"credit_unit_micros"`

	// Margem em PERCENT por categoria. 100 = user paga 2x o custo bruto
	// (margem 100%). 0 = user paga exatamente o custo bruto (sem lucro).
	// 50 = user paga 1.5x.
	MarginPctAI      int `gorm:"not null;default:100" json:"margin_pct_ai"`
	MarginPctVoice   int `gorm:"not null;default:100" json:"margin_pct_voice"`
	MarginPctMessage int `gorm:"not null;default:100" json:"margin_pct_message"`
	MarginPctProxy   int `gorm:"not null;default:50"  json:"margin_pct_proxy"`

	// LLM cost matrix — JSON map {provider:model -> {input_per_1k, output_per_1k}}
	// em USD micros. Ex:
	//   { "openai:gpt-4o": {"in": 2500, "out": 10000} }
	// Vazio = usa LLMDefaultCostUsdMicroPer1kTokens pra qualquer chamada.
	LLMCostMatrix string `gorm:"type:text;default:'{}'" json:"llm_cost_matrix,omitempty"`

	// Defaults usados quando não acha entrada na matrix (USD micros).
	LLMDefaultInputCostPer1k  int64 `gorm:"not null;default:3000"  json:"llm_default_input_cost_per_1k"`  // ~$3/1M
	LLMDefaultOutputCostPer1k int64 `gorm:"not null;default:15000" json:"llm_default_output_cost_per_1k"` // ~$15/1M

	// TTS / STT cost defaults (USD micros).
	// ElevenLabs ~$0.30/1k chars no Creator tier, $0.18 no Pro.
	// OpenAI TTS-1 = $15/1M chars = 15 micros/1k.
	TTSDefaultCostPer100Chars int64 `gorm:"not null;default:300"   json:"tts_default_cost_per_100_chars"` // ~$3/1M chars
	// Whisper API: $0.006 / minuto = $0.0001 / segundo = 100 micros/sec.
	STTDefaultCostPerSecond int64 `gorm:"not null;default:100" json:"stt_default_cost_per_second"`

	// Mensagens — custo direto da plataforma (anti-spam, infra). Cobramos
	// independente de provider externo. WABA mkt template é mais caro
	// porque a Meta cobra por conversation.
	MessageOutboundQRCost     int64 `gorm:"not null;default:50"   json:"message_outbound_qr_cost"`     // 0.05 cent
	MessageOutboundWABAUtil   int64 `gorm:"not null;default:500"  json:"message_outbound_waba_util"`   // 0.5 cent
	MessageOutboundWABAMkt    int64 `gorm:"not null;default:5000" json:"message_outbound_waba_mkt"`    // 5 cents
	MessageInboundCost        int64 `gorm:"not null;default:0"    json:"message_inbound_cost"`         // free

	ProxyDefaultCostPer100MB int64 `gorm:"not null;default:1000" json:"proxy_default_cost_per_100_mb"` // ~$0.01/100MB

	// Top-up packs publicados pra venda (JSON array).
	// [{"category":"ai","credits":10000,"price_cents":1990,"label":"10k AI por R$19,90"}]
	TopupPacks string `gorm:"type:text;default:'[]'" json:"topup_packs,omitempty"`

	UpdatedAt time.Time      `json:"updated_at"`
	CreatedAt time.Time      `json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (p *PricingConfig) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

func (PricingConfig) TableName() string { return "pricing_configs" }
