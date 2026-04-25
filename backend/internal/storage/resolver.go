package storage

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// PresignTTL é o TTL padrão pra signed URLs de mídia inbound. 24h cobre
// uma jornada de trabalho típica do agente sem precisar refresh.
const PresignTTL = 24 * time.Hour

// ResolveMediaURLs lê o JSON do MessageLog.Content e, se houver mídia
// salva no bucket, troca o campo `url` por um signed URL com TTL.
//
// No-op (retorna content original) pra:
//   - storage não configurado (GlobalStorage == nil)
//   - content vazio ou que não é JSON
//   - JSON sem media_key e cuja `url` não pertence ao bucket
//   - presign falhando (loga warn, mas não quebra a request)
//
// Centralizado aqui pra ser usado por Timeline handler, conversation.Get,
// inbound pipeline antes do WS broadcast — todo lugar que retorna mídia
// pro front converge na mesma função.
func ResolveMediaURLs(ctx context.Context, content string) string {
	if content == "" {
		return content
	}
	if GlobalStorage == nil {
		log.Debug().Msg("storage resolver: GlobalStorage nil — pulando")
		return content
	}
	trimmed := strings.TrimSpace(content)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return content
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return content
	}

	// Path preferido: media_key explícito (mídia nova, salva como key).
	key, _ := parsed["media_key"].(string)
	source := "media_key"

	// Fallback compat: URL antiga apontando pro bucket público — extrai o key.
	if key == "" {
		if oldURL, ok := parsed["url"].(string); ok {
			extracted := GlobalStorage.KeyFromURL(oldURL)
			if extracted != "" {
				key = extracted
				source = "url-fallback"
			}
		}
	}
	if key == "" {
		return content
	}

	signed, err := GlobalStorage.PresignURL(ctx, key, PresignTTL)
	if err != nil {
		log.Warn().Err(err).Str("key", key).Msg("storage resolver: presign FALHOU — mantendo URL original")
		return content
	}
	log.Info().
		Str("key", key).
		Str("source", source).
		Int("signed_url_len", len(signed)).
		Msg("storage resolver: signed URL OK")
	parsed["url"] = signed
	out, err := json.Marshal(parsed)
	if err != nil {
		return content
	}
	return string(out)
}
