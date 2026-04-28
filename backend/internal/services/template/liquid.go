// Package template — engine de Liquid templates para mensagens em
// jornadas, campanhas e templates de WhatsApp. Inspirado em Customer.io.
//
// Sintaxe suportada:
//   {{ contact.name }}                   — variáveis simples
//   {% if contact.tags contains "vip" %} — condicional
//   {% for p in products %} ... {% endfor %} — loops
//   {{ contact.created_at | date: "%d/%m/%Y" }} — filtros nativos do Liquid
//
// Sandbox: nada de I/O, sem includes, sem `assign` em escopo global.
package template

import (
	"github.com/osteele/liquid"
)

var engine = liquid.NewEngine()

// Render aplica Liquid sobre `tpl` com `vars` como contexto.
// Falha graciosamente: se template inválido, devolve o original com
// erro. Caller decide se aborta o envio ou usa fallback.
func Render(tpl string, vars map[string]any) (string, error) {
	if tpl == "" {
		return "", nil
	}
	out, err := engine.ParseAndRenderString(tpl, vars)
	if err != nil {
		return tpl, err
	}
	return out, nil
}

// MustRender — render que nunca falha; usa template original em erro.
// Útil em fast-path onde abortar a mensagem por typo no template é pior
// que mandar com placeholder visível.
func MustRender(tpl string, vars map[string]any) string {
	out, err := Render(tpl, vars)
	if err != nil {
		return tpl
	}
	return out
}
