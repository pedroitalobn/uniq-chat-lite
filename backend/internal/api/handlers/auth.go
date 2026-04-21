package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	stripe "github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/checkout/session"
	stripecustomer "github.com/stripe/stripe-go/v76/customer"
	"github.com/stripe/stripe-go/v76/paymentintent"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

var (
	stripeKey          string
	stripeCheckoutType string
)

func loadStripeConfigFromDB(db *gorm.DB) {
	var settings models.PaymentSettings
	if db.Where("id = ?", "default").First(&settings).Error == nil {
		stripeKey = settings.StripeSecretKey
		stripeCheckoutType = settings.StripeCheckoutType
		if stripeCheckoutType == "" {
			stripeCheckoutType = "redirect"
		}
	}
}

func getStripeCheckoutType(db *gorm.DB) string {
	if stripeCheckoutType == "" {
		loadStripeConfigFromDB(db)
	}
	return stripeCheckoutType
}

// Register godoc
// POST /auth/register
// Body: { "name": "...", "email": "...", "username": "...", "password": "...", "workspace_name": "...", "invite_code": "...", "plan_id": "..." }
func (h *AuthHandler) Register(c *fiber.Ctx) error {
	var req struct {
		Name          string `json:"name"`
		Email         string `json:"email"`
		Username      string `json:"username"`
		Password      string `json:"password"`
		WorkspaceName string `json:"workspace_name"`
		InviteCode    string `json:"invite_code"`
		PlanID        string `json:"plan_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Username = strings.TrimSpace(strings.ToLower(req.Username))
	req.Password = strings.TrimSpace(req.Password)
	req.WorkspaceName = strings.TrimSpace(req.WorkspaceName)
	req.InviteCode = strings.TrimSpace(req.InviteCode)
	req.PlanID = strings.TrimSpace(req.PlanID)

	if req.Name == "" || req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, email e password são obrigatórios"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "senha deve ter ao menos 8 caracteres"})
	}

	// Check if invite system is enabled
	var inviteSetting models.SystemSetting
	inviteEnabled := false
	if err := h.db.First(&inviteSetting, "key = ?", "invite_system_enabled").Error; err == nil {
		inviteEnabled = inviteSetting.Value == "true"
	}

	// If invite system is enabled, require a valid invite code
	if inviteEnabled {
		if req.InviteCode == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "código de convite é obrigatório"})
		}
		valid, _ := IsInviteCodeValid(h.db, req.InviteCode)
		if !valid {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "código de convite inválido ou já utilizado"})
		}
	}

	// Check email uniqueness
	var existing models.User
	if h.db.Where("email = ?", req.Email).First(&existing).Error == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "e-mail já cadastrado"})
	}
	// Check username uniqueness
	if req.Username != "" {
		if h.db.Where("username = ?", req.Username).First(&existing).Error == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "username já em uso"})
		}
	}

	// Determine plan - check if it's a paid plan
	var plan *models.Plan
	var isPaidPlan bool
	if req.PlanID != "" {
		planID, err := uuid.Parse(req.PlanID)
		if err == nil {
			var p models.Plan
			if h.db.First(&p, "id = ?", planID).Error == nil && p.Price > 0 {
				plan = &p
				isPaidPlan = true
			}
		}
	}

	// If paid plan, create as "lead" (not active, no login yet)
	// If free plan or no plan, create as "customer" (active)
	var user models.User
	if isPaidPlan {
		// Lead - inactive, no login until payment confirmed
		user = models.User{
			Name:     req.Name,
			Email:    req.Email,
			Role:     models.RoleLead,
			IsActive: false, // Inactive until payment confirmed
		}
		if req.Username != "" {
			user.Username = &req.Username
		}
		if plan != nil {
			user.PlanID = &plan.ID
		}
	} else {
		// Customer - active immediately (free plan)
		var freePlan models.Plan
		h.db.First(&freePlan, "name = 'Free'")

		user = models.User{
			Name:     req.Name,
			Email:    req.Email,
			Role:     models.RoleCustomer,
			IsActive: true,
		}
		if req.Username != "" {
			user.Username = &req.Username
		}
		if freePlan.ID != uuid.Nil {
			user.PlanID = &freePlan.ID
		}
	}

	if err := user.SetPassword(req.Password); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
	}
	if err := h.db.Create(&user).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar conta"})
	}

	// Mark invite code as used
	if req.InviteCode != "" {
		MarkInviteCodeUsed(h.db, req.InviteCode, user.ID)
	}

	// Todo usuário ganha um workspace default, usando o nome fornecido ou
	// "<primeiro nome>'s Workspace" como fallback. Assim servers/instâncias
	// criados pelo usuário ficam sempre vinculados a um workspace, evitando
	// o cenário em que um workspace novo "esconde" os recursos órfãos.
	workspaceName := req.WorkspaceName
	if workspaceName == "" {
		firstName := strings.Fields(user.Name)
		if len(firstName) > 0 {
			workspaceName = firstName[0] + "'s Workspace"
		} else {
			workspaceName = "Meu Workspace"
		}
	}
	workspace := createDefaultWorkspace(h.db, &user, workspaceName)

	// If paid plan, create payment session and return payment URL
	if isPaidPlan && plan != nil {
		// Create Stripe customer
		loadStripeConfigFromDB(h.db)
		if stripeKey == "" {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Stripe não configurado"})
		}

		stripe.Key = stripeKey

		cp := &stripe.CustomerParams{
			Email: stripe.String(user.Email),
			Name:  stripe.String(user.Name),
			Metadata: map[string]string{
				"user_id": user.ID.String(),
				"lead_id": user.ID.String(),
				"is_lead": "true",
			},
		}
		sc, err := stripecustomer.New(cp)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar cliente Stripe"})
		}
		h.db.Model(&user).Update("stripe_customer_id", sc.ID)

		frontendURL := config.AppConfig.FrontendURL
		checkoutType := getStripeCheckoutType(h.db)

		if checkoutType == "transparent" {
			// Transparent checkout - create PaymentIntent
			params := &stripe.PaymentIntentParams{
				Amount:      stripe.Int64(int64(plan.Price * 100)),
				Currency:    stripe.String("brl"),
				Customer:    stripe.String(sc.ID),
				Description: stripe.String("Assinatura " + plan.Name),
				Metadata: map[string]string{
					"user_id": user.ID.String(),
					"plan_id": plan.ID.String(),
					"is_lead": "true",
					"lead_id": user.ID.String(),
				},
				AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
					Enabled: stripe.Bool(true),
				},
			}

			pi, err := paymentintent.New(params)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar pagamento"})
			}

			return c.JSON(fiber.Map{
				"checkout_type":     "transparent",
				"client_secret":     pi.ClientSecret,
				"payment_intent_id": pi.ID,
				"plan_name":         plan.Name,
				"plan_price":        plan.Price,
				"amount":            pi.Amount,
				"lead_id":           user.ID.String(),
			})
		}

		// Redirect checkout
		params := &stripe.CheckoutSessionParams{
			Customer: stripe.String(sc.ID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{
					Price:    stripe.String(plan.StripePriceID),
					Quantity: stripe.Int64(1),
				},
			},
			SuccessURL:        stripe.String(frontendURL + "/payment/success?session_id={CHECKOUT_SESSION_ID}&lead_id=" + user.ID.String()),
			CancelURL:         stripe.String(frontendURL + "/plans"),
			ClientReferenceID: stripe.String(user.ID.String()),
			SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
				Metadata: map[string]string{
					"user_id": user.ID.String(),
					"plan_id": plan.ID.String(),
					"is_lead": "true",
					"lead_id": user.ID.String(),
				},
			},
		}

		session, err := session.New(params)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar sessão de pagamento"})
		}

		return c.JSON(fiber.Map{
			"checkout_type": "redirect",
			"url":           session.URL,
			"lead_id":       user.ID.String(),
		})
	}

	// Free plan - create account normally and return token
	h.emailSvc.SendWelcome(user.Email, user.Name)
	h.db.Preload("Plan").First(&user, "id = ?", user.ID)

	accessToken, err := middleware.GenerateAccessToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar token"})
	}
	refreshToken, _ := middleware.GenerateRefreshToken(user.ID)

	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HTTPOnly: true,
		SameSite: "Lax",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Path:     "/",
	})

	resp := fiber.Map{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   900,
		"user": fiber.Map{
			"id":       user.ID,
			"name":     user.Name,
			"email":    user.Email,
			"username": user.Username,
			"role":     user.Role,
			"is_beta":  user.IsBeta,
			"plan":     user.Plan,
		},
	}
	if workspace != nil {
		resp["workspace"] = workspace
	}
	return c.Status(fiber.StatusCreated).JSON(resp)
}

type AuthHandler struct {
	db       *gorm.DB
	emailSvc *email.Service
	manager  *whatsapp.Manager
}

// createDefaultWorkspace cria (idempotente) um workspace "default" pro usuário:
//   - cria a linha em workspaces
//   - cria um role Admin com todas as permissions
//   - adiciona o usuário como owner do workspace
// Retorna o workspace criado. Se algo falhar, retorna nil (caller decide o
// que fazer — no fluxo de registro a gente simplesmente não associa).
func createDefaultWorkspace(db *gorm.DB, user *models.User, name string) *models.Workspace {
	ws := &models.Workspace{OwnerID: user.ID, Name: name}
	if err := db.Create(ws).Error; err != nil {
		return nil
	}
	adminRole := models.Role{
		WorkspaceID: ws.ID,
		Name:        "Admin",
		Description: "Acesso total ao workspace",
		IsDefault:   true,
	}
	db.Create(&adminRole)
	var permissions []models.Permission
	db.Find(&permissions)
	for _, p := range permissions {
		db.Create(&models.RolePermission{RoleID: adminRole.ID, PermissionID: p.ID})
	}
	db.Create(&models.UserWorkspace{
		UserID:      user.ID,
		WorkspaceID: ws.ID,
		RoleID:      &adminRole.ID,
		IsOwner:     true,
	})
	db.Preload("Role").First(ws, ws.ID)
	return ws
}

func NewAuthHandler(db *gorm.DB, emailSvc *email.Service, manager *whatsapp.Manager) *AuthHandler {
	return &AuthHandler{db: db, emailSvc: emailSvc, manager: manager}
}

// validateAnthropicKey checks if the key is valid by hitting Anthropic Models API.
// Returns (accountEmail, error). Uses a minimal request to avoid charges.
func validateAnthropicKey(apiKey string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	if err != nil {
		return "", fmt.Errorf("failed to build request: %w", err)
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("falha ao conectar à Anthropic API: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	switch resp.StatusCode {
	case http.StatusOK:
		// Key is valid
		return "", nil
	case http.StatusUnauthorized:
		return "", fmt.Errorf("API key inválida ou revogada")
	case http.StatusForbidden:
		return "", fmt.Errorf("API key sem permissões suficientes")
	default:
		// Try to parse error message
		var errResp struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if jsonErr := json.Unmarshal(body, &errResp); jsonErr == nil && errResp.Error.Message != "" {
			return "", fmt.Errorf("Anthropic API: %s", errResp.Error.Message)
		}
		return "", fmt.Errorf("Anthropic API retornou status %d", resp.StatusCode)
	}
}

// extractKeyPrefix returns the first 12 chars of the key (safe to store as identifier)
func extractKeyPrefix(key string) string {
	if len(key) > 12 {
		return key[:12]
	}
	return key
}

// deriveEmailFromKey creates a deterministic pseudo-email from the API key prefix.
// Used to identify users who authenticate only via Anthropic API key.
func deriveEmailFromKey(key string) string {
	prefix := extractKeyPrefix(key)
	// Remove "sk-ant-" prefix for cleaner display
	clean := strings.TrimPrefix(prefix, "sk-ant-")
	clean = strings.ReplaceAll(clean, "-", "")
	if len(clean) > 8 {
		clean = clean[:8]
	}
	return fmt.Sprintf("user-%s@anthropic.key", strings.ToLower(clean))
}

// loginWithCredentials handles email/username + password authentication.
func (h *AuthHandler) loginWithCredentials(c *fiber.Ctx, identifier, password string) error {
	log.Debug().Str("identifier", identifier).Msg("login attempt")

	var user models.User
	q := h.db.Preload("Plan")

	lowerId := strings.ToLower(identifier)
	if strings.Contains(identifier, "@") {
		q = q.Where("LOWER(email) = ?", lowerId)
	} else {
		q = q.Where("LOWER(username) = ?", lowerId)
	}

	if err := q.First(&user).Error; err != nil {
		log.Debug().Str("identifier", identifier).Err(err).Msg("user not found")
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "credenciais inválidas"})
	}

	log.Debug().Str("email", user.Email).Str("role", string(user.Role)).Msg("user found, checking password")

	if !user.CheckPassword(password) {
		log.Debug().Str("email", user.Email).Msg("password mismatch")
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "credenciais inválidas"})
	}

	if user.IsBlocked() {
		msg := "conta desativada"
		if user.IsActive && user.BlockedUntil != nil {
			msg = fmt.Sprintf("conta bloqueada até %s", user.BlockedUntil.Format("02/01/2006 15:04"))
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": msg})
	}

	// Record last login time
	now := time.Now()
	h.db.Model(&user).Update("last_login_at", now)

	accessToken, err := middleware.GenerateAccessToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar token"})
	}
	refreshToken, _ := middleware.GenerateRefreshToken(user.ID)

	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HTTPOnly: true,
		SameSite: "Lax",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Path:     "/",
	})

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
			"is_beta":  user.IsBeta,
			"plan":     user.Plan,
		},
	})
}

// Login godoc
// POST /auth/login
// Accepts two forms:
//   - Credential login: { "identifier": "email or username", "password": "..." }
//   - Anthropic key login: { "anthropic_api_key": "sk-ant-..." }
func (h *AuthHandler) Login(c *fiber.Ctx) error {
	var req struct {
		// Credential login
		Identifier string `json:"identifier"` // email or username
		Password   string `json:"password"`
		// Legacy Anthropic key login
		AnthropicAPIKey string `json:"anthropic_api_key"`
	}
	if err := c.BodyParser(&req); err != nil {
		log.Error().Err(err).Msg("login: failed to parse body")
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	log.Info().Str("identifier", req.Identifier).Str("has_password", fmt.Sprintf("%v", req.Password != "")).Msg("login request")

	// ── Credential login path ──────────────────────────────────────────────
	if strings.TrimSpace(req.Identifier) != "" && strings.TrimSpace(req.Password) != "" {
		return h.loginWithCredentials(c, strings.TrimSpace(req.Identifier), strings.TrimSpace(req.Password))
	}

	// ── Anthropic API key path (legacy / API users) ────────────────────────
	if strings.TrimSpace(req.AnthropicAPIKey) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "forneça 'identifier'+'password' ou 'anthropic_api_key'",
		})
	}

	key := strings.TrimSpace(req.AnthropicAPIKey)

	// Validate against Anthropic API
	if _, err := validateAnthropicKey(key); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "API key inválida: " + err.Error(),
		})
	}

	// Derive a stable identity from the key
	keyHash := models.HashAPIKey(key)
	keyPrefix := extractKeyPrefix(key)
	pseudoEmail := deriveEmailFromKey(key)

	// Find or create user based on this key hash
	var user models.User
	err := h.db.Preload("Plan").
		Joins("JOIN api_keys ON api_keys.user_id = users.id").
		Where("api_keys.key_hash = ? AND api_keys.is_active = true", keyHash).
		First(&user).Error

	if err != nil {
		// Key hash not found — check if user already exists by derived email
		var existingUser models.User
		emailErr := h.db.Preload("Plan").Where("email = ?", pseudoEmail).First(&existingUser).Error
		if emailErr == nil {
			// User exists but logged in with a new/rotated key — link new key
			user = existingUser
		} else {
			// Truly new user — create account
			var freePlan models.Plan
			h.db.First(&freePlan, "name = 'Free'")

			user = models.User{
				Name:     "User " + keyPrefix,
				Email:    pseudoEmail,
				Role:     models.RoleCustomer,
				IsActive: true,
			}
			if freePlan.ID.String() != "00000000-0000-0000-0000-000000000000" {
				user.PlanID = &freePlan.ID
			}
			_ = user.SetPassword(keyHash[:32])

			if createErr := h.db.Create(&user).Error; createErr != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "erro ao criar conta",
				})
			}
		}

		// Store the API key for future lookups
		apiKeyRecord := models.APIKey{
			UserID:    user.ID,
			Name:      "Anthropic Key " + keyPrefix,
			KeyHash:   keyHash,
			KeyPrefix: keyPrefix,
			IsActive:  true,
		}
		h.db.Create(&apiKeyRecord)

		// Reload with plan
		h.db.Preload("Plan").First(&user, "id = ?", user.ID)
	}

	if user.IsBlocked() {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "conta desativada ou bloqueada"})
	}

	// Update last_used_at on the API key
	now := time.Now()
	h.db.Model(&models.APIKey{}).
		Where("key_hash = ?", keyHash).
		Update("last_used_at", now)

	// Generate session tokens
	accessToken, err := middleware.GenerateAccessToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar token"})
	}
	refreshToken, err := middleware.GenerateRefreshToken(user.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar refresh token"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HTTPOnly: true,
		SameSite: "Lax",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Path:     "/",
	})

	return c.JSON(fiber.Map{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   900,
		"user": fiber.Map{
			"id":      user.ID,
			"name":    user.Name,
			"email":   user.Email,
			"role":    user.Role,
			"is_beta": user.IsBeta,
			"plan":    user.Plan,
		},
	})
}

// Refresh godoc
// POST /auth/refresh
func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	tokenStr := c.Cookies("refresh_token")
	if tokenStr == "" {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = c.BodyParser(&body)
		tokenStr = body.RefreshToken
	}

	if tokenStr == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "refresh token não fornecido"})
	}

	claims, err := middleware.ParseRefreshToken(tokenStr)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "refresh token inválido"})
	}

	var user models.User
	if err := h.db.Preload("Plan").First(&user, "id = ?", claims.UserID).Error; err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "usuário não encontrado"})
	}
	if user.IsBlocked() {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "conta desativada ou bloqueada"})
	}

	accessToken, err := middleware.GenerateAccessToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar token"})
	}
	newRefresh, _ := middleware.GenerateRefreshToken(user.ID)

	// Reconnect WhatsApp instances on token refresh
	if h.manager != nil {
		go h.manager.ReconnectAll(user.ID.String())
	}

	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    newRefresh,
		HTTPOnly: true,
		SameSite: "Lax",
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Path:     "/",
	})

	return c.JSON(fiber.Map{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   900,
	})
}

// Logout godoc
// POST /auth/logout
func (h *AuthHandler) Logout(c *fiber.Ctx) error {
	c.Cookie(&fiber.Cookie{
		Name:    "refresh_token",
		Value:   "",
		Expires: time.Now().Add(-time.Hour),
		Path:    "/",
	})
	return c.JSON(fiber.Map{"message": "logout realizado com sucesso"})
}

// Me godoc
// GET /auth/me
func (h *AuthHandler) Me(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	h.db.Preload("Plan").First(user, "id = ?", user.ID)

	return c.JSON(fiber.Map{
		"id":         user.ID,
		"name":       user.Name,
		"email":      user.Email,
		"role":       user.Role,
		"is_beta":    user.IsBeta,
		"plan":       user.Plan,
		"is_active":  user.IsActive,
		"created_at": user.CreatedAt,
	})
}

// UpdateMe godoc
// PUT /auth/me — update own profile (name, username)
func (h *AuthHandler) UpdateMe(c *fiber.Ctx) error {
	userID := c.Locals("userID").(uuid.UUID)

	var req struct {
		Name     *string `json:"name"`
		Username *string `json:"username"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	var user models.User
	if err := h.db.Preload("Plan").First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "usuário não encontrado"})
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome não pode ser vazio"})
		}
		updates["name"] = name
	}
	if req.Username != nil {
		username := strings.TrimSpace(strings.ToLower(*req.Username))
		if username == "" {
			updates["username"] = nil
		} else {
			var existing models.User
			if h.db.Where("username = ? AND id != ?", username, userID).First(&existing).Error == nil {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "username já em uso"})
			}
			updates["username"] = username
		}
	}

	if len(updates) > 0 {
		if err := h.db.Model(&user).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar perfil"})
		}
	}

	h.db.Preload("Plan").First(&user, "id = ?", userID)
	return c.JSON(fiber.Map{
		"id":       user.ID,
		"name":     user.Name,
		"email":    user.Email,
		"username": user.Username,
		"role":     user.Role,
		"is_beta":  user.IsBeta,
		"plan":     user.Plan,
	})
}

// ChangePassword godoc
// POST /auth/change-password
func (h *AuthHandler) ChangePassword(c *fiber.Ctx) error {
	userID := c.Locals("userID").(uuid.UUID)

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.CurrentPassword == "" || req.NewPassword == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "current_password e new_password são obrigatórios"})
	}
	if len(req.NewPassword) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nova senha deve ter ao menos 8 caracteres"})
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "usuário não encontrado"})
	}
	if !user.CheckPassword(req.CurrentPassword) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "senha atual incorreta"})
	}
	if err := user.SetPassword(req.NewPassword); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
	}
	if err := h.db.Save(&user).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar senha"})
	}

	h.emailSvc.SendPasswordChanged(user.Email, user.Name)

	return c.JSON(fiber.Map{"message": "senha alterada com sucesso"})
}

// ForgotPassword godoc
// POST /auth/forgot-password
// Body: { "email": "..." }
func (h *AuthHandler) ForgotPassword(c *fiber.Ctx) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email é obrigatório"})
	}

	// Always return success to avoid user enumeration
	var user models.User
	if h.db.Where("email = ?", req.Email).First(&user).Error != nil {
		return c.JSON(fiber.Map{"message": "se o e-mail estiver cadastrado, você receberá as instruções em breve"})
	}

	// Invalidate old tokens
	h.db.Where("user_id = ? AND used_at IS NULL", user.ID).
		Updates(map[string]interface{}{"used_at": time.Now()})

	token := models.PasswordResetToken{
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}
	if err := h.db.Create(&token).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar token"})
	}

	// Import config lazily via package-level reference — appURL set in router
	resetLink := fmt.Sprintf("%s/reset-password?token=%s", authHandlerAppURL, token.Token)
	h.emailSvc.SendForgotPassword(user.Email, user.Name, resetLink)

	return c.JSON(fiber.Map{"message": "se o e-mail estiver cadastrado, você receberá as instruções em breve"})
}

// ResetPassword godoc
// POST /auth/reset-password
// Body: { "token": "...", "password": "..." }
func (h *AuthHandler) ResetPassword(c *fiber.Ctx) error {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Token = strings.TrimSpace(req.Token)
	req.Password = strings.TrimSpace(req.Password)
	if req.Token == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token e password são obrigatórios"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "senha deve ter ao menos 8 caracteres"})
	}

	var resetToken models.PasswordResetToken
	if err := h.db.Where("token = ?", req.Token).First(&resetToken).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token inválido ou expirado"})
	}
	if !resetToken.IsValid() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token inválido ou expirado"})
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", resetToken.UserID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "usuário não encontrado"})
	}

	if err := user.SetPassword(req.Password); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
	}
	if err := h.db.Save(&user).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar senha"})
	}

	now := time.Now()
	h.db.Model(&resetToken).Update("used_at", now)

	return c.JSON(fiber.Map{"message": "senha redefinida com sucesso"})
}

// authHandlerAppURL is set by the router so ForgotPassword can build reset links
// without importing config directly (avoids circular deps).
var authHandlerAppURL string

// SetAuthHandlerAppURL must be called by the router during setup.
func SetAuthHandlerAppURL(appURL string) {
	authHandlerAppURL = appURL
}

// ValidateKey godoc
// POST /auth/validate-key  — lightweight pre-check before login
func (h *AuthHandler) ValidateKey(c *fiber.Ctx) error {
	var req struct {
		AnthropicAPIKey string `json:"anthropic_api_key"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.AnthropicAPIKey) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'anthropic_api_key' é obrigatório"})
	}

	if _, err := validateAnthropicKey(strings.TrimSpace(req.AnthropicAPIKey)); err != nil {
		return c.JSON(fiber.Map{"valid": false, "error": err.Error()})
	}
	return c.JSON(fiber.Map{"valid": true})
}
