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

// TikTokHandler manages TikTok accounts and actions.
type TikTokHandler struct {
	db     *gorm.DB
	taktik *services.TaktikService
}

func NewTikTokHandler(db *gorm.DB, taktik *services.TaktikService) *TikTokHandler {
	return &TikTokHandler{db: db, taktik: taktik}
}

// List GET /tiktok/accounts
func (h *TikTokHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var accounts []models.TikTokAccount
	h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&accounts)
	return c.JSON(accounts)
}

// Create POST /tiktok/accounts
func (h *TikTokHandler) Create(c *fiber.Ctx) error {
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

	var existing models.TikTokAccount
	if h.db.Where("username = ? AND user_id = ?", req.Username, user.ID).First(&existing).Error == nil {
		return c.Status(409).JSON(fiber.Map{"error": "conta já cadastrada"})
	}

	encPassword, _ := whatsapp.EncryptProxyPassword(req.Password)
	account := models.TikTokAccount{
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

// Get GET /tiktok/accounts/:id
func (h *TikTokHandler) Get(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}
	return c.JSON(account)
}

// Delete DELETE /tiktok/accounts/:id
func (h *TikTokHandler) Delete(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).Delete(&models.TikTokAccount{}).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}
	return c.JSON(fiber.Map{"message": "conta removida"})
}

// Connect POST /tiktok/accounts/:id/connect
func (h *TikTokHandler) Connect(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	if h.taktik.HealthCheck() {
		h.db.Model(&account).Update("status", models.AccountPending)
		return c.JSON(fiber.Map{"message": "conexão iniciada via taktik", "status": "pending"})
	}

	h.db.Model(&account).Updates(map[string]interface{}{"status": models.AccountConnected})
	return c.JSON(fiber.Map{"message": "conta conectada (modo desenvolvimento)", "status": "connected"})
}

// Disconnect POST /tiktok/accounts/:id/disconnect
func (h *TikTokHandler) Disconnect(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}
	h.db.Model(&account).Update("status", models.AccountDisconnected)
	return c.JSON(fiber.Map{"message": "conta desconectada", "status": "disconnected"})
}

// UpdateSettings PUT /tiktok/accounts/:id/settings
func (h *TikTokHandler) UpdateSettings(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
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

// SendDM POST /tiktok/accounts/:id/dm
func (h *TikTokHandler) SendDM(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
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

	result, err := h.taktik.TikTokSendDM(account.Username, req.Target, req.Message)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	dm := models.SocialDM{
		AccountID:      account.ID,
		AccountType:    "tiktok",
		SenderUsername: account.Username,
		Message:        req.Message,
		IsIncoming:     false,
	}
	h.db.Create(&dm)

	return c.JSON(result)
}

// ReadDMs GET /tiktok/accounts/:id/dm
func (h *TikTokHandler) ReadDMs(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	result, err := h.taktik.TikTokReadDMs(account.Username, 20)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// Follow POST /tiktok/accounts/:id/follow
func (h *TikTokHandler) Follow(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.TikTokFollow(account.Username, req.Target)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// Unfollow POST /tiktok/accounts/:id/unfollow
func (h *TikTokHandler) Unfollow(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), user.ID).First(&account).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "conta não encontrada"})
	}

	var req struct {
		Target string `json:"target"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}

	result, err := h.taktik.TikTokUnfollow(account.Username, req.Target)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// ScrapeFollowers POST /tiktok/accounts/:id/scrape/followers
func (h *TikTokHandler) ScrapeFollowers(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
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

	result, err := h.taktik.TikTokScrapeFollowers(account.Username, req.Target, req.Limit)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	saved := h.taktik.SaveScrapedTargets(user.ID, "tiktok", "followers", req.Target, result)
	return c.JSON(fiber.Map{"scraped": len(result), "saved": saved, "users": result})
}

// ScrapeHashtag POST /tiktok/accounts/:id/scrape/hashtag
func (h *TikTokHandler) ScrapeHashtag(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var account models.TikTokAccount
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

	result, err := h.taktik.TikTokScrapeHashtag(account.Username, req.Hashtag, req.Limit)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	saved := h.taktik.SaveScrapedTargets(user.ID, "tiktok", "hashtag", req.Hashtag, result)
	return c.JSON(fiber.Map{"scraped": len(result), "saved": saved, "users": result})
}

// ListDMs GET /tiktok/dms
func (h *TikTokHandler) ListDMs(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	accountID := c.Query("account_id")

	query := h.db.Where("account_type = 'tiktok'")
	if accountID != "" {
		query = query.Where("account_id = ?", accountID)
	} else {
		var accountIDs []uuid.UUID
		h.db.Model(&models.TikTokAccount{}).Where("user_id = ?", user.ID).Pluck("id", &accountIDs)
		query = query.Where("account_id IN ?", accountIDs)
	}

	var dms []models.SocialDM
	query.Order("created_at DESC").Limit(50).Find(&dms)
	return c.JSON(dms)
}

// ListTargets GET /tiktok/targets
func (h *TikTokHandler) ListTargets(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var targets []models.SocialTarget
	h.db.Where("user_id = ? AND platform = 'tiktok'", user.ID).
		Order("scraped_at DESC").Limit(500).Find(&targets)
	return c.JSON(targets)
}

// Health GET /tiktok/health
func (h *TikTokHandler) Health(c *fiber.Ctx) error {
	healthy := h.taktik.HealthCheck()
	return c.JSON(fiber.Map{"healthy": healthy, "checked_at": time.Now()})
}
