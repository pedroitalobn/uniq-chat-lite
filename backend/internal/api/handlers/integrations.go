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
	"github.com/rs/zerolog/log"
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

// ClaudeOAuthClientMetadata serve o JSON de metadata pública do cliente OAuth.
// GET /v1/integrations/claude/client-metadata (sem autenticação)
//
// Anthropic's authorization server faz GET nesta URL para validar o client_id
// (que é a própria URL desta rota) e obter os redirect_uris permitidos.
func (h *IntegrationHandler) ClaudeOAuthClientMetadata(c *fiber.Ctx) error {
	clientID := services.ClaudeOAuthClientID()
	redirectURI := services.ClaudeOAuthRedirectURI()
	c.Set("Content-Type", "application/json")
	return c.JSON(fiber.Map{
		"client_id":                  clientID,
		"client_name":                "Uniq Chat",
		"client_uri":                 "https://uniq.chat",
		"redirect_uris":              []string{redirectURI},
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"scope":                      services.DefaultClaudeOAuthScope,
	})
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
		"auth_url": authURL,
		"state":    state,
	})
}

// CompleteClaudeOAuthAuto é o handler para o auto-callback OAuth sem copy-paste.
// POST /integrations/claude/oauth/callback-auto
// Body: { code, state, name? } — chamado pelo frontend depois de ler code+state da URL.
// Alias de CompleteClaudeOAuth; separated for clarity.
func (h *IntegrationHandler) CompleteClaudeOAuthAuto(c *fiber.Ctx) error {
	return h.CompleteClaudeOAuth(c)
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
		// 422 em vez de 502: o Cloudflare intercepta 5xx de origin e apaga
		// o body, deixando o usuário sem mensagem de erro. 422 passa direto.
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": err.Error()})
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

	wsIDs := userWorkspaceIDs(h.db, user.ID)

	var integrations []models.UserIntegration
	q := h.db.Order("created_at ASC")
	if len(wsIDs) > 0 {
		q = q.Where("workspace_id IN ? OR (user_id = ? AND workspace_id IS NULL)", wsIDs, user.ID)
	} else {
		q = q.Where("user_id = ?", user.ID)
	}
	if err := q.Find(&integrations).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar integrações"})
	}
	for i := range integrations {
		integrations[i].MaskedKey = models.MaskAPIKey(integrations[i].APIKey)
		integrations[i].APIKey = ""
	}
	return c.JSON(integrations)
}

// userWorkspaceIDs returns all workspace IDs the user is a member of.
func userWorkspaceIDs(db *gorm.DB, userID uuid.UUID) []uuid.UUID {
	var uws []models.UserWorkspace
	db.Where("user_id = ?", userID).Find(&uws)
	ids := make([]uuid.UUID, 0, len(uws))
	for _, uw := range uws {
		ids = append(ids, uw.WorkspaceID)
	}
	return ids
}

// canManageIntegration returns true if the user created the integration (user_id match)
// or is the owner of the workspace it belongs to.
func canManageIntegration(db *gorm.DB, userID uuid.UUID, integ *models.UserIntegration) bool {
	if integ.UserID == userID {
		return true
	}
	if integ.WorkspaceID != nil {
		var uw models.UserWorkspace
		return db.Where("user_id = ? AND workspace_id = ? AND is_owner = true", userID, *integ.WorkspaceID).First(&uw).Error == nil
	}
	return false
}

// POST /integrations
func (h *IntegrationHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var req struct {
		Provider    string   `json:"provider"`
		Name        string   `json:"name"`
		APIKey      string   `json:"api_key"`
		BaseURL     string   `json:"base_url"`
		Models      []string `json:"models"`
		Config      string   `json:"config"`
		WorkspaceID string   `json:"workspace_id"`
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

	// Associate with workspace if provided and user is a member
	if req.WorkspaceID != "" {
		wsID, err := uuid.Parse(req.WorkspaceID)
		if err == nil {
			var uw models.UserWorkspace
			if h.db.Where("user_id = ? AND workspace_id = ?", user.ID, wsID).First(&uw).Error == nil {
				integration.WorkspaceID = &wsID
			}
		}
	} else {
		// Auto-associate with the user's first workspace (if any)
		wsIDs := userWorkspaceIDs(h.db, user.ID)
		if len(wsIDs) > 0 {
			integration.WorkspaceID = &wsIDs[0]
		}
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
	if err := h.db.First(&integration, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
	}
	if !canManageIntegration(h.db, user.ID, &integration) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão"})
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
	var integration models.UserIntegration
	if err := h.db.First(&integration, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integração não encontrada"})
	}
	if !canManageIntegration(h.db, user.ID, &integration) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem permissão"})
	}
	if err := h.db.Delete(&integration).Error; err != nil {
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

	wsIDs := userWorkspaceIDs(h.db, user.ID)
	var integration models.UserIntegration
	q := h.db.Where("id = ?", id)
	if len(wsIDs) > 0 {
		q = q.Where("workspace_id IN ? OR user_id = ?", wsIDs, user.ID)
	} else {
		q = q.Where("user_id = ?", user.ID)
	}
	if err := q.First(&integration).Error; err != nil {
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
	// Multi-agente: retorna o primário por padrão; UI nova passa ?agent_id=
	// pra editar agentes específicos.
	q := h.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
		return tx.Order("created_at DESC")
	})
	if aid := c.Query("agent_id"); aid != "" {
		q = q.Where("id = ? AND instance_id = ?", aid, inst.ID)
	} else {
		q = q.Where("instance_id = ?", inst.ID).Order("is_primary DESC, created_at ASC")
	}
	if err := q.First(&agent).Error; err != nil {
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
		// Multi-agente: configuráveis pelo UI ao editar agentes secundários.
		Role               *string   `json:"role"`
		HandoffSkills      *[]string `json:"handoff_skills"`
		ActionConfirmation *string   `json:"action_confirmation"`
		// Janelas de ativação (item 4 do roadmap)
		ActivationMode *string                 `json:"activation_mode"`
		Schedule       *map[string]interface{} `json:"schedule"`
		ContextRules   *map[string]interface{} `json:"context_rules"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var agent models.InstanceAgent
	// Multi-agente: ?agent_id= seleciona o agente específico; sem param,
	// edita o primário (preserva fluxo single-agent).
	q := h.db.Where("instance_id = ?", inst.ID)
	if aid := c.Query("agent_id"); aid != "" {
		q = q.Where("id = ?", aid)
	} else {
		q = q.Order("is_primary DESC, created_at ASC")
	}
	if err := q.First(&agent).Error; err != nil {
		agent = models.InstanceAgent{
			InstanceID:         inst.ID,
			FAQ:                "[]",
			Variables:          "[]",
			Voice:              "{}",
			Skills:             "[]",
			AppAccess:          "[]",
			HandoffSkills:      "[]",
			RAGEnabled:         true,
			IsPrimary:          true,
			Role:               "primary",
			Priority:           100,
			ActionConfirmation: "client",
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
		// Limite de agentes ATIVOS — membro herda plano do dono do workspace
		// da instância (resolveEffectivePlan via instance.WorkspaceID).
		if *req.IsActive && !agent.IsActive {
			user := middleware.GetCurrentUser(c)
			if user != nil {
				ownerID, plan := resolveEffectivePlan(h.db, user, inst.WorkspaceID)
				if plan != nil && plan.MaxAgents > 0 {
					var count int64
					h.db.Model(&models.InstanceAgent{}).
						Joins("JOIN instances ON instances.id = instance_agents.instance_id").
						Where("instances.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = ?) AND instance_agents.is_active = ?", ownerID, true).
						Count(&count)
					if int(count) >= plan.MaxAgents {
						return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
							"error": "limite de agentes ativos atingido para o plano do workspace",
							"limit": plan.MaxAgents,
						})
					}
				}
			}
		}
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
	if req.Role != nil {
		agent.Role = strings.ToLower(strings.TrimSpace(*req.Role))
	}
	if req.HandoffSkills != nil {
		agent.HandoffSkills = marshalJSONString(*req.HandoffSkills, "[]")
	}
	if req.ActionConfirmation != nil {
		switch strings.ToLower(strings.TrimSpace(*req.ActionConfirmation)) {
		case "client", "auto", "human":
			agent.ActionConfirmation = strings.ToLower(*req.ActionConfirmation)
		}
	}
	if req.ActivationMode != nil {
		switch strings.ToLower(strings.TrimSpace(*req.ActivationMode)) {
		case "always", "business_hours", "off_hours", "new_contact_only", "custom":
			agent.ActivationMode = strings.ToLower(*req.ActivationMode)
		}
	}
	if req.Schedule != nil {
		agent.Schedule = marshalJSONString(*req.Schedule, "{}")
	}
	if req.ContextRules != nil {
		agent.ContextRules = marshalJSONString(*req.ContextRules, "{}")
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
	// Multi-agente: ?agent_id= seleciona o agente específico; sem param,
	// edita o primário (preserva fluxo single-agent).
	q := h.db.Where("instance_id = ?", inst.ID)
	if aid := c.Query("agent_id"); aid != "" {
		q = q.Where("id = ?", aid)
	} else {
		q = q.Order("is_primary DESC, created_at ASC")
	}
	if err := q.First(&agent).Error; err != nil {
		agent = models.InstanceAgent{
			InstanceID:         inst.ID,
			FAQ:                "[]",
			Variables:          "[]",
			Voice:              "{}",
			Skills:             "[]",
			AppAccess:          "[]",
			HandoffSkills:      "[]",
			RAGEnabled:         true,
			IsPrimary:          true,
			Role:               "primary",
			Priority:           100,
			ActionConfirmation: "client",
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

// ensureInstanceAgent retorna o agent PRIMÁRIO da instância, criando-o
// se ausente. Multi-agente: prioriza is_primary=true; cai pro primeiro
// criado (por created_at) se nenhum estiver marcado como primário (legado).
func (h *IntegrationHandler) ensureInstanceAgent(instanceID uuid.UUID) (*models.InstanceAgent, error) {
	var agent models.InstanceAgent
	if err := h.db.Where("instance_id = ? AND is_primary = ?", instanceID, true).First(&agent).Error; err == nil {
		return &agent, nil
	}
	if err := h.db.Where("instance_id = ?", instanceID).Order("created_at ASC").First(&agent).Error; err == nil {
		// Marca como primary on-the-fly se ainda não está. Idempotente.
		if !agent.IsPrimary {
			h.db.Model(&agent).Update("is_primary", true)
			agent.IsPrimary = true
		}
		return &agent, nil
	}
	agent = models.InstanceAgent{
		InstanceID:         instanceID,
		FAQ:                "[]",
		Variables:          "[]",
		Voice:              "{}",
		Skills:             "[]",
		AppAccess:          "[]",
		HandoffSkills:      "[]",
		RAGEnabled:         true,
		IsPrimary:          true,
		Role:               "primary",
		Priority:           100,
		ActionConfirmation: "client",
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

// ─── Multi-agente: gerenciamento dos agentes de uma instância ─────────────

// ListInstanceAgents — todos os agentes da instância. Usado pela UI
// pra mostrar a lista e oferecer "+ adicionar agente".
func (h *IntegrationHandler) ListInstanceAgents(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var agents []models.InstanceAgent
	h.db.Select("id, agent_name, role, is_primary, is_active, priority, handoff_skills, action_confirmation, model, created_at, updated_at").
		Where("instance_id = ?", inst.ID).
		Order("is_primary DESC, priority ASC, created_at ASC").
		Find(&agents)
	return c.JSON(fiber.Map{"agents": agents})
}

// CreateInstanceAgent — cria um agente adicional (não-primário) na
// instância. Body: { agent_name, role, handoff_skills?, action_confirmation? }.
// Não promove a primary — pra isso usar set-primary explicitamente.
func (h *IntegrationHandler) CreateInstanceAgent(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		AgentName          string   `json:"agent_name"`
		Role               string   `json:"role"`
		HandoffSkills      []string `json:"handoff_skills"`
		ActionConfirmation string   `json:"action_confirmation"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	req.AgentName = strings.TrimSpace(req.AgentName)
	req.Role = strings.TrimSpace(strings.ToLower(req.Role))
	if req.AgentName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "agent_name é obrigatório"})
	}
	if req.Role == "" {
		req.Role = "support"
	}
	if req.ActionConfirmation == "" {
		req.ActionConfirmation = "client"
	}
	skillsJSON := "[]"
	if len(req.HandoffSkills) > 0 {
		if b, err := json.Marshal(req.HandoffSkills); err == nil {
			skillsJSON = string(b)
		}
	}
	// Garante existência de um primário antes de criar secundários — sem
	// isso, ensureInstanceAgent disparado em paralelo poderia criar OUTRO
	// primário e ficar com 2.
	if _, err := h.ensureInstanceAgent(inst.ID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	agent := models.InstanceAgent{
		InstanceID:         inst.ID,
		AgentName:          req.AgentName,
		Role:               req.Role,
		HandoffSkills:      skillsJSON,
		ActionConfirmation: req.ActionConfirmation,
		FAQ:                "[]",
		Variables:          "[]",
		Voice:              "{}",
		Skills:             "[]",
		AppAccess:          "[]",
		RAGEnabled:         true,
		IsPrimary:          false,
		Priority:           200,
	}
	if err := h.db.Create(&agent).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar agente: " + err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(agent)
}

// DeleteInstanceAgent — remove agente. Bloqueia exclusão do primário
// quando há outros agentes (precisa promover outro antes); permite quando
// é o único da instância (limpeza total).
func (h *IntegrationHandler) DeleteInstanceAgent(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	agentID, err := uuid.Parse(c.Params("agent_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "agent_id inválido"})
	}
	var agent models.InstanceAgent
	if err := h.db.Where("id = ? AND instance_id = ?", agentID, inst.ID).First(&agent).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "agente não encontrado"})
	}
	if agent.IsPrimary {
		var others int64
		h.db.Model(&models.InstanceAgent{}).Where("instance_id = ? AND id <> ?", inst.ID, agent.ID).Count(&others)
		if others > 0 {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "não é possível remover o agente primário com outros agentes ativos. Promova outro primeiro.",
			})
		}
	}
	// Limpa assets associados antes de deletar o agente.
	h.db.Where("instance_agent_id = ?", agent.ID).Delete(&models.AgentAsset{})
	h.db.Delete(&agent)
	return c.SendStatus(fiber.StatusNoContent)
}

// SetPrimaryInstanceAgent — promove um agente a primário. Atomic: o
// antigo primário perde a flag. Usado pela UI quando user troca o
// "agente padrão" da instância.
func (h *IntegrationHandler) SetPrimaryInstanceAgent(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	agentID, err := uuid.Parse(c.Params("agent_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "agent_id inválido"})
	}
	var target models.InstanceAgent
	if err := h.db.Where("id = ? AND instance_id = ?", agentID, inst.ID).First(&target).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "agente não encontrado"})
	}
	tx := h.db.Begin()
	if err := tx.Model(&models.InstanceAgent{}).
		Where("instance_id = ? AND id <> ?", inst.ID, target.ID).
		Update("is_primary", false).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if err := tx.Model(&target).Update("is_primary", true).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	tx.Commit()
	return c.JSON(fiber.Map{"ok": true})
}

// ─── Wizard simplificado (item 5 do roadmap) ──────────────────────────────

// QuickSetupQuiz — payload com 7 respostas curtas que o user deu no wizard.
// Cada campo é opcional: faltas viram placeholders genéricos.
type QuickSetupQuiz struct {
	AgentName       string   `json:"agent_name"`
	BusinessName    string   `json:"business_name"`
	BusinessSegment string   `json:"business_segment"`
	BusinessUSP     string   `json:"business_usp"` // diferencial
	Role            string   `json:"role"`         // atendimento, vendas, suporte, qualificacao, agendamento
	Tone            string   `json:"tone"`         // formal, casual, próximo, técnico
	Objective       string   `json:"objective"`    // ex: "agendar consulta", "qualificar lead"
	Restrictions    []string `json:"restrictions"` // ex: ["nunca prometer prazo", "não falar de concorrentes"]
	Escalation      string   `json:"escalation"`   // quando passar pra humano
}

// GenerateAgentFromQuiz — POST /v1/instances/:id/agent/generate-from-quiz?agent_id=
// Pega 5-7 respostas curtas e usa o LLM da conta pra gerar identity/objective/
// communication_guidelines/service_instructions/restrictions/agent_name. Antes
// o user encarava 5 abas com prompts vazios e abandonava o setup.
func (h *IntegrationHandler) GenerateAgentFromQuiz(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	var quiz QuickSetupQuiz
	if err := c.BodyParser(&quiz); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	// LLM resolution: usa a integração ativa do user. Em fluxo Uniq AI a
	// platform AI é resolvida no agent_runtime; aqui é geração one-shot
	// barata então caímos pro user_integration mais simples.
	var integration models.UserIntegration
	if err := h.db.Where("user_id = ? AND is_active = true", user.ID).
		Order("created_at ASC").First(&integration).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "nenhuma integração de IA ativa — configure uma LLM antes de usar o setup rápido",
		})
	}

	// Meta-prompt — pede JSON com 5 seções. Em PT-BR pra texto pronto pra
	// uso no atendimento brasileiro. Tom calibrado por `quiz.Tone`.
	prompt := buildQuickSetupPrompt(quiz)
	raw, err := callLLMOneShot(&integration, prompt)
	if err != nil {
		log.Error().Err(err).Msg("agent quick-setup: LLM call falhou")
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha ao gerar — verifique sua LLM ativa"})
	}

	parsed := parseQuickSetupResponse(raw, quiz)
	return c.JSON(parsed)
}

func buildQuickSetupPrompt(q QuickSetupQuiz) string {
	defNonEmpty := func(s, fallback string) string {
		if strings.TrimSpace(s) == "" {
			return fallback
		}
		return s
	}
	role := defNonEmpty(q.Role, "atendimento")
	tone := defNonEmpty(q.Tone, "casual e próximo")
	business := defNonEmpty(q.BusinessName, "a empresa")
	segment := defNonEmpty(q.BusinessSegment, "o setor configurado")
	usp := defNonEmpty(q.BusinessUSP, "atendimento personalizado")
	objective := defNonEmpty(q.Objective, "ajudar o cliente e direcionar pra próxima etapa")
	escalation := defNonEmpty(q.Escalation, "questões fora do escopo, reclamações sérias ou pedido explícito")
	name := defNonEmpty(q.AgentName, "Agente IA")
	restrictions := strings.Join(q.Restrictions, ", ")
	if restrictions == "" {
		restrictions = "nunca inventar informação, nunca prometer o que não pode entregar"
	}

	return fmt.Sprintf(`Você é um copywriter especializado em prompts de agentes de atendimento conversacional brasileiros (WhatsApp, principalmente).

Gere um prompt SYSTEM completo e enxuto pra um agente IA com base nas informações abaixo. RESPONDA APENAS COM JSON VÁLIDO no formato:

{
  "agent_name": "...",
  "identity": "...",
  "objective": "...",
  "communication_guidelines": "...",
  "service_instructions": "...",
  "restrictions": "..."
}

Regras de produção do texto:
- 4–7 linhas curtas por seção (não escreva ensaios).
- Português brasileiro natural, não-corporativo.
- Tom: %s. Aplique CONSISTENTEMENTE em communication_guidelines.
- identity: descreve QUEM o agente é, em 1ª pessoa do agente ("Eu sou...").
- objective: 1 parágrafo CURTO com a meta principal de cada conversa.
- communication_guidelines: regras de estilo, formato (frases curtas, sem emojis exceto…), nivelamento.
- service_instructions: passo-a-passo do que fazer em conversas típicas — incluindo quando passar pra humano (%s).
- restrictions: bullet/lista do que NÃO fazer.
- Se faltar info, infira algo razoável; nunca inclua placeholders tipo "[insira aqui]".

Inputs do usuário:
- Nome do agente: %s
- Negócio: %s (segmento: %s)
- Diferencial / USP: %s
- Função do agente: %s
- Objetivo principal de cada conversa: %s
- Restrições: %s
- Quando passar pra humano: %s

Retorne SOMENTE o JSON, sem markdown, sem explicações.`, tone, escalation, name, business, segment, usp, role, objective, restrictions, escalation)
}

// callLLMOneShot — wrapper que escolhe o provider e devolve o texto cru.
// Refator do generateWithLLM pra responder uma string única (não array).
func callLLMOneShot(i *models.UserIntegration, prompt string) (string, error) {
	switch i.Provider {
	case models.ProviderClaude:
		// Claude já está implementado em callClaude mas devolve []string;
		// pra one-shot fazemos chamada inline simples.
		return claudeOneShot(i.APIKey, i.GetFirstModel(), prompt)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter:
		return openAIOneShot(i, prompt)
	case models.ProviderGemini:
		return geminiOneShot(i.APIKey, i.GetFirstModel(), prompt)
	}
	return "", fmt.Errorf("provider %s não suporta geração", i.Provider)
}

func claudeOneShot(apiKey, model, prompt string) (string, error) {
	if model == "" {
		model = "claude-3-5-haiku-20241022"
	}
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 2048,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})
	req, _ := http.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("claude %d: %s", resp.StatusCode, string(b))
	}
	var out struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", err
	}
	if len(out.Content) == 0 {
		return "", fmt.Errorf("claude: resposta vazia")
	}
	return out.Content[0].Text, nil
}

func openAIOneShot(i *models.UserIntegration, prompt string) (string, error) {
	endpoint := i.BaseURL
	if endpoint == "" {
		endpoint = "https://api.openai.com/v1"
	}
	model := i.GetFirstModel()
	if model == "" {
		model = "gpt-4o-mini"
	}
	body, _ := json.Marshal(map[string]interface{}{
		"model":       model,
		"messages":    []map[string]string{{"role": "user", "content": prompt}},
		"temperature": 0.7,
		"response_format": map[string]string{"type": "json_object"},
	})
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(endpoint, "/")+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("authorization", "Bearer "+i.APIKey)
	req.Header.Set("content-type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("openai %d: %s", resp.StatusCode, string(b))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("openai: resposta vazia")
	}
	return out.Choices[0].Message.Content, nil
}

func geminiOneShot(apiKey, model, prompt string) (string, error) {
	if model == "" {
		model = "gemini-1.5-flash"
	}
	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": prompt}}},
		},
	})
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", model, apiKey)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("gemini %d: %s", resp.StatusCode, string(b))
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", err
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: resposta vazia")
	}
	return out.Candidates[0].Content.Parts[0].Text, nil
}

// parseQuickSetupResponse — extrai JSON do texto cru. Tolera markdown
// envolvendo o JSON (```json...```), texto antes/depois, etc. Em
// ÚLTIMO caso, devolve fallback fixo pra não trancar o user.
func parseQuickSetupResponse(raw string, quiz QuickSetupQuiz) fiber.Map {
	type result struct {
		AgentName               string `json:"agent_name"`
		Identity                string `json:"identity"`
		Objective               string `json:"objective"`
		CommunicationGuidelines string `json:"communication_guidelines"`
		ServiceInstructions     string `json:"service_instructions"`
		Restrictions            string `json:"restrictions"`
	}
	clean := strings.TrimSpace(raw)
	// Tira fences ```json ... ```
	if strings.HasPrefix(clean, "```") {
		clean = strings.TrimPrefix(clean, "```json")
		clean = strings.TrimPrefix(clean, "```")
		if i := strings.LastIndex(clean, "```"); i >= 0 {
			clean = clean[:i]
		}
	}
	// Pega o primeiro bloco {...} se ainda houver lixo em volta.
	if i := strings.Index(clean, "{"); i >= 0 {
		if j := strings.LastIndex(clean, "}"); j > i {
			clean = clean[i : j+1]
		}
	}
	var r result
	if err := json.Unmarshal([]byte(clean), &r); err != nil {
		log.Warn().Err(err).Str("raw_excerpt", firstNRunes(raw, 200)).
			Msg("agent quick-setup: parse JSON falhou, usando fallback")
		r.AgentName = strings.TrimSpace(quiz.AgentName)
		if r.AgentName == "" {
			r.AgentName = "Agente IA"
		}
		r.Identity = "Sou " + r.AgentName + ", agente de IA do " + quiz.BusinessName
		r.Objective = quiz.Objective
		r.CommunicationGuidelines = "Responda de forma " + quiz.Tone + ", direta e útil."
		r.ServiceInstructions = "Em casos fora do escopo, transferir para humano: " + quiz.Escalation
		r.Restrictions = strings.Join(quiz.Restrictions, "; ")
	}
	if strings.TrimSpace(r.AgentName) == "" {
		r.AgentName = strings.TrimSpace(quiz.AgentName)
	}
	return fiber.Map{
		"agent_name":               r.AgentName,
		"identity":                 r.Identity,
		"objective":                r.Objective,
		"communication_guidelines": r.CommunicationGuidelines,
		"service_instructions":     r.ServiceInstructions,
		"restrictions":             r.Restrictions,
	}
}

// firstNRunes — versão local. agent_runtime já tem uma exportada com
// trailing "…" mas aqui queremos só truncar bruto pra log.
func firstNRunes(s string, n int) string {
	if n <= 0 || len(s) == 0 {
		return ""
	}
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n])
}
