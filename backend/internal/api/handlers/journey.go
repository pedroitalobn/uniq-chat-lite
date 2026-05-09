package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
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

type JourneyHandler struct {
	db      *gorm.DB
	llm     *services.LLMService
	manager *whatsapp.Manager
	builder *services.FlowBuilder
}

func NewJourneyHandler(db *gorm.DB, llm *services.LLMService, manager *whatsapp.Manager) *JourneyHandler {
	return &JourneyHandler{
		db:      db,
		llm:     llm,
		manager: manager,
		builder: services.NewFlowBuilder(llm),
	}
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

	// Limite de jornadas por CONTA. Membros herdam plano do dono do workspace
	// (resolveEffectivePlan). Sem workspace context aqui (jornadas têm
	// instance_id, não workspace_id direto), inferimos pelo workspace da
	// instância referenciada — primeiro carregamos o user pra ter Plan default.
	var user models.User
	if err := h.db.Preload("Plan").First(&user, userID).Error; err == nil {
		// Tenta resolver workspace pelo header ou fallback pro default do user
		var wsUUID *uuid.UUID
		if def := resolveDefaultWorkspaceID(h.db, userID); def != uuid.Nil {
			wsUUID = &def
		}
		ownerID, plan := resolveEffectivePlan(h.db, &user, wsUUID)
		if plan != nil && plan.MaxJourneys > 0 {
			var count int64
			// Conta jornadas em todos workspaces que o owner é dono
			h.db.Model(&models.Journey{}).
				Where("user_id = ? OR instance_id IN (SELECT CAST(id AS TEXT) FROM instances WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?))",
					ownerID.String(), ownerID).
				Count(&count)
			if int(count) >= plan.MaxJourneys {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "limite de jornadas atingido para o plano do workspace",
					"limit": plan.MaxJourneys,
				})
			}
		}
	}

	var req struct {
		Prompt        string    `json:"prompt"`
		IntegrationID string    `json:"integration_id"`
		InstanceID    string    `json:"instance_id"`
		RenderedText  string    `json:"rendered_text,omitempty"`
		// OriginalInput é a mensagem CRUA que o usuário escreveu (com tokens
		// @[label](type:id) embutidos). Salva em Journey.Prompt pra exibir
		// "Prompt original" no card da jornada; sem isso acabávamos salvando
		// o wrapper "Analise este pedido..." que mandamos pra LLM.
		OriginalInput string    `json:"original_input,omitempty"`
		Mentions      []Mention `json:"mentions,omitempty"`
		// Blank=true cria uma jornada pronta pra ser editada no canvas,
		// sem chamar LLM. Prompt pode vir vazio; criamos um flow inicial
		// mínimo (message "Olá") e status=paused.
		Blank bool   `json:"blank,omitempty"`
		Name  string `json:"name,omitempty"` // opcional — usado quando Blank
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "requisição inválida"})
	}
	if !req.Blank && req.Prompt == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "prompt inválido ou vazio"})
	}

	// Log diagnóstico: mostra exatamente que mentions chegaram do frontend.
	// Ajuda a debugar "por que meu trigger/group/action não foi salvo" —
	// se o mention não aparece aqui, o bug é no frontend (picker/roundtrip).
	if !req.Blank && len(req.Mentions) > 0 {
		mentionSummary := make([]string, 0, len(req.Mentions))
		for _, m := range req.Mentions {
			val := ""
			if m.Meta != nil {
				val = m.Meta["value"]
				if val == "" {
					val = m.Meta["jid"]
				}
			}
			mentionSummary = append(mentionSummary, fmt.Sprintf("%s:%s[%s]=%q", m.Type, m.ID, m.Label, val))
		}
		log.Info().
			Strs("mentions", mentionSummary).
			Int("count", len(req.Mentions)).
			Msg("journey: criando com mentions")
	}

	if req.Blank {
		return h.createBlankJourney(c, userID, req.Name, req.InstanceID)
	}

	// Usa rendered_text (tokens → labels) como fonte pro parser/LLM. Mantém
	// Prompt original (com tokens @[…](type:id)) para rastreabilidade.
	promptText := req.RenderedText
	if promptText == "" {
		promptText = req.Prompt
	}

	// Fetch integration if provided, or find default
	var integration *models.UserIntegration
	if req.IntegrationID != "" {
		h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration)
	}
	if integration == nil {
		h.db.Where("user_id = ? AND is_active = true AND provider IN ?", userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"}).First(&integration)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Checa se já temos dados estruturados suficientes via menções. Se sim,
	// pulamos a chamada LLM de parse — a intenção está toda capturada e
	// chamar a LLM só abre espaço pra alucinação.
	hasExplicitAction := firstMention(req.Mentions, "action") != nil
	hasExplicitTrigger := firstMention(req.Mentions, "trigger") != nil
	canSkipLLMParse := hasExplicitAction && hasExplicitTrigger

	var parsedRules services.ParsedRules
	if canSkipLLMParse {
		// Estrutura vazia; menções vão popular os campos mais abaixo.
		parsedRules = services.ParsedRules{}
	} else {
		var err error
		parsedRules, err = h.llm.ParseJourneyPrompt(ctx, integration, promptText)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha ao interpretar jornada: " + err.Error()})
		}
	}

	// Parse the prompt to extract trigger details
	triggerType, triggerFilter, keywords, messageTemplate := parsePromptForJourney(promptText, parsedRules)

	// Menções de trigger/keyword/action sobrescrevem o que foi deduzido
	// pela LLM — o usuário é autoritativo.
	if tm := firstMention(req.Mentions, "trigger"); tm != nil {
		triggerType = models.TriggerType(tm.ID)
		triggerFilter = humanTriggerLabel(tm.ID)
	}
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
		// Ação explícita sem /palavra indica que o usuário não quer
		// filtro por palavra — ignora keywords que o regex/LLM achou
		// (tipicamente vazam do label da ação, tipo "o que foi?").
		keywords = "[]"
	}
	// Action mention define a ação real: seu meta.value vira o
	// messageTemplate (ou nome da tag, URL do webhook, etc).
	var actionID string
	responseMode := "private"
	if am := firstMention(req.Mentions, "action"); am != nil {
		actionID = am.ID
		val := ""
		if am.Meta != nil {
			val = am.Meta["value"]
		}
		switch am.ID {
		case "reply_private":
			messageTemplate = val
			responseMode = "private"
		case "reply_group":
			messageTemplate = val
			responseMode = "group"
		case "ai_response", "add_tag", "remove_tag", "update_stage", "webhook", "handoff":
			messageTemplate = val
		}
	}

	// Delay: menção /delay tem prioridade; fallback é regex no texto livre
	// ("delay de 5s", "aguardar 2 min", etc).
	delaySeconds := extractDelaySeconds(req.Mentions)
	if delaySeconds == 0 {
		delaySeconds = delayFromPromptText(promptText)
	}

	// Flow: dois caminhos.
	//  1) Action mention explícita → monta flow determinístico. Se houver
	//     delay, o flow sai com wait → message. Sem delay, direto 1 step
	//     de message. Zero alucinação, visível no card.
	//  2) Prompt 100% livre (sem action mention) → LLM FlowBuilder gera
	//     o flow. Se detectamos delay via regex mas a LLM não gerou um
	//     wait step, envolvemos o flow original com wait no começo.
	var flow *models.JourneyFlow
	if hasExplicitAction {
		flow = buildDeterministicFlow(messageTemplate, responseMode, delaySeconds)
	} else if h.builder != nil {
		if f, fErr := h.builder.Build(ctx, integration, promptText); fErr == nil {
			flow = f
		}
	}

	// Usa o texto CRU do usuário (com tokens) como Prompt visível no card.
	// Se não veio, cai pra req.Prompt (que pode ser o wrapper da LLM, mas
	// pelo menos não quebra).
	displayPrompt := req.OriginalInput
	if strings.TrimSpace(displayPrompt) == "" {
		displayPrompt = req.Prompt
	}

	journey := models.Journey{
		ID:              uuid.New().String(),
		UserID:          userID.String(),
		Prompt:          displayPrompt,
		TriggerType:     string(triggerType),
		TriggerFilter:   triggerFilter,
		Keywords:        keywords,
		MessageTemplate: messageTemplate,
		Status:          "active",
		Invocations:     0,
		ResponseMode:    responseMode,
	}
	_ = actionID // reservado pra futuras actions que precisem de lógica extra

	// Resolve instance: explicit ID > mention > fuzzy prompt match.
	var resolvedInstanceID string
	if req.InstanceID != "" {
		resolvedInstanceID = req.InstanceID
	}
	if resolvedInstanceID == "" {
		if m := firstMention(req.Mentions, "instance"); m != nil {
			if parsed, err := uuid.Parse(m.ID); err == nil {
				var inst models.Instance
				if h.db.Where("id = ? AND user_id = ?", parsed, userID).First(&inst).Error == nil {
					resolvedInstanceID = parsed.String()
				}
			}
		}
	}
	if resolvedInstanceID == "" {
		if instUUID := h.resolveInstanceFromPrompt(promptText, userID); instUUID != uuid.Nil {
			resolvedInstanceID = instUUID.String()
		}
	}
	journey.InstanceID = resolvedInstanceID

	// Resolve group: menção > fuzzy.
	if m := firstMention(req.Mentions, "group"); m != nil {
		if m.Meta != nil && m.Meta["jid"] != "" {
			journey.GroupJID = m.Meta["jid"]
		} else {
			journey.GroupJID = m.ID
		}
	} else if resolvedInstanceID != "" {
		journey.GroupJID = h.resolveGroupFromPrompt(promptText, resolvedInstanceID)
	}

	// Parse prompt for structured flow using LLM executor
	var instances []models.Instance
	h.db.Where("user_id = ?", userID).Find(&instances)

	rulesBytes, err := json.Marshal(parsedRules)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha interna ao codificar regras"})
	}
	journey.ParsedRules = string(rulesBytes)

	// Persistir flow estruturado se o builder retornou
	if flow != nil {
		_ = journey.SetFlow(flow)
	}

	// Gerar nome da jornada baseado nos campos estruturados. Passa a lista
	// efetiva de keywords + messageTemplate + mode pra ser descritivo:
	// "kw 'arroz' em grupo → DM: feijão" em vez de "Resposta - Saudação".
	if journey.Name == "" {
		kwWords := []string{}
		var rules []models.KeywordRule
		if err := json.Unmarshal([]byte(keywords), &rules); err == nil {
			for _, r := range rules {
				if r.Word != "" {
					kwWords = append(kwWords, r.Word)
				}
			}
		}
		journey.Name = buildJourneyName(promptText, triggerType, kwWords, messageTemplate, responseMode)
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
// generateJourneyName monta um nome descritivo baseado nos campos
// estruturados da jornada. Formato: "<trigger abreviado> → <ação>". Ex:
//  - "keyword 'arroz' → DM: feijão"
//  - "menção em grupo → grupo: o que foi?"
//  - "1ª msg → IA"
// Cai pra um fallback genérico quando não há dados suficientes.
func generateJourneyName(prompt string, triggerType models.TriggerType) string {
	return buildJourneyName(prompt, triggerType, nil, "", "")
}

// buildJourneyName é a versão "com contexto" — usada no CreateJourney
// onde já temos keywords + messageTemplate + responseMode extraídos.
// Produz nomes bem mais descritivos. Sempre truncado em 60 chars.
func buildJourneyName(prompt string, triggerType models.TriggerType, keywords []string, messageTemplate, responseMode string) string {
	// Trigger abreviado
	var triggerPart string
	switch triggerType {
	case models.TriggerGroupKeyword:
		if len(keywords) > 0 {
			triggerPart = fmt.Sprintf("kw '%s' em grupo", keywords[0])
		} else {
			triggerPart = "kw em grupo"
		}
	case models.TriggerPrivateKeyword:
		if len(keywords) > 0 {
			triggerPart = fmt.Sprintf("kw '%s' em DM", keywords[0])
		} else {
			triggerPart = "kw em DM"
		}
	case models.TriggerGroupMention:
		triggerPart = "menção em grupo"
	case models.TriggerGroupMessage:
		triggerPart = "msg em grupo"
	case models.TriggerPrivateMessage:
		triggerPart = "msg em DM"
	case models.TriggerFirstMessage:
		triggerPart = "1ª mensagem"
	case models.TriggerContactCallMissed:
		triggerPart = "chamada perdida"
	case models.TriggerContactCallRejected:
		triggerPart = "chamada rejeitada"
	case models.TriggerContactCall:
		triggerPart = "ligação"
	case models.TriggerContactLocation:
		triggerPart = "localização"
	case models.TriggerContactImage:
		triggerPart = "imagem"
	case models.TriggerContactAudio:
		triggerPart = "áudio"
	case models.TriggerContactVideo:
		triggerPart = "vídeo"
	case models.TriggerContactDocument:
		triggerPart = "documento"
	case models.TriggerGroupJoin:
		triggerPart = "entrou no grupo"
	case models.TriggerGroupLeave:
		triggerPart = "saiu do grupo"
	case models.TriggerUserCommand:
		triggerPart = "comando"
	case models.TriggerAnyMessage:
		triggerPart = "qualquer msg"
	default:
		triggerPart = string(triggerType)
	}

	// Ação abreviada
	actionPart := ""
	msg := strings.TrimSpace(messageTemplate)
	if msg != "" {
		short := msg
		if len([]rune(short)) > 30 {
			short = string([]rune(short)[:30]) + "…"
		}
		switch responseMode {
		case "group":
			actionPart = fmt.Sprintf("grupo: %s", short)
		default: // private ou vazio
			actionPart = fmt.Sprintf("DM: %s", short)
		}
	}

	// Monta final
	var name string
	switch {
	case triggerPart != "" && actionPart != "":
		name = triggerPart + " → " + actionPart
	case triggerPart != "":
		name = triggerPart
	case actionPart != "":
		name = actionPart
	default:
		name = "Jornada Automática"
	}

	// Cap de 60 runes
	if runes := []rune(name); len(runes) > 60 {
		name = string(runes[:60]) + "…"
	}
	_ = prompt // reservado pra heurísticas baseadas no prompt (não usado no momento)
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

	// Determine trigger type based on context
	isGroup := strings.Contains(lowerPrompt, "grupo")
	isPrivate := strings.Contains(lowerPrompt, "privado") || strings.Contains(lowerPrompt, " dm") || strings.Contains(lowerPrompt, " mp")
	isMediaVideo := strings.Contains(lowerPrompt, "vídeo") || strings.Contains(lowerPrompt, "video")
	isMediaAudio := strings.Contains(lowerPrompt, "áudio") || strings.Contains(lowerPrompt, "audio") || strings.Contains(lowerPrompt, "gravar")
	isMediaDocument := strings.Contains(lowerPrompt, "documento") || strings.Contains(lowerPrompt, "pdf") || strings.Contains(lowerPrompt, "arquivo")
	isMediaImage := strings.Contains(lowerPrompt, "imagem") || strings.Contains(lowerPrompt, "foto") || strings.Contains(lowerPrompt, "picture")
	isCall := strings.Contains(lowerPrompt, "ligação") || strings.Contains(lowerPrompt, "ligar") || strings.Contains(lowerPrompt, "chamada")
	isFirstMessage := strings.Contains(lowerPrompt, "primeira mensagem") || strings.Contains(lowerPrompt, "novo contato") || strings.Contains(lowerPrompt, "primeiro contato")
	isNoResponse := strings.Contains(lowerPrompt, "não responder") || strings.Contains(lowerPrompt, "sem resposta") || strings.Contains(lowerPrompt, "horas")

	// Set trigger type
	if isGroup {
		if isMediaVideo {
			triggerType = models.TriggerContactVideo
		} else if isMediaAudio {
			triggerType = models.TriggerContactAudio
		} else if isMediaDocument {
			triggerType = models.TriggerContactDocument
		} else if isMediaImage {
			triggerType = models.TriggerContactImage
		} else {
			triggerType = models.TriggerGroupKeyword
		}
	} else if isPrivate {
		if isMediaVideo {
			triggerType = models.TriggerContactVideo
		} else if isMediaAudio {
			triggerType = models.TriggerContactAudio
		} else if isMediaDocument {
			triggerType = models.TriggerContactDocument
		} else if isMediaImage {
			triggerType = models.TriggerContactImage
		} else {
			triggerType = models.TriggerPrivateKeyword
		}
	} else if isCall {
		triggerType = models.TriggerContactCall
	} else if isFirstMessage {
		triggerType = models.TriggerFirstMessage
	} else if isNoResponse {
		triggerType = models.TriggerNoResponse
	}

	// Extract keywords from quotes
	keywords := extractKeywords(prompt, lowerPrompt)

	// Extract message template - look for content after "com" in quotes
	messageTemplate := extractMessageTemplate(prompt, lowerPrompt)

	// Build trigger filter description
	triggerFilter := buildTriggerFilter(triggerType, keywords, rules)

	// Extract group name if mentioned
	if isGroup {
		if groupName := extractGroupName(prompt, lowerPrompt); groupName != "" {
			triggerFilter = "Grupo: " + groupName
		}
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
	// Look for quoted text first - this is the most reliable
	for _, sep := range []string{"'", `"`} {
		parts := strings.Split(prompt, sep)
		// If we have odd number of parts, we have complete quotes
		if len(parts) >= 3 {
			// Return the content between the first pair of quotes
			content := strings.TrimSpace(parts[1])
			if content != "" && len(content) < 200 {
				return content
			}
		}
	}

	// Look for patterns like "responda ... com 'tchau'" or "responda no privado com 'tchau'"
	messagePhrases := []string{
		"responda no privado com ",
		"responda no grupo com ",
		"responda com ",
		"responda ",
		"responder no privado com ",
		"responder no grupo com ",
		"responder com ",
		"responder ",
		"mande ",
		"envie ",
		"mensagem de ",
		"mensagem: ",
		"diga ",
		"fale ",
		"com ",
	}

	for _, phrase := range messagePhrases {
		idx := strings.Index(lower, phrase)
		if idx == -1 {
			continue
		}
		rest := strings.TrimSpace(prompt[idx+len(phrase):])

		// Extract quoted string
		for _, sep := range []string{`"`, "'"} {
			if strings.HasPrefix(rest, sep) {
				end := strings.Index(rest[1:], sep)
				if end >= 0 {
					return rest[1 : end+1]
				}
			}
		}

		// Get up to end of sentence
		for _, delim := range []string{"\n", ".", ";", " para ", " quando ", " no "} {
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

// buildTriggerFilter creates a human-readable trigger filter description
func buildTriggerFilter(triggerType models.TriggerType, keywords []string, rules services.ParsedRules) string {
	if rules.Trigger.Filter != "" {
		return rules.Trigger.Filter
	}

	keywordsStr := ""
	if len(keywords) > 0 {
		keywordsStr = " (" + strings.Join(keywords, ", ") + ")"
	}

	switch triggerType {
	case models.TriggerGroupKeyword:
		return "Palavra-chave no grupo" + keywordsStr
	case models.TriggerGroupMessage:
		return "Mensagem no grupo"
	case models.TriggerPrivateKeyword:
		return "Palavra-chave no privado" + keywordsStr
	case models.TriggerPrivateMessage:
		return "Mensagem privada"
	case models.TriggerContactVideo:
		return "Vídeo recebido"
	case models.TriggerContactAudio:
		return "Áudio recebido"
	case models.TriggerContactDocument:
		return "Documento recebido"
	case models.TriggerContactImage:
		return "Imagem recebida"
	case models.TriggerContactCall:
		return "Chamada recebida"
	case models.TriggerFirstMessage:
		return "Primeira mensagem"
	case models.TriggerNoResponse:
		return "Sem resposta"
	default:
		return string(triggerType)
	}
}

// extractGroupName extracts the group name from the prompt
func extractGroupName(prompt, lower string) string {
	patterns := []string{
		"no grupo ",
		"do grupo ",
		"grupo ",
	}

	for _, pattern := range patterns {
		idx := strings.Index(lower, pattern)
		if idx == -1 {
			continue
		}
		rest := strings.TrimSpace(prompt[idx+len(pattern):])
		for _, delim := range []string{" ", ",", ".", ";", "\n", " ela ", " ele ", " responde ", " envia "} {
			if i := strings.Index(rest, delim); i > 0 {
				return strings.TrimSpace(rest[:i])
			}
		}
		if len(rest) < 50 {
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

	// Filtra por workspace quando passado — sem isso o user via jornadas
	// de TODOS os workspaces dele, vazando dados entre tenants.
	wsParam := c.Query("workspace_id")

	q := h.db.Where("user_id = ?", userID.String())
	if wsParam != "" {
		if wsID, err := uuid.Parse(wsParam); err == nil {
			// Journey não tem WorkspaceID direto — filtra via JOIN nas
			// instances daquele workspace + journey sem instance_id
			// (jornadas globais ficam sempre visíveis).
			q = q.Where("instance_id = '' OR instance_id IS NULL OR instance_id IN (SELECT CAST(id AS TEXT) FROM instances WHERE workspace_id = ?)", wsID)
		}
	}

	var journeys []models.Journey
	if err := q.Order("created_at DESC").Find(&journeys).Error; err != nil {
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

	result := make([]JourneyWithStats, 0, len(journeys))
	for _, j := range journeys {
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

		result = append(result, JourneyWithStats{
			Journey:        j,
			InstanceName:   instanceName,
			ActiveExecs:    activeExecs,
			CompletedExecs: completedExecs,
			CompletionRate: completionRate,
		})
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

	// Ao pausar, marca todas as execuções ativas/waiting_input como paused
	// pra interromper quaisquer goroutines ainda rodando (ex: durante um
	// wait ou entre sends). O executor re-checa o status da jornada antes
	// de cada step, então isso é belt-and-suspenders.
	if req.Status == "paused" {
		now := time.Now()
		h.db.Model(&models.JourneyExecution{}).
			Where("journey_id = ? AND status IN (?, ?)", journey.ID, models.ExecutionActive, "waiting_input").
			Updates(map[string]interface{}{
				"status":       models.ExecutionPaused,
				"completed_at": now,
				"updated_at":   now,
			})
	}

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
	// Fetch sem filtro de owner — fazemos a checagem de acesso em Go.
	// Versão anterior fazia tudo num WHERE com subquery (`SELECT id::text
	// FROM instances ... WHERE workspace_id IN (...)`) que falhava
	// silenciosamente quando o tipo da coluna instances.id não casava
	// com o tipo do instance_id (uuid vs text), devolvendo 404 mesmo
	// pra jornada que o user acabou de criar. Resolver em Go é simples,
	// portátil entre dialects e dá log decente quando nega acesso.
	if err := h.db.Where("id = ?", id).First(&journey).Error; err != nil {
		log.Warn().Err(err).Str("journey_id", id).Str("user_id", userID.String()).Msg("GetJourney: jornada não existe no banco")
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	// Checagem de acesso: dono direto OU jornada cuja instance pertence
	// a workspace do user. Resolvida em Go pra evitar mismatch de tipo
	// uuid vs text na subquery (instance_id é string, instances.id é uuid).
	allowed := journey.UserID == userID.String()
	if !allowed && journey.InstanceID != "" {
		var wsIDs []uuid.UUID
		h.db.Table("user_workspaces").Where("user_id = ?", userID).Pluck("workspace_id", &wsIDs)
		if len(wsIDs) > 0 {
			var instUUID uuid.UUID
			if parsed, perr := uuid.Parse(journey.InstanceID); perr == nil {
				instUUID = parsed
				var n int64
				h.db.Table("instances").Where("id = ? AND workspace_id IN ?", instUUID, wsIDs).Count(&n)
				allowed = n > 0
			}
		}
	}
	if !allowed {
		log.Warn().
			Str("journey_id", journey.ID).
			Str("journey_user_id", journey.UserID).
			Str("journey_instance_id", journey.InstanceID).
			Str("requesting_user_id", userID.String()).
			Msg("GetJourney: user sem acesso à jornada")
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

// ─── Flow & LLM editing ──────────────────────────────────────────────────────

// UpdateFlow PATCH /api/journeys/:id/flow — salva flow editado via canvas
func (h *JourneyHandler) UpdateFlow(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	id := c.Params("id")
	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	var flow models.JourneyFlow
	if err := c.BodyParser(&flow); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "flow inválido"})
	}
	if len(flow.Steps) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "flow vazio"})
	}

	if err := journey.SetFlow(&flow); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao serializar flow"})
	}
	if err := h.db.Save(&journey).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar"})
	}

	return c.JSON(fiber.Map{"ok": true, "flow": journey.GetFlow()})
}

// EditFlowWithLLM POST /api/journeys/:id/edit-llm
// Body: { "instruction": "adicione um step para perguntar email", "integration_id": "..." }
func (h *JourneyHandler) EditFlowWithLLM(c *fiber.Ctx) error {
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
		Instruction   string    `json:"instruction"`
		IntegrationID string    `json:"integration_id"`
		RenderedText  string    `json:"rendered_text,omitempty"`
		Mentions      []Mention `json:"mentions,omitempty"`
	}
	if err := c.BodyParser(&req); err != nil || req.Instruction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instruction obrigatório"})
	}

	// Usa rendered_text (tokens → labels) como fonte pra LLM. Menções de
	// step/keyword são anexadas como contexto estruturado pra o LLM não
	// errar nomes/tipos.
	promptText := req.RenderedText
	if promptText == "" {
		promptText = req.Instruction
	}
	if len(req.Mentions) > 0 {
		hints := buildMentionHints(req.Mentions)
		if hints != "" {
			promptText = promptText + "\n\n" + hints
		}
	}

	// Resolver integração
	var integration *models.UserIntegration
	if req.IntegrationID != "" {
		h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, userID).First(&integration)
	}
	if integration == nil {
		h.db.Where("user_id = ? AND is_active = true AND provider IN ?",
			userID, []string{"openai", "claude", "deepseek", "gemini", "openrouter"}).First(&integration)
	}

	current := journey.GetFlow()
	if current == nil {
		// Sem flow existente: Build a partir da instrução como se fosse novo
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		built, err := h.builder.Build(ctx, integration, promptText)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
		}
		current = built
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		edited, err := h.builder.Edit(ctx, integration, current, promptText)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
		}
		current = edited
	}

	if err := journey.SetFlow(current); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao serializar flow"})
	}
	if err := h.db.Save(&journey).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar"})
	}

	return c.JSON(fiber.Map{
		"ok":   true,
		"flow": current,
	})
}

// SimulateJourney POST /api/journeys/:id/simulate
// Body: { "message": "oi", "contact_name": "João" }
func (h *JourneyHandler) SimulateJourney(c *fiber.Ctx) error {
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
		Message     string `json:"message"`
		ContactName string `json:"contact_name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.Message == "" {
		req.Message = "oi"
	}

	// Simulador sempre usa um executor próprio (nopSender) — não precisa do manager.
	exec := services.NewJourneyExecutor(h.db, nopSender{}, h.llm)
	res := exec.Simulate(&journey, req.Message, req.ContactName)
	return c.JSON(res)
}

// ListTemplates GET /api/journeys/templates
func (h *JourneyHandler) ListTemplates(c *fiber.Ctx) error {
	return c.JSON(services.BuiltInTemplates())
}

// CreateFromTemplate POST /api/journeys/from-template/:slug
// Body: { "instance_id": "...", "name": "..." }
func (h *JourneyHandler) CreateFromTemplate(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	slug := c.Params("slug")
	templates := services.BuiltInTemplates()

	var tpl *services.JourneyTemplate
	for i := range templates {
		if templates[i].Slug == slug {
			tpl = &templates[i]
			break
		}
	}
	if tpl == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "template não encontrado"})
	}

	var req struct {
		InstanceID string `json:"instance_id"`
		Name       string `json:"name"`
	}
	_ = c.BodyParser(&req)

	kwJSON, _ := json.Marshal(tpl.Keywords)

	name := req.Name
	if name == "" {
		name = tpl.Name
	}

	journey := models.Journey{
		ID:           uuid.New().String(),
		UserID:       userID.String(),
		InstanceID:   req.InstanceID,
		Name:         name,
		Description:  tpl.Description,
		Prompt:       "[template: " + tpl.Slug + "] " + tpl.Description,
		TriggerType:  tpl.TriggerType,
		Keywords:     string(kwJSON),
		Status:       "active",
		ResponseMode: "private",
		ParsedRules:  "{}",
	}
	_ = journey.SetFlow(tpl.Flow)

	if err := h.db.Create(&journey).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao criar jornada"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"journey": journey,
		"flow":    journey.GetFlow(),
	})
}

// nopSender é um MessageSender de descarte usado no simulador quando o manager
// não tem executor injetado.
type nopSender struct{}

func (nopSender) SendText(_, _, _ string) error                                 { return nil }
func (nopSender) SendButtons(_, _, _ string, _ []services.Button) error         { return nil }
func (nopSender) SendList(_, _, _, _ string, _ []services.ListSection) error    { return nil }
func (nopSender) SendMedia(_, _, _, _, _ string) error                          { return nil }

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

// buildDeterministicFlow monta um JourneyFlow simples a partir de dados
// estruturados — usado quando o usuário preencheu explicitamente a ação
// via /ação (action mention). Evita chamar o FlowBuilder/LLM pra algo
// que já sabemos: "quando trigger X, envie Y em modo Z [após N segundos]".
//
// Quando delaySeconds > 0 prepende um step de wait antes do message.
// Retorna nil se messageTemplate estiver vazio — nesse caso o caller
// deixa o flow = nil e o executor cai no legacyFallback.
func buildDeterministicFlow(messageTemplate, responseMode string, delaySeconds int) *models.JourneyFlow {
	if strings.TrimSpace(messageTemplate) == "" {
		return nil
	}
	mode := responseMode
	if mode == "" {
		mode = "private"
	}
	msgCfg, _ := json.Marshal(map[string]string{"message": messageTemplate, "mode": mode})

	if delaySeconds > 0 {
		// Cap sanity: nada passa de 1 dia.
		if delaySeconds > 24*60*60 {
			delaySeconds = 24 * 60 * 60
		}
		waitCfg, _ := json.Marshal(map[string]string{"duration": fmt.Sprintf("%ds", delaySeconds)})
		return &models.JourneyFlow{
			StartStep: "s_wait",
			Steps: []models.FlowStep{
				{
					ID:          "s_wait",
					Type:        models.StepTypeWait,
					Label:       fmt.Sprintf("Aguardar %ds", delaySeconds),
					IsStartStep: true,
					NextStepID:  "s_msg",
					Config:      json.RawMessage(waitCfg),
				},
				{
					ID:     "s_msg",
					Type:   models.StepTypeMessage,
					Label:  "Responder",
					Config: json.RawMessage(msgCfg),
				},
			},
		}
	}
	return &models.JourneyFlow{
		StartStep: "s1",
		Steps: []models.FlowStep{
			{
				ID:          "s1",
				Type:        models.StepTypeMessage,
				Label:       "Responder",
				IsStartStep: true,
				Config:      json.RawMessage(msgCfg),
			},
		},
	}
}

// extractDelaySeconds lê o primeiro `delay` mention e retorna o número de
// segundos (0 se não houver ou se inválido). O meta.seconds é o valor
// canônico; fallback pro ID se o meta não veio.
func extractDelaySeconds(mentions []Mention) int {
	m := firstMention(mentions, "delay")
	if m == nil {
		return 0
	}
	raw := ""
	if m.Meta != nil {
		raw = m.Meta["seconds"]
	}
	if raw == "" {
		raw = m.ID
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// delayFromPromptText extrai "delay de N segundos/s/minutos" do texto
// renderizado como fallback pra quando o usuário digita em linguagem
// natural sem usar o /delay. Retorna segundos (0 se não encontrar).
func delayFromPromptText(s string) int {
	// Aceita "delay de 5s", "delay 10 segundos", "aguardar 2 minutos",
	// "com delay de 30s", etc. Case-insensitive. Pega o PRIMEIRO match.
	re := regexp.MustCompile(`(?i)\b(?:delay|atraso|aguardar|esperar|após|depois de)\s*(?:de)?\s*(\d+)\s*(s|seg|segundos?|m|min|minutos?|h|hora|horas?)?\b`)
	m := re.FindStringSubmatch(s)
	if len(m) < 2 {
		return 0
	}
	n, err := strconv.Atoi(m[1])
	if err != nil || n <= 0 {
		return 0
	}
	unit := strings.ToLower(m[2])
	switch {
	case strings.HasPrefix(unit, "m") && !strings.HasPrefix(unit, "mi"):
		// Ambiguo entre "m" (minuto) e metros — assumimos minutos nesse
		// contexto de "delay/aguardar".
		fallthrough
	case strings.HasPrefix(unit, "min") || unit == "m":
		return n * 60
	case strings.HasPrefix(unit, "h"):
		return n * 3600
	default:
		return n // segundos (default)
	}
}

// buildMentionHints converte a lista de menções em um bloco textual anexado
// ao prompt do LLM. Ajuda o modelo a não inventar nomes: damos a ele o par
// label + tipo + id pra que tome decisões determinísticas (ex: "este é o
// passo s_abc123 do tipo message").
func buildMentionHints(mentions []Mention) string {
	if len(mentions) == 0 {
		return ""
	}
	lines := []string{"CONTEXTO (menções explícitas do usuário — use como autoritativo):"}
	for _, m := range mentions {
		label := strings.TrimSpace(m.Label)
		switch m.Type {
		case "instance":
			lines = append(lines, fmt.Sprintf("- instância %q (id: %s)", label, m.ID))
		case "group":
			jid := m.ID
			if m.Meta != nil && m.Meta["jid"] != "" {
				jid = m.Meta["jid"]
			}
			lines = append(lines, fmt.Sprintf("- grupo %q (jid: %s)", label, jid))
		case "contact":
			lines = append(lines, fmt.Sprintf("- contato %q (id: %s)", label, m.ID))
		case "tag":
			lines = append(lines, fmt.Sprintf("- tag %q (id: %s)", label, m.ID))
		case "funnel":
			lines = append(lines, fmt.Sprintf("- funil %q (id: %s)", label, m.ID))
		case "journey":
			lines = append(lines, fmt.Sprintf("- jornada %q (id: %s)", label, m.ID))
		case "trigger":
			lines = append(lines, fmt.Sprintf("- trigger_type = %q (label: %s)", m.ID, label))
		case "step":
			lines = append(lines, fmt.Sprintf("- tipo de passo = %q (label: %s)", m.ID, label))
		case "keyword":
			lines = append(lines, fmt.Sprintf("- palavra-chave = %q", label))
		}
	}
	return strings.Join(lines, "\n")
}

// createBlankJourney cria uma jornada em branco pronta pra edição no canvas.
// Nada de LLM, nada de parsing — só um flow inicial mínimo e status=paused
// (pra não sair disparando sem o usuário configurar o trigger).
func (h *JourneyHandler) createBlankJourney(c *fiber.Ctx, userID uuid.UUID, name, instanceID string) error {
	if name == "" {
		name = "Nova jornada"
	}

	startID := "s1"
	flow := &models.JourneyFlow{
		StartStep: startID,
		Steps: []models.FlowStep{
			{
				ID:          startID,
				Type:        models.StepTypeMessage,
				Label:       "Mensagem de boas-vindas",
				IsStartStep: true,
				Config:      json.RawMessage(`{"message":"Olá {{name}}! 👋","mode":"private"}`),
			},
		},
	}

	journey := models.Journey{
		ID:            uuid.New().String(),
		UserID:        userID.String(),
		Name:          name,
		Prompt:        "", // sem prompt — foi criada direto no canvas
		TriggerType:   string(models.TriggerAnyMessage),
		TriggerFilter: "Qualquer mensagem (configure o gatilho para filtrar)",
		Keywords:      "[]",
		Status:        "paused",
		ResponseMode:  "private",
		InstanceID:    instanceID,
	}
	if err := journey.SetFlow(flow); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao codificar flow inicial"})
	}
	if err := h.db.Create(&journey).Error; err != nil {
		// Hint inclui mensagem do GORM/driver pra ajudar debug — sem
		// ele "falha ao salvar" não diz nada (constraint? FK? unique?).
		log.Error().Err(err).
			Str("user_id", userID.String()).
			Str("name", name).
			Str("instance_id", instanceID).
			Msg("createBlankJourney: db.Create falhou")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "falha ao salvar jornada no banco",
			"hint":  err.Error(),
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":            journey.ID,
		"name":          journey.Name,
		"status":        journey.Status,
		"trigger_type":  journey.TriggerType,
		"instance_id":   journey.InstanceID,
		"response_mode": journey.ResponseMode,
		"flow":          flow,
		"blank":         true,
		"created_at":    journey.CreatedAt,
	})
}

// UpdateTrigger PATCH /api/journeys/:id/trigger
// Atualiza campos de gatilho da jornada sem afetar o flow. Permite editar
// trigger_type, keywords, group_jid, instance_id, response_mode e name
// a partir do canvas (sem LLM).
func (h *JourneyHandler) UpdateTrigger(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}
	id := c.Params("id")
	if id == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id ausente"})
	}

	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	var req struct {
		Name           *string  `json:"name,omitempty"`
		TriggerType    *string  `json:"trigger_type,omitempty"`
		TriggerFilter  *string  `json:"trigger_filter,omitempty"`
		Keywords       []string `json:"keywords,omitempty"`
		GroupJID       *string  `json:"group_jid,omitempty"`
		InstanceID     *string  `json:"instance_id,omitempty"`
		ResponseMode   *string  `json:"response_mode,omitempty"`
		// Customer.io-inspired
		GoalEvent      *string  `json:"goal_event,omitempty"`
		ExitConditions *string  `json:"exit_conditions,omitempty"`
		ReEntryRule    *string  `json:"re_entry_rule,omitempty"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "requisição inválida"})
	}

	oldName := journey.Name
	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.TriggerType != nil {
		updates["trigger_type"] = *req.TriggerType
	}
	if req.TriggerFilter != nil {
		updates["trigger_filter"] = *req.TriggerFilter
	}
	if req.Keywords != nil {
		kwBytes, _ := json.Marshal(req.Keywords)
		updates["keywords"] = string(kwBytes)
	}
	if req.GroupJID != nil {
		updates["group_jid"] = *req.GroupJID
	}
	if req.InstanceID != nil {
		updates["instance_id"] = *req.InstanceID
	}
	if req.ResponseMode != nil {
		updates["response_mode"] = *req.ResponseMode
	}
	if req.GoalEvent != nil {
		updates["goal_event"] = *req.GoalEvent
	}
	if req.ExitConditions != nil {
		updates["exit_conditions"] = *req.ExitConditions
	}
	if req.ReEntryRule != nil {
		updates["re_entry_rule"] = *req.ReEntryRule
	}

	if len(updates) == 0 {
		return c.JSON(fiber.Map{"ok": true, "message": "nada pra atualizar"})
	}

	if err := h.db.Model(&journey).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar gatilho"})
	}
	// Recarrega pra devolver o estado atualizado
	h.db.Where("id = ? AND user_id = ?", id, userID).First(&journey)

	// Cascade jornada → CRM: se o nome mudou, atualiza todos os contatos
	// que apontam pra ela. Assim /crm e /inbox refletem o novo nome sem
	// precisar re-disparar as jornadas.
	if req.Name != nil && oldName != "" && oldName != journey.Name {
		if err := h.db.Model(&models.Contact{}).
			Where("user_id = ? AND journey = ?", userID, oldName).
			Update("journey", journey.Name).Error; err != nil {
			// best-effort — só loga
			_ = err
		}
	}

	return c.JSON(fiber.Map{
		"ok":             true,
		"id":             journey.ID,
		"name":           journey.Name,
		"trigger_type":   journey.TriggerType,
		"trigger_filter": journey.TriggerFilter,
		"keywords":       journey.GetKeywords(),
		"group_jid":      journey.GroupJID,
		"instance_id":    journey.InstanceID,
		"response_mode":  journey.ResponseMode,
	})
}
