package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ChatHandler struct {
	db     *gorm.DB
	llm    *services.LLMService
	toolsH *ToolsHandler
}

func NewChatHandler(db *gorm.DB, llm *services.LLMService) *ChatHandler {
	return &ChatHandler{db: db, llm: llm}
}

func (h *ChatHandler) SetToolsHandler(toolsH *ToolsHandler) {
	h.toolsH = toolsH
}

type ChatRequest struct {
	IntegrationID string `json:"integration_id"`
	Model         string `json:"model"` // specific model to use (optional)
	Message       string `json:"message"`
	UseTools      bool   `json:"use_tools"`
}

type ToolCall struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

func (h *ChatHandler) HandleChat(c *fiber.Ctx) error {
	var req ChatRequest
	if err := c.BodyParser(&req); err != nil || req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "mensagem inválida ou vazia"})
	}

	raw := c.Locals("user_id")
	if raw == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	userID := raw.(uuid.UUID)

	var integration *models.UserIntegration
	if req.IntegrationID != "" {
		if err := h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration).Error; err != nil {
			integration = nil
		}
	} else {
		h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Check if user wants to create a journey
	lowerMsg := strings.ToLower(req.Message)
	isJourneyRequest := contains(lowerMsg, "crie") || contains(lowerMsg, "criar") ||
		contains(lowerMsg, "automação") || contains(lowerMsg, "automacao") ||
		contains(lowerMsg, "jornada") || contains(lowerMsg, "campanha") ||
		contains(lowerMsg, "quando alguém") || contains(lowerMsg, "quando alguem") ||
		contains(lowerMsg, "toda vez que")

	if isJourneyRequest {
		var journeyMgr *whatsapp.Manager
		if h.toolsH != nil {
			journeyMgr = h.toolsH.manager
		}
		journeyHandler := &JourneyHandler{db: h.db, llm: h.llm, manager: journeyMgr}

		// Resolve instance from prompt
		instanceID := journeyHandler.resolveInstanceFromPrompt(req.Message, userID)

		// Find integration
		var integration *models.UserIntegration
		if req.IntegrationID != "" {
			h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration)
		}
		if integration == nil {
			h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
		}

		parsedRules, parseErr := h.llm.ParseJourneyPrompt(ctx, integration, req.Message)
		if parseErr != nil {
			return c.JSON(fiber.Map{"response": "Entendi o pedido, mas não consegui interpretar as regras da automação: " + parseErr.Error()})
		}

		triggerType, triggerFilter, keywords, messageTemplate := parsePromptForJourney(req.Message, parsedRules)

		// Check if this is a confirmation request
		lowerConfirm := strings.ToLower(req.Message)
		isConfirmation := strings.Contains(lowerConfirm, "confirmo") || strings.Contains(lowerConfirm, "confirmar") ||
			strings.Contains(lowerConfirm, "sim") || strings.Contains(lowerConfirm, "criar") ||
			strings.Contains(lowerConfirm, "ok") || strings.Contains(lowerConfirm, "pode criar")

		// If not a confirmation, show preview and ask for confirmation
		if !isConfirmation {
			var kwList []string
			json.Unmarshal([]byte(keywords), &kwList)

			// Detect if action is private reply
			isPrivateReply := strings.Contains(strings.ToLower(req.Message), "no privado") ||
				strings.Contains(strings.ToLower(req.Message), "responde no privado")

			// Build confirmation message with proper markdown
			response := "📋 **Confirmação de Jornada**\n\n"
			response += "Por favor, confirme se esta configuração está correta:\n\n"
			response += "**Gatilho (trigger):**\n"
			response += "- Tipo: " + string(triggerType) + "\n"
			response += "- Filtro: " + triggerFilter + "\n"

			if len(kwList) > 0 {
				response += "- Palavras-chave: " + strings.Join(kwList, ", ") + "\n"
			}

			if instanceID != uuid.Nil {
				var inst models.Instance
				if h.db.First(&inst, instanceID.String()).Error == nil {
					response += "- **Instância:** " + inst.Name + "\n"
				}
			}

			// Resolve group
			var groupJID string
			if instanceID != uuid.Nil {
				groupJID = journeyHandler.resolveGroupFromPrompt(req.Message, instanceID.String())
			}
			if groupJID != "" {
				response += "- Grupo: " + groupJID + "\n"
			}

			response += "\n**Ação após gatilho:**\n"
			if isPrivateReply {
				response += "- Responder no **privado** com: \"" + messageTemplate + "\"\n"
			} else if messageTemplate != "" {
				response += "- Enviar mensagem: \"" + messageTemplate + "\"\n"
			} else {
				response += "- Responder ao contato/grupo\n"
			}

			response += "\n**Responda com 'confirmo' ou 'sim' para criar a jornada.**"

			return c.JSON(fiber.Map{
				"response":        response,
				"journey_preview": true,
				"pending_journey": map[string]interface{}{
					"trigger_type":     string(triggerType),
					"trigger_filter":   triggerFilter,
					"keywords":         keywords,
					"message_template": messageTemplate,
					"instance_id":      instanceID.String(),
					"group_jid":        groupJID,
					"parsed_rules":     parsedRules,
					"prompt":           req.Message,
					"is_private_reply": isPrivateReply,
				},
			})
		}

		// User confirmed - create the journey
		var kwList []string
		json.Unmarshal([]byte(keywords), &kwList)

		journeyName := "Jornada " + time.Now().Format("02/01 15:04")
		if len(kwList) > 0 {
			journeyName = "Palavra: " + strings.Join(kwList, ", ")
		}

		journey := models.Journey{
			UserID:          userID.String(),
			Name:            journeyName,
			Prompt:          req.Message,
			TriggerType:     string(triggerType),
			TriggerFilter:   triggerFilter,
			Keywords:        string(keywords),
			MessageTemplate: messageTemplate,
			Status:          "active",
			InstanceID:      instanceID.String(),
		}

		if instanceID != uuid.Nil {
			journey.GroupJID = journeyHandler.resolveGroupFromPrompt(req.Message, instanceID.String())
		}

		rulesBytes, _ := json.Marshal(parsedRules)
		journey.ParsedRules = string(rulesBytes)

		if err := h.db.Create(&journey).Error; err != nil {
			return c.JSON(fiber.Map{"response": "Entendi o pedido, mas ocorreu um erro ao salvar a jornada: " + err.Error()})
		}

		// Build success response
		response := "✅ Jornada criada com sucesso!\n\n"
		response += "**Resumo da automação:**\n"
		response += "- **Gatilho:** " + triggerFilter + "\n"
		if len(kwList) > 0 {
			response += "- **Palavras-chave:** " + strings.Join(kwList, ", ") + "\n"
		}
		if messageTemplate != "" {
			response += "- **Mensagem automática:** " + messageTemplate + "\n"
		}
		if instanceID != uuid.Nil {
			var inst models.Instance
			if h.db.First(&inst, instanceID.String()).Error == nil {
				response += "- **Instância:** " + inst.Name + "\n"
			}
		}
		if journey.GroupJID != "" {
			response += "- **Grupo:** " + journey.GroupJID + "\n"
		}
		response += "\nA jornada está **ativa** e será executada automaticamente quando as condições forem atendidas."

		return c.JSON(fiber.Map{"response": response, "journey_created": true, "journey_id": journey.ID})
	}

	// Normal chat with context
	var instances []models.Instance
	var journeys []models.Journey
	var integrations []models.UserIntegration

	h.db.Where("user_id = ?", userID).Find(&instances)
	h.db.Where("user_id = ?", userID).Find(&journeys)
	h.db.Where("user_id = ? AND is_active = true", userID).Find(&integrations)

	systemPrompt := buildContextPrompt(instances, journeys, integrations)

	response, err := h.llm.CallChatWithSystem(ctx, integration, systemPrompt, req.Message, false)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha na comunicação com a IA: " + err.Error()})
	}

	return c.JSON(fiber.Map{"response": response})
}

func buildContextPrompt(instances []models.Instance, journeys []models.Journey, integrations []models.UserIntegration) string {
	prompt := "Você é um assistente especializado em configurar automações de WhatsApp.\n\n"

	prompt += "=== SEU CONTEXTO ===\n\n"

	if len(instances) > 0 {
		prompt += "INSTÂNCIAS WHATSAPP:\n"
		for _, inst := range instances {
			prompt += "- " + inst.Name + " ("
			if inst.Status == models.StatusConnected {
				prompt += "conectada"
			} else {
				prompt += "desconectada"
			}
			if inst.PhoneNumber != "" {
				prompt += ", " + inst.PhoneNumber
			}
			prompt += ")\n"
		}
		prompt += "\n"
	}

	if len(integrations) > 0 {
		prompt += "INTEGRAÇÕES DE IA:\n"
		for _, i := range integrations {
			model := i.GetFirstModel()
			if model == "" {
				model = "padrão"
			}
			prompt += "- " + i.Name + " (" + string(i.Provider) + ", modelo: " + model + ")\n"
		}
		prompt += "\n"
	}

	if len(journeys) > 0 {
		prompt += "JORNADAS DE AUTOMAÇÃO:\n"
		for i, j := range journeys {
			if i >= 5 {
				prompt += fmt.Sprintf("- ... e mais %d jornadas\n", len(journeys)-5)
				break
			}
			status := "ativa"
			if j.Status == "paused" {
				status = "pausada"
			}
			desc := j.Prompt
			if len(desc) > 60 {
				desc = desc[:60] + "..."
			}
			prompt += fmt.Sprintf("- %s (%s, %d execuções)\n", desc, status, j.Invocations)
		}
		prompt += "\n"
	}

	prompt += `=== INSTRUÇÕES ===
- Seja direto e objetivo nas respostas
- Se o usuário quiser criar uma jornada, pergunte os detalhes ou extraia do contexto
- Para enviar mensagens, use a tool send_message
- Para listar grupos, use list_groups
- Mantenha respostas concisas
`

	return prompt
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && func() bool {
		for i := 0; i <= len(s)-len(substr); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	}()
}

// GetTools retorna as tools disponíveis
func (h *ChatHandler) GetTools(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"tools": models.AvailableTools})
}
