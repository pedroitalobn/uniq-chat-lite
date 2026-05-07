package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
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
		Name                 string `json:"name"`
		Email                string `json:"email"`
		Username             string `json:"username"`
		Password             string `json:"password"`
		WorkspaceName        string `json:"workspace_name"`
		InviteCode           string `json:"invite_code"`
		PlanID               string `json:"plan_id"`
		WorkspaceInviteToken string `json:"workspace_invite_token"`
		TurnstileToken       string `json:"turnstile_token"` // cf-turnstile-response
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
	req.WorkspaceInviteToken = strings.TrimSpace(req.WorkspaceInviteToken)

	// Se veio um workspace_invite_token, validamos aqui ANTES de criar
	// a conta e travamos o email pra bater com o do convite. Evita
	// cenário em que alguém com o link aceita com outro email.
	var workspaceInvite *models.Invite
	if req.WorkspaceInviteToken != "" {
		var inv models.Invite
		if err := h.db.Where("token = ? AND status = 'pending'",
			req.WorkspaceInviteToken).First(&inv).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "convite inválido ou já utilizado",
			})
		}
		if time.Now().After(inv.ExpiresAt) {
			h.db.Model(&inv).Update("status", "expired")
			return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "convite expirado"})
		}
		if inv.Email != req.Email {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "o email do cadastro deve ser igual ao do convite",
			})
		}
		workspaceInvite = &inv
	}

	if req.Name == "" || req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, email e password são obrigatórios"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "senha deve ter ao menos 8 caracteres"})
	}

	// Anti-bot: bloqueia padrões clássicos de signup automatizado.
	// Convites de workspace pulam essa checagem (admin já validou o email).
	if workspaceInvite == nil {
		if reason := suspiciousSignupEmail(req.Email); reason != "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": reason})
		}
		if reason := suspiciousSignupName(req.Name); reason != "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": reason})
		}
		// Captcha Turnstile — bypass automático em dev (sem TURNSTILE_SECRET_KEY).
		if err := verifyTurnstile(c.Context(), req.TurnstileToken, c.IP()); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
	}

	// Dedup canônico: bloqueia Gmail dot-trick e plus-addressing usados
	// pra criar N contas na mesma caixa real.
	canon := canonicalEmail(req.Email)
	if canon != req.Email {
		var dup models.User
		if h.db.Where("LOWER(email) = ? OR LOWER(email) = ?", canon, req.Email).First(&dup).Error == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "e-mail já cadastrado"})
		}
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
	// Email verification: gerada quando NÃO é convite (admin já validou).
	// Quando REQUIRE_EMAIL_VERIFICATION=true, IsActive começa false.
	requireVerify := strings.EqualFold(os.Getenv("REQUIRE_EMAIL_VERIFICATION"), "true")
	needsVerify := workspaceInvite == nil && requireVerify
	verifyToken := ""
	if needsVerify {
		verifyToken = generateToken("verify_")
	}
	now := time.Now()

	// If free plan or no plan, create as "customer" (active)
	var user models.User
	if isPaidPlan {
		// Lead - inactive, no login until payment confirmed
		user = models.User{
			Name:                    req.Name,
			Email:                   req.Email,
			Role:                    models.RoleLead,
			IsActive:                false, // Inactive until payment confirmed
			SignupIP:                c.IP(),
			SignupUserAgent:         truncate(c.Get("User-Agent"), 500),
			EmailVerificationToken:  verifyToken,
			EmailVerificationSentAt: ptrTime(now),
		}
		if req.Username != "" {
			user.Username = &req.Username
		}
		if plan != nil {
			user.PlanID = &plan.ID
		}
	} else {
		// Customer - active immediately (free plan), exceto se needsVerify.
		var freePlan models.Plan
		h.db.First(&freePlan, "name = 'Free'")

		user = models.User{
			Name:                    req.Name,
			Email:                   req.Email,
			Role:                    models.RoleCustomer,
			IsActive:                !needsVerify,
			SignupIP:                c.IP(),
			SignupUserAgent:         truncate(c.Get("User-Agent"), 500),
			EmailVerificationToken:  verifyToken,
			EmailVerificationSentAt: ptrTime(now),
		}
		if workspaceInvite != nil {
			// Convidado já está verificado (clicou no link do convite no email dele).
			user.EmailVerifiedAt = ptrTime(now)
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

	// Fluxo 1: usuário convidado via workspace_invite_token — NÃO cria
	// workspace próprio, apenas entra no workspace do convite. Assim o
	// usuário convidado fica com acesso só àquele workspace, com a role
	// definida pelo admin que convidou.
	var workspace *models.Workspace
	if workspaceInvite != nil {
		var ws models.Workspace
		if err := h.db.First(&ws, "id = ?", workspaceInvite.WorkspaceID).Error; err == nil {
			uw := models.UserWorkspace{
				UserID:      user.ID,
				WorkspaceID: ws.ID,
				RoleID:      &workspaceInvite.RoleID,
				IsOwner:     false,
			}
			if err := h.db.Create(&uw).Error; err != nil {
				// Não dá pra associar o user ao workspace que ele foi
				// convidado pra entrar — pior que silenciar é deixar o
				// onboarding "completar" sem acesso real. Aborta com
				// erro pra o frontend mostrar e o user retentar.
				log.Error().Err(err).Str("user_id", user.ID.String()).Str("workspace_id", ws.ID.String()).
					Msg("aceitar invite: falha ao criar UserWorkspace")
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "falha ao adicionar você ao workspace — entre em contato com quem te convidou",
				})
			}
			h.db.Model(workspaceInvite).Update("status", "accepted")
			workspace = &ws
		}
	} else {
		// Fluxo 2: cadastro normal — todo usuário ganha um workspace default.
		// Usa o nome fornecido ou "<primeiro nome>'s Workspace" como fallback.
		workspaceName := req.WorkspaceName
		if workspaceName == "" {
			firstName := strings.Fields(user.Name)
			if len(firstName) > 0 {
				workspaceName = firstName[0] + "'s Workspace"
			} else {
				workspaceName = "Meu Workspace"
			}
		}
		workspace = createDefaultWorkspace(h.db, &user, workspaceName)
		if workspace == nil {
			log.Error().Str("user_id", user.ID.String()).Str("workspace_name", workspaceName).
				Msg("createDefaultWorkspace failed during register — user has no workspace; auto-heal in /v1/workspaces will retry on first list call")
		}
	}

	// cleanupLead deletes the just-created lead user so retrying with the same
	// email works correctly if any downstream step (Stripe) fails.
	cleanupLead := func() {
		h.db.Unscoped().Delete(&user)
		if workspace != nil {
			h.db.Unscoped().Delete(workspace)
		}
	}

	// If paid plan, create payment session and return payment URL
	if isPaidPlan && plan != nil {
		// Create Stripe customer
		loadStripeConfigFromDB(h.db)
		if stripeKey == "" {
			cleanupLead()
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "pagamento não configurado — contacte o suporte"})
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
			cleanupLead()
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
				cleanupLead()
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
			cleanupLead()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar sessão de pagamento"})
		}

		return c.JSON(fiber.Map{
			"checkout_type": "redirect",
			"url":           session.URL,
			"lead_id":       user.ID.String(),
		})
	}

	// Free plan - se precisa verificação, manda email de verificação e
	// responde 202 (sem access_token). Caso contrário fluxo normal.
	if needsVerify {
		appURL := strings.TrimRight(os.Getenv("APP_URL"), "/")
		if appURL == "" {
			appURL = "https://app.uniq.chat"
		}
		verifyLink := appURL + "/verify-email?token=" + verifyToken
		go h.emailSvc.SendEmailVerification(user.Email, user.Name, verifyLink)
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"verification_required": true,
			"message":               "enviamos um e-mail de confirmação para " + user.Email,
		})
	}
	go h.emailSvc.SendWelcome(user.Email, user.Name)
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
//   - cria a linha em workspaces (com retry de slug em colisão)
//   - cria um role Admin com todas as permissions
//   - adiciona o usuário como owner do workspace
//
// Retorna o workspace criado. Se algo falhar, retorna nil.
//
// Slug uniqueness: SlugFrom(name) gera o mesmo valor pra nomes parecidos
// ("João's Workspace" → "joao-s-workspace"). O segundo user com workspace
// igual quebrava o INSERT por unique violation e a função retornava nil
// silencioso — user ficava sem workspace, /v1/workspaces vazio, inbox
// não carregava. Agora retry com sufixo aleatório até achar slug livre.
func createDefaultWorkspace(db *gorm.DB, user *models.User, name string) *models.Workspace {
	baseSlug := models.SlugFrom(name)
	ws := &models.Workspace{OwnerID: user.ID, Name: name, PlanID: user.PlanID, Slug: baseSlug}
	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		if attempt > 0 {
			suffix := uuid.New().String()[:6]
			ws.Slug = baseSlug + "-" + suffix
			if len(ws.Slug) > 63 {
				ws.Slug = ws.Slug[:63]
			}
			ws.ID = uuid.Nil // BeforeCreate atribui novo
		}
		err := db.Create(ws).Error
		if err == nil {
			lastErr = nil
			break
		}
		lastErr = err
		msg := strings.ToLower(err.Error())
		if !strings.Contains(msg, "unique") && !strings.Contains(msg, "duplicate") {
			break // não é colisão de slug — outro problema, aborta
		}
	}
	if lastErr != nil {
		return nil
	}
	adminRole := models.Role{
		WorkspaceID: ws.ID,
		Name:        "Admin",
		Description: "Acesso total ao workspace",
		IsDefault:   true,
	}
	if err := db.Create(&adminRole).Error; err != nil {
		// Workspace existe mas sem role. UserWorkspace abaixo precisa
		// do role; sem ele user fica sem permissions. Loga e segue —
		// melhor ter workspace vazio (auto-heal pode ser re-rodado)
		// do que travar o cadastro inteiro.
		log.Error().Err(err).Str("workspace_id", ws.ID.String()).Msg("createDefaultWorkspace: criar adminRole falhou")
	}
	var permissions []models.Permission
	db.Find(&permissions)
	for _, p := range permissions {
		// Erros aqui são raros (apenas se a permission table tem inconsistência).
		// Falhas individuais não derrubam o setup; perm faltando é só uma feature
		// a menos liberada — admin pode reatribuir manualmente.
		_ = db.Create(&models.RolePermission{RoleID: adminRole.ID, PermissionID: p.ID}).Error
	}
	if err := db.Create(&models.UserWorkspace{
		UserID:      user.ID,
		WorkspaceID: ws.ID,
		RoleID:      &adminRole.ID,
		IsOwner:     true,
	}).Error; err != nil {
		// Sem UserWorkspace o user é DONO mas não tem membership —
		// /v1/workspaces retorna vazio e o user não vê nada. Pior caso
		// dos três. Loga e o auto-heal de /v1/workspaces vai detectar
		// "0 workspaces" e tentar recriar.
		log.Error().Err(err).Str("user_id", user.ID.String()).Str("workspace_id", ws.ID.String()).
			Msg("createDefaultWorkspace: criar UserWorkspace falhou")
	}
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

	normalizedIdentifier := strings.TrimSpace(identifier)
	lowerId := strings.ToLower(normalizedIdentifier)
	if strings.HasPrefix(lowerId, "@") {
		lowerId = strings.TrimPrefix(lowerId, "@")
	}

	if looksLikeEmail(lowerId) {
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

	// 2FA challenge: senha OK, mas precisa do código TOTP. Frontend troca
	// challenge_token + code em /v1/auth/2fa/verify pelo access_token real.
	if user.TOTPEnabledAt != nil {
		ch, err := middleware.Generate2FAChallengeToken(user.ID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar challenge"})
		}
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"requires_2fa":    true,
			"challenge_token": ch,
		})
	}

	// Record last login time + audit.
	now := time.Now()
	h.db.Model(&user).Update("last_login_at", now)
	c.Locals("user", &user) // p/ LogAudit pegar actor
	LogAudit(h.db, c, "auth.login_success",
		AuditTarget{Type: "user", ID: &user.ID}, nil)

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

func looksLikeEmail(identifier string) bool {
	if identifier == "" || strings.HasPrefix(identifier, "@") {
		return false
	}
	_, err := mail.ParseAddress(identifier)
	return err == nil
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
	// Antes: c.Locals("userID").(uuid.UUID) — mas o middleware seta a chave
	// como "user_id" (com underscore), nunca "userID". A type assertion
	// crua sem `, ok` panicava com "interface conversion: interface {} is
	// nil, not uuid.UUID" em todo request, quebrando edição de perfil.
	userID := middleware.GetCurrentUserID(c)
	if userID == uuid.Nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

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
	// Mesma armadilha de UpdateMe: chave correta é "user_id" via helper.
	userID := middleware.GetCurrentUserID(c)
	if userID == uuid.Nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

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

	go h.emailSvc.SendPasswordChanged(user.Email, user.Name)

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
	go h.emailSvc.SendForgotPassword(user.Email, user.Name, resetLink)

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

// RegisterStart godoc
// POST /auth/register/start
// Body: { "email": "...", "plan_id": "..." (optional) }
// Validates the email, creates a PendingRegistration and sends a magic link.
func (h *AuthHandler) RegisterStart(c *fiber.Ctx) error {
	var req struct {
		Email                string `json:"email"`
		PlanID               string `json:"plan_id"`
		InviteCode           string `json:"invite_code"`
		WorkspaceInviteToken string `json:"workspace_invite_token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email é obrigatório"})
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email inválido"})
	}

	// Check if email is already registered
	var existing models.User
	if h.db.Where("email = ?", req.Email).First(&existing).Error == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "e-mail já cadastrado"})
	}

	// Canonical dedup (Gmail dot-trick)
	canon := canonicalEmail(req.Email)
	if canon != req.Email {
		if h.db.Where("LOWER(email) = ? OR LOWER(email) = ?", canon, req.Email).First(&existing).Error == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "e-mail já cadastrado"})
		}
	}

	// Anti-bot
	if reason := suspiciousSignupEmail(req.Email); reason != "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": reason})
	}

	// Invalidate any previous pending registrations for this email
	h.db.Where("email = ? AND completed_at IS NULL", req.Email).
		Updates(map[string]interface{}{"expires_at": time.Now().Add(-time.Second)})

	pending := models.PendingRegistration{
		Email:                req.Email,
		InviteCode:           strings.TrimSpace(req.InviteCode),
		WorkspaceInviteToken: strings.TrimSpace(req.WorkspaceInviteToken),
		ExpiresAt:            time.Now().Add(30 * time.Minute),
	}
	if req.PlanID != "" {
		if pid, err := uuid.Parse(req.PlanID); err == nil {
			pending.PlanID = &pid
		}
	}
	if err := h.db.Create(&pending).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao iniciar cadastro"})
	}

	appURL := strings.TrimRight(authHandlerAppURL, "/")
	if appURL == "" {
		appURL = "https://app.uniq.chat"
	}
	magicURL := appURL + "/register/verify?token=" + pending.Token
	go h.emailSvc.SendMagicLink(req.Email, magicURL)

	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
		"message": "link enviado para " + req.Email,
	})
}

// RegisterVerify godoc
// POST /auth/register/verify
// Body: { "token": "..." }
// Validates the magic link token and marks it as verified.
func (h *AuthHandler) RegisterVerify(c *fiber.Ctx) error {
	var req struct {
		Token string `json:"token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token é obrigatório"})
	}

	var pending models.PendingRegistration
	if err := h.db.Where("token = ?", req.Token).First(&pending).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "link inválido ou expirado"})
	}
	if pending.IsExpired() {
		return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "link expirado — solicite um novo"})
	}
	if pending.IsCompleted() {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "cadastro já concluído"})
	}

	// Mark as verified (idempotent — re-clicking the link is fine)
	now := time.Now()
	if pending.VerifiedAt == nil {
		h.db.Model(&pending).Update("verified_at", now)
	}

	resp := fiber.Map{
		"pending_registration_id": pending.ID,
		"email":                   pending.Email,
		"plan_id":                 pending.PlanID,
	}
	// Hidrata nome/preço do plano pra UI mostrar a pill correta no
	// passo final sem precisar de outro round-trip.
	if pending.PlanID != nil {
		var plan models.Plan
		if h.db.First(&plan, "id = ?", pending.PlanID).Error == nil {
			resp["plan_name"] = plan.Name
			resp["plan_price"] = plan.Price
		}
	}
	return c.JSON(resp)
}

// RegisterComplete godoc
// POST /auth/register/complete
// Body: { "pending_registration_id": "...", "name": "...", "username": "...", "workspace_name": "...", "password": "..." }
// Creates the user account after email is verified.
func (h *AuthHandler) RegisterComplete(c *fiber.Ctx) error {
	var req struct {
		PendingRegistrationID string `json:"pending_registration_id"`
		Name                  string `json:"name"`
		Username              string `json:"username"`
		WorkspaceName         string `json:"workspace_name"`
		Password              string `json:"password"`
		PlanID                string `json:"plan_id"` // override plan if different from start
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Username = strings.TrimSpace(strings.ToLower(req.Username))
	req.WorkspaceName = strings.TrimSpace(req.WorkspaceName)
	req.Password = strings.TrimSpace(req.Password)

	if req.PendingRegistrationID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "pending_registration_id é obrigatório"})
	}
	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome é obrigatório"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "senha deve ter ao menos 8 caracteres"})
	}

	prID, err := uuid.Parse(req.PendingRegistrationID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "pending_registration_id inválido"})
	}

	var pending models.PendingRegistration
	if err := h.db.First(&pending, "id = ?", prID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "sessão de cadastro não encontrada"})
	}
	if pending.IsExpired() {
		return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "sessão expirada — solicite um novo link"})
	}
	if !pending.IsVerified() {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "email não verificado"})
	}
	if pending.IsCompleted() {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "cadastro já concluído"})
	}

	// Double-check email not taken (race guard)
	var existing models.User
	if h.db.Where("email = ?", pending.Email).First(&existing).Error == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "e-mail já cadastrado"})
	}

	// Username uniqueness
	if req.Username != "" {
		if h.db.Where("username = ?", req.Username).First(&existing).Error == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "username já em uso"})
		}
	}

	// Resolve plan
	planID := pending.PlanID
	if req.PlanID != "" {
		if pid, err := uuid.Parse(req.PlanID); err == nil {
			planID = &pid
		}
	}

	var plan *models.Plan
	var isPaidPlan bool
	if planID != nil {
		var p models.Plan
		if h.db.First(&p, "id = ?", planID).Error == nil && p.Price > 0 {
			plan = &p
			isPaidPlan = true
		}
	}

	// Workspace name fallback
	if req.WorkspaceName == "" {
		first := strings.Fields(req.Name)
		if len(first) > 0 {
			req.WorkspaceName = first[0] + "'s Workspace"
		} else {
			req.WorkspaceName = "Meu Workspace"
		}
	}

	// ────────────────────────────────────────────────────────────────
	// Plano pago → adiamos a criação do User/Workspace até o webhook
	// confirmar o pagamento. Antes a conta era criada com IsActive=false
	// antes do checkout — isso vazava registros "fantasmas" quando o
	// user abandonava o pagamento. Agora persistimos os dados do form
	// no PendingRegistration; o User+Workspace só nascem em
	// handleCheckoutCompleted/handlePaymentIntentSucceeded.
	// ────────────────────────────────────────────────────────────────
	if isPaidPlan && plan != nil {
		if plan.StripePriceID == "" {
			// Plano configurado como pago no DB mas sem price_id no
			// Stripe — config errada. Sem isso o subscription mode
			// retornaria 500 do Stripe sem mensagem clara.
			return c.Status(fiber.StatusFailedDependency).JSON(fiber.Map{
				"error": "plano pago sem price_id do Stripe configurado — contacte o suporte",
			})
		}

		hashed, err := models.HashPassword(req.Password)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
		}

		loadStripeConfigFromDB(h.db)
		if stripeKey == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "pagamento não configurado — contacte o suporte"})
		}
		stripe.Key = stripeKey

		cp := &stripe.CustomerParams{
			Email: stripe.String(pending.Email),
			Name:  stripe.String(req.Name),
			Metadata: map[string]string{
				"pending_id": pending.ID.String(),
			},
		}
		sc, err := stripecustomer.New(cp)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar cliente Stripe"})
		}

		// Snapshot do form no pending — vamos materializar User+Workspace
		// no webhook usando esses dados. plan_id também vai aqui pra
		// cobrir o caso onde o user escolheu o plano só no passo final
		// (/register/verify) e não veio com plan_id já no /start —
		// sem isso o materialize reads pending.PlanID nil e cria o
		// User sem plano, caindo em "free" no feature gate.
		patch := map[string]any{
			"name":               req.Name,
			"username":           req.Username,
			"workspace_name":     req.WorkspaceName,
			"password_hash":      hashed,
			"stripe_customer_id": sc.ID,
			"plan_id":            plan.ID,
		}
		h.db.Model(&pending).Updates(patch)

		frontendURL := config.AppConfig.FrontendURL
		checkoutType := getStripeCheckoutType(h.db)

		if checkoutType == "transparent" {
			params := &stripe.PaymentIntentParams{
				Amount:      stripe.Int64(int64(plan.Price * 100)),
				Currency:    stripe.String("brl"),
				Customer:    stripe.String(sc.ID),
				Description: stripe.String("Assinatura " + plan.Name),
				Metadata: map[string]string{
					"pending_id": pending.ID.String(),
					"plan_id":    plan.ID.String(),
				},
				AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
					Enabled: stripe.Bool(true),
				},
			}
			pi, err := paymentintent.New(params)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar pagamento: " + err.Error()})
			}
			h.db.Model(&pending).Update("stripe_pi_id", pi.ID)
			return c.JSON(fiber.Map{
				"checkout_type":     "transparent",
				"client_secret":     pi.ClientSecret,
				"payment_intent_id": pi.ID,
				"plan_name":         plan.Name,
				"plan_price":        plan.Price,
				"amount":            pi.Amount,
				"pending_id":        pending.ID.String(),
			})
		}

		params := &stripe.CheckoutSessionParams{
			Customer: stripe.String(sc.ID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{Price: stripe.String(plan.StripePriceID), Quantity: stripe.Int64(1)},
			},
			SuccessURL:        stripe.String(frontendURL + "/payment/success?session_id={CHECKOUT_SESSION_ID}&pending_id=" + pending.ID.String()),
			CancelURL:         stripe.String(frontendURL + "/register/verify?token=" + pending.Token),
			ClientReferenceID: stripe.String(pending.ID.String()),
			SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
				Metadata: map[string]string{
					"pending_id": pending.ID.String(),
					"plan_id":    plan.ID.String(),
				},
			},
			Metadata: map[string]string{
				"pending_id": pending.ID.String(),
				"plan_id":    plan.ID.String(),
			},
		}
		sess, err := session.New(params)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar sessão de pagamento: " + err.Error()})
		}
		h.db.Model(&pending).Update("stripe_session_id", sess.ID)
		return c.JSON(fiber.Map{
			"checkout_type": "redirect",
			"url":           sess.URL,
			"pending_id":    pending.ID.String(),
		})
	}

	// ────────────────────────────────────────────────────────────────
	// Plano grátis — cria User + Workspace agora.
	// ────────────────────────────────────────────────────────────────
	var freePlan models.Plan
	h.db.First(&freePlan, "name = 'Free'")
	user := models.User{
		Name:     req.Name,
		Email:    pending.Email,
		Role:     models.RoleCustomer,
		IsActive: true,
	}
	if freePlan.ID != uuid.Nil {
		user.PlanID = &freePlan.ID
	}
	if req.Username != "" {
		user.Username = &req.Username
	}
	if err := user.SetPassword(req.Password); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao processar senha"})
	}
	if err := h.db.Create(&user).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar conta"})
	}

	if pending.InviteCode != "" {
		MarkInviteCodeUsed(h.db, pending.InviteCode, user.ID)
	}
	workspace := createDefaultWorkspace(h.db, &user, req.WorkspaceName)
	if workspace == nil {
		log.Error().Str("user_id", user.ID.String()).Str("workspace_name", req.WorkspaceName).
			Msg("createDefaultWorkspace failed during free signup — user materializado sem workspace; /v1/workspaces auto-heal vai recriar")
	}
	now := time.Now()
	h.db.Model(&pending).Update("completed_at", now)

	// Free plan — return tokens
	go h.emailSvc.SendWelcome(user.Email, user.Name)
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
