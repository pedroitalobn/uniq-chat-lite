package handlers

// Instagram channel handler
//
// Integration strategy: instagram-cli (github.com/supreme-gg-gg/instagram-cli)
// or Meta Graph API (Messenger Platform) depending on account type.
//
// Connection flow:
//   1. POST /instagram/instances/:id/connect  → initiates OAuth / session login
//   2. GET  /instagram/instances/:id/status   → returns connection state
//   3. POST /instagram/instances/:id/messages/dm → sends a DM
//
// All instagram instances are stored in the shared `instances` table
// with channel = "instagram".

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type InstagramHandler struct {
	db *gorm.DB
}

func NewInstagramHandler(db *gorm.DB) *InstagramHandler {
	return &InstagramHandler{db: db}
}

// Connect godoc
// POST /instagram/instances/:id/connect
// Initiates Instagram session via credentials or OAuth.
// Body: { "username": "...", "password": "..." }  (session-based)
//       { "access_token": "..." }                  (Meta Graph API)
func (h *InstagramHandler) Connect(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance.Channel != models.ChannelInstagram {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "esta instância não é do canal instagram",
		})
	}

	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		AccessToken string `json:"access_token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "payload inválido"})
	}

	if req.AccessToken == "" && (req.Username == "" || req.Password == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "informe access_token (Meta API) ou username + password (instagram-cli)",
		})
	}

	// TODO: Implement actual instagram-cli session init
	// Reference: https://github.com/supreme-gg-gg/instagram-cli
	//
	// Using session-based:
	//   client := igcli.NewClient()
	//   err := client.Login(req.Username, req.Password)
	//   sessionData, _ := client.ExportSession()
	//   instance.SessionData = sessionData
	//
	// Using Meta Graph API:
	//   Validate access_token via GET https://graph.instagram.com/me?access_token=...
	//   Store token in instance.Token

	h.db.Model(instance).Update("status", models.StatusConnecting)

	return c.JSON(fiber.Map{
		"message": "conexão iniciada — implemente a integração instagram-cli ou Meta Graph API",
		"status":  "connecting",
		"channel": "instagram",
		"refs": fiber.Map{
			"instagram_cli": "https://github.com/supreme-gg-gg/instagram-cli",
			"meta_api":      "https://developers.facebook.com/docs/instagram-api/guides/business-discovery",
		},
	})
}

// Disconnect godoc
// POST /instagram/instances/:id/disconnect
func (h *InstagramHandler) Disconnect(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance.Channel != models.ChannelInstagram {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "canal inválido"})
	}

	// TODO: Clear instagram session / revoke token

	h.db.Model(instance).Updates(map[string]interface{}{
		"status":       models.StatusDisconnected,
		"session_data": "",
	})

	return c.JSON(fiber.Map{"message": "instância instagram desconectada"})
}

// SendDM godoc
// POST /instagram/instances/:id/messages/dm
// Body: { "to": "instagram_user_id_or_username", "text": "..." }
func (h *InstagramHandler) SendDM(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance.Channel != models.ChannelInstagram {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "canal inválido"})
	}

	var req struct {
		To   string `json:"to"`
		Text string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Text == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "to e text são obrigatórios"})
	}

	// TODO: Send DM via instagram-cli or Meta Graph API
	// instagram-cli: client.SendDM(req.To, req.Text)
	// Meta Graph: POST https://graph.instagram.com/v18.0/me/messages
	//             { "recipient": { "id": req.To }, "message": { "text": req.Text } }

	return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
		"error":   "envio de DM ainda não implementado",
		"message": "integre instagram-cli ou Meta Graph API para habilitar",
		"docs":    "https://developers.facebook.com/docs/instagram-api/guides/messaging",
	})
}

// GetDMs godoc
// GET /instagram/instances/:id/messages/dm
// Returns conversation list / DM inbox
func (h *InstagramHandler) GetDMs(c *fiber.Ctx) error {
	instance := middleware.GetCurrentInstance(c)
	if instance.Channel != models.ChannelInstagram {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "canal inválido"})
	}

	// TODO: Fetch DMs via instagram-cli or Meta Graph API
	return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
		"error": "listagem de DMs ainda não implementada",
		"docs":  "https://developers.facebook.com/docs/instagram-api/guides/messaging",
	})
}
