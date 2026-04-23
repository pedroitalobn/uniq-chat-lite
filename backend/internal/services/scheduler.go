// Package services — TicketingScheduler runs the periodic jobs required by
// the ticketing subsystem:
//   - unsnoozer: flip snoozed conversations back to open when snoozed_until passes
//   - presence sweeper: mark agents offline when heartbeat is stale
//   - pending redistribution: periodically re-try dispatch for pending tickets
//     when new agents come online
//   - auto-close resolved: close resolved tickets older than Queue.AutoCloseAfterHours
package services

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

const (
	presenceHeartbeatTTL   = 2 * time.Minute  // mark offline if no heartbeat in this window
	pendingRedispatchEvery = 30 * time.Second // re-try pending tickets this often
	unsnoozerEvery         = 60 * time.Second
	resolveSweepEvery      = 5 * time.Minute
	slaSweepEvery          = 60 * time.Second
)

type TicketingScheduler struct {
	db       *gorm.DB
	dispatch *DispatchService
	done     chan struct{}
}

func NewTicketingScheduler(db *gorm.DB, dispatch *DispatchService) *TicketingScheduler {
	return &TicketingScheduler{db: db, dispatch: dispatch, done: make(chan struct{})}
}

// Start launches the background goroutines. Call once at bootstrap.
func (s *TicketingScheduler) Start() {
	go s.loop("unsnoozer", unsnoozerEvery, s.runUnsnoozer)
	go s.loop("presence-sweep", presenceHeartbeatTTL/2, s.runPresenceSweep)
	go s.loop("pending-redispatch", pendingRedispatchEvery, s.runPendingRedispatch)
	go s.loop("resolve-sweep", resolveSweepEvery, s.runAutoCloseResolved)
	go s.loop("sla-sweep", slaSweepEvery, s.runSLABreachDetection)
	log.Info().Msg("ticketing scheduler started")
}

// Stop terminates the scheduler goroutines gracefully.
func (s *TicketingScheduler) Stop() { close(s.done) }

func (s *TicketingScheduler) loop(name string, period time.Duration, fn func(context.Context)) {
	t := time.NewTicker(period)
	defer t.Stop()
	ctx := context.Background()
	// Kick off one run immediately so the first tick doesn't wait `period`
	fn(ctx)
	for {
		select {
		case <-t.C:
			fn(ctx)
		case <-s.done:
			log.Info().Str("job", name).Msg("ticketing scheduler: stopped")
			return
		}
	}
}

// runUnsnoozer finds conversations whose snooze timer expired and flips them
// back to open, appending an event.
func (s *TicketingScheduler) runUnsnoozer(ctx context.Context) {
	now := time.Now()
	var convs []models.Conversation
	s.db.WithContext(ctx).
		Where("status = ? AND snoozed_until IS NOT NULL AND snoozed_until <= ?", models.ConversationStatusSnoozed, now).
		Limit(500).
		Find(&convs)
	if len(convs) == 0 {
		return
	}
	for i := range convs {
		conv := &convs[i]
		s.db.WithContext(ctx).Model(conv).Updates(map[string]any{
			"status":        models.ConversationStatusOpen,
			"snoozed_until": nil,
		})
		s.db.WithContext(ctx).Create(&models.ConversationEvent{
			ConversationID: conv.ID,
			WorkspaceID:    conv.WorkspaceID,
			ActorType:      models.ActorSystem,
			EventType:      models.ConvEventUnsnoozed,
			CreatedAt:      now,
		})
	}
	log.Debug().Int("count", len(convs)).Msg("unsnoozer: reopened")
}

// runPresenceSweep marks offline any presence row whose heartbeat is older
// than presenceHeartbeatTTL. Frontend presence-provider pings every ~60s.
func (s *TicketingScheduler) runPresenceSweep(ctx context.Context) {
	cutoff := time.Now().Add(-presenceHeartbeatTTL)
	res := s.db.WithContext(ctx).
		Model(&models.UserPresence{}).
		Where("status IN ? AND last_seen_at < ?",
			[]models.PresenceStatus{models.PresenceOnline, models.PresenceBusy, models.PresenceAway},
			cutoff).
		Update("status", models.PresenceOffline)
	if res.RowsAffected > 0 {
		log.Debug().Int64("count", res.RowsAffected).Msg("presence-sweep: marked offline")
	}
}

// runPendingRedispatch re-tries dispatch for conversations parked in pending
// (e.g. no agent was available at creation time). When a queue member comes
// online this sweep is what picks them up.
func (s *TicketingScheduler) runPendingRedispatch(ctx context.Context) {
	if s.dispatch == nil {
		return
	}
	var convs []models.Conversation
	s.db.WithContext(ctx).
		Where("status = ? AND assigned_user_id IS NULL", models.ConversationStatusPending).
		Order("last_message_at ASC NULLS FIRST").
		Limit(200).
		Find(&convs)
	for i := range convs {
		conv := &convs[i]
		if err := s.dispatch.AssignNewConversation(ctx, conv); err != nil {
			log.Debug().Err(err).Str("conv_id", conv.ID.String()).Msg("pending-redispatch")
		}
	}
}

// runSLABreachDetection detects conversations that crossed either the
// first-response SLA (open, no agent reply yet, older than threshold) or the
// resolution SLA (open, older than threshold). Each breach emits a single
// sla_breached event — we rely on a lookup against conversation_events to
// avoid duplicating the alert per sweep.
func (s *TicketingScheduler) runSLABreachDetection(ctx context.Context) {
	// SLA detection uses Postgres-specific SQL; SQLite (dev) skips it.
	if s.db.Dialector.Name() != "postgres" {
		return
	}
	now := time.Now()
	// First-response SLA: created_at + first_response_sla_minutes < now AND first_response_at IS NULL
	type row struct {
		ID          string
		WorkspaceID string
		SLAType     string // "first_response" | "resolution"
		DueAt       time.Time
	}
	var rows []row
	s.db.WithContext(ctx).Raw(`
		SELECT c.id::text AS id, c.workspace_id::text AS workspace_id,
		       'first_response' AS sla_type,
		       (c.created_at + make_interval(mins => q.first_response_sla_minutes)) AS due_at
		FROM conversations c
		JOIN queues q ON q.id = c.queue_id
		WHERE c.status IN ('open','pending')
		  AND q.first_response_sla_minutes > 0
		  AND c.first_response_at IS NULL
		  AND (c.created_at + make_interval(mins => q.first_response_sla_minutes)) <= ?
		  AND NOT EXISTS (
		    SELECT 1 FROM conversation_events e
		    WHERE e.conversation_id = c.id
		      AND e.event_type = 'sla_breached'
		      AND e.payload LIKE '%"sla_type":"first_response"%'
		  )
		UNION ALL
		SELECT c.id::text AS id, c.workspace_id::text AS workspace_id,
		       'resolution' AS sla_type,
		       (c.created_at + make_interval(mins => q.resolution_sla_minutes)) AS due_at
		FROM conversations c
		JOIN queues q ON q.id = c.queue_id
		WHERE c.status IN ('open','pending')
		  AND q.resolution_sla_minutes > 0
		  AND (c.created_at + make_interval(mins => q.resolution_sla_minutes)) <= ?
		  AND NOT EXISTS (
		    SELECT 1 FROM conversation_events e
		    WHERE e.conversation_id = c.id
		      AND e.event_type = 'sla_breached'
		      AND e.payload LIKE '%"sla_type":"resolution"%'
		  )
		LIMIT 500
	`, now, now).Scan(&rows)

	if len(rows) == 0 {
		return
	}
	for _, r := range rows {
		payload := `{"sla_type":"` + r.SLAType + `","due_at":"` + r.DueAt.Format(time.RFC3339) + `"}`
		s.db.WithContext(ctx).Exec(`
			INSERT INTO conversation_events (id, conversation_id, workspace_id, actor_type, event_type, payload, created_at)
			VALUES (gen_random_uuid(), ?, ?, 'system', 'sla_breached', ?, ?)
		`, r.ID, r.WorkspaceID, payload, now)
	}
	log.Debug().Int("count", len(rows)).Msg("sla-sweep: breaches detected")
}

// runAutoCloseResolved closes resolved conversations that have been idle for
// longer than Queue.AutoCloseAfterHours. Zero disables the rule.
func (s *TicketingScheduler) runAutoCloseResolved(ctx context.Context) {
	if s.db.Dialector.Name() != "postgres" {
		return
	}
	now := time.Now()
	type row struct {
		ID        string
		WorkspaceID string
	}
	var rows []row
	// Join queues to read per-queue auto_close_after_hours; default 0 → skip.
	s.db.WithContext(ctx).Raw(`
		SELECT c.id, c.workspace_id
		FROM conversations c
		LEFT JOIN queues q ON q.id = c.queue_id
		WHERE c.status = ?
		  AND c.resolved_at IS NOT NULL
		  AND COALESCE(q.auto_close_after_hours, 0) > 0
		  AND c.resolved_at + make_interval(hours => q.auto_close_after_hours) <= ?
		LIMIT 500
	`, models.ConversationStatusResolved, now).Scan(&rows)
	if len(rows) == 0 {
		return
	}
	for _, r := range rows {
		s.db.WithContext(ctx).Model(&models.Conversation{}).
			Where("id = ?", r.ID).
			Updates(map[string]any{
				"status":    models.ConversationStatusClosed,
				"closed_at": now,
			})
	}
	log.Debug().Int("count", len(rows)).Msg("resolve-sweep: auto-closed")
}
