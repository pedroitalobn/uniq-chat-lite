package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

type IntegrationHandler struct {
	db              *gorm.DB
	claudeOAuth     *services.ClaudeOAuth
	openRouterOAuth *services.OpenRouterOAuth
}

func NewIntegrationHandler(db *gorm.DB) *IntegrationHandler {
	return &IntegrationHandler{
		db:              db,
		claudeOAuth:     services.NewClaudeOAuth(),
		openRouterOAuth: services.NewOpenRouterOAuth(),
	}
}

// StartClaudeOAuth inicia o fluxo OAuth do Claude.ai
// POST /integrations/claude/oauth/start
// Retorna: { auth_url, state, redirect_uri }
func (h *IntegrationHandler) StartClaudeOAuth(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	authURL, state, err := h.claudeOAuth.StartAuthorization(user.ID.String())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"auth_url":     authURL,
		"state":        state,
		"redirect_uri": services.DefaultClaudeOAuthRedirect,
		"instructions": "Abra a URL no navegador, autorize com sua conta Claude.ai, copie o código mostrado ao final e envie em /integrations/claude/oauth/callback junto com o state.",
	})
}

// CompleteClaudeOAuth finaliza o fluxo OAuth trocando code por tokens.
// POST /integrations/claude/oauth/callback
// Body: { code, state, name? }
func (h *IntegrationHandler) CompleteClaudeOAuth(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		Code  string `json:"code"`
		State string `json:"state"`
		Name  string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || req.Code == "" || req.State == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "code e state são obrigatórios"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()

	tok, authUserID, err := h.claudeOAuth.ExchangeCode(ctx, req.Code, req.State)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	if authUserID != user.ID.String() {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "state não pertence ao usuário autenticado"})
	}

	// Persist integration
	name := req.Name
	if name == "" {
		name = "Claude.ai (OAuth)"
	}
	modelsJSON, _ := json.Marshal([]string{"claude-sonnet-4-5", "claude-opus-4-5", "claude-3-5-sonnet-latest"})

	var expiresAt *time.Time
	if tok.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
		expiresAt = &t
	}

	integ := models.UserIntegration{
		UserID:            user.ID,
		Provider:          models.ProviderClaude,
		Name:              name,
		AuthType:          models.AuthTypeOAuth,
		OAuthAccessToken:  tok.AccessToken,
		OAuthRefreshToken: tok.RefreshToken,
		OAuthExpiresAt:    expiresAt,
		OAuthAccount:      tok.Account,
		OAuthScope:        tok.Scope,
		Models:            string(modelsJSON),
		IsActive:          true,
		Config:            "{}",
	}
	if err := h.db.Create(&integ).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar integração"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":            integ.ID,
		"provider":      integ.Provider,
		"name":          integ.Name,
		"auth_type":     integ.AuthType,
		"oauth_account": integ.OAuthAccount,
		"oauth_scope":   integ.OAuthScope,
		"expires_at":    integ.OAuthExpiresAt,
		"is_active":     integ.IsActive,
	})
}

// StartOpenRouterOAuth inicia o fluxo OAuth PKCE do OpenRouter.
// POST /integrations/openrouter/oauth/start
// Body opcional: { callback_url } — se omitido, usa APP_URL/integrations/openrouter/callback.
// Retorna: { auth_url, state, callback_url }
func (h *IntegrationHandler) StartOpenRouterOAuth(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		CallbackURL string `json:"callback_url"`
	}
	_ = c.BodyParser(&req)

	authURL, state, callbackURL, err := h.openRouterOAuth.StartAuthorization(user.ID.String(), req.CallbackURL)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"auth_url":     authURL,
		"state":        state,
		"callback_url": callbackURL,
		"instructions": "Abra auth_url no navegador. Após autorizar, o OpenRouter vai redirecionar para callback_url com ?code=... Envie o code + state para /integrations/openrouter/oauth/callback.",
	})
}

// CompleteOpenRouterOAuth troca o authorization_code pela API key persistente.
// POST /integrations/openrouter/oauth/callback
// Body: { code, state, name? }
func (h *IntegrationHandler) CompleteOpenRouterOAuth(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		Code  string `json:"code"`
		State string `json:"state"`
		Name  string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || req.Code == "" || req.State == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "code e state são obrigatórios"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()

	tok, authUserID, err := h.openRouterOAuth.ExchangeCode(ctx, req.Code, req.State)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	if authUserID != user.ID.String() {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "state não pertence ao usuário autenticado"})
	}

	name := req.Name
	if name == "" {
		name = "OpenRouter (OAuth)"
		if tok.UserName != "" {
			name = fmt.Sprintf("OpenRouter · %s", tok.UserName)
		}
	}
	// Dois modelos de boas práticas por padrão — usuário pode editar depois.
	modelsJSON, _ := json.Marshal([]string{
		"anthropic/claude-sonnet-4.5",
		"openai/gpt-5",
		"google/gemini-2.5-pro",
	})

	integ := models.UserIntegration{
		UserID:       user.ID,
		Provider:     models.ProviderOpenRouter,
		Name:         name,
		AuthType:     models.AuthTypeOAuth, // marca origem; key vive em APIKey
		APIKey:       tok.Key,
		OAuthAccount: tok.UserName,
		BaseURL:      "https://openrouter.ai/api",
		Models:       string(modelsJSON),
		IsActive:     true,
		Config:       "{}",
	}
	if err := h.db.Create(&integ).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar integração"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":            integ.ID,
		"provider":      integ.Provider,
		"name":          integ.Name,
		"auth_type":     integ.AuthType,
		"oauth_account": integ.OAuthAccount,
		"masked_key":    models.MaskAPIKey(integ.APIKey),
		"is_active":     integ.IsActive,
	})
}

// RefreshClaudeOAuth renova o access token manualmente.
// POST /integrations/:id/oauth/refresh
func (h *IntegrationHandler) RefreshClaudeOAuth(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var integ models.UserIntegration
	if err := h.db.Where("id = ? AND user_id = ?", id, user.ID).First(&integ).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
	}
	if integ.Provider != models.ProviderClaude || integ.AuthType != models.AuthTypeOAuth {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "integração não é OAuth do Claude"})
	}
	if integ.OAuthRefreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sem refresh_token — reautentique"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()
	tok, err := h.claudeOAuth.RefreshAccessToken(ctx, integ.OAuthRefreshToken)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}

	updates := map[string]interface{}{
		"o_auth_access_token":  tok.AccessToken,
		"o_auth_refresh_token": tok.RefreshToken,
	}
	if tok.ExpiresIn > 0 {
		updates["o_auth_expires_at"] = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	}
	h.db.Model(&integ).Updates(updates)

	return c.JSON(fiber.Map{"ok": true, "expires_at": updates["o_auth_expires_at"]})
}

// GET /integrations
func (h *IntegrationHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var integrations []models.UserIntegration
	if err := h.db.Where("user_id = ?", user.ID).Order("created_at ASC").Find(&integrations).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar integrações"})
	}
	// Mask API keys before returning
	for i := range integrations {
		integrations[i].MaskedKey = models.MaskAPIKey(integrations[i].APIKey)
		integrations[i].APIKey = ""
	}
	return c.JSON(integrations)
}

// POST /integrations
func (h *IntegrationHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		Provider string   `json:"provider"`
		Name     string   `json:"name"`
		APIKey   string   `json:"api_key"`
		BaseURL  string   `json:"base_url"`
		Models   []string `json:"models"`
		Config   string   `json:"config"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Provider == "" || req.APIKey == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider e api_key são obrigatórios"})
	}

	modelsJSON := "[]"
	if len(req.Models) > 0 {
		b, _ := json.Marshal(req.Models)
		modelsJSON = string(b)
	}

	integration := models.UserIntegration{
		UserID:   user.ID,
		Provider: models.IntegrationProvider(req.Provider),
		Name:     req.Name,
		APIKey:   req.APIKey,
		BaseURL:  req.BaseURL,
		Models:   modelsJSON,
		Config:   req.Config,
		IsActive: true,
	}
	if integration.Name == "" {
		integration.Name = req.Provider
	}
	if integration.Config == "" {
		integration.Config = "{}"
	}

	if err := h.db.Create(&integration).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar integração"})
	}

	integration.MaskedKey = models.MaskAPIKey(integration.APIKey)
	integration.APIKey = ""
	return c.Status(fiber.StatusCreated).JSON(integration)
}

// PUT /integrations/:id
func (h *IntegrationHandler) Update(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}

	var integration models.UserIntegration
	if err := h.db.Where("id = ? AND user_id = ?", id, user.ID).First(&integration).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
	}

	var req struct {
		Name     *string   `json:"name"`
		APIKey   *string   `json:"api_key"`
		BaseURL  *string   `json:"base_url"`
		Models   *[]string `json:"models"`
		Config   *string   `json:"config"`
		IsActive *bool     `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.APIKey != nil {
		updates["api_key"] = *req.APIKey
	}
	if req.BaseURL != nil {
		updates["base_url"] = *req.BaseURL
	}
	if req.Models != nil {
		b, _ := json.Marshal(*req.Models)
		updates["models"] = string(b)
	}
	if req.Config != nil {
		updates["config"] = *req.Config
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	h.db.Model(&integration).Updates(updates)
	integration.MaskedKey = models.MaskAPIKey(integration.APIKey)
	integration.APIKey = ""
	return c.JSON(integration)
}

// DELETE /integrations/:id
func (h *IntegrationHandler) Delete(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.db.Where("id = ? AND user_id = ?", id, user.ID).Delete(&models.UserIntegration{}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao remover integração"})
	}
	return c.JSON(fiber.Map{"message": "integração removida"})
}

// POST /integrations/:id/test
func (h *IntegrationHandler) Test(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}

	var integration models.UserIntegration
	if err := h.db.Where("id = ? AND user_id = ?", id, user.ID).First(&integration).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
	}

	ok, msg := testIntegration(&integration)
	status := "ok"
	if !ok {
		status = "failed"
	}
	now := time.Now()
	h.db.Model(&integration).Updates(map[string]interface{}{
		"test_status":    status,
		"last_tested_at": now,
	})

	return c.JSON(fiber.Map{"ok": ok, "message": msg})
}

// POST /ai/generate — generate message variations using a user integration
func (h *IntegrationHandler) GenerateVariations(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		IntegrationID string `json:"integration_id"`
		Message       string `json:"message"`
		Count         int    `json:"count"`
		Tone          string `json:"tone"` // "formal", "casual", "persuasive", "friendly"
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message é obrigatório"})
	}
	if req.Count <= 0 || req.Count > 10 {
		req.Count = 3
	}
	if req.Tone == "" {
		req.Tone = "casual"
	}

	var integration models.UserIntegration
	if req.IntegrationID != "" {
		if err := h.db.Where("id = ? AND user_id = ? AND is_active = true", req.IntegrationID, user.ID).
			First(&integration).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
		}
	} else {
		// Use first active integration
		if err := h.db.Where("user_id = ? AND is_active = true", user.ID).
			First(&integration).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nenhuma integração ativa encontrada"})
		}
	}

	variations, err := generateWithLLM(&integration, req.Message, req.Count, req.Tone)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar variações: " + err.Error()})
	}

	return c.JSON(fiber.Map{"variations": variations})
}

// GET /instances/:id/agent
func (h *IntegrationHandler) GetAgent(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var agent models.InstanceAgent
	if err := h.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
		return tx.Order("created_at DESC")
	}).Where("instance_id = ?", inst.ID).First(&agent).Error; err != nil {
		return c.JSON(fiber.Map{
			"instance_id":     inst.ID,
			"rag_enabled":     true,
			"faq":             "[]",
			"variables":       "[]",
			"voice":           "{}",
			"skills":          "[]",
			"app_access":      "[]",
			"assets":          []models.AgentAsset{},
			"compiled_prompt": "",
		})
	}
	if agent.Integration != nil {
		agent.Integration.MaskedKey = models.MaskAPIKey(agent.Integration.APIKey)
		agent.Integration.APIKey = ""
	}
	return c.JSON(fiber.Map{
		"id":                       agent.ID,
		"instance_id":              agent.InstanceID,
		"integration_id":           agent.IntegrationID,
		"integration":              agent.Integration,
		"model":                    agent.Model,
		"system_prompt":            agent.SystemPrompt,
		"agent_name":               agent.AgentName,
		"identity":                 agent.Identity,
		"objective":                agent.Objective,
		"communication_guidelines": agent.CommunicationGuidelines,
		"service_instructions":     agent.ServiceInstructions,
		"restrictions":             agent.Restrictions,
		"knowledge_base":           agent.KnowledgeBase,
		"faq":                      safeJSONArray(agent.FAQ),
		"variables":                safeJSONArray(agent.Variables),
		"voice":                    safeJSONObject(agent.Voice),
		"skills":                   safeJSONArray(agent.Skills),
		"app_access":               safeJSONArray(agent.AppAccess),
		"rag_enabled":              agent.RAGEnabled,
		"is_active":                agent.IsActive,
		"webhook_url":              agent.WebhookURL,
		"webhook_secret":           agent.WebhookSecret,
		"mcp_server_url":           agent.MCPServerURL,
		"assets":                   agent.Assets,
		"compiled_prompt":          services.BuildAgentSystemPrompt(&agent, agent.Assets),
		"created_at":               agent.CreatedAt,
		"updated_at":               agent.UpdatedAt,
	})
}

// PUT /instances/:id/agent
func (h *IntegrationHandler) UpdateAgent(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		IntegrationID           *string                   `json:"integration_id"`
		Model                   *string                   `json:"model"`
		SystemPrompt            *string                   `json:"system_prompt"`
		AgentName               *string                   `json:"agent_name"`
		Identity                *string                   `json:"identity"`
		Objective               *string                   `json:"objective"`
		CommunicationGuidelines *string                   `json:"communication_guidelines"`
		ServiceInstructions     *string                   `json:"service_instructions"`
		Restrictions            *string                   `json:"restrictions"`
		KnowledgeBase           *string                   `json:"knowledge_base"`
		FAQ                     *[]map[string]interface{} `json:"faq"`
		Variables               *[]map[string]interface{} `json:"variables"`
		Voice                   *map[string]interface{}   `json:"voice"`
		Skills                  *[]map[string]interface{} `json:"skills"`
		AppAccess               *[]map[string]interface{} `json:"app_access"`
		RAGEnabled              *bool                     `json:"rag_enabled"`
		IsActive                *bool                     `json:"is_active"`
		WebhookURL              *string                   `json:"webhook_url"`
		WebhookSecret           *string                   `json:"webhook_secret"`
		MCPServerURL            *string                   `json:"mcp_server_url"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var agent models.InstanceAgent
	if err := h.db.Where("instance_id = ?", inst.ID).First(&agent).Error; err != nil {
		agent = models.InstanceAgent{
			InstanceID: inst.ID,
			FAQ:        "[]",
			Variables:  "[]",
			Voice:      "{}",
			Skills:     "[]",
			AppAccess:  "[]",
			RAGEnabled: true,
		}
	}

	if req.IntegrationID != nil {
		if *req.IntegrationID == "" {
			agent.IntegrationID = nil
		} else {
			pid, err := uuid.Parse(*req.IntegrationID)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "integration_id inválido"})
			}
			var integration models.UserIntegration
			if err := h.db.Where("id = ? AND user_id = ? AND is_active = true", pid, inst.UserID).First(&integration).Error; err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "integração não encontrada ou inativa"})
			}
			agent.IntegrationID = &pid
		}
	}
	if req.Model != nil {
		agent.Model = *req.Model
	}
	if req.SystemPrompt != nil {
		agent.SystemPrompt = *req.SystemPrompt
	}
	if req.AgentName != nil {
		agent.AgentName = *req.AgentName
	}
	if req.Identity != nil {
		agent.Identity = *req.Identity
	}
	if req.Objective != nil {
		agent.Objective = *req.Objective
	}
	if req.CommunicationGuidelines != nil {
		agent.CommunicationGuidelines = *req.CommunicationGuidelines
	}
	if req.ServiceInstructions != nil {
		agent.ServiceInstructions = *req.ServiceInstructions
	}
	if req.Restrictions != nil {
		agent.Restrictions = *req.Restrictions
	}
	if req.KnowledgeBase != nil {
		agent.KnowledgeBase = *req.KnowledgeBase
	}
	if req.FAQ != nil {
		agent.FAQ = marshalJSONString(*req.FAQ, "[]")
	}
	if req.Variables != nil {
		agent.Variables = marshalJSONString(*req.Variables, "[]")
	}
	if req.Voice != nil {
		agent.Voice = marshalJSONString(*req.Voice, "{}")
	}
	if req.Skills != nil {
		agent.Skills = marshalJSONString(*req.Skills, "[]")
	}
	if req.AppAccess != nil {
		agent.AppAccess = marshalJSONString(*req.AppAccess, "[]")
	}
	if req.RAGEnabled != nil {
		agent.RAGEnabled = *req.RAGEnabled
	}
	if req.IsActive != nil {
		agent.IsActive = *req.IsActive
	}
	if req.WebhookURL != nil {
		agent.WebhookURL = *req.WebhookURL
	}
	if req.WebhookSecret != nil {
		agent.WebhookSecret = *req.WebhookSecret
	}
	if req.MCPServerURL != nil {
		agent.MCPServerURL = *req.MCPServerURL
	}

	if err := h.db.Save(&agent).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar agente"})
	}

	return h.GetAgent(c)
}

// POST /instances/:id/agent/assets
func (h *IntegrationHandler) UploadAgentAsset(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	category := strings.TrimSpace(c.FormValue("category"))
	if category == "" {
		category = string(models.AgentAssetKnowledge)
	}
	switch models.AgentAssetCategory(category) {
	case models.AgentAssetKnowledge, models.AgentAssetFAQ, models.AgentAssetSkill:
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "categoria inválida"})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "arquivo é obrigatório"})
	}
	if file.Size > 8*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "arquivo excede o limite de 8MB"})
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao abrir arquivo"})
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao ler arquivo"})
	}

	var agent models.InstanceAgent
	if err := h.db.Where("instance_id = ?", inst.ID).First(&agent).Error; err != nil {
		agent = models.InstanceAgent{
			InstanceID: inst.ID,
			FAQ:        "[]",
			Variables:  "[]",
			Voice:      "{}",
			Skills:     "[]",
			AppAccess:  "[]",
			RAGEnabled: true,
		}
		if err := h.db.Create(&agent).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao inicializar agente"})
		}
	}

	contentType := file.Header.Get("Content-Type")
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	asset := models.AgentAsset{
		InstanceAgentID: agent.ID,
		Category:        models.AgentAssetCategory(category),
		Name:            strings.TrimSpace(c.FormValue("name")),
		FileName:        file.Filename,
		ContentType:     contentType,
		SizeBytes:       file.Size,
		ExtractedText:   extractAgentAssetText(file.Filename, data),
		ContentBase64:   base64.StdEncoding.EncodeToString(data),
		IsActive:        true,
	}
	if asset.Name == "" {
		asset.Name = strings.TrimSuffix(file.Filename, filepath.Ext(file.Filename))
	}

	if err := h.db.Create(&asset).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar arquivo"})
	}
	return c.Status(fiber.StatusCreated).JSON(asset)
}

// IngestAgentURL godoc
// POST /instances/:id/agent/ingest-url
//
// Ingere uma URL pública na knowledge base do agente: faz GET, limpa
// HTML pra texto plano, e salva como AgentAsset (categoria knowledge).
// Inspirado no UazAPI knowledge upload — clientes podem alimentar o
// bot com URLs de FAQ/blog sem precisar baixar e fazer upload manual.
func (h *IntegrationHandler) IngestAgentURL(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		URL  string `json:"url"`
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'url' é obrigatório"})
	}
	httpClient := &http.Client{Timeout: 20 * time.Second}
	resp, err := httpClient.Get(req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha ao buscar URL: " + err.Error()})
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": fmt.Sprintf("URL retornou HTTP %d", resp.StatusCode)})
	}
	// Limita 2MB pra evitar abuso (knowledge base é texto, raramente
	// > 200KB por URL).
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha ao ler body"})
	}

	contentType := resp.Header.Get("Content-Type")
	text := stripHTMLToText(body, contentType)
	if strings.TrimSpace(text) == "" {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "nenhum texto extraído da URL"})
	}

	agent, err := h.ensureInstanceAgent(inst.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = req.URL
	}
	asset := models.AgentAsset{
		InstanceAgentID: agent.ID,
		Category:        models.AgentAssetKnowledge,
		Name:            name,
		FileName:        req.URL,
		ContentType:     contentType,
		SizeBytes:       int64(len(text)),
		ExtractedText:   text,
		IsActive:        true,
	}
	if err := h.db.Create(&asset).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar"})
	}
	return c.Status(fiber.StatusCreated).JSON(asset)
}

// IngestAgentText godoc
// POST /instances/:id/agent/ingest-text
//
// Cria um AgentAsset diretamente a partir de texto colado pelo cliente
// (não precisa upload de arquivo). Útil pra FAQs curtos, instruções,
// catálogo simples.
func (h *IntegrationHandler) IngestAgentText(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		Name     string `json:"name"`
		Text     string `json:"text"`
		Category string `json:"category"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.Text) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'text' é obrigatório"})
	}
	if req.Category == "" {
		req.Category = string(models.AgentAssetKnowledge)
	}
	switch models.AgentAssetCategory(req.Category) {
	case models.AgentAssetKnowledge, models.AgentAssetFAQ, models.AgentAssetSkill:
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "categoria inválida"})
	}

	agent, err := h.ensureInstanceAgent(inst.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Knowledge note"
	}
	asset := models.AgentAsset{
		InstanceAgentID: agent.ID,
		Category:        models.AgentAssetCategory(req.Category),
		Name:            name,
		FileName:        name + ".txt",
		ContentType:     "text/plain",
		SizeBytes:       int64(len(req.Text)),
		ExtractedText:   req.Text,
		IsActive:        true,
	}
	if err := h.db.Create(&asset).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao salvar"})
	}
	return c.Status(fiber.StatusCreated).JSON(asset)
}

// ensureInstanceAgent retorna o agent da instância, criando-o se ausente.
// Usado pelos endpoints de ingestão pra permitir alimentar antes mesmo
// do agent ser configurado pela UI.
func (h *IntegrationHandler) ensureInstanceAgent(instanceID uuid.UUID) (*models.InstanceAgent, error) {
	var agent models.InstanceAgent
	if err := h.db.Where("instance_id = ?", instanceID).First(&agent).Error; err == nil {
		return &agent, nil
	}
	agent = models.InstanceAgent{
		InstanceID: instanceID,
		FAQ:        "[]",
		Variables:  "[]",
		Voice:      "{}",
		Skills:     "[]",
		AppAccess:  "[]",
		RAGEnabled: true,
	}
	if err := h.db.Create(&agent).Error; err != nil {
		return nil, fmt.Errorf("falha ao inicializar agente: %w", err)
	}
	return &agent, nil
}

// stripHTMLToText extrai texto plain de HTML (best-effort sem
// dependência externa). Pra outros content types (text/plain,
// application/json, markdown) retorna o body raw.
func stripHTMLToText(body []byte, contentType string) string {
	ct := strings.ToLower(contentType)
	if !strings.Contains(ct, "html") {
		return strings.TrimSpace(string(body))
	}
	s := string(body)
	// Remove script/style blocks (regex simples — não tenta ser HTML parser).
	s = htmlScriptRegex.ReplaceAllString(s, " ")
	s = htmlStyleRegex.ReplaceAllString(s, " ")
	// Tags → espaço
	s = htmlTagRegex.ReplaceAllString(s, " ")
	// Decode entidades básicas
	s = html.UnescapeString(s)
	// Colapsa whitespace
	s = htmlWhitespaceRegex.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

var (
	htmlScriptRegex     = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	htmlStyleRegex      = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	htmlTagRegex        = regexp.MustCompile(`(?is)<[^>]+>`)
	htmlWhitespaceRegex = regexp.MustCompile(`\s+`)
)

// DELETE /instances/:id/agent/assets/:assetId
func (h *IntegrationHandler) DeleteAgentAsset(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	assetID, err := uuid.Parse(c.Params("assetId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "assetId inválido"})
	}

	var asset models.AgentAsset
	if err := h.db.Joins("JOIN instance_agents ON instance_agents.id = agent_assets.instance_agent_id").
		Where("agent_assets.id = ? AND instance_agents.instance_id = ?", assetID, inst.ID).
		First(&asset).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "arquivo não encontrado"})
	}
	if err := h.db.Delete(&asset).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao remover arquivo"})
	}
	return c.JSON(fiber.Map{"deleted": true, "id": assetID})
}

func marshalJSONString(v interface{}, fallback string) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fallback
	}
	s := string(b)
	if s == "" || s == "null" {
		return fallback
	}
	return s
}

func safeJSONArray(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || v == "null" {
		return "[]"
	}
	return v
}

func safeJSONObject(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || v == "null" {
		return "{}"
	}
	return v
}

var xmlTagRegex = regexp.MustCompile(`<[^>]+>`)

func extractAgentAssetText(filename string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt", ".md", ".markdown", ".json", ".csv":
		return string(data)
	case ".docx":
		return extractZipXMLText(data, func(name string) bool {
			return name == "word/document.xml" || strings.HasPrefix(name, "word/header") || strings.HasPrefix(name, "word/footer")
		})
	case ".pptx":
		return extractZipXMLText(data, func(name string) bool {
			return strings.HasPrefix(name, "ppt/slides/slide") && strings.HasSuffix(name, ".xml")
		})
	default:
		return ""
	}
}

func extractZipXMLText(data []byte, include func(name string) bool) string {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}

	names := make([]string, 0)
	byName := make(map[string]*zip.File)
	for _, f := range reader.File {
		if include(f.Name) {
			names = append(names, f.Name)
			byName[f.Name] = f
		}
	}
	sort.Strings(names)

	parts := make([]string, 0, len(names))
	for _, name := range names {
		rc, err := byName[name].Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		text := html.UnescapeString(xmlTagRegex.ReplaceAllString(string(b), " "))
		text = strings.Join(strings.Fields(text), " ")
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

func testIntegration(i *models.UserIntegration) (bool, string) {
	switch i.Provider {
	case models.ProviderClaude:
		return testClaude(i)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter,
		models.ProviderKilo, models.ProviderZai, models.ProviderKimi,
		models.ProviderQwen, models.ProviderMiniMax, models.ProviderManus,
		models.ProviderMistral:
		return testOpenAICompat(i)
	case models.ProviderGemini:
		return testGemini(i.APIKey)
	case models.ProviderN8N, models.ProviderWebhook:
		if i.BaseURL == "" {
			return false, "URL do webhook não configurada"
		}
		return true, "Webhook URL configurada (não testável automaticamente)"
	default:
		return false, "provider desconhecido"
	}
}

func testClaude(i *models.UserIntegration) (bool, string) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	req.Header.Set("anthropic-version", "2023-06-01")
	if i.HasOAuth() {
		req.Header.Set("Authorization", "Bearer "+i.OAuthAccessToken)
		req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	} else {
		req.Header.Set("x-api-key", i.APIKey)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "falha de conexão: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		if i.HasOAuth() {
			return true, "Conexão OAuth com Claude.ai bem-sucedida"
		}
		return true, "Conexão com Claude API bem-sucedida"
	}
	return false, fmt.Sprintf("Claude API retornou status %d", resp.StatusCode)
}

func testOpenAICompat(i *models.UserIntegration) (bool, string) {
	baseURL := i.BaseURL
	modelsPath := "/v1/models"
	if baseURL == "" {
		switch i.Provider {
		case models.ProviderDeepSeek:
			baseURL = "https://api.deepseek.com"
		case models.ProviderOpenRouter:
			baseURL = "https://openrouter.ai/api"
		case models.ProviderKilo:
			baseURL = "https://api.kilo.ai"
		case models.ProviderZai:
			baseURL = "https://api.z.ai/api/paas"
			modelsPath = "/v4/models"
		case models.ProviderKimi:
			baseURL = "https://api.moonshot.ai"
		case models.ProviderQwen:
			baseURL = "https://dashscope-intl.aliyuncs.com/compatible-mode"
		case models.ProviderMiniMax:
			baseURL = "https://api.minimaxi.chat"
		case models.ProviderManus:
			baseURL = "https://api.manus.chat"
		case models.ProviderMistral:
			baseURL = "https://api.mistral.ai"
		default:
			baseURL = "https://api.openai.com"
		}
	}
	req, _ := http.NewRequest(http.MethodGet, baseURL+modelsPath, nil)
	req.Header.Set("Authorization", "Bearer "+i.APIKey)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "falha de conexão: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return true, fmt.Sprintf("Conexão com %s bem-sucedida", i.Provider)
	}
	return false, fmt.Sprintf("%s retornou status %d", i.Provider, resp.StatusCode)
}

func testGemini(apiKey string) (bool, string) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", apiKey)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false, "falha de conexão: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return true, "Conexão com Gemini API bem-sucedida"
	}
	return false, fmt.Sprintf("Gemini API retornou status %d", resp.StatusCode)
}

func generateWithLLM(i *models.UserIntegration, message string, count int, tone string) ([]string, error) {
	prompt := fmt.Sprintf(
		`Gere %d variações da seguinte mensagem de marketing/campanha. Tom: %s.
Mantenha o sentido original mas varie o estilo, palavras e estrutura.
Retorne APENAS um JSON array de strings com as variações, sem explicações.

Mensagem original:
"%s"

Responda APENAS com JSON: ["variação 1", "variação 2", ...]`,
		count, tone, message,
	)

	switch i.Provider {
	case models.ProviderClaude:
		return callClaude(i.APIKey, i.GetFirstModel(), prompt)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter:
		return callOpenAICompat(i, prompt)
	case models.ProviderGemini:
		return callGemini(i.APIKey, i.GetFirstModel(), prompt)
	default:
		return nil, fmt.Errorf("provider %s não suporta geração de texto", i.Provider)
	}
}

func callClaude(apiKey, model, prompt string) ([]string, error) {
	if model == "" {
		model = "claude-3-5-haiku-20241022"
	}
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 1024,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})
	req, _ := http.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || len(result.Content) == 0 {
		return nil, fmt.Errorf("resposta inválida da Claude API")
	}
	return parseVariations(result.Content[0].Text)
}

func callOpenAICompat(i *models.UserIntegration, prompt string) ([]string, error) {
	baseURL := i.BaseURL
	if baseURL == "" {
		switch i.Provider {
		case models.ProviderDeepSeek:
			baseURL = "https://api.deepseek.com"
		case models.ProviderOpenRouter:
			baseURL = "https://openrouter.ai/api"
		default:
			baseURL = "https://api.openai.com"
		}
	}
	model := i.GetFirstModel()
	if model == "" {
		switch i.Provider {
		case models.ProviderDeepSeek:
			model = "deepseek-chat"
		case models.ProviderOpenRouter:
			model = "openai/gpt-4o-mini"
		default:
			model = "gpt-4o-mini"
		}
	}
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 1024,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+i.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || len(result.Choices) == 0 {
		return nil, fmt.Errorf("resposta inválida da API")
	}
	return parseVariations(result.Choices[0].Message.Content)
}

func callGemini(apiKey, model, prompt string) ([]string, error) {
	if model == "" {
		model = "gemini-1.5-flash"
	}
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", model, apiKey)
	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": prompt}}},
		},
	})
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || len(result.Candidates) == 0 {
		return nil, fmt.Errorf("resposta inválida do Gemini")
	}
	if len(result.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("resposta vazia do Gemini")
	}
	return parseVariations(result.Candidates[0].Content.Parts[0].Text)
}

func parseVariations(text string) ([]string, error) {
	// Try to parse as JSON array directly
	var variations []string
	if err := json.Unmarshal([]byte(text), &variations); err == nil {
		return variations, nil
	}
	// Try to extract JSON array from text
	start := -1
	for i, ch := range text {
		if ch == '[' {
			start = i
			break
		}
	}
	end := -1
	for i := len(text) - 1; i >= 0; i-- {
		if text[i] == ']' {
			end = i
			break
		}
	}
	if start >= 0 && end > start {
		if err := json.Unmarshal([]byte(text[start:end+1]), &variations); err == nil {
			return variations, nil
		}
	}
	// Fallback: return as single variation
	return []string{text}, nil
}
