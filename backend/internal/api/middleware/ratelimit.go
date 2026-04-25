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

var (
	limiters   = sync.Map{}
	windowSize = time.Minute
)

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

		key := c.IP()
		if user := GetCurrentUser(c); user != nil {
			key = "user:" + user.ID.String()
		}

		val, _ := limiters.LoadOrStore(key, &rateLimitEntry{
			resetAt: time.Now().Add(windowSize),
		})
		entry := val.(*rateLimitEntry)

		entry.mu.Lock()
		defer entry.mu.Unlock()

		if time.Now().After(entry.resetAt) {
			entry.count = 0
			entry.resetAt = time.Now().Add(windowSize)
		}

		entry.count++
		if entry.count > limit {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error":       "muitas requisições",
				"retry_after": entry.resetAt.UTC().Format(time.RFC3339),
			})
		}

		// Headers informativos pra UI poder mostrar "X req restantes" e
		// programar refetch antes do reset. Tipo o GitHub API faz.
		c.Set("X-RateLimit-Limit", itoa(limit))
		c.Set("X-RateLimit-Remaining", itoa(limit-entry.count))
		c.Set("X-RateLimit-Reset", entry.resetAt.UTC().Format(time.RFC3339))

		return c.Next()
	}
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
