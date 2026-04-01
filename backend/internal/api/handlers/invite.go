package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type InviteHandler struct {
	db *gorm.DB
}

func NewInviteHandler(db *gorm.DB) *InviteHandler {
	return &InviteHandler{db: db}
}

// GET /invites/status — public: check if invite system is enabled
func (h *InviteHandler) GetStatus(c *fiber.Ctx) error {
	var setting models.SystemSetting
	enabled := false
	if err := h.db.First(&setting, "key = ?", "invite_system_enabled").Error; err == nil {
		enabled = setting.Value == "true"
	}
	return c.JSON(fiber.Map{"enabled": enabled})
}

// POST /invites/validate — public: validate an invite code
func (h *InviteHandler) Validate(c *fiber.Ctx) error {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil || req.Code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "código é obrigatório"})
	}

	var code models.InviteCode
	if err := h.db.First(&code, "code = ?", req.Code).Error; err != nil {
		return c.JSON(fiber.Map{"valid": false, "error": "código inválido"})
	}
	if code.UsedBy != nil {
		return c.JSON(fiber.Map{"valid": false, "error": "código já utilizado"})
	}

	return c.JSON(fiber.Map{"valid": true})
}

// POST /invites/generate — protected: generate a new invite code for the current user
func (h *InviteHandler) Generate(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	code := models.InviteCode{UserID: user.ID}
	if err := h.db.Create(&code).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar código"})
	}

	frontendURL := config.AppConfig.FrontendURL
	if frontendURL == "" {
		frontendURL = "https://app.uniq.chat"
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"code": code.Code,
		"link": frontendURL + "/plans?invite=" + code.Code,
	})
}

// GET /invites/mine — protected: list current user's invite codes
func (h *InviteHandler) ListMine(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	var codes []models.InviteCode
	h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&codes)

	frontendURL := config.AppConfig.FrontendURL
	if frontendURL == "" {
		frontendURL = "https://app.uniq.chat"
	}

	type inviteResp struct {
		ID        uuid.UUID  `json:"id"`
		Code      string     `json:"code"`
		Link      string     `json:"link"`
		UsedBy    *uuid.UUID `json:"used_by"`
		CreatedAt time.Time  `json:"created_at"`
	}

	resp := make([]inviteResp, len(codes))
	for i, c := range codes {
		resp[i] = inviteResp{
			ID:        c.ID,
			Code:      c.Code,
			Link:      frontendURL + "/plans?invite=" + c.Code,
			UsedBy:    c.UsedBy,
			CreatedAt: c.CreatedAt,
		}
	}

	return c.JSON(resp)
}

// POST /admin/invites/toggle — admin: enable/disable invite system
func (h *InviteHandler) ToggleSystem(c *fiber.Ctx) error {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	val := "false"
	if req.Enabled {
		val = "true"
	}

	h.db.Where(models.SystemSetting{Key: "invite_system_enabled"}).
		Assign(models.SystemSetting{Key: "invite_system_enabled", Value: val}).
		FirstOrCreate(&models.SystemSetting{})

	return c.JSON(fiber.Map{"enabled": req.Enabled})
}

// GET /admin/invites — admin: list all invite codes
func (h *InviteHandler) AdminList(c *fiber.Ctx) error {
	var codes []models.InviteCode
	h.db.Preload("User").Order("created_at DESC").Limit(200).Find(&codes)
	return c.JSON(codes)
}

// Unused returns whether a code has been used.
func IsInviteCodeValid(db *gorm.DB, code string) (bool, uuid.UUID) {
	if code == "" {
		return false, uuid.Nil
	}
	var ic models.InviteCode
	if err := db.First(&ic, "code = ?", code).Error; err != nil {
		return false, uuid.Nil
	}
	if ic.UsedBy != nil {
		return false, uuid.Nil
	}
	return true, ic.UserID
}

// MarkInviteCodeUsed marks an invite code as used by a specific user.
func MarkInviteCodeUsed(db *gorm.DB, code string, usedByID uuid.UUID) {
	now := db.NowFunc()
	db.Model(&models.InviteCode{}).
		Where("code = ? AND used_by IS NULL", code).
		Updates(map[string]interface{}{
			"used_by": usedByID,
			"used_at": now,
		})
}
