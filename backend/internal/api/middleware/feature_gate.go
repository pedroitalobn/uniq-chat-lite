package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// RequireFeature retorna 402 (Payment Required) se o plano do user
// não libera a feature. Carrega o plano lazy se ainda não veio do
// middleware de auth.
//
// Uso:
//   /v1/agents → RequireFeature(db, models.FeatureAI)
//   /v1/journeys → RequireFeature(db, models.FeatureJourneys)
//   etc.
//
// O 402 carrega payload com:
//   { error: "feature_locked", feature: "ai", upgrade_url: "/plans" }
// Frontend exibe banner "Faça upgrade pra acessar X".
func RequireFeature(db *gorm.DB, key models.FeatureKey) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user := GetCurrentUser(c)
		// Lazy-load do plano se o middleware de auth não fez Preload.
		if user != nil && user.Plan == nil && user.PlanID != nil {
			var plan models.Plan
			if err := db.First(&plan, "id = ?", *user.PlanID).Error; err == nil {
				user.Plan = &plan
			}
		}
		var p *models.Plan
		if user != nil {
			p = user.Plan
		}

		// Super admin nunca é gateado.
		if user != nil && user.Role == models.RoleSuperAdmin {
			return c.Next()
		}

		if !p.HasFeature(key) {
			return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{
				"error":       "feature_locked",
				"feature":     string(key),
				"message":     "Seu plano atual não inclui esse recurso. Faça upgrade pra desbloquear.",
				"upgrade_url": "/billing",
			})
		}
		return c.Next()
	}
}
