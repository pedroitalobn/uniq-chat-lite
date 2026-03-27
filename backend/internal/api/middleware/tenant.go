package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// OwnsInstance verifies the authenticated user owns the given instance.
// Admins bypass this check.
func OwnsInstance(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		instanceID, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de instância inválido"})
		}

		var instance models.Instance
		if err := db.Preload("Server").First(&instance, "id = ?", instanceID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
		}

		// Admins can access any instance
		if user.Role == models.RoleAdmin {
			c.Locals("instance", &instance)
			return c.Next()
		}

		if instance.UserID != user.ID {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
		}

		c.Locals("instance", &instance)
		return c.Next()
	}
}

// GetCurrentInstance retrieves the instance stored by OwnsInstance or ResolveV1Instance.
func GetCurrentInstance(c *fiber.Ctx) *models.Instance {
	if inst, ok := c.Locals("instance").(*models.Instance); ok {
		return inst
	}
	return nil
}
