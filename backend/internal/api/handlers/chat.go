package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
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
	RenderedText string `json:"rendered_text,omitempty"`
	// OriginalInput = texto CRU do usuário (com tokens). Usado como
	// Journey.Prompt quando a jornada é criada via confirmação no chat —
	// sem isso o "Prompt original" exibido no card mostrava o wrapper
	// "Analise este pedido..." que mandamos pra LLM, e não o que o usuário
	// realmente escreveu.
	OriginalInput string    `json:"original_input,omitempty"`
	Mentions      []Mention `json:"mentions,omitempty"`
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

// pickUserPrompt retorna o texto original do usuário pra salvar como
// Journey.Prompt. Prioridade: OriginalInput (raw com tokens) →
// RenderedText (tokens → labels) → Message (pode ser o wrapper LLM).
// Evitar salvar "Analise este pedido de automação..." como prompt da
// jornada é o objetivo aqui.
func pickUserPrompt(req ChatRequest) string {
	if strings.TrimSpace(req.OriginalInput) != "" {
		return req.OriginalInput
	}
	if strings.TrimSpace(req.RenderedText) != "" {
		return req.RenderedText
	}
	return req.Message
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

// allMentionsOfType returns all mentions matching the given type.
func allMentionsOfType(mentions []Mention, t string) []Mention {
	out := make([]Mention, 0)
	for _, m := range mentions {
		if m.Type == t {
			out = append(out, m)
		}
	}
	return out
}

// humanTriggerLabel maps a trigger_type enum id to the Portuguese label
// shown on the confirmation dialog. Fallback to the raw id so usuários
// veem algo útil mesmo pra triggers não mapeados aqui (novos tipos).
func humanTriggerLabel(t string) string {
	switch t {
	case "any_message":            return "Qualquer mensagem"
	case "group_keyword":          return "Palavra-chave no grupo"
	case "group_message":          return "Mensagem no grupo"
	case "group_mention":          return "Menção no grupo"
	case "private_keyword":        return "Palavra-chave privada"
	case "private_message":        return "Mensagem privada"
	case "first_message":          return "Primeira mensagem"
	case "contact_media_image":    return "Recebeu imagem"
	case "contact_media_audio":    return "Recebeu áudio"
	case "contact_media_video":    return "Recebeu vídeo"
	case "contact_media_document": return "Recebeu documento"
	case "contact_call":           return "Ligação recebida"
	case "contact_call_missed":    return "Chamada perdida"
	case "contact_call_rejected":  return "Chamada rejeitada"
	case "contact_location":       return "Contato enviou localização"
	case "group_join":             return "Alguém entrou no grupo"
	case "group_leave":            return "Alguém saiu do grupo"
	case "user_command":           return "Comando (/start, /menu…)"
	case "button_click":           return "Clicou em botão"
	case "list_select":            return "Selecionou item da lista"
	case "scheduled":              return "Agendado"
	case "no_response":            return "Contato sem resposta"
	case "contact_tag":            return "Contato recebeu tag"
	}
	return t
}

// resolveGroupName tenta buscar o nome humano do grupo via whatsmeow.
// Retorna string vazia se a busca falhar (fallback pra mostrar o JID cru).
func resolveGroupName(mgr *whatsapp.Manager, instanceID, jid string) string {
	if mgr == nil || instanceID == "" || jid == "" {
		return ""
	}
	client := mgr.GetInstance(instanceID)
	if client == nil || !client.IsConnected() {
		return ""
	}
	info, err := client.GetGroupInfo(jid)
	if err != nil {
		return ""
	}
	if name, ok := info["name"].(string); ok && name != "" {
		return name
	}
	return ""
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
	if req.IntegrationID != "" && req.IntegrationID != "platform-ai" {
		if err := h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration).Error; err != nil {
			integration = nil
		}
	} else {
		// Tenta integração própria do usuário primeiro.
		h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
	}

	// Fallback: usa a Uniq AI (PlatformAI) quando o usuário não tem integração
	// própria. Permite consumir o LLM global sem configuração individual.
	if integration == nil {
		var pai models.PlatformAI
		if err := h.db.Where("is_active = true").First(&pai).Error; err == nil && pai.APIKey != "" {
			integration = services.PlatformAIToIntegration(&pai)
		}
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

		// Find integration — mesma lógica do fluxo normal: user > PlatformAI.
		var integration *models.UserIntegration
		if req.IntegrationID != "" && req.IntegrationID != "platform-ai" {
			h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration)
		}
		if integration == nil {
			h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
		}
		if integration == nil {
			var pai models.PlatformAI
			if err := h.db.Where("is_active = true").First(&pai).Error; err == nil && pai.APIKey != "" {
				integration = services.PlatformAIToIntegration(&pai)
			}
		}

		// Pula a chamada LLM quando já temos trigger + action via menções
		// explícitas — a intenção está totalmente estruturada; chamar a
		// LLM só abre espaço pra alucinação (Palavra-chave virando string
		// literal, etc). Menções populam os campos mais abaixo.
		hasExplicitTrigger := firstMention(req.Mentions, "trigger") != nil
		hasExplicitAction := firstMention(req.Mentions, "action") != nil
		canSkipLLMParse := hasExplicitTrigger && hasExplicitAction

		var parsedRules services.ParsedRules
		if canSkipLLMParse {
			log.Info().
				Str("instance", instanceID.String()).
				Msg("journey (chat): menções completas — pulando LLM parse")
			parsedRules = services.ParsedRules{}
		} else {
			pr, parseErr := h.llm.ParseJourneyPrompt(ctx, integration, promptText)
			if parseErr != nil {
				return c.JSON(fiber.Map{"response": "Entendi o pedido, mas não consegui interpretar as regras da automação: " + parseErr.Error()})
			}
			parsedRules = pr
		}

		triggerType, triggerFilter, keywords, messageTemplate := parsePromptForJourney(promptText, parsedRules)

		// Menções têm precedência sobre o que a LLM deduziu. Trigger mention
		// sobrescreve o tipo; keyword mentions alimentam a lista de keywords.
		if tm := firstMention(req.Mentions, "trigger"); tm != nil {
			triggerType = models.TriggerType(tm.ID)
			triggerFilter = humanTriggerLabel(tm.ID)
			// Quando o usuário escolhe o trigger explicitamente, também
			// anexamos o label legível ao filter pra a confirmação ficar clara.
		}
		// Keywords: se o usuário marcou /palavra explícito, isso vira regra.
		// Se NÃO marcou nenhuma palavra + a action mention é explícita,
		// descartamos o que o regex/LLM achou — provavelmente extraiu
		// "o que foi?" do label da ação e criou keyword fantasma.
		keywordMentions := allMentionsOfType(req.Mentions, "keyword")
		if len(keywordMentions) > 0 {
			rules := make([]models.KeywordRule, 0, len(keywordMentions))
			for _, m := range keywordMentions {
				word := strings.TrimSpace(m.Label)
				if word == "" {
					continue
				}
				op := "contains"
				if m.Meta != nil && m.Meta["op"] != "" {
					op = m.Meta["op"]
				}
				rules = append(rules, models.KeywordRule{Word: word, Op: op})
			}
			if len(rules) > 0 {
				if kwBytes, err := json.Marshal(rules); err == nil {
					keywords = string(kwBytes)
				}
			}
		} else if hasExplicitAction {
			// Usuário foi autoritativo na ação mas não indicou nenhuma
			// palavra. Limpa keywords extraídas por heurística — essas
			// vazavam do label/mensagem da ação.
			keywords = "[]"
		}
		// isPrivateReply é usado em vários pontos (preview + criação) — define
		// uma única vez aqui com base no texto renderizado.
		isPrivateReply := strings.Contains(strings.ToLower(promptText), "no privado") ||
			strings.Contains(strings.ToLower(promptText), "responde no privado")

		// Ação explícita (ex: /acao → Responder no privado → "feijão")
		// sobrescreve o messageTemplate deduzido. O meta.value da menção
		// carrega o conteúdo (mensagem/tag/url/etc).
		var actionID string
		if am := firstMention(req.Mentions, "action"); am != nil {
			actionID = am.ID
			val := ""
			if am.Meta != nil {
				val = am.Meta["value"]
			}
			switch am.ID {
			case "reply_private":
				messageTemplate = val
			case "reply_group":
				messageTemplate = val
			case "ai_response":
				// Não mexe no messageTemplate — o flow builder/executor lida via ai_response step
				messageTemplate = val
			case "add_tag", "remove_tag", "update_stage":
				// Mantém o valor no template para log; ação real fica em parsedRules
				messageTemplate = val
			case "webhook":
				messageTemplate = val
			case "handoff":
				messageTemplate = val
			}
		}

		// Check if this is a confirmation request
		lowerConfirm := strings.ToLower(promptText)
		isConfirmation := strings.Contains(lowerConfirm, "confirmo") || strings.Contains(lowerConfirm, "confirmar") ||
			strings.Contains(lowerConfirm, "sim") || strings.Contains(lowerConfirm, "criar") ||
			strings.Contains(lowerConfirm, "ok") || strings.Contains(lowerConfirm, "pode criar")

		// If not a confirmation, show preview and ask for confirmation
		if !isConfirmation {
			var kwList []string
			json.Unmarshal([]byte(keywords), &kwList)

			// (isPrivateReply agora é definido uma única vez acima, fora deste
			// bloco, pra ser compartilhado entre preview e criação.)

			// Resolve group — menção autoritativa (ID é o JID) > fuzzy match.
			// Preferimos o LABEL da menção (nome do grupo) pra mostrar, e o
			// JID fica no campo "id" pra persistir depois. Se só temos o JID
			// (fuzzy match), tentamos buscar o nome via whatsmeow.
			var groupJID, groupLabel string
			if m := firstMention(req.Mentions, "group"); m != nil {
				if m.Meta != nil && m.Meta["jid"] != "" {
					groupJID = m.Meta["jid"]
				} else {
					groupJID = m.ID
				}
				groupLabel = strings.TrimSpace(m.Label)
			} else if instanceID != uuid.Nil {
				groupJID = journeyHandler.resolveGroupFromPrompt(promptText, instanceID.String())
			}
			if groupJID != "" && groupLabel == "" {
				groupLabel = resolveGroupName(journeyMgr, instanceID.String(), groupJID)
			}

			// Build confirmation message with proper markdown
			response := "📋 **Confirmação de Jornada**\n\n"
			response += "Por favor, confirme se esta configuração está correta:\n\n"
			response += "**Gatilho (trigger):**\n"
			response += "- Tipo: " + humanTriggerLabel(string(triggerType)) + "\n"
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

			if groupJID != "" {
				if groupLabel != "" {
					response += "- Grupo: **" + groupLabel + "**\n"
				} else {
					response += "- Grupo: `" + groupJID + "`\n"
				}
			}

			response += "\n**Ação após gatilho:**\n"
			// Se o usuário mencionou /acao, mostramos o label humano da ação.
			if actionID != "" {
				switch actionID {
				case "reply_private":
					response += "- Responder no **privado** com: \"" + messageTemplate + "\"\n"
				case "reply_group":
					response += "- Responder no **grupo** com: \"" + messageTemplate + "\"\n"
				case "ai_response":
					response += "- Responder com IA (prompt: \"" + messageTemplate + "\")\n"
				case "add_tag":
					response += "- Adicionar tag: " + messageTemplate + "\n"
				case "remove_tag":
					response += "- Remover tag: " + messageTemplate + "\n"
				case "update_stage":
					response += "- Mover contato para etapa: " + messageTemplate + "\n"
				case "webhook":
					response += "- Chamar webhook: " + messageTemplate + "\n"
				case "handoff":
					response += "- Transferir para humano — mensagem: \"" + messageTemplate + "\"\n"
				case "end":
					response += "- Encerrar fluxo (sem resposta)\n"
				default:
					response += "- " + actionID + ": " + messageTemplate + "\n"
				}
			} else if isPrivateReply {
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
			response += "\n\n_Dica: a jornada só dispara pra mensagens de OUTRAS pessoas. " +
				"Se você testar mandando a palavra-chave do próprio número da instância, nada acontece — peça pra outro número enviar._"

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
		// kwList pode estar em formato legado (lista de strings) ou novo
		// (objetos {word, op}). Tentamos os dois pra alimentar o nome.
		var kwList []string
		var kwRules []models.KeywordRule
		if err := json.Unmarshal([]byte(keywords), &kwRules); err == nil {
			for _, r := range kwRules {
				if r.Word != "" {
					kwList = append(kwList, r.Word)
				}
			}
		}
		if len(kwList) == 0 {
			// fallback formato antigo
			_ = json.Unmarshal([]byte(keywords), &kwList)
		}

		// Ação explícita define o modo de resposta autoritativamente.
		responseMode := "private"
		if actionID == "reply_group" {
			responseMode = "group"
		} else if actionID == "" && !isPrivateReply {
			responseMode = "group"
		}

		// Nome descritivo baseado nos campos estruturados (trigger +
		// keyword + ação). Usuário pode editar depois no card.
		journeyName := buildJourneyName(promptText, triggerType, kwList, messageTemplate, responseMode)

		journey := models.Journey{
			UserID:          userID.String(),
			Name:            journeyName,
			Prompt:          pickUserPrompt(req), // texto do usuário, não o wrapper LLM
			TriggerType:     string(triggerType),
			TriggerFilter:   triggerFilter,
			Keywords:        string(keywords),
			MessageTemplate: messageTemplate,
			Status:          "active",
			InstanceID:      instanceID.String(),
			ResponseMode:    responseMode,
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

		// Delay: menção /delay > regex no texto livre. Se há action
		// explícita, geramos flow determinístico (com wait prefix se
		// delay > 0). Senão deixa flow vazio — executor usa legacyFallback
		// (que no momento não aplica delay; fica como enhancement futuro).
		if hasExplicitAction {
			delaySeconds := extractDelaySeconds(req.Mentions)
			if delaySeconds == 0 {
				delaySeconds = delayFromPromptText(promptText)
			}
			if flow := buildDeterministicFlow(messageTemplate, responseMode, delaySeconds); flow != nil {
				_ = journey.SetFlow(flow)
			}
		}

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

	// ─── Agent loop (tool-calling mode) ─────────────────────────────────
	// Use tools when explicitly requested or when message implies operational intent
	// (list, create, show, find data across modules).
	shouldUseTools := req.UseTools || isOperationalRequest(promptText)

	if shouldUseTools && h.toolsH != nil {
		var agentIntegration *models.UserIntegration
		if req.IntegrationID != "" && req.IntegrationID != "platform-ai" {
			h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&agentIntegration)
		}
		if agentIntegration == nil {
			h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID,
				[]string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).
				First(&agentIntegration)
		}
		if agentIntegration == nil {
			var pai models.PlatformAI
			if err := h.db.Where("is_active = true").First(&pai).Error; err == nil && pai.APIKey != "" {
				agentIntegration = services.PlatformAIToIntegration(&pai)
			}
		}

		if agentIntegration != nil {
			agentSystem := buildAgentSystemPrompt()
			executor := func(toolCall models.ToolCall) models.ToolResult {
				return h.toolsH.ExecuteToolCall(userID, toolCall)
			}
			response, err := h.llm.RunAgentLoop(ctx, agentIntegration, agentSystem, promptText, executor)
			if err == nil && response != "" {
				return c.JSON(fiber.Map{"response": response})
			}
			// Fall through to normal chat on agent loop error
		}
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

// isOperationalRequest detects messages that need live data from tools.
func isOperationalRequest(msg string) bool {
	operationalKeywords := []string{
		"liste", "listar", "mostrar", "mostra", "quantos", "quantas",
		"quais", "buscar", "busque", "encontre", "encontrar",
		"crie um contato", "criar contato", "crie uma empresa", "criar empresa",
		"crie um deal", "criar deal", "crie uma campanha", "criar campanha",
		"mova o deal", "mover deal", "feche a conversa", "fechar conversa",
		"atribua", "atribuir", "pause a campanha", "pausar campanha",
		"inicie a campanha", "iniciar campanha", "stats", "estatísticas",
		"dashboard", "relatório", "contatos no crm", "deals abertos",
		"campanhas ativas", "conversas abertas", "conversas pendentes",
		"funil", "pipeline", "inbox", "atendimentos",
	}
	for _, kw := range operationalKeywords {
		if contains(msg, kw) {
			return true
		}
	}
	return false
}

// buildAgentSystemPrompt returns the system prompt for the operational agent.
func buildAgentSystemPrompt() string {
	return `Você é a Uniq AI, assistente operacional da plataforma Uniq Chat.

Você tem acesso a ferramentas que operam diretamente sobre todos os módulos da plataforma:
- CRM: contatos, empresas, deals, funis/pipelines
- Campanhas: criar, listar, iniciar, pausar campanhas de disparo
- Inbox: listar e gerenciar conversas de atendimento
- Jornadas: automações WhatsApp
- Produtos/Shop: catálogo de produtos
- Estatísticas: métricas e dashboards

REGRAS:
1. Use tools para obter dados em tempo real antes de responder — nunca invente números ou IDs
2. Para operações destrutivas (deletar, fechar) peça confirmação ao usuário
3. Encadeie múltiplas tools quando necessário (ex: listar funis → listar deals do funil)
4. Responda em português brasileiro, de forma objetiva e estruturada
5. Para listas, use markdown (tabelas ou bullet points)
6. Quando criar algo (contato, deal, campanha), confirme o que foi criado

Você pode executar múltiplos tool calls em sequência para completar tarefas complexas.`
}

// GetTools retorna as tools disponíveis
func (h *ChatHandler) GetTools(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"tools": models.AvailableTools})
}
