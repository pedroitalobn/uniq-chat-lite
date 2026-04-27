package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	stripe "github.com/stripe/stripe-go/v76"
	stripeinvoice "github.com/stripe/stripe-go/v76/invoice"
	stripesub "github.com/stripe/stripe-go/v76/subscription"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// BillingHandler — fluxo de upgrade/downgrade com proration nativa
// do Stripe. Asaas pode adaptar depois replicando a interface.
//
// Caminhos cobertos:
//   POST /billing/upgrade        — troca o plano de uma sub existente
//   POST /billing/cancel         — cancela ao final do ciclo (mantém uso)
//   POST /billing/resume         — desfaz cancelamento agendado
//   GET  /billing/preview/:plan  — calcula proration sem aplicar (preview)
type BillingHandler struct {
	db *gorm.DB
}

func NewBillingHandler(db *gorm.DB) *BillingHandler {
	return &BillingHandler{db: db}
}

// PreviewUpgrade — GET /v1/billing/preview/:planId
//
// Calcula quanto o user pagará HOJE pra trocar pro plano alvo, usando
// proration_behavior="create_prorations" do Stripe. Retorna o valor
// em centavos pra UI mostrar "Você pagará R$ X agora pelos Y dias
// restantes do ciclo. Próximo mês: R$ Z".
func (h *BillingHandler) PreviewUpgrade(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	planID, err := uuid.Parse(c.Params("planId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "planId inválido"})
	}
	var newPlan models.Plan
	if err := h.db.First(&newPlan, "id = ?", planID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}
	if newPlan.StripePriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plano sem stripe_price_id"})
	}
	if user.StripeSubscriptionID == "" {
		// Sem subscription ativa: não tem proration — vai pra checkout normal.
		return c.JSON(fiber.Map{
			"has_active_subscription": false,
			"action":                  "checkout",
			"new_plan":                newPlan.Name,
			"new_price":               newPlan.Price,
			"message":                 "Você não tem assinatura ativa. Use /stripe/checkout pra criar uma.",
		})
	}

	// Stripe Invoices.Upcoming com items modificados — calcula proration
	// EXATA (incluindo créditos não-usados, descontos, taxas, impostos)
	// SEM aplicar. O valor retornado bate 1:1 com o que será cobrado
	// quando /billing/upgrade rodar.
	sub, err := stripesub.Get(user.StripeSubscriptionID, nil)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "stripe: " + err.Error()})
	}
	if len(sub.Items.Data) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "subscription sem items"})
	}
	currentItemID := sub.Items.Data[0].ID

	upcomingParams := &stripe.InvoiceUpcomingParams{
		Customer:     stripe.String(user.StripeCustomerID),
		Subscription: stripe.String(sub.ID),
		SubscriptionItems: []*stripe.SubscriptionItemsParams{{
			ID:    stripe.String(currentItemID),
			Price: stripe.String(newPlan.StripePriceID),
		}},
		SubscriptionProrationBehavior: stripe.String("create_prorations"),
	}
	upcoming, err := stripeinvoice.Upcoming(upcomingParams)
	if err != nil {
		log.Warn().Err(err).Msg("billing: stripe upcoming invoice failed")
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "stripe upcoming: " + err.Error()})
	}

	// Plano antigo (info pra UI mostrar diff)
	var oldPrice float64
	if user.PlanID != nil {
		var op models.Plan
		if err := h.db.First(&op, "id = ?", *user.PlanID).Error; err == nil {
			oldPrice = op.Price
		}
	}

	periodEnd := time.Unix(sub.CurrentPeriodEnd, 0)
	daysRemaining := int(time.Until(periodEnd).Hours() / 24)

	return c.JSON(fiber.Map{
		"has_active_subscription": true,
		"new_plan":                newPlan.Name,
		"new_price":               newPlan.Price,
		"old_price":               oldPrice,
		"current_period_end":      periodEnd,
		"days_remaining":          daysRemaining,
		"amount_due_now":          upcoming.AmountDue,         // centavos — exato
		"subtotal":                upcoming.Subtotal,           // centavos
		"total":                   upcoming.Total,              // centavos
		"next_charge_amount":      int64(newPlan.Price * 100),  // próximo ciclo
		"currency":                string(upcoming.Currency),
	})
}

// Upgrade — POST /v1/billing/upgrade
//
// Body: { "plan_id": "<uuid>" }
//
// Aplica a troca de plano na subscription Stripe existente com proration
// automática. Se não tem sub ativa, retorna 400 sugerindo /stripe/checkout.
func (h *BillingHandler) Upgrade(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	var req struct {
		PlanID string `json:"plan_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.PlanID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plan_id é obrigatório"})
	}

	planID, err := uuid.Parse(req.PlanID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plan_id inválido"})
	}
	var newPlan models.Plan
	if err := h.db.First(&newPlan, "id = ?", planID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}
	if newPlan.StripePriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plano sem stripe_price_id"})
	}

	// Sem subscription ativa: client deve usar /stripe/checkout pra criar.
	if user.StripeSubscriptionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":           "no_active_subscription",
			"message":         "Crie uma assinatura via /stripe/checkout primeiro.",
			"checkout_endpoint": "/v1/stripe/checkout",
		})
	}

	// Recupera a sub atual pra achar o item ID e o plano antigo (audit).
	sub, err := stripesub.Get(user.StripeSubscriptionID, nil)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "stripe get: " + err.Error()})
	}
	if len(sub.Items.Data) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "subscription sem items"})
	}
	currentItemID := sub.Items.Data[0].ID

	// Captura plano anterior pra log de auditoria.
	var oldPlan models.Plan
	if user.PlanID != nil {
		_ = h.db.First(&oldPlan, "id = ?", *user.PlanID).Error
	}

	// Aplica a troca com proration nativa do Stripe. "create_prorations"
	// emite uma fatura imediata pelo crédito do plano antigo (dias não
	// usados) - fatura imediata pelos dias restantes no plano novo.
	updateParams := &stripe.SubscriptionParams{
		Items: []*stripe.SubscriptionItemsParams{{
			ID:    stripe.String(currentItemID),
			Price: stripe.String(newPlan.StripePriceID),
		}},
		ProrationBehavior: stripe.String("create_prorations"),
		Metadata: map[string]string{
			"user_id": user.ID.String(),
			"plan_id": newPlan.ID.String(),
		},
	}
	updated, err := stripesub.Update(sub.ID, updateParams)
	if err != nil {
		log.Error().Err(err).Str("sub", sub.ID).Str("plan", newPlan.Name).Msg("billing: stripe upgrade failed")
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha no upgrade Stripe: " + err.Error()})
	}

	// Atualiza plano local imediatamente. O webhook customer.subscription.updated
	// também vai chamar isso, mas a UI ganha resposta síncrona.
	now := time.Now()
	h.db.Model(&user).Updates(map[string]any{
		"plan_id":                    newPlan.ID,
		"stripe_subscription_status": string(updated.Status),
		"updated_at":                 now,
	})

	// Audit log — usado pelo admin pra debugar suporte ("subiu pra Pro
	// quando?"). Source = self pq foi user clicando upgrade.
	logEntry := models.PlanChangeLog{
		UserID:               user.ID,
		FromPlanID:           user.PlanID,
		ToPlanID:             &newPlan.ID,
		FromPlanName:         oldPlan.Name,
		ToPlanName:           newPlan.Name,
		Source:               models.PlanChangeSourceSelf,
		ActorID:              &user.ID,
		ActorEmail:           user.Email,
		StripeSubscriptionID: sub.ID,
		// ProrationAmount poderia vir do upcoming invoice mas isso seria
		// outra round-trip; o webhook subscription.updated vai gravar
		// quando vier o invoice.created.
	}
	h.db.Create(&logEntry)

	return c.JSON(fiber.Map{
		"success":             true,
		"new_plan":            newPlan.Name,
		"subscription_status": updated.Status,
		"current_period_end":  time.Unix(updated.CurrentPeriodEnd, 0),
		"message":             "Upgrade aplicado. Proration calculada pelo Stripe.",
	})
}

// Cancel — POST /v1/billing/cancel
//
// Cancela a subscription AO FINAL DO CICLO atual (cancel_at_period_end=true).
// User mantém acesso até a data de fim. Pra cancelar imediatamente, passar
// {"immediate": true}.
func (h *BillingHandler) Cancel(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	if user.StripeSubscriptionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sem assinatura ativa"})
	}
	var req struct {
		Immediate bool `json:"immediate"`
	}
	_ = c.BodyParser(&req)

	if req.Immediate {
		_, err := stripesub.Cancel(user.StripeSubscriptionID, nil)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "cancelled": "immediate"})
	}
	updated, err := stripesub.Update(user.StripeSubscriptionID, &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(true),
	})
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"success":           true,
		"cancelled":         "at_period_end",
		"current_period_end": time.Unix(updated.CurrentPeriodEnd, 0),
	})
}

// Resume — POST /v1/billing/resume
//
// Desfaz um cancelamento agendado (cancel_at_period_end=false).
func (h *BillingHandler) Resume(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	if user.StripeSubscriptionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sem assinatura ativa"})
	}
	updated, err := stripesub.Update(user.StripeSubscriptionID, &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(false),
	})
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"success":             true,
		"subscription_status": updated.Status,
	})
}

// Status — GET /v1/billing/status
//
// Snapshot do estado atual: plano, sub_status, próximo cobranço,
// uso do mês.
func (h *BillingHandler) Status(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	h.db.Preload("Plan").First(user, "id = ?", user.ID)
	return c.JSON(fiber.Map{
		"plan":                       user.Plan,
		"stripe_subscription_id":     user.StripeSubscriptionID,
		"stripe_subscription_status": user.StripeSubscriptionStatus,
	})
}
