package services

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UsageService — incrementa counters diários de uso por usuário e
// dispara notificações quando atinge 80%/100% do limite do plano.
//
// Convenção de design:
//   - Counter é por user_id (não instance), porque limites de plano
//     (MaxMessagesPerDay) são da conta toda.
//   - Day em formato "YYYY-MM-DD" no fuso UTC pra evitar drift.
//   - Increment é UPSERT atômico (clause.OnConflict) — sem race.
//   - Threshold check é best-effort: se 100 envios chegarem juntos,
//     pode ultrapassar em alguns; o objetivo é proteger o cliente,
//     não o cofre da plataforma. Pra hard-cap usar enforcement no
//     Check antes do envio.
type UsageService struct {
	db *gorm.DB

	// Cache: user_id → snapshot do counter atual (evita SELECT em cada
	// envio). Invalidado a cada minuto.
	cacheMu sync.RWMutex
	cache   map[string]cachedCount

	// Hook de notificação — quando seta, é chamado em transições 80/100%.
	// Permite plugar webhook usage.threshold + email + WS sem acoplamento.
	notify NotifyFn
}

type cachedCount struct {
	count   int
	day     string
	updated time.Time
}

// NotifyFn é a callback de notificação. percent ∈ {80, 100}.
type NotifyFn func(ctx context.Context, userID uuid.UUID, usageType string, percent int, current, limit int)

func NewUsageService(db *gorm.DB) *UsageService {
	return &UsageService{
		db:    db,
		cache: make(map[string]cachedCount),
	}
}

// Singleton global pra handlers acessarem sem injection. Setado uma
// vez no main.go via SetGlobalUsageService. Vale a pena pra evitar
// passar usageSvc em CADA handler de send.
var (
	globalUsageMu sync.RWMutex
	globalUsage   *UsageService
)

// SetGlobalUsageService instala o singleton.
func SetGlobalUsageService(s *UsageService) {
	globalUsageMu.Lock()
	globalUsage = s
	globalUsageMu.Unlock()
}

// GetGlobalUsageService retorna o singleton (nil-safe pra antes do startup).
func GetGlobalUsageService() *UsageService {
	globalUsageMu.RLock()
	defer globalUsageMu.RUnlock()
	return globalUsage
}

// SetNotifier instala o callback de notificação (chamado de webhooks
// + WebSocket + email pelo InboundPipeline).
func (s *UsageService) SetNotifier(fn NotifyFn) {
	s.notify = fn
}

func todayUTC() string {
	return time.Now().UTC().Format("2006-01-02")
}

// Increment soma 1 ao counter (user, day, type). Idempotente em caso
// de erro de DB (loga warn). Faz check de threshold pós-incremento.
func (s *UsageService) Increment(ctx context.Context, userID uuid.UUID, usageType string, plan *models.Plan) {
	if userID == uuid.Nil {
		return
	}
	day := todayUTC()
	row := models.UsageCounter{
		UserID: userID,
		Day:    day,
		Type:   usageType,
		Count:  1,
	}
	// UPSERT atômico: conflito em (user_id, day, type) → count = count + 1
	err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "day"}, {Name: "type"}},
		DoUpdates: clause.Assignments(map[string]interface{}{"count": gorm.Expr("usage_counters.count + 1"), "updated_at": time.Now()}),
	}).Create(&row).Error
	if err != nil {
		log.Warn().Err(err).Str("user", userID.String()).Str("type", usageType).Msg("usage: increment failed")
		return
	}

	// Atualiza cache.
	cacheKey := userID.String() + ":" + day + ":" + usageType
	s.cacheMu.Lock()
	if c, ok := s.cache[cacheKey]; ok {
		c.count++
		c.updated = time.Now()
		s.cache[cacheKey] = c
	}
	s.cacheMu.Unlock()

	s.checkThreshold(ctx, userID, usageType, plan)
}

// CurrentCount retorna o counter atual (com cache de 60s).
func (s *UsageService) CurrentCount(ctx context.Context, userID uuid.UUID, usageType string) int {
	day := todayUTC()
	cacheKey := userID.String() + ":" + day + ":" + usageType

	s.cacheMu.RLock()
	if c, ok := s.cache[cacheKey]; ok && time.Since(c.updated) < 60*time.Second && c.day == day {
		s.cacheMu.RUnlock()
		return c.count
	}
	s.cacheMu.RUnlock()

	var row models.UsageCounter
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND day = ? AND type = ?", userID, day, usageType).
		First(&row).Error; err != nil {
		s.cacheMu.Lock()
		s.cache[cacheKey] = cachedCount{count: 0, day: day, updated: time.Now()}
		s.cacheMu.Unlock()
		return 0
	}
	s.cacheMu.Lock()
	s.cache[cacheKey] = cachedCount{count: row.Count, day: day, updated: time.Now()}
	s.cacheMu.Unlock()
	return row.Count
}

// HasReachedLimit retorna true se já atingiu/passou o limite. Usado
// pra hard-cap em endpoints críticos (envio de mensagem).
//
// Limit < 0 = ilimitado (sempre false). Limit = 0 = sempre true (block).
func (s *UsageService) HasReachedLimit(ctx context.Context, userID uuid.UUID, usageType string, limit int) bool {
	if limit < 0 {
		return false
	}
	if limit == 0 {
		return true
	}
	return s.CurrentCount(ctx, userID, usageType) >= limit
}

// checkThreshold — após incremento, verifica se cruzou 80% ou 100% e
// dispara notificação UMA VEZ por dia (via flag alerted_at no row).
func (s *UsageService) checkThreshold(ctx context.Context, userID uuid.UUID, usageType string, plan *models.Plan) {
	if plan == nil || s.notify == nil {
		return
	}

	limit := 0
	switch usageType {
	case models.UsageTypeMessagesSent:
		limit = plan.MaxMessagesPerDay
	default:
		return
	}
	if limit <= 0 {
		return // ilimitado ou bloqueado — não alertar
	}

	current := s.CurrentCount(ctx, userID, usageType)
	pct := (current * 100) / limit

	// Threshold de 80% ou 100%
	threshold := 0
	switch {
	case pct >= 100:
		threshold = 100
	case pct >= 80:
		threshold = 80
	}
	if threshold == 0 {
		return
	}

	// Verifica se já alertou hoje (evita spam).
	day := todayUTC()
	var row models.UsageCounter
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND day = ? AND type = ?", userID, day, usageType).
		First(&row).Error; err != nil {
		return
	}
	if row.AlertedAt != nil && threshold == 80 {
		// Já alertou pelo menos uma vez. 80% só dispara 1x/dia.
		// 100% pode disparar de novo (limite excedido).
		return
	}

	// Marca alerted_at se for o primeiro 80%.
	if threshold == 80 {
		now := time.Now()
		s.db.WithContext(ctx).Model(&models.UsageCounter{}).
			Where("id = ?", row.ID).
			Update("alerted_at", &now)
	}

	go s.notify(ctx, userID, usageType, threshold, current, limit)
}
