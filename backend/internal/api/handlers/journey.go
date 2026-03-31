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

type JourneyHandler struct {
	db      *gorm.DB
	llm     *services.LLMService
	manager *whatsapp.Manager
}

func NewJourneyHandler(db *gorm.DB, llm *services.LLMService, manager *whatsapp.Manager) *JourneyHandler {
	return &JourneyHandler{db: db, llm: llm, manager: manager}
}

func (h *JourneyHandler) currentUserID(c *fiber.Ctx) (uuid.UUID, error) {
	raw := c.Locals("user_id")
	if raw == nil {
		return uuid.Nil, fiber.NewError(fiber.StatusUnauthorized, "não autenticado")
	}
	id, ok := raw.(uuid.UUID)
	if !ok {
		return uuid.Nil, fiber.NewError(fiber.StatusUnauthorized, "ID de usuário inválido")
	}
	return id, nil
}

// CreateJourney POST /api/journeys
func (h *JourneyHandler) CreateJourney(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	var req struct {
		Prompt        string `json:"prompt"`
		IntegrationID string `json:"integration_id"`
		InstanceID    string `json:"instance_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.Prompt == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "prompt inválido ou vazio"})
	}

	// Fetch integration if provided, or find default
	var integration *models.UserIntegration
	if req.IntegrationID != "" {
		h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration)
	}
	if integration == nil {
		h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	parsedRules, err := h.llm.ParseJourneyPrompt(ctx, integration, req.Prompt)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha ao interpretar jornada: " + err.Error()})
	}

	// Parse the prompt to extract trigger details
	triggerType, triggerFilter, keywords, messageTemplate := parsePromptForJourney(req.Prompt, parsedRules)

	journey := models.Journey{
		UserID:          userID.String(),
		Prompt:          req.Prompt,
		TriggerType:     string(triggerType),
		TriggerFilter:   triggerFilter,
		Keywords:        keywords,
		MessageTemplate: messageTemplate,
		Status:          "active",
		Invocations:     0,
		ResponseMode:    "private",
	}

	// Resolve instance by ID or by name from prompt
	var resolvedInstanceID string
	if req.InstanceID != "" {
		resolvedInstanceID = req.InstanceID
	} else {
		// Try to find instance name mentioned in prompt (e.g. "instância pedro-sp")
		if instUUID := h.resolveInstanceFromPrompt(req.Prompt, userID); instUUID != uuid.Nil {
			resolvedInstanceID = instUUID.String()
		}
	}
	journey.InstanceID = resolvedInstanceID

	// Resolve group JID from prompt if instance is known
	if resolvedInstanceID != "" {
		journey.GroupJID = h.resolveGroupFromPrompt(req.Prompt, resolvedInstanceID)
	}

	// Parse prompt for structured flow using LLM executor
	var instances []models.Instance
	h.db.Where("user_id = ?", userID).Find(&instances)

	rulesBytes, err := json.Marshal(parsedRules)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha interna ao codificar regras"})
	}
	journey.ParsedRules = string(rulesBytes)

	// Gerar nome da jornada baseado no prompt
	if journey.Name == "" {
		journey.Name = generateJourneyName(req.Prompt, triggerType)
	}

	if err := h.db.Create(&journey).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar jornada no banco"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":               journey.ID,
		"name":             journey.Name,
		"description":      journey.Description,
		"prompt":           journey.Prompt,
		"status":           journey.Status,
		"trigger_type":     journey.TriggerType,
		"trigger_filter":   journey.TriggerFilter,
		"keywords":         keywords,
		"message_template": journey.MessageTemplate,
		"group_jid":        journey.GroupJID,
		"instance_id":      journey.InstanceID,
		"response_mode":    journey.ResponseMode,
		"parsed_rules":     parsedRules,
		"flow":             journey.GetFlow(),
		"invocations":      journey.Invocations,
		"created_at":       journey.CreatedAt,
	})
}

// generateJourneyName gera um nome descritivo para a jornada
func generateJourneyName(prompt string, triggerType models.TriggerType) string {
	lower := strings.ToLower(prompt)

	// Extrair contexto do prompt
	name := ""
	if strings.Contains(lower, "bom dia") || strings.Contains(lower, "good morning") {
		name = "Saudação - Bom Dia"
	} else if strings.Contains(lower, "oi") || strings.Contains(lower, "olá") || strings.Contains(lower, "hello") {
		name = "Resposta - Saudação"
	} else if strings.Contains(lower, "agradecer") || strings.Contains(lower, "obrigado") {
		name = "Agradecimento"
	} else if strings.Contains(lower, "suporte") || strings.Contains(lower, "ajuda") {
		name = "Suporte Automático"
	} else if strings.Contains(lower, "comprar") || strings.Contains(lower, "preço") || strings.Contains(lower, "valor") {
		name = "Vendas - Informações"
	} else if strings.Contains(lower, "agendar") || strings.Contains(lower, "horário") {
		name = "Agendamento"
	} else {
		// Usar o trigger type como base
		switch triggerType {
		case models.TriggerGroupKeyword:
			name = "Automação de Grupo"
		case models.TriggerPrivateKeyword:
			name = "Automação Privada"
		case models.TriggerGroupJoin:
			name = "Boas-Vindas"
		default:
			name = "Jornada Automática"
		}
	}

	return name
}

// resolveInstanceFromPrompt tries to find an instance by name mentioned in the prompt
func (h *JourneyHandler) resolveInstanceFromPrompt(prompt string, userID uuid.UUID) uuid.UUID {
	var instances []models.Instance
	if err := h.db.Where("user_id = ?", userID).Find(&instances).Error; err != nil {
		return uuid.Nil
	}

	lower := strings.ToLower(prompt)
	// Look for "instância X", "/instancia X", "instancia X"
	for _, inst := range instances {
		instName := strings.ToLower(inst.Name)
		if strings.Contains(lower, instName) ||
			strings.Contains(lower, "/"+instName) {
			return inst.ID
		}
	}
	// If only one instance, use it
	if len(instances) == 1 {
		return instances[0].ID
	}
	return uuid.Nil
}

// resolveGroupFromPrompt tries to match a group name from the prompt to a real group JID
func (h *JourneyHandler) resolveGroupFromPrompt(prompt string, instanceID string) string {
	if h.manager == nil || instanceID == "" {
		return ""
	}
	client := h.manager.GetInstance(instanceID)
	if client == nil {
		return ""
	}

	groups, err := client.GetJoinedGroups()
	if err != nil || len(groups) == 0 {
		return ""
	}

	lower := strings.ToLower(prompt)
	// Look for "grupo X", "@X", "/grupo X"
	for _, g := range groups {
		gName := strings.ToLower(fmt.Sprintf("%v", g["name"]))
		if gName == "" {
			continue
		}
		if strings.Contains(lower, gName) ||
			strings.Contains(lower, "@"+gName) ||
			strings.Contains(lower, "/grupo "+gName) {
			return fmt.Sprintf("%v", g["jid"])
		}
	}
	return ""
}

func parsePromptForJourney(prompt string, rules services.ParsedRules) (models.TriggerType, string, string, string) {
	triggerType := models.TriggerGroupKeyword
	lowerPrompt := strings.ToLower(prompt)

	// Determine trigger type
	if strings.Contains(lowerPrompt, "privado") || strings.Contains(lowerPrompt, " dm") || strings.Contains(lowerPrompt, " mp") {
		if !strings.Contains(lowerPrompt, "grupo") {
			triggerType = models.TriggerPrivateKeyword
		}
	}

	// Extract keywords between quotes or after "palavra", "falar", "escrever", "digitar", "mencionar"
	keywords := extractKeywords(prompt, lowerPrompt)

	// Extract message template from prompt
	messageTemplate := extractMessageTemplate(prompt, lowerPrompt)

	// Use rule filter or default
	triggerFilter := rules.Trigger.Filter
	if triggerFilter == "" {
		triggerFilter = string(triggerType)
	}

	keywordsJSON, _ := json.Marshal(keywords)
	return triggerType, triggerFilter, string(keywordsJSON), messageTemplate
}

// extractKeywords pulls quoted words or words after keyword verbs from the prompt
func extractKeywords(prompt, lower string) []string {
	keywords := []string{}

	// Extract words in single or double quotes
	for _, sep := range []string{"'", `"`} {
		parts := strings.Split(prompt, sep)
		for i := 1; i < len(parts); i += 2 {
			word := strings.TrimSpace(parts[i])
			if word != "" && len(word) < 50 {
				keywords = append(keywords, strings.ToLower(word))
			}
		}
	}

	if len(keywords) > 0 {
		return keywords
	}

	// Fallback: look for keywords after trigger verbs
	triggerVerbs := []string{"falar ", "falar a palavra ", "mencionar ", "escrever ", "digitar ", "palavra "}
	for _, verb := range triggerVerbs {
		idx := strings.Index(lower, verb)
		if idx == -1 {
			continue
		}
		rest := strings.TrimSpace(prompt[idx+len(verb):])
		// Get first word/phrase until space or punctuation
		for _, delim := range []string{" ", ",", ".", ";", "\n"} {
			if i := strings.Index(rest, delim); i > 0 {
				rest = rest[:i]
				break
			}
		}
		rest = strings.Trim(rest, `"'`)
		if rest != "" && len(rest) < 50 {
			keywords = append(keywords, strings.ToLower(rest))
			break
		}
	}

	return keywords
}

// extractMessageTemplate extracts the message to send from the prompt
func extractMessageTemplate(prompt, lower string) string {
	// Look for "mande/envie/responda ... 'message'" or "mensagem de ..."
	messagePhrases := []string{
		"mande ",
		"envie ",
		"responda com ",
		"responda ",
		"mensagem de ",
		"mensagem: ",
		"diga ",
		"fale ",
	}

	for _, phrase := range messagePhrases {
		idx := strings.Index(lower, phrase)
		if idx == -1 {
			continue
		}
		rest := strings.TrimSpace(prompt[idx+len(phrase):])

		// Extract quoted string first
		for _, sep := range []string{`"`, "'"} {
			if strings.HasPrefix(rest, sep) {
				end := strings.Index(rest[1:], sep)
				if end >= 0 {
					return rest[1 : end+1]
				}
			}
		}

		// Get up to end of sentence
		for _, delim := range []string{"\n", ".", ";", " e ", " para "} {
			if i := strings.Index(rest, delim); i > 0 && i < 80 {
				return strings.TrimSpace(rest[:i])
			}
		}
		if len(rest) < 120 {
			return strings.TrimSpace(rest)
		}
	}

	return ""
}

// ListJourneys GET /api/journeys
func (h *JourneyHandler) ListJourneys(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	var journeys []models.Journey
	if err := h.db.Preload("Instance").Where("user_id = ?", userID).Order("created_at DESC").Find(&journeys).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar jornadas"})
	}

	// Enriquecer cada jornada com estatísticas de execuções
	type JourneyWithStats struct {
		models.Journey
		InstanceName   string  `json:"instance_name"`
		ActiveExecs    int64   `json:"active_executions"`
		CompletedExecs int64   `json:"completed_executions"`
		CompletionRate float64 `json:"completion_rate"`
	}

	result := make([]JourneyWithStats, len(journeys))
	for i, j := range journeys {
		var activeExecs, completedExecs int64
		h.db.Model(&models.JourneyExecution{}).Where("journey_id = ? AND status = 'active'", j.ID).Count(&activeExecs)
		h.db.Model(&models.JourneyExecution{}).Where("journey_id = ? AND status = 'completed'", j.ID).Count(&completedExecs)

		totalExecs := j.Invocations
		completionRate := 0.0
		if totalExecs > 0 {
			completionRate = float64(completedExecs) / float64(totalExecs) * 100
		}

		instanceName := ""
		if j.InstanceID != "" {
			var inst models.Instance
			if h.db.Where("id = ?", j.InstanceID).First(&inst).Error == nil {
				instanceName = inst.Name
			}
		}

		result[i] = JourneyWithStats{
			Journey:        j,
			InstanceName:   instanceName,
			ActiveExecs:    activeExecs,
			CompletedExecs: completedExecs,
			CompletionRate: completionRate,
		}
	}

	return c.JSON(result)
}

// ToggleStatus PATCH /api/journeys/:id/status
func (h *JourneyHandler) ToggleStatus(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	id := c.Params("id")
	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := c.BodyParser(&req); err != nil || (req.Status != "active" && req.Status != "paused") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "status inválido (use active ou paused)"})
	}

	journey.Status = req.Status
	h.db.Save(&journey)

	return c.JSON(fiber.Map{"status": journey.Status})
}

// DeleteJourney DELETE /api/journeys/:id
func (h *JourneyHandler) DeleteJourney(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	id := c.Params("id")
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.Journey{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao deletar jornada"})
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// GetJourney GET /api/journeys/:id
func (h *JourneyHandler) GetJourney(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	id := c.Params("id")
	var journey models.Journey
	if err := h.db.Preload("Instance").Where("id = ? AND user_id = ?", id, userID).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	// Buscar estatísticas de execuções
	var activeExecs, completedExecs, failedExecs int64
	h.db.Model(&models.JourneyExecution{}).Where("journey_id = ? AND status = 'active'", journey.ID).Count(&activeExecs)
	h.db.Model(&models.JourneyExecution{}).Where("journey_id = ? AND status = 'completed'", journey.ID).Count(&completedExecs)
	h.db.Model(&models.JourneyExecution{}).Where("journey_id = ? AND status = 'failed'", journey.ID).Count(&failedExecs)

	// Buscar execuções recentes
	var recentExecs []models.JourneyExecution
	h.db.Where("journey_id = ?", journey.ID).Order("started_at DESC").Limit(10).Find(&recentExecs)

	return c.JSON(fiber.Map{
		"journey":              journey,
		"active_executions":    activeExecs,
		"completed_executions": completedExecs,
		"failed_executions":    failedExecs,
		"recent_executions":    recentExecs,
		"flow":                 journey.GetFlow(),
		"keywords":             journey.GetKeywords(),
	})
}

// ExecuteJourney is called internally when a message matches a journey trigger
func (h *JourneyHandler) ExecuteJourney(journey *models.Journey, fromJID, fromName, messageText string) error {
	if h.manager == nil {
		return nil
	}

	// Find the instance client
	client := h.manager.GetInstance(journey.InstanceID)
	if client == nil {
		return nil
	}

	// Build the response message
	responseMsg := buildResponseFromJourney(journey, fromName)

	// Send private message to the sender (use @s.whatsapp.net if just number provided)
	recipientJID := fromJID
	if !strings.Contains(fromJID, "@") {
		recipientJID = fromJID + "@s.whatsapp.net"
	}

	if _, err := client.SendTextMessage(recipientJID, responseMsg); err != nil {
		return err
	}

	// Update invocation count
	now := time.Now()
	h.db.Model(journey).Updates(map[string]interface{}{
		"invocations": journey.Invocations + 1,
		"last_run_at": now,
	})

	return nil
}

func buildResponseFromJourney(journey *models.Journey, fromName string) string {
	if journey.MessageTemplate != "" {
		return strings.ReplaceAll(journey.MessageTemplate, "{{name}}", fromName)
	}

	var rules services.ParsedRules
	rulesJSON, err := json.Marshal(journey.ParsedRules)
	if err != nil {
		return "Olá " + fromName + "! Recebi sua mensagem e estou processando."
	}
	if err := json.Unmarshal(rulesJSON, &rules); err != nil {
		return "Olá " + fromName + "! Recebi sua mensagem e estou processando."
	}

	if len(rules.Actions) > 0 && rules.Actions[0].Text != "" {
		return "Olá " + fromName + "! " + rules.Actions[0].Text
	}

	return "Olá " + fromName + "! Obrigado por entrar em contato. Como posso ajudar?"
}
