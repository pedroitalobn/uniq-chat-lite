package handlers

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WebChatHandler handles the embeddable webchat widget.
type WebChatHandler struct {
	db  *gorm.DB
	llm *services.LLMService
}

// NewWebChatHandler creates a new WebChatHandler.
func NewWebChatHandler(db *gorm.DB, llm *services.LLMService) *WebChatHandler {
	return &WebChatHandler{db: db, llm: llm}
}

// resolveDestinationPhone retorna o número normalizado (apenas dígitos) da
// instância destino para wa.me/ links.
func (h *WebChatHandler) resolveDestinationPhone(instanceID *uuid.UUID) string {
	if instanceID == nil {
		return ""
	}
	var inst models.Instance
	if err := h.db.Select("phone_number").Where("id = ?", instanceID).First(&inst).Error; err != nil {
		return ""
	}
	clean := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, inst.PhoneNumber)
	return clean
}

// GetConfig GET /v1/instances/:id/webchat
func (h *WebChatHandler) GetConfig(c *fiber.Ctx) error {
	inst, ok := c.Locals("instance").(*models.Instance)
	if !ok || inst == nil {
		return fiber.NewError(fiber.StatusUnauthorized, "instância não encontrada")
	}

	var cfg models.WebChatConfig
	err := h.db.Where("instance_id = ?", inst.ID).First(&cfg).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return c.JSON(fiber.Map{"config": nil})
		}
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(cfg)
}

// UpsertConfig PUT /v1/instances/:id/webchat
func (h *WebChatHandler) UpsertConfig(c *fiber.Ctx) error {
	inst, ok := c.Locals("instance").(*models.Instance)
	if !ok || inst == nil {
		return fiber.NewError(fiber.StatusUnauthorized, "instância não encontrada")
	}

	var body models.WebChatConfig
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	body.InstanceID = inst.ID
	if inst.WorkspaceID != nil {
		body.WorkspaceID = *inst.WorkspaceID
	}

	// Find or create by instance_id.
	var existing models.WebChatConfig
	err := h.db.Where("instance_id = ?", inst.ID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		if err2 := h.db.Create(&body).Error; err2 != nil {
			return fiber.NewError(fiber.StatusInternalServerError, err2.Error())
		}
		return c.Status(fiber.StatusCreated).JSON(body)
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	// Update existing.
	updates := map[string]interface{}{
		"display_name":             body.DisplayName,
		"greeting":                 body.Greeting,
		"primary_color":            body.PrimaryColor,
		"position":                 body.Position,
		"avatar_url":               body.AvatarURL,
		"whatsapp_redirect_number": body.WhatsappRedirectNumber,
		"help_desk_enabled":        body.HelpDeskEnabled,
	}
	if body.PrimaryColor == "" {
		delete(updates, "primary_color")
	}
	if body.Position == "" {
		delete(updates, "position")
	}

	if err := h.db.Model(&existing).Updates(updates).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	// Reload.
	h.db.Where("instance_id = ?", inst.ID).First(&existing)
	return c.JSON(existing)
}

// GetEmbedSnippet GET /v1/instances/:id/webchat/snippet
func (h *WebChatHandler) GetEmbedSnippet(c *fiber.Ctx) error {
	inst, ok := c.Locals("instance").(*models.Instance)
	if !ok || inst == nil {
		return fiber.NewError(fiber.StatusUnauthorized, "instância não encontrada")
	}

	appURL := "https://app.uniq.chat"
	if envURL := os.Getenv("APP_URL"); envURL != "" {
		appURL = envURL
	}

	token := inst.Token
	snippet := fmt.Sprintf(`<!-- Qchat WebChat Widget -->
<script>
(function(){
  var t="%s",u="%s/v1/public/webchat/",w=document.createElement("div");
  w.id="uniq-webchat-root";document.body.appendChild(w);
  var s=document.createElement("script");
  s.src="%s/webchat.js";s.async=true;
  s.onload=function(){if(window.UniqWebChat)window.UniqWebChat.init({token:t,apiUrl:u});};
  document.head.appendChild(s);
})();
</script>`, token, appURL, appURL)

	return c.JSON(fiber.Map{"snippet": snippet})
}

// PublicGetConfig GET /v1/public/webchat/:token
func (h *WebChatHandler) PublicGetConfig(c *fiber.Ctx) error {
	token := c.Params("token")
	if token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "token obrigatório")
	}

	var inst models.Instance
	if err := h.db.Where("token = ?", token).First(&inst).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}

	var cfg models.WebChatConfig
	if err := h.db.Where("instance_id = ?", inst.ID).First(&cfg).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Return defaults.
			return c.JSON(fiber.Map{
				"display_name":     inst.Name,
				"primary_color":    "#2563EB",
				"position":         "bottom-right",
				"greeting":         "Olá! Como posso ajudar?",
				"instance_id":      inst.ID,
				"destination_type": "inbox",
				"badge_style":      "bubble",
				"badge_icon":       "",
				"badge_color":      "#2563EB",
				"offset_x":         20,
				"offset_y":         20,
				"border_radius":    9999,
				"shadow_intensity": "medium",
			})
		}
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	resp := fiber.Map{
		"display_name":      cfg.DisplayName,
		"greeting":          cfg.Greeting,
		"primary_color":     cfg.PrimaryColor,
		"position":          cfg.Position,
		"avatar_url":        cfg.AvatarURL,
		"help_desk_enabled": cfg.HelpDeskEnabled,
		"instance_id":       cfg.InstanceID,
		"destination_type":  cfg.DestinationType,
		// badge appearance
		"badge_style":       cfg.BadgeStyle,
		"badge_icon":        cfg.BadgeIcon,
		"badge_color":       firstNonEmpty(cfg.BadgeColor, cfg.PrimaryColor),
		"offset_x":          cfg.OffsetX,
		"offset_y":          cfg.OffsetY,
		"border_radius":     cfg.BorderRadius,
		"shadow_intensity":  cfg.ShadowIntensity,
	}
	if cfg.DestinationType == "redirect_instance" && cfg.DestinationInstanceID != nil {
		resp["destination_phone"] = h.resolveDestinationPhone(cfg.DestinationInstanceID)
	}
	return c.JSON(resp)
}

// PublicMessage POST /v1/public/webchat/:token/message
func (h *WebChatHandler) PublicMessage(c *fiber.Ctx) error {
	token := c.Params("token")
	if token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "token obrigatório")
	}

	var body struct {
		SessionID   string `json:"session_id"`
		Message     string `json:"message"`
		VisitorName string `json:"visitor_name,omitempty"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	if body.SessionID == "" || body.Message == "" {
		return fiber.NewError(fiber.StatusBadRequest, "session_id e message são obrigatórios")
	}

	// 1. Find instance by token and verify channel.
	var inst models.Instance
	if err := h.db.Where("token = ?", token).First(&inst).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}
	if inst.Channel != models.ChannelWebChat {
		return fiber.NewError(fiber.StatusForbidden, "esta instância não é do tipo webchat")
	}

	workspaceID := uuid.Nil
	if inst.WorkspaceID != nil {
		workspaceID = *inst.WorkspaceID
	}

	// 2. Find or create WebChatSession.
	var session models.WebChatSession
	err := h.db.Where("session_id = ? AND instance_id = ?", body.SessionID, inst.ID).First(&session).Error
	if err == gorm.ErrRecordNotFound {
		session = models.WebChatSession{
			InstanceID:  inst.ID,
			WorkspaceID: workspaceID,
			SessionID:   body.SessionID,
			VisitorName: body.VisitorName,
		}
		if err2 := h.db.Create(&session).Error; err2 != nil {
			return fiber.NewError(fiber.StatusInternalServerError, err2.Error())
		}
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	// 3. Find or create Conversation.
	var conv models.Conversation
	err = h.db.Where("instance_id = ? AND channel_key = ? AND status IN ?",
		inst.ID, body.SessionID,
		[]models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
			models.ConversationStatusSnoozed,
		}).First(&conv).Error
	if err == gorm.ErrRecordNotFound {
		conv = models.Conversation{
			WorkspaceID: workspaceID,
			InstanceID:  inst.ID,
			ChannelType: string(models.ChannelWebChat),
			ChannelKey:  body.SessionID,
			Subject:     "WebChat - " + body.SessionID[:min(8, len(body.SessionID))],
		}
		if err2 := h.db.Create(&conv).Error; err2 != nil {
			return fiber.NewError(fiber.StatusInternalServerError, err2.Error())
		}
		// Link conversation to session.
		h.db.Model(&session).Update("conversation_id", conv.ID)
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	// 4. Create inbound ConversationEvent.
	now := time.Now()
	inboundEvent := models.ConversationEvent{
		ConversationID:      conv.ID,
		WorkspaceID:         workspaceID,
		EventType:           models.ConvEventMessage,
		ActorType:           models.ActorCustomer,
		Payload:             body.Message,
		IsVisibleToCustomer: true,
		CreatedAt:           now,
	}
	if err := h.db.Create(&inboundEvent).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	// Update conversation message count and last message.
	h.db.Model(&conv).Updates(map[string]interface{}{
		"message_count":        gorm.Expr("message_count + 1"),
		"last_message_at":      now,
		"last_message_preview": truncate(body.Message, 280),
	})

	convID := conv.ID

	// 5. Look for InstanceAgent on this instance.
	var agent models.InstanceAgent
	agentErr := h.db.Where("instance_id = ? AND is_active = true", inst.ID).
		Order("is_primary DESC, priority ASC, created_at ASC").
		Preload("Integration").
		First(&agent).Error

	if agentErr != nil {
		// No active agent — queue for human.
		return c.JSON(fiber.Map{
			"reply":           nil,
			"source":          "queued",
			"session_id":      body.SessionID,
			"conversation_id": convID,
		})
	}

	// 6. Agent exists — build context and call LLM.
	var lastEvents []models.ConversationEvent
	h.db.Where("conversation_id = ?", conv.ID).
		Order("created_at DESC").
		Limit(5).
		Find(&lastEvents)

	// Reverse to chronological order.
	for i, j := 0, len(lastEvents)-1; i < j; i, j = i+1, j-1 {
		lastEvents[i], lastEvents[j] = lastEvents[j], lastEvents[i]
	}

	var ctxBuilder strings.Builder
	for _, ev := range lastEvents {
		actor := "Visitante"
		if ev.ActorType == models.ActorBot || ev.ActorType == models.ActorUser {
			actor = "Agente"
		}
		ctxBuilder.WriteString(fmt.Sprintf("%s: %s\n", actor, ev.Payload))
	}

	systemPrompt := agent.SystemPrompt
	if systemPrompt == "" {
		systemPrompt = "Você é um assistente de suporte amigável e prestativo."
	}
	if ctxBuilder.Len() > 0 {
		systemPrompt += "\n\nHistórico recente da conversa:\n" + ctxBuilder.String()
	}

	var llmIntegration *models.UserIntegration
	if agent.Integration != nil {
		llmIntegration = agent.Integration
	}

	reply, llmErr := h.llm.CallChatWithSystem(context.Background(), llmIntegration, systemPrompt, body.Message, false)
	if llmErr != nil {
		return c.JSON(fiber.Map{
			"reply":           nil,
			"source":          "queued",
			"session_id":      body.SessionID,
			"conversation_id": convID,
		})
	}

	// Create outbound event.
	outboundEvent := models.ConversationEvent{
		ConversationID:      conv.ID,
		WorkspaceID:         workspaceID,
		EventType:           models.ConvEventMessage,
		ActorType:           models.ActorBot,
		Payload:             reply,
		IsVisibleToCustomer: true,
		CreatedAt:           time.Now(),
	}
	h.db.Create(&outboundEvent)

	// Update conversation last message.
	h.db.Model(&conv).Updates(map[string]interface{}{
		"message_count":          gorm.Expr("message_count + 1"),
		"last_message_at":        outboundEvent.CreatedAt,
		"last_message_preview":   truncate(reply, 280),
		"last_message_from_me":   true,
	})

	return c.JSON(fiber.Map{
		"reply":           reply,
		"source":          "ai",
		"session_id":      body.SessionID,
		"conversation_id": convID,
	})
}

// PublicListArticles GET /v1/public/webchat/:token/articles
func (h *WebChatHandler) PublicListArticles(c *fiber.Ctx) error {
	token := c.Params("token")
	if token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "token obrigatório")
	}

	var inst models.Instance
	if err := h.db.Where("token = ?", token).First(&inst).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}

	var cfg models.WebChatConfig
	if err := h.db.Where("instance_id = ?", inst.ID).First(&cfg).Error; err != nil || !cfg.HelpDeskEnabled {
		return fiber.NewError(fiber.StatusForbidden, "help desk não habilitado para este widget")
	}

	workspaceID := uuid.Nil
	if inst.WorkspaceID != nil {
		workspaceID = *inst.WorkspaceID
	}

	query := h.db.Model(&models.HelpDeskArticle{}).
		Where("workspace_id = ? AND status = ?", workspaceID, models.ArticlePublished)

	if q := c.Query("q"); q != "" {
		like := "%" + q + "%"
		query = query.Where("title ILIKE ? OR summary ILIKE ?", like, like)
	}

	var articles []models.HelpDeskArticle
	if err := query.Order("updated_at DESC").Limit(20).Find(&articles).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(articles)
}

// ensure clause import is used for potential future use
var _ = clause.OnConflict{}
