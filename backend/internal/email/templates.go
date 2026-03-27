package email

import "fmt"

// baseTemplate wraps content in the shared email shell.
// headerColor: CSS color/gradient string for the header background.
func baseTemplate(appName, headerColor, content string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%%;">
        <tr><td style="background:%s;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">%s</h1>
        </td></tr>
        <tr><td style="background:#ffffff;padding:40px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          %s
          <hr style="border:none;border-top:1px solid #e8e8f0;margin:32px 0;">
          <p style="margin:0;font-size:12px;color:#9494a8;text-align:center;">&copy; 2025 %s &middot; Todos os direitos reservados</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`, headerColor, appName, content, appName)
}

func h2(text string) string {
	return fmt.Sprintf(`<h2 style="margin:0 0 8px;color:#1a1a2e;font-size:20px;font-weight:700;">%s</h2>`, text)
}

func greeting(name string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;color:#4a4a6a;font-size:15px;">Olá, <strong>%s</strong>!</p>`, name)
}

func p(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;color:#4a4a6a;font-size:15px;line-height:1.6;">%s</p>`, text)
}

func btn(label, href, bgColor string) string {
	return fmt.Sprintf(`<div style="text-align:center;margin:24px 0;">
    <a href="%s" style="display:inline-block;background:%s;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">%s</a>
  </div>`, href, bgColor, label)
}

func infoBox(content string) string {
	return fmt.Sprintf(`<div style="background:#f8f8fc;border-radius:8px;padding:16px 20px;margin:16px 0;">%s</div>`, content)
}

func infoRow(label, value string) string {
	return fmt.Sprintf(`<p style="margin:4px 0;color:#4a4a6a;font-size:14px;"><strong>%s:</strong> %s</p>`, label, value)
}

// ── Welcome ───────────────────────────────────────────────────────────────────

func welcomeHTML(appName, name, appURL string) string {
	content := greeting(name) +
		h2("Bem-vindo ao "+appName+"! 🎉") +
		p("Estamos muito felizes em ter você aqui. Sua conta foi criada com sucesso e você já pode começar a usar todos os recursos da plataforma.") +
		p("Com o "+appName+" você pode gerenciar conversas, automatizar mensagens e muito mais — tudo em um só lugar.") +
		btn("Acessar minha conta", appURL, "linear-gradient(135deg,#00d46a,#00b359)") +
		p("Se tiver qualquer dúvida, é só responder este e-mail. Estamos aqui para ajudar!")
	return baseTemplate(appName, "linear-gradient(135deg,#00d46a,#00b359)", content)
}

// ── Password Changed ──────────────────────────────────────────────────────────

func passwordChangedHTML(appName, name string) string {
	content := greeting(name) +
		h2("Senha alterada com sucesso") +
		p("Sua senha foi alterada recentemente. Se foi você quem fez essa alteração, pode ignorar este e-mail.") +
		p("Se você <strong>não reconhece</strong> essa alteração, entre em contato conosco imediatamente respondendo este e-mail.") +
		infoBox(`<p style="margin:0;color:#4a4a6a;font-size:14px;">⚠️ Por segurança, recomendamos usar uma senha forte e única para sua conta.</p>`)
	return baseTemplate(appName, "linear-gradient(135deg,#f9c74f,#f4a261)", content)
}

// ── Forgot Password ───────────────────────────────────────────────────────────

func forgotPasswordHTML(appName, name, resetLink string) string {
	content := greeting(name) +
		h2("Redefinir sua senha") +
		p("Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha:") +
		btn("Redefinir senha", resetLink, "linear-gradient(135deg,#4361ee,#3a86ff)") +
		p("Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição de senha, pode ignorar este e-mail com segurança.") +
		infoBox(`<p style="margin:0;color:#4a4a6a;font-size:14px;">🔒 Nunca compartilhe este link com ninguém.</p>`)
	return baseTemplate(appName, "linear-gradient(135deg,#4361ee,#3a86ff)", content)
}

// ── Payment Confirmed ─────────────────────────────────────────────────────────

func paymentConfirmedHTML(appName, name, planName string, amount float64) string {
	amountStr := fmt.Sprintf("R$ %.2f", amount)
	content := greeting(name) +
		h2("Pagamento confirmado! ✅") +
		p("Seu pagamento foi processado com sucesso. Obrigado por assinar o "+appName+"!") +
		infoBox(
			infoRow("Plano", planName)+
				infoRow("Valor", amountStr)+
				infoRow("Status", "Confirmado"),
		) +
		p("Todos os recursos do plano <strong>"+planName+"</strong> já estão disponíveis na sua conta.")
	return baseTemplate(appName, "linear-gradient(135deg,#00d46a,#00b359)", content)
}

// ── Plan Changed ──────────────────────────────────────────────────────────────

func planChangedHTML(appName, name, oldPlan, newPlan string) string {
	content := greeting(name) +
		h2("Seu plano foi atualizado") +
		p("Seu plano no "+appName+" foi atualizado com sucesso.") +
		infoBox(
			infoRow("Plano anterior", oldPlan)+
				infoRow("Novo plano", newPlan),
		) +
		p("As novas funcionalidades já estão disponíveis na sua conta. Aproveite!")
	return baseTemplate(appName, "linear-gradient(135deg,#7209b7,#a855f7)", content)
}

// ── Payment Failed ────────────────────────────────────────────────────────────

func paymentFailedHTML(appName, name, billingURL string) string {
	content := greeting(name) +
		h2("Falha no pagamento ⚠️") +
		p("Não conseguimos processar o pagamento da sua assinatura. Isso pode acontecer por saldo insuficiente, cartão expirado ou limite excedido.") +
		p("Por favor, atualize seus dados de pagamento para manter o acesso aos recursos do seu plano:") +
		btn("Atualizar pagamento", billingURL, "linear-gradient(135deg,#ef233c,#d62839)") +
		p("Se você acredita que houve um erro, entre em contato com o suporte respondendo este e-mail.")
	return baseTemplate(appName, "linear-gradient(135deg,#ef233c,#d62839)", content)
}

// ── Subscription Canceled ─────────────────────────────────────────────────────

func subscriptionCanceledHTML(appName, name, plansURL string) string {
	content := greeting(name) +
		h2("Assinatura cancelada") +
		p("Sua assinatura do "+appName+" foi cancelada. Sentimos muito ver você partir!") +
		p("Você continuará tendo acesso aos recursos do seu plano até o final do período pago.") +
		p("Se mudar de ideia ou quiser reativar sua assinatura, estamos aqui:") +
		btn("Ver planos disponíveis", plansURL, "linear-gradient(135deg,#6b7280,#4b5563)") +
		p("Se cancelou por engano ou precisa de ajuda, responda este e-mail.")
	return baseTemplate(appName, "linear-gradient(135deg,#6b7280,#4b5563)", content)
}

// ── Instance Banned ───────────────────────────────────────────────────────────

func instanceBannedHTML(appName, name, instanceName, phone string) string {
	content := greeting(name) +
		h2("Instância banida 🚫") +
		p("Uma das suas instâncias foi banida pela plataforma de mensagens. Isso geralmente acontece por violação dos termos de uso.") +
		infoBox(
			infoRow("Instância", instanceName)+
				infoRow("Número", phone),
		) +
		p("Entre em contato com o suporte para entender o motivo e discutir os próximos passos. Recomendamos revisar as boas práticas de envio de mensagens para evitar novos banimentos.")
	return baseTemplate(appName, "linear-gradient(135deg,#ef233c,#d62839)", content)
}

// ── Admin Created Account ─────────────────────────────────────────────────────

func adminCreatedAccountHTML(appName, name, email, tempPassword, appURL string) string {
	content := greeting(name) +
		h2("Sua conta foi criada") +
		p("Um administrador criou uma conta para você no "+appName+". Use as credenciais abaixo para fazer seu primeiro acesso:") +
		infoBox(
			infoRow("E-mail", email)+
				infoRow("Senha temporária", "<code style='background:#e8e8f0;padding:2px 6px;border-radius:4px;font-family:monospace;'>"+tempPassword+"</code>"),
		) +
		btn("Acessar minha conta", appURL, "linear-gradient(135deg,#4361ee,#3a86ff)") +
		p("⚠️ Por segurança, recomendamos alterar sua senha imediatamente após o primeiro acesso.")
	return baseTemplate(appName, "linear-gradient(135deg,#4361ee,#3a86ff)", content)
}

// ── Admin Reset Password ──────────────────────────────────────────────────────

func adminResetPasswordHTML(appName, name, newPassword string) string {
	content := greeting(name) +
		h2("Senha redefinida pelo administrador") +
		p("Um administrador redefiniu a senha da sua conta no "+appName+". Sua nova senha temporária é:") +
		infoBox(
			`<p style="margin:0;color:#4a4a6a;font-size:16px;text-align:center;"><code style="background:#fff;padding:8px 16px;border-radius:6px;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:1px;">` + newPassword + `</code></p>`,
		) +
		p("⚠️ Por segurança, altere sua senha assim que fizer login.")
	return baseTemplate(appName, "linear-gradient(135deg,#f4a261,#e76f51)", content)
}
