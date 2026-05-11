package handlers

import (
	"encoding/json"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	stripe "github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/checkout/session"
	stripecustomer "github.com/stripe/stripe-go/v76/customer"
	"github.com/stripe/stripe-go/v76/paymentintent"
	stripeprice "github.com/stripe/stripe-go/v76/price"
	stripesub "github.com/stripe/stripe-go/v76/subscription"
	"github.com/stripe/stripe-go/v76/webhook"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type StripeHandler struct {
	db       *gorm.DB
	emailSvc *email.Service

	stripeCheckoutType string
}

func NewStripeHandler(db *gorm.DB, emailSvc *email.Service) *StripeHandler {
	return &StripeHandler{
		db:       db,
		emailSvc: emailSvc,
	}
}

func (h *StripeHandler) loadConfig() {
	var settings models.PaymentSettings
	if err := h.db.Where("id = ?", "default").First(&settings).Error; err == nil {
		stripe.Key = settings.StripeSecretKey
		h.stripeCheckoutType = settings.StripeCheckoutType
		if h.stripeCheckoutType == "" {
			h.stripeCheckoutType = "redirect"
		}
	}
}

func (h *StripeHandler) getWebhookSecret() string {
	var settings models.PaymentSettings
	if err := h.db.Where("id = ?", "default").First(&settings).Error; err == nil {
		return settings.StripeWebhookSecret
	}
	return ""
}

// stripeKeyMode lê o prefixo da chave configurada (sk_test_ ou sk_live_)
// pra dizer em que modo a Stripe está respondendo. Útil pra dar mensagens
// de erro claras quando o admin mistura test/live.
func stripeKeyMode() string {
	k := strings.TrimSpace(stripe.Key)
	if strings.HasPrefix(k, "sk_test_") || strings.HasPrefix(k, "rk_test_") {
		return "test"
	}
	if strings.HasPrefix(k, "sk_live_") || strings.HasPrefix(k, "rk_live_") {
		return "live"
	}
	return "unknown"
}

// priceModePath devolve o segmento de URL apropriado pra montar links
// pro dashboard. Test fica em /test/, live na raiz.
func priceModePath(mode string) string {
	if mode == "test" {
		return "test"
	}
	return ""
}

func (h *StripeHandler) getCheckoutType() string {
	if h.stripeCheckoutType == "" {
		h.loadConfig()
	}
	return h.stripeCheckoutType
}

// GET /stripe/plans — list plans with Stripe info (public)
func (h *StripeHandler) ListPlans(c *fiber.Ctx) error {
	var plans []models.Plan
	if err := h.db.Where("is_active = true").Order("price ASC").Find(&plans).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar planos"})
	}
	return c.JSON(plans)
}

// POST /stripe/activate-lead — activate a lead after payment (public)
func (h *StripeHandler) ActivateLead(c *fiber.Ctx) error {
	var req struct {
		LeadID string `json:"lead_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	if req.LeadID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "lead_id é obrigatório"})
	}

	leadID, err := uuid.Parse(req.LeadID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "lead_id inválido"})
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", leadID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "lead não encontrado"})
	}

	if user.Role != models.RoleLead {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "usuário não é um lead"})
	}

	// Activate the user and convert to customer
	h.db.Model(&user).Updates(map[string]interface{}{
		"is_active": true,
		"role":      models.RoleCustomer,
	})

	// Send welcome email
	h.emailSvc.SendWelcome(user.Email, user.Name)

	return c.JSON(fiber.Map{"message": "lead ativado com sucesso", "user_id": user.ID})
}

// POST /stripe/finalize-registration — endpoint público chamado pelo
// front depois que o usuário paga no Stripe Elements (transparent) ou
// volta de uma Checkout Session. Não dependemos só do webhook: aqui
// consultamos a API do Stripe pra confirmar o status do PI/Session
// e materializamos o User+Workspace na hora se já estiver pago.
//
// Body: { "pending_id": "...", "payment_intent_id": "..." (opt), "session_id": "..." (opt) }
// Resposta: { access_token, user, workspace } igual ao /register/complete free.
func (h *StripeHandler) FinalizeRegistration(c *fiber.Ctx) error {
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

	if !h.confirmAndMaterializeFromAPI(&pending, req.PaymentIntentID, req.SessionID) {
		return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{"error": "pagamento ainda não confirmado pelo Stripe"})
	}

	// Recarrega o user materializado e devolve sessão ativa (auto-login).
	var user models.User
	if err := h.db.Preload("Plan").First(&user, "email = ?", pending.Email).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "conta não materializada"})
	}

	accessToken, err := middleware.GenerateAccessToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar token"})
	}
	refreshToken, _ := middleware.GenerateRefreshToken(user.ID)
	c.Cookie(&fiber.Cookie{
		Name: "refresh_token", Value: refreshToken, HTTPOnly: true,
		SameSite: "Lax", Path: "/",
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

// POST /stripe/checkout — create Stripe Checkout session (protected)
func (h *StripeHandler) CreateCheckout(c *fiber.Ctx) error {
	h.loadConfig()
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	// Preflight: stripe.Key vazia = admin não configurou Stripe em
	// /admin/providers → Pagamento. Antes a request seguia, batia em
	// stripe.com com key vazia, recebia auth error e devolvia 500 genérico
	// "erro ao criar cliente Stripe" — sem pista pro user/admin do real
	// problema. Agora retornamos 503 com mensagem acionável.
	if strings.TrimSpace(stripe.Key) == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error":   "stripe_not_configured",
			"message": "Stripe não está configurado. Admin precisa setar a secret key em /admin/providers → Pagamento.",
		})
	}

	var req struct {
		PlanID string `json:"plan_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.PlanID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plan_id é obrigatório"})
	}

	var plan models.Plan
	if err := h.db.First(&plan, "id = ?", req.PlanID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}
	// Resolução do Price ID com prioridade: DB > env > vazio.
	// Self-heal: se o admin acabou de configurar o env mas a row do DB
	// ainda não foi atualizada (boot anterior, cache do orquestrador, etc),
	// usa o env aqui mesmo e atualiza a row no caminho. Antes a request
	// falhava 400 mesmo com env correto e admin já tinha "salvado" via UI.
	priceID := strings.TrimSpace(plan.StripePriceID)
	if priceID == "" {
		envKey := ""
		switch strings.ToLower(strings.TrimSpace(plan.Name)) {
		case "starter":
			envKey = "STRIPE_PRICE_STARTER"
		case "pro":
			envKey = "STRIPE_PRICE_PRO"
		case "business":
			envKey = "STRIPE_PRICE_BUSINESS"
		}
		if envKey != "" {
			priceID = strings.TrimSpace(os.Getenv(envKey))
		}
		if priceID != "" {
			// Persiste pra próxima request não passar por aqui de novo.
			h.db.Model(&plan).Update("stripe_price_id", priceID)
			plan.StripePriceID = priceID
			log.Info().
				Str("plan", plan.Name).
				Str("source", envKey).
				Msg("stripe checkout: heal — preenchi stripe_price_id via env")
		}
	}
	if priceID == "" {
		log.Warn().
			Str("plan_id", plan.ID.String()).
			Str("plan_name", plan.Name).
			Float64("plan_price", plan.Price).
			Msg("stripe checkout: plano sem stripe_price_id (DB vazio e env não bateu)")
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":     "plano sem preço Stripe configurado",
			"plan_id":   plan.ID.String(),
			"plan_name": plan.Name,
			"hint":      "Configure o Price ID em /admin/plans ou seta STRIPE_PRICE_" + strings.ToUpper(plan.Name) + " no env.",
		})
	}
	if plan.Price == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "use este endpoint apenas para planos pagos"})
	}

	// Preflight: verifica que o Price existe na conta + modo da chave
	// configurada. Sem isso, o erro vinha como "resource_missing" cru
	// e o admin não sabia se era mismatch test/live, conta errada ou
	// price arquivado. Agora damos diagnóstico preciso.
	priceMode := stripeKeyMode()
	if _, err := stripeprice.Get(plan.StripePriceID, nil); err != nil {
		stripeErr, _ := err.(*stripe.Error)
		if stripeErr != nil && stripeErr.Code == stripe.ErrorCodeResourceMissing {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "stripe_price_not_found",
				"message": "Price '" + plan.StripePriceID + "' não existe na conta Stripe configurada (modo " + priceMode + "). " +
					"Causas comuns: o Price foi criado no modo oposto (test↔live), em outra conta, ou foi arquivado. " +
					"Verifique em https://dashboard.stripe.com/" + priceModePath(priceMode) + "/prices/" + plan.StripePriceID,
				"price_id": plan.StripePriceID,
				"key_mode": priceMode,
			})
		}
		// Outros erros (rede, auth) — repassa o detalhe.
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "stripe_price_lookup_failed",
			"message": "não foi possível validar o Price na Stripe: " + err.Error(),
		})
	}

	// Create or reuse Stripe customer
	customerID := user.StripeCustomerID
	if customerID == "" {
		cp := &stripe.CustomerParams{
			Email: stripe.String(user.Email),
			Name:  stripe.String(user.Name),
			Metadata: map[string]string{
				"user_id": user.ID.String(),
			},
		}
		sc, err := stripecustomer.New(cp)
		if err != nil {
			// Repassa o erro real do Stripe (ex.: "Invalid API key", "rate
			// limit exceeded") em vez de mascarar como genérico — admin
			// precisa do detalhe pra debugar.
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":   "stripe_customer_failed",
				"message": "erro ao criar cliente Stripe: " + err.Error(),
			})
		}
		customerID = sc.ID
		h.db.Model(user).Update("stripe_customer_id", customerID)
	}

	frontendURL := config.AppConfig.FrontendURL
	checkoutType := h.getCheckoutType()

	if checkoutType == "transparent" {
		// Checkout transparente - criar PaymentIntent
		params := &stripe.PaymentIntentParams{
			Amount:      stripe.Int64(int64(plan.Price * 100)), // em centavos
			Currency:    stripe.String("brl"),
			Customer:    stripe.String(customerID),
			Description: stripe.String("Assinatura " + plan.Name),
			Metadata: map[string]string{
				"user_id": user.ID.String(),
				"plan_id": plan.ID.String(),
			},
			AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
				Enabled: stripe.Bool(true),
			},
		}

		pi, err := paymentintent.New(params)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar pagamento: " + err.Error()})
		}

		return c.JSON(fiber.Map{
			"checkout_type":     "transparent",
			"client_secret":     pi.ClientSecret,
			"payment_intent_id": pi.ID,
			"plan_name":         plan.Name,
			"plan_price":        plan.Price,
			"amount":            pi.Amount,
		})
	}

	// Redirect - criar Checkout Session
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(plan.StripePriceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL:        stripe.String(frontendURL + "/payment/success?session_id={CHECKOUT_SESSION_ID}"),
		CancelURL:         stripe.String(frontendURL + "/plans"),
		ClientReferenceID: stripe.String(user.ID.String()),
		SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: map[string]string{
				"user_id": user.ID.String(),
				"plan_id": plan.ID.String(),
			},
		},
		Metadata: map[string]string{
			"user_id": user.ID.String(),
			"plan_id": plan.ID.String(),
		},
	}

	sess, err := session.New(params)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar sessão de pagamento: " + err.Error()})
	}

	return c.JSON(fiber.Map{
		"checkout_type": "redirect",
		"url":           sess.URL,
	})
}

// GET /stripe/subscription — get current user subscription status (protected)
func (h *StripeHandler) GetSubscription(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	h.db.Preload("Plan").First(user, "id = ?", user.ID)

	return c.JSON(fiber.Map{
		"plan":                       user.Plan,
		"stripe_subscription_id":     user.StripeSubscriptionID,
		"stripe_subscription_status": user.StripeSubscriptionStatus,
		"status":                     user.StripeSubscriptionStatus,
	})
}

// POST /stripe/webhook — handle Stripe events (public, verified by signature)
func (h *StripeHandler) Webhook(c *fiber.Ctx) error {
	payload := c.Body()
	sigHeader := c.Get("Stripe-Signature")
	webhookSecret := h.getWebhookSecret()

	if webhookSecret == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "webhook não configurado"})
	}

	event, err := webhook.ConstructEvent(payload, sigHeader, webhookSecret)
	if err != nil {
		// Não vaza err.Error() pra cliente — pode incluir hint do
		// secret. Loga internamente.
		log.Warn().Err(err).Msg("stripe webhook: assinatura inválida")
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "assinatura inválida"})
	}

	// Idempotência: Stripe reenvia o mesmo event.ID em retries (timeout
	// nosso, deploy no meio, etc). Sem dedup o handler executa 2x →
	// User materializado em duplicata, plano upgrade duplicado, etc.
	// INSERT ON CONFLICT DO NOTHING vira "lock" — se outra instância já
	// gravou esse ID, RowsAffected=0 e nós paramos.
	if event.ID != "" {
		res := h.db.Exec(
			"INSERT INTO processed_webhook_events (event_id, provider, processed_at) VALUES (?, 'stripe', ?) ON CONFLICT DO NOTHING",
			event.ID, time.Now(),
		)
		if res.Error == nil && res.RowsAffected == 0 {
			// Evento já processado. Retorna 200 pra Stripe não retentar.
			return c.JSON(fiber.Map{"received": true, "duplicate": true})
		}
	}

	switch event.Type {
	case "checkout.session.completed":
		var sess stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &sess); err == nil {
			h.handleCheckoutCompleted(&sess)
		}

	case "payment_intent.succeeded":
		// Necessário pro fluxo "transparent" (PaymentIntent puro,
		// sem Checkout Session). É aqui que materializamos o
		// User+Workspace quando o pending tem pending_id.
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err == nil {
			h.handlePaymentIntentSucceeded(&pi)
		}

	case "customer.subscription.updated":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err == nil {
			h.handleSubscriptionUpdated(&sub)
		}

	case "customer.subscription.deleted":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err == nil {
			h.handleSubscriptionDeleted(&sub)
		}

	case "invoice.payment_failed":
		var inv stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &inv); err == nil {
			h.handlePaymentFailed(&inv)
		}
	}

	return c.JSON(fiber.Map{"received": true})
}

func (h *StripeHandler) handleCheckoutCompleted(sess *stripe.CheckoutSession) {
	// Top-up de Uniq Credits — checkout em mode=payment com type=topup
	// no metadata. Aplica créditos via UsageRecorder em vez do fluxo de
	// subscription. Idempotente — se já marcou paid antes, é no-op.
	if sess.Metadata != nil && sess.Metadata["type"] == "topup" {
		if err := ApplyTopupFromCheckout(h.db, sess); err != nil {
			log.Warn().Err(err).Str("session", sess.ID).Msg("topup webhook: falha ao aplicar")
		}
		return
	}

	// Novo fluxo: pending_id na metadata significa que ainda não
	// existe User no DB — precisamos materializar agora a partir do
	// PendingRegistration.
	if sess.Metadata != nil && sess.Metadata["pending_id"] != "" {
		subID := ""
		if sess.Subscription != nil {
			subID = sess.Subscription.ID
		}
		h.materializePending(sess.Metadata["pending_id"], sess.Metadata["plan_id"], subID, sess.ID)
		return
	}

	userID := sess.ClientReferenceID
	planID := ""
	isLead := false
	if sess.Metadata != nil {
		planID = sess.Metadata["plan_id"]
		isLead = sess.Metadata["is_lead"] == "true"
	}
	if userID == "" || planID == "" {
		return
	}

	var plan models.Plan
	if h.db.First(&plan, "id = ?", planID).Error != nil {
		return
	}

	subscriptionID := ""
	if sess.Subscription != nil {
		subscriptionID = sess.Subscription.ID
	}

	// For leads, activate the user and convert to customer
	if isLead {
		h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
			"plan_id":                    plan.ID,
			"stripe_subscription_id":     subscriptionID,
			"stripe_subscription_status": "active",
			"role":                       "customer",
			"is_active":                  true,
		})
	} else {
		h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
			"plan_id":                    plan.ID,
			"stripe_subscription_id":     subscriptionID,
			"stripe_subscription_status": "active",
		})
	}

	// Proxy provisioning is now handled at server-level; no per-user pool.

	// Send payment confirmed email
	var user models.User
	if h.db.First(&user, "id = ?", userID).Error == nil {
		h.emailSvc.SendPaymentConfirmed(user.Email, user.Name, plan.Name, plan.Price)
	}
}

func (h *StripeHandler) handleSubscriptionUpdated(sub *stripe.Subscription) {
	userID := ""
	planID := ""
	if sub.Metadata != nil {
		userID = sub.Metadata["user_id"]
		planID = sub.Metadata["plan_id"]
	}
	if userID == "" {
		return
	}

	var user models.User
	if h.db.Preload("Plan").First(&user, "id = ?", userID).Error != nil {
		return
	}

	oldPlanName := ""
	if user.Plan != nil {
		oldPlanName = user.Plan.Name
	}

	h.db.Model(&models.User{}).Where("id = ?", userID).
		Update("stripe_subscription_status", string(sub.Status))

	// If plan changed and status is active, send plan changed email
	if string(sub.Status) == "active" && planID != "" {
		var newPlan models.Plan
		if h.db.First(&newPlan, "id = ?", planID).Error == nil {
			if oldPlanName != "" && oldPlanName != newPlan.Name {
				h.emailSvc.SendPlanChanged(user.Email, user.Name, oldPlanName, newPlan.Name)
			}

			// Proxy provisioning/release handled at server level; no-op here.
		}
	}
}

func (h *StripeHandler) handleSubscriptionDeleted(sub *stripe.Subscription) {
	userID := ""
	if sub.Metadata != nil {
		userID = sub.Metadata["user_id"]
	}
	if userID == "" {
		return
	}

	// Proxy release handled at server level; no-op here.

	var freePlan models.Plan
	if h.db.First(&freePlan, "name = 'Free'").Error != nil {
		return
	}

	h.db.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
		"plan_id":                    freePlan.ID,
		"stripe_subscription_id":     "",
		"stripe_subscription_status": "canceled",
	})

	// Send subscription canceled email
	var user models.User
	if h.db.First(&user, "id = ?", userID).Error == nil {
		h.emailSvc.SendSubscriptionCanceled(user.Email, user.Name)
	}
}

func (h *StripeHandler) handlePaymentFailed(inv *stripe.Invoice) {
	if inv.Customer == nil {
		return
	}
	h.db.Model(&models.User{}).Where("stripe_customer_id = ?", inv.Customer.ID).
		Update("stripe_subscription_status", "past_due")

	// Send payment failed email
	var user models.User
	if h.db.Where("stripe_customer_id = ?", inv.Customer.ID).First(&user).Error == nil {
		h.emailSvc.SendPaymentFailed(user.Email, user.Name)
	}
}

// confirmAndMaterializeFromAPI consulta o Stripe direto pra saber se
// o PaymentIntent ou a CheckoutSession associados ao pending estão
// pagos. Se sim, chama materializePending (idempotente). Devolve
// true se o pagamento foi confirmado e a conta materializada (ou
// já estava). Usado tanto pelo endpoint /finalize-registration
// quanto pelo PaymentHandler genérico como fallback de webhook.
func (h *StripeHandler) confirmAndMaterializeFromAPI(pending *models.PendingRegistration, piIDArg, sessIDArg string) bool {
	loadStripeConfigFromDB(h.db)
	stripe.Key = stripeKey
	if stripe.Key == "" {
		return false
	}

	piID := piIDArg
	if piID == "" {
		piID = pending.StripePIID
	}
	sessID := sessIDArg
	if sessID == "" {
		sessID = pending.StripeSessionID
	}

	planIDStr := ""
	if pending.PlanID != nil {
		planIDStr = pending.PlanID.String()
	}

	paid := false
	subscriptionID := ""
	stripeRef := ""

	if piID != "" {
		if pi, err := paymentintent.Get(piID, nil); err == nil && pi != nil && pi.Status == stripe.PaymentIntentStatusSucceeded {
			paid = true
			stripeRef = pi.ID
		}
	}
	if !paid && sessID != "" {
		if s, err := session.Get(sessID, nil); err == nil && s != nil && s.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid {
			paid = true
			stripeRef = s.ID
			if s.Subscription != nil {
				subscriptionID = s.Subscription.ID
			}
		}
	}

	if !paid {
		return false
	}

	h.materializePending(pending.ID.String(), planIDStr, subscriptionID, stripeRef)
	return true
}

// handlePaymentIntentSucceeded é o gatilho do fluxo "transparent"
// (Stripe Elements). Olha a metadata pra saber se é uma matrícula
// nova adiada (pending_id presente) e materializa User+Workspace.
func (h *StripeHandler) handlePaymentIntentSucceeded(pi *stripe.PaymentIntent) {
	if pi.Metadata == nil {
		return
	}
	pendingID := pi.Metadata["pending_id"]
	if pendingID == "" {
		return
	}
	h.materializePending(pendingID, pi.Metadata["plan_id"], "", pi.ID)
}

// materializePending cria User+Workspace a partir do snapshot guardado
// no PendingRegistration. É idempotente: se já existe um User com
// aquele email, não duplica (apenas atualiza ativação/plano).
func (h *StripeHandler) materializePending(pendingIDStr, planIDStr, subscriptionID, sessionOrPIID string) {
	pendingID, err := uuid.Parse(pendingIDStr)
	if err != nil {
		return
	}
	var pending models.PendingRegistration
	if err := h.db.First(&pending, "id = ?", pendingID).Error; err != nil {
		return
	}
	if pending.Name == "" || pending.PasswordHash == "" {
		return
	}
	// Race condition: dois webhooks (checkout.session.completed +
	// invoice.payment_succeeded) podem rodar paralelos. UPDATE atômico
	// "claim" — só o primeiro a executar grava completed_at; o segundo
	// vê RowsAffected=0 e sai. Combina com a tabela processed_webhook_events
	// pra dedup ainda mais cedo (no Webhook handler), mas esse claim
	// segura o caso onde o webhook event.ID é diferente mas o pending é
	// o mesmo (ex: checkout + payment_intent).
	now := time.Now()
	res := h.db.Model(&models.PendingRegistration{}).
		Where("id = ? AND completed_at IS NULL", pendingID).
		Update("completed_at", now)
	if res.Error == nil && res.RowsAffected == 0 {
		// Outro webhook já materializou. Apenas atualiza assinatura.
		var existing models.User
		if h.db.Where("email = ?", pending.Email).First(&existing).Error == nil {
			updates := map[string]any{
				"is_active":                  true,
				"role":                       "customer",
				"stripe_subscription_status": "active",
			}
			if subscriptionID != "" {
				updates["stripe_subscription_id"] = subscriptionID
			}
			h.db.Model(&existing).Updates(updates)
		}
		return
	}
	// Marca o pending em memória pra o restante do fluxo continuar
	// vendo o estado consistente (ex: log mostrando ws_name correto).
	pending.CompletedAt = &now

	planID, _ := uuid.Parse(planIDStr)
	var plan models.Plan
	hasPlan := false
	if planID != uuid.Nil {
		if h.db.First(&plan, "id = ?", planID).Error == nil {
			hasPlan = true
		}
	}

	user := models.User{
		Name:             pending.Name,
		Email:            pending.Email,
		Phone:            pending.Phone,
		Role:             models.RoleCustomer,
		IsActive:         true,
		PasswordHash:     pending.PasswordHash,
		StripeCustomerID: pending.StripeCustomerID,
	}
	if pending.Username != "" {
		u := pending.Username
		user.Username = &u
	}
	if hasPlan {
		user.PlanID = &plan.ID
	}
	if subscriptionID != "" {
		user.StripeSubscriptionID = subscriptionID
		user.StripeSubscriptionStatus = "active"
	}
	if err := h.db.Create(&user).Error; err != nil {
		return
	}

	if pending.InviteCode != "" {
		MarkInviteCodeUsed(h.db, pending.InviteCode, user.ID)
	}

	wsName := pending.WorkspaceName
	if wsName == "" {
		first := strings.Fields(pending.Name)
		if len(first) > 0 {
			wsName = first[0] + "'s Workspace"
		} else {
			wsName = "Meu Workspace"
		}
	}
	if ws := createDefaultWorkspace(h.db, &user, wsName); ws == nil {
		// Não abortamos o materialize — User+plano JÁ foram criados e o
		// pagamento já passou. /v1/workspaces auto-heal recria na primeira
		// listagem. Logamos pra alertar a equipe (slug colision raro,
		// mas pode ser DB indisponível também).
		log.Error().Str("user_id", user.ID.String()).Str("workspace_name", wsName).Str("session", sessionOrPIID).
			Msg("materializePending: createDefaultWorkspace falhou — user materializado pago sem workspace; auto-heal vai recriar")
	}

	// completed_at já foi gravado no claim atomic acima (linha ~684).
	// Não regravamos aqui pra não poluir updated_at.

	// Emails async — não travam o webhook (Stripe tem timeout de 10s
	// de resposta antes de marcar webhook failed e reentregar).
	if hasPlan {
		go h.emailSvc.SendPaymentConfirmed(user.Email, user.Name, plan.Name, plan.Price)
	}
	go h.emailSvc.SendWelcome(user.Email, user.Name)
}

// ─── Admin billing-link (cobrança de user existente) ──────────────────────

// AdminCreateBillingLink — gera URL de Stripe Checkout pra um user que
// o admin upgrade'ou pra plano pago sem ter cobrado ainda. Idempotente:
// cada chamada gera nova session (Stripe permite múltiplas vivas).
//
// POST /v1/admin/users/:id/billing-link
// Body: { "plan_id"?: "uuid", "send_email"?: bool }
//
// - plan_id default = user.PlanID atual (cobra o plano que ele já está usando)
// - send_email=true dispara email com o link pro user
//
// Retorna { url, expires_at, plan_name, plan_price, sent_email }.
func (h *StripeHandler) AdminCreateBillingLink(c *fiber.Ctx) error {
	h.loadConfig()
	if strings.TrimSpace(stripe.Key) == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error":   "stripe_not_configured",
			"message": "Configure a Stripe secret key em /admin/providers → Pagamento.",
		})
	}

	targetID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var target models.User
	if err := h.db.Preload("Plan").First(&target, "id = ?", targetID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "usuário não encontrado"})
	}

	var req struct {
		PlanID    string `json:"plan_id"`
		SendEmail bool   `json:"send_email"`
	}
	_ = c.BodyParser(&req) // body opcional

	// Resolve o plano: default = atual do user.
	var plan models.Plan
	if req.PlanID != "" {
		pid, err := uuid.Parse(req.PlanID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plan_id inválido"})
		}
		if err := h.db.First(&plan, "id = ?", pid).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
		}
	} else {
		if target.PlanID == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "user sem plano associado — passe plan_id no body",
			})
		}
		if err := h.db.First(&plan, "id = ?", *target.PlanID).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano do user não encontrado"})
		}
	}

	if plan.Price == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "billing-link só faz sentido em plano pago. Plano atual = R$ 0",
		})
	}

	// Resolve Price ID com o mesmo fallback do CreateCheckout (DB > env).
	priceID := strings.TrimSpace(plan.StripePriceID)
	if priceID == "" {
		envKey := ""
		switch strings.ToLower(strings.TrimSpace(plan.Name)) {
		case "starter":
			envKey = "STRIPE_PRICE_STARTER"
		case "pro":
			envKey = "STRIPE_PRICE_PRO"
		case "business":
			envKey = "STRIPE_PRICE_BUSINESS"
		}
		if envKey != "" {
			priceID = strings.TrimSpace(os.Getenv(envKey))
		}
		if priceID != "" {
			h.db.Model(&plan).Update("stripe_price_id", priceID)
		}
	}
	if priceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "plano " + plan.Name + " sem Stripe Price ID",
			"hint":  "Configure em /admin/plans ou STRIPE_PRICE_" + strings.ToUpper(plan.Name),
		})
	}

	// ── Caminho 1: user JÁ tem subscription ativa → upgrade/downgrade
	// in-place via subscription.Update. Evita criar 2 subs em paralelo.
	if strings.TrimSpace(target.StripeSubscriptionID) != "" {
		// Carrega a subscription pra pegar o item_id atual (pra trocar o price).
		curSub, err := stripesub.Get(target.StripeSubscriptionID, nil)
		if err == nil && curSub != nil && len(curSub.Items.Data) > 0 {
			currentPriceID := curSub.Items.Data[0].Price.ID
			if currentPriceID == priceID {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{
					"error": "user já está assinando este plano",
					"plan":  plan.Name,
				})
			}
			// Update: troca o Price, mantém a sub. Proration default
			// (Stripe credita/cobra pro-rata na próxima fatura).
			updateParams := &stripe.SubscriptionParams{
				Items: []*stripe.SubscriptionItemsParams{
					{
						ID:    stripe.String(curSub.Items.Data[0].ID),
						Price: stripe.String(priceID),
					},
				},
				ProrationBehavior: stripe.String("create_prorations"),
				Metadata: map[string]string{
					"user_id": target.ID.String(),
					"plan_id": plan.ID.String(),
					"source":  "admin_billing_link",
				},
			}
			updated, err := stripesub.Update(target.StripeSubscriptionID, updateParams)
			if err != nil {
				return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
					"error":   "stripe_sub_update_failed",
					"message": err.Error(),
				})
			}
			// Persistência local: webhook subscription.updated vai cair também,
			// mas atualiza aqui pra UI ficar consistente sem esperar webhook.
			h.db.Model(&target).Updates(map[string]interface{}{
				"plan_id": plan.ID,
			})
			log.Info().
				Str("admin_target", target.ID.String()).
				Str("from_price", currentPriceID).
				Str("to_price", priceID).
				Str("sub_status", string(updated.Status)).
				Msg("admin billing-link: subscription trocada (in-place)")
			return c.JSON(fiber.Map{
				"action":     "subscription_updated",
				"plan_name":  plan.Name,
				"plan_price": plan.Price,
				"user_email": target.Email,
				"sub_id":     updated.ID,
				"sub_status": string(updated.Status),
				"hint":       "Troca de plano aplicada — Stripe vai pro-ratear na próxima fatura. Nenhum link enviado.",
			})
		}
	}

	// ── Caminho 2: user SEM subscription ativa → Stripe Checkout link
	// (será uma NOVA subscription quando ele pagar).
	customerID := target.StripeCustomerID
	if customerID == "" {
		cp := &stripe.CustomerParams{
			Email: stripe.String(target.Email),
			Name:  stripe.String(target.Name),
			Metadata: map[string]string{
				"user_id": target.ID.String(),
			},
		}
		sc, err := stripecustomer.New(cp)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
				"error":   "stripe_customer_failed",
				"message": err.Error(),
			})
		}
		customerID = sc.ID
		h.db.Model(&target).Update("stripe_customer_id", customerID)
	}

	frontendURL := strings.TrimRight(config.AppConfig.FrontendURL, "/")
	if frontendURL == "" {
		frontendURL = "https://app.uniq.chat"
	}

	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(priceID), Quantity: stripe.Int64(1)},
		},
		SuccessURL:        stripe.String(frontendURL + "/payment/success?session_id={CHECKOUT_SESSION_ID}"),
		CancelURL:         stripe.String(frontendURL + "/billing"),
		ClientReferenceID: stripe.String(target.ID.String()),
		SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: map[string]string{
				"user_id": target.ID.String(),
				"plan_id": plan.ID.String(),
				"source":  "admin_billing_link",
			},
		},
		Metadata: map[string]string{
			"user_id": target.ID.String(),
			"plan_id": plan.ID.String(),
			"source":  "admin_billing_link",
		},
	}
	sess, err := session.New(params)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "stripe_session_failed",
			"message": err.Error(),
		})
	}

	out := fiber.Map{
		"action":     "checkout_link",
		"url":        sess.URL,
		"session_id": sess.ID,
		"plan_name":  plan.Name,
		"plan_price": plan.Price,
		"user_email": target.Email,
		"sent_email": false,
	}
	if sess.ExpiresAt > 0 {
		out["expires_at"] = time.Unix(sess.ExpiresAt, 0)
	}

	if req.SendEmail && h.emailSvc != nil {
		go func(to, name, planName string, price float64, link string) {
			if err := h.emailSvc.SendBillingLink(to, name, planName, price, link); err != nil {
				log.Error().Err(err).Str("to", to).Msg("admin billing-link: falha ao enviar email")
			}
		}(target.Email, target.Name, plan.Name, plan.Price, sess.URL)
		out["sent_email"] = true
	}

	log.Info().
		Str("admin_target", target.ID.String()).
		Str("plan", plan.Name).
		Bool("emailed", req.SendEmail).
		Msg("admin billing-link: link gerado (sem subscription ativa)")

	return c.JSON(out)
}
