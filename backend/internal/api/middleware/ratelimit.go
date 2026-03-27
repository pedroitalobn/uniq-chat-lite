package middleware

import (
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

type rateLimitEntry struct {
	count     int
	resetAt   time.Time
	mu        sync.Mutex
}

var (
	limiters   = sync.Map{}
	windowSize = time.Minute
)

// RateLimit provides a simple in-memory rate limiter per IP or user ID.
// limit = max requests per minute.
func RateLimit(limit int) fiber.Handler {
	return func(c *fiber.Ctx) error {
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

		return c.Next()
	}
}
