package middleware

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type Claims struct {
	UserID uuid.UUID       `json:"user_id"`
	Email  string          `json:"email"`
	Role   models.UserRole `json:"role"`
	IsBeta bool            `json:"is_beta"`
	jwt.RegisteredClaims
}

type RefreshClaims struct {
	UserID uuid.UUID `json:"user_id"`
	jwt.RegisteredClaims
}

func GenerateAccessToken(user *models.User) (string, error) {
	claims := Claims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		IsBeta: user.IsBeta,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.AppConfig.JWTSecret))
}

func GenerateRefreshToken(userID uuid.UUID) (string, error) {
	claims := RefreshClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.AppConfig.JWTRefreshSecret))
}

func ParseAccessToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(config.AppConfig.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, fiber.ErrUnauthorized
	}
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fiber.ErrUnauthorized
	}
	return claims, nil
}

func ParseRefreshToken(tokenStr string) (*RefreshClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &RefreshClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(config.AppConfig.JWTRefreshSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, fiber.ErrUnauthorized
	}
	claims, ok := token.Claims.(*RefreshClaims)
	if !ok {
		return nil, fiber.ErrUnauthorized
	}
	return claims, nil
}

// RequireAuth validates JWT from Bearer header or cookie
func RequireAuth(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// ResolveV1Instance roda antes em /v1/:server/:instance/* e já
		// preenche c.Locals("instance") + c.Locals("user"). Nessa rota,
		// RequireAuth está sobrepondo (Fiber dispara o middleware do
		// app.Group("/v1") em qualquer path /v1/*), e a tentativa de
		// validar o instance token como JWT falha → "token inválido".
		// Se já autenticamos via instance token, é seguro pular.
		if instance := c.Locals("instance"); instance != nil {
			if user := c.Locals("user"); user != nil {
				return c.Next()
			}
		}

		tokenStr := extractToken(c)
		if tokenStr == "" {
			// Try API Key
			return tryAPIKey(c, db)
		}

		claims, err := ParseAccessToken(tokenStr)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "token inválido ou expirado"})
		}

		// Load user
		var user models.User
		if err := db.Preload("Plan").First(&user, "id = ?", claims.UserID).Error; err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "usuário não encontrado"})
		}
		if user.IsBlocked() {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "conta desativada ou bloqueada"})
		}

		c.Locals("user", &user)
		c.Locals("user_id", user.ID)
		return c.Next()
	}
}

// RequireAdmin ensures the authenticated user has admin role
func RequireAdmin() fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals("user").(*models.User)
		if !ok || user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}
		if user.Role != models.RoleSuperAdmin {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso restrito a administradores"})
		}
		return c.Next()
	}
}

func extractToken(c *fiber.Ctx) string {
	auth := c.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if cookie := c.Cookies("access_token"); cookie != "" {
		return cookie
	}
	if t := c.Query("token"); strings.Count(t, ".") == 2 {
		return t
	}
	return ""
}

func tryAPIKey(c *fiber.Ctx, db *gorm.DB) error {
	// `apikey` é o header canônico. Mantemos `X-API-Key` aceito pra
	// não quebrar integrações antigas — toda a documentação nova
	// (api-docs) aponta pro `apikey`.
	key := c.Get("apikey")
	if key == "" {
		key = c.Get("X-API-Key")
	}
	if key == "" {
		// Also accept ?token= query param (used by MCP SSE clients)
		key = c.Query("token")
	}
	if key == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "autenticação necessária"})
	}

	// Instance tokens (prefixo `it_`) são escopados à rota
	// /v1/:server_slug/:instance_slug/* (ResolveV1Instance). Rejeitamos
	// cedo aqui — sem tocar no DB de api_keys — pra deixar explícito que
	// a credencial não foi feita pra autenticar outros recursos.
	if strings.HasPrefix(key, "it_") {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "instance token só é aceito em /v1/:server_slug/:instance_slug/*",
		})
	}

	hash := models.HashAPIKey(key)
	var apiKey models.APIKey
	if err := db.Preload("User.Plan").First(&apiKey, "key_hash = ? AND is_active = true", hash).Error; err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "API key inválida"})
	}

	if apiKey.User.IsBlocked() {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "conta desativada ou bloqueada"})
	}

	// Update last_used_at
	now := time.Now()
	db.Model(&apiKey).Update("last_used_at", now)

	c.Locals("user", apiKey.User)
	c.Locals("user_id", apiKey.UserID)
	return c.Next()
}

// GetCurrentUser helper
func GetCurrentUser(c *fiber.Ctx) *models.User {
	user, _ := c.Locals("user").(*models.User)
	return user
}

// GetCurrentUserID helper
func GetCurrentUserID(c *fiber.Ctx) uuid.UUID {
	user := GetCurrentUser(c)
	if user == nil {
		return uuid.Nil
	}
	return user.ID
}

// RequirePermission checks if user has a specific permission in the workspace
func RequirePermission(db *gorm.DB, permissionKey string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		workspaceID := c.Params("workspace_id")
		if workspaceID == "" {
			return c.Next()
		}

		wsUUID, err := uuid.Parse(workspaceID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id inválido"})
		}

		// Check if user is owner (owners have all permissions)
		var uw models.UserWorkspace
		if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, wsUUID).First(&uw).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado ao workspace"})
		}

		if uw.IsOwner {
			return c.Next()
		}

		// Check permission
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

// GetUserWorkspace retrieves the user's workspace membership
func GetUserWorkspace(db *gorm.DB, userID uuid.UUID, workspaceID uuid.UUID) (*models.UserWorkspace, error) {
	var uw models.UserWorkspace
	err := db.Preload("Role.Permissions").
		Where("user_id = ? AND workspace_id = ?", userID, workspaceID).
		First(&uw).Error
	return &uw, err
}
