package handlers

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ContactGroupHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewContactGroupHandler(db *gorm.DB, manager *whatsapp.Manager) *ContactGroupHandler {
	return &ContactGroupHandler{db: db, manager: manager}
}

// List GET /v1/crm/groups?instance_id=&q=
// Returns persisted ContactGroup rows — the Sync endpoint refreshes them from
// the WhatsApp client as a side effect. This split avoids hitting whatsmeow
// on every list call.
func (h *ContactGroupHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Model(&models.ContactGroup{}).Where("workspace_id = ?", ws)
	if v := c.Query("instance_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q = q.Where("instance_id = ?", id)
		}
	}
	if term := strings.TrimSpace(c.Query("q")); term != "" {
		pattern := "%" + term + "%"
		q = q.Where("name ILIKE ? OR description ILIKE ?", pattern, pattern)
	}
	var items []models.ContactGroup
	q.Order("name ASC").Limit(500).Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Get GET /v1/crm/groups/:id
func (h *ContactGroupHandler) Get(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var g models.ContactGroup
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&g).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "grupo não encontrado"})
	}
	return c.JSON(g)
}

// Members GET /v1/crm/groups/:id/members
// Returns the persisted ContactGroupMembership rows joined with Contact.
func (h *ContactGroupHandler) Members(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	type row struct {
		MembershipID string     `json:"membership_id"`
		ContactID    string     `json:"contact_id"`
		Role         string     `json:"role"`
		JoinedAt     time.Time  `json:"joined_at"`
		LeftAt       *time.Time `json:"left_at,omitempty"`
		Name         string     `json:"name"`
		Phone        string     `json:"phone"`
		AvatarURL    string     `json:"avatar_url"`
	}
	var rows []row
	h.db.Table("contact_group_memberships AS cgm").
		Select("cgm.id AS membership_id, cgm.contact_id, cgm.role, cgm.joined_at, cgm.left_at, c.name, c.phone, c.avatar_url").
		Joins("JOIN contacts c ON c.id = cgm.contact_id").
		Where("cgm.group_id = ? AND c.workspace_id = ?", id, ws).
		Order("cgm.joined_at ASC").
		Limit(1000).
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

// ContactGroups GET /v1/crm/contacts/:id/groups
// Returns groups that a given contact belongs to.
func (h *ContactGroupHandler) ContactGroups(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	contactID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	type row struct {
		GroupID          string     `json:"group_id"`
		Name             string     `json:"name"`
		ParticipantCount int        `json:"participant_count"`
		Role             string     `json:"role"`
		JoinedAt         time.Time  `json:"joined_at"`
		LeftAt           *time.Time `json:"left_at,omitempty"`
	}
	var rows []row
	h.db.Table("contact_group_memberships AS cgm").
		Select("cg.id AS group_id, cg.name, cg.participant_count, cgm.role, cgm.joined_at, cgm.left_at").
		Joins("JOIN contact_groups cg ON cg.id = cgm.group_id").
		Where("cgm.contact_id = ? AND cg.workspace_id = ?", contactID, ws).
		Order("cgm.joined_at DESC").
		Scan(&rows)
	return c.JSON(fiber.Map{"items": rows})
}

// Sync POST /v1/crm/groups/sync  { instance_id }
// Pulls the current group list from the connected WhatsApp client, upserts
// ContactGroup rows and rebuilds memberships by matching participants' phone
// to existing contacts. Participants that aren't contacts yet are ignored —
// the Inbound pipeline will create Contacts as messages arrive.
func (h *ContactGroupHandler) Sync(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body struct{ InstanceID string `json:"instance_id"` }
	c.BodyParser(&body)
	instanceID, err := uuid.Parse(body.InstanceID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instance_id inválido"})
	}
	// Validate instance belongs to workspace
	var inst models.Instance
	if err := h.db.First(&inst, "id = ? AND workspace_id = ?", instanceID, ws).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if h.manager == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "whatsapp manager indisponível"})
	}
	client := h.manager.GetInstance(instanceID.String())
	if client == nil || !client.IsConnected() {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "instância desconectada"})
	}

	_, cancel := context.WithTimeout(c.UserContext(), 30*time.Second)
	defer cancel()

	groups, err := client.GetJoinedGroups()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	now := time.Now()
	upserted := 0
	for _, raw := range groups {
		jid := asString(raw["jid"])
		if jid == "" {
			continue
		}
		var g models.ContactGroup
		err := h.db.Where("workspace_id = ? AND instance_id = ? AND group_key = ?", ws, instanceID, jid).First(&g).Error
		name := asString(raw["name"])
		desc := asString(raw["description"])
		if err == gorm.ErrRecordNotFound {
			g = models.ContactGroup{
				WorkspaceID:      ws,
				InstanceID:       instanceID,
				ChannelType:      string(inst.Channel),
				GroupKey:         jid,
				Name:             name,
				Description:      desc,
				ParticipantCount: asInt(raw["participant_count"]),
				IsAnnounce:       asBool(raw["is_announce"]),
				IsLocked:         asBool(raw["is_locked"]),
				FirstSeenAt:      now,
				LastSyncAt:       &now,
			}
			h.db.Create(&g)
		} else if err == nil {
			h.db.Model(&g).Updates(map[string]any{
				"name":              name,
				"description":       desc,
				"participant_count": asInt(raw["participant_count"]),
				"is_announce":       asBool(raw["is_announce"]),
				"is_locked":         asBool(raw["is_locked"]),
				"last_sync_at":      now,
			})
		}
		upserted++
	}
	return c.JSON(fiber.Map{"ok": true, "groups": upserted})
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func asInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}
func asBool(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}
