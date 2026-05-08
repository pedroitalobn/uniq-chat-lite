package handlers

import (
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
)

// UsageHandler — endpoints do painel de consumo (Uniq Credits).
//
// Foco: dar pro user uma visão tipo Claude Code do quanto ele já gastou
// no ciclo, quanto sobra, e gráfico dos últimos 30 dias. Toggle de
// overage permite ele decidir se quer parar ao bater limite ou deixar
// passar (e receber fatura extra no fim do ciclo).
type UsageHandler struct {
	db       *gorm.DB
	recorder *services.UsageRecorder
}

func NewUsageHandler(db *gorm.DB, recorder *services.UsageRecorder) *UsageHandler {
	return &UsageHandler{db: db, recorder: recorder}
}

// GetMyUsage GET /v1/usage/me
//
// Retorna a quota do user pro ciclo atual + breakdown por categoria
// (AI/Voice/Message) com used/limit/topup/available/percent + flag
// hard_stopped por categoria. Se o user nunca consumiu nada, devolve
// estado zerado mas com os limits do plano (não cria row vazia até o
// primeiro evento de consumo).
func (h *UsageHandler) GetMyUsage(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	// Carrega plano pra fallback de limits quando não há quota row ainda.
	var plan *models.Plan
	if user.PlanID != nil {
		var p models.Plan
		if err := h.db.First(&p, "id = ?", *user.PlanID).Error; err == nil {
			plan = &p
		}
	}

	// Tenta achar quota do ciclo atual (sem criar — leitura barata).
	var q models.UsageQuota
	hasQuota := h.db.
		Where("user_id = ? AND period_start <= ? AND period_end > ?",
			user.ID, time.Now(), time.Now()).
		Order("period_start DESC").
		First(&q).Error == nil

	out := buildUsageView(user, plan, &q, hasQuota)
	return c.JSON(out)
}

// SetOverage POST /v1/usage/me/overage
// Body: { allowed: bool }
//
// Toggle do "deixar passar quando estourar". Default vem do plano
// (overage_allowed_default), mas o user pode mudar a qualquer hora.
// Mudança vale do ciclo atual em diante.
func (h *UsageHandler) SetOverage(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	var body struct {
		Allowed bool `json:"allowed"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if err := h.recorder.SetOverageAllowed(c.Context(), user.ID, body.Allowed); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "allowed": body.Allowed})
}

// ListMyEvents GET /v1/usage/me/events
//
// Tabela de últimos eventos do ciclo atual. Filtros: ?category=ai|voice|message
// e ?limit=50 (max 200). Sem paginação por enquanto — primeira fase só
// quer mostrar até 100 últimos.
func (h *UsageHandler) ListMyEvents(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := h.db.Model(&models.UsageEvent{}).
		Where("user_id = ?", user.ID)
	if cat := c.Query("category"); cat != "" {
		q = q.Where("category = ?", cat)
	}
	// Range padrão: últimos 30 dias (pra não puxar histórico inteiro
	// quando o user já gastou bastante e tem milhares de events).
	cutoff := time.Now().AddDate(0, 0, -30)
	q = q.Where("occurred_at >= ?", cutoff)

	var events []models.UsageEvent
	if err := q.Order("occurred_at DESC").Limit(limit).Find(&events).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": events})
}

// GetMyTimeseries GET /v1/usage/me/timeseries
//
// Agrega créditos por dia × categoria nos últimos 30d. Formato pronto pro
// recharts: [{date, ai, voice, message}]. Lacuna de dias sem consumo é
// preenchida com zero (UI consegue plotar linha contínua).
func (h *UsageHandler) GetMyTimeseries(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	days, _ := strconv.Atoi(c.Query("days", "30"))
	if days <= 0 || days > 90 {
		days = 30
	}
	cutoff := time.Now().AddDate(0, 0, -days).UTC().Truncate(24 * time.Hour)

	type bucket struct {
		Day      string `json:"date"`
		Category string `json:"category"`
		Credits  int64  `json:"credits"`
	}
	var rows []bucket
	if err := h.db.Raw(`
		SELECT
		  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
		  category,
		  COALESCE(SUM(credits), 0) AS credits
		FROM usage_events
		WHERE user_id = ? AND occurred_at >= ?
		GROUP BY day, category
		ORDER BY day ASC
	`, user.ID, cutoff).Scan(&rows).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Pivota: 1 linha por dia com colunas ai/voice/message/proxy.
	byDay := map[string]map[string]int64{}
	for _, r := range rows {
		if byDay[r.Day] == nil {
			byDay[r.Day] = map[string]int64{}
		}
		byDay[r.Day][r.Category] = r.Credits
	}
	out := make([]map[string]any, 0, days)
	for i := 0; i < days; i++ {
		d := cutoff.AddDate(0, 0, i).Format("2006-01-02")
		row := map[string]any{
			"date":    d,
			"ai":      byDay[d]["ai"],
			"voice":   byDay[d]["voice"],
			"message": byDay[d]["message"],
			"proxy":   byDay[d]["proxy"],
		}
		out = append(out, row)
	}
	return c.JSON(fiber.Map{"items": out})
}

// ListMyTopups GET /v1/usage/me/topups
//
// Histórico de top-ups comprados. Mostra status, valor, créditos.
// Phase 4 vai popular essa tabela via webhook Stripe; por ora só
// retorna o que houver no DB (geralmente vazio).
func (h *UsageHandler) ListMyTopups(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	var items []models.UsageTopup
	if err := h.db.Where("user_id = ?", user.ID).
		Order("created_at DESC").
		Limit(50).
		Find(&items).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": items})
}

// ─── helpers ──────────────────────────────────────────────────────────

// buildUsageView monta o payload do GET /me. Centraliza a lógica de
// "quota row pode não existir ainda" — se ainda não tem, sintetiza com
// limits do plano + zerado.
func buildUsageView(user *models.User, plan *models.Plan, q *models.UsageQuota, hasQuota bool) fiber.Map {
	var (
		aiLimit, voiceLimit, msgLimit       int64
		aiUsed, voiceUsed, msgUsed          int64
		aiTopup, voiceTopup, msgTopup       int64
		aiOverage, voiceOverage, msgOverage int64
		overageAllowed                      bool
		overageCents                        int64
		periodStart, periodEnd              time.Time
		aiHardStopped                       bool
		voiceHardStopped                    bool
		msgHardStopped                      bool
		notified50, notified80, notified95  bool
	)
	if hasQuota && q != nil {
		aiLimit = q.AICreditsLimit
		voiceLimit = q.VoiceCreditsLimit
		msgLimit = q.MessageCreditsLimit
		aiUsed = q.AICreditsUsed
		voiceUsed = q.VoiceCreditsUsed
		msgUsed = q.MessageCreditsUsed
		aiTopup = q.AITopupCredits
		voiceTopup = q.VoiceTopupCredits
		msgTopup = q.MessageTopupCredits
		aiOverage = q.AIOverageCredits
		voiceOverage = q.VoiceOverageCredits
		msgOverage = q.MessageOverageCredits
		overageAllowed = q.OverageAllowed
		overageCents = q.OverageCentsAccumulated
		periodStart = q.PeriodStart
		periodEnd = q.PeriodEnd
		aiHardStopped = q.AIHardStoppedAt != nil
		voiceHardStopped = q.VoiceHardStoppedAt != nil
		msgHardStopped = q.MessageHardStoppedAt != nil
		notified50 = q.NotifiedAt50 != nil
		notified80 = q.NotifiedAt80 != nil
		notified95 = q.NotifiedAt95 != nil
	} else {
		// Sem quota row — usa limits do plano e ciclo derivado da data
		// de criação do user (mesmo helper do recorder).
		if plan != nil {
			aiLimit = plan.AICreditsIncludedPerCycle
			voiceLimit = plan.VoiceCreditsIncludedPerCycle
			msgLimit = plan.MessageCreditsIncludedPerCycle
			overageAllowed = plan.OverageAllowedDefault
		}
		now := time.Now().UTC()
		periodStart = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		periodEnd = periodStart.AddDate(0, 1, 0)
	}
	return fiber.Map{
		"period_start":     periodStart,
		"period_end":       periodEnd,
		"plan": fiber.Map{
			"name": planName(plan),
			"is_payg": plan == nil ||
				(aiLimit == 0 && voiceLimit == 0 && msgLimit == 0),
		},
		"overage_allowed":           overageAllowed,
		"overage_cents_accumulated": overageCents,
		"ai": fiber.Map{
			"limit":          aiLimit,
			"used":           aiUsed,
			"topup":          aiTopup,
			"overage":        aiOverage,
			"available":      aiLimit + aiTopup - aiUsed,
			"percent":        percentOf(aiUsed, aiLimit+aiTopup),
			"hard_stopped":   aiHardStopped,
		},
		"voice": fiber.Map{
			"limit":          voiceLimit,
			"used":           voiceUsed,
			"topup":          voiceTopup,
			"overage":        voiceOverage,
			"available":      voiceLimit + voiceTopup - voiceUsed,
			"percent":        percentOf(voiceUsed, voiceLimit+voiceTopup),
			"hard_stopped":   voiceHardStopped,
		},
		"message": fiber.Map{
			"limit":          msgLimit,
			"used":           msgUsed,
			"topup":          msgTopup,
			"overage":        msgOverage,
			"available":      msgLimit + msgTopup - msgUsed,
			"percent":        percentOf(msgUsed, msgLimit+msgTopup),
			"hard_stopped":   msgHardStopped,
		},
		"notifications": fiber.Map{
			"at_50": notified50,
			"at_80": notified80,
			"at_95": notified95,
		},
	}
}

// percentOf — usado/total em %, capeado em 999 (overage muito alto). 0
// quando total <= 0 (PAYG sem topup ainda).
func percentOf(used, total int64) int {
	if total <= 0 {
		if used > 0 {
			return 100
		}
		return 0
	}
	pct := int(used * 100 / total)
	if pct > 999 {
		return 999
	}
	if pct < 0 {
		return 0
	}
	return pct
}

func planName(p *models.Plan) string {
	if p == nil {
		return "Free"
	}
	return p.Name
}

// avoid unused import warning when middleware import is only used by
// GetCurrentUser:
var _ = uuid.Nil
