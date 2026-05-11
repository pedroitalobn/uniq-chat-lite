package middleware

import (
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

type rateLimitEntry struct {
	count   int
	resetAt time.Time
	mu      sync.Mutex
}

// Replaced sync.Map → RWMutex+map em Go 1.25: o HashTrieMap interno do
// sync.Map vinha estourando "ran out of hash bits while inserting" sob
// volume normal de login (regressão conhecida da reescrita do sync.Map).
// Mapa protegido manualmente é trivial pro nosso uso (chave por IP/user).
var (
	limitersMu sync.RWMutex
	limiters   = make(map[string]*rateLimitEntry)
	windowSize = time.Minute
)

func getOrCreateLimiter(key string) *rateLimitEntry {
	limitersMu.RLock()
	if e, ok := limiters[key]; ok {
		limitersMu.RUnlock()
		return e
	}
	limitersMu.RUnlock()
	limitersMu.Lock()
	defer limitersMu.Unlock()
	if e, ok := limiters[key]; ok {
		return e
	}
	e := &rateLimitEntry{resetAt: time.Now().Add(windowSize)}
	limiters[key] = e
	return e
}

// RateLimit provides a simple in-memory rate limiter per IP or user ID.
// limit = max requests per minute.
//
// Skipped automaticamente pra:
//   - OPTIONS (CORS preflight): sempre 204, sem custo de processing,
//     contar como request faz a UI bater limite no doble (uma req real
//     vira 2 contagens).
//   - health probes: rotas que terminam em /health são checks rápidos
//     que UI faz pra detectar deploy errado. Bloquear elas piora UX.
func RateLimit(limit int) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Bypass: OPTIONS preflight
		if c.Method() == fiber.MethodOptions {
			return c.Next()
		}
		// Bypass: health endpoints
		if strings.HasSuffix(c.Path(), "/health") {
			return c.Next()
		}

		subject := clientIP(c)
		if user := GetCurrentUser(c); user != nil {
			subject = "user:" + user.ID.String()
		}
		routeKey := c.Route().Path
		if routeKey == "" {
			routeKey = c.Path()
		}
		key := "rl:" + c.Method() + ":" + routeKey + ":" + subject

		entry := getOrCreateLimiter(key)

		// CRÍTICO: trava só pra incrementar counter e ler resetAt. Nunca
		// segurar o mutex durante c.Next() — uma request lenta (ex.: envio
		// de carrossel baixando imagem por 60s) ficaria com o lock
		// segurando TODO request /v1/* do mesmo user atrás dela. Isso
		// causou bloqueio em fila de ~57s em prod (issue regressivo).
		entry.mu.Lock()
		if time.Now().After(entry.resetAt) {
			entry.count = 0
			entry.resetAt = time.Now().Add(windowSize)
		}
		entry.count++
		count := entry.count
		resetAt := entry.resetAt
		entry.mu.Unlock()

		if count > limit {
			retryAfter := int(time.Until(resetAt).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
			c.Set("Retry-After", itoa(retryAfter))
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error":               "muitas requisições",
				"retry_after":         resetAt.UTC().Format(time.RFC3339),
				"retry_after_seconds": retryAfter,
			})
		}

		// Headers informativos pra UI poder mostrar "X req restantes" e
		// programar refetch antes do reset. Tipo o GitHub API faz.
		c.Set("X-RateLimit-Limit", itoa(limit))
		c.Set("X-RateLimit-Remaining", itoa(limit-count))
		c.Set("X-RateLimit-Reset", resetAt.UTC().Format(time.RFC3339))

		return c.Next()
	}
}

// clientIP — IP real do cliente respeitando proxy chain. Quando o
// backend roda atrás de Cloudflare + Dokploy/Caddy, c.IP() retorna o
// IP do proxy interno (sempre o mesmo), fazendo TODOS os users
// compartilharem 1 bucket de rate limit — limites apertados (5/min)
// ficavam impossíveis de respeitar.
//
// Ordem de preferência:
//  1. CF-Connecting-IP — Cloudflare (header confiável quando proxy ativo)
//  2. X-Real-IP — alguns reverse proxies setam isso
//  3. X-Forwarded-For — pega o PRIMEIRO da lista (cliente original)
//  4. c.IP() — fallback pra dev local sem proxy
func clientIP(c *fiber.Ctx) string {
	if v := strings.TrimSpace(c.Get("CF-Connecting-IP")); v != "" {
		return v
	}
	if v := strings.TrimSpace(c.Get("X-Real-IP")); v != "" {
		return v
	}
	if v := strings.TrimSpace(c.Get("X-Forwarded-For")); v != "" {
		// X-Forwarded-For = "client, proxy1, proxy2"; primeiro é o cliente.
		if i := strings.IndexByte(v, ','); i > 0 {
			v = v[:i]
		}
		return strings.TrimSpace(v)
	}
	return c.IP()
}

func itoa(n int) string {
	// fast int → string (evita strconv pra reduzir alocação)
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
