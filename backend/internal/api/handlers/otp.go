package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

const (
	otpDefaultLength      = 6
	otpDefaultExpiryMin   = 5
	otpDefaultMaxAttempts = 3
	otpDefaultMaxResends  = 2
	otpDefaultTemplate    = "Seu código de verificação é: *{{code}}*\n\nVálido por {{expiry}} minutos. Não compartilhe com ninguém."
)

type OTPHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewOTPHandler(db *gorm.DB, manager *whatsapp.Manager) *OTPHandler {
	return &OTPHandler{db: db, manager: manager}
}

// generateCode returns a cryptographically secure numeric OTP of the given length.
func generateCode(length int) (string, error) {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(length)), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", length, n), nil
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return fmt.Sprintf("%x", sum)
}

func buildOTPMessage(template, code string, expiryMin int) string {
	msg := strings.ReplaceAll(template, "{{code}}", code)
	msg = strings.ReplaceAll(msg, "{{expiry}}", fmt.Sprintf("%d", expiryMin))
	return msg
}

func (h *OTPHandler) getClientForOTP(c *fiber.Ctx) (*whatsapp.InstanceClient, *models.Instance, error) {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil, nil, fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}
	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return nil, nil, fiber.NewError(fiber.StatusConflict, "instância não está em execução")
	}
	if !client.IsConnected() {
		return nil, nil, fiber.NewError(fiber.StatusConflict, "instância não está conectada ao WhatsApp")
	}
	return client, instance, nil
}

// Send godoc
// POST /instances/:id/otp/send
// Body: { "phone": "5511999999999", "template": "...", "code_length": 6, "expires_minutes": 5 }
func (h *OTPHandler) Send(c *fiber.Ctx) error {
	client, instance, err := h.getClientForOTP(c)
	if err != nil {
		return err
	}
	userID, _ := c.Locals("user_id").(uuid.UUID)

	var req struct {
		Phone          any    `json:"phone"` // Accept both string and number
		Template       string `json:"template"`
		CodeLength     int    `json:"code_length"`
		ExpiresMinutes int    `json:"expires_minutes"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	// Normalize phone to string
	var phone string
	switch v := req.Phone.(type) {
	case string:
		phone = strings.TrimSpace(v)
	case float64:
		phone = fmt.Sprintf("%.0f", v)
	case nil:
		phone = ""
	}

	if phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'phone' é obrigatório"})
	}
	if req.CodeLength <= 0 {
		req.CodeLength = otpDefaultLength
	}
	if req.ExpiresMinutes <= 0 {
		req.ExpiresMinutes = otpDefaultExpiryMin
	}
	if strings.TrimSpace(req.Template) == "" {
		req.Template = otpDefaultTemplate
	}

	// Generate code
	code, err := generateCode(req.CodeLength)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar código"})
	}

	expiresAt := time.Now().Add(time.Duration(req.ExpiresMinutes) * time.Minute)

	session := models.OTPSession{
		InstanceID: instance.ID,
		UserID:     userID,
		Phone:      phone,
		CodeHash:   hashCode(code),
		Status:     models.OTPStatusPending,
		ExpiresAt:  expiresAt,
	}
	if err := h.db.Create(&session).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar sessão OTP"})
	}

	// Build and send message
	text := buildOTPMessage(req.Template, code, req.ExpiresMinutes)
	job := queue.SendJob{
		ID:         uuid.New(),
		InstanceID: instance.ID.String(),
		Type:       queue.TypeText,
		Payload:    queue.SendPayload{To: phone, Text: text},
		Options:    queue.SendOptions{DelayMs: 800, SimulateTyping: true},
		CreatedAt:  time.Now(),
	}

	msgID, queued, sendErr := enqueueOrSend(job, func() (string, error) {
		return client.SendWithFallback(job)
	})
	if sendErr != nil {
		// Mark session as failed so caller knows send didn't happen
		h.db.Model(&session).Update("status", models.OTPStatusFailed)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao enviar OTP: " + sendErr.Error()})
	}

	_ = msgID
	status := "sent"
	if queued {
		status = "queued"
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"session_id": session.ID,
		"phone":      phone,
		"expires_at": expiresAt,
		"status":     status,
	})
}

// Verify godoc
// POST /instances/:id/otp/verify
// Body: { "session_id": "uuid", "code": "123456" }
func (h *OTPHandler) Verify(c *fiber.Ctx) error {
	_, instance, err := h.getClientForOTP(c)
	if err != nil {
		return err
	}

	var req struct {
		SessionID string `json:"session_id"`
		Code      string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if strings.TrimSpace(req.SessionID) == "" || strings.TrimSpace(req.Code) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "session_id e code são obrigatórios"})
	}

	var session models.OTPSession
	if err := h.db.First(&session, "id = ? AND instance_id = ?", req.SessionID, instance.ID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "sessão não encontrada"})
	}

	// Already resolved
	if session.Status == models.OTPStatusVerified {
		return c.JSON(fiber.Map{"valid": false, "reason": "sessão já verificada"})
	}
	if session.Status == models.OTPStatusFailed {
		return c.JSON(fiber.Map{"valid": false, "reason": "sessão bloqueada por excesso de tentativas"})
	}
	if session.IsExpired() || session.Status == models.OTPStatusExpired {
		h.db.Model(&session).Update("status", models.OTPStatusExpired)
		return c.JSON(fiber.Map{"valid": false, "reason": "código expirado"})
	}

	// Increment attempts
	session.Attempts++
	if session.Attempts > otpDefaultMaxAttempts {
		h.db.Model(&session).Updates(map[string]any{
			"attempts": session.Attempts,
			"status":   models.OTPStatusFailed,
		})
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"valid":  false,
			"reason": "número máximo de tentativas atingido",
		})
	}

	// Check code
	if hashCode(strings.TrimSpace(req.Code)) != session.CodeHash {
		h.db.Model(&session).Update("attempts", session.Attempts)
		remaining := otpDefaultMaxAttempts - session.Attempts
		return c.JSON(fiber.Map{
			"valid":     false,
			"reason":    "código incorreto",
			"attempts":  session.Attempts,
			"remaining": remaining,
		})
	}

	// Success
	now := time.Now()
	h.db.Model(&session).Updates(map[string]any{
		"status":      models.OTPStatusVerified,
		"attempts":    session.Attempts,
		"verified_at": &now,
	})

	return c.JSON(fiber.Map{
		"valid":       true,
		"session_id":  session.ID,
		"phone":       session.Phone,
		"verified_at": now,
	})
}

// Resend godoc
// POST /instances/:id/otp/resend
// Body: { "session_id": "uuid" }
func (h *OTPHandler) Resend(c *fiber.Ctx) error {
	client, instance, err := h.getClientForOTP(c)
	if err != nil {
		return err
	}

	var req struct {
		SessionID string `json:"session_id"`
		Template  string `json:"template"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if strings.TrimSpace(req.SessionID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "session_id é obrigatório"})
	}
	if strings.TrimSpace(req.Template) == "" {
		req.Template = otpDefaultTemplate
	}

	var session models.OTPSession
	if err := h.db.First(&session, "id = ? AND instance_id = ?", req.SessionID, instance.ID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "sessão não encontrada"})
	}

	if session.Status == models.OTPStatusVerified {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "sessão já verificada"})
	}
	if session.Status == models.OTPStatusFailed {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "sessão bloqueada"})
	}
	if session.Resends >= otpDefaultMaxResends {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "limite de reenvios atingido"})
	}

	// Generate a fresh code and extend expiry
	code, err := generateCode(otpDefaultLength)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar código"})
	}
	newExpiry := time.Now().Add(otpDefaultExpiryMin * time.Minute)

	h.db.Model(&session).Updates(map[string]any{
		"code_hash":  hashCode(code),
		"expires_at": newExpiry,
		"attempts":   0,
		"resends":    session.Resends + 1,
		"status":     models.OTPStatusPending,
	})

	text := buildOTPMessage(req.Template, code, otpDefaultExpiryMin)
	job := queue.SendJob{
		ID:         uuid.New(),
		InstanceID: instance.ID.String(),
		Type:       queue.TypeText,
		Payload:    queue.SendPayload{To: session.Phone, Text: text},
		Options:    queue.SendOptions{DelayMs: 800, SimulateTyping: true},
		CreatedAt:  time.Now(),
	}

	_, queued, sendErr := enqueueOrSend(job, func() (string, error) {
		return client.SendWithFallback(job)
	})
	if sendErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao reenviar OTP: " + sendErr.Error()})
	}

	status := "sent"
	if queued {
		status = "queued"
	}

	return c.JSON(fiber.Map{
		"session_id": session.ID,
		"phone":      session.Phone,
		"expires_at": newExpiry,
		"resends":    session.Resends + 1,
		"status":     status,
	})
}

// Sessions godoc
// GET /instances/:id/otp/sessions?phone=&status=&limit=50
func (h *OTPHandler) Sessions(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}

	q := h.db.Where("instance_id = ?", instance.ID).Order("created_at DESC")

	if phone := c.Query("phone"); phone != "" {
		q = q.Where("phone = ?", phone)
	}
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}

	limit := c.QueryInt("limit", 50)
	if limit > 200 {
		limit = 200
	}
	q = q.Limit(limit)

	var sessions []models.OTPSession
	if err := q.Find(&sessions).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar sessões"})
	}

	return c.JSON(fiber.Map{"sessions": sessions, "total": len(sessions)})
}
