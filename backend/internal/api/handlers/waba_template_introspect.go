package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/uniq-chat/backend/internal/models"
)

// WABATemplateDefinition — reflexão estruturada do que a Meta devolve quando
// consultamos /message_templates. Só extraímos o que precisamos pra validar
// envio: formato do header (IMAGE/VIDEO/DOCUMENT/TEXT/none) e quantidade de
// variáveis no body. O resto fica no objeto Meta cru pra debug.
type WABATemplateDefinition struct {
	Name         string                   `json:"name"`
	Language     string                   `json:"language"`
	Status       string                   `json:"status"`
	Category     string                   `json:"category"`
	Components   []map[string]interface{} `json:"components"`
	HeaderFormat string                   `json:"-"` // "" | "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT" | "LOCATION"
	BodyVarCount int                      `json:"-"` // qtd de {{N}} no body — pra checar parameters
}

// FetchWABATemplate — busca a definição do template diretamente na Meta
// Graph API. Retorna 404 quando o template não existe, ou ErrTemplate*
// pros casos comuns. Idempotente, custa 1 request leve por chamada (cache
// em memória pode ser adicionado se virar gargalo, mas hoje é raro o
// suficiente: só roda no início do envio do campaign / antes do single
// send).
//
// O endpoint da Meta filtra por name e language: fica trivial achar o
// template certo mesmo com múltiplas variantes de idioma do mesmo nome.
func FetchWABATemplate(ctx context.Context, waba *models.WABAInstance, name, language string) (*WABATemplateDefinition, error) {
	if waba.AccessToken == "" || waba.WABABusinessID == "" {
		return nil, fmt.Errorf("waba sem credenciais")
	}
	if name == "" {
		return nil, fmt.Errorf("template name vazio")
	}
	graphURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s/message_templates?name=%s&limit=20&access_token=%s",
		waba.WABABusinessID, url.QueryEscape(name), url.QueryEscape(waba.AccessToken),
	)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, graphURL, nil)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("meta fetch template: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("meta fetch template status %d: %s", resp.StatusCode, truncateBody(string(body), 300))
	}
	var meta struct {
		Data []WABATemplateDefinition `json:"data"`
	}
	if err := json.Unmarshal(body, &meta); err != nil {
		return nil, fmt.Errorf("meta parse template: %w", err)
	}
	// Match exato por name+language. Se language vazio, pega o primeiro.
	var matched *WABATemplateDefinition
	for i := range meta.Data {
		if language == "" || strings.EqualFold(meta.Data[i].Language, language) {
			matched = &meta.Data[i]
			break
		}
	}
	if matched == nil {
		return nil, fmt.Errorf("template %s (%s) não encontrado na Meta", name, language)
	}
	matched.HeaderFormat, matched.BodyVarCount = analyzeComponents(matched.Components)
	return matched, nil
}

// analyzeComponents — varre os components do template e extrai o formato do
// header e a contagem de variáveis no body. Lógica:
//   • header.format ∈ {"IMAGE","VIDEO","DOCUMENT","TEXT","LOCATION"}
//   • body.text contém {{1}}, {{2}}, ... — contamos os índices únicos
//
// Variáveis nomeadas (suporte recente da Meta) também aparecem como
// {{name}} — caímos pro count de ocorrências de {{ pra cobrir os dois.
func analyzeComponents(comps []map[string]interface{}) (string, int) {
	headerFormat := ""
	bodyVars := 0
	for _, c := range comps {
		t, _ := c["type"].(string)
		switch strings.ToUpper(t) {
		case "HEADER":
			if f, ok := c["format"].(string); ok {
				headerFormat = strings.ToUpper(f)
			}
		case "BODY":
			text, _ := c["text"].(string)
			bodyVars = countTemplateVars(text)
		}
	}
	return headerFormat, bodyVars
}

// countTemplateVars — conta {{N}} ou {{name}} no texto. Usa varredura
// linear simples pra evitar regex (essa func roda 1× por send).
func countTemplateVars(text string) int {
	count := 0
	i := 0
	for i < len(text)-1 {
		if text[i] == '{' && text[i+1] == '{' {
			// Acha o fechamento }}
			end := strings.Index(text[i+2:], "}}")
			if end < 0 {
				return count
			}
			count++
			i += 2 + end + 2
			continue
		}
		i++
	}
	return count
}

// IsMediaHeader — true se o template precisa de header com mídia (IMAGE,
// VIDEO ou DOCUMENT). Usado pra validar TemplateHeaderURL antes de enviar.
func (t *WABATemplateDefinition) IsMediaHeader() bool {
	switch t.HeaderFormat {
	case "IMAGE", "VIDEO", "DOCUMENT":
		return true
	}
	return false
}

// HeaderParameterType — string usada como "type" e como key no parameter
// payload da Meta. Match 1:1 com header_format normalizado em lowercase.
func (t *WABATemplateDefinition) HeaderParameterType() string {
	return strings.ToLower(t.HeaderFormat)
}

func truncateBody(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
