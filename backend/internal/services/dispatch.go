// Package services — DispatchService resolves the Queue for a newly-created
// Conversation and, if AutoAssignOnOpen is true, picks the next agent using
// the Queue.AssignmentStrategy. Concurrency is handled per-queue via a
// Postgres advisory lock so parallel inbound from different contacts don't
// race onto the same agent.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// DispatchService is the routing + auto-assignment pipeline for new tickets.
type DispatchService struct {
	db *gorm.DB
}

func NewDispatchService(db *gorm.DB) *DispatchService {
	return &DispatchService{db: db}
}

// AssignNewConversation attaches a Queue to the conversation and, when
// possible, assigns an available agent. Safe to call for conversations that
// already have a Queue or Assignee — it becomes a no-op in that case.
func (s *DispatchService) AssignNewConversation(ctx context.Context, conv *models.Conversation) error {
	if conv == nil || conv.ID == uuid.Nil {
		return errors.New("dispatch: conversation is required")
	}
	if conv.AssignedUserID != nil {
		return nil // already assigned; nothing to do
	}
	queue, err := s.resolveQueue(ctx, conv)
	if err != nil {
		return err
	}
	if queue == nil {
		// No queue configured — leave the conversation as "unassigned" for the
		// supervisor view. No error.
		return nil
	}

	// Set department/team from the queue (if not already set)
	updates := map[string]any{
		"queue_id":      queue.ID,
		"department_id": queue.DepartmentID,
		"team_id":       queue.TeamID,
	}
	s.db.WithContext(ctx).Model(conv).Updates(updates)
	conv.QueueID = &queue.ID
	conv.DepartmentID = queue.DepartmentID
	conv.TeamID = queue.TeamID

	if !queue.AutoAssignOnOpen || queue.AssignmentStrategy == models.QueueStrategyManual {
		return nil
	}

	if !s.isBusinessHours(queue, time.Now()) {
		// Outside business hours: leave as pending for later distribution
		s.db.WithContext(ctx).Model(conv).Update("status", models.ConversationStatusPending)
		conv.Status = models.ConversationStatusPending
		return nil
	}

	// Sticky-owner short-circuit (only when the strategy explicitly opts in)
	if queue.AssignmentStrategy == models.QueueStrategyStickyOwner && conv.ContactID != nil {
		if owner := s.pickContactOwner(ctx, *conv.ContactID, queue); owner != nil {
			return s.doAssign(ctx, conv, *owner, queue, "sticky_owner")
		}
	}

	user := s.pickUser(ctx, queue)
	if user == nil {
		// No candidate — park as pending until a member becomes available
		s.db.WithContext(ctx).Model(conv).Update("status", models.ConversationStatusPending)
		conv.Status = models.ConversationStatusPending
		return nil
	}
	return s.doAssign(ctx, conv, *user, queue, "auto")
}

// -- queue resolution -------------------------------------------------------

// resolveQueue picks the Queue that should receive a new conversation.
// Order:
//   1. Queue already referenced by Contact.DefaultQueueID (sticky)
//   2. QueueChannel for (instance_id) with is_default=true
//   3. First active QueueChannel for (instance_id)
//   4. nil (no queue — unassigned)
func (s *DispatchService) resolveQueue(ctx context.Context, conv *models.Conversation) (*models.Queue, error) {
	db := s.db.WithContext(ctx)

	if conv.QueueID != nil {
		var q models.Queue
		if err := db.First(&q, "id = ? AND workspace_id = ?", *conv.QueueID, conv.WorkspaceID).Error; err == nil {
			return &q, nil
		}
	}

	if conv.ContactID != nil {
		var contact models.Contact
		if err := db.Select("default_queue_id").First(&contact, "id = ?", *conv.ContactID).Error; err == nil && contact.DefaultQueueID != nil {
			var q models.Queue
			if err := db.First(&q, "id = ? AND workspace_id = ? AND is_active = true", *contact.DefaultQueueID, conv.WorkspaceID).Error; err == nil {
				return &q, nil
			}
		}
	}

	var qc models.QueueChannel
	if err := db.Where("instance_id = ? AND is_default = true", conv.InstanceID).First(&qc).Error; err == nil {
		var q models.Queue
		if err := db.First(&q, "id = ? AND workspace_id = ? AND is_active = true", qc.QueueID, conv.WorkspaceID).Error; err == nil {
			return &q, nil
		}
	}
	if err := db.Where("instance_id = ?", conv.InstanceID).Order("is_default DESC, created_at ASC").First(&qc).Error; err == nil {
		var q models.Queue
		if err := db.First(&q, "id = ? AND workspace_id = ? AND is_active = true", qc.QueueID, conv.WorkspaceID).Error; err == nil {
			return &q, nil
		}
	}

	return nil, nil
}

// -- candidate selection ---------------------------------------------------

type candidate struct {
	UserID         uuid.UUID
	Priority       int
	ActiveCount    int
	MaxLoad        int
	LastAssignedAt *time.Time
}

// pickUser selects the next agent within the queue using the configured
// strategy. Serialized per-queue via pg_advisory_xact_lock so two goroutines
// never resolve to the same candidate simultaneously.
func (s *DispatchService) pickUser(ctx context.Context, queue *models.Queue) *uuid.UUID {
	var chosen *uuid.UUID
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		s.lockQueue(tx, queue.ID)
		cands := s.loadCandidates(tx, queue)
		if len(cands) == 0 {
			return nil
		}
		switch queue.AssignmentStrategy {
		case models.QueueStrategyLeastBusy:
			chosen = pickLeastBusy(cands)
		case models.QueueStrategyLoadBalanced:
			chosen = pickWeightedRandom(cands)
		case models.QueueStrategyStickyOwner, models.QueueStrategyRoundRobin:
			chosen = pickRoundRobin(cands)
		default:
			chosen = pickRoundRobin(cands)
		}
		return nil
	})
	if err != nil {
		log.Warn().Err(err).Str("queue_id", queue.ID.String()).Msg("dispatch: pickUser failed")
		return nil
	}
	return chosen
}

// lockQueue takes an advisory lock scoped to the queue_id string. The lock is
// released when the transaction commits/rolls back — no extra bookkeeping.
// SQLite (dev) silently ignores the lock.
func (s *DispatchService) lockQueue(tx *gorm.DB, queueID uuid.UUID) {
	if tx.Dialector.Name() != "postgres" {
		return
	}
	tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "queue:"+queueID.String())
}

func (s *DispatchService) loadCandidates(tx *gorm.DB, queue *models.Queue) []candidate {
	type row struct {
		UserID         uuid.UUID
		Priority       int
		LastAssignedAt *time.Time
		ActiveCount    int
		MaxLoad        int
		Status         string
	}
	var rows []row
	tx.Raw(`
		SELECT qm.user_id, qm.priority, qm.last_assigned_at,
		       COALESCE(up.active_count, 0) AS active_count,
		       COALESCE(up.max_load, 0)     AS max_load,
		       COALESCE(up.status, 'offline') AS status
		FROM queue_members qm
		LEFT JOIN user_presences up
		       ON up.user_id = qm.user_id AND up.workspace_id = ?
		WHERE qm.queue_id = ? AND qm.can_receive = true
	`, queue.WorkspaceID, queue.ID).Scan(&rows)

	out := make([]candidate, 0, len(rows))
	for _, r := range rows {
		// Only online agents qualify as candidates
		if r.Status != string(models.PresenceOnline) {
			continue
		}
		// Respect per-user max load override, then the queue-level ceiling
		if r.MaxLoad > 0 && r.ActiveCount >= r.MaxLoad {
			continue
		}
		if queue.MaxConcurrentPerUser > 0 && r.ActiveCount >= queue.MaxConcurrentPerUser {
			continue
		}
		out = append(out, candidate{
			UserID:         r.UserID,
			Priority:       r.Priority,
			ActiveCount:    r.ActiveCount,
			MaxLoad:        r.MaxLoad,
			LastAssignedAt: r.LastAssignedAt,
		})
	}
	return out
}

// pickContactOwner returns Contact.OwnerID if that user is a queue member and
// currently able to receive. Used by the sticky_owner strategy.
func (s *DispatchService) pickContactOwner(ctx context.Context, contactID uuid.UUID, queue *models.Queue) *uuid.UUID {
	var contact models.Contact
	if err := s.db.WithContext(ctx).Select("owner_id").First(&contact, "id = ?", contactID).Error; err != nil {
		return nil
	}
	if contact.OwnerID == nil {
		return nil
	}
	var qm models.QueueMember
	err := s.db.WithContext(ctx).
		Where("queue_id = ? AND user_id = ? AND can_receive = true", queue.ID, *contact.OwnerID).
		First(&qm).Error
	if err != nil {
		return nil
	}
	// Must also be online
	var p models.UserPresence
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND workspace_id = ?", *contact.OwnerID, queue.WorkspaceID).
		First(&p).Error; err != nil {
		return nil
	}
	if p.Status != models.PresenceOnline {
		return nil
	}
	return contact.OwnerID
}

// pickRoundRobin returns the candidate with the oldest LastAssignedAt
// (a nil cursor wins — never-used agents are preferred).
func pickRoundRobin(cands []candidate) *uuid.UUID {
	if len(cands) == 0 {
		return nil
	}
	best := cands[0]
	for _, c := range cands[1:] {
		if bestIsWorse(best, c) {
			best = c
		}
	}
	return &best.UserID
}

func bestIsWorse(a, b candidate) bool {
	// Higher priority wins
	if b.Priority != a.Priority {
		return b.Priority > a.Priority
	}
	// Prefer never-assigned (nil) over any assigned timestamp
	if a.LastAssignedAt == nil {
		return false
	}
	if b.LastAssignedAt == nil {
		return true
	}
	return b.LastAssignedAt.Before(*a.LastAssignedAt)
}

func pickLeastBusy(cands []candidate) *uuid.UUID {
	if len(cands) == 0 {
		return nil
	}
	best := cands[0]
	for _, c := range cands[1:] {
		if c.ActiveCount < best.ActiveCount ||
			(c.ActiveCount == best.ActiveCount && c.Priority > best.Priority) {
			best = c
		}
	}
	return &best.UserID
}

func pickWeightedRandom(cands []candidate) *uuid.UUID {
	if len(cands) == 0 {
		return nil
	}
	// Weight = (Priority+1) * 1/(ActiveCount+1). Higher weight → more likely.
	total := 0.0
	weights := make([]float64, len(cands))
	for i, c := range cands {
		w := float64(c.Priority+1) / float64(c.ActiveCount+1)
		weights[i] = w
		total += w
	}
	if total <= 0 {
		return &cands[0].UserID
	}
	r := rand.Float64() * total
	acc := 0.0
	for i, w := range weights {
		acc += w
		if r <= acc {
			return &cands[i].UserID
		}
	}
	return &cands[len(cands)-1].UserID
}

// -- assignment writer ------------------------------------------------------

func (s *DispatchService) doAssign(ctx context.Context, conv *models.Conversation, userID uuid.UUID, queue *models.Queue, reason string) error {
	prev := conv.AssignedUserID
	now := time.Now()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Race-safe: only update if still unassigned
		res := tx.Model(&models.Conversation{}).
			Where("id = ? AND assigned_user_id IS NULL", conv.ID).
			Updates(map[string]any{
				"assigned_user_id": userID,
				"status":           models.ConversationStatusOpen,
			})
		if res.RowsAffected == 0 {
			// Someone else won — bail out quietly
			return errors.New("already assigned")
		}
		// Bump queue-member round-robin cursor
		tx.Model(&models.QueueMember{}).
			Where("queue_id = ? AND user_id = ?", queue.ID, userID).
			Update("last_assigned_at", now)

		// Update presence workload counter
		tx.Model(&models.UserPresence{}).
			Where("user_id = ? AND workspace_id = ?", userID, conv.WorkspaceID).
			Update("active_count", gorm.Expr("active_count + 1"))

		// Append events
		tx.Create(&models.ConversationAssignment{
			ConversationID: conv.ID,
			WorkspaceID:    conv.WorkspaceID,
			FromUserID:     prev,
			ToUserID:       &userID,
			FromQueueID:    nil,
			ToQueueID:      &queue.ID,
			Reason:         reason,
			CreatedAt:      now,
		})
		payload, _ := json.Marshal(map[string]any{
			"to_user_id": userID,
			"queue_id":   queue.ID,
			"reason":     reason,
		})
		tx.Create(&models.ConversationEvent{
			ConversationID: conv.ID,
			WorkspaceID:    conv.WorkspaceID,
			ActorType:      models.ActorSystem,
			EventType:      models.ConvEventAssignmentChanged,
			Payload:        string(payload),
			CreatedAt:      now,
		})
		return nil
	})
	if err != nil {
		return err
	}
	conv.AssignedUserID = &userID
	conv.Status = models.ConversationStatusOpen
	return nil
}

// -- business hours ---------------------------------------------------------

// isBusinessHours returns true when the given time falls inside the queue's
// business hours window. Empty BusinessHoursJSON means "always open".
//
// JSON shape:
//   {
//     "mon": {"start": "09:00", "end": "18:00"},
//     "tue": {"start": "09:00", "end": "18:00"},
//     ...
//   }
func (s *DispatchService) isBusinessHours(queue *models.Queue, now time.Time) bool {
	if queue.BusinessHoursJSON == "" {
		return true
	}
	loc := time.UTC
	if queue.TimezoneTZ != "" {
		if l, err := time.LoadLocation(queue.TimezoneTZ); err == nil {
			loc = l
		}
	}
	local := now.In(loc)
	key := []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}[int(local.Weekday())]

	var schedule map[string]struct {
		Start string `json:"start"`
		End   string `json:"end"`
	}
	if err := json.Unmarshal([]byte(queue.BusinessHoursJSON), &schedule); err != nil {
		// Malformed config — treat as always open rather than silently closing
		log.Warn().Err(err).Str("queue_id", queue.ID.String()).Msg("dispatch: invalid business_hours_json")
		return true
	}
	day, ok := schedule[key]
	if !ok || day.Start == "" || day.End == "" {
		return false
	}
	start, err1 := time.ParseInLocation("15:04", day.Start, loc)
	end, err2 := time.ParseInLocation("15:04", day.End, loc)
	if err1 != nil || err2 != nil {
		return true
	}
	// Anchor start/end to today's date in the queue's timezone
	y, m, d := local.Date()
	s0 := time.Date(y, m, d, start.Hour(), start.Minute(), 0, 0, loc)
	e0 := time.Date(y, m, d, end.Hour(), end.Minute(), 0, 0, loc)
	return (local.Equal(s0) || local.After(s0)) && local.Before(e0)
}

// -- helpers exposed to scheduler -------------------------------------------

// UnassignAndReroute clears the assignee and, if the queue still has online
// agents, auto-assigns someone else. Used by the "away too long" scheduler.
func (s *DispatchService) UnassignAndReroute(ctx context.Context, convID uuid.UUID, reason string) error {
	var conv models.Conversation
	if err := s.db.WithContext(ctx).First(&conv, "id = ?", convID).Error; err != nil {
		return err
	}
	prev := conv.AssignedUserID
	now := time.Now()
	// Decrement previous workload
	if prev != nil {
		s.db.WithContext(ctx).Model(&models.UserPresence{}).
			Where("user_id = ? AND workspace_id = ? AND active_count > 0", *prev, conv.WorkspaceID).
			Update("active_count", gorm.Expr("active_count - 1"))
	}
	s.db.WithContext(ctx).Model(&conv).Updates(map[string]any{
		"assigned_user_id": nil,
		"status":           models.ConversationStatusPending,
	})
	s.db.WithContext(ctx).Create(&models.ConversationAssignment{
		ConversationID: conv.ID,
		WorkspaceID:    conv.WorkspaceID,
		FromUserID:     prev,
		ToUserID:       nil,
		Reason:         reason,
		CreatedAt:      now,
	})
	conv.AssignedUserID = nil
	conv.Status = models.ConversationStatusPending
	return s.AssignNewConversation(ctx, &conv)
}
