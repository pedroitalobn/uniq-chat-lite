package handlers

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	stripe "github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/checkout/session"
	stripecustomer "github.com/stripe/stripe-go/v76/customer"
	"github.com/stripe/stripe-go/v76/paymentintent"
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
	if err := h.db.First(&settings).Error; err == nil {
		if settings.StripeSecretKey != "" {
			stripe.Key = settings.StripeSecretKey
		}
		h.stripeCheckoutType = settings.StripeCheckoutType
		if h.stripeCheckoutType == "" {
			h.stripeCheckoutType = "redirect"
		}
	} else {
		stripe.Key = config.AppConfig.StripeSecretKey
		h.stripeCheckoutType = "redirect"
	}
}

func (h *StripeHandler) getWebhookSecret() string {
	var settings models.PaymentSettings
	if err := h.db.First(&settings).Error; err == nil && settings.StripeWebhookSecret != "" {
		return settings.StripeWebhookSecret
	}
	return config.AppConfig.StripeWebhookSecret
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

// POST /stripe/checkout — create Stripe Checkout session (protected)
func (h *StripeHandler) CreateCheckout(c *fiber.Ctx) error {
	h.loadConfig()
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	var req struct {
		PlanID string `json:"plan_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var plan models.Plan
	if err := h.db.First(&plan, "id = ?", req.PlanID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plano não encontrado"})
	}
	if plan.StripePriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plano sem preço Stripe configurado"})
	}
	if plan.Price == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "use este endpoint apenas para planos pagos"})
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
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar cliente Stripe"})
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "assinatura inválida: " + err.Error()})
	}

	switch event.Type {
	case "checkout.session.completed":
		var sess stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &sess); err == nil {
			h.handleCheckoutCompleted(&sess)
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
