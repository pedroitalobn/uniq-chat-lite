package handlers

import (
	"encoding/json"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// WarmupHandler — anti-ban warmup automatizado pra instâncias novas
// (gap UazAPI). Mantém um scheduler background por instância que
// envia mensagens "humanas" pra um pool de contatos warm-up
// (geralmente outros números próprios) seguindo curva crescente
// de volume nos primeiros 14 dias.
type WarmupHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager

	// schedulers ativos por instance ID
	mu      sync.Mutex
	running map[uuid.UUID]chan struct{}
}

func NewWarmupHandler(db *gorm.DB, manager *whatsapp.Manager) *WarmupHandler {
	h := &WarmupHandler{
		db:      db,
		manager: manager,
		running: make(map[uuid.UUID]chan struct{}),
	}
	// Resume sessions já rodando após restart do server.
	go h.resumeRunning()
	return h
}

func (h *WarmupHandler) resumeRunning() {
	time.Sleep(5 * time.Second)
	var sessions []models.WarmupSession
	h.db.Where("status = ?", models.WarmupStatusRunning).Find(&sessions)
	for i := range sessions {
		s := sessions[i]
		log.Info().Str("instance", s.InstanceID.String()).Msg("warmup: resuming session after restart")
		h.startScheduler(&s)
	}
}

func (h *WarmupHandler) instanceFromCtx(c *fiber.Ctx) (*models.Instance, error) {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil, fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}
	return instance, nil
}

// GET /v1/instances/:id/warmup
func (h *WarmupHandler) Get(c *fiber.Ctx) error {
	inst, err := h.instanceFromCtx(c)
	if err != nil {
		return err
	}
	var s models.WarmupSession
	if err := h.db.Where("instance_id = ?", inst.ID).First(&s).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return c.JSON(fiber.Map{"exists": false})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"exists": true, "session": s})
}

// POST /v1/instances/:id/warmup — cria/atualiza configuração.
func (h *WarmupHandler) Upsert(c *fiber.Ctx) error {
	inst, err := h.instanceFromCtx(c)
	if err != nil {
		return err
	}
	var req struct {
		DurationDays int      `json:"duration_days"`
		DailyTarget  int      `json:"daily_target"`
		StartHour    int      `json:"start_hour"`
		EndHour      int      `json:"end_hour"`
		MinDelaySec  int      `json:"min_delay_sec"`
		MaxDelaySec  int      `json:"max_delay_sec"`
		MessagePool  []string `json:"message_pool"`
		ContactPool  []string `json:"contact_pool"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if len(req.MessagePool) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message_pool vazio — adicione frases humanas"})
	}
	if len(req.ContactPool) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "contact_pool vazio — adicione JIDs/telefones de teste"})
	}
	msgJSON, _ := json.Marshal(req.MessagePool)
	conJSON, _ := json.Marshal(req.ContactPool)

	var s models.WarmupSession
	if err := h.db.Where("instance_id = ?", inst.ID).First(&s).Error; err != nil && err != gorm.ErrRecordNotFound {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	wsID := uuid.Nil
	if inst.WorkspaceID != nil {
		wsID = *inst.WorkspaceID
	}

	s.InstanceID = inst.ID
	s.WorkspaceID = wsID
	s.DurationDays = req.DurationDays
	s.DailyTarget = req.DailyTarget
	s.StartHour = req.StartHour
	s.EndHour = req.EndHour
	s.MinDelaySec = req.MinDelaySec
	s.MaxDelaySec = req.MaxDelaySec
	s.MessagePool = string(msgJSON)
	s.ContactPool = string(conJSON)
	if s.Status == "" {
		s.Status = models.WarmupStatusIdle
	}
	if err := h.db.Save(&s).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(s)
}

// POST /v1/instances/:id/warmup/start
func (h *WarmupHandler) Start(c *fiber.Ctx) error {
	inst, err := h.instanceFromCtx(c)
	if err != nil {
		return err
	}
	var s models.WarmupSession
	if err := h.db.Where("instance_id = ?", inst.ID).First(&s).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "warmup não configurado — POST /warmup primeiro"})
	}
	now := time.Now()
	s.Status = models.WarmupStatusRunning
	if s.StartedAt == nil {
		s.StartedAt = &now
	}
	h.db.Save(&s)
	h.startScheduler(&s)
	return c.JSON(fiber.Map{"status": "running"})
}

// POST /v1/instances/:id/warmup/pause
func (h *WarmupHandler) Pause(c *fiber.Ctx) error {
	inst, err := h.instanceFromCtx(c)
	if err != nil {
		return err
	}
	h.stopScheduler(inst.ID)
	h.db.Model(&models.WarmupSession{}).
		Where("instance_id = ?", inst.ID).
		Update("status", models.WarmupStatusPaused)
	return c.JSON(fiber.Map{"status": "paused"})
}

// POST /v1/instances/:id/warmup/resume
func (h *WarmupHandler) Resume(c *fiber.Ctx) error {
	inst, err := h.instanceFromCtx(c)
	if err != nil {
		return err
	}
	var s models.WarmupSession
	if err := h.db.Where("instance_id = ?", inst.ID).First(&s).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "warmup não configurado"})
	}
	s.Status = models.WarmupStatusRunning
	h.db.Save(&s)
	h.startScheduler(&s)
	return c.JSON(fiber.Map{"status": "running"})
}

// POST /v1/instances/:id/warmup/stop
func (h *WarmupHandler) Stop(c *fiber.Ctx) error {
	inst, err := h.instanceFromCtx(c)
	if err != nil {
		return err
	}
	h.stopScheduler(inst.ID)
	now := time.Now()
	h.db.Model(&models.WarmupSession{}).
		Where("instance_id = ?", inst.ID).
		Updates(map[string]any{
			"status":       models.WarmupStatusCompleted,
			"completed_at": &now,
		})
	return c.JSON(fiber.Map{"status": "stopped"})
}

// startScheduler kicks off the per-instance background loop. Idempotent —
// se já está rodando, no-op.
func (h *WarmupHandler) startScheduler(s *models.WarmupSession) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.running[s.InstanceID]; exists {
		return // already running
	}
	stop := make(chan struct{})
	h.running[s.InstanceID] = stop
	go h.schedulerLoop(s.ID, s.InstanceID, stop)
}

func (h *WarmupHandler) stopScheduler(instanceID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if stop, exists := h.running[instanceID]; exists {
		close(stop)
		delete(h.running, instanceID)
	}
}

// schedulerLoop é o coração do warmup. A cada iteração:
//  1. Carrega a sessão atualizada do DB (pode ter sido pausada).
//  2. Verifica se está dentro da janela horária ativa.
//  3. Verifica se o target diário ainda não foi atingido.
//  4. Escolhe contato + mensagem aleatórios e envia.
//  5. Espera intervalo randomizado [MinDelaySec, MaxDelaySec].
//
// Reset diário: ao detectar mudança de dia, zera SentToday e
// incrementa StartDay (até DurationDays, depois finaliza).
func (h *WarmupHandler) schedulerLoop(sessionID, instanceID uuid.UUID, stop chan struct{}) {
	log.Info().Str("instance", instanceID.String()).Msg("warmup: scheduler started")
	defer log.Info().Str("instance", instanceID.String()).Msg("warmup: scheduler stopped")

	for {
		select {
		case <-stop:
			return
		default:
		}

		var s models.WarmupSession
		if err := h.db.First(&s, sessionID).Error; err != nil {
			log.Warn().Err(err).Msg("warmup: session lost")
			return
		}
		if s.Status != models.WarmupStatusRunning {
			return
		}

		// Reset diário
		today := time.Now().Format("2006-01-02")
		if s.LastResetDay != today {
			newStartDay := s.StartDay
			if s.LastResetDay != "" {
				newStartDay++
			}
			if newStartDay > s.DurationDays {
				now := time.Now()
				h.db.Model(&s).Updates(map[string]any{
					"status":       models.WarmupStatusCompleted,
					"completed_at": &now,
				})
				h.stopScheduler(instanceID)
				return
			}
			h.db.Model(&s).Updates(map[string]any{
				"sent_today":     0,
				"start_day":      newStartDay,
				"last_reset_day": today,
			})
			s.SentToday = 0
			s.StartDay = newStartDay
			s.LastResetDay = today
		}

		// Janela horária ativa
		hr := time.Now().Hour()
		if s.StartHour > 0 && s.EndHour > 0 && (hr < s.StartHour || hr >= s.EndHour) {
			h.sleepOrStop(stop, 5*time.Minute)
			continue
		}

		// Target atingido?
		dailyTarget := s.TargetForDay()
		if s.SentToday >= dailyTarget {
			h.sleepOrStop(stop, 10*time.Minute)
			continue
		}

		// Cliente conectado?
		client := h.manager.GetInstance(instanceID.String())
		if client == nil || !client.IsConnected() {
			h.sleepOrStop(stop, 30*time.Second)
			continue
		}

		// Pick mensagem + destinatário e envia
		var msgs []string
		var contacts []string
		_ = json.Unmarshal([]byte(s.MessagePool), &msgs)
		_ = json.Unmarshal([]byte(s.ContactPool), &contacts)
		if len(msgs) == 0 || len(contacts) == 0 {
			h.sleepOrStop(stop, 1*time.Minute)
			continue
		}
		msg := msgs[rand.Intn(len(msgs))]
		to := strings.TrimSpace(contacts[rand.Intn(len(contacts))])

		// Presença "online" + typing antes do send pra parecer humano
		_ = client.SendTyping(to, true)
		typingDelay := 1 + rand.Intn(3) // 1-4s digitando
		time.Sleep(time.Duration(typingDelay) * time.Second)
		_ = client.SendTyping(to, false)

		now := time.Now()
		if _, err := client.SendTextMessage(to, msg); err != nil {
			log.Warn().Err(err).Str("to", to).Msg("warmup: send failed")
		} else {
			h.db.Model(&s).Updates(map[string]any{
				"sent_today":   gorm.Expr("sent_today + 1"),
				"sent_total":   gorm.Expr("sent_total + 1"),
				"last_sent_at": &now,
			})
		}

		// Intervalo até próximo envio
		delay := s.MinDelaySec
		if s.MaxDelaySec > s.MinDelaySec {
			delay += rand.Intn(s.MaxDelaySec - s.MinDelaySec)
		}
		h.sleepOrStop(stop, time.Duration(delay)*time.Second)
	}
}

func (h *WarmupHandler) sleepOrStop(stop chan struct{}, d time.Duration) {
	select {
	case <-stop:
		return
	case <-time.After(d):
		return
	}
}
