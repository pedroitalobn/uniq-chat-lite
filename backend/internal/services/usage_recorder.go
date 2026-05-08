package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/uniq-chat/backend/internal/models"
)

// UsageRecorder — extensão do UsageService antigo (UsageCounter) pro
// sistema de créditos. Diferenças importantes:
//
//   • UsageCounter (legado) → contava só mensagens enviadas, sem custo.
//     Mantido em paralelo (rate-limit anti-spam diário continua usando).
//
//   • UsageRecorder (este)  → fato detalhado em usage_events + agregado
//     atomic em usage_quotas (account) + workspace_quotas (sub-pool).
//     Cobra créditos com margem dinâmica via PricingConfig.
//
// Não é setter/singleton ainda — passamos via DI nos call sites
// (LLMService, TTSService, etc.) pra evitar acoplamento global e poder
// stub em testes.
type UsageRecorder struct {
	db *gorm.DB

	// Cache do PricingConfig (re-fetch a cada 5min). Super admin pode
	// editar a margem na UI e queremos refletir rápido sem hit no DB
	// em cada evento.
	pricingMu  sync.RWMutex
	pricing    *models.PricingConfig
	pricingAt  time.Time
}

func NewUsageRecorder(db *gorm.DB) *UsageRecorder {
	return &UsageRecorder{db: db}
}

// ─── Pricing ─────────────────────────────────────────────────────────

// pricing devolve a config atual (cacheada). Se nunca carregou ou >5min
// passou, re-fetch. Cria default no DB se estiver vazio (idempotente).
func (r *UsageRecorder) pricing0(ctx context.Context) *models.PricingConfig {
	r.pricingMu.RLock()
	if r.pricing != nil && time.Since(r.pricingAt) < 5*time.Minute {
		p := r.pricing
		r.pricingMu.RUnlock()
		return p
	}
	r.pricingMu.RUnlock()

	r.pricingMu.Lock()
	defer r.pricingMu.Unlock()
	// Double-check após lock
	if r.pricing != nil && time.Since(r.pricingAt) < 5*time.Minute {
		return r.pricing
	}
	var p models.PricingConfig
	err := r.db.WithContext(ctx).Order("created_at ASC").First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Seed default. AutoMigrate cria a tabela vazia.
		p = models.PricingConfig{}
		if err := r.db.Create(&p).Error; err != nil {
			log.Error().Err(err).Msg("usage: falha ao seedar PricingConfig — usando in-memory")
		}
	} else if err != nil {
		log.Error().Err(err).Msg("usage: falha ao carregar PricingConfig — usando in-memory")
	}
	r.pricing = &p
	r.pricingAt = time.Now()
	return r.pricing
}

// invalidatePricing — chamar quando admin editar config pra refletir já.
func (r *UsageRecorder) InvalidatePricing() {
	r.pricingMu.Lock()
	r.pricing = nil
	r.pricingAt = time.Time{}
	r.pricingMu.Unlock()
}

// ─── Compute credits ───────────────────────────────────────────────────

// ComputeRequest agrupa parâmetros pra calcular custo de um evento antes
// de gravá-lo. Caller passa quantity em unidade nativa + provider/model
// pra resolver custo via matrix da PricingConfig.
type ComputeRequest struct {
	EventType models.UsageEventType
	Quantity  int64  // unidade nativa: tokens, chars, segundos, bytes, count
	Resource  string // "openai:gpt-4o", "elevenlabs", "whatsapp_qr", etc.
	// Pra LLM: separa input/output pra precificação assimétrica
	InputTokens  int64
	OutputTokens int64
}

// ComputedCost — resultado: o que Uniq paga (USD micros) e o que cobra
// do user (créditos).
type ComputedCost struct {
	CostUsdMicro int64
	Credits      int64
}

// ComputeCredits resolve raw_cost via PricingConfig + aplica margem da
// categoria + converte pra créditos. Retorna {CostUsdMicro, Credits}.
//
// Se PricingConfig falha (DB), retorna 0/0 — caller decide se loga.
// Eventos com 0 créditos ainda são gravados (auditoria) mas não bloqueiam.
func (r *UsageRecorder) ComputeCredits(ctx context.Context, req ComputeRequest) ComputedCost {
	cfg := r.pricing0(ctx)
	if cfg == nil {
		return ComputedCost{}
	}

	rawMicros := r.rawCostMicros(cfg, req)
	if rawMicros <= 0 {
		return ComputedCost{}
	}

	marginPct := r.marginPctFor(cfg, models.CategoryFor(req.EventType))
	finalMicros := rawMicros * int64(100+marginPct) / 100

	unit := cfg.CreditUnitMicros
	if unit <= 0 {
		unit = 1000
	}
	credits := finalMicros / unit
	if credits == 0 && finalMicros > 0 {
		credits = 1 // mínimo 1 crédito por evento cobrado
	}

	return ComputedCost{CostUsdMicro: rawMicros, Credits: credits}
}

func (r *UsageRecorder) marginPctFor(cfg *models.PricingConfig, cat models.UsageEventCategory) int {
	switch cat {
	case models.CategoryAI:
		return cfg.MarginPctAI
	case models.CategoryVoice:
		return cfg.MarginPctVoice
	case models.CategoryMessage:
		return cfg.MarginPctMessage
	case models.CategoryProxy:
		return cfg.MarginPctProxy
	}
	return cfg.MarginPctAI
}

// rawCostMicros — custo BRUTO em USD micros (antes de margem).
// LLM: usa matrix por modelo se existir, senão default in/out.
// Voice TTS: por 100 chars. STT: por segundo. Mensagem: tabela direta.
func (r *UsageRecorder) rawCostMicros(cfg *models.PricingConfig, req ComputeRequest) int64 {
	switch req.EventType {
	case models.EventAITokens:
		inCost, outCost := r.llmRatesFor(cfg, req.Resource)
		// Se caller passou input/output separados, usa-os. Senão divide
		// quantity 50/50 (heurística — UI deve sempre passar separados).
		inTok := req.InputTokens
		outTok := req.OutputTokens
		if inTok == 0 && outTok == 0 {
			inTok = req.Quantity / 2
			outTok = req.Quantity - inTok
		}
		return inTok*inCost/1000 + outTok*outCost/1000

	case models.EventVoiceTTSChars:
		return req.Quantity * cfg.TTSDefaultCostPer100Chars / 100

	case models.EventVoiceSTTSeconds:
		return req.Quantity * cfg.STTDefaultCostPerSecond

	case models.EventMessageOutbound, models.EventCampaignRecipient:
		// Resource diferencia tipo de mensagem outbound.
		switch strings.ToLower(req.Resource) {
		case "waba_marketing", "waba_mkt":
			return cfg.MessageOutboundWABAMkt * req.Quantity
		case "waba_utility", "waba_util", "waba_authentication":
			return cfg.MessageOutboundWABAUtil * req.Quantity
		}
		return cfg.MessageOutboundQRCost * req.Quantity

	case models.EventMessageInbound:
		return cfg.MessageInboundCost * req.Quantity

	case models.EventInstanceDay:
		// Uma instância ativa custa tier de proxy + Vps share.
		// Hardcoded por enquanto — ~$0.20/dia = 200000 micros.
		return 200_000 * req.Quantity

	case models.EventProxyBytes:
		// req.Quantity em bytes; cost é por 100MB.
		mb100 := req.Quantity / (100 * 1024 * 1024)
		return mb100 * cfg.ProxyDefaultCostPer100MB
	}
	return 0
}

// llmRatesFor — devolve (input_per_1k, output_per_1k) pra um Resource
// no formato "provider:model". Faz lookup na matrix; cai no default.
func (r *UsageRecorder) llmRatesFor(cfg *models.PricingConfig, resource string) (int64, int64) {
	if cfg.LLMCostMatrix != "" && cfg.LLMCostMatrix != "{}" {
		var matrix map[string]struct {
			In  int64 `json:"in"`
			Out int64 `json:"out"`
		}
		if err := json.Unmarshal([]byte(cfg.LLMCostMatrix), &matrix); err == nil {
			if rate, ok := matrix[resource]; ok && rate.In > 0 {
				return rate.In, rate.Out
			}
		}
	}
	return cfg.LLMDefaultInputCostPer1k, cfg.LLMDefaultOutputCostPer1k
}

// ─── Record event ──────────────────────────────────────────────────────

// RecordRequest é o que call sites passam pra gravar consumo. Inclui
// scope (account/workspace), tipo, quantidade e contexto opcional.
type RecordRequest struct {
	UserID       uuid.UUID
	WorkspaceID  *uuid.UUID
	EventType    models.UsageEventType
	Quantity     int64
	Resource     string
	InputTokens  int64
	OutputTokens int64
	Metadata     map[string]any
}

// Record grava um evento de consumo + atualiza quotas atomic. Idempotente
// não é (cada chamada cria 1 row), mas o caller deve estar do lado certo
// do guard CanConsume — se chamou Record sem checar Can, o evento ainda
// é gravado mesmo estourando, com IsOverage=true se overage permitido,
// senão registramos warn no log.
//
// Não retorna erro se a gravação falha — só loga warn. Razão: nenhuma
// operação de produto deve quebrar por causa de metric. Usuário paga
// se conseguirmos contar; se perdermos um evento, sai grátis.
func (r *UsageRecorder) Record(ctx context.Context, req RecordRequest) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Error().Interface("panic", rec).Msg("usage recorder: panic recovered")
		}
	}()

	cost := r.ComputeCredits(ctx, ComputeRequest{
		EventType:    req.EventType,
		Quantity:     req.Quantity,
		Resource:     req.Resource,
		InputTokens:  req.InputTokens,
		OutputTokens: req.OutputTokens,
	})
	cat := models.CategoryFor(req.EventType)

	// Quota do user no ciclo atual. Cria sob demanda (lazy init no
	// primeiro evento do ciclo).
	quota, err := r.ensureCurrentUserQuota(ctx, req.UserID)
	if err != nil {
		log.Warn().Err(err).Str("user", req.UserID.String()).Msg("usage: falha ao garantir quota — evento gravado sem agregação")
	}

	// Decide isOverage: se acumulado já passou allowance+topup,
	// overage_allowed=true permite seguir, false hard-stops.
	isOverage := false
	if quota != nil {
		switch cat {
		case models.CategoryAI:
			isOverage = quota.AICreditsUsed+cost.Credits > quota.AICreditsLimit+quota.AITopupCredits
		case models.CategoryVoice:
			isOverage = quota.VoiceCreditsUsed+cost.Credits > quota.VoiceCreditsLimit+quota.VoiceTopupCredits
		case models.CategoryMessage:
			isOverage = quota.MessageCreditsUsed+cost.Credits > quota.MessageCreditsLimit+quota.MessageTopupCredits
		}
	}

	metaJSON := "{}"
	if req.Metadata != nil {
		if b, err := json.Marshal(req.Metadata); err == nil {
			metaJSON = string(b)
		}
	}

	// Insert event (append-only).
	periodStart := time.Now().UTC().Truncate(24 * time.Hour)
	if quota != nil {
		periodStart = quota.PeriodStart
	}
	evt := models.UsageEvent{
		UserID:       req.UserID,
		WorkspaceID:  req.WorkspaceID,
		EventType:    req.EventType,
		Category:     cat,
		Resource:     req.Resource,
		Quantity:     req.Quantity,
		CostUsdMicro: cost.CostUsdMicro,
		Credits:      cost.Credits,
		IsOverage:    isOverage,
		PeriodStart:  periodStart,
		Metadata:     metaJSON,
		OccurredAt:   time.Now(),
	}
	if err := r.db.WithContext(ctx).Create(&evt).Error; err != nil {
		log.Warn().Err(err).Msg("usage: falha ao gravar event — evento perdido")
		return
	}

	// Atualiza quotas (account + workspace) atomic via UPDATE incremental.
	if quota != nil {
		r.applyToAccountQuota(ctx, quota, cat, cost.Credits, isOverage)
	}
	if req.WorkspaceID != nil {
		r.applyToWorkspaceQuota(ctx, *req.WorkspaceID, periodStart, cat, cost.Credits)
	}
}

// applyToAccountQuota — UPDATE incremental nas colunas certas. Usa
// expressões SQL pra evitar race entre SELECT/UPDATE.
func (r *UsageRecorder) applyToAccountQuota(ctx context.Context, q *models.UsageQuota, cat models.UsageEventCategory, credits int64, isOverage bool) {
	updates := map[string]any{}
	switch cat {
	case models.CategoryAI:
		updates["ai_credits_used"] = gorm.Expr("ai_credits_used + ?", credits)
		if isOverage {
			updates["ai_overage_credits"] = gorm.Expr("ai_overage_credits + ?", credits)
		}
	case models.CategoryVoice:
		updates["voice_credits_used"] = gorm.Expr("voice_credits_used + ?", credits)
		if isOverage {
			updates["voice_overage_credits"] = gorm.Expr("voice_overage_credits + ?", credits)
		}
	case models.CategoryMessage:
		updates["message_credits_used"] = gorm.Expr("message_credits_used + ?", credits)
		if isOverage {
			updates["message_overage_credits"] = gorm.Expr("message_overage_credits + ?", credits)
		}
	default:
		return
	}
	if err := r.db.WithContext(ctx).
		Model(&models.UsageQuota{}).
		Where("id = ?", q.ID).
		Updates(updates).Error; err != nil {
		log.Warn().Err(err).Msg("usage: falha ao update quota account")
	}
}

func (r *UsageRecorder) applyToWorkspaceQuota(ctx context.Context, wsID uuid.UUID, periodStart time.Time, cat models.UsageEventCategory, credits int64) {
	// Cria a row se não existir — workspace_quota é opcional, criamos
	// lazy só quando há consumo no workspace pra economizar rows.
	q := models.WorkspaceQuota{
		WorkspaceID: wsID,
		PeriodStart: periodStart,
		PeriodEnd:   periodStart.AddDate(0, 1, 0),
	}
	r.db.WithContext(ctx).
		Where("workspace_id = ? AND period_start = ?", wsID, periodStart).
		FirstOrCreate(&q)

	col := ""
	switch cat {
	case models.CategoryAI:
		col = "ai_credits_used"
	case models.CategoryVoice:
		col = "voice_credits_used"
	case models.CategoryMessage:
		col = "message_credits_used"
	default:
		return
	}
	if err := r.db.WithContext(ctx).
		Model(&models.WorkspaceQuota{}).
		Where("id = ?", q.ID).
		Update(col, gorm.Expr(col+" + ?", credits)).Error; err != nil {
		log.Warn().Err(err).Msg("usage: falha ao update quota workspace")
	}
}

// ─── ensureCurrentUserQuota ─────────────────────────────────────────────

// ensureCurrentUserQuota — devolve a UsageQuota do user pro ciclo
// vigente. Se não existe, cria com snapshot do allowance do plano.
//
// Ciclo é anniversary-based: começa na data da subscription do user
// (User.SubscriptionStartedAt ou created_at se sem sub) e dura ~30 dias.
// Pro free plan sem sub, usa primeiro dia do mês corrente.
func (r *UsageRecorder) ensureCurrentUserQuota(ctx context.Context, userID uuid.UUID) (*models.UsageQuota, error) {
	periodStart, periodEnd := computeBillingCycle(ctx, r.db, userID)

	var q models.UsageQuota
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND period_start = ?", userID, periodStart).
		First(&q).Error
	if err == nil {
		return &q, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Snapshot do allowance do plano. Free (sem plano) = tudo zero (PAYG).
	var user models.User
	if err := r.db.WithContext(ctx).
		Preload("Plan").
		First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	plan := user.Plan
	q = models.UsageQuota{
		UserID:      userID,
		PeriodStart: periodStart,
		PeriodEnd:   periodEnd,
	}
	if plan != nil {
		q.AICreditsLimit = plan.AICreditsIncludedPerCycle
		q.VoiceCreditsLimit = plan.VoiceCreditsIncludedPerCycle
		q.MessageCreditsLimit = plan.MessageCreditsIncludedPerCycle
		q.OverageAllowed = plan.OverageAllowedDefault
	}
	// FirstOrCreate pra evitar race (2 goroutines criando ao mesmo tempo).
	if err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&q).Error; err != nil {
		return nil, err
	}
	// Re-fetch pra pegar o ID gerado pelo BeforeCreate caso conflict
	// tenha ignorado o insert.
	r.db.WithContext(ctx).
		Where("user_id = ? AND period_start = ?", userID, periodStart).
		First(&q)
	return &q, nil
}

// computeBillingCycle — calcula janela do ciclo atual (anniversary-based).
// Lazy: hardcoded mensal por enquanto, só ancora no User.CreatedAt.
//
// Ex: user criou em 15/jan. Hoje é 20/abr → ciclo: 15/abr a 15/mai.
//
// Prod-ready quer ler de User.SubscriptionAnniversary; se ainda não temos
// esse campo persistido, CreatedAt é proxy razoável.
func computeBillingCycle(ctx context.Context, db *gorm.DB, userID uuid.UUID) (time.Time, time.Time) {
	var u models.User
	now := time.Now().UTC()
	if err := db.WithContext(ctx).Select("created_at").First(&u, "id = ?", userID).Error; err != nil {
		first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		return first, first.AddDate(0, 1, 0)
	}
	day := u.CreatedAt.Day()
	// Pra meses com menos dias (fev), trunca pro último válido.
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := month.AddDate(0, 1, -1).Day()
	if day > last {
		day = last
	}
	periodStart := time.Date(now.Year(), now.Month(), day, 0, 0, 0, 0, time.UTC)
	if periodStart.After(now) {
		periodStart = periodStart.AddDate(0, -1, 0)
	}
	periodEnd := periodStart.AddDate(0, 1, 0)
	return periodStart, periodEnd
}

// ─── CanConsume ────────────────────────────────────────────────────────

// CanConsumeResult comunica decisão + razão pra UI exibir mensagem certa.
type CanConsumeResult struct {
	Allowed         bool
	Reason          string // "ok" | "quota_exhausted" | "hard_stopped" | "no_pricing"
	CreditsRequired int64
	CreditsAvailable int64
}

// CanConsume verifica se o user (ou workspace) tem saldo pra consumir
// um evento de tamanho estimado. Caller chama ANTES de chamar provider
// externo; se não-allowed, retorna 402 ou degrade.
//
// Lógica:
//   1. Computa créditos estimados via ComputeCredits.
//   2. Carrega quota do ciclo atual.
//   3. Se hard_stopped_at[cat] setado → bloqueia.
//   4. Se used+est <= limit+topup → ok.
//   5. Se overage_allowed=true → ok (vai cobrar overage).
//   6. Senão → bloqueia.
func (r *UsageRecorder) CanConsume(ctx context.Context, userID uuid.UUID, req ComputeRequest) CanConsumeResult {
	cost := r.ComputeCredits(ctx, req)
	if cost.Credits == 0 {
		// Eventos sem custo (ex: message inbound) sempre passam.
		return CanConsumeResult{Allowed: true, Reason: "ok"}
	}

	q, err := r.ensureCurrentUserQuota(ctx, userID)
	if err != nil || q == nil {
		// Falha em quota = liberamos (não queremos quebrar o produto
		// por bug nosso). Logamos pra investigar.
		log.Warn().Err(err).Msg("usage: CanConsume liberou (sem quota)")
		return CanConsumeResult{Allowed: true, Reason: "no_quota"}
	}

	cat := models.CategoryFor(req.EventType)
	switch cat {
	case models.CategoryAI:
		if q.AIHardStoppedAt != nil {
			return CanConsumeResult{Allowed: false, Reason: "hard_stopped", CreditsRequired: cost.Credits, CreditsAvailable: q.AICreditsAvailable()}
		}
		avail := q.AICreditsAvailable()
		if avail >= cost.Credits {
			return CanConsumeResult{Allowed: true, Reason: "ok", CreditsRequired: cost.Credits, CreditsAvailable: avail}
		}
		if q.OverageAllowed {
			return CanConsumeResult{Allowed: true, Reason: "overage", CreditsRequired: cost.Credits, CreditsAvailable: avail}
		}
		return CanConsumeResult{Allowed: false, Reason: "quota_exhausted", CreditsRequired: cost.Credits, CreditsAvailable: avail}
	case models.CategoryVoice:
		if q.VoiceHardStoppedAt != nil {
			return CanConsumeResult{Allowed: false, Reason: "hard_stopped", CreditsRequired: cost.Credits, CreditsAvailable: q.VoiceCreditsAvailable()}
		}
		avail := q.VoiceCreditsAvailable()
		if avail >= cost.Credits {
			return CanConsumeResult{Allowed: true, Reason: "ok", CreditsRequired: cost.Credits, CreditsAvailable: avail}
		}
		if q.OverageAllowed {
			return CanConsumeResult{Allowed: true, Reason: "overage", CreditsRequired: cost.Credits, CreditsAvailable: avail}
		}
		return CanConsumeResult{Allowed: false, Reason: "quota_exhausted", CreditsRequired: cost.Credits, CreditsAvailable: avail}
	case models.CategoryMessage:
		if q.MessageHardStoppedAt != nil {
			return CanConsumeResult{Allowed: false, Reason: "hard_stopped", CreditsRequired: cost.Credits, CreditsAvailable: q.MessageCreditsAvailable()}
		}
		avail := q.MessageCreditsAvailable()
		if avail >= cost.Credits {
			return CanConsumeResult{Allowed: true, Reason: "ok", CreditsRequired: cost.Credits, CreditsAvailable: avail}
		}
		if q.OverageAllowed {
			return CanConsumeResult{Allowed: true, Reason: "overage", CreditsRequired: cost.Credits, CreditsAvailable: avail}
		}
		return CanConsumeResult{Allowed: false, Reason: "quota_exhausted", CreditsRequired: cost.Credits, CreditsAvailable: avail}
	}
	return CanConsumeResult{Allowed: true, Reason: "ok"}
}

// ─── Singleton (opcional) ──────────────────────────────────────────────

var (
	globalRecorderMu sync.RWMutex
	globalRecorder   *UsageRecorder
)

func SetGlobalUsageRecorder(r *UsageRecorder) {
	globalRecorderMu.Lock()
	globalRecorder = r
	globalRecorderMu.Unlock()
}

func GetGlobalUsageRecorder() *UsageRecorder {
	globalRecorderMu.RLock()
	defer globalRecorderMu.RUnlock()
	return globalRecorder
}

// Helper: quick-record a partir de qualquer lugar sem ter o recorder
// na mão. No-op se ainda não foi setado o singleton.
func RecordUsage(ctx context.Context, req RecordRequest) {
	r := GetGlobalUsageRecorder()
	if r == nil {
		return
	}
	r.Record(ctx, req)
}

// ─── Helpers extras ─────────────────────────────────────────────────────

// ResetCycle — força criação de uma nova quota (próximo ciclo). Cron
// mensal chama isso quando passa do period_end. Deixa explícito pra evitar
// drift entre quando ciclo "deveria" virar e quando virou de fato.
func (r *UsageRecorder) ResetCycle(ctx context.Context, userID uuid.UUID) error {
	_, err := r.ensureCurrentUserQuota(ctx, userID)
	return err
}

// SetOverageAllowed — toggle do user "deixar passar" quando estourar.
func (r *UsageRecorder) SetOverageAllowed(ctx context.Context, userID uuid.UUID, allowed bool) error {
	q, err := r.ensureCurrentUserQuota(ctx, userID)
	if err != nil || q == nil {
		return fmt.Errorf("quota não encontrada")
	}
	return r.db.WithContext(ctx).
		Model(&models.UsageQuota{}).
		Where("id = ?", q.ID).
		Update("overage_allowed", allowed).Error
}

// ApplyTopup — soma créditos do topup nas colunas certas. Chamado pelo
// webhook Stripe após pagamento confirmado.
func (r *UsageRecorder) ApplyTopup(ctx context.Context, t *models.UsageTopup) error {
	col := ""
	switch t.Category {
	case models.CategoryAI:
		col = "ai_topup_credits"
	case models.CategoryVoice:
		col = "voice_topup_credits"
	case models.CategoryMessage:
		col = "message_topup_credits"
	default:
		return fmt.Errorf("category %s sem topup", t.Category)
	}
	if t.Scope == "workspace" && t.WorkspaceID != nil {
		periodStart, periodEnd := computeBillingCycle(ctx, r.db, t.UserID)
		var wq models.WorkspaceQuota
		r.db.WithContext(ctx).
			Where("workspace_id = ? AND period_start = ?", *t.WorkspaceID, periodStart).
			Attrs(models.WorkspaceQuota{
				WorkspaceID: *t.WorkspaceID,
				PeriodStart: periodStart,
				PeriodEnd:   periodEnd,
			}).
			FirstOrCreate(&wq)
		return r.db.WithContext(ctx).
			Model(&models.WorkspaceQuota{}).
			Where("id = ?", wq.ID).
			Update(col, gorm.Expr(col+" + ?", t.CreditsAmount)).Error
	}
	q, err := r.ensureCurrentUserQuota(ctx, t.UserID)
	if err != nil || q == nil {
		return fmt.Errorf("quota não encontrada")
	}
	return r.db.WithContext(ctx).
		Model(&models.UsageQuota{}).
		Where("id = ?", q.ID).
		Update(col, gorm.Expr(col+" + ?", t.CreditsAmount)).Error
}
