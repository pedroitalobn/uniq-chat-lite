package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/models"
)

// ─── Variáveis Liquid pra render no template WABA ─────────────────────────

// BuildCampaignLiquidVars monta o contexto de variáveis disponíveis pra
// renderizar templates da campanha pra um destinatário específico.
//
// Namespaces expostos:
//
//   contact.*  — dados do contato no CRM (se existir match por phone+ws):
//                phone, name, email, job_title, department, company,
//                city, state, country, postal_code, instagram_handle,
//                linkedin_url, funnel, stage, owner_name, owner_email,
//                tags (lista de nomes), custom.<chave> (custom_fields),
//                attr.<chave> (legacy attributes_json)
//
//   csv.*      — colunas extras vindas do upload (ex: csv.codigo_promo,
//                csv.cidade_origem). Mesma coisa em `extra.*`.
//
//   now        — ISO 8601 do momento do envio (ex: 2026-05-09T15:30:00Z)
//   date       — DD/MM/YYYY no fuso UTC
//   time       — HH:MM no fuso UTC
//
// Quando contato não existe no CRM, contact.* tem só phone e name (do
// próprio recipient). Falhas ao parsear custom_fields/extra_fields são
// silenciosas — variável fica indefinida e Liquid renderiza vazio.
func BuildCampaignLiquidVars(
	db *gorm.DB,
	r *models.CampaignRecipient,
	workspaceID *uuid.UUID,
	userID uuid.UUID,
) map[string]any {
	contactVars := map[string]any{
		"phone": r.Phone,
		"name":  r.Name,
	}

	// Tenta enriquecer com Contact do CRM. Match por phone dentro do
	// workspace (ou do user no fluxo legacy).
	var ct models.Contact
	q := db.Preload("Tags").Preload("Owner").Preload("Company")
	if workspaceID != nil {
		q = q.Where("(workspace_id = ? OR user_id = ?) AND phone = ?", *workspaceID, userID, r.Phone)
	} else {
		q = q.Where("user_id = ? AND phone = ?", userID, r.Phone)
	}
	if err := q.First(&ct).Error; err == nil {
		// Override só campos que o Contact tem mais ricos. Phone/name
		// preservam o do recipient como fallback.
		if ct.Name != "" {
			contactVars["name"] = ct.Name
		}
		contactVars["email"] = ct.Email
		contactVars["job_title"] = ct.JobTitle
		contactVars["department"] = ct.Department
		contactVars["city"] = ct.City
		contactVars["state"] = ct.State
		contactVars["country"] = ct.Country
		contactVars["postal_code"] = ct.PostalCode
		contactVars["instagram_handle"] = ct.InstagramHandle
		contactVars["linkedin_url"] = ct.LinkedInURL
		contactVars["funnel"] = ct.Funnel
		contactVars["stage"] = ct.Stage
		contactVars["external_id"] = ct.ExternalID
		// Owner / responsável
		if ct.Owner != nil {
			contactVars["owner_name"] = ct.Owner.Name
			contactVars["owner_email"] = ct.Owner.Email
		}
		// Empresa
		if ct.Company != nil {
			contactVars["company"] = ct.Company.Name
		}
		// Tags como lista de nomes (ex: {% for t in contact.tags %}{{ t }}, {% endfor %})
		if len(ct.Tags) > 0 {
			tagNames := make([]string, 0, len(ct.Tags))
			for _, t := range ct.Tags {
				tagNames = append(tagNames, t.Name)
			}
			contactVars["tags"] = tagNames
		}
		// Custom fields → contact.custom.<key>
		if cf := decodeStringMap(ct.CustomFields); cf != nil {
			contactVars["custom"] = cf
		}
		// Legacy attributes → contact.attr.<key>
		if attrs := decodeStringMap(ct.AttributesJSON); attrs != nil {
			contactVars["attr"] = attrs
		}
	}

	// CSV / extra fields do recipient (vindas do upload).
	csvVars := decodeStringMap(r.ExtraFields)
	if csvVars == nil {
		csvVars = map[string]any{}
	}

	now := time.Now().UTC()
	return map[string]any{
		"contact": contactVars,
		"csv":     csvVars,
		"extra":   csvVars, // alias — mais natural pra alguns users
		"now":     now.Format(time.RFC3339),
		"date":    now.Format("02/01/2006"),
		"time":    now.Format("15:04"),
	}
}

// decodeStringMap — parseia JSON object {string: any} de forma defensiva.
// Aceita tanto string vazia/inválida (devolve nil) quanto JSON válido.
// Os valores ficam como `any` pra Liquid renderizar números/arrays também.
func decodeStringMap(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || raw == "{}" {
		return nil
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// ─── Rate-limit Meta-aligned ──────────────────────────────────────────────

// MetaRateLimit captura os limites práticos da Cloud API. Não há endpoint
// público pra consultar, então usamos os valores documentados:
//
//   • Padrão sem upgrade: 80 mensagens por SEGUNDO por phone_number.
//     (ref: developers.facebook.com/docs/whatsapp/cloud-api/get-started
//      → Rate Limits)
//   • Tier-based (24h): 1k / 10k / 100k / unlimited recipients únicos
//     dependendo do quality rating + tier. Não enforçamos isso aqui
//     (Meta retorna 80007 quando estoura), só aplicamos backoff.
//   • 429 + 80007: rate limit. Backoff exponencial 2s/4s/8s/16s/32s.
//
// O delay configurado pelo user (DelaySeconds) tem precedência quando
// for MAIOR que o mínimo necessário (sem queimar a quota), pra
// envios "humanos". Quando o user pede algo abaixo do floor de 12.5ms
// (1/80), nivelamos por baixo pra não quebrar o ceiling.
const (
	MetaMaxMessagesPerSecond = 80
	MetaMinDelay             = time.Second / time.Duration(MetaMaxMessagesPerSecond)
)

// computeMetaDelay devolve o delay efetivo entre envios. Garante que
// nunca passe abaixo do floor de 80 msg/s da Cloud API.
func computeMetaDelay(userDelay time.Duration) time.Duration {
	if userDelay < MetaMinDelay {
		return MetaMinDelay
	}
	return userDelay
}

// SendWABATemplateWithRetry — wrapper pro POST /messages com retry e
// backoff em erros transientes (429, 500-599, 80007). Devolve o status
// final + body raw da Meta. Erros 4xx não-retryáveis (400, 401, 132012)
// passam direto sem retry.
//
// Cap: 5 tentativas, backoff 2s/4s/8s/16s/32s. Honra ctx (cancelamento).
func SendWABATemplateWithRetry(
	ctx context.Context,
	httpClient *http.Client,
	url, accessToken string,
	body []byte,
) (status int, respBody []byte, err error) {
	const maxAttempts = 5
	delays := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 32 * time.Second}

	for attempt := 0; attempt < maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return 0, nil, ctx.Err()
		}

		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")

		resp, doErr := httpClient.Do(req)
		if doErr != nil {
			err = doErr
			// Network errors são transientes — backoff e retry.
			waitForBackoff(ctx, delays[attempt])
			continue
		}

		respBody = readAndCloseBody(resp)
		status = resp.StatusCode

		// Sucesso ou erro permanente — sai do loop sem retry.
		if status < 400 {
			return status, respBody, nil
		}
		if !isRetryableMetaError(status, respBody) {
			return status, respBody, nil
		}

		// Honra Retry-After se Meta mandar; senão usa backoff exponencial.
		wait := delays[attempt]
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if secs, perr := time.ParseDuration(ra + "s"); perr == nil && secs > 0 {
				wait = secs
			}
		}
		log.Warn().
			Int("attempt", attempt+1).
			Int("status", status).
			Dur("wait", wait).
			Msg("WABA: erro transiente, retry com backoff")
		waitForBackoff(ctx, wait)
	}
	return status, respBody, fmt.Errorf("Meta API: falhou após %d tentativas (status %d)", maxAttempts, status)
}

// isRetryableMetaError — true pra erros que merecem retry com backoff.
// Meta error codes que indicam rate limit / instabilidade:
//
//   • HTTP 429 — too many requests
//   • HTTP 5xx — server-side
//   • code 80007 — rate limit hit
//   • code 130429 — message rate limit hit
//   • code 131056 — pair rate limit (recipient receiving too many)
//
// Erros 132xxx (formato/template) e 400-401 não retentam.
func isRetryableMetaError(status int, body []byte) bool {
	if status == http.StatusTooManyRequests || status >= 500 {
		return true
	}
	// Parse soft do erro pra detectar codes específicos
	var meta struct {
		Error struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &meta) == nil {
		switch meta.Error.Code {
		case 80007, 130429, 131056, 1:
			return true
		}
	}
	return false
}

func waitForBackoff(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d + jitter(d)):
	}
}

// jitter — soma 0-25% do backoff em ms aleatório pra evitar thundering
// herd quando múltiplas campanhas batem 429 ao mesmo tempo.
func jitter(base time.Duration) time.Duration {
	if base <= 0 {
		return 0
	}
	max := int64(base) / 4
	if max <= 0 {
		return 0
	}
	return time.Duration(rand.Int63n(max))
}

func readAndCloseBody(resp *http.Response) []byte {
	defer resp.Body.Close()
	const maxBodyBytes = 64 * 1024
	limited := http.MaxBytesReader(nil, resp.Body, maxBodyBytes)
	out := make([]byte, 0, 1024)
	buf := make([]byte, 4096)
	for {
		n, err := limited.Read(buf)
		if n > 0 {
			out = append(out, buf[:n]...)
		}
		if err != nil {
			break
		}
	}
	return out
}
