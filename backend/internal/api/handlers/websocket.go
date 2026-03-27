package handlers

import (
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

// suppress unused import
var _ = middleware.GetCurrentUser
