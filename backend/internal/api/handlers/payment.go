package handlers

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type PaymentHandler struct {
	db         *gorm.DB
	stripeH    *StripeHandler
	asaasH     *AsaasHandler
	abacatepayH *AbacatePayHandler
}

func NewPaymentHandler(db *gorm.DB, stripeH *StripeHandler, asaasH *AsaasHandler, abacatepayH *AbacatePayHandler) *PaymentHandler {
	return &PaymentHandler{db: db, stripeH: stripeH, asaasH: asaasH, abacatepayH: abacatepayH}
}

// getActiveProvider returns the active provider saved in the DB, defaulting to stripe
func (h *PaymentHandler) getActiveProvider() string {
	var settings models.PaymentSettings
	if err := h.db.First(&settings).Error; err == nil && settings.ActiveProvider != "" {
		return string(settings.ActiveProvider)
	}
	return string(models.PaymentProviderStripe) // default
}

// ListPlans proxy
func (h *PaymentHandler) ListPlans(c *fiber.Ctx) error {
	provider := h.getActiveProvider()
	switch provider {
	case string(models.PaymentProviderAsaas):
		return h.asaasH.ListPlans(c)
	case string(models.PaymentProviderAbacatePay):
		return h.abacatepayH.ListPlans(c)
	}
	return h.stripeH.ListPlans(c)
}

// CreateCheckout proxy
func (h *PaymentHandler) CreateCheckout(c *fiber.Ctx) error {
	provider := h.getActiveProvider()
	switch provider {
	case string(models.PaymentProviderAsaas):
		return h.asaasH.CreateCheckout(c)
	case string(models.PaymentProviderAbacatePay):
		return h.abacatepayH.CreateCheckout(c)
	}
	return h.stripeH.CreateCheckout(c)
}

// GetSubscription proxy
func (h *PaymentHandler) GetSubscription(c *fiber.Ctx) error {
	provider := h.getActiveProvider()
	switch provider {
	case string(models.PaymentProviderAsaas):
		return h.asaasH.GetSubscription(c)
	case string(models.PaymentProviderAbacatePay):
		return h.abacatepayH.GetSubscription(c)
	}
	return h.stripeH.GetSubscription(c)
}

// FinalizeRegistration godoc
// POST /v1/payments/finalize-registration
//
// Endpoint genérico (provider-agnóstico) chamado pelo front depois que
// o usuário paga. Estratégia:
//
//  1. Webhook é o caminho preferido — se já chegou e materializou o
//     User, esse handler só lê o User pelo email do pending e devolve
//     o token (sem custo de chamada externa).
//
//  2. Se o User ainda não existe, fazemos fallback consultando a API
//     do provider (Stripe/Asaas) pra confirmar o status do pagamento.
//     Se confirmado, materializa no ato (idempotente — webhook
//     subsequente é no-op).
//
//  3. Se nem webhook chegou nem provider confirma pagamento, devolve
//     202 Accepted pro front fazer poll curto (3-4 tentativas).
//
// Body: { "pending_id": "...", "payment_intent_id": "..." (opt), "session_id": "..." (opt) }
func (h *PaymentHandler) FinalizeRegistration(c *fiber.Ctx) error {
	var req struct {
		PendingID       string `json:"pending_id"`
		PaymentIntentID string `json:"payment_intent_id"`
		SessionID       string `json:"session_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if strings.TrimSpace(req.PendingID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "pending_id é obrigatório"})
	}
	pendingID, err := uuid.Parse(req.PendingID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "pending_id inválido"})
	}

	var pending models.PendingRegistration
	if err := h.db.First(&pending, "id = ?", pendingID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "pending não encontrado"})
	}

	// Caminho 1: webhook já materializou — só emite token.
	if user, ok := h.lookupMaterializedUser(&pending); ok {
		return h.respondWithSession(c, user)
	}

	// Caminho 2: fallback de provider (consulta API).
	provider := h.detectProvider(&pending)
	switch provider {
	case "stripe":
		if h.stripeH.confirmAndMaterializeFromAPI(&pending, req.PaymentIntentID, req.SessionID) {
			if user, ok := h.lookupMaterializedUser(&pending); ok {
				return h.respondWithSession(c, user)
			}
		}
	case "asaas":
		// Asaas finalize ainda não implementado — quando estiver,
		// segue o mesmo padrão. Por ora, cai no 202 abaixo.
	case "abacatepay":
		// AbacatePay: webhook é o caminho principal. Se o user já foi
		// materializado pelo webhook, o Caminho 1 já resolveu acima.
		// Se ainda não, o poll do front vai tentar de novo.
	}

	// Caminho 3: ainda processando — front deve fazer poll.
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
		"status":  "pending",
		"message": "pagamento ainda não confirmado — tente novamente em alguns segundos",
	})
}

// detectProvider olha o snapshot do pending pra inferir qual provider
// foi usado no checkout. Se não der pra inferir, cai no provider ativo
// salvo nas settings.
func (h *PaymentHandler) detectProvider(p *models.PendingRegistration) string {
	if p.StripeSessionID != "" || p.StripePIID != "" || p.StripeCustomerID != "" {
		return "stripe"
	}
	if p.AbaCustID != "" {
		return "abacatepay"
	}
	return h.getActiveProvider()
}

// lookupMaterializedUser tenta achar o User materializado pelo email do
// pending. Se já existe e está ativo, é sinal de que o webhook chegou.
func (h *PaymentHandler) lookupMaterializedUser(p *models.PendingRegistration) (*models.User, bool) {
	var user models.User
	if err := h.db.Preload("Plan").Where("email = ?", p.Email).First(&user).Error; err != nil {
		return nil, false
	}
	if !user.IsActive {
		return nil, false
	}
	return &user, true
}

// respondWithSession devolve access_token + refresh_token (cookie) +
// dados do user/workspace. Igual ao retorno do /register/complete free.
func (h *PaymentHandler) respondWithSession(c *fiber.Ctx, user *models.User) error {
	accessToken, err := middleware.GenerateAccessToken(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar token"})
	}
	refreshToken, _ := middleware.GenerateRefreshToken(user.ID)
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HTTPOnly: true,
		SameSite: "Lax",
		Path:     "/",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
	})

	var workspace models.Workspace
	h.db.Where("owner_id = ?", user.ID).Order("created_at ASC").First(&workspace)

	return c.JSON(fiber.Map{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   900,
		"user": fiber.Map{
			"id":       user.ID,
			"name":     user.Name,
			"email":    user.Email,
			"username": user.Username,
			"role":     user.Role,
			"plan":     user.Plan,
		},
		"workspace": workspace,
	})
}
