package email

import "fmt"

// Brand colors
const (
	BrandPrimary   = "#6366f1" // Indigo
	BrandSecondary = "#818cf8" // Light indigo
	BrandAccent    = "#22c55e" // Green for success
	BrandWarning   = "#f59e0b" // Orange for warning
	BrandDanger    = "#ef4444" // Red for danger
	BrandDark      = "#1e293b" // Dark text
	BrandGray      = "#64748b" // Gray text
	BrandLight     = "#f8fafc" // Light background
)

// Modern base template with professional SaaS styling
func baseTemplate(appName, appURL, headerColor, content string) string {
	year := "2026"
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -1px rgba(0,0,0,0.06);">
        <!-- Header with brand -->
        <tr><td style="background:%s;padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">%s</h1>
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:40px;">
          %s
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <table width="100%%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <p style="margin:0 0 8px;font-size:12px;color:#64748b;">&copy; %s %s. Todos os direitos reservados.</p>
                <p style="margin:0;">
                  <a href="%s/unsubscribe" style="font-size:12px;color:#6366f1;text-decoration:underline;">Gerenciar preferências</a>
                  <span style="color:#cbd5e1;margin:0 8px;">|</span>
                  <a href="%s" style="font-size:12px;color:#6366f1;text-decoration:underline;">Visitar site</a>
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`, appName, headerColor, appName, content, year, appName, appURL, appURL)
}

// Helper functions for consistent styling
func h1(text string) string {
	return fmt.Sprintf(`<h1 style="margin:0 0 16px;color:#1e293b;font-size:28px;font-weight:700;line-height:1.2;">%s</h1>`, text)
}

func h2(text string) string {
	return fmt.Sprintf(`<h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:600;line-height:1.3;">%s</h2>`, text)
}

func h3(text string) string {
	return fmt.Sprintf(`<h3 style="margin:0 0 12px;color:#1e293b;font-size:18px;font-weight:600;">%s</h3>`, text)
}

func p(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">%s</p>`, text)
}

func pSmall(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.5;">%s</p>`, text)
}

func btn(label, href, bgColor string) string {
	return fmt.Sprintf(`<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center">
    <a href="%s" style="display:inline-block;background:%s;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:10px;">%s</a>
  </td></tr></table>`, href, bgColor, label)
}

func card(content string) string {
	return fmt.Sprintf(`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:16px 0;">%s</div>`, content)
}

func infoItem(label, value string) string {
	return fmt.Sprintf(`<p style="margin:8px 0;color:#475569;font-size:14px;"><span style="color:#64748b;font-weight:500;">%s:</span> %s</p>`, label, value)
}

func highlightBox(content string, bgColor string) string {
	return fmt.Sprintf(`<div style="background:%s;border-radius:12px;padding:20px;margin:16px 0;">%s</div>`, bgColor, content)
}

func iconEmoji(emoji string) string {
	return fmt.Sprintf(`<span style="font-size:32px;display:block;margin-bottom:16px;">%s</span>`, emoji)
}

func divider() string {
	return `<div style="margin:24px 0;border-top:1px solid #e2e8f0;"></div>`
}

func listItem(text string) string {
	return fmt.Sprintf(`<p style="margin:8px 0;padding-left:20px;position:relative;color:#475569;font-size:14px;line-height:1.5;">%s</p>`, text)
}

// ── Welcome ───────────────────────────────────────────────────────────────────

func welcomeHTML(appName, name, appURL string) string {
	content := iconEmoji("🎉") +
		h1("Bem-vindo ao "+appName+"!") +
		p("Olá, <strong>"+name+"</strong>! Estamos muito felizes em ter você conosco.") +
		p("Você acaba de dar o primeiro passo para transformar a comunicação do seu negócio. Com o "+appName+" você pode:") +
		card(
			listItem("Gerenciar múltiplos números de WhatsApp em um só lugar")+
				listItem("Automatizar respostas e campanhas de mensagens")+
				listItem("Colaborar com sua equipe de forma eficiente")+
				listItem("Centralizar todas as conversas com seus clientes"),
		) +
		btn("Começar agora", appURL, BrandPrimary) +
		pSmall("💡 Dica: Explore o painel de configurações para personalizar sua experiência.")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandPrimary+","+BrandSecondary+")", content)
}

// ── Password Changed ──────────────────────────────────────────────────────────

func passwordChangedHTML(appName, name, appURL string) string {
	content := iconEmoji("🔐") +
		h1("Senha alterada com sucesso") +
		p("Olá, <strong>"+name+"</strong>!") +
		p("Sua senha foi alterada recentemente. Se você realizou essa alteração, pode ignorar este e-mail com tranquilidade.") +
		highlightBox(
			"<p style='margin:0;color:#475569;font-size:14px;'>⚠️ <strong>Se você não reconhece essa alteração</strong>, entre em contato com nosso suporte imediatamente. Recomendamos também alterar sua senha para uma nova imediatamente.</p>",
			"#fef3c7",
		) +
		pSmall("Para sua segurança, recomendamos usar uma senha forte com pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas, números e símbolos.")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandWarning+",#d97706)", content)
}

// ── Forgot Password ───────────────────────────────────────────────────────────

func forgotPasswordHTML(appName, name, appURL, resetLink string) string {
	content := iconEmoji("🔑") +
		h1("Redefinir sua senha") +
		p("Olá, <strong>"+name+"</strong>!") +
		p("Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha:") +
		btn("Redefinir senha", resetLink, BrandPrimary) +
		highlightBox(
			"<p style='margin:0;color:#475569;font-size:14px;'>⏰ Este link expira em <strong>1 hora</strong>.</p>",
			"#fef3c7",
		) +
		divider() +
		pSmall("Se você não solicitou a redefinição de senha, pode ignorar este e-mail com segurança. Sua conta permanece protegida.")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandPrimary+","+BrandSecondary+")", content)
}

// ── Payment Confirmed ─────────────────────────────────────────────────────────

func paymentConfirmedHTML(appName, name, appURL, planName string, amount float64) string {
	amountStr := fmt.Sprintf("R$ %.2f", amount)
	content := iconEmoji("🎊") +
		h1("Pagamento confirmado!") +
		p("Olá, <strong>"+name+"</strong>! Obrigado por escolher o "+appName+"!") +
		card(
			h3("Resumo do pagamento")+
				infoItem("Plano", planName)+
				infoItem("Valor", amountStr)+
				infoItem("Status", "<span style='color:#22c55e;font-weight:600;'>✓ Confirmado</span>"),
		) +
		p("Todos os recursos do plano <strong>"+planName+"</strong> já estão disponíveis na sua conta. Aproveite ao máximo!") +
		btn("Acessar painel", appURL+"/dashboard", BrandPrimary)
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandAccent+",#16a34a)", content)
}

// ── Plan Changed ──────────────────────────────────────────────────────────────

func planChangedHTML(appName, name, appURL, oldPlan, newPlan string) string {
	content := iconEmoji("⬆️") +
		h1("Seu plano foi atualizado") +
		p("Olá, <strong>"+name+"</strong>!") +
		card(
			h3("Alteração de plano")+
				infoItem("De", oldPlan)+
				infoItem("Para", newPlan),
		) +
		p("Seu plano foi atualizado com sucesso. As novas funcionalidades e recursos já estão disponíveis na sua conta.") +
		btn("Ver novos recursos", appURL+"/settings", BrandPrimary)
	return baseTemplate(appName, appURL, "linear-gradient(135deg,#8b5cf6,#a855f7)", content)
}

// ── Payment Failed ────────────────────────────────────────────────────────────

func paymentFailedHTML(appName, name, appURL, billingURL string) string {
	content := iconEmoji("⚠️") +
		h1("Pagamento não processado") +
		p("Olá, <strong>"+name+"</strong>!") +
		p("Não conseguimos processar o pagamento da sua assinatura. Isso pode ter acontecido por:") +
		card(
			listItem("Cartão de crédito expirado ou bloqueado")+
				listItem("Saldo insuficiente")+
				listItem("Limite do cartão excedido")+
				listItem("Dados do cartão incorretos"),
		) +
		p("Por favor, atualize seus dados de pagamento para manter o acesso a todos os recursos do seu plano:") +
		btn("Atualizar pagamento", billingURL, BrandDanger) +
		divider() +
		pSmall("Se você acredita que houve um erro, entre em contato com nosso suporte respondendo este e-mail.")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandDanger+",#dc2626)", content)
}

// ── Subscription Canceled ─────────────────────────────────────────────────────

func subscriptionCanceledHTML(appName, name, appURL, plansURL string) string {
	content := iconEmoji("😢") +
		h1("Assinatura cancelada") +
		p("Olá, <strong>"+name+"</strong>!") +
		p("Sua assinatura do "+appName+" foi cancelada. Sentimos muito ver você partir!") +
		highlightBox(
			"<p style='margin:0;color:#475569;font-size:14px;'>Você continuará tendo acesso aos recursos do seu plano até o final do período pago.</p>",
			"#f1f5f9",
		) +
		p("Se mudou de ideia ou quiser reativar sua assinatura no futuro, estamos aqui!") +
		btn("Ver planos disponíveis", plansURL, BrandPrimary) +
		divider() +
		pSmall("Se cancelou por engano ou precisa de ajuda, responda este e-mail que retornaremos em até 24h.")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,#64748b,#475569)", content)
}

// ── Instance Banned ───────────────────────────────────────────────────────────

func instanceBannedHTML(appName, name, appURL, instanceName, phone string) string {
	content := iconEmoji("🚫") +
		h1("Instância banida") +
		p("Olá, <strong>"+name+"</strong>!") +
		p("Uma das suas instâncias foi banida pela plataforma de mensagens. Isso geralmente acontece por violação dos termos de uso.") +
		card(
			h3("Detalhes da instância")+
				infoItem("Nome", instanceName)+
				infoItem("Número", phone),
		) +
		p("Para entender o motivo específico e discutir os próximos passos, entre em contato com nosso suporte.") +
		btn("Falar com suporte", appURL+"/support", BrandPrimary) +
		divider() +
		pSmall("Recomendamos revisar nossas políticas de uso para evitar novos banimentos. Você pode encontrar as diretrizes em nosso site.")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandDanger+",#dc2626)", content)
}

// ── Admin Created Account ─────────────────────────────────────────────────────

func adminCreatedAccountHTML(appName, name, appURL, email, tempPassword string) string {
	content := iconEmoji("👋") +
		h1("Sua conta foi criada!") +
		p("Olá, <strong>"+name+"</strong>! Um administrador criou uma conta para você no "+appName+".") +
		card(
			h3("Suas credenciais de acesso")+
				infoItem("E-mail", email)+
				infoItem("Senha temporária", "<code style='background:#f1f5f9;padding:4px 8px;border-radius:4px;font-family:monospace;font-weight:600;'>"+tempPassword+"</code>"),
		) +
		btn("Acessar minha conta", appURL, BrandPrimary) +
		highlightBox(
			"<p style='margin:0;color:#475569;font-size:14px;'>⚠️ Por segurança, recomendamos alterar sua senha imediatamente após o primeiro acesso.</p>",
			"#fef3c7",
		)
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandPrimary+","+BrandSecondary+")", content)
}

// ── Admin Reset Password ──────────────────────────────────────────────────────

func adminResetPasswordHTML(appName, name, appURL, newPassword string) string {
	content := iconEmoji("🔐") +
		h1("Senha redefinida") +
		p("Olá, <strong>"+name+"</strong>!") +
		p("Um administrador redefiniu a senha da sua conta no "+appName+". Sua nova senha temporária é:") +
		card(
			"<p style='margin:0;text-align:center;font-size:24px;font-weight:700;letter-spacing:2px;color:#1e293b;padding:8px;'>"+newPassword+"</p>",
		) +
		highlightBox(
			"<p style='margin:0;color:#475569;font-size:14px;'>⚠️ Por segurança, altere sua senha assim que fizer login.</p>",
			"#fef3c7",
		)
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandWarning+",#d97706)", content)
}

// ── Workspace Invite ──────────────────────────────────────────────────────────

func workspaceInviteHTML(appName, appURL, workspaceName, inviterName, roleName, acceptURL string) string {
	content := iconEmoji("🎉") +
		h1("Você foi convidado!") +
		p("<strong>"+inviterName+"</strong> convidou você para colaborar no workspace <strong>"+workspaceName+"</strong> no "+appName+".") +
		card(
			h3("Detalhes do convite")+
				infoItem("Workspace", workspaceName)+
				infoItem("Função", roleName)+
				infoItem("Convidado por", inviterName),
		) +
		p("Clique no botão abaixo para aceitar o convite e começar a colaborar:") +
		btn("Aceitar convite", acceptURL, BrandPrimary) +
		highlightBox(
			"<p style='margin:0;color:#475569;font-size:14px;'>⏰ Este convite expira em <strong>7 dias</strong>.</p>",
			"#fef3c7",
		) +
		divider() +
		pSmall("Se você não esperava este convite ou não reconhece quem enviou, pode ignorar este e-mail com segurança.") +
		pSmall("Se o botão acima não funcionar, copie e cole este link no seu navegador: <br><span style='color:#6366f1;word-break:break-all;'>"+acceptURL+"</span>")
	return baseTemplate(appName, appURL, "linear-gradient(135deg,"+BrandPrimary+","+BrandSecondary+")", content)
}

// Test email - simple branded template
func TestHTML(appName string) string {
	content := iconEmoji("✉️") +
		h1("E-mail de teste") +
		p("Este é um e-mail de teste do "+appName+". Se você recebeu, a configuração está funcionando corretamente!") +
		p("Para personalizar os templates de e-mail, vá para Configurações → E-mail no painel de administração.")
	return baseTemplate(appName, "https://uniq.chat", "linear-gradient(135deg,"+BrandPrimary+","+BrandSecondary+")", content)
}
