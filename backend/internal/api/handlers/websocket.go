package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type WSHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewWSHandler(db *gorm.DB, manager *whatsapp.Manager) *WSHandler {
	return &WSHandler{db: db, manager: manager}
}

// InstanceWS godoc
// GET /instances/:id/ws  (Upgrade to WebSocket)
func (h *WSHandler) InstanceWS(c *fiber.Ctx) error {
	if !websocket.IsWebSocketUpgrade(c) {
		return fiber.ErrUpgradeRequired
	}

	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	return websocket.New(func(ws *websocket.Conn) {
		send := make(chan []byte, 64)
		done := make(chan struct{})

		client := h.manager.GetInstance(instance.ID.String())
		if client != nil {
			client.RegisterWSConn(send, done)
		}

		// Write goroutine
		go func() {
			for {
				select {
				case msg, ok := <-send:
					if !ok {
						return
					}
					if err := ws.WriteMessage(websocket.TextMessage, msg); err != nil {
						return
					}
				case <-done:
					return
				}
			}
		}()

		// Read loop (keep connection alive, handle pings)
		for {
			_, _, err := ws.ReadMessage()
			if err != nil {
				close(done)
				break
			}
		}
	})(c)
}

// EventsWS godoc
// GET /ws/events - Global WebSocket for real-time events
func (h *WSHandler) EventsWS(c *fiber.Ctx) error {
	if !websocket.IsWebSocketUpgrade(c) {
		return fiber.ErrUpgradeRequired
	}

	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}

	hub := whatsapp.GetHub()
	if hub == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "serviço indisponível"})
	}

	return websocket.New(func(ws *websocket.Conn) {
		// Subscribe to events
		client := hub.Subscribe(user.ID.String())
		defer hub.Unsubscribe(client)

		done := make(chan struct{})

		// Send events to client
		go func() {
			for {
				select {
				case data, ok := <-client.Conn:
					if !ok {
						close(done)
						return
					}
					if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
						close(done)
						return
					}
				case <-done:
					return
				}
			}
		}()

		// Heartbeat to keep connection alive
		go func() {
			ticker := time.NewTicker(25 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
						return
					}
				case <-done:
					return
				}
			}
		}()

		// Read loop (handle incoming messages)
		for {
			_, _, err := ws.ReadMessage()
			if err != nil {
				break
			}
		}

		close(done)
	})(c)
}

// suppress unused import
var _ = middleware.GetCurrentUser
