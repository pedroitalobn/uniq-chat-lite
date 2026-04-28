package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type SubscriptionHandler struct {
	db *gorm.DB
}

func NewSubscriptionHandler(db *gorm.DB) *SubscriptionHandler {
	return &SubscriptionHandler{db: db}
}

// ListTopics GET /v1/subscription-topics
func (h *SubscriptionHandler) ListTopics(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	var topics []models.SubscriptionTopic
	h.db.Where("workspace_id = ?", wsID).Order("name").Find(&topics)
	return c.JSON(fiber.Map{"data": topics})
}

// CreateTopic POST /v1/subscription-topics
func (h *SubscriptionHandler) CreateTopic(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	var t models.SubscriptionTopic
	if err := c.BodyParser(&t); err != nil || t.Name == "" || t.Slug == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name e slug obrigatórios"})
	}
	t.ID = uuid.Nil
	t.WorkspaceID = wsID
	if err := h.db.Create(&t).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(201).JSON(t)
}

// UpdateTopic PATCH /v1/subscription-topics/:id
func (h *SubscriptionHandler) UpdateTopic(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var t models.SubscriptionTopic
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&t).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "tópico não encontrado"})
	}
	var patch map[string]any
	c.BodyParser(&patch)
	allowed := map[string]bool{"name": true, "description": true, "is_required": true, "default_opt_in": true, "is_active": true}
	updates := map[string]any{}
	for k, v := range patch {
		if allowed[k] {
			updates[k] = v
		}
	}
	h.db.Model(&t).Updates(updates)
	h.db.First(&t, "id = ?", t.ID)
	return c.JSON(t)
}

// DeleteTopic DELETE /v1/subscription-topics/:id
func (h *SubscriptionHandler) DeleteTopic(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.SubscriptionTopic{})
	h.db.Where("topic_id = ?", id).Delete(&models.ContactSubscription{})
	return c.JSON(fiber.Map{"ok": true})
}

// GeneratePreferenceLink POST /v1/contacts/:id/preference-link
// Cria token público pra preference center. Usado em mensagens (footer).
func (h *SubscriptionHandler) GeneratePreferenceLink(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	contactID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var contact models.Contact
	if err := h.db.Where("id = ?", contactID).First(&contact).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "contato não encontrado"})
	}
	tok, _ := generateOpaqueToken()
	link := models.PreferenceLink{
		Token: tok, WorkspaceID: wsID, ContactID: contactID,
	}
	h.db.Create(&link)
	return c.JSON(fiber.Map{"token": tok, "url": "/p/preferences/" + tok})
}

// PublicGet GET /p/preferences/:token (público — sem auth)
// Retorna tópicos + estado opt-in atual do contato.
func (h *SubscriptionHandler) PublicGet(c *fiber.Ctx) error {
	tok := c.Params("token")
	var link models.PreferenceLink
	if err := h.db.Where("token = ?", tok).First(&link).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "link inválido"})
	}
	var topics []models.SubscriptionTopic
	h.db.Where("workspace_id = ? AND is_active = TRUE", link.WorkspaceID).Order("is_required DESC, name").Find(&topics)
	var subs []models.ContactSubscription
	h.db.Where("workspace_id = ? AND contact_id = ?", link.WorkspaceID, link.ContactID).Find(&subs)
	subMap := map[string]bool{}
	for _, s := range subs {
		subMap[s.TopicID.String()] = s.OptedIn
	}
	type topicView struct {
		ID          string `json:"id"`
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Description string `json:"description"`
		IsRequired  bool   `json:"is_required"`
		OptedIn     bool   `json:"opted_in"`
	}
	out := make([]topicView, 0, len(topics))
	for _, t := range topics {
		opted, has := subMap[t.ID.String()]
		if !has {
			opted = t.DefaultOptIn
		}
		out = append(out, topicView{
			ID: t.ID.String(), Slug: t.Slug, Name: t.Name,
			Description: t.Description, IsRequired: t.IsRequired, OptedIn: opted,
		})
	}
	return c.JSON(fiber.Map{"topics": out, "contact_id": link.ContactID})
}

// PublicUpdate POST /p/preferences/:token  { topic_id: opt_in }
func (h *SubscriptionHandler) PublicUpdate(c *fiber.Ctx) error {
	tok := c.Params("token")
	var link models.PreferenceLink
	if err := h.db.Where("token = ?", tok).First(&link).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "link inválido"})
	}
	var req map[string]bool
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}
	for topicIDStr, optIn := range req {
		tid, err := uuid.Parse(topicIDStr)
		if err != nil {
			continue
		}
		// Não permite opt-out de tópicos required.
		var topic models.SubscriptionTopic
		if h.db.First(&topic, "id = ? AND workspace_id = ?", tid, link.WorkspaceID).Error != nil {
			continue
		}
		if topic.IsRequired && !optIn {
			continue
		}
		var sub models.ContactSubscription
		err = h.db.Where("workspace_id = ? AND contact_id = ? AND topic_id = ?",
			link.WorkspaceID, link.ContactID, tid).First(&sub).Error
		if err != nil {
			h.db.Create(&models.ContactSubscription{
				WorkspaceID: link.WorkspaceID, ContactID: link.ContactID,
				TopicID: tid, OptedIn: optIn, Source: "preference_center",
			})
		} else {
			h.db.Model(&sub).Updates(map[string]any{
				"opted_in": optIn, "source": "preference_center", "updated_at": time.Now(),
			})
		}
	}
	h.db.Model(&link).Update("used_count", gorm.Expr("used_count + 1"))
	return c.JSON(fiber.Map{"ok": true})
}

// ─── helpers ──────────────────────────────────────────────────────────

func generateOpaqueToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

