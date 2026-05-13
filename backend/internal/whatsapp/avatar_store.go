package whatsapp

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/uniq-chat/backend/internal/storage"
)

const (
	// avatarAttemptTimeout é o budget por tentativa individual de download.
	// Meta CDN ou responde em <10s ou é um problema — esticar não ajuda.
	avatarAttemptTimeout = 15 * time.Second

	// avatarUploadTimeout é o budget pro upload pra storage local.
	avatarUploadTimeout = 20 * time.Second

	// avatarMaxRetries é o número de tentativas de download em caso de falha.
	avatarMaxRetries = 2

	// avatarRetryDelay é o delay base entre retries (backoff exponencial simples).
	avatarRetryDelay = 2 * time.Second
)

// avatarHTTPClient — http.Client dedicado pra download de avatar com
// timeouts de socket. Sem isso o http.DefaultClient só obedece o ctx, o
// que não impede que uma conexão TLS lenta consuma todo o budget na
// fase de handshake.
var avatarHTTPClient = &http.Client{
	Timeout: avatarAttemptTimeout,
}

// isExpiredStatus — true quando o status code indica URL signed expirada
// (401 Unauthorized, 403 Forbidden, 410 Gone). Substitui o
// strings.Contains(err.Error(), "401|403|410") que dava falso-positivo
// em qualquer URL que tivesse esses 3 dígitos em hashes da Meta.
func isExpiredStatus(status int) bool {
	return status == 401 || status == 403 || status == 410
}

// PersistAvatar — baixa os bytes da signed URL da Meta e sobe pro nosso
// MinIO/S3, retornando uma URL permanente que o frontend pode usar pra
// sempre. Resolve o problema crítico de signed URLs do CDN da Meta
// expirarem em poucas horas — antes guardávamos o URL signed direto no
// banco, então qualquer chat com avatar perdia a foto depois de um tempo
// (o <img onError> só escondia, parecia que o contato não tinha foto).
//
// Estratégia:
//   • Object key determinístico: avatars/{sha1(jid)}.jpg — mesmo JID
//     sempre sobe na mesma key. Idempotente, evita lixo de uploads
//     duplicados, e quando o user troca a foto no WhatsApp é só fazer
//     overwrite (mesma key).
//   • Skip se a URL recebida JÁ é nossa (idempotência defensiva — se o
//     caller passar uma URL do MinIO de volta, retorna como está).
//   • Storage não configurado → retorna a signed URL original (degrade
//     graceful em dev/staging sem MinIO).
//   • Falha de download → retorna a signed URL original com warning,
//     melhor ter avatar temporário do que nenhum.
//
// Idealmente o cron de profile sync chama isso pra preencher; o pipeline
// de mensagens (SaveMessageEx) também passa pra cá pra que NUNCA gravemos
// signed URLs no banco.
func PersistAvatar(ctx context.Context, jid, signedURL string) string {
	if signedURL == "" {
		return ""
	}
	if !storage.IsConfigured() {
		return signedURL
	}
	// Idempotente: se já recebemos uma URL do nosso storage, devolve sem
	// re-upload. KeyFromURL retorna "" pra URLs externas.
	if storage.GlobalStorage.KeyFromURL(signedURL) != "" {
		return signedURL
	}
	// Só baixa se a URL é da Meta — evita seguir redirects pra outros
	// hosts. WhatsApp avatar URLs hospedam em mmg.whatsapp.net,
	// pps.whatsapp.net ou cdn.whatsapp.net.
	if !looksLikeWhatsappCDN(signedURL) {
		return signedURL
	}

	// Cada attempt recebe seu próprio timeout — antes os 3 attempts + sleeps
	// + upload compartilhavam o mesmo budget de 60s, e como o ctx do caller
	// (cron de profile sync) já vinha com 5min compartilhados entre 400
	// conversas, qualquer atraso da Meta saturava tudo. Agora cada attempt
	// tem fatia exclusiva e o caller pode cancelar via ctx pai.
	var data []byte
	var mime string
	var status int
	var err error

	for attempt := 0; attempt <= avatarMaxRetries; attempt++ {
		attemptCtx, cancelAttempt := context.WithTimeout(ctx, avatarAttemptTimeout)
		var tryData []byte
		var tryMime string
		var tryStatus int
		tryData, tryMime, tryStatus, err = downloadAvatar(attemptCtx, signedURL)
		cancelAttempt()
		if err == nil {
			data = tryData
			mime = tryMime
			status = tryStatus
			break
		}
		// Status conhecido de URL expirada: não adianta retry — gera nova.
		if isExpiredStatus(tryStatus) {
			status = tryStatus
			break
		}
		if attempt < avatarMaxRetries {
			delay := avatarRetryDelay * time.Duration(attempt+1)
			log.Warn().Err(err).Str("jid", jid).Int("attempt", attempt+1).
				Dur("retry_in", delay).Msg("avatar: download failed, retrying")
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return signedURL
			}
		}
	}
	if err != nil {
		// Diferencia URL expirada (status 401/403/410 — gera URL nova) de
		// outras falhas (timeout, rede). Antes a comparação era por
		// strings.Contains(err.Error(), "401|403|410"), mas a URL signed
		// da Meta tem dígitos aleatórios que casavam essas substrings em
		// timeouts → falso-positivo "URL expired" em log de deadline.
		if isExpiredStatus(status) {
			clearAvatarCache(jid)
			log.Warn().Err(err).Str("jid", jid).Int("status", status).
				Msg("avatar: URL expired, cache cleared — will retry fresh URL")
		} else {
			log.Warn().Err(err).Str("jid", jid).Msg("avatar: all download attempts failed, keeping signed URL temporarily")
		}
		return signedURL
	}
	// downloadCtx pra upload — limite separado dos attempts pra não ser
	// poluído pelo backoff.
	downloadCtx, cancel := context.WithTimeout(ctx, avatarUploadTimeout)
	defer cancel()

	// Detecta MIME pela extensão da URL ou pelo magic byte. Meta serve
	// JPEG por padrão, mas seja conservador.
	if mime == "" || strings.HasPrefix(mime, "application/octet-stream") {
		mime = sniffImageMime(data)
	}
	ext := storage.MimeToExt(mime)
	if ext == "bin" {
		ext = "jpg" // safe default
	}
	objectName := avatarObjectKey(jid, ext)

	publicURL, err := storage.GlobalStorage.UploadBytes(downloadCtx, objectName, data, mime)
	if err != nil {
		log.Warn().Err(err).Str("jid", jid).Msg("avatar: upload failed, keeping signed URL temporarily")
		return signedURL
	}
	return publicURL
}

// downloadAvatar — baixa os bytes do avatar com contexto de timeout.
// Retorna os bytes, o MIME, o status HTTP (0 se a request nem completou)
// e qualquer erro. Caller usa o status pra decidir se vale retry ou se
// é URL expirada (401/403/410).
func downloadAvatar(ctx context.Context, signedURL string) ([]byte, string, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, signedURL, nil)
	if err != nil {
		return nil, "", 0, err
	}
	req.Header.Set("User-Agent", "uniq-chat/1.0")
	resp, err := avatarHTTPClient.Do(req)
	if err != nil {
		return nil, "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", resp.StatusCode, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	// Limita tamanho — avatares são pequenos (geralmente 5-50KB). Evita
	// abuse de URL maliciosa servindo arquivo grande. Cap em 2MB.
	body := io.LimitReader(resp.Body, 2*1024*1024)
	data, err := io.ReadAll(body)
	if err != nil || len(data) == 0 {
		return nil, "", resp.StatusCode, fmt.Errorf("read body: %w", err)
	}
	return data, resp.Header.Get("Content-Type"), resp.StatusCode, nil
}

// clearAvatarCache remove o JID do cache em memória. Chamado quando o
// download falha com 401/403 (URL expirada), forçando re-fetch na próxima
// mensagem ou tick do cron.
func clearAvatarCache(jid string) {
	avatarCache.Delete(jid)
}

// avatarObjectKey — sha1 do JID dá uma chave determinística e curta sem
// expor o número direto no path do storage. Path: avatars/<hash>.<ext>
func avatarObjectKey(jid, ext string) string {
	sum := sha1.Sum([]byte(strings.ToLower(jid)))
	return fmt.Sprintf("avatars/%s.%s", hex.EncodeToString(sum[:]), ext)
}

// looksLikeWhatsappCDN — heurística pra evitar baixar URLs arbitrárias
// caso a função seja chamada com algo estranho. Aceita os hosts típicos
// do WhatsApp/Meta.
func looksLikeWhatsappCDN(url string) bool {
	if url == "" {
		return false
	}
	low := strings.ToLower(url)
	hosts := []string{
		"whatsapp.net",
		"whatsapp.com",
		"fbcdn.net",
		"cdninstagram.com",
		"fna.fbcdn.net",
		"scontent.whatsapp.net",
		"pps.whatsapp.net",
		"mmg.whatsapp.net",
		"media.whatsapp.net",
	}
	for _, h := range hosts {
		if strings.Contains(low, h) {
			return true
		}
	}
	return false
}

// sniffImageMime — checa magic bytes pra decidir mime. Cobre os formatos
// que o WhatsApp serve em avatar (JPEG quase sempre).
func sniffImageMime(data []byte) string {
	if len(data) < 4 {
		return "application/octet-stream"
	}
	switch {
	case data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "image/jpeg"
	case data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47:
		return "image/png"
	case data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46:
		return "image/gif"
	case len(data) > 12 && string(data[8:12]) == "WEBP":
		return "image/webp"
	}
	return "image/jpeg"
}
