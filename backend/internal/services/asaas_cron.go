package services

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// AsaasCron — worker periódico que executa "cancel-at-period-end"
// nas subscriptions Asaas (Asaas não tem nativo).
//
// Como funciona:
//   1. /billing/cancel sem immediate=true seta user.asaas_cancel_at = nextDueDate
//   2. Esse cron roda 1x por hora; pra cada user com asaas_cancel_at <= now,
//      deleta a subscription no Asaas + faz downgrade pra Free + audit log
//   3. Idempotente: rodar 2x não causa erro (já deletado fica como no-op)
//
// Pra Stripe, cancel_at_period_end é nativo — não passa por aqui.
type AsaasCron struct {
	db          *gorm.DB
	asaasClient *AsaasClient
	stop        chan struct{}
}

func NewAsaasCron(db *gorm.DB) *AsaasCron {
	return &AsaasCron{
		db:          db,
		asaasClient: NewAsaasClient(db),
		stop:        make(chan struct{}),
	}
}

func (c *AsaasCron) Start() {
	go c.loop()
	log.Info().Msg("asaas cron: started (1h interval)")
}

func (c *AsaasCron) Stop() {
	close(c.stop)
}

func (c *AsaasCron) loop() {
	// Roda imediato no startup pra apanhar pendentes que ficaram parados,
	// depois a cada hora.
	c.tick()
	t := time.NewTicker(1 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
			c.tick()
		}
	}
}

// tick processa todos os users com asaas_cancel_at <= now.
func (c *AsaasCron) tick() {
	defer func() {
		// Panic recovery: sem isso uma falha (ex: row corrompido, JSON
		// inválido em Subscription.metadata) mata a goroutine do loop()
		// e ninguém processa cancelamentos até reboot.
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("asaas cron tick: panic recovered")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var users []models.User
	now := time.Now()
	if err := c.db.WithContext(ctx).
		Where("asaas_cancel_at IS NOT NULL AND asaas_cancel_at <= ? AND asaas_subscription_id != ''", now).
		Find(&users).Error; err != nil {
		log.Warn().Err(err).Msg("asaas cron: query failed")
		return
	}
	if len(users) == 0 {
		return
	}
	log.Info().Int("count", len(users)).Msg("asaas cron: processing pending cancellations")

	for i := range users {
		c.processUser(&users[i])
	}
}

func (c *AsaasCron) processUser(user *models.User) {
	// Deleta a subscription no Asaas. Idempotente: se já deletou
	// (404), tratamos como sucesso pra não ficar em loop.
	if err := c.asaasClient.DeleteSubscription(user.AsaasSubscriptionID); err != nil {
		// Asaas devolve 404 com mensagem; continuamos pra fazer downgrade
		// local mesmo assim — sub não vai cobrar de qualquer jeito.
		log.Warn().Err(err).Str("user", user.ID.String()).Str("sub", user.AsaasSubscriptionID).
			Msg("asaas cron: delete subscription failed (continuing with local downgrade)")
	}

	// Downgrade pra Free.
	var freePlan models.Plan
	if err := c.db.Where("price = 0 AND is_active = true").Order("created_at ASC").First(&freePlan).Error; err != nil {
		log.Error().Err(err).Msg("asaas cron: free plan not found — cannot downgrade")
		// Mesmo sem free plan, limpa os campos asaas pra não tentar de novo.
		c.db.Model(user).Updates(map[string]any{
			"asaas_subscription_id":     "",
			"asaas_subscription_status": "CANCELLED",
			"asaas_cancel_at":           nil,
		})
		return
	}

	oldPlanID := user.PlanID
	updates := map[string]any{
		"plan_id":                   freePlan.ID,
		"asaas_subscription_id":     "",
		"asaas_subscription_status": "CANCELLED",
		"asaas_cancel_at":           nil,
	}
	if err := c.db.Model(user).Updates(updates).Error; err != nil {
		log.Error().Err(err).Str("user", user.ID.String()).Msg("asaas cron: db update failed")
		return
	}

	// Audit log do cancelamento.
	var oldPlan models.Plan
	if oldPlanID != nil {
		_ = c.db.First(&oldPlan, "id = ?", *oldPlanID).Error
	}
	c.db.Create(&models.PlanChangeLog{
		UserID:       user.ID,
		FromPlanID:   oldPlanID,
		ToPlanID:     &freePlan.ID,
		FromPlanName: oldPlan.Name,
		ToPlanName:   freePlan.Name,
		Source:       models.PlanChangeSourceTrial, // reuso "trial" pra cancelamento programado — adicionar source dedicado depois
		Notes:        "Cancelamento agendado executado pelo cron Asaas (cancel_at_period_end emulado).",
	})

	log.Info().Str("user", user.ID.String()).Str("from", oldPlan.Name).Str("to", freePlan.Name).
		Msg("asaas cron: scheduled cancellation executed")
}
