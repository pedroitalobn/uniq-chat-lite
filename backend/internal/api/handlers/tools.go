package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type ToolsHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewToolsHandler(db *gorm.DB, manager *whatsapp.Manager) *ToolsHandler {
	return &ToolsHandler{db: db, manager: manager}
}

func (h *ToolsHandler) ExecuteToolCall(userID uuid.UUID, toolCall models.ToolCall) models.ToolResult {
	result := models.ToolResult{
		ID:   toolCall.ID,
		Name: toolCall.Name,
	}

	var args map[string]interface{}
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		result.Error = fmt.Sprintf("erro ao parsear argumentos: %v", err)
		return result
	}

	switch toolCall.Name {
	case "list_instances":
		result.Result = h.listInstances(userID)
	case "list_groups":
		result.Result = h.listGroups(userID, args)
	case "list_journeys":
		result.Result = h.listJourneys(userID)
	case "get_journey":
		result.Result = h.getJourney(userID, args)
	case "toggle_journey":
		result.Result = h.toggleJourney(userID, args)
	case "delete_journey":
		result.Result = h.deleteJourney(userID, args)
	case "create_journey":
		result.Result = h.createJourney(userID, args)
	case "list_integrations":
		result.Result = h.listIntegrations(userID)
	case "send_message":
		result.Result = h.sendMessage(userID, args)
	case "get_user_context":
		result.Result = h.getUserContext(userID)
	// CRM
	case "list_contacts":
		result.Result = h.toolListContacts(userID, args)
	case "get_contact":
		result.Result = h.toolGetContact(userID, args)
	case "create_contact":
		result.Result = h.toolCreateContact(userID, args)
	case "update_contact":
		result.Result = h.toolUpdateContact(userID, args)
	case "list_companies":
		result.Result = h.toolListCompanies(userID, args)
	case "create_company":
		result.Result = h.toolCreateCompany(userID, args)
	case "list_deals":
		result.Result = h.toolListDeals(userID, args)
	case "create_deal":
		result.Result = h.toolCreateDeal(userID, args)
	case "move_deal_stage":
		result.Result = h.toolMoveDealStage(userID, args)
	case "list_funnels":
		result.Result = h.toolListFunnels(userID, args)
	// Campaigns
	case "list_campaigns":
		result.Result = h.toolListCampaigns(userID, args)
	case "get_campaign":
		result.Result = h.toolGetCampaign(userID, args)
	case "create_campaign":
		result.Result = h.toolCreateCampaign(userID, args)
	case "start_campaign":
		result.Result = h.toolStartCampaign(userID, args)
	case "pause_campaign":
		result.Result = h.toolPauseCampaign(userID, args)
	// Inbox
	case "list_conversations":
		result.Result = h.toolListConversations(userID, args)
	case "get_conversation":
		result.Result = h.toolGetConversation(userID, args)
	case "assign_conversation":
		result.Result = h.toolAssignConversation(userID, args)
	case "close_conversation":
		result.Result = h.toolCloseConversation(userID, args)
	case "list_queues":
		result.Result = h.toolListQueues(userID, args)
	// Stats
	case "get_dashboard_stats":
		result.Result = h.toolGetDashboardStats(userID, args)
	case "get_conversation_stats":
		result.Result = h.toolGetConversationStats(userID, args)
	// Shop
	case "list_products":
		result.Result = h.toolListProducts(userID, args)
	case "search_products":
		result.Result = h.toolSearchProducts(userID, args)
	case "get_product_details":
		result.Result = h.toolGetProductDetails(userID, args)
	default:
		result.Error = fmt.Sprintf("tool '%s' não encontrada", toolCall.Name)
	}

	return result
}

func (h *ToolsHandler) listInstances(userID uuid.UUID) interface{} {
	var instances []models.Instance
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&instances).Error; err != nil {
		return map[string]interface{}{"error": err.Error()}
	}

	result := make([]map[string]interface{}, 0, len(instances))
	for _, inst := range instances {
		result = append(result, map[string]interface{}{
			"id":           inst.ID.String(),
			"name":         inst.Name,
			"status":       inst.Status,
			"phone_number": inst.PhoneNumber,
			"channel":      inst.Channel,
			"created_at":   inst.CreatedAt.Format("2006-01-02 15:04"),
		})
	}

	if len(result) == 0 {
		return map[string]interface{}{
			"message":   "Nenhuma instância encontrada. Você precisa criar uma instância primeiro.",
			"instances": []interface{}{},
		}
	}

	return map[string]interface{}{
		"message":   fmt.Sprintf("Você tem %d instância(s) WhatsApp:", len(result)),
		"instances": result,
	}
}

func (h *ToolsHandler) listGroups(userID uuid.UUID, args map[string]interface{}) interface{} {
	instanceID, _ := args["instance_id"].(string)

	var instance models.Instance
	if instanceID != "" {
		if err := h.db.Where("id = ? AND user_id = ?", instanceID, userID).First(&instance).Error; err != nil {
			return map[string]interface{}{"error": "Instância não encontrada"}
		}
	} else {
		if err := h.db.Where("user_id = ? AND status = ?", userID, models.StatusConnected).First(&instance).Error; err != nil {
			return map[string]interface{}{"error": "Nenhuma instância conectada encontrada"}
		}
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return map[string]interface{}{"error": "Instância não está em execução. Conecte-se primeiro."}
	}

	groups, err := client.GetJoinedGroups()
	if err != nil {
		return map[string]interface{}{"error": fmt.Sprintf("Erro ao buscar grupos: %v", err)}
	}

	result := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		jid, _ := g["jid"].(string)
		name, _ := g["name"].(string)
		participantCount, _ := g["participant_count"].(int)
		result = append(result, map[string]interface{}{
			"jid":               jid,
			"name":              name,
			"participant_count": participantCount,
		})
	}

	if len(result) == 0 {
		return map[string]interface{}{
			"message": "Nenhum grupo encontrado nesta instância.",
			"groups":  []interface{}{},
		}
	}

	return map[string]interface{}{
		"message": fmt.Sprintf("Grupos na instância '%s':", instance.Name),
		"groups":  result,
	}
}

func (h *ToolsHandler) listJourneys(userID uuid.UUID) interface{} {
	var journeys []models.Journey
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&journeys).Error; err != nil {
		return map[string]interface{}{"error": err.Error()}
	}

	result := make([]map[string]interface{}, 0, len(journeys))
	for _, j := range journeys {
		result = append(result, map[string]interface{}{
			"id":           j.ID,
			"prompt":       j.Prompt,
			"status":       j.Status,
			"trigger_type": j.TriggerType,
			"invocations":  j.Invocations,
			"created_at":   j.CreatedAt.Format("2006-01-02 15:04"),
		})
	}

	if len(result) == 0 {
		return map[string]interface{}{
			"message":  "Nenhuma jornada criada ainda.",
			"journeys": []interface{}{},
		}
	}

	return map[string]interface{}{
		"message":  fmt.Sprintf("Você tem %d jornada(s) de automação:", len(result)),
		"journeys": result,
	}
}

func (h *ToolsHandler) getJourney(userID uuid.UUID, args map[string]interface{}) interface{} {
	journeyID, ok := args["journey_id"].(string)
	if !ok || journeyID == "" {
		return map[string]interface{}{"error": "journey_id é obrigatório"}
	}

	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", journeyID, userID).First(&journey).Error; err != nil {
		return map[string]interface{}{"error": "Jornada não encontrada"}
	}

	var parsedRules map[string]interface{}
	json.Unmarshal([]byte(journey.ParsedRules), &parsedRules)

	return map[string]interface{}{
		"id":             journey.ID,
		"prompt":         journey.Prompt,
		"status":         journey.Status,
		"trigger_type":   journey.TriggerType,
		"trigger_filter": journey.TriggerFilter,
		"invocations":    journey.Invocations,
		"last_run_at":    journey.LastRunAt,
		"parsed_rules":   parsedRules,
		"created_at":     journey.CreatedAt.Format("2006-01-02 15:04"),
	}
}

func (h *ToolsHandler) toggleJourney(userID uuid.UUID, args map[string]interface{}) interface{} {
	journeyID, ok := args["journey_id"].(string)
	if !ok || journeyID == "" {
		return map[string]interface{}{"error": "journey_id é obrigatório"}
	}

	status, ok := args["status"].(string)
	if !ok || (status != "active" && status != "paused") {
		return map[string]interface{}{"error": "status deve ser 'active' ou 'paused'"}
	}

	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", journeyID, userID).First(&journey).Error; err != nil {
		return map[string]interface{}{"error": "Jornada não encontrada"}
	}

	journey.Status = status
	if err := h.db.Save(&journey).Error; err != nil {
		return map[string]interface{}{"error": "Erro ao atualizar jornada"}
	}

	return map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Jornada '%s' está agora %s", journey.Prompt[:min(50, len(journey.Prompt))], status),
	}
}

func (h *ToolsHandler) deleteJourney(userID uuid.UUID, args map[string]interface{}) interface{} {
	journeyID, ok := args["journey_id"].(string)
	if !ok || journeyID == "" {
		return map[string]interface{}{"error": "journey_id é obrigatório"}
	}

	result := h.db.Where("id = ? AND user_id = ?", journeyID, userID).Delete(&models.Journey{})
	if result.Error != nil {
		return map[string]interface{}{"error": "Erro ao deletar jornada"}
	}
	if result.RowsAffected == 0 {
		return map[string]interface{}{"error": "Jornada não encontrada"}
	}

	return map[string]interface{}{
		"success": true,
		"message": "Jornada removida com sucesso",
	}
}

func (h *ToolsHandler) createJourney(userID uuid.UUID, args map[string]interface{}) interface{} {
	prompt, ok := args["prompt"].(string)
	if !ok || prompt == "" {
		return map[string]interface{}{"error": "prompt é obrigatório"}
	}

	instanceID, _ := args["instance_id"].(string)
	// Mensagem opcional vinda do LLM com a resposta concreta a enviar.
	// Se vier vazia, derivamos um genérico do prompt.
	replyText, _ := args["reply_text"].(string)
	name, _ := args["name"].(string)

	journey := models.Journey{
		UserID: userID.String(),
		Prompt: prompt,
		Status: "active",
		Name:   name,
	}
	if journey.Name == "" {
		journey.Name = truncateForJourneyName(prompt, 80)
	}

	if instanceID != "" {
		journey.InstanceID = instanceID
	}

	// Auto-detect trigger from prompt
	lowerPrompt := strings.ToLower(prompt)
	keywords := []string{}
	triggerFilter := ""

	commonKeywords := []string{"interessado", "comprar", "orcamento", "preco", "quanto", "quer", "ajuda", "suporte", "vip", "lead", "contato", "proposta", "negociar"}
	for _, kw := range commonKeywords {
		if strings.Contains(lowerPrompt, kw) {
			keywords = append(keywords, kw)
		}
	}

	if strings.Contains(lowerPrompt, "grupo") {
		journey.TriggerType = string(models.TriggerGroupMessage)
		if strings.Contains(lowerPrompt, "@") {
			parts := strings.Split(prompt, "@")
			if len(parts) > 1 {
				groupName := strings.Fields(parts[1])[0]
				triggerFilter = fmt.Sprintf("Grupo: %s", groupName)
			}
		}
	} else {
		journey.TriggerType = string(models.TriggerGroupKeyword)
	}

	if len(keywords) > 0 {
		triggerFilter = fmt.Sprintf("Keywords: %s", strings.Join(keywords, ", "))
	}

	journey.TriggerFilter = triggerFilter
	keywordsJSON, _ := json.Marshal(keywords)
	journey.Keywords = string(keywordsJSON)

	parsedRules := map[string]interface{}{
		"trigger": map[string]interface{}{
			"type":     string(journey.TriggerType),
			"filter":   triggerFilter,
			"keywords": keywords,
		},
		"actions": []map[string]interface{}{
			{
				"type":  "send_private",
				"text":  "Olá! Recebi sua mensagem e estou processando.",
				"icon":  "Send",
				"color": "#8b5cf6",
			},
		},
	}
	parsedRulesJSON, _ := json.Marshal(parsedRules)
	journey.ParsedRules = string(parsedRulesJSON)

	// Gera o Flow real que o JourneyExecutor vai rodar. Sem isso,
	// quando a trigger dispara o executor encontra Flow vazio e a
	// jornada nunca envia nada — sintoma do bug "criou mas não roda".
	if replyText == "" {
		replyText = "Olá! Recebemos sua mensagem e em breve te respondemos."
	}
	flow := buildSimpleReplyFlow(replyText)
	if err := journey.SetFlow(flow); err != nil {
		return map[string]interface{}{"error": fmt.Sprintf("erro ao serializar flow: %v", err)}
	}

	if err := h.db.Create(&journey).Error; err != nil {
		return map[string]interface{}{"error": fmt.Sprintf("Erro ao criar jornada: %v", err)}
	}

	return map[string]interface{}{
		"success":    true,
		"message":    "Jornada criada com sucesso!",
		"journey_id": journey.ID,
		"summary": map[string]interface{}{
			"prompt":         prompt,
			"trigger_type":   journey.TriggerType,
			"trigger_filter": triggerFilter,
			"status":         journey.Status,
			"reply_text":     replyText,
		},
	}
}

// buildSimpleReplyFlow gera o Flow mínimo que o executor consome:
// um único step de "message" enviado via DM. É o comportamento default
// da jornada criada via Uniq AI quando o LLM não especifica algo mais
// elaborado. Pra fluxos complexos o user edita no /journeys/[id].
func buildSimpleReplyFlow(text string) *models.JourneyFlow {
	cfg, _ := json.Marshal(map[string]any{
		"text": text,
		"mode": "private",
	})
	step := models.FlowStep{
		ID:          "step-1",
		Type:        models.StepTypeMessage,
		Label:       "Resposta automática",
		Config:      cfg,
		IsStartStep: true,
	}
	return &models.JourneyFlow{
		Steps:     []models.FlowStep{step},
		StartStep: step.ID,
	}
}

func truncateForJourneyName(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

func (h *ToolsHandler) listIntegrations(userID uuid.UUID) interface{} {
	var integrations []models.UserIntegration
	if err := h.db.Where("user_id = ? AND is_active = true", userID).Find(&integrations).Error; err != nil {
		return map[string]interface{}{"error": err.Error()}
	}

	result := make([]map[string]interface{}, 0, len(integrations))
	for _, i := range integrations {
		result = append(result, map[string]interface{}{
			"id":          i.ID.String(),
			"name":        i.Name,
			"provider":    i.Provider,
			"model":       i.GetFirstModel(),
			"models":      i.GetModels(),
			"test_status": i.TestStatus,
		})
	}

	if len(result) == 0 {
		return map[string]interface{}{
			"message":      "Nenhuma integração de IA configurada. Configure uma em Configurações > Integrações.",
			"integrations": []interface{}{},
		}
	}

	return map[string]interface{}{
		"message":      fmt.Sprintf("Você tem %d integração(ões) de IA:", len(result)),
		"integrations": result,
	}
}

func (h *ToolsHandler) sendMessage(userID uuid.UUID, args map[string]interface{}) interface{} {
	instanceID, ok := args["instance_id"].(string)
	if !ok || instanceID == "" {
		return map[string]interface{}{"error": "instance_id é obrigatório"}
	}

	to, ok := args["to"].(string)
	if !ok || to == "" {
		return map[string]interface{}{"error": "to (destinatário) é obrigatório"}
	}

	text, ok := args["text"].(string)
	if !ok || text == "" {
		return map[string]interface{}{"error": "text (mensagem) é obrigatório"}
	}

	var instance models.Instance
	if err := h.db.Where("id = ? AND user_id = ?", instanceID, userID).First(&instance).Error; err != nil {
		return map[string]interface{}{"error": "Instância não encontrada"}
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return map[string]interface{}{"error": "Instância não está em execução"}
	}

	msgID, err := client.SendTextMessage(to, text)
	if err != nil {
		return map[string]interface{}{"error": fmt.Sprintf("Erro ao enviar mensagem: %v", err)}
	}

	return map[string]interface{}{
		"success":    true,
		"message":    fmt.Sprintf("Mensagem enviada para %s", to),
		"message_id": msgID,
	}
}

func (h *ToolsHandler) getUserContext(userID uuid.UUID) interface{} {
	var instanceCount int64
	var journeyCount int64
	var integrationCount int64
	var groupCount int64

	h.db.Model(&models.Instance{}).Where("user_id = ?", userID).Count(&instanceCount)
	h.db.Model(&models.Journey{}).Where("user_id = ?", userID).Count(&journeyCount)
	h.db.Model(&models.UserIntegration{}).Where("user_id = ? AND is_active = true", userID).Count(&integrationCount)

	var instances []models.Instance
	h.db.Where("user_id = ? AND status = ?", userID, models.StatusConnected).Find(&instances)
	for _, inst := range instances {
		if client := h.manager.GetInstance(inst.ID.String()); client != nil {
			groups, _ := client.GetJoinedGroups()
			groupCount += int64(len(groups))
		}
	}

	return map[string]interface{}{
		"summary": map[string]interface{}{
			"instances":    instanceCount,
			"journeys":     journeyCount,
			"integrations": integrationCount,
			"groups":       groupCount,
		},
		"message": fmt.Sprintf("Contexto: %d instância(s), %d jornada(s), %d integração(ões), %d grupo(s)",
			instanceCount, journeyCount, integrationCount, groupCount),
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
