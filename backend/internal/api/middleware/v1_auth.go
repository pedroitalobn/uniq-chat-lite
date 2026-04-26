package middleware

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// reservedV1Namespaces — primeiros segmentos depois de /v1/ que pertencem
// ao API tradicional (não ao layout /v1/:server/:instance). ResolveV1Instance
// é registrado como Use middleware em /v1/:server_slug/:instance_slug, então
// o Fiber dispara ele em QUALQUER URL /v1/X/Y — incluindo /v1/me/presence,
// /v1/instances/:id, /v1/workspaces/:id/members, etc. Sem esse bypass, todos
// caem em "server not found" 404.
var reservedV1Namespaces = map[string]bool{
	"admin":          true,
	"agent":          true,
	"agents":         true,
	"asaas":          true,
	"auth":           true,
	"campaigns":      true,
	"channels":       true,
	"conversations":  true,
	"crm":            true,
	"csat":           true,
	"departments":    true,
	"instances":      true,
	"integrations":   true,
	"invites":        true,
	"me":             true,
	"messages":       true,
	"payments":       true,
	"permissions":    true,
	"presence":       true,
	"proxies":        true,
	"queues":         true,
	"quick-replies":  true,
	"reports":        true,
	"roles":          true,
	"servers":        true,
	"stripe":         true,
	"tags":           true,
	"teams":          true,
	"webhook-config": true,
	"webhooks":       true,
	"workspaces":     true,
	"ws":             true,
}

// ResolveV1Instance resolves a request for /v1/:server_slug/:instance_slug/*
// and authorizes it. Aceita dois formatos de token:
//   1. Instance token (`instances.token`) — acesso escopado a UMA instância
//   2. Global API key (`sk_...`) do dono da instância — destrava todas as
//      instâncias daquele user, útil pra n8n/integrações que gerenciam
//      várias instâncias com uma credencial só.
func ResolveV1Instance(db *gorm.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		serverSlug := c.Params("server_slug")
		instanceSlug := c.Params("instance_slug")

		// Bypass: prefixo é namespace reservado da API tradicional. Deixa
		// os handlers do api.Group("/v1") cuidarem da request.
		if reservedV1Namespaces[serverSlug] {
			return c.Next()
		}

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

		token := extractInstanceToken(c)
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "instance token required (apikey: <token> or Authorization: Bearer <token>)"})
		}

		authorized := token == instance.Token
		// Fallback: global API key (sk_*) pertencente ao dono da instância.
		if !authorized && strings.HasPrefix(token, "sk_") {
			hash := models.HashAPIKey(token)
			var apiKey models.APIKey
			if err := db.First(&apiKey, "key_hash = ? AND is_active = true", hash).Error; err == nil {
				if apiKey.UserID == instance.UserID {
					authorized = true
					now := time.Now()
					db.Model(&apiKey).Update("last_used_at", now)
				}
			}
		}
		if !authorized {
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
	// `apikey` é o header canônico documentado em /api-docs. Mantemos
	// X-Instance-Token e Authorization: Bearer aceitos pra não quebrar
	// integrações antigas.
	if t := c.Get("apikey"); t != "" {
		return t
	}
	if t := c.Get("X-Instance-Token"); t != "" {
		return t
	}
	auth := c.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}
