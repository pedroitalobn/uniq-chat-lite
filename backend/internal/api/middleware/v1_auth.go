package middleware

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// resolveAuthInstanceByID popula c.Locals("instance") respeitando o gating
// do OwnsInstance — usado quando uma rota /v1/instances/<uuid>/... é
// roteada pelo v1inst group (porque foi declarada antes do api group).
//
// IMPORTANTE: nunca chame middlewares (RequireAuth etc) daqui. Eles
// disparam c.Next() ao final, que causaria dupla execução do handler
// final — request fica em loop e timeout no client. Lógica de auth é
// inline pra controlar o fluxo.
func resolveAuthInstanceByID(db *gorm.DB, c *fiber.Ctx, instanceID uuid.UUID) error {
	// Carrega user do JWT inline (sem chamar middleware que faria Next).
	user := GetCurrentUser(c)
	if user == nil {
		tokenStr := extractToken(c)
		if tokenStr == "" {
			// Sem JWT — esse path requer auth de app, instance token aqui não vale.
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "autenticação requerida"})
		}
		claims, err := ParseAccessToken(tokenStr)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "token inválido ou expirado"})
		}
		var u models.User
		if err := db.Preload("Plan").First(&u, "id = ?", claims.UserID).Error; err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "usuário não encontrado"})
		}
		if u.IsBlocked() {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "conta desativada ou bloqueada"})
		}
		c.Locals("user", &u)
		c.Locals("user_id", u.ID)
		user = &u
	}

	var instance models.Instance
	if err := db.Preload("Server").First(&instance, "id = ?", instanceID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error":       "instância não encontrada",
				"instance_id": instanceID.String(),
				"hint":        "ID não existe no DB — pode ter sido deletada por outra sessão. Recarregue a lista de instâncias.",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar instância: " + err.Error()})
	}

	// SuperAdmin / dono / membro do workspace — mesmo gating do OwnsInstance.
	if user.Role == models.RoleSuperAdmin || instance.UserID == user.ID {
		c.Locals("instance", &instance)
		return nil
	}
	if instance.WorkspaceID != nil {
		var uw models.UserWorkspace
		if err := db.Where("user_id = ? AND workspace_id = ?", user.ID, *instance.WorkspaceID).First(&uw).Error; err == nil {
			c.Locals("instance", &instance)
			return nil
		}
	}
	return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "acesso negado"})
}

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

		// Bypass: prefixo é namespace reservado da API tradicional.
		//
		// MAS: o Fiber às vezes casa rotas do v1inst group antes das do
		// api group quando ambas são candidatas (ex:
		// /v1/instances/<uuid>/messages/template casa tanto
		// /v1/:server_slug/:instance_slug/messages/template como
		// /v1/instances/:id/messages/template, e a primeira foi
		// declarada antes). Sem mais nada, c.Next() cai no handler do
		// v1inst (rota SDK) com Locals vazia e o handler retorna 404
		// "instância não encontrada".
		//
		// Solução: quando o slug é "instances" e o instance_slug é um
		// UUID válido, popula c.Locals("instance") aplicando o mesmo
		// gating de OwnsInstance — assim o handler downstream encontra
		// a instância com o ID correto e responde como na rota auth.
		// Para os demais reserved (workspaces, me, etc), só Next().
		if reservedV1Namespaces[serverSlug] {
			if serverSlug == "instances" && instanceSlug != "" {
				if iid, err := uuid.Parse(instanceSlug); err == nil {
					if err := resolveAuthInstanceByID(db, c, iid); err != nil {
						return err
					}
				}
			}
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
