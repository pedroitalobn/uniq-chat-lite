package handlers

import (
	"encoding/json"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type RecoveryHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewRecoveryHandler(db *gorm.DB, manager *whatsapp.Manager) *RecoveryHandler {
	return &RecoveryHandler{db: db, manager: manager}
}

// takeSnapshot is the shared snapshot logic used by the API handler and the scheduler.
func (h *RecoveryHandler) takeSnapshot(instanceID string) (int, error) {
	client := h.manager.GetInstance(instanceID)
	if client == nil || !client.IsConnected() {
		return 0, fiber.NewError(fiber.StatusConflict, "instância não está conectada")
	}

	rawGroups, err := client.GetJoinedGroups()
	if err != nil {
		return 0, fiber.NewError(fiber.StatusInternalServerError, "erro ao buscar grupos: "+err.Error())
	}

	entries := make([]models.GroupSnapshotEntry, 0, len(rawGroups))
	for _, g := range rawGroups {
		jid, _ := g["jid"].(string)
		name, _ := g["name"].(string)
		desc, _ := g["description"].(string)
		count, _ := g["participant_count"].(int)
		isAdmin, _ := g["is_admin"].(bool)

		entry := models.GroupSnapshotEntry{
			JID:         jid,
			Name:        name,
			Description: desc,
			MemberCount: count,
			IsAdmin:     isAdmin,
		}
		if link, lerr := client.GetGroupInviteLink(jid, false); lerr == nil {
			entry.InviteLink = link
		}
		entries = append(entries, entry)
	}

	groupsJSON, _ := json.Marshal(entries)

	instID, _ := uuid.Parse(instanceID)

	// Upsert: find or create, then update
	var snap models.RecoverySnapshot
	if err := h.db.Where("instance_id = ?", instID).First(&snap).Error; err != nil {
		snap = models.RecoverySnapshot{InstanceID: instID}
		if err2 := h.db.Create(&snap).Error; err2 != nil {
			return 0, fiber.NewError(fiber.StatusInternalServerError, "erro ao criar snapshot: "+err2.Error())
		}
	}

	if err := h.db.Model(&snap).Updates(map[string]interface{}{
		"groups":     string(groupsJSON),
		"updated_at": time.Now(),
	}).Error; err != nil {
		return 0, fiber.NewError(fiber.StatusInternalServerError, "erro ao salvar snapshot: "+err.Error())
	}

	return len(entries), nil
}

// Snapshot godoc
// POST /instances/:id/recovery/snapshot
func (h *RecoveryHandler) Snapshot(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	count, err := h.takeSnapshot(instance.ID.String())
	if err != nil {
		if fe, ok2 := err.(*fiber.Error); ok2 {
			return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"message":        "snapshot salvo com sucesso",
		"groups_snapped": count,
		"snapshot_at":    time.Now(),
	})
}

// SetSchedule godoc
// PUT /instances/:id/recovery/schedule
func (h *RecoveryHandler) SetSchedule(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var req struct {
		Schedule string `json:"schedule"` // "", "daily", "weekly"
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if req.Schedule != "" && req.Schedule != "daily" && req.Schedule != "weekly" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "schedule deve ser '', 'daily' ou 'weekly'"})
	}

	var snap models.RecoverySnapshot
	if err := h.db.Where("instance_id = ?", instance.ID).First(&snap).Error; err != nil {
		snap = models.RecoverySnapshot{InstanceID: instance.ID}
		h.db.Create(&snap)
	}
	h.db.Model(&snap).Update("snapshot_schedule", req.Schedule)

	label := map[string]string{"": "desativado", "daily": "diário", "weekly": "semanal"}[req.Schedule]
	return c.JSON(fiber.Map{"message": "agendamento " + label, "schedule": req.Schedule})
}

// Get godoc
// GET /instances/:id/recovery
func (h *RecoveryHandler) Get(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var snap models.RecoverySnapshot
	h.db.Where("instance_id = ?", instance.ID).First(&snap)

	var groups []models.GroupSnapshotEntry
	if snap.Groups != "" {
		_ = json.Unmarshal([]byte(snap.Groups), &groups)
	}
	if groups == nil {
		groups = []models.GroupSnapshotEntry{}
	}

	type ContactEntry struct {
		JID          string    `json:"jid"`
		Phone        string    `json:"phone"`
		MessageCount int       `json:"message_count"`
		LastMessage  time.Time `json:"last_message"`
	}
	var contacts []ContactEntry
	h.db.Raw(`
		SELECT
			to_jid AS jid,
			REPLACE(to_jid, '@s.whatsapp.net', '') AS phone,
			COUNT(*) AS message_count,
			MAX(created_at) AS last_message
		FROM message_logs
		WHERE instance_id = ?
		  AND direction = 'out'
		  AND to_jid != ''
		  AND to_jid NOT LIKE '%@g.us'
		GROUP BY to_jid
		ORDER BY last_message DESC
		LIMIT 200
	`, instance.ID).Scan(&contacts)
	if contacts == nil {
		contacts = []ContactEntry{}
	}

	var snapshotAt *time.Time
	if snap.ID != (uuid.UUID{}) {
		t := snap.UpdatedAt
		snapshotAt = &t
	}

	return c.JSON(fiber.Map{
		"status":      instance.Status,
		"snapshot_at": snapshotAt,
		"schedule":    snap.SnapshotSchedule,
		"groups":      groups,
		"contacts":    contacts,
	})
}

// Reset godoc
// POST /instances/:id/recovery/reset
func (h *RecoveryHandler) Reset(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	if err := h.manager.ResetSession(instance.ID.String()); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao resetar sessão: " + err.Error()})
	}

	h.db.Model(instance).Updates(map[string]interface{}{
		"status":       models.StatusDisconnected,
		"phone_number": "",
		"connected_at": nil,
	})

	return c.JSON(fiber.Map{"message": "sessão resetada — use QR code ou código de pareamento para conectar um novo número"})
}

// RunScheduledSnapshots is called periodically (every hour) to auto-snapshot instances.
func (h *RecoveryHandler) RunScheduledSnapshots() {
	var snaps []models.RecoverySnapshot
	h.db.Where("snapshot_schedule IN ('daily', 'weekly')").Find(&snaps)

	now := time.Now()
	for _, snap := range snaps {
		var due bool
		switch snap.SnapshotSchedule {
		case "daily":
			due = now.Sub(snap.UpdatedAt) >= 24*time.Hour
		case "weekly":
			due = now.Sub(snap.UpdatedAt) >= 7*24*time.Hour
		}
		if !due {
			continue
		}
		h.takeSnapshot(snap.InstanceID.String()) //nolint:errcheck
	}
}
