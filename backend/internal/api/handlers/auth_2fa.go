package handlers

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/pquerna/otp/totp"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// 2FA TOTP — fluxo:
//
//   1. POST /v1/auth/2fa/setup       (auth)  → secret + otpauth_url + qr_url
//   2. POST /v1/auth/2fa/enable      (auth)  → { code }      ativa + retorna backup codes
//   3. POST /v1/auth/2fa/disable     (auth)  → { code }      desliga (precisa código atual)
//   4. POST /v1/auth/login           (pub)   → se totp ativo, devolve { requires_2fa, challenge_token }
//   5. POST /v1/auth/2fa/verify      (pub)   → { challenge_token, code|backup_code } troca por access_token
//
// Backup codes: 10 strings de 10 chars, mostradas APENAS UMA VEZ.
// Hash bcrypt no DB. Cada uso queima o hash (não-reutilizável).

// Setup2FA POST /v1/auth/2fa/setup
//
// Gera um novo secret TOTP pro usuário autenticado e devolve a URL otpauth
// pra o app gerar QR. NÃO ativa ainda — só após /enable com código válido.
func (h *AuthHandler) Setup2FA(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "auth required"})
	}
	if user.TOTPEnabledAt != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "2FA já está ativo. Desative antes de gerar novo secret.",
		})
	}
	issuer := "Qchat"
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: user.Email,
		SecretSize:  20,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar secret"})
	}
	// Salva secret PENDENTE — só vira ativo no /enable.
	if err := h.db.Model(user).Update("totp_secret", key.Secret()).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar"})
	}
	return c.JSON(fiber.Map{
		"secret":      key.Secret(),
		"otpauth_url": key.URL(),
		"issuer":      issuer,
		"account":     user.Email,
	})
}

// Enable2FA POST /v1/auth/2fa/enable  { code }
//
// Valida o código TOTP e marca 2FA como ativo. Gera 10 backup codes e
// retorna apenas uma vez (cliente DEVE guardar — depois disso só hashes).
func (h *AuthHandler) Enable2FA(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "auth required"})
	}
	if user.TOTPSecret == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "execute /setup primeiro"})
	}
	if user.TOTPEnabledAt != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "2FA já está ativo"})
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if !totp.Validate(req.Code, user.TOTPSecret) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "código inválido"})
	}
	codes, hashes, err := generateBackupCodes(10)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar backup"})
	}
	hashJSON, _ := json.Marshal(hashes)
	now := time.Now()
	if err := h.db.Model(user).Updates(map[string]any{
		"totp_enabled_at":         now,
		"totp_backup_codes_hash":  string(hashJSON),
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao ativar"})
	}
	LogAudit(h.db, c, "2fa.enable",
		AuditTarget{Type: "user", ID: &user.ID}, nil)
	return c.JSON(fiber.Map{
		"enabled":      true,
		"backup_codes": codes,
		"warning":      "guarde estes códigos — não serão mostrados de novo",
	})
}

// Disable2FA POST /v1/auth/2fa/disable  { code }
func (h *AuthHandler) Disable2FA(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "auth required"})
	}
	if user.TOTPEnabledAt == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "2FA não está ativo"})
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if !totp.Validate(req.Code, user.TOTPSecret) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "código inválido"})
	}
	if err := h.db.Model(user).Updates(map[string]any{
		"totp_secret":             "",
		"totp_enabled_at":         nil,
		"totp_backup_codes_hash":  "",
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao desativar"})
	}
	LogAudit(h.db, c, "2fa.disable",
		AuditTarget{Type: "user", ID: &user.ID}, nil)
	return c.JSON(fiber.Map{"disabled": true})
}

// Verify2FA POST /v1/auth/2fa/verify  { challenge_token, code | backup_code }
//
// Troca o challenge_token (emitido pelo /login quando 2FA é exigido) +
// código TOTP atual por um access_token completo.
func (h *AuthHandler) Verify2FA(c *fiber.Ctx) error {
	var req struct {
		ChallengeToken string `json:"challenge_token"`
		Code           string `json:"code"`
		BackupCode     string `json:"backup_code"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	userID, err := middleware.ParseChallengeToken(req.ChallengeToken)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "challenge inválido ou expirado"})
	}
	var user models.User
	if err := h.db.Preload("Plan").First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "usuário não encontrado"})
	}
	if user.TOTPEnabledAt == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "2FA não está ativo"})
	}

	ok := false
	if req.Code != "" {
		ok = totp.Validate(req.Code, user.TOTPSecret)
	} else if req.BackupCode != "" {
		if consumeBackupCode(&user, req.BackupCode) {
			h.db.Model(&user).Update("totp_backup_codes_hash", user.TOTPBackupCodesHash)
			ok = true
		}
	}
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "código inválido"})
	}

	now := time.Now()
	h.db.Model(&user).Update("last_login_at", now)
	access, _ := middleware.GenerateAccessToken(&user)
	refresh, _ := middleware.GenerateRefreshToken(user.ID)
	c.Cookie(&fiber.Cookie{
		Name: "refresh_token", Value: refresh, HTTPOnly: true,
		SameSite: "Lax", Expires: now.Add(7 * 24 * time.Hour), Path: "/",
	})
	return c.JSON(fiber.Map{
		"access_token": access,
		"token_type":   "Bearer",
		"expires_in":   900,
		"user": fiber.Map{
			"id":       user.ID,
			"name":     user.Name,
			"email":    user.Email,
			"username": user.Username,
			"role":     user.Role,
			"is_beta":  user.IsBeta,
			"plan":     user.Plan,
		},
	})
}

// ─── helpers ──────────────────────────────────────────────────────────

func generateBackupCodes(n int) (plain []string, hashed []string, err error) {
	plain = make([]string, n)
	hashed = make([]string, n)
	for i := 0; i < n; i++ {
		buf := make([]byte, 6)
		if _, err = rand.Read(buf); err != nil {
			return nil, nil, err
		}
		// 10 chars base32 sem padding (legível pra digitar).
		code := strings.ToLower(strings.TrimRight(
			base32.StdEncoding.EncodeToString(buf), "="))[:10]
		plain[i] = fmt.Sprintf("%s-%s", code[:5], code[5:])
		h, err := bcrypt.GenerateFromPassword([]byte(plain[i]), 10)
		if err != nil {
			return nil, nil, err
		}
		hashed[i] = string(h)
	}
	return plain, hashed, nil
}

// consumeBackupCode tenta cada hash; se bater, remove da lista. Caller é
// responsável por persistir user.TOTPBackupCodesHash atualizado.
func consumeBackupCode(user *models.User, code string) bool {
	if user.TOTPBackupCodesHash == "" {
		return false
	}
	var hashes []string
	if err := json.Unmarshal([]byte(user.TOTPBackupCodesHash), &hashes); err != nil {
		return false
	}
	matched := -1
	for i, h := range hashes {
		if bcrypt.CompareHashAndPassword([]byte(h), []byte(strings.TrimSpace(code))) == nil {
			matched = i
			break
		}
	}
	if matched < 0 {
		return false
	}
	hashes = append(hashes[:matched], hashes[matched+1:]...)
	newJSON, _ := json.Marshal(hashes)
	user.TOTPBackupCodesHash = string(newJSON)
	return true
}
