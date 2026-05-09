package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/uniq-chat/backend/internal/email"
	"github.com/uniq-chat/backend/internal/models"
)

// Multi-canal (Fase 4) — handlers de step que usam canais paralelos
// ao WhatsApp. Email via Maileroo (já integrado pra emails
// transacionais), SMS via stub extensível pra Twilio/Zenvia/etc.
//
// Pq esses canais separados?
//   • Drips B2B: lead entra → email de boas-vindas → wait 1d →
//     SMS lembrete pra ler email → wait 3d → WhatsApp pessoal
//   • Verificação multi-fator: SMS de confirmação + email com link
//   • Recuperação: cliente WhatsApp não responde 7d → email +
//     SMS pra retomar
//
// Cada step tem seu próprio JSON config — sem afetar StepTypeMessage
// (que continua WhatsApp puro). Falhas no provider externo NÃO
// bloqueiam a jornada — log warn e segue pro NextStep (semelhante
// ao stepHTTP).

// SetEmail injeta o EmailService global no executor. Chamado pelo
// router/main.go depois que ambos foram criados — separado do
// constructor pra evitar refactor cascata.
func (e *JourneyExecutor) SetEmail(svc *email.Service) {
	e.email = svc
}

// stepEmail — POST simples no Maileroo. Aceita destino dinâmico via
// {{contact.email}} e templates Liquid no subject/body.
//
// Config:
//   {
//     "to": "{{contact.email}}",          // override; default = contact.email
//     "subject": "Bem-vindo, {{name}}!",
//     "body_html": "<p>Olá {{name}}...</p>",
//     "body_text": "Olá {{name}}..."       // fallback pra clientes sem HTML
//   }
//
// Sem body_html, usa body_text wrapped em <pre>. Sem body_text, deriva
// do html (strip tags). Sem to, usa o email do contato lookupado pelo
// fromJID — se contact_id não tem email, marca skipped.
func (e *JourneyExecutor) stepEmail(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		To       string `json:"to"`
		Subject  string `json:"subject"`
		BodyHTML string `json:"body_html"`
		BodyText string `json:"body_text"`
	}
	_ = json.Unmarshal(step.Config, &cfg)

	to := strings.TrimSpace(e.interpolate(cfg.To, ctx.vars))
	if to == "" {
		// Fallback: lookup contact por JID/phone e pega email do CRM.
		to = e.lookupContactEmail(ctx)
	}
	if to == "" {
		log.Warn().Str("exec", ctx.execution.ID).Str("step", step.ID).
			Msg("journey: stepEmail sem destinatário (cfg.to vazio + contact sem email)")
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}

	subject := e.interpolate(cfg.Subject, ctx.vars)
	html := e.interpolate(cfg.BodyHTML, ctx.vars)
	text := e.interpolate(cfg.BodyText, ctx.vars)
	if html == "" && text != "" {
		html = "<pre style=\"font-family:inherit;white-space:pre-wrap;\">" + text + "</pre>"
	}
	if html == "" {
		log.Warn().Str("exec", ctx.execution.ID).Str("step", step.ID).
			Msg("journey: stepEmail sem body_html nem body_text")
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}

	ctx.emit(step.ID, string(step.Type), "email_send", map[string]interface{}{
		"to":      to,
		"subject": subject,
	})

	if ctx.simulate || e.email == nil {
		// Simulate ou email service não configurado — só loga e segue.
		log.Info().Str("to", to).Str("subject", subject).
			Msg("journey: stepEmail (simulate/no-svc) — não enviado")
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}

	// SyncSend devolve erro pra logarmos. Não bloqueamos a jornada
	// num erro de email (mesma política do stepHTTP) — apenas log.
	if err := e.email.SyncSend(to, subject, html, "journey"); err != nil {
		log.Warn().Err(err).
			Str("exec", ctx.execution.ID).Str("step", step.ID).Str("to", to).
			Msg("journey: stepEmail Maileroo retornou erro — segue flow")
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

// stepSMS — placeholder pra integração SMS. Hoje só loga; quando
// o provedor real (Twilio, Zenvia, etc) for plugado, o switch interno
// despacha por config.provider. Mantém a jornada funcional mesmo sem
// SMS configurado (não bloqueia).
//
// Config:
//   {
//     "to":       "{{contact.phone}}",
//     "text":     "Sua confirmação chegou!",
//     "provider": "twilio"   // future: twilio | zenvia | mock
//   }
func (e *JourneyExecutor) stepSMS(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		To       string `json:"to"`
		Text     string `json:"text"`
		Provider string `json:"provider"`
	}
	_ = json.Unmarshal(step.Config, &cfg)

	to := strings.TrimSpace(e.interpolate(cfg.To, ctx.vars))
	if to == "" {
		to = ctx.fromJID // phone do contact é o default
	}
	text := e.interpolate(cfg.Text, ctx.vars)

	ctx.emit(step.ID, string(step.Type), "sms_send", map[string]interface{}{
		"to":       to,
		"provider": cfg.Provider,
		"length":   len(text),
	})

	// Stub atual — quando integração real chegar, substituir por
	// dispatch baseado em cfg.Provider. Loga warn pro user saber que
	// step foi visitado mas nada saiu.
	log.Warn().
		Str("exec", ctx.execution.ID).
		Str("step", step.ID).
		Str("to", to).
		Str("provider", cfg.Provider).
		Int("text_len", len(text)).
		Msg("journey: stepSMS — placeholder, sem provider configurado (stub)")

	return ctx.flow.FindStep(step.NextStepID), false, nil
}

// lookupContactEmail busca o email do contato pelo phone (fromJID).
// Limita a 1 query por step. Retorna "" se o contato não existe ou
// não tem email cadastrado.
func (e *JourneyExecutor) lookupContactEmail(ctx *execCtx) string {
	if ctx.fromJID == "" {
		return ""
	}
	var ct models.Contact
	q := e.db.Select("email").Where("phone = ?", ctx.fromJID)
	// Workspace context: jornada legada não tem ws_id, então
	// só usa user_id como fallback. Funciona pra cenários single-user.
	if ctx.journey.UserID != "" {
		q = q.Where("user_id = ?", ctx.journey.UserID)
	}
	if err := q.First(&ct).Error; err != nil {
		return ""
	}
	return strings.TrimSpace(ct.Email)
}

// interpolateLog — helper pra logs (limita string longa).
func _truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return fmt.Sprintf("%s…(+%d)", s[:n], len(s)-n)
}

// uso supressor — sem o _ o linter reclama
var _ = _truncate
