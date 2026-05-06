package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	MailerooBaseURL = "https://smtp.maileroo.com/api/v2"
)

type Service struct {
	apiKey   string
	from     string
	fromName string
	appName  string
	appURL   string
}

func New(apiKey, from, fromName, appName, appURL string) *Service {
	return &Service{apiKey: apiKey, from: from, fromName: fromName, appName: appName, appURL: appURL}
}

func (s *Service) SetConfig(apiKey, from, fromName string) {
	s.apiKey = apiKey
	s.from = from
	s.fromName = fromName
}

func (s *Service) GetConfig() (apiKey, from, fromName string) {
	return s.apiKey, s.from, s.fromName
}

// Maileroo request/response types
type mailerooFrom struct {
	Address     string `json:"address"`
	DisplayName string `json:"display_name,omitempty"`
}

type mailerooTo struct {
	Address     string `json:"address"`
	DisplayName string `json:"display_name,omitempty"`
}

type mailerooRequest struct {
	From     mailerooFrom      `json:"from"`
	To       []mailerooTo      `json:"to"`
	Subject  string            `json:"subject"`
	HTML     string            `json:"html"`
	Plain    string            `json:"plain,omitempty"`
	Tracking bool              `json:"tracking"`
	Tags     map[string]string `json:"tags,omitempty"`
}

type mailerooResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		ReferenceID string `json:"reference_id"`
	} `json:"data"`
}

// EmailLog for tracking sent emails
type EmailLog struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	To          string    `json:"to"`
	Subject     string    `json:"subject"`
	Status      string    `json:"status"` // "sent", "failed", "pending"
	ReferenceID string    `json:"reference_id"`
	Error       string    `json:"error,omitempty"`
	EmailType   string    `json:"email_type"` // "welcome", "password_reset", etc.
	CreatedAt   time.Time `json:"created_at"`
}

func (s *Service) send(to, subject, html, emailType string) error {
	if s.apiKey == "" || to == "" {
		return fmt.Errorf("email service not configured")
	}

	fromName := s.fromName
	if fromName == "" {
		fromName = s.appName
	}

	reqBody := mailerooRequest{
		From: mailerooFrom{
			Address:     s.from,
			DisplayName: fromName,
		},
		To: []mailerooTo{
			{Address: to},
		},
		Subject:  subject,
		HTML:     html,
		Tracking: true,
		Tags: map[string]string{
			"type": emailType,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		log.Error().Err(err).Msg("email: failed to marshal request")
		return err
	}

	httpReq, err := http.NewRequest(http.MethodPost, MailerooBaseURL+"/emails", bytes.NewReader(body))
	if err != nil {
		log.Error().Err(err).Msg("email: failed to build request")
		return err
	}
	httpReq.Header.Set("Authorization", "Bearer "+s.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: send failed")
		return err
	}
	defer resp.Body.Close()

	var result mailerooResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to decode response")
		return err
	}

	if resp.StatusCode >= 400 {
		log.Error().Int("status", resp.StatusCode).Str("to", to).Str("message", result.Message).Msg("email: maileroo returned error")
		return fmt.Errorf("maileroo error: %s", result.Message)
	}

	log.Debug().Str("to", to).Str("subject", subject).Str("ref", result.Data.ReferenceID).Msg("email: sent")
	return nil
}

// SyncSend sends email synchronously and returns error
func (s *Service) SyncSend(to, subject, html, emailType string) error {
	return s.send(to, subject, html, emailType)
}

func (s *Service) SendEmailVerification(to, name, verifyLink string) {
	html := emailVerificationHTML(s.appName, s.appURL, name, verifyLink)
	if err := s.send(to, "Confirme seu e-mail — "+s.appName, html, "email_verification"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send verification")
	}
}

func (s *Service) SendWelcome(to, name string) {
	if err := s.send(to, "Bem-vindo ao "+s.appName+"!", welcomeHTML(s.appName, name, s.appURL), "welcome"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send welcome")
	}
}

func (s *Service) SendPasswordChanged(to, name string) {
	if err := s.send(to, "Sua senha foi alterada", passwordChangedHTML(s.appName, s.appURL, name), "password_changed"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send password changed")
	}
}

func (s *Service) SendForgotPassword(to, name, resetLink string) {
	if err := s.send(to, "Redefinição de senha", forgotPasswordHTML(s.appName, s.appURL, name, resetLink), "forgot_password"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send forgot password")
	}
}

func (s *Service) SendPaymentConfirmed(to, name, planName string, amount float64) {
	if err := s.send(to, "Pagamento confirmado!", paymentConfirmedHTML(s.appName, s.appURL, name, planName, amount), "payment_confirmed"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send payment confirmed")
	}
}

func (s *Service) SendPlanChanged(to, name, oldPlan, newPlan string) {
	if err := s.send(to, "Seu plano foi atualizado", planChangedHTML(s.appName, s.appURL, name, oldPlan, newPlan), "plan_changed"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send plan changed")
	}
}

func (s *Service) SendPaymentFailed(to, name string) {
	billingURL := s.appURL + "/billing"
	if err := s.send(to, "Falha no pagamento", paymentFailedHTML(s.appName, s.appURL, name, billingURL), "payment_failed"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send payment failed")
	}
}

func (s *Service) SendSubscriptionCanceled(to, name string) {
	plansURL := s.appURL + "/plans"
	if err := s.send(to, "Assinatura cancelada", subscriptionCanceledHTML(s.appName, s.appURL, name, plansURL), "subscription_canceled"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send subscription canceled")
	}
}

func (s *Service) SendInstanceBanned(to, name, instanceName, phone string) {
	if err := s.send(to, "Instância banida", instanceBannedHTML(s.appName, s.appURL, name, instanceName, phone), "instance_banned"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send instance banned")
	}
}

// AdminCreatedAccountInput agrupa os args com nomes — antes era posicional
// e cada vez que mexíamos cá ou lá os campos saíam trocados (Email no slot
// da senha, etc.). Struct elimina esse tipo de erro.
type AdminCreatedAccountInput struct {
	To           string // destinatário do email (= UserEmail na prática)
	Name         string // nome do user mostrado em "Olá, X"
	UserEmail    string // email da nova conta — vai no campo "Email" das credenciais
	TempPassword string // senha temporária definida pelo admin
}

// SendAdminCreatedAccount avisa o user que um admin criou a conta e
// passa as credenciais. Aceita struct nomeada pra impedir trocas
// posicionais — bug histórico.
func (s *Service) SendAdminCreatedAccount(in AdminCreatedAccountInput) {
	html := adminCreatedAccountHTML(s.appName, in.Name, s.appURL, in.UserEmail, in.TempPassword)
	log.Debug().
		Str("to", in.To).
		Str("user_email", in.UserEmail).
		Int("temp_password_len", len(in.TempPassword)).
		Str("app_url", s.appURL).
		Msg("email: dispatching admin_created_account")
	if err := s.send(in.To, "Sua conta foi criada no "+s.appName, html, "admin_created_account"); err != nil {
		log.Error().Err(err).Str("to", in.To).Msg("email: failed to send admin created account")
	}
}

func (s *Service) SendAdminResetPassword(to, name, newPassword string) {
	if err := s.send(to, "Sua senha foi redefinida pelo administrador", adminResetPasswordHTML(s.appName, s.appURL, name, newPassword), "admin_reset_password"); err != nil {
		log.Error().Err(err).Str("to", to).Msg("email: failed to send admin reset password")
	}
}

// SendWorkspaceInvite envia o convite para entrar num workspace. `acceptURL`
// já inclui o token — o backend gera via FrontendAppURL + "/invite/" + token.
func (s *Service) SendWorkspaceInvite(to, workspaceName, inviterName, roleName, acceptURL string) error {
	subject := inviterName + " convidou você para " + workspaceName + " no " + s.appName
	html := workspaceInviteHTML(s.appName, s.appURL, workspaceName, inviterName, roleName, acceptURL)
	return s.send(to, subject, html, "workspace_invite")
}

func (s *Service) SendMagicLink(to, magicURL string) {
	subject := "Confirme seu email — " + s.appName
	html := magicLinkHTML(s.appName, s.appURL, magicURL)
	go s.send(to, subject, html, "magic_link") //nolint:errcheck
}
