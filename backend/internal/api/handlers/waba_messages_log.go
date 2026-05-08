package handlers

import (
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/uniq-chat/backend/internal/models"
)

// GetMessagesLog — GET /v1/instances/:id/waba/messages-log
//
// Painel de controle de envios pra instância WABA. Lista MessageLog
// outbound com status, destinatário, timestamp, erro, link com a
// conversation. Suporta filtros: status, busca por telefone/nome,
// tipo, range de datas. Paginação keyset (created_at desc).
//
// Resposta inclui stats agregados (total, sent, delivered, read,
// failed nas últimas 24h) pra header da UI.
//
// Query params:
//   status   — pending|sent|delivered|read|failed|all (default all)
//   q        — busca em to_jid OR contact_name (LIKE %q%)
//   type     — text|template|image|audio|video|document (opcional)
//   from     — RFC3339 (opcional)
//   to       — RFC3339 (opcional)
//   limit    — default 50, max 200
//   offset   — default 0
func (h *WABAHandler) GetMessagesLog(c *fiber.Ctx) error {
	instanceID := c.Params("id")
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA instance not found"})
	}

	statusFilter := strings.ToLower(strings.TrimSpace(c.Query("status", "all")))
	q := strings.TrimSpace(c.Query("q", ""))
	typeFilter := strings.ToLower(strings.TrimSpace(c.Query("type", "")))

	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	if offset < 0 {
		offset = 0
	}

	query := h.db.Model(&models.MessageLog{}).
		Where("instance_id = ?", waba.InstanceID).
		Where("direction = ?", models.DirectionOut).
		Where("is_internal_note = ?", false).
		Where("is_deleted = ?", false)

	if statusFilter != "all" && statusFilter != "" {
		query = query.Where("status = ?", statusFilter)
	}
	if typeFilter != "" {
		query = query.Where("type = ?", typeFilter)
	}
	if q != "" {
		// LIKE em telefone (to_jid contém número) e em contact_name.
		// Evita full text — base é pequena por instância e índice
		// (instance_id, created_at) já cobre o filtro principal.
		like := "%" + q + "%"
		query = query.Where("to_jid LIKE ? OR contact_name LIKE ?", like, like)
	}
	if fromStr := c.Query("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			query = query.Where("created_at >= ?", t)
		}
	}
	if toStr := c.Query("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			query = query.Where("created_at < ?", t)
		}
	}

	var total int64
	query.Count(&total)

	type row struct {
		ID                uuid.UUID  `json:"id"`
		ConversationID    *uuid.UUID `json:"conversation_id,omitempty"`
		Type              string     `json:"type"`
		ToJID             string     `json:"to_jid"`
		ContactName       string     `json:"contact_name"`
		Status            string     `json:"status"`
		ExternalMessageID string     `json:"external_message_id,omitempty"`
		DeliveryError     string     `json:"delivery_error,omitempty"`
		Content           string     `json:"content,omitempty"`
		DeliveredAt       *time.Time `json:"delivered_at,omitempty"`
		ReadAt            *time.Time `json:"read_at,omitempty"`
		CreatedAt         time.Time  `json:"created_at"`
	}
	var rows []row
	if err := query.
		Select("id, conversation_id, type, to_jid, contact_name, status, external_message_id, delivery_error, content, delivered_at, read_at, created_at").
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Scan(&rows).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Stats agregados das últimas 24h pro header da UI. Cada count é uma
	// query barata (índice por instance+status+created_at).
	day := time.Now().Add(-24 * time.Hour)
	stats := map[string]int64{}
	for _, st := range []models.MessageStatus{
		models.MessageStatusSent,
		models.MessageStatusDelivered,
		models.MessageStatusRead,
		models.MessageStatusFailed,
		models.MessageStatusPending,
	} {
		var n int64
		h.db.Model(&models.MessageLog{}).
			Where("instance_id = ? AND direction = ? AND status = ? AND created_at >= ?",
				waba.InstanceID, models.DirectionOut, st, day).
			Count(&n)
		stats[string(st)] = n
	}
	var total24h int64
	h.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND direction = ? AND created_at >= ?",
			waba.InstanceID, models.DirectionOut, day).
		Count(&total24h)
	stats["total_24h"] = total24h

	return c.JSON(fiber.Map{
		"items":  rows,
		"total":  total,
		"limit":  limit,
		"offset": offset,
		"stats":  stats,
	})
}

