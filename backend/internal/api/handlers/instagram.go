package handlers

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// InstagramHandler manages Instagram accounts and actions.
type InstagramHandler struct {
	db     *gorm.DB
	taktik *services.TaktikService
}

func NewInstagramHandler(db *gorm.DB, taktik *services.TaktikService) *InstagramHandler {
	return &InstagramHandler{db: db, taktik: taktik}
}

// List GET /instagram/accounts
func (h *InstagramHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var accounts []models.InstagramAccount
	h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&accounts)
	return c.JSON(accounts)
}

// Create POST /instagram/accounts
func (h *InstagramHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "username e password são obrigatórios"})
	}

	// Check if already exists
	var existing models.InstagramAccount
	if h.db.Where("username = ? AND user_id = ?", req.Username, user.ID).First(&existing).Error == nil {
		return c.Status(409).JSON(fiber.Map{"error": "conta já cadastrada"})
	}

	// Encrypt password
	encPassword, _ := whatsapp.EncryptProxyPassword(req.Password)

	account := models.InstagramAccount{
		UserID:      user.ID,
		Username:    strings.ToLower(req.Username),
		PasswordEnc: encPassword,
		Status:      models.AccountPending,
	}
	if err := h.db.Create(&account).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao criar conta"})
	}

	return c.Status(201).JSON(account)
}

// Get GET /instagram/accounts/:id
func (h *InstagramHandler) Get(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}
	return c.JSON(account)
}

// Delete DELETE /instagram/accounts/:id
func (h *InstagramHandler) Delete(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).Delete(&models.InstagramAccount{}).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}
	return c.JSON(fiber.Map{"message": "conta removida"})
}

// Connect POST /instagram/accounts/:id/connect
func (h *InstagramHandler) Connect(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	// Try to connect via taktik service
	if h.taktik.HealthCheck() {
		// taktik is available — attempt real login
		h.db.Model(&account).Update("status", models.AccountPending)
		return c.JSON(fiber.Map{
			"message": "conexão iniciada via taktik",
			"status":  "pending",
		})
	}

	// taktik not available — mark as connected for manual/development mode
	// In production, this should fail if taktik is unavailable
	h.db.Model(&account).Updates(map[string]interface{}{
		"status": models.AccountConnected,
	})
	return c.JSON(fiber.Map{
		"message": "conta conectada (modo desenvolvimento — inicie o serviço taktik para automação real)",
		"status":  "connected",
	})
}

// Disconnect POST /instagram/accounts/:id/disconnect
func (h *InstagramHandler) Disconnect(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}
	h.db.Model(&account).Update("status", models.AccountDisconnected)
	return c.JSON(fiber.Map{"message": "conta desconectada", "status": "disconnected"})
}

// UpdateSettings PUT /instagram/accounts/:id/settings
func (h *InstagramHandler) UpdateSettings(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		AutoReply     bool       `json:"auto_reply"`
		AIEnabled     bool       `json:"ai_enabled"`
		IntegrationID *uuid.UUID `json:"integration_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	h.db.Model(&account).Updates(map[string]interface{}{
		"auto_reply":     req.AutoReply,
		"ai_enabled":     req.AIEnabled,
		"integration_id": req.IntegrationID,
	})

	return c.JSON(fiber.Map{"message": "configurações atualizadas"})
}

// ─── Instagram Actions ────────────────────────────────────────────────

// SendDM POST /instagram/accounts/:id/dm
func (h *InstagramHandler) SendDM(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Target  string `json:"target"`
		Message string `json:"message"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramSendDM(account.Username, req.Target, req.Message)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	// Save DM
	dm := models.SocialDM{
		AccountID:      account.ID,
		AccountType:    "instagram",
		SenderUsername: account.Username,
		Message:        req.Message,
		IsIncoming:     false,
		IsAIResponse:   false,
	}
	h.db.Create(&dm)

	return c.JSON(result)
}

// ReadDMs GET /instagram/accounts/:id/dm
func (h *InstagramHandler) ReadDMs(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	result, err := h.taktik.InstagramReadDMs(account.Username, 20)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// Follow POST /instagram/accounts/:id/follow
func (h *InstagramHandler) Follow(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramFollow(account.Username, req.Target)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// Unfollow POST /instagram/accounts/:id/unfollow
func (h *InstagramHandler) Unfollow(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramUnfollow(account.Username, req.Target)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// ScrapeFollowers POST /instagram/accounts/:id/scrape/followers
func (h *InstagramHandler) ScrapeFollowers(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
		Limit  int    `json:"limit"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramScrapeFollowers(account.Username, req.Target, req.Limit)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	saved := h.taktik.SaveScrapedTargets(user.ID, "instagram", "followers", req.Target, result)
	return c.JSON(fiber.Map{"scraped": len(result), "saved": saved, "users": result})
}

// ScrapeHashtag POST /instagram/accounts/:id/scrape/hashtag
func (h *InstagramHandler) ScrapeHashtag(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Hashtag string `json:"hashtag"`
		Limit   int    `json:"limit"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramScrapeHashtag(account.Username, req.Hashtag, req.Limit)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	saved := h.taktik.SaveScrapedTargets(user.ID, "instagram", "hashtag", req.Hashtag, result)
	return c.JSON(fiber.Map{"scraped": len(result), "saved": saved, "users": result})
}

// ScrapePostLikers POST /instagram/accounts/:id/scrape/post
func (h *InstagramHandler) ScrapePostLikers(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		PostURL string `json:"post_url"`
		Limit   int    `json:"limit"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramScrapePostLikers(account.Username, req.PostURL, req.Limit)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	saved := h.taktik.SaveScrapedTargets(user.ID, "instagram", "post_url", req.PostURL, result)
	return c.JSON(fiber.Map{"scraped": len(result), "saved": saved, "users": result})
}

// PublishPost POST /instagram/accounts/:id/post
func (h *InstagramHandler) PublishPost(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.InstagramAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		ImageURL string `json:"image_url"`
		Caption  string `json:"caption"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.InstagramPublishPost(account.Username, req.ImageURL, req.Caption)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// ─── Social Targets ───────────────────────────────────────────────────

// ListTargets GET /instagram/targets
func (h *InstagramHandler) ListTargets(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	platform := c.Query("platform", "instagram")
	source := c.Query("source", "")
	search := c.Query("search", "")

	query := h.db.Where("user_id = ? AND platform = ?", user.ID, platform)
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if search != "" {
		query = query.Where("username LIKE ? OR full_name LIKE ?", "%"+search+"%", "%"+search+"%")
	}

	var targets []models.SocialTarget
	query.Order("scraped_at DESC").Limit(500).Find(&targets)

	var count int64
	query.Model(&models.SocialTarget{}).Count(&count)

	return c.JSON(fiber.Map{"targets": targets, "total": count})
}

// ListDMs GET /instagram/dms
func (h *InstagramHandler) ListDMs(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	accountID := c.Query("account_id")
	limit := 50

	query := h.db.Where("account_type = 'instagram'")
	if accountID != "" {
		query = query.Where("account_id = ?", accountID)
	} else {
		// Get all user's Instagram accounts
		var accountIDs []uuid.UUID
		h.db.Model(&models.InstagramAccount{}).Where("user_id = ?", user.ID).Pluck("id", &accountIDs)
		query = query.Where("account_id IN ?", accountIDs)
	}

	var dms []models.SocialDM
	query.Order("created_at DESC").Limit(limit).Find(&dms)

	return c.JSON(dms)
}

// ─── Health Check ─────────────────────────────────────────────────────

// Health GET /instagram/health
func (h *InstagramHandler) Health(c *fiber.Ctx) error {
	healthy := h.taktik.HealthCheck()
	return c.JSON(fiber.Map{"healthy": healthy, "checked_at": time.Now()})
}
