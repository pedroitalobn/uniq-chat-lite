package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ResolveV1Instance resolves a request for /v1/:server_slug/:instance_slug/*
// It looks up the server and instance by their slugs and validates the instance
// token from the Authorization header (Bearer <token>) or X-Instance-Token header.
func ResolveV1Instance(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		serverSlug := c.Params("server_slug")
		instanceSlug := c.Params("instance_slug")

		// Resolve server
		var server models.Server
		if err := db.First(&server, "slug = ? AND is_active = true", serverSlug).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "server not found"})
		}

		// Resolve instance within server
		var instance models.Instance
		if err := db.First(&instance, "server_id = ? AND slug = ?", server.ID, instanceSlug).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instance not found"})
		}

		// Verify token
		token := extractInstanceToken(c)
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "instance token required (Authorization: Bearer <token> or X-Instance-Token)"})
		}
		if token != instance.Token {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid instance token"})
		}

		// Load the owning user (for rate limiting / plan checks in handlers)
		var user models.User
		db.Preload("Plan").First(&user, "id = ?", instance.UserID)
		if user.IsBlocked() {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "account disabled"})
		}

		c.Locals("instance", &instance)
		c.Locals("server", &server)
		c.Locals("user", &user)
		c.Locals("user_id", user.ID)
		return c.Next()
	}
}

func extractInstanceToken(c *fiber.Ctx) string {
	if t := c.Get("X-Instance-Token"); t != "" {
		return t
	}
	auth := c.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}
