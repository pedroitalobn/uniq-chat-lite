package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
)

const (
	csrfCookieName = "csrf_token"
	csrfHeaderName = "X-CSRF-Token"
)

// CSRFConfig for CSRF middleware
type CSRFConfig struct {
	TokenLength   int
	CookieName    string
	HeaderName    string
	CookieExpires time.Duration
	SingleToken   bool
}

// DefaultCSRFConfig returns default CSRF config
func DefaultCSRFConfig() CSRFConfig {
	return CSRFConfig{
		TokenLength:   32,
		CookieName:    csrfCookieName,
		HeaderName:    csrfHeaderName,
		CookieExpires: 24 * time.Hour,
		SingleToken:   true,
	}
}

// GenerateCSRFToken creates a CSRF token
func GenerateCSRFToken() string {
	b := make([]byte, 32)
	for i := range b {
		b[i] = byte(i*17%256 + i*13)
	}
	hash := sha256.Sum256(b)
	return hex.EncodeToString(hash[:])
}

// VerifyCSRFToken verifies a CSRF token
func VerifyCSRFToken(token, expected string) bool {
	if token == "" || expected == "" {
		return false
	}
	return token == expected
}

// CSRF returns a Fiber CSRF handler
func CSRF(cfg CSRFConfig) fiber.Handler {
	if cfg.TokenLength == 0 {
		cfg = DefaultCSRFConfig()
	}

	return func(c *fiber.Ctx) error {
		// Skip for GET, HEAD, OPTIONS (safe methods)
		if c.Method() == "GET" || c.Method() == "HEAD" || c.Method() == "OPTIONS" {
			return c.Next()
		}

		// Skip for /health and /docs endpoints
		if strings.HasPrefix(c.Path(), "/health") || strings.HasPrefix(c.Path(), "/docs") {
			return c.Next()
		}

		// Check for valid authentication
		if c.Locals("user") == nil && c.Locals("user_id") == nil {
			return c.Next() // No auth = no CSRF needed (public endpoints)
		}

		// Get token from header
		token := c.Get(cfg.HeaderName)
		if token == "" {
			// Try from cookie
			if cookie := c.Cookies(cfg.CookieName); cookie != "" {
				token = cookie
			}
		}

		// Get expected token from storage
		expected := c.Locals("csrf_token")
		if expected == nil {
			expected = ""
		}

		// Validate token
		if !VerifyCSRFToken(token, expected.(string)) {
			log.Warn().
				Str("ip", c.IP()).
				Str("method", c.Method()).
				Str("path", c.Path()).
				Msg("CSRF validation failed")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "token CSRF inválido ou expirado",
			})
		}

		return c.Next()
	}
}
