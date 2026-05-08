package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/stripe/stripe-go/v76"
	stripesession "github.com/stripe/stripe-go/v76/checkout/session"
	stripecustomer "github.com/stripe/stripe-go/v76/customer"
	stripeinvoice "github.com/stripe/stripe-go/v76/invoice"
	stripeinvoiceitem "github.com/stripe/stripe-go/v76/invoiceitem"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
)

// ─── Top-up checkout ─────────────────────────────────────────────────
//
// Fluxo:
//   1. User abre /usage e clica num pack (ex: "10k AI por R$19,90").
//   2. POST /v1/usage/me/topup-checkout { pack_index, scope, workspace_id? }
//      → backend cria UsageTopup pending + Stripe Checkout Session
//        em mode=payment + retorna a URL.
//   3. User paga na Stripe.
//   4. Webhook checkout.session.completed (handleCheckoutCompleted)
//      detecta type=topup no metadata e chama recorder.ApplyTopup.
//
// Idempotência: se o session.completed reentrega, applyTopupFromCheckout
// checa status do UsageTopup — se já paid, no-op. Sem isso o user
// receberia o mesmo crédito 2x.

// CreateTopupCheckout POST /v1/usage/me/topup-checkout
//
// Body: { pack_index: int, scope: "account"|"workspace", workspace_id?: uuid }
// Retorna: { checkout_url: string, topup_id: string }
//
// Pack vem da PricingConfig.TopupPacks (JSON array). Cada pack tem
// {category, credits, price_cents, label}. Sem topup packs = 400.
func (h *UsageHandler) CreateTopupCheckout(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	var body struct {
		PackIndex   int    `json:"pack_index"`
		Scope       string `json:"scope"`        // "account" | "workspace"
		WorkspaceID string `json:"workspace_id"` // só se scope=workspace
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if body.Scope == "" {
		body.Scope = "account"
	}
	if body.Scope != "account" && body.Scope != "workspace" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "scope deve ser account ou workspace"})
	}

	// Resolve pack via PricingConfig.
	var cfg models.PricingConfig
	if err := h.db.Order("created_at ASC").First(&cfg).Error; err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "pricing não configurado"})
	}
	type pack struct {
		Category   string `json:"category"`
		Credits    int64  `json:"credits"`
		PriceCents int64  `json:"price_cents"`
		Label      string `json:"label"`
	}
	var packs []pack
	if err := json.Unmarshal([]byte(cfg.TopupPacks), &packs); err != nil || len(packs) == 0 {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "nenhum pack disponível — admin precisa configurar"})
	}
	if body.PackIndex < 0 || body.PackIndex >= len(packs) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "pack inválido"})
	}
	chosen := packs[body.PackIndex]
	cat := models.UsageEventCategory(chosen.Category)
	if cat != models.CategoryAI && cat != models.CategoryVoice && cat != models.CategoryMessage {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "categoria do pack inválida"})
	}

	var workspaceUUID *uuid.UUID
	if body.Scope == "workspace" {
		wsID, err := uuid.Parse(body.WorkspaceID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspace_id inválido"})
		}
		// Verifica que o user tem acesso ao workspace (dono ou membro).
		var ws models.Workspace
		if err := h.db.First(&ws, "id = ? AND owner_id = ?", wsID, user.ID).Error; err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão pra esse workspace"})
		}
		workspaceUUID = &wsID
	}

	// Stripe customer (cria se não tem).
	customerID := user.StripeCustomerID
	if customerID == "" {
		cp := &stripe.CustomerParams{
			Email: stripe.String(user.Email),
			Name:  stripe.String(user.Name),
			Metadata: map[string]string{"user_id": user.ID.String()},
		}
		sc, err := stripecustomer.New(cp)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
				"error":   "stripe_customer_failed",
				"message": err.Error(),
			})
		}
		customerID = sc.ID
		h.db.Model(user).Update("stripe_customer_id", customerID)
	}

	// Cria UsageTopup pending — vai ser marcado paid pelo webhook.
	topup := models.UsageTopup{
		UserID:        user.ID,
		WorkspaceID:   workspaceUUID,
		Scope:         body.Scope,
		Category:      cat,
		CreditsAmount: chosen.Credits,
		PriceCents:    chosen.PriceCents,
		Status:        "pending",
	}
	if err := h.db.Create(&topup).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	frontendURL := strings.TrimRight(config.AppConfig.AppURL, "/")
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModePayment)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency: stripe.String("brl"),
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name:        stripe.String(chosen.Label),
						Description: stripe.String(fmt.Sprintf("%d créditos %s — Uniq", chosen.Credits, cat)),
					},
					UnitAmount: stripe.Int64(chosen.PriceCents),
				},
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL:        stripe.String(frontendURL + "/usage?topup=success"),
		CancelURL:         stripe.String(frontendURL + "/usage?topup=cancel"),
		ClientReferenceID: stripe.String(user.ID.String()),
		Metadata: map[string]string{
			// Marca o session como topup pra o webhook diferenciar de
			// checkout de subscription.
			"type":      "topup",
			"topup_id":  topup.ID.String(),
			"user_id":   user.ID.String(),
			"category":  string(cat),
			"credits":   fmt.Sprintf("%d", chosen.Credits),
		},
	}
	sess, err := stripesession.New(params)
	if err != nil {
		// Limpa o topup pending pra não ficar lixo.
		h.db.Delete(&topup)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "stripe_session_failed",
			"message": err.Error(),
		})
	}

	// Guarda session id pra reconciliação manual se webhook falhar.
	h.db.Model(&topup).Update("stripe_invoice_id", sess.ID)

	return c.JSON(fiber.Map{
		"checkout_url": sess.URL,
		"topup_id":     topup.ID.String(),
	})
}

// ListTopupPacks GET /v1/usage/topup-packs
//
// Pública (autenticada) — lista os packs configurados pelo super admin
// pra exibir no /usage. Vazio = "venda fechada" (sem packs cadastrados).
func (h *UsageHandler) ListTopupPacks(c *fiber.Ctx) error {
	var cfg models.PricingConfig
	if err := h.db.Order("created_at ASC").First(&cfg).Error; err != nil {
		return c.JSON(fiber.Map{"items": []any{}})
	}
	if cfg.TopupPacks == "" || cfg.TopupPacks == "[]" {
		return c.JSON(fiber.Map{"items": []any{}})
	}
	var packs []map[string]any
	if err := json.Unmarshal([]byte(cfg.TopupPacks), &packs); err != nil {
		return c.JSON(fiber.Map{"items": []any{}})
	}
	return c.JSON(fiber.Map{"items": packs})
}

// ApplyTopupFromCheckout — chamado pelo handleCheckoutCompleted do
// stripe.go quando o session.metadata.type == "topup". Idempotente: se
// o UsageTopup já está paid, no-op.
func ApplyTopupFromCheckout(db *gorm.DB, sess *stripe.CheckoutSession) error {
	if sess == nil || sess.Metadata == nil {
		return nil
	}
	topupID := sess.Metadata["topup_id"]
	if topupID == "" {
		return nil
	}
	id, err := uuid.Parse(topupID)
	if err != nil {
		return fmt.Errorf("topup_id inválido: %w", err)
	}
	var topup models.UsageTopup
	if err := db.First(&topup, "id = ?", id).Error; err != nil {
		return fmt.Errorf("topup não encontrado: %w", err)
	}
	if topup.Status == "paid" {
		// Webhook reentregue — já processamos.
		return nil
	}
	now := time.Now()
	if err := db.Model(&topup).Updates(map[string]any{
		"status":  "paid",
		"paid_at": &now,
	}).Error; err != nil {
		return fmt.Errorf("update topup: %w", err)
	}
	topup.Status = "paid"
	topup.PaidAt = &now
	rec := services.GetGlobalUsageRecorder()
	if rec == nil {
		log.Warn().Str("topup_id", topupID).Msg("topup webhook: recorder nil — créditos NÃO aplicados")
		return fmt.Errorf("recorder não inicializado")
	}
	if err := rec.ApplyTopup(context.Background(), &topup); err != nil {
		return fmt.Errorf("apply topup: %w", err)
	}
	log.Info().
		Str("topup_id", topupID).
		Str("user", topup.UserID.String()).
		Str("category", string(topup.Category)).
		Int64("credits", topup.CreditsAmount).
		Msg("topup aplicado via webhook stripe")
	return nil
}

// ─── Overage invoicing cron ──────────────────────────────────────────

// OverageInvoiceCron — roda 1x por dia. Pra cada UsageQuota cujo
// period_end <= now AND overage_cents_accumulated > 0 AND não tem
// invoice já gerada, cria invoice avulsa na Stripe + reseta o
// acumulador.
//
// Quem não tem stripe_customer_id (free PAYG sem sub) é skipado —
// overage só faz sentido pra quem assina; PAYG depende de topup
// (não estoura allowance porque allowance = 0 e overage_allowed=false
// por default).
type OverageInvoiceCron struct {
	db   *gorm.DB
	stop chan struct{}
}

func NewOverageInvoiceCron(db *gorm.DB) *OverageInvoiceCron {
	return &OverageInvoiceCron{db: db, stop: make(chan struct{})}
}

func (c *OverageInvoiceCron) Start() {
	go c.loop()
	log.Info().Msg("overage invoice cron: started (24h interval)")
}

func (c *OverageInvoiceCron) Stop() { close(c.stop) }

func (c *OverageInvoiceCron) loop() {
	// Espera 5min no boot pra não competir com outras inits.
	time.Sleep(5 * time.Minute)
	c.tick()
	t := time.NewTicker(24 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
			c.tick()
		}
	}
}

func (c *OverageInvoiceCron) tick() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("overage invoice tick: panic recovered")
		}
	}()
	type row struct {
		ID        uuid.UUID
		UserID    uuid.UUID
		Cents     int64
		AICredits int64
		VCredits  int64
		MCredits  int64
	}
	var rows []row
	c.db.Raw(`
		SELECT id, user_id, overage_cents_accumulated AS cents,
		  ai_overage_credits AS ai_credits,
		  voice_overage_credits AS v_credits,
		  message_overage_credits AS m_credits
		FROM usage_quotas
		WHERE period_end <= ? AND overage_cents_accumulated > 0
	`, time.Now()).Scan(&rows)
	if len(rows) == 0 {
		return
	}
	processed := 0
	for _, r := range rows {
		if err := c.invoice(r.ID, r.UserID, r.Cents, r.AICredits, r.VCredits, r.MCredits); err != nil {
			log.Warn().Err(err).Str("quota", r.ID.String()).Msg("overage invoice: falhou")
			continue
		}
		processed++
	}
	log.Info().Int("processed", processed).Msg("overage invoice tick")
}

func (c *OverageInvoiceCron) invoice(quotaID, userID uuid.UUID, cents, aiCr, vCr, mCr int64) error {
	var user models.User
	if err := c.db.First(&user, "id = ?", userID).Error; err != nil {
		return fmt.Errorf("user não encontrado: %w", err)
	}
	if user.StripeCustomerID == "" {
		// Sem customer = sem como faturar. Reseta acumulador pra não
		// re-tentar todo dia — overage virou perda da Uniq nesse caso.
		log.Warn().Str("user", userID.String()).
			Int64("cents", cents).Msg("overage: user sem stripe_customer — abandonado")
		c.db.Model(&models.UsageQuota{}).Where("id = ?", quotaID).
			Update("overage_cents_accumulated", 0)
		return nil
	}
	// Cria InvoiceItem + Invoice na Stripe (auto_advance=true → cobra).
	descLines := []string{}
	if aiCr > 0 {
		descLines = append(descLines, fmt.Sprintf("%d créditos AI", aiCr))
	}
	if vCr > 0 {
		descLines = append(descLines, fmt.Sprintf("%d créditos Voice", vCr))
	}
	if mCr > 0 {
		descLines = append(descLines, fmt.Sprintf("%d créditos Mensagens", mCr))
	}
	desc := "Overage Uniq Credits"
	if len(descLines) > 0 {
		desc = "Overage: " + strings.Join(descLines, " + ")
	}
	itemParams := &stripe.InvoiceItemParams{
		Customer: stripe.String(user.StripeCustomerID),
		Currency: stripe.String("brl"),
		Amount:   stripe.Int64(cents),
		Description: stripe.String(desc),
	}
	if _, err := stripeinvoiceitem.New(itemParams); err != nil {
		return fmt.Errorf("invoice item: %w", err)
	}
	invParams := &stripe.InvoiceParams{
		Customer:    stripe.String(user.StripeCustomerID),
		AutoAdvance: stripe.Bool(true),
		Description: stripe.String("Overage do ciclo Uniq Credits"),
		Metadata: map[string]string{
			"type":     "overage",
			"user_id":  userID.String(),
			"quota_id": quotaID.String(),
		},
	}
	inv, err := stripeinvoice.New(invParams)
	if err != nil {
		return fmt.Errorf("invoice create: %w", err)
	}
	// Reseta acumulador + zera overage credits no quota (não dobra
	// faturamento se rodar de novo).
	c.db.Model(&models.UsageQuota{}).Where("id = ?", quotaID).Updates(map[string]any{
		"overage_cents_accumulated": 0,
		"ai_overage_credits":        0,
		"voice_overage_credits":     0,
		"message_overage_credits":   0,
	})
	log.Info().
		Str("user", userID.String()).
		Str("invoice", inv.ID).
		Int64("cents", cents).
		Msg("overage invoice criada")
	return nil
}
