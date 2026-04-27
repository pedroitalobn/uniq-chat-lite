package handlers

import (
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
)

// VerifyEmail POST /v1/auth/verify-email  { token }
//
// Marca o email do usuário como verificado e ativa a conta. Token expira
// em 24h. Idempotente: chamar 2x retorna 200 sem mexer no banco.
func (h *AuthHandler) VerifyEmail(c *fiber.Ctx) error {
	var req struct {
		Token string `json:"token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token obrigatório"})
	}
	var user models.User
	if err := h.db.Where("email_verification_token = ?", req.Token).First(&user).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "token inválido"})
	}
	// Idempotência: já verificado.
	if user.EmailVerifiedAt != nil {
		return c.JSON(fiber.Map{"ok": true, "already_verified": true})
	}
	// Expiração: 24h após sent_at.
	if user.EmailVerificationSentAt != nil &&
		time.Since(*user.EmailVerificationSentAt) > 24*time.Hour {
		return c.Status(fiber.StatusGone).JSON(fiber.Map{
			"error":      "link expirado — solicite um novo email",
			"need_resend": true,
		})
	}
	now := time.Now()
	if err := h.db.Model(&user).Updates(map[string]any{
		"email_verified_at":        now,
		"email_verification_token": "",
		"is_active":                true,
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao verificar"})
	}

	h.db.Preload("Plan").First(&user, "id = ?", user.ID)
	accessToken, _ := middleware.GenerateAccessToken(&user)
	refreshToken, _ := middleware.GenerateRefreshToken(user.ID)
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HTTPOnly: true,
		SameSite: "Lax",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Path:     "/",
	})
	return c.JSON(fiber.Map{
		"ok":           true,
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   900,
		"user": fiber.Map{
			"id":    user.ID,
			"email": user.Email,
			"name":  user.Name,
		},
	})
}

// ResendVerification POST /v1/auth/resend-verification  { email }
//
// Re-emite o email de verificação. Sempre retorna 200 (não vazar
// existência de email). Rate-limited externamente.
func (h *AuthHandler) ResendVerification(c *fiber.Ctx) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email obrigatório"})
	}
	var user models.User
	if err := h.db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		// Resposta neutra (anti-enumeração).
		return c.JSON(fiber.Map{"ok": true})
	}
	if user.EmailVerifiedAt != nil {
		return c.JSON(fiber.Map{"ok": true})
	}
	// Throttle interno: max 1 email a cada 60s mesmo passando o rate-limit.
	if user.EmailVerificationSentAt != nil &&
		time.Since(*user.EmailVerificationSentAt) < 60*time.Second {
		return c.JSON(fiber.Map{"ok": true})
	}
	token := generateToken("verify_")
	now := time.Now()
	h.db.Model(&user).Updates(map[string]any{
		"email_verification_token":  token,
		"email_verification_sent_at": now,
	})
	appURL := strings.TrimRight(os.Getenv("APP_URL"), "/")
	if appURL == "" {
		appURL = "https://app.uniq.chat"
	}
	link := appURL + "/verify-email?token=" + token
	h.emailSvc.SendEmailVerification(user.Email, user.Name, link)
	return c.JSON(fiber.Map{"ok": true})
}

// ptrTime helper local pra evitar &time.Now() inline.
func ptrTime(t time.Time) *time.Time { return &t }
