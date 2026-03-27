package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type IntegrationHandler struct {
	db *gorm.DB
}

func NewIntegrationHandler(db *gorm.DB) *IntegrationHandler {
	return &IntegrationHandler{db: db}
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
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIKey   string `json:"api_key"`
		BaseURL  string `json:"base_url"`
		Model    string `json:"model"`
		Config   string `json:"config"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Provider == "" || req.APIKey == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider e api_key são obrigatórios"})
	}

	integration := models.UserIntegration{
		UserID:   user.ID,
		Provider: models.IntegrationProvider(req.Provider),
		Name:     req.Name,
		APIKey:   req.APIKey,
		BaseURL:  req.BaseURL,
		Model:    req.Model,
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
		Name     *string `json:"name"`
		APIKey   *string `json:"api_key"`
		BaseURL  *string `json:"base_url"`
		Model    *string `json:"model"`
		Config   *string `json:"config"`
		IsActive *bool   `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != nil    { updates["name"] = *req.Name }
	if req.APIKey != nil  { updates["api_key"] = *req.APIKey }
	if req.BaseURL != nil { updates["base_url"] = *req.BaseURL }
	if req.Model != nil   { updates["model"] = *req.Model }
	if req.Config != nil  { updates["config"] = *req.Config }
	if req.IsActive != nil { updates["is_active"] = *req.IsActive }

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
	if err := h.db.Preload("Integration").Where("instance_id = ?", inst.ID).First(&agent).Error; err != nil {
		return c.JSON(models.InstanceAgent{InstanceID: inst.ID})
	}
	if agent.Integration != nil {
		agent.Integration.MaskedKey = models.MaskAPIKey(agent.Integration.APIKey)
		agent.Integration.APIKey = ""
	}
	return c.JSON(agent)
}

// PUT /instances/:id/agent
func (h *IntegrationHandler) UpdateAgent(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var req struct {
		IntegrationID *string `json:"integration_id"`
		SystemPrompt  *string `json:"system_prompt"`
		IsActive      *bool   `json:"is_active"`
		WebhookURL    *string `json:"webhook_url"`
		WebhookSecret *string `json:"webhook_secret"`
		MCPServerURL  *string `json:"mcp_server_url"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	var agent models.InstanceAgent
	if err := h.db.Where("instance_id = ?", inst.ID).First(&agent).Error; err != nil {
		agent = models.InstanceAgent{InstanceID: inst.ID}
	}

	if req.IntegrationID != nil {
		if *req.IntegrationID == "" {
			agent.IntegrationID = nil
		} else {
			pid, _ := uuid.Parse(*req.IntegrationID)
			agent.IntegrationID = &pid
		}
	}
	if req.SystemPrompt  != nil { agent.SystemPrompt  = *req.SystemPrompt }
	if req.IsActive      != nil { agent.IsActive      = *req.IsActive }
	if req.WebhookURL    != nil { agent.WebhookURL    = *req.WebhookURL }
	if req.WebhookSecret != nil { agent.WebhookSecret = *req.WebhookSecret }
	if req.MCPServerURL  != nil { agent.MCPServerURL  = *req.MCPServerURL }

	h.db.Save(&agent)
	return c.JSON(agent)
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

func testIntegration(i *models.UserIntegration) (bool, string) {
	switch i.Provider {
	case models.ProviderClaude:
		return testClaude(i.APIKey)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter:
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

func testClaude(apiKey string) (bool, string) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "falha de conexão: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return true, "Conexão com Claude API bem-sucedida"
	}
	return false, fmt.Sprintf("Claude API retornou status %d", resp.StatusCode)
}

func testOpenAICompat(i *models.UserIntegration) (bool, string) {
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
	req, _ := http.NewRequest(http.MethodGet, baseURL+"/v1/models", nil)
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
		return callClaude(i.APIKey, i.Model, prompt)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter:
		return callOpenAICompat(i, prompt)
	case models.ProviderGemini:
		return callGemini(i.APIKey, i.Model, prompt)
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
	model := i.Model
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
		if ch == '[' { start = i; break }
	}
	end := -1
	for i := len(text) - 1; i >= 0; i-- {
		if text[i] == ']' { end = i; break }
	}
	if start >= 0 && end > start {
		if err := json.Unmarshal([]byte(text[start:end+1]), &variations); err == nil {
			return variations, nil
		}
	}
	// Fallback: return as single variation
	return []string{text}, nil
}
