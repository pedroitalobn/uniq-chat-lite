package handlers

import (
	"strings"
)

// canonicalEmail retorna a forma canônica do email pra dedup contra
// truques de aliasing (Gmail dot-trick + plus addressing).
//
//   "i.v.em.a.b.uke.r.u.y.24+x@gmail.com" → "ivemabukeruy24@gmail.com"
//   "User+tag@Outlook.com"                → "user@outlook.com"
//
// Mantemos sempre o email original em users.email pra envio; usamos o
// canonical APENAS pra impedir N contas na mesma caixa real.
func canonicalEmail(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return email
	}
	local := email[:at]
	domain := email[at+1:]
	// + addressing: corta tudo depois do +
	if plus := strings.Index(local, "+"); plus >= 0 {
		local = local[:plus]
	}
	// Gmail / googlemail tratam pontos como invisíveis no local part.
	if domain == "gmail.com" || domain == "googlemail.com" {
		local = strings.ReplaceAll(local, ".", "")
		domain = "gmail.com"
	}
	return local + "@" + domain
}

// suspiciousSignupName detecta nomes claramente gerados por bot.
//
// Bots ativos no /register em 2026-04-27 usaram exatamente este padrão:
//   "LooWGMQeRIodGtJtmdHmUJlN", "SvafpmFWbjGMOFkVHi", "tIwVSUbGUEiUjhybDcAIdx"
//
// Heurística: nome sem espaço (single token) com >= 12 chars e proporção
// alta de alternância maiúscula/minúscula (humano escreve "Leonardo Lyra",
// não "tIwVSUbGUEiUjhybDcAIdx"). Pra evitar falsos positivos com "John",
// só barra quando os 3 sinais batem juntos.
func suspiciousSignupName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	// Tem espaço → assume humano (Nome Sobrenome).
	if strings.ContainsAny(name, " \t") {
		return ""
	}
	if len(name) < 12 {
		return ""
	}
	// Conta transições case e proporção de letras.
	transitions := 0
	letters := 0
	prevUpper := -1
	for _, r := range name {
		switch {
		case r >= 'A' && r <= 'Z':
			if prevUpper == 0 {
				transitions++
			}
			prevUpper = 1
			letters++
		case r >= 'a' && r <= 'z':
			if prevUpper == 1 {
				transitions++
			}
			prevUpper = 0
			letters++
		default:
			prevUpper = -1
		}
	}
	// >= 6 transições caseMix em <= 24 chars sem espaço = não é nome humano.
	if transitions >= 6 && letters >= 12 {
		return "nome inválido — preencha seu nome real"
	}
	return ""
}

// suspiciousSignupEmail rejeita padrões clássicos de signup automatizado
// observados em ataques de massa. Retorna mensagem explicativa se barrar.
//
// Lista NÃO é definitiva — atualize via dataset depois (`disposable_domains`
// table). Pra ataque ativo, melhor ter falsos positivos do que liberar.
func suspiciousSignupEmail(email string) string {
	email = strings.ToLower(email)
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return "email inválido"
	}
	local := email[:at]
	domain := email[at+1:]

	// 1. Domínios descartáveis comuns (mailinator/tempmail/etc).
	for _, d := range disposableDomains {
		if domain == d {
			return "email descartável não é permitido"
		}
	}

	// 2. Local part com excesso de pontos é tipicamente Gmail dot-trick
	//    pra burlar dedup. Humano não digita "i.v.em.a.b.uke.r.u.y" no email.
	if domain == "gmail.com" || domain == "googlemail.com" {
		dots := strings.Count(local, ".")
		clean := strings.ReplaceAll(local, ".", "")
		if dots >= 4 && len(clean) > 0 {
			// Mais pontos que necessário pra qualquer formato razoável.
			return "padrão de email suspeito"
		}
	}

	// 3. Local part muito curto (< 3 chars) ou só dígitos.
	cleanLocal := strings.ReplaceAll(strings.ReplaceAll(local, ".", ""), "+", "")
	if len(cleanLocal) < 3 {
		return "email inválido"
	}
	return ""
}

// disposableDomains — lista curta dos mais comuns. Tem milhares na natureza;
// pra resposta rápida, bloqueamos os top abusados. Expandir via dataset.
var disposableDomains = []string{
	"mailinator.com",
	"tempmail.com",
	"temp-mail.org",
	"10minutemail.com",
	"guerrillamail.com",
	"guerrillamail.info",
	"yopmail.com",
	"trashmail.com",
	"throwawaymail.com",
	"fakeinbox.com",
	"sharklasers.com",
	"getnada.com",
	"maildrop.cc",
	"dispostable.com",
	"mintemail.com",
	"emailondeck.com",
	"mohmal.com",
	"tempinbox.com",
}
