package services

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
)

// ComputedCron — cron que recalcula contact_computed via SQL agregado
// uma vez por hora. Estratégia simples e barata: roda 4 INSERT…SELECT
// idempotentes que materializam métricas por contato.
//
// Pra escala (>1M contatos), trocar por incremental triggered por
// eventos. Por ora, FULL refresh funciona em <50k.
type ComputedCron struct {
	db   *gorm.DB
	stop chan struct{}
}

func NewComputedCron(db *gorm.DB) *ComputedCron {
	return &ComputedCron{db: db, stop: make(chan struct{})}
}

func (c *ComputedCron) Start() {
	go c.loop()
	log.Info().Msg("computed cron: started (1h interval)")
}

func (c *ComputedCron) Stop() { close(c.stop) }

func (c *ComputedCron) loop() {
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

func (c *ComputedCron) tick() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("computed cron tick: panic recovered")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := c.refreshAll(ctx); err != nil {
		log.Error().Err(err).Msg("computed cron failed")
	}
}

func (c *ComputedCron) refreshAll(ctx context.Context) error {
	// Estratégia: UPSERT via INSERT ... ON CONFLICT pra cada contato com
	// agregados de orders + conversations + deals + journey_executions.
	//
	// Workspaces grandes podem expandir pra delta-update por timestamp.
	q := `
INSERT INTO contact_computed (
  contact_id, workspace_id,
  orders_total, orders_paid, orders_last_30d, lifetime_value, avg_ticket,
  last_order_at, first_order_at,
  conversations_total, conversations_open, messages_inbound, messages_outbound, last_message_at,
  deals_open, deals_won, deals_lost, deals_value,
  journeys_active, journeys_completed,
  updated_at
)
SELECT
  c.id::text, COALESCE(c.workspace_id, '00000000-0000-0000-0000-000000000000')::text,
  COALESCE(o.total_orders, 0),
  COALESCE(o.paid_orders, 0),
  COALESCE(o.orders_last_30d, 0),
  COALESCE(o.ltv, 0),
  COALESCE(o.avg_ticket, 0),
  o.last_at, o.first_at,
  COALESCE(cv.total, 0), COALESCE(cv.open, 0),
  COALESCE(m.inbound, 0), COALESCE(m.outbound, 0), m.last_msg_at,
  COALESCE(d.open_count, 0), COALESCE(d.won_count, 0), COALESCE(d.lost_count, 0),
  COALESCE(d.total_value, 0),
  COALESCE(j.active_count, 0), COALESCE(j.completed_count, 0),
  NOW()
FROM contacts c
LEFT JOIN (
  SELECT contact_id,
    COUNT(*) as total_orders,
    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
    SUM(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as orders_last_30d,
    COALESCE(SUM(total), 0) as ltv,
    COALESCE(AVG(total), 0) as avg_ticket,
    MAX(created_at) as last_at,
    MIN(created_at) as first_at
  FROM orders WHERE contact_id IS NOT NULL GROUP BY contact_id
) o ON o.contact_id = c.id
LEFT JOIN (
  SELECT contact_id, COUNT(*) as total,
    SUM(CASE WHEN status IN ('open','pending') THEN 1 ELSE 0 END) as open
  FROM conversations WHERE contact_id IS NOT NULL GROUP BY contact_id
) cv ON cv.contact_id = c.id
LEFT JOIN (
  SELECT cv.contact_id,
    SUM(CASE WHEN cm.direction = 'inbound' THEN 1 ELSE 0 END) as inbound,
    SUM(CASE WHEN cm.direction = 'outbound' THEN 1 ELSE 0 END) as outbound,
    MAX(cm.created_at) as last_msg_at
  FROM conversation_messages cm
  JOIN conversations cv ON cv.id = cm.conversation_id
  WHERE cv.contact_id IS NOT NULL
  GROUP BY cv.contact_id
) m ON m.contact_id = c.id
LEFT JOIN (
  SELECT contact_id,
    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_count,
    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_count,
    COALESCE(SUM(value)::numeric / 100.0, 0) as total_value
  FROM deals WHERE contact_id IS NOT NULL GROUP BY contact_id
) d ON d.contact_id = c.id
LEFT JOIN (
  SELECT contact_id,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
  FROM journey_executions WHERE contact_id IS NOT NULL GROUP BY contact_id
) j ON j.contact_id = c.id
ON CONFLICT (contact_id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id,
  orders_total = EXCLUDED.orders_total,
  orders_paid = EXCLUDED.orders_paid,
  orders_last_30d = EXCLUDED.orders_last_30d,
  lifetime_value = EXCLUDED.lifetime_value,
  avg_ticket = EXCLUDED.avg_ticket,
  last_order_at = EXCLUDED.last_order_at,
  first_order_at = EXCLUDED.first_order_at,
  conversations_total = EXCLUDED.conversations_total,
  conversations_open = EXCLUDED.conversations_open,
  messages_inbound = EXCLUDED.messages_inbound,
  messages_outbound = EXCLUDED.messages_outbound,
  last_message_at = EXCLUDED.last_message_at,
  deals_open = EXCLUDED.deals_open,
  deals_won = EXCLUDED.deals_won,
  deals_lost = EXCLUDED.deals_lost,
  deals_value = EXCLUDED.deals_value,
  journeys_active = EXCLUDED.journeys_active,
  journeys_completed = EXCLUDED.journeys_completed,
  updated_at = NOW();
`
	return c.db.WithContext(ctx).Exec(q).Error
}
