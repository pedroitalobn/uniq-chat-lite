package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// OwnsInstance verifies the authenticated user has access to the given instance.
// SuperAdmins bypass this check. Regular users must own the instance OR be a member
// of the workspace that contains the instance.
func OwnsInstance(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// First validate auth if not already set
		if GetCurrentUser(c) == nil {
			if err := RequireAuth(db)(c); err != nil {
				return err
			}
		}

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
			// Distingue "não existe" de outros erros pra ajudar a debugar
			// quando o usuário vê a instância na lista mas o GET 404a.
			if err == gorm.ErrRecordNotFound {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error":       "instância não encontrada",
					"instance_id": instanceID.String(),
					"hint":        "ID não existe no DB — pode ter sido deletada por outra sessão. Recarregue a lista de instâncias.",
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "erro ao buscar instância: " + err.Error(),
			})
		}

		// SuperAdmins can access any instance
		if user.Role == models.RoleSuperAdmin {
			c.Locals("instance", &instance)
			return c.Next()
		}

		// Check if user owns the instance directly
		if instance.UserID == user.ID {
			c.Locals("instance", &instance)
			return c.Next()
		}

		// Check if user is a member of the workspace that owns the instance
		if instance.WorkspaceID != nil {
			var uw models.UserWorkspace
			if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, *instance.WorkspaceID).First(&uw).Error; err == nil {
				c.Locals("instance", &instance)
				return c.Next()
			}
		}

		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}
}

// GetCurrentInstance retrieves the instance stored by OwnsInstance or ResolveV1Instance.
func GetCurrentInstance(c *fiber.Ctx) *models.Instance {
	if inst, ok := c.Locals("instance").(*models.Instance); ok {
		return inst
	}
	return nil
}

// RequireWorkspaceAccess verifies the user is a member of the specified workspace.
func RequireWorkspaceAccess(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		workspaceID, err := uuid.Parse(c.Params("workspace_id"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id inválido"})
		}

		// SuperAdmins can access any workspace
		if user.Role == models.RoleSuperAdmin {
			return c.Next()
		}

		var uw models.UserWorkspace
		if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, workspaceID).First(&uw).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
		}

		c.Locals("user_workspace", &uw)
		return c.Next()
	}
}

// GetUserWorkspaceFromCtx retrieves the user's workspace membership from context.
func GetUserWorkspaceFromCtx(c *fiber.Ctx) *models.UserWorkspace {
	if uw, ok := c.Locals("user_workspace").(*models.UserWorkspace); ok {
		return uw
	}
	return nil
}

// OwnsServer verifies the authenticated user has access to the given server.
// SuperAdmins bypass this check. Regular users must own the server OR be a member
// of the workspace that contains the server.
func OwnsServer(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		serverID, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de server inválido"})
		}

		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "server não encontrado"})
		}

		// SuperAdmins can access any server
		if user.Role == models.RoleSuperAdmin {
			c.Locals("server", &server)
			return c.Next()
		}

		// Check if user owns the server directly
		if server.UserID == user.ID {
			c.Locals("server", &server)
			return c.Next()
		}

		// Check if user is a member of the workspace that owns the server
		if server.WorkspaceID != nil {
			var uw models.UserWorkspace
			if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, *server.WorkspaceID).First(&uw).Error; err == nil {
				c.Locals("server", &server)
				return c.Next()
			}
		}

		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
	}
}

// GetCurrentServer retrieves the server stored by OwnsServer.
func GetCurrentServer(c *fiber.Ctx) *models.Server {
	if srv, ok := c.Locals("server").(*models.Server); ok {
		return srv
	}
	return nil
}
