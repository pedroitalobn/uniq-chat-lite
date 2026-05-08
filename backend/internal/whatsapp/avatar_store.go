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

	dlCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, signedURL, nil)
	if err != nil {
		return signedURL
	}
	req.Header.Set("User-Agent", "uniq-chat/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("jid", jid).Msg("avatar: download failed, keeping signed URL temporarily")
		return signedURL
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Warn().Int("status", resp.StatusCode).Str("jid", jid).Msg("avatar: download non-2xx")
		return signedURL
	}
	// Limita tamanho — avatares são pequenos (geralmente 5-50KB). Evita
	// abuse de URL maliciosa servindo arquivo grande. Cap em 2MB.
	body := io.LimitReader(resp.Body, 2*1024*1024)
	data, err := io.ReadAll(body)
	if err != nil || len(data) == 0 {
		return signedURL
	}

	// Detecta MIME pela extensão da URL ou pelo magic byte. Meta serve
	// JPEG por padrão, mas seja conservador.
	mime := resp.Header.Get("Content-Type")
	if mime == "" || strings.HasPrefix(mime, "application/octet-stream") {
		mime = sniffImageMime(data)
	}
	ext := storage.MimeToExt(mime)
	if ext == "bin" {
		ext = "jpg" // safe default
	}
	objectName := avatarObjectKey(jid, ext)

	publicURL, err := storage.GlobalStorage.UploadBytes(dlCtx, objectName, data, mime)
	if err != nil {
		log.Warn().Err(err).Str("jid", jid).Msg("avatar: upload failed, keeping signed URL temporarily")
		return signedURL
	}
	return publicURL
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
