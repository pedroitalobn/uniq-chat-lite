package handlers

import (
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
)

// ─── PricingConfig — admin CRUD ──────────────────────────────────────
//
// Singleton-ish: o admin pode editar os parâmetros (margens, custos
// brutos, top-up packs) e o UsageRecorder reflete em até 5min (cache TTL).
// PUT inválida o cache imediatamente via InvalidatePricing.

// GetPricingConfig GET /v1/admin/pricing-config
//
// Retorna a config singleton. Cria default se ainda não existe (lazy
// init — primeiro GET seedа).
func (h *AdminHandler) GetPricingConfig(c *fiber.Ctx) error {
	var cfg models.PricingConfig
	if err := h.db.Order("created_at ASC").First(&cfg).Error; err != nil {
		// Cria default + devolve.
		cfg = models.PricingConfig{}
		if err := h.db.Create(&cfg).Error; err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "erro ao seedar config"})
		}
	}
	return c.JSON(cfg)
}

// UpdatePricingConfig PUT /v1/admin/pricing-config
//
// Aceita patch com qualquer subset de campos. Margens em %. Custos em
// USD micros. CreditUnitMicros muda quanto cada crédito vale (NÃO mexer
// em produção sem migrar — eventos antigos teriam custo recalculado em
// nova unidade).
func (h *AdminHandler) UpdatePricingConfig(c *fiber.Ctx) error {
	var body struct {
		CreditUnitMicros          *int64  `json:"credit_unit_micros,omitempty"`
		MarginPctAI               *int    `json:"margin_pct_ai,omitempty"`
		MarginPctVoice            *int    `json:"margin_pct_voice,omitempty"`
		MarginPctMessage          *int    `json:"margin_pct_message,omitempty"`
		MarginPctProxy            *int    `json:"margin_pct_proxy,omitempty"`
		LLMCostMatrix             *string `json:"llm_cost_matrix,omitempty"`
		LLMDefaultInputCostPer1k  *int64  `json:"llm_default_input_cost_per_1k,omitempty"`
		LLMDefaultOutputCostPer1k *int64  `json:"llm_default_output_cost_per_1k,omitempty"`
		TTSDefaultCostPer100Chars *int64  `json:"tts_default_cost_per_100_chars,omitempty"`
		STTDefaultCostPerSecond   *int64  `json:"stt_default_cost_per_second,omitempty"`
		MessageOutboundQRCost     *int64  `json:"message_outbound_qr_cost,omitempty"`
		MessageOutboundWABAUtil   *int64  `json:"message_outbound_waba_util,omitempty"`
		MessageOutboundWABAMkt    *int64  `json:"message_outbound_waba_mkt,omitempty"`
		MessageInboundCost        *int64  `json:"message_inbound_cost,omitempty"`
		ProxyDefaultCostPer100MB  *int64  `json:"proxy_default_cost_per_100_mb,omitempty"`
		TopupPacks                *string `json:"topup_packs,omitempty"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "corpo inválido"})
	}
	var cfg models.PricingConfig
	if err := h.db.Order("created_at ASC").First(&cfg).Error; err != nil {
		cfg = models.PricingConfig{}
	}
	updates := map[string]any{}
	if body.CreditUnitMicros != nil {
		updates["credit_unit_micros"] = *body.CreditUnitMicros
	}
	if body.MarginPctAI != nil {
		updates["margin_pct_ai"] = *body.MarginPctAI
	}
	if body.MarginPctVoice != nil {
		updates["margin_pct_voice"] = *body.MarginPctVoice
	}
	if body.MarginPctMessage != nil {
		updates["margin_pct_message"] = *body.MarginPctMessage
	}
	if body.MarginPctProxy != nil {
		updates["margin_pct_proxy"] = *body.MarginPctProxy
	}
	if body.LLMCostMatrix != nil {
		updates["llm_cost_matrix"] = *body.LLMCostMatrix
	}
	if body.LLMDefaultInputCostPer1k != nil {
		updates["llm_default_input_cost_per_1k"] = *body.LLMDefaultInputCostPer1k
	}
	if body.LLMDefaultOutputCostPer1k != nil {
		updates["llm_default_output_cost_per_1k"] = *body.LLMDefaultOutputCostPer1k
	}
	if body.TTSDefaultCostPer100Chars != nil {
		updates["tts_default_cost_per_100_chars"] = *body.TTSDefaultCostPer100Chars
	}
	if body.STTDefaultCostPerSecond != nil {
		updates["stt_default_cost_per_second"] = *body.STTDefaultCostPerSecond
	}
	if body.MessageOutboundQRCost != nil {
		updates["message_outbound_qr_cost"] = *body.MessageOutboundQRCost
	}
	if body.MessageOutboundWABAUtil != nil {
		updates["message_outbound_waba_util"] = *body.MessageOutboundWABAUtil
	}
	if body.MessageOutboundWABAMkt != nil {
		updates["message_outbound_waba_mkt"] = *body.MessageOutboundWABAMkt
	}
	if body.MessageInboundCost != nil {
		updates["message_inbound_cost"] = *body.MessageInboundCost
	}
	if body.ProxyDefaultCostPer100MB != nil {
		updates["proxy_default_cost_per_100_mb"] = *body.ProxyDefaultCostPer100MB
	}
	if body.TopupPacks != nil {
		updates["topup_packs"] = *body.TopupPacks
	}
	if cfg.ID == uuid.Nil {
		// Cria do zero — caller passou full body.
		if err := h.db.Create(&cfg).Error; err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	if len(updates) > 0 {
		if err := h.db.Model(&cfg).Where("id = ?", cfg.ID).Updates(updates).Error; err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	// Invalida cache do recorder pra refletir já.
	if rec := services.GetGlobalUsageRecorder(); rec != nil {
		rec.InvalidatePricing()
	}
	// Re-fetch pra retornar estado atual.
	h.db.First(&cfg, "id = ?", cfg.ID)
	return c.JSON(cfg)
}

// ─── User-level admin actions ────────────────────────────────────────

// GetUserUsage GET /v1/admin/users/:id/usage
//
// Mesma view do GET /v1/usage/me mas pra qualquer user (super admin).
// Útil pro inspect do user no painel.
func (h *AdminHandler) GetUserUsage(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var user models.User
	if err := h.db.Preload("Plan").First(&user, "id = ?", id).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "user não encontrado"})
	}
	var q models.UsageQuota
	hasQuota := h.db.
		Where("user_id = ? AND period_start <= ? AND period_end > ?",
			user.ID, time.Now(), time.Now()).
		Order("period_start DESC").
		First(&q).Error == nil

	return c.JSON(buildUsageView(&user, user.Plan, &q, hasQuota))
}

// GrantTopup POST /v1/admin/users/:id/topup-grant
// Body: { category: "ai"|"voice"|"message", credits: int, note?: string }
//
// Concede créditos manualmente — útil pra resolução de ticket de suporte
// ou cortesia. Cria UsageTopup com price_cents=0 e status=paid (não passa
// por Stripe). Soma na quota do user atomicamente.
func (h *AdminHandler) GrantTopup(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		Category string `json:"category"`
		Credits  int64  `json:"credits"`
		Note     string `json:"note"`
	}
	if err := c.BodyParser(&body); err != nil || body.Credits <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "category e credits > 0 obrigatórios"})
	}
	cat := models.UsageEventCategory(body.Category)
	if cat != models.CategoryAI && cat != models.CategoryVoice && cat != models.CategoryMessage {
		return c.Status(400).JSON(fiber.Map{"error": "category inválida"})
	}
	now := time.Now()
	topup := models.UsageTopup{
		UserID:        userID,
		Scope:         "account",
		Category:      cat,
		CreditsAmount: body.Credits,
		PriceCents:    0,
		Status:        "paid",
		PaidAt:        &now,
	}
	if err := h.db.Create(&topup).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if rec := services.GetGlobalUsageRecorder(); rec != nil {
		if err := rec.ApplyTopup(c.Context(), &topup); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	return c.JSON(fiber.Map{"ok": true, "topup_id": topup.ID})
}

// ResetUserCycle POST /v1/admin/users/:id/usage-reset
//
// Força criação da quota do ciclo atual (idempotente — se já existe,
// no-op). Útil pra debug ou pra começar consumo numa data específica.
func (h *AdminHandler) ResetUserCycle(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	if rec := services.GetGlobalUsageRecorder(); rec != nil {
		if err := rec.ResetCycle(c.Context(), userID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	return c.JSON(fiber.Map{"ok": true})
}

// ─── Global dashboard ────────────────────────────────────────────────

// GetGlobalUsage GET /v1/admin/usage/global
//
// Dashboard pro super admin acompanhar consumo global da plataforma:
// quanto a Uniq paga aos providers (USD micros), top users por
// consumo, breakdown por categoria/provider últimos N dias.
func (h *AdminHandler) GetGlobalUsage(c *fiber.Ctx) error {
	days, _ := strconv.Atoi(c.Query("days", "30"))
	if days <= 0 || days > 365 {
		days = 30
	}
	cutoff := time.Now().AddDate(0, 0, -days)

	// Total agregado: créditos cobrados, custo bruto Uniq (USD micros),
	// margem efetiva (cost_credits - cost_micros/unit), quantidade de
	// eventos.
	type totals struct {
		TotalCredits      int64 `json:"total_credits"`
		TotalCostUsdMicro int64 `json:"total_cost_usd_micro"`
		EventCount        int64 `json:"event_count"`
		OverageCredits    int64 `json:"overage_credits"`
	}
	var t totals
	h.db.Raw(`
		SELECT
		  COALESCE(SUM(credits), 0) AS total_credits,
		  COALESCE(SUM(cost_usd_micro), 0) AS total_cost_usd_micro,
		  COUNT(*) AS event_count,
		  COALESCE(SUM(CASE WHEN is_overage THEN credits ELSE 0 END), 0) AS overage_credits
		FROM usage_events WHERE occurred_at >= ?
	`, cutoff).Scan(&t)

	// Por categoria.
	type catRow struct {
		Category     string `json:"category"`
		Credits      int64  `json:"credits"`
		CostUsdMicro int64  `json:"cost_usd_micro"`
		EventCount   int64  `json:"event_count"`
	}
	var byCategory []catRow
	h.db.Raw(`
		SELECT category,
		  COALESCE(SUM(credits), 0) AS credits,
		  COALESCE(SUM(cost_usd_micro), 0) AS cost_usd_micro,
		  COUNT(*) AS event_count
		FROM usage_events WHERE occurred_at >= ?
		GROUP BY category ORDER BY credits DESC
	`, cutoff).Scan(&byCategory)

	// Por provider (resource splitado em provider:model — usamos prefix
	// até o primeiro ":"). Mostra em USD micros (custo bruto Uniq) pro
	// admin saber quanto está pagando cada um.
	type provRow struct {
		Provider     string `json:"provider"`
		Category     string `json:"category"`
		CostUsdMicro int64  `json:"cost_usd_micro"`
		Credits      int64  `json:"credits"`
		EventCount   int64  `json:"event_count"`
	}
	var byProvider []provRow
	providerExpr := "COALESCE(NULLIF(SPLIT_PART(resource, ':', 1), ''), 'unknown')"
	dayExpr := "to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
	if h.db.Dialector.Name() == "sqlite" {
		providerExpr = "COALESCE(NULLIF(CASE WHEN instr(resource, ':') > 0 THEN substr(resource, 1, instr(resource, ':') - 1) ELSE resource END, ''), 'unknown')"
		dayExpr = "strftime('%Y-%m-%d', occurred_at)"
	}
	h.db.Raw(`
		SELECT
		  `+providerExpr+` AS provider,
		  category,
		  COALESCE(SUM(cost_usd_micro), 0) AS cost_usd_micro,
		  COALESCE(SUM(credits), 0) AS credits,
		  COUNT(*) AS event_count
		FROM usage_events WHERE occurred_at >= ?
		GROUP BY provider, category ORDER BY cost_usd_micro DESC LIMIT 50
	`, cutoff).Scan(&byProvider)

	// Top users por créditos consumidos.
	type userRow struct {
		UserID       uuid.UUID `json:"user_id"`
		UserEmail    string    `json:"user_email"`
		UserName     string    `json:"user_name"`
		Credits      int64     `json:"credits"`
		CostUsdMicro int64     `json:"cost_usd_micro"`
		EventCount   int64     `json:"event_count"`
	}
	var topUsers []userRow
	h.db.Raw(`
		SELECT
		  ue.user_id,
		  COALESCE(u.email, '') AS user_email,
		  COALESCE(u.name, '') AS user_name,
		  COALESCE(SUM(ue.credits), 0) AS credits,
		  COALESCE(SUM(ue.cost_usd_micro), 0) AS cost_usd_micro,
		  COUNT(*) AS event_count
		FROM usage_events ue
		LEFT JOIN users u ON u.id = ue.user_id
		WHERE ue.occurred_at >= ?
		GROUP BY ue.user_id, u.email, u.name
		ORDER BY credits DESC LIMIT 25
	`, cutoff).Scan(&topUsers)

	// Timeseries diária pro chart.
	type tsRow struct {
		Day          string `json:"day"`
		Credits      int64  `json:"credits"`
		CostUsdMicro int64  `json:"cost_usd_micro"`
	}
	var timeseries []tsRow
	h.db.Raw(`
		SELECT `+dayExpr+` AS day,
		  COALESCE(SUM(credits), 0) AS credits,
		  COALESCE(SUM(cost_usd_micro), 0) AS cost_usd_micro
		FROM usage_events WHERE occurred_at >= ?
		GROUP BY day ORDER BY day ASC
	`, cutoff).Scan(&timeseries)

	return c.JSON(fiber.Map{
		"days":        days,
		"totals":      t,
		"by_category": byCategory,
		"by_provider": byProvider,
		"top_users":   topUsers,
		"timeseries":  timeseries,
	})
}
