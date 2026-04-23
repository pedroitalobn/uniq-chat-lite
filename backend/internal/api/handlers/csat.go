package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type CSATHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewCSATHandler(db *gorm.DB, manager *whatsapp.Manager) *CSATHandler {
	return &CSATHandler{db: db, manager: manager}
}

// ListForConversation GET /v1/conversations/:id/csat
func (h *CSATHandler) ListForConversation(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID := c.Params("id")
	var items []models.CSATSurvey
	h.db.Where("workspace_id = ? AND conversation_id = ?", ws, convID).
		Order("created_at DESC").
		Find(&items)
	return c.JSON(fiber.Map{"items": items})
}

// Send POST /v1/conversations/:id/csat
// Creates a CSATSurvey, generates a token, sends the CSAT link via the
// conversation channel, and appends a csat_sent event.
func (h *CSATHandler) Send(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	convID := c.Params("id")
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, convID).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	token := randomToken(32)
	survey := models.CSATSurvey{
		ConversationID: conv.ID,
		WorkspaceID:    ws,
		Token:          token,
		Channel:        conv.ChannelType,
	}
	if err := h.db.Create(&survey).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Build public link — uses the app frontend URL
	base := config.AppConfig.FrontendURL
	if comma := firstCSV(base); comma != "" {
		base = comma
	}
	link := base + "/csat/" + token

	// Send a message via the channel (best-effort — CSAT rows are valid even
	// if the delivery fails; agent can copy the link manually)
	prompt := "Obrigado pelo atendimento! Avalie como foi com uma nota de 1 a 5: " + link
	if h.manager != nil {
		if client := h.manager.GetInstance(conv.InstanceID.String()); client != nil && client.IsConnected() {
			_, _ = client.SendTextMessage(conv.ChannelKey, prompt)
		}
	}

	h.db.Create(&models.ConversationEvent{
		ConversationID: conv.ID,
		WorkspaceID:    ws,
		ActorType:      models.ActorSystem,
		EventType:      models.ConvEventCSATSent,
		Payload:        `{"survey_id":"` + survey.ID.String() + `","link":"` + link + `"}`,
	})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"survey": survey,
		"link":   link,
	})
}

// GetPublic GET /csat/:token  (no auth — customer opens the link)
func (h *CSATHandler) GetPublic(c *fiber.Ctx) error {
	token := c.Params("token")
	var s models.CSATSurvey
	if err := h.db.Where("token = ?", token).First(&s).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "pesquisa não encontrada"})
	}
	var conv models.Conversation
	h.db.Select("contact_id, channel_type").First(&conv, "id = ?", s.ConversationID)
	// Minimal surface — never leak sensitive conversation data
	return c.JSON(fiber.Map{
		"id":          s.ID,
		"channel":     s.Channel,
		"answered_at": s.AnsweredAt,
		"rating":      s.Rating,
	})
}

// SubmitPublic POST /csat/:token  { rating: 1..5, comment? }
func (h *CSATHandler) SubmitPublic(c *fiber.Ctx) error {
	token := c.Params("token")
	var body struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}
	c.BodyParser(&body)
	if body.Rating < 1 || body.Rating > 5 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "rating precisa ser 1..5"})
	}
	var s models.CSATSurvey
	if err := h.db.Where("token = ?", token).First(&s).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "pesquisa não encontrada"})
	}
	if s.AnsweredAt != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "pesquisa já respondida"})
	}
	now := time.Now()
	s.Rating = &body.Rating
	s.Comment = body.Comment
	s.AnsweredAt = &now
	h.db.Save(&s)

	h.db.Create(&models.ConversationEvent{
		ConversationID: s.ConversationID,
		WorkspaceID:    s.WorkspaceID,
		ActorType:      models.ActorCustomer,
		EventType:      models.ConvEventCSATAnswered,
		Payload:        `{"rating":` + itoa(body.Rating) + `}`,
		CreatedAt:      now,
	})
	return c.JSON(fiber.Map{"ok": true})
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func firstCSV(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			return s[:i]
		}
	}
	return ""
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}
