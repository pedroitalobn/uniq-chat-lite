package email

import "fmt"

// Qchat brand — tema escuro da aplicação, accent verde.
// HSL da UI convertido pra hex pq vários clientes de email ignoram hsl().
const (
	BrandPrimary   = "#2563EB" // Uniq green
	BrandSecondary = "#1D4ED8" // Green darker (hover)
	BrandAccent    = "#2563EB" // Same as primary
	BrandWarning   = "#fb923c" // Orange
	BrandDanger    = "#ef4444" // Red
	BrandDark      = "#e8e9ed" // hsl(240 15% 92%) — texto primário no escuro
	BrandGray      = "#85868f" // hsl(240 8% 55%) — texto secundário
	BrandMuted     = "#5a5b63" // hsl(240 8% 40%) — texto terciário
	BrandBg        = "#0a0a0f" // body background
	BrandCard      = "#0d0e14" // hsl(240 18% 6%) — card principal
	BrandCardAlt   = "#13141b" // card secundário (levemente mais claro)
	BrandBorder    = "#1e2028" // hsl(240 12% 13%) — borda
)

// Base template dark. Inline styles pq clientes de email (Gmail, Outlook)
// podem ignorar <style> ou regras complexas. Table-based layout pra
// compatibilidade com Outlook/Apple Mail.
func baseTemplate(appName, appURL, accentColor, content string) string {
	year := "2026"
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>%s</title>
</head>
<body style="margin:0;padding:0;background-color:%s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:%s;">
  <table width="100%%" cellpadding="0" cellspacing="0" role="presentation" style="background:%s;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%%;background:%s;border:1px solid %s;border-radius:16px;overflow:hidden;">
        <!-- Header: logomark + wordmark -->
        <tr><td style="padding:28px 32px 0;">
          <table cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="vertical-align:middle;">
                <div style="display:inline-block;width:32px;height:32px;background:%s;border-radius:8px;text-align:center;line-height:32px;font-size:16px;font-weight:700;color:#0a0a0f;">U</div>
              </td>
              <td style="padding-left:10px;vertical-align:middle;">
                <span style="font-size:15px;font-weight:600;color:%s;letter-spacing:-0.2px;">%s</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Accent line -->
        <tr><td style="padding:20px 32px 0;">
          <div style="height:1px;background:%s;"></div>
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:28px 32px 36px;">
          %s
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:%s;padding:20px 32px;border-top:1px solid %s;">
          <table width="100%%" cellpadding="0" cellspacing="0" role="presentation">
            <tr><td align="center">
              <p style="margin:0 0 6px;font-size:12px;color:%s;">&copy; %s %s — todos os direitos reservados.</p>
              <p style="margin:0;font-size:12px;color:%s;">
                <a href="%s" style="color:%s;text-decoration:none;">%s</a>
                <span style="color:%s;margin:0 6px;">·</span>
                <a href="%s/unsubscribe" style="color:%s;text-decoration:none;">Preferências de email</a>
              </p>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:%s;text-align:center;max-width:560px;">
        Você está recebendo este email porque sua conta está vinculada ao %s.
      </p>
    </td></tr>
  </table>
</body>
</html>`,
		appName,
		BrandBg, BrandDark,
		BrandBg,
		BrandCard, BrandBorder,
		accentColor, BrandDark, appName,
		BrandBorder,
		content,
		BrandCardAlt, BrandBorder,
		BrandGray, year, appName,
		BrandGray,
		appURL, BrandPrimary, appURL,
		BrandMuted,
		appURL, BrandGray,
		BrandMuted, appName,
	)
}

// Helper functions — todos com estilos inline no tema escuro.
func h1(text string) string {
	return fmt.Sprintf(`<h1 style="margin:0 0 14px;color:%s;font-size:24px;font-weight:700;line-height:1.25;letter-spacing:-0.3px;">%s</h1>`, BrandDark, text)
}

func h2(text string) string {
	return fmt.Sprintf(`<h2 style="margin:0 0 12px;color:%s;font-size:18px;font-weight:600;line-height:1.3;">%s</h2>`, BrandDark, text)
}

func h3(text string) string {
	return fmt.Sprintf(`<h3 style="margin:0 0 10px;color:%s;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">%s</h3>`, BrandGray, text)
}

func p(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 14px;color:%s;font-size:15px;line-height:1.6;">%s</p>`, BrandDark, text)
}

func pSmall(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 8px;color:%s;font-size:13px;line-height:1.55;">%s</p>`, BrandGray, text)
}

// btn — CTA arredondado (rounded-xl = 12px) matching o tema da app.
// bgColor pode ser sobrescrito por template (ex: vermelho pra ações destrutivas).
// Quando é verde Uniq, forçamos texto preto (contrast ratio).
func btn(label, href, bgColor string) string {
	textColor := "#ffffff"
	if bgColor == BrandPrimary || bgColor == BrandSecondary {
		textColor = "#0a0a0f"
	}
	return fmt.Sprintf(`<table cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;"><tr><td align="left">
    <a href="%s" style="display:inline-block;background:%s;color:%s;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:12px;letter-spacing:-0.1px;">%s</a>
  </td></tr></table>`, href, bgColor, textColor, label)
}

// card — bloco secundário com fundo levemente mais claro + borda sutil.
func card(content string) string {
	return fmt.Sprintf(`<div style="background:%s;border:1px solid %s;border-radius:12px;padding:18px 20px;margin:14px 0;">%s</div>`, BrandCardAlt, BrandBorder, content)
}

func infoItem(label, value string) string {
	return fmt.Sprintf(`<p style="margin:6px 0;color:%s;font-size:14px;line-height:1.5;"><span style="color:%s;font-weight:500;">%s:</span> %s</p>`, BrandDark, BrandGray, label, value)
}

// highlightBox — caixa de atenção/aviso. Usa bgColor semi-transparente.
// No tema escuro, bg claro demais fica ruim — usa um tint da cor over dark.
func highlightBox(content string, bgColor string) string {
	// Para manter legibilidade no escuro, usamos a cor de borda (não fundo)
	// e mantemos background do card secundário.
	return fmt.Sprintf(`<div style="background:%s;border-left:3px solid %s;border-radius:8px;padding:14px 16px;margin:14px 0;">%s</div>`, BrandCardAlt, bgColor, content)
}

func iconEmoji(emoji string) string {
	return fmt.Sprintf(`<div style="font-size:28px;line-height:1;margin:0 0 14px;">%s</div>`, emoji)
}

func divider() string {
	return fmt.Sprintf(`<div style="margin:20px 0;height:1px;background:%s;"></div>`, BrandBorder)
}

func listItem(text string) string {
	return fmt.Sprintf(`<p style="margin:6px 0;padding-left:16px;position:relative;color:%s;font-size:14px;line-height:1.55;">• %s</p>`, BrandDark, text)
}

// Helper para inline text em highlightBox — cor e tamanho padronizados no escuro.
func inlineP(text string) string {
	return fmt.Sprintf(`<p style="margin:0;color:%s;font-size:14px;line-height:1.55;">%s</p>`, BrandDark, text)
}

// codeBlock — valor monoespaçado (senha, código).
func codeBlock(value string) string {
	return fmt.Sprintf(`<code style="background:%s;padding:4px 10px;border-radius:6px;font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;color:%s;border:1px solid %s;">%s</code>`, BrandBg, BrandPrimary, BrandBorder, value)
}

// ── Welcome ───────────────────────────────────────────────────────────────────

// Convenção: TODAS as funções *HTML seguem (appName, appURL, name, ...).
// Inconsistências antes (ex: welcomeHTML(appName, name, appURL)) versus
// callers que sempre passavam (s.appName, s.appURL, name, ...) faziam
// emails sair com appURL no lugar do nome do user. Padronizado.
func welcomeHTML(appName, appURL, name string) string {
	content := iconEmoji("🎉") +
		h1("Bem-vindo ao "+appName) +
		p("Olá, <strong>"+name+"</strong>. Estamos felizes em ter você por aqui.") +
		p("Você acaba de dar o primeiro passo pra transformar a comunicação do seu negócio. Com o "+appName+" você pode:") +
		card(
			listItem("Gerenciar múltiplos números de WhatsApp em um só lugar")+
				listItem("Automatizar respostas e campanhas de mensagens")+
				listItem("Colaborar com sua equipe de forma eficiente")+
				listItem("Centralizar todas as conversas com seus clientes"),
		) +
		btn("Começar agora", appURL, BrandPrimary) +
		pSmall("💡 Dica: explore o painel de configurações para personalizar sua experiência.")
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// ── Password Changed ──────────────────────────────────────────────────────────

func passwordChangedHTML(appName, appURL, name string) string {
	content := iconEmoji("🔐") +
		h1("Senha alterada") +
		p("Olá, <strong>"+name+"</strong>.") +
		p("Sua senha foi alterada recentemente. Se você fez essa alteração, pode ignorar este email.") +
		highlightBox(
			inlineP("⚠️ <strong>Se você não reconhece essa alteração</strong>, entre em contato com nosso suporte imediatamente e troque sua senha."),
			BrandWarning,
		) +
		pSmall("Para sua segurança, use uma senha forte com pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas, números e símbolos.")
	return baseTemplate(appName, appURL, BrandWarning, content)
}

// ── Email Verification ────────────────────────────────────────────────────────

func emailVerificationHTML(appName, appURL, name, verifyLink string) string {
	content := iconEmoji("✉️") +
		h1("Confirme seu e-mail") +
		p("Olá, <strong>"+name+"</strong>. Bem-vindo ao "+appName+"!") +
		p("Pra ativar sua conta, confirme seu e-mail clicando no botão abaixo:") +
		btn("Confirmar e-mail", verifyLink, BrandPrimary) +
		highlightBox(
			inlineP("⏰ Este link expira em <strong>24 horas</strong>."),
			BrandWarning,
		) +
		divider() +
		pSmall("Se você não criou esta conta, pode ignorar este email — a conta será removida automaticamente.")
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// ── Forgot Password ───────────────────────────────────────────────────────────

func forgotPasswordHTML(appName, appURL, name, resetLink string) string {
	content := iconEmoji("🔑") +
		h1("Redefinir sua senha") +
		p("Olá, <strong>"+name+"</strong>.") +
		p("Recebemos uma solicitação pra redefinir a senha da sua conta. Clique no botão abaixo pra criar uma nova senha:") +
		btn("Redefinir senha", resetLink, BrandPrimary) +
		highlightBox(
			inlineP("⏰ Este link expira em <strong>1 hora</strong>."),
			BrandWarning,
		) +
		divider() +
		pSmall("Se você não solicitou a redefinição, pode ignorar este email com segurança. Sua conta permanece protegida.")
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// ── Payment Confirmed ─────────────────────────────────────────────────────────

func paymentConfirmedHTML(appName, appURL, name, planName string, amount float64) string {
	amountStr := fmt.Sprintf("R$ %.2f", amount)
	content := iconEmoji("🎊") +
		h1("Pagamento confirmado") +
		p("Olá, <strong>"+name+"</strong>. Obrigado por escolher o "+appName+".") +
		card(
			h3("Resumo do pagamento")+
				infoItem("Plano", planName)+
				infoItem("Valor", amountStr)+
				infoItem("Status", "<span style=\"color:"+BrandPrimary+";font-weight:600;\">✓ Confirmado</span>"),
		) +
		p("Todos os recursos do plano <strong>"+planName+"</strong> já estão disponíveis na sua conta.") +
		btn("Acessar painel", appURL+"/dashboard", BrandPrimary)
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// ── Plan Changed ──────────────────────────────────────────────────────────────

func planChangedHTML(appName, appURL, name, oldPlan, newPlan string) string {
	content := iconEmoji("⬆️") +
		h1("Plano atualizado") +
		p("Olá, <strong>"+name+"</strong>.") +
		card(
			h3("Alteração de plano")+
				infoItem("De", oldPlan)+
				infoItem("Para", newPlan),
		) +
		p("As novas funcionalidades e recursos já estão disponíveis na sua conta.") +
		btn("Ver novos recursos", appURL+"/settings", BrandPrimary)
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// ── Payment Failed ────────────────────────────────────────────────────────────

func paymentFailedHTML(appName, appURL, name, billingURL string) string {
	content := iconEmoji("⚠️") +
		h1("Pagamento não processado") +
		p("Olá, <strong>"+name+"</strong>.") +
		p("Não conseguimos processar o pagamento da sua assinatura. Pode ter acontecido por:") +
		card(
			listItem("Cartão de crédito expirado ou bloqueado")+
				listItem("Saldo insuficiente")+
				listItem("Limite do cartão excedido")+
				listItem("Dados do cartão incorretos"),
		) +
		p("Por favor, atualize seus dados de pagamento pra manter o acesso aos recursos do seu plano:") +
		btn("Atualizar pagamento", billingURL, BrandDanger) +
		divider() +
		pSmall("Se você acredita que houve um erro, responda este email e nosso suporte ajuda.")
	return baseTemplate(appName, appURL, BrandDanger, content)
}

// ── Subscription Canceled ─────────────────────────────────────────────────────

func subscriptionCanceledHTML(appName, appURL, name, plansURL string) string {
	content := iconEmoji("👋") +
		h1("Assinatura cancelada") +
		p("Olá, <strong>"+name+"</strong>.") +
		p("Sua assinatura do "+appName+" foi cancelada. Sentimos muito ver você partir.") +
		highlightBox(
			inlineP("Você continuará tendo acesso aos recursos do seu plano até o final do período já pago."),
			BrandGray,
		) +
		p("Se mudou de ideia ou quiser reativar no futuro, estamos aqui.") +
		btn("Ver planos disponíveis", plansURL, BrandPrimary) +
		divider() +
		pSmall("Cancelou por engano ou precisa de ajuda? Responda este email — retornamos em até 24h.")
	return baseTemplate(appName, appURL, BrandGray, content)
}

// ── Instance Banned ───────────────────────────────────────────────────────────

func instanceBannedHTML(appName, appURL, name, instanceName, phone string) string {
	content := iconEmoji("🚫") +
		h1("Instância banida") +
		p("Olá, <strong>"+name+"</strong>.") +
		p("Uma das suas instâncias foi banida pela plataforma de mensagens. Isso geralmente acontece por violação dos termos de uso.") +
		card(
			h3("Detalhes da instância")+
				infoItem("Nome", instanceName)+
				infoItem("Número", phone),
		) +
		p("Pra entender o motivo específico e próximos passos, fale com nosso suporte.") +
		btn("Falar com suporte", appURL+"/support", BrandPrimary) +
		divider() +
		pSmall("Recomendamos revisar nossas políticas de uso pra evitar novos banimentos.")
	return baseTemplate(appName, appURL, BrandDanger, content)
}

// ── Admin Created Account ─────────────────────────────────────────────────────

func adminCreatedAccountHTML(appName, appURL, name, email, tempPassword string) string {
	content := iconEmoji("👋") +
		h1("Sua conta foi criada") +
		p("Olá, <strong>"+name+"</strong>. Um administrador criou uma conta pra você no "+appName+".") +
		card(
			h3("Credenciais de acesso")+
				infoItem("Email", email)+
				infoItem("Senha temporária", codeBlock(tempPassword)),
		) +
		btn("Acessar minha conta", appURL, BrandPrimary) +
		highlightBox(
			inlineP("⚠️ Por segurança, altere sua senha imediatamente após o primeiro acesso."),
			BrandWarning,
		)
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// ── Admin Reset Password ──────────────────────────────────────────────────────

// Assinatura segue o padrão dos outros templates (appName, appURL, ...)
// pra evitar bugs como "olá <strong>https://app.uniq.chat</strong>" que
// rolaram quando o caller passava parâmetros na ordem errada.
func adminResetPasswordHTML(appName, appURL, name, newPassword string) string {
	content := iconEmoji("🔐") +
		h1("Senha redefinida") +
		p("Olá, <strong>"+name+"</strong>.") +
		p("Um administrador redefiniu a senha da sua conta no "+appName+". Sua nova senha temporária é:") +
		card(
			fmt.Sprintf(`<p style="margin:0;text-align:center;font-size:22px;font-weight:700;letter-spacing:2px;color:%s;padding:8px 0;font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;">%s</p>`, BrandPrimary, newPassword),
		) +
		highlightBox(
			inlineP("⚠️ Por segurança, altere sua senha assim que fizer login."),
			BrandWarning,
		)
	return baseTemplate(appName, appURL, BrandWarning, content)
}

// ── Workspace Invite ──────────────────────────────────────────────────────────

func workspaceInviteHTML(appName, appURL, workspaceName, inviterName, roleName, acceptURL string, userExists bool) string {
	intro := p("<strong>" + inviterName + "</strong> convidou você pra colaborar no workspace <strong>" + workspaceName + "</strong> no " + appName + ".")
	cta := p("Clique no botão abaixo pra aceitar o convite e começar a colaborar:")
	if userExists {
		// User já tem conta: deixa explícito que basta logar e que o convite
		// também aparece in-app, evitando o "preciso me cadastrar de novo?"
		intro = p("<strong>"+inviterName+"</strong> convidou você pra colaborar no workspace <strong>"+workspaceName+"</strong> no "+appName+".") +
			highlightBox(
				inlineP("✅ Você já tem conta no "+appName+" com este email — basta <strong>fazer login</strong> pra aceitar o convite. Ele também já aparece no banner do seu painel."),
				BrandPrimary,
			)
		cta = p("Faça login com seu email já cadastrado e clique em aceitar:")
	}
	content := iconEmoji("🎉") +
		h1("Você foi convidado") +
		intro +
		card(
			h3("Detalhes do convite")+
				infoItem("Workspace", workspaceName)+
				infoItem("Função", roleName)+
				infoItem("Convidado por", inviterName),
		) +
		cta +
		btn("Aceitar convite", acceptURL, BrandPrimary) +
		highlightBox(
			inlineP("⏰ Este convite expira em <strong>7 dias</strong>."),
			BrandWarning,
		) +
		divider() +
		pSmall("Se você não esperava este convite, pode ignorar este email com segurança.") +
		fmt.Sprintf(`<p style="margin:12px 0 0;color:%s;font-size:12px;line-height:1.5;">Se o botão não funcionar, copie este link no navegador:<br><span style="color:%s;word-break:break-all;">%s</span></p>`, BrandMuted, BrandPrimary, acceptURL)
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// Magic link registration email.
func magicLinkHTML(appName, appURL, magicURL string) string {
	content := iconEmoji("✨") +
		h1("Confirme seu email") +
		p("Clique no botão abaixo pra verificar seu endereço e continuar criando sua conta no <strong>" + appName + "</strong>.") +
		btn("Confirmar e continuar", magicURL, BrandPrimary) +
		highlightBox(
			inlineP("⏰ Este link expira em <strong>30 minutos</strong> e é de uso único."),
			BrandWarning,
		) +
		divider() +
		pSmall("Se você não solicitou este email, pode ignorá-lo com segurança. Nenhuma conta foi criada.") +
		fmt.Sprintf(`<p style="margin:12px 0 0;color:%s;font-size:12px;line-height:1.5;">Se o botão não funcionar, copie este link no navegador:<br><span style="color:%s;word-break:break-all;">%s</span></p>`, BrandMuted, BrandPrimary, magicURL)
	return baseTemplate(appName, appURL, BrandPrimary, content)
}

// Test email — template mínimo pra validar config Maileroo.
func TestHTML(appName string) string {
	content := iconEmoji("✉️") +
		h1("Email de teste") +
		p("Este é um email de teste do <strong>"+appName+"</strong>. Se você recebeu, a configuração está funcionando.") +
		p("Pra personalizar os templates, vá em Configurações → Email no painel de administração.")
	return baseTemplate(appName, "https://uniq.chat", BrandPrimary, content)
}

// ── Admin billing link ────────────────────────────────────────────────────

// billingLinkHTML — email enviado quando admin gera link de cobrança pra
// user que estava num plano pago sem ter assinatura ativa, ou pra trocar
// de plano. CTA principal é o link de checkout pré-configurado pelo admin.
func billingLinkHTML(appName, appURL, name, planName string, planPrice float64, billingURL string) string {
	priceStr := fmt.Sprintf("R$ %.2f / mês", planPrice)
	content := iconEmoji("💳") +
		h1("Hora de ativar sua assinatura") +
		p("Olá, <strong>"+name+"</strong>. Sua conta no "+appName+" está usando o plano <strong>"+planName+"</strong> e precisa de uma forma de pagamento ativa pra continuar com todos os recursos.") +
		card(
			h3("Resumo")+
				infoItem("Plano", planName)+
				infoItem("Valor", priceStr)+
				infoItem("Pagamento", "Cartão de crédito via Stripe (seguro)"),
		) +
		p("Clique no botão abaixo pra concluir o pagamento em poucos segundos:") +
		btn("Ativar assinatura", billingURL, BrandPrimary) +
		highlightBox(
			inlineP("⏰ O link expira em 24 horas. Se precisar de outro, peça pro admin gerar novamente."),
			BrandWarning,
		) +
		divider() +
		pSmall("Dúvidas sobre o pagamento? Responda este email — nosso time vai te ajudar.") +
		fmt.Sprintf(`<p style="margin:12px 0 0;color:%s;font-size:12px;line-height:1.5;">Se o botão não funcionar, copie este link no navegador:<br><span style="color:%s;word-break:break-all;">%s</span></p>`, BrandMuted, BrandPrimary, billingURL)
	return baseTemplate(appName, appURL, BrandPrimary, content)
}
