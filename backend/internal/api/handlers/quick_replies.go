package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type QuickReplyHandler struct{ db *gorm.DB }

func NewQuickReplyHandler(db *gorm.DB) *QuickReplyHandler { return &QuickReplyHandler{db: db} }

// List GET /v1/quick-replies?scope=mine|workspace|all
// scope=mine        → only entries owned by the current user
// scope=workspace   → only entries with owner_user_id IS NULL (shared)
// scope=all         → both (default)
func (h *QuickReplyHandler) List(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	q := h.db.Model(&models.QuickReply{}).Where("workspace_id = ? AND is_active = true", ws)

	switch c.Query("scope", "all") {
	case "mine":
		q = q.Where("owner_user_id = ?", userID)
	case "workspace":
		q = q.Where("owner_user_id IS NULL")
	default:
		q = q.Where("owner_user_id = ? OR owner_user_id IS NULL", userID)
	}
	if qid := c.Query("queue_id"); qid != "" {
		if id, err := uuid.Parse(qid); err == nil {
			q = q.Where("queue_id IS NULL OR queue_id = ?", id)
		}
	}
	var items []models.QuickReply
	q.Order("usage_count DESC, shortcut ASC").Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Search GET /v1/quick-replies/search?q=
// Shortcut prefix match + title/body ILIKE. Used by the composer autocomplete.
func (h *QuickReplyHandler) Search(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	term := strings.TrimSpace(c.Query("q"))
	if term == "" {
		return c.JSON(fiber.Map{"items": []any{}})
	}
	pattern := "%" + term + "%"
	shortcutPattern := term + "%"
	if strings.HasPrefix(term, "/") {
		shortcutPattern = term + "%"
	}

	var items []models.QuickReply
	h.db.Where("workspace_id = ? AND is_active = true", ws).
		Where("(owner_user_id = ? OR owner_user_id IS NULL)", userID).
		Where("shortcut ILIKE ? OR title ILIKE ? OR body ILIKE ?", shortcutPattern, pattern, pattern).
		Order("usage_count DESC, shortcut ASC").
		Limit(25).
		Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Create POST /v1/quick-replies
// Personal by default (owner = current user). Pass {"shared": true} to create
// a workspace-wide reply — requires quickreplies:manage_shared (enforced by
// middleware on the route).
func (h *QuickReplyHandler) Create(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	var body struct {
		Shortcut     string   `json:"shortcut"`
		Title        string   `json:"title"`
		Body         string   `json:"body"`
		MediaURL     string   `json:"media_url"`
		MediaType    string   `json:"media_type"`
		Variables    []string `json:"variables"`
		DepartmentID string   `json:"department_id"`
		QueueID      string   `json:"queue_id"`
		Shared       bool     `json:"shared"`
	}
	if err := c.BodyParser(&body); err != nil || strings.TrimSpace(body.Body) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body é obrigatório"})
	}

	qr := models.QuickReply{
		WorkspaceID:  ws,
		Shortcut:     body.Shortcut,
		Title:        body.Title,
		Body:         body.Body,
		MediaURL:     body.MediaURL,
		MediaType:    body.MediaType,
		VariablesCSV: strings.Join(body.Variables, ","),
		IsActive:     true,
	}
	if !body.Shared {
		qr.OwnerUserID = &userID
	} else {
		// shared → owner nil; permission was checked by middleware
		qr.OwnerUserID = nil
	}
	if body.DepartmentID != "" {
		if id, err := uuid.Parse(body.DepartmentID); err == nil {
			qr.DepartmentID = &id
		}
	}
	if body.QueueID != "" {
		if id, err := uuid.Parse(body.QueueID); err == nil {
			qr.QueueID = &id
		}
	}
	if err := h.db.Create(&qr).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(qr)
}

// Patch PATCH /v1/quick-replies/:id
// Only the owner can edit a personal reply. Shared replies require
// quickreplies:manage_shared (enforced on the route).
func (h *QuickReplyHandler) Patch(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var qr models.QuickReply
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&qr).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "resposta rápida não encontrada"})
	}
	// Personal ownership enforcement (shared already cleared by middleware)
	if qr.OwnerUserID != nil && *qr.OwnerUserID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o autor pode editar"})
	}
	var body struct {
		Shortcut  *string   `json:"shortcut"`
		Title     *string   `json:"title"`
		Body      *string   `json:"body"`
		MediaURL  *string   `json:"media_url"`
		MediaType *string   `json:"media_type"`
		Variables *[]string `json:"variables"`
		IsActive  *bool     `json:"is_active"`
	}
	c.BodyParser(&body)
	updates := map[string]any{}
	if body.Shortcut != nil {
		updates["shortcut"] = *body.Shortcut
	}
	if body.Title != nil {
		updates["title"] = *body.Title
	}
	if body.Body != nil {
		updates["body"] = *body.Body
	}
	if body.MediaURL != nil {
		updates["media_url"] = *body.MediaURL
	}
	if body.MediaType != nil {
		updates["media_type"] = *body.MediaType
	}
	if body.Variables != nil {
		updates["variables_csv"] = strings.Join(*body.Variables, ",")
	}
	if body.IsActive != nil {
		updates["is_active"] = *body.IsActive
	}
	if len(updates) > 0 {
		h.db.Model(&qr).Updates(updates)
	}
	h.db.First(&qr, "id = ?", id)
	return c.JSON(qr)
}

// Delete DELETE /v1/quick-replies/:id (soft)
func (h *QuickReplyHandler) Delete(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	userID := middleware.GetCurrentUserID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var qr models.QuickReply
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&qr).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "resposta rápida não encontrada"})
	}
	if qr.OwnerUserID != nil && *qr.OwnerUserID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "apenas o autor pode excluir"})
	}
	h.db.Delete(&qr)
	return c.JSON(fiber.Map{"ok": true})
}

// Use POST /v1/quick-replies/:id/use
// Increments usage_count; used by the composer to surface frequently-used
// replies at the top of the list. Non-blocking — errors are swallowed.
func (h *QuickReplyHandler) Use(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	h.db.Model(&models.QuickReply{}).
		Where("workspace_id = ? AND id = ?", ws, id).
		Update("usage_count", gorm.Expr("usage_count + 1"))
	return c.JSON(fiber.Map{"ok": true})
}
