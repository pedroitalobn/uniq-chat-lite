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
	// Opcional: texto já com tokens @[label](type:id) substituídos por labels
	// — serve como "prompt legível" pra LLM. O backend usa Mentions como
	// autoritativo na resolução de instância/grupo; o Message original mantém
	// os tokens pra rastreabilidade.
	RenderedText string    `json:"rendered_text,omitempty"`
	Mentions     []Mention `json:"mentions,omitempty"`
}

// Mention é uma menção tipada produzida pelo MentionPicker do frontend. O
// backend prefere estas entradas em vez de fuzzy matching por nome quando
// estão disponíveis; cai no parser antigo quando não houver menção do tipo
// relevante (fallback).
type Mention struct {
	Type  string            `json:"type"`  // instance|group|contact|tag|funnel|journey
	ID    string            `json:"id"`
	Label string            `json:"label"`
	Meta  map[string]string `json:"meta,omitempty"`
}

// firstMention returns the first mention of the given type, or nil.
func firstMention(mentions []Mention, t string) *Mention {
	for i := range mentions {
		if mentions[i].Type == t {
			return &mentions[i]
		}
	}
	return nil
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

	// Prefer o texto já "renderizado" (tokens → labels) para qualquer parsing
	// baseado em regex/keywords. O Message cru (com tokens) só serve para
	// auditoria. Se não veio rendered_text, assume que o message já é plano.
	promptText := req.RenderedText
	if promptText == "" {
		promptText = req.Message
	}

	// Check if user wants to create a journey
	lowerMsg := strings.ToLower(promptText)
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

		// Resolve instance from prompt — menção autoritativa antes de fuzzy match.
		var instanceID uuid.UUID
		if m := firstMention(req.Mentions, "instance"); m != nil {
			if parsed, err := uuid.Parse(m.ID); err == nil {
				// valida que pertence ao usuário
				var inst models.Instance
				if h.db.Where("id = ? AND user_id = ?", parsed, userID).First(&inst).Error == nil {
					instanceID = parsed
				}
			}
		}
		if instanceID == uuid.Nil {
			instanceID = journeyHandler.resolveInstanceFromPrompt(promptText, userID)
		}

		// Find integration
		var integration *models.UserIntegration
		if req.IntegrationID != "" {
			h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration)
		}
		if integration == nil {
			h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
		}

		parsedRules, parseErr := h.llm.ParseJourneyPrompt(ctx, integration, promptText)
		if parseErr != nil {
			return c.JSON(fiber.Map{"response": "Entendi o pedido, mas não consegui interpretar as regras da automação: " + parseErr.Error()})
		}

		triggerType, triggerFilter, keywords, messageTemplate := parsePromptForJourney(promptText, parsedRules)

		// Check if this is a confirmation request
		lowerConfirm := strings.ToLower(promptText)
		isConfirmation := strings.Contains(lowerConfirm, "confirmo") || strings.Contains(lowerConfirm, "confirmar") ||
			strings.Contains(lowerConfirm, "sim") || strings.Contains(lowerConfirm, "criar") ||
			strings.Contains(lowerConfirm, "ok") || strings.Contains(lowerConfirm, "pode criar")

		// If not a confirmation, show preview and ask for confirmation
		if !isConfirmation {
			var kwList []string
			json.Unmarshal([]byte(keywords), &kwList)

			// Detect if action is private reply
			isPrivateReply := strings.Contains(strings.ToLower(promptText), "no privado") ||
				strings.Contains(strings.ToLower(promptText), "responde no privado")

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

			// Resolve group — menção autoritativa (ID já é o JID) antes de fuzzy match.
			var groupJID string
			if m := firstMention(req.Mentions, "group"); m != nil {
				if m.Meta != nil && m.Meta["jid"] != "" {
					groupJID = m.Meta["jid"]
				} else {
					groupJID = m.ID // id do frontend é o próprio JID
				}
			} else if instanceID != uuid.Nil {
				groupJID = journeyHandler.resolveGroupFromPrompt(promptText, instanceID.String())
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

			// Add instance info to confirmation prompt
			if instanceID != uuid.Nil {
				var inst models.Instance
				if h.db.First(&inst, instanceID.String()).Error == nil {
					response += "\n_Esta jornada será executada na instância: **" + inst.Name + "_**"
				}
			}

			response += "\n\n**Responda com 'confirmo' ou 'sim' para criar a jornada.**"

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
			Prompt:          req.Message, // mantém cru com tokens para rastreabilidade
			TriggerType:     string(triggerType),
			TriggerFilter:   triggerFilter,
			Keywords:        string(keywords),
			MessageTemplate: messageTemplate,
			Status:          "active",
			InstanceID:      instanceID.String(),
		}

		// Grupo: mesma preferência menção → fuzzy.
		if m := firstMention(req.Mentions, "group"); m != nil {
			if m.Meta != nil && m.Meta["jid"] != "" {
				journey.GroupJID = m.Meta["jid"]
			} else {
				journey.GroupJID = m.ID
			}
		} else if instanceID != uuid.Nil {
			journey.GroupJID = journeyHandler.resolveGroupFromPrompt(promptText, instanceID.String())
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
	var contacts []models.Contact
	var tags []models.Tag
	var userWorkspaces []models.UserWorkspace

	h.db.Where("user_id = ?", userID).Find(&instances)
	h.db.Where("user_id = ?", userID).Find(&journeys)
	h.db.Where("user_id = ? AND is_active = true", userID).Find(&integrations)
	h.db.Where("user_id = ?", userID).Order("created_at DESC").Limit(20).Find(&contacts)
	h.db.Where("user_id = ?", userID).Find(&tags)

	// Get user's workspaces to find their funnels and stages
	h.db.Where("user_id = ?", userID).Find(&userWorkspaces)
	var workspaceIDs []string
	for _, uw := range userWorkspaces {
		workspaceIDs = append(workspaceIDs, uw.WorkspaceID.String())
	}

	// Get unique funnels and stages from contacts
	var funnels, stages []string
	if len(workspaceIDs) > 0 {
		h.db.Model(&models.Contact{}).Where("workspace_id IN (?)", workspaceIDs).Distinct("funnel").Pluck("funnel", &funnels)
		h.db.Model(&models.Contact{}).Where("workspace_id IN (?) AND funnel IS NOT NULL AND funnel != ''", workspaceIDs).Distinct("stage").Pluck("stage", &stages)
	}

	// Get workspace members for assign_user action
	var workspaceUsers []models.User
	if len(workspaceIDs) > 0 {
		h.db.Joins("JOIN user_workspaces ON user_workspaces.user_id = users.id").
			Where("user_workspaces.workspace_id IN (?)", workspaceIDs).
			Limit(10).
			Find(&workspaceUsers)
	}

	systemPrompt := buildContextPrompt(instances, journeys, integrations, contacts, tags, funnels, stages, workspaceUsers)

	response, err := h.llm.CallChatWithSystem(ctx, integration, systemPrompt, req.Message, false)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha na comunicação com a IA: " + err.Error()})
	}

	return c.JSON(fiber.Map{"response": response})
}

func buildContextPrompt(instances []models.Instance, journeys []models.Journey, integrations []models.UserIntegration, contacts []models.Contact, tags []models.Tag, funnels []string, stages []string, users []models.User) string {
	prompt := "Você é um assistente especializado em configurar automações de WhatsApp para marketing e vendas.\n\n"

	prompt += "=== SEU CONTEXTO ===\n\n"

	if len(instances) > 0 {
		prompt += "INSTÂNCIAS WHATSAPP:\n"
		for _, inst := range instances {
			prompt += "- ID: " + inst.ID.String() + ", Nome: " + inst.Name + " ("
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

	if len(users) > 0 {
		prompt += "USUÁRIOS DO WORKSPACE:\n"
		for _, u := range users {
			if u.Name != "" {
				prompt += "- " + u.Name + " (" + u.Email + ")\n"
			}
		}
		prompt += "\n"
	}

	if len(funnels) > 0 || len(stages) > 0 {
		prompt += "FUNIS E ETAPAS (CRM):\n"
		for _, f := range funnels {
			prompt += "- Funil: " + f + "\n"
		}
		for _, s := range stages {
			prompt += "  - Etapa: " + s + "\n"
		}
		prompt += "\n"
	}

	if len(tags) > 0 {
		prompt += "TAGS DISPONÍVEIS:\n"
		for _, t := range tags {
			prompt += "- " + t.Name + " (cor: " + t.Color + ")\n"
		}
		prompt += "\n"
	}

	if len(contacts) > 0 {
		prompt += "CONTATOS RECENTES:\n"
		for i, c := range contacts {
			if i >= 5 {
				prompt += fmt.Sprintf("- ... e mais %d contatos\n", len(contacts)-5)
				break
			}
			prompt += "- " + c.Name + " (" + c.Phone + ")\n"
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
			prompt += fmt.Sprintf("- %s (ID: %s, %s, %d execuções)\n", desc, j.ID, status, j.Invocations)
		}
		prompt += "\n"
	}

	prompt += `=== AÇÕES POSSÍVEIS EM JORNADAS ===
TRIGGERES (gatilhos):
- group_keyword: quando alguém enviar uma palavra-chave no grupo
- group_message: qualquer mensagem no grupo
- private_message: mensagem privada para a instância
- contact_tag: quando uma tag for adicionada/removida
- first_message: primeira mensagem de um contato novo
- group_join: quando alguém entra no grupo
- scheduled: em horário agendado

ACÇÕES (respostas/automções):
- send_message: enviar mensagem no grupo
- send_private: enviar mensagem privada para o contato
- create_contact: criar/atuauzair contato no CRM como lead
- update_stage: atualizar a etapa do funil do contato
- add_tag: adicionar uma tag ao contato
- remove_tag: remover tag do contato
- add_to_inbox: adicionar ao inbox para atendimento humano
- assign_user: atribuir a um usuário do workspace
- ai_response: usar IA para gerar resposta
- wait: aguardar X segundos antes do próximo passo

EXEMPLOS DE FLUXOS:
1. "Quando alguém dizer 'bom dia' no grupo, criar contato como lead, enviar mensaje privada de boas-vindas e adicionar à etapa 'Novos Leads'"
2. "Quando alguém entrar no grupo, verificar se já é contato no CRM, se não, criar como lead"
3. "Após 5 minutos sem resposta, adicionar ao inbox para revisão humana"

=== INSTRUÇÕES ===
- Seja direto e objetivo nas respostas
- Se o usuário quiser criar uma jornada, pergunte os detalhes ou extraia do contexto
- Para criar jornadas complexas, sugira um passo a passo se necessário
- Mantenha respostas concisas
- Sempre que possível, use dados reais do contexto acima
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
