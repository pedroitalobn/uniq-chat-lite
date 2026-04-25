package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type ReportsHandler struct{ db *gorm.DB }

func NewReportsHandler(db *gorm.DB) *ReportsHandler { return &ReportsHandler{db: db} }

// parseRange pulls ?from=&to= as RFC3339, defaulting to the last 7 days.
func parseRange(c *fiber.Ctx) (time.Time, time.Time) {
	now := time.Now()
	from := now.Add(-7 * 24 * time.Hour)
	to := now
	if raw := c.Query("from"); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			from = t
		}
	}
	if raw := c.Query("to"); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			to = t
		}
	}
	return from, to
}

// Overview GET /v1/reports/overview
// Counters + simple daily timeseries (created, resolved) for the range.
func (h *ReportsHandler) Overview(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	from, to := parseRange(c)

	counts := fiber.Map{}
	var created, resolved, closed, openNow, backlog int64

	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND created_at BETWEEN ? AND ?", ws, from, to).
		Count(&created)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND resolved_at IS NOT NULL AND resolved_at BETWEEN ? AND ?", ws, from, to).
		Count(&resolved)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND closed_at IS NOT NULL AND closed_at BETWEEN ? AND ?", ws, from, to).
		Count(&closed)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND status = ?", ws, models.ConversationStatusOpen).
		Count(&openNow)
	h.db.Model(&models.Conversation{}).
		Where("workspace_id = ? AND status IN ?", ws,
			[]models.ConversationStatus{models.ConversationStatusOpen, models.ConversationStatusPending}).
		Count(&backlog)

	counts["created"] = created
	counts["resolved"] = resolved
	counts["closed"] = closed
	counts["open_now"] = openNow
	counts["backlog"] = backlog

	type bucket struct {
		Day      string `json:"day"`
		Created  int64  `json:"created"`
		Resolved int64  `json:"resolved"`
	}
	var series []bucket
	if h.db.Dialector.Name() == "postgres" {
		h.db.Raw(`
			WITH days AS (
				SELECT generate_series(date_trunc('day', ?::timestamptz), date_trunc('day', ?::timestamptz), '1 day') AS d
			)
			SELECT to_char(days.d, 'YYYY-MM-DD') AS day,
			       COALESCE(c.created, 0) AS created,
			       COALESCE(r.resolved, 0) AS resolved
			FROM days
			LEFT JOIN (
				SELECT date_trunc('day', created_at) AS d, COUNT(*) AS created
				FROM conversations
				WHERE workspace_id = ? AND created_at BETWEEN ? AND ?
				GROUP BY 1
			) c ON c.d = days.d
			LEFT JOIN (
				SELECT date_trunc('day', resolved_at) AS d, COUNT(*) AS resolved
				FROM conversations
				WHERE workspace_id = ? AND resolved_at BETWEEN ? AND ?
				GROUP BY 1
			) r ON r.d = days.d
			ORDER BY days.d
		`, from, to, ws, from, to, ws, from, to).Scan(&series)
	}

	return c.JSON(fiber.Map{
		"counts":     counts,
		"series":     series,
		"from":       from,
		"to":         to,
	})
}

// ByQueue GET /v1/reports/by-queue
func (h *ReportsHandler) ByQueue(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	from, to := parseRange(c)

	type row struct {
		QueueID  string `json:"queue_id"`
		Name     string `json:"name"`
		Created  int64  `json:"created"`
		Resolved int64  `json:"resolved"`
		Backlog  int64  `json:"backlog"`
	}
	rows := []row{}
	h.db.Raw(`
		SELECT q.id AS queue_id, q.name,
		       COUNT(c.id) FILTER (WHERE c.created_at BETWEEN ? AND ?) AS created,
		       COUNT(c.id) FILTER (WHERE c.resolved_at BETWEEN ? AND ?) AS resolved,
		       COUNT(c.id) FILTER (WHERE c.status IN ('open','pending')) AS backlog
		FROM queues q
		LEFT JOIN conversations c ON c.queue_id = q.id AND c.workspace_id = q.workspace_id
		WHERE q.workspace_id = ?
		GROUP BY q.id, q.name
		ORDER BY created DESC
	`, from, to, from, to, ws).Scan(&rows)
	return c.JSON(fiber.Map{"items": rows, "from": from, "to": to})
}

// ByUser GET /v1/reports/by-user
func (h *ReportsHandler) ByUser(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	from, to := parseRange(c)

	type row struct {
		UserID     string  `json:"user_id"`
		Name       string  `json:"name"`
		Email      string  `json:"email"`
		Assigned   int64   `json:"assigned"`
		Resolved   int64   `json:"resolved"`
		AvgFirstResponseSec float64 `json:"avg_first_response_sec"`
	}
	rows := []row{}
	h.db.Raw(`
		SELECT u.id AS user_id, u.name, u.email,
		       COUNT(c.id) FILTER (WHERE c.assigned_user_id = u.id) AS assigned,
		       COUNT(c.id) FILTER (WHERE c.assigned_user_id = u.id AND c.resolved_at BETWEEN ? AND ?) AS resolved,
		       COALESCE(AVG(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at)))
		                  FILTER (WHERE c.assigned_user_id = u.id AND c.first_response_at IS NOT NULL), 0) AS avg_first_response_sec
		FROM users u
		JOIN user_workspaces uw ON uw.user_id = u.id AND uw.workspace_id = ?
		LEFT JOIN conversations c ON c.workspace_id = uw.workspace_id
		GROUP BY u.id, u.name, u.email
		ORDER BY resolved DESC, assigned DESC
	`, from, to, ws).Scan(&rows)
	return c.JSON(fiber.Map{"items": rows, "from": from, "to": to})
}

// CSAT GET /v1/reports/csat
func (h *ReportsHandler) CSAT(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	from, to := parseRange(c)

	var sent, answered int64
	var avg float64
	h.db.Model(&models.CSATSurvey{}).
		Where("workspace_id = ? AND sent_at BETWEEN ? AND ?", ws, from, to).
		Count(&sent)
	h.db.Model(&models.CSATSurvey{}).
		Where("workspace_id = ? AND answered_at IS NOT NULL AND answered_at BETWEEN ? AND ?", ws, from, to).
		Count(&answered)
	h.db.Raw(`
		SELECT COALESCE(AVG(rating), 0)
		FROM csat_surveys
		WHERE workspace_id = ? AND rating IS NOT NULL AND answered_at BETWEEN ? AND ?
	`, ws, from, to).Scan(&avg)

	// Rating distribution
	type ratingRow struct {
		Rating int   `json:"rating"`
		Count  int64 `json:"count"`
	}
	dist := []ratingRow{}
	h.db.Raw(`
		SELECT rating, COUNT(*) AS count
		FROM csat_surveys
		WHERE workspace_id = ? AND rating IS NOT NULL AND answered_at BETWEEN ? AND ?
		GROUP BY rating
		ORDER BY rating
	`, ws, from, to).Scan(&dist)

	responseRate := 0.0
	if sent > 0 {
		responseRate = float64(answered) / float64(sent)
	}
	return c.JSON(fiber.Map{
		"sent":          sent,
		"answered":      answered,
		"response_rate": responseRate,
		"avg_rating":    avg,
		"distribution":  dist,
		"from":          from,
		"to":            to,
	})
}

// SLA GET /v1/reports/sla
func (h *ReportsHandler) SLA(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	from, to := parseRange(c)

	var firstResponseBreaches, resolutionBreaches int64
	h.db.Model(&models.ConversationEvent{}).
		Where("workspace_id = ? AND event_type = ? AND created_at BETWEEN ? AND ? AND payload LIKE ?",
			ws, models.ConvEventSLABreached, from, to, `%"sla_type":"first_response"%`).
		Count(&firstResponseBreaches)
	h.db.Model(&models.ConversationEvent{}).
		Where("workspace_id = ? AND event_type = ? AND created_at BETWEEN ? AND ? AND payload LIKE ?",
			ws, models.ConvEventSLABreached, from, to, `%"sla_type":"resolution"%`).
		Count(&resolutionBreaches)
	return c.JSON(fiber.Map{
		"first_response_breaches": firstResponseBreaches,
		"resolution_breaches":     resolutionBreaches,
		"from":                    from,
		"to":                      to,
	})
}
