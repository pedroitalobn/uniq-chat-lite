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
// Authenticates via Bearer header or ?token= query param.
// Auto-joins rooms for all instances the user has access to, including new instances over time.
func (h *WSHandler) EventsWS(c *fiber.Ctx) error {
	if !websocket.IsWebSocketUpgrade(c) {
		return fiber.ErrUpgradeRequired
	}

	user := middleware.GetCurrentUser(c)
	if user == nil {
		token := c.Query("token")
		if token == "" {
			if auth := c.Get("Authorization"); len(auth) > 7 && auth[:7] == "Bearer " {
				token = auth[7:]
			}
		}
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
		}

		claims, err := middleware.ParseAccessToken(token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "token inválido ou expirado"})
		}

		var dbUser models.User
		if err := h.db.Preload("Plan").First(&dbUser, "id = ?", claims.UserID).Error; err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "usuário não encontrado"})
		}
		if dbUser.IsBlocked() {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "conta desativada ou bloqueada"})
		}
		user = &dbUser
	}

	hub := whatsapp.GetHub()
	if hub == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "serviço indisponível"})
	}

	return websocket.New(func(ws *websocket.Conn) {
		client := hub.Subscribe(user.ID.String())
		defer hub.Unsubscribe(client)

		done := make(chan struct{})
		joined := make(map[string]bool)

		syncInstanceRooms := func() {
			for _, instID := range h.accessibleInstanceIDs(user) {
				if joined[instID] {
					continue
				}
				hub.JoinRoom(client, "instance:"+instID)
				joined[instID] = true
			}
		}

		syncInstanceRooms()

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

		go func() {
			ticker := time.NewTicker(20 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					syncInstanceRooms()
					if err := ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
						return
					}
				case <-done:
					return
				}
			}
		}()

		for {
			_, _, err := ws.ReadMessage()
			if err != nil {
				break
			}
		}

		close(done)
	})(c)
}

func (h *WSHandler) accessibleInstanceIDs(user *models.User) []string {
	ids := make(map[string]bool)

	if user.Role == models.RoleSuperAdmin {
		var all []string
		h.db.Model(&models.Instance{}).Pluck("id", &all)
		for _, id := range all {
			ids[id] = true
		}
	} else {
		var direct []string
		h.db.Model(&models.Instance{}).Where("user_id = ?", user.ID).Pluck("id", &direct)
		for _, id := range direct {
			ids[id] = true
		}

		var byWorkspace []string
		h.db.Raw(`SELECT i.id FROM instances i
			JOIN user_workspaces uw ON uw.workspace_id = i.workspace_id
			WHERE uw.user_id = ?`, user.ID).Pluck("id", &byWorkspace)
		for _, id := range byWorkspace {
			ids[id] = true
		}
	}

	out := make([]string, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	return out
}

var _ = middleware.GetCurrentUser
