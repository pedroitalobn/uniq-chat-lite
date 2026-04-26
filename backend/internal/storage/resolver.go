package storage

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// PresignTTL é o TTL padrão pra signed URLs de mídia inbound. 24h cobre
// uma jornada de trabalho típica do agente sem precisar refresh.
const PresignTTL = 24 * time.Hour

// presignCacheTTL — quanto tempo reusar uma signed URL antes de regerar.
// Tem que ser bem menor que PresignTTL pra evitar entregar URL prestes a
// expirar. 12h dá margem segura e é tempo suficiente pra evitar que
// reproduções de áudio/vídeo resetem entre polls da timeline.
//
// Crítico pra UX: sem este cache, cada chamada gera signed URL nova
// (assinatura S3 inclui timestamp), o frontend vê <audio src> "mudando"
// a cada 2s e o browser descarta o buffer → áudio reinicia do zero.
const presignCacheTTL = 12 * time.Hour

type presignCacheEntry struct {
	url       string
	cachedAt  time.Time
}

var presignCache sync.Map // map[string]*presignCacheEntry — key=object key

// presignCached retorna a signed URL cacheada se ainda fresca; senão
// gera nova, atualiza cache e retorna. Erro do presign NÃO é cacheado
// — sempre tenta de novo.
func presignCached(ctx context.Context, key string) (string, error) {
	if v, ok := presignCache.Load(key); ok {
		if entry, ok := v.(*presignCacheEntry); ok {
			if time.Since(entry.cachedAt) < presignCacheTTL {
				return entry.url, nil
			}
		}
	}
	url, err := GlobalStorage.PresignURL(ctx, key, PresignTTL)
	if err != nil {
		return "", err
	}
	presignCache.Store(key, &presignCacheEntry{url: url, cachedAt: time.Now()})
	return url, nil
}

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

	signed, err := presignCached(ctx, key)
	if err != nil {
		log.Warn().Err(err).Str("key", key).Msg("storage resolver: presign FALHOU — mantendo URL original")
		return content
	}
	log.Debug().
		Str("key", key).
		Str("source", source).
		Int("signed_url_len", len(signed)).
		Msg("storage resolver: signed URL OK (cached)")
	parsed["url"] = signed
	out, err := json.Marshal(parsed)
	if err != nil {
		return content
	}
	return string(out)
}
