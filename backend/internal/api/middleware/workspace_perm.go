package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ResolveWorkspaceID reads the active workspace ID from (in order):
//  1. URL path param `:workspace_id` or `:id` when the route lives under /workspaces/
//  2. Header `X-Workspace-ID`
//  3. Query `workspace_id`
//  4. c.Locals("workspace_id") — pode ter sido setado por outro middleware
//     (ex.: instance_token middleware seta o workspace da instância)
//
// Returns uuid.Nil if none was provided. Not an error — lets routes that
// don't require a workspace continue.
func ResolveWorkspaceID(c *fiber.Ctx) uuid.UUID {
	candidates := []string{
		c.Params("workspace_id"),
		c.Get("X-Workspace-ID"),
		c.Query("workspace_id"),
	}
	for _, raw := range candidates {
		if raw == "" {
			continue
		}
		if id, err := uuid.Parse(raw); err == nil {
			return id
		}
	}
	// Fallback: locals já tem (set por outro middleware)
	if id, ok := c.Locals("workspace_id").(uuid.UUID); ok && id != uuid.Nil {
		return id
	}
	return uuid.Nil
}

// ResolveWorkspaceIDWithFallback é como ResolveWorkspaceID, mas se nenhum
// for explícito tenta resolver pelo workspace padrão do user autenticado:
//   - Se user tem só 1 workspace, usa esse (resolução natural)
//   - Se user tem múltiplos, retorna o primeiro onde é owner (default)
//
// Útil pra integrações via API key onde o cliente n8n/Zapier não quer
// declarar workspace explicitamente em cada chamada.
func ResolveWorkspaceIDWithFallback(c *fiber.Ctx, db *gorm.DB) uuid.UUID {
	if id := ResolveWorkspaceID(c); id != uuid.Nil {
		return id
	}
	user := GetCurrentUser(c)
	if user == nil {
		return uuid.Nil
	}
	// Tenta workspace onde é owner primeiro, ordenado por joined_at
	var uw models.UserWorkspace
	if err := db.Where("user_id = ? AND is_owner = ?", user.ID, true).
		Order("joined_at ASC").First(&uw).Error; err == nil {
		return uw.WorkspaceID
	}
	if err := db.Where("user_id = ?", user.ID).
		Order("joined_at ASC").First(&uw).Error; err == nil {
		return uw.WorkspaceID
	}
	return uuid.Nil
}

// RequireWorkspacePermission is the header/query-aware variant of
// RequirePermission. Unlike RequirePermission (which only fires when
// :workspace_id is in the URL), this one REQUIRES a workspace id and denies
// access if not provided. Super-admin users bypass the check.
//
// Store workspace_id in c.Locals("workspace_id") for downstream handlers.
func RequireWorkspacePermission(db *gorm.DB, permissionKey string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		// Super-admin bypass
		if user.Role == models.RoleSuperAdmin {
			wsID := ResolveWorkspaceIDWithFallback(c, db)
			if wsID != uuid.Nil {
				c.Locals("workspace_id", wsID)
			}
			return c.Next()
		}

		// Resolução agora cai pro workspace padrão do user se nenhum for
		// explícito — integrações via API key não precisam declarar workspace
		// quando o user só tem um (caso comum). Se tem múltiplos, usa o que
		// é owner (estável).
		wsID := ResolveWorkspaceIDWithFallback(c, db)
		if wsID == uuid.Nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id não pôde ser resolvido (passe X-Workspace-ID, ?workspace_id= ou path; ou crie um workspace pra esse usuário)"})
		}

		var uw models.UserWorkspace
		if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, wsID).First(&uw).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
		}

		c.Locals("workspace_id", wsID)
		c.Locals("user_workspace", &uw)

		if uw.IsOwner {
			return c.Next()
		}
		if uw.RoleID == nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem função definida"})
		}

		var count int64
		db.Model(&models.RolePermission{}).
			Joins("JOIN permissions ON permissions.id = role_permissions.permission_id").
			Where("role_permissions.role_id = ? AND permissions.key = ?", uw.RoleID, permissionKey).
			Count(&count)

		if count == 0 {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "permissão insuficiente"})
		}
		return c.Next()
	}
}

// RequireAnyWorkspacePermission é a variante OR de RequireWorkspacePermission:
// passa se o user tiver QUALQUER uma das permissions listadas. Útil pra rotas
// que servem múltiplos perfis (ex: relatórios — qualquer um com tickets:view
// pode ver as métricas do próprio inbox, não só quem tem reports:view).
// Owner e super-admin sempre passam.
func RequireAnyWorkspacePermission(db *gorm.DB, permissionKeys ...string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		if user.Role == models.RoleSuperAdmin {
			wsID := ResolveWorkspaceID(c)
			if wsID != uuid.Nil {
				c.Locals("workspace_id", wsID)
			}
			return c.Next()
		}

		wsID := ResolveWorkspaceID(c)
		if wsID == uuid.Nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id é obrigatório (X-Workspace-ID, query ?workspace_id=, ou path)"})
		}

		var uw models.UserWorkspace
		if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, wsID).First(&uw).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
		}

		c.Locals("workspace_id", wsID)
		c.Locals("user_workspace", &uw)

		if uw.IsOwner {
			return c.Next()
		}
		if uw.RoleID == nil || len(permissionKeys) == 0 {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem função definida"})
		}

		var count int64
		db.Model(&models.RolePermission{}).
			Joins("JOIN permissions ON permissions.id = role_permissions.permission_id").
			Where("role_permissions.role_id = ? AND permissions.key IN ?", uw.RoleID, permissionKeys).
			Count(&count)

		if count == 0 {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "permissão insuficiente"})
		}
		return c.Next()
	}
}

// GetWorkspaceID reads workspace_id from c.Locals (set by RequireWorkspacePermission).
func GetWorkspaceID(c *fiber.Ctx) uuid.UUID {
	if id, ok := c.Locals("workspace_id").(uuid.UUID); ok {
		return id
	}
	return uuid.Nil
}

// GetUserWorkspaceFromCtx is defined in tenant.go.

