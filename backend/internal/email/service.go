package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

type Service struct {
	apiKey  string
	from    string
	appName string
	appURL  string
}

func New(apiKey, from, appName, appURL string) *Service {
	return &Service{apiKey: apiKey, from: from, appName: appName, appURL: appURL}
}

type EmailPayload struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
}

func (s *Service) send(to, subject, html string) {
	if s.apiKey == "" || to == "" {
		return
	}
	go func() {
		payload := EmailPayload{
			From:    fmt.Sprintf("%s <%s>", s.appName, s.from),
			To:      []string{to},
			Subject: subject,
			HTML:    html,
		}
		body, _ := json.Marshal(payload)
		req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
		if err != nil {
			log.Error().Err(err).Msg("email: failed to build request")
			return
		}
		req.Header.Set("Authorization", "Bearer "+s.apiKey)
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			log.Error().Err(err).Str("to", to).Msg("email: send failed")
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			log.Error().Int("status", resp.StatusCode).Str("to", to).Msg("email: resend returned error")
		} else {
			log.Debug().Str("to", to).Str("subject", subject).Msg("email: sent")
		}
	}()
}

func (s *Service) SendWelcome(to, name string) {
	s.send(to, "Bem-vindo ao "+s.appName+"!", welcomeHTML(s.appName, name, s.appURL))
}

func (s *Service) SendPasswordChanged(to, name string) {
	s.send(to, "Sua senha foi alterada", passwordChangedHTML(s.appName, name))
}

func (s *Service) SendForgotPassword(to, name, resetLink string) {
	s.send(to, "Redefinição de senha", forgotPasswordHTML(s.appName, name, resetLink))
}

func (s *Service) SendPaymentConfirmed(to, name, planName string, amount float64) {
	s.send(to, "Pagamento confirmado!", paymentConfirmedHTML(s.appName, name, planName, amount))
}

func (s *Service) SendPlanChanged(to, name, oldPlan, newPlan string) {
	s.send(to, "Seu plano foi atualizado", planChangedHTML(s.appName, name, oldPlan, newPlan))
}

func (s *Service) SendPaymentFailed(to, name string) {
	billingURL := s.appURL + "/billing"
	s.send(to, "Falha no pagamento", paymentFailedHTML(s.appName, name, billingURL))
}

func (s *Service) SendSubscriptionCanceled(to, name string) {
	plansURL := s.appURL + "/plans"
	s.send(to, "Assinatura cancelada", subscriptionCanceledHTML(s.appName, name, plansURL))
}

func (s *Service) SendInstanceBanned(to, name, instanceName, phone string) {
	s.send(to, "Instância banida", instanceBannedHTML(s.appName, name, instanceName, phone))
}

func (s *Service) SendAdminCreatedAccount(to, name, email, tempPassword string) {
	s.send(to, "Sua conta foi criada no "+s.appName, adminCreatedAccountHTML(s.appName, name, email, tempPassword, s.appURL))
}

func (s *Service) SendAdminResetPassword(to, name, newPassword string) {
	s.send(to, "Sua senha foi redefinida pelo administrador", adminResetPasswordHTML(s.appName, name, newPassword))
}
