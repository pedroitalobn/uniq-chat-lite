package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	stripe "github.com/stripe/stripe-go/v76"
	stripeinvoice "github.com/stripe/stripe-go/v76/invoice"
	stripesub "github.com/stripe/stripe-go/v76/subscription"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
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
	db    *gorm.DB
	asaas *services.AsaasClient
}

func NewBillingHandler(db *gorm.DB) *BillingHandler {
	return &BillingHandler{
		db:    db,
		asaas: services.NewAsaasClient(db),
	}
}

// resolveProvider escolhe Stripe ou Asaas baseado em qual subscription
// o user tem ativa. Se nenhum, retorna "" (cliente vai pro checkout).
//
// Ordem de prioridade: Stripe > Asaas. Em produção um user só tem 1
// subscription ativa por vez (não é caso comum ter os dois).
func (h *BillingHandler) resolveProvider(user *models.User) string {
	if user == nil {
		return ""
	}
	if user.StripeSubscriptionID != "" {
		return "stripe"
	}
	if user.AsaasSubscriptionID != "" {
		return "asaas"
	}
	return ""
}

// PreviewUpgrade — GET /v1/billing/preview/:planId
//
// Calcula quanto o user pagará HOJE pra trocar pro plano alvo. Usa
// proration nativo do Stripe (Invoices.Upcoming) ou cálculo local
// pra Asaas (não tem proration nativo).
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
	provider := h.resolveProvider(user)
	if provider == "" {
		// Sem subscription ativa: não tem proration — vai pra checkout normal.
		return c.JSON(fiber.Map{
			"has_active_subscription": false,
			"action":                  "checkout",
			"new_plan":                newPlan.Name,
			"new_price":               newPlan.Price,
			"message":                 "Você não tem assinatura ativa. Use /stripe/checkout ou /asaas/checkout pra criar.",
		})
	}

	if provider == "asaas" {
		return h.previewAsaasUpgrade(c, user, &newPlan)
	}
	// Stripe
	if newPlan.StripePriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plano sem stripe_price_id"})
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
// Aplica a troca de plano. Stripe usa proration nativo (subscription.Update);
// Asaas calcula local + emite payment avulso da diferença.
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

	provider := h.resolveProvider(user)
	if provider == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":             "no_active_subscription",
			"message":           "Crie uma assinatura via /stripe/checkout ou /asaas/checkout primeiro.",
			"checkout_endpoint": "/v1/stripe/checkout",
		})
	}

	if provider == "asaas" {
		return h.upgradeAsaas(c, user, &newPlan)
	}
	// Stripe
	if newPlan.StripePriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plano sem stripe_price_id"})
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
	provider := h.resolveProvider(user)
	if provider == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sem assinatura ativa"})
	}
	var req struct {
		Immediate bool `json:"immediate"`
	}
	_ = c.BodyParser(&req)

	if provider == "asaas" {
		// Imediato: deleta direto na Asaas. Plan cai pra Free na hora.
		if req.Immediate {
			if err := h.asaas.DeleteSubscription(user.AsaasSubscriptionID); err != nil {
				return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
			}
			h.db.Model(user).Updates(map[string]any{
				"asaas_subscription_id":     "",
				"asaas_subscription_status": "CANCELLED",
				"asaas_cancel_at":           nil,
			})
			return c.JSON(fiber.Map{"success": true, "cancelled": "immediate", "provider": "asaas"})
		}
		// Cancel at period end: guardamos a data alvo. Cron diário
		// (services/asaas_cron.go) deleta a subscription quando bate.
		// Asaas não tem isso nativo, então emulamos.
		sub, err := h.asaas.GetSubscription(user.AsaasSubscriptionID)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
		}
		nextDue, _ := time.Parse("2006-01-02", sub.NextDueDate)
		h.db.Model(user).Updates(map[string]any{
			"asaas_cancel_at":           &nextDue,
			"asaas_subscription_status": "ACTIVE_CANCEL_PENDING",
		})
		return c.JSON(fiber.Map{
			"success":            true,
			"cancelled":          "at_period_end",
			"provider":           "asaas",
			"current_period_end": nextDue,
			"note":               "Acesso mantido até " + nextDue.Format("2006-01-02") + ". Próximo ciclo não será cobrado.",
		})
	}

	// Stripe
	if req.Immediate {
		_, err := stripesub.Cancel(user.StripeSubscriptionID, nil)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "cancelled": "immediate", "provider": "stripe"})
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
		"provider":          "stripe",
		"current_period_end": time.Unix(updated.CurrentPeriodEnd, 0),
	})
}

// Resume — POST /v1/billing/resume
//
// Desfaz um cancelamento agendado (Stripe: cancel_at_period_end=false).
// Asaas não tem cancelamento agendado por isso resume não se aplica —
// retorna 400.
func (h *BillingHandler) Resume(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	provider := h.resolveProvider(user)
	if provider == "asaas" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "asaas_no_resume",
			"message": "Asaas não suporta retomar cancelamento. Crie nova assinatura via /asaas/checkout.",
		})
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

// ─── Asaas implementations ────────────────────────────────────────────

// previewAsaasUpgrade calcula proration local usando dias restantes do
// ciclo atual contra a próxima data de vencimento da subscription.
func (h *BillingHandler) previewAsaasUpgrade(c *fiber.Ctx, user *models.User, newPlan *models.Plan) error {
	sub, err := h.asaas.GetSubscription(user.AsaasSubscriptionID)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	nextDue, _ := time.Parse("2006-01-02", sub.NextDueDate)
	prorationCents := services.CalculateAsaasProration(sub.Value, newPlan.Price, nextDue)
	daysRemaining := int(time.Until(nextDue).Hours() / 24)
	if daysRemaining < 0 {
		daysRemaining = 0
	}

	return c.JSON(fiber.Map{
		"has_active_subscription": true,
		"provider":                "asaas",
		"new_plan":                newPlan.Name,
		"new_price":               newPlan.Price,
		"old_price":               sub.Value,
		"current_period_end":      nextDue,
		"days_remaining":          daysRemaining,
		"amount_due_now":          prorationCents,             // centavos. Negativo = crédito.
		"next_charge_amount":      int64(newPlan.Price * 100),
		"currency":                "brl",
		"note":                    "Asaas não tem proration nativo — cobramos a diferença prorated num boleto/PIX avulso. Próximo ciclo: valor cheio do plano novo.",
	})
}

// upgradeAsaas executa a troca: 1) calcula proration; 2) atualiza
// subscription com novo Value mantendo nextDueDate (preserva ciclo);
// 3) cria payment avulso da diferença.
func (h *BillingHandler) upgradeAsaas(c *fiber.Ctx, user *models.User, newPlan *models.Plan) error {
	sub, err := h.asaas.GetSubscription(user.AsaasSubscriptionID)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	nextDue, _ := time.Parse("2006-01-02", sub.NextDueDate)
	prorationCents := services.CalculateAsaasProration(sub.Value, newPlan.Price, nextDue)
	prorationValue := float64(prorationCents) / 100.0

	// Captura plano anterior pra audit log.
	var oldPlan models.Plan
	if user.PlanID != nil {
		_ = h.db.First(&oldPlan, "id = ?", *user.PlanID).Error
	}

	// 1) Atualiza subscription com novo Value (mantém nextDueDate — ciclo
	// continua igual). Próxima fatura sai com valor novo.
	newPrice := newPlan.Price
	_, err = h.asaas.UpdateSubscription(user.AsaasSubscriptionID, services.AsaasSubscriptionUpdate{
		Value:       &newPrice,
		Description: fmt.Sprintf("Plano %s — Qchat", newPlan.Name),
	})
	if err != nil {
		log.Error().Err(err).Str("sub", user.AsaasSubscriptionID).Msg("billing/asaas: update sub failed")
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "asaas update sub: " + err.Error()})
	}

	// 2) Cria payment avulso da diferença prorated. Só se for upgrade
	// (positivo). Downgrade vira crédito que será compensado no próximo
	// ciclo (Asaas não credita cartão automaticamente).
	var paymentResp *services.AsaasPaymentResponse
	if prorationCents > 0 {
		paymentResp, err = h.asaas.CreatePayment(services.AsaasPaymentRequest{
			Customer:          user.AsaasCustomerID,
			BillingType:       "PIX", // Asaas só vende PIX — não oferecer boleto nem cartão aqui
			Value:             prorationValue,
			DueDate:           time.Now().AddDate(0, 0, 3).Format("2006-01-02"),
			Description:       fmt.Sprintf("Diferença upgrade %s → %s (proration de %d dias)", oldPlan.Name, newPlan.Name, int(time.Until(nextDue).Hours()/24)),
			ExternalReference: user.ID.String(),
		})
		if err != nil {
			// Sub já foi atualizada — só logamos. Suporte pode emitir manual.
			log.Warn().Err(err).Msg("billing/asaas: proration payment failed")
		}
	}

	// 3) Atualiza plano local e audit.
	now := time.Now()
	h.db.Model(user).Updates(map[string]any{
		"plan_id":    newPlan.ID,
		"updated_at": now,
	})

	logEntry := models.PlanChangeLog{
		UserID:           user.ID,
		FromPlanID:       user.PlanID,
		ToPlanID:         &newPlan.ID,
		FromPlanName:     oldPlan.Name,
		ToPlanName:       newPlan.Name,
		Source:           models.PlanChangeSourceAsaas,
		ActorID:          &user.ID,
		ActorEmail:       user.Email,
		ProrationAmount:  prorationCents,
		Notes:            "Asaas upgrade — sub atualizada + payment avulso de proration.",
	}
	h.db.Create(&logEntry)

	resp := fiber.Map{
		"success":          true,
		"provider":         "asaas",
		"new_plan":         newPlan.Name,
		"proration_amount": prorationCents,
	}
	if paymentResp != nil {
		resp["payment_id"] = paymentResp.ID
		resp["invoice_url"] = paymentResp.InvoiceURL
		resp["bank_slip_url"] = paymentResp.BankSlipURL
	}
	return c.JSON(resp)
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

// History GET /v1/billing/history
// Devolve o histórico de cobranças do próprio user logado: ServiceCharges
// no banco + (se provider=asaas) últimos pagamentos do customer no provider.
// É read-only — alterações ficam no AdminBillingHandler.
func (h *BillingHandler) History(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	h.db.Preload("Plan").First(user, "id = ?", user.ID)

	var charges []models.ServiceCharge
	h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Limit(50).Find(&charges)

	payments := []map[string]any{}
	if strings.TrimSpace(user.AsaasCustomerID) != "" {
		_, body, err := h.asaas.Request("GET",
			"/api/v3/payments?customer="+user.AsaasCustomerID+"&limit=20&order=desc", nil)
		if err == nil {
			var listed struct {
				Data []map[string]any `json:"data"`
			}
			if json.Unmarshal(body, &listed) == nil {
				payments = listed.Data
			}
		}
	}
	return c.JSON(fiber.Map{
		"plan":     user.Plan,
		"provider": h.resolveProvider(user),
		"asaas": fiber.Map{
			"subscription_id": user.AsaasSubscriptionID,
			"status":          user.AsaasSubscriptionStatus,
			"next_charge_at":  user.AsaasNextChargeAt,
		},
		"stripe": fiber.Map{
			"subscription_id": user.StripeSubscriptionID,
			"status":          user.StripeSubscriptionStatus,
		},
		"services": charges,
		"payments": payments,
	})
}
