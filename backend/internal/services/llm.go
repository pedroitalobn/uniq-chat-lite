package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/uniq-chat/backend/internal/models"
)

type ParsedTrigger struct {
	Type   string `json:"type"`
	Filter string `json:"filter"`
}

type ParsedAction struct {
	Icon      string `json:"icon"`
	Text      string `json:"text"`
	Condition string `json:"condition"`
	Color     string `json:"color"`
}

type ParsedRules struct {
	Trigger ParsedTrigger  `json:"trigger"`
	Actions []ParsedAction `json:"actions"`
}

type LLMService struct {
	// We keep a default client for when no integration is provided but env is set
	defaultClient *openai.Client
}

func NewLLMService() *LLMService {
	apiKey := os.Getenv("OPENAI_API_KEY")
	var client *openai.Client
	if apiKey != "" {
		client = openai.NewClient(apiKey)
	}
	return &LLMService{defaultClient: client}
}

func (s *LLMService) ParseJourneyPrompt(ctx context.Context, integration *models.UserIntegration, prompt string) (ParsedRules, error) {
	// Call the new CallChat with jsonMode = true
	content, err := s.CallChat(ctx, integration, prompt, true)
	if err != nil {
		return ParsedRules{}, err
	}

	var rules ParsedRules
	if err := json.Unmarshal([]byte(content), &rules); err != nil {
		return ParsedRules{}, fmt.Errorf("falha ao interpretar JSON da IA. Erro: %w", err)
	}

	return rules, nil
}

// CallChatWithSystem calls LLM with explicit system + user messages
func (s *LLMService) CallChatWithSystem(ctx context.Context, i *models.UserIntegration, system, user string, jsonMode bool) (string, error) {
	if system == "" {
		system = "Você é um assistente útil e conciso. Responda de forma direta e amigável."
	}
	if i != nil && i.ID != [16]byte{} {
		return s.callProvider(ctx, i, system, user, jsonMode)
	}
	if s.defaultClient == nil {
		return "", fmt.Errorf("nenhuma integração de IA configurada")
	}
	req := openai.ChatCompletionRequest{
		Model: openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: system},
			{Role: openai.ChatMessageRoleUser, Content: user},
		},
		Temperature: 0.7,
	}
	if jsonMode {
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{Type: openai.ChatCompletionResponseFormatTypeJSONObject}
	}
	resp, err := s.defaultClient.CreateChatCompletion(ctx, req)
	if err != nil {
		return "", err
	}
	return resp.Choices[0].Message.Content, nil
}

func (s *LLMService) CallChat(ctx context.Context, i *models.UserIntegration, prompt string, jsonMode bool) (string, error) {
	systemPrompt := "Você é um assistente útil e conciso. Responda de forma direta e amigável."
	if jsonMode {
		systemPrompt = `
Você é um orquestrador de automação que converte intenções de usuários escritas em linguagem natural em um pipeline estruturado (Gatilho -> Múltiplas Ações).
Sua resposta final DEVE ser SOMENTE um JSON válido com o seguinte schema exato:

{
  "trigger": {
    "type": "string_identifier_for_trigger",
    "filter": "Descrição curta e clara do gatilho para a UI. Ex: Grupo VIP, Nova Mensagem"
  },
  "actions": [
    {
      "icon": "LucideReactIconName", 
      "text": "Descrição curta da ação. Ex: Adicionar Tag VIP",
      "condition": "Condição se houver, ex: '> 18:00'. Deixe vazio se não houver.",
      "color": "Hexadecimal. '#10b981' para finalização/sucesso, '#3b82f6' para CRM/Usuários, '#f59e0b' para Tags/Alertas, '#8b5cf6' para IA/Bots."
    }
  ]
}

Ícones Lucide permitidos: Tag, Users, MessageSquare, Bot, CheckCircle2, Send, Clock, Workflow, Zap.
Responda APENAS com o JSON, sem markdown ou explicações.
`
	}

	if i != nil && i.ID != [16]byte{} {
		return s.callProvider(ctx, i, systemPrompt, prompt, jsonMode)
	}

	// Fallback to default OpenAI
	if s.defaultClient == nil {
		return "", fmt.Errorf("nenhuma integração de IA configurada e OPENAI_API_KEY ausente")
	}

	req := openai.ChatCompletionRequest{
		Model: openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: prompt},
		},
		Temperature: 0.1,
	}
	if jsonMode {
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{Type: openai.ChatCompletionResponseFormatTypeJSONObject}
	}

	resp, err := s.defaultClient.CreateChatCompletion(ctx, req)
	if err != nil {
		return "", err
	}
	return resp.Choices[0].Message.Content, nil
}

func (s *LLMService) callProvider(ctx context.Context, i *models.UserIntegration, system, user string, jsonMode bool) (string, error) {
	switch i.Provider {
	case models.ProviderClaude:
		return s.callClaude(i, system, user, jsonMode)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter,
		models.ProviderKilo, models.ProviderZai, models.ProviderKimi,
		models.ProviderQwen, models.ProviderMiniMax, models.ProviderManus:
		return s.callOpenAICompat(i, system, user, jsonMode)
	case models.ProviderGemini:
		return s.callGemini(i, system+"\n\nUsuário: "+user, jsonMode)
	default:
		return "", fmt.Errorf("provider %s não suportado", i.Provider)
	}
}

// ─── Provider Specific Calls (logic moved from IntegrationHandler) ───────────

func (s *LLMService) callClaude(i *models.UserIntegration, system, user string, jsonMode bool) (string, error) {
	model := i.Model
	if model == "" {
		model = "claude-3-5-sonnet-latest"
	}
	bodyData := map[string]interface{}{
		"model":      model,
		"max_tokens": 2048,
		"system":     system,
		"messages":   []map[string]string{{"role": "user", "content": user}},
	}
	// Note: Claude doesn't have a direct "jsonMode" parameter like OpenAI,
	// but specifying it in system prompt is usually enough.

	body, _ := json.Marshal(bodyData)
	req, _ := http.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("x-api-key", i.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(raw, &result)
	if len(result.Content) > 0 {
		return result.Content[0].Text, nil
	}
	if result.Error.Message != "" {
		return "", fmt.Errorf("claude error: %s", result.Error.Message)
	}
	return "", fmt.Errorf("resposta vazia da Claude API")
}

func (s *LLMService) callOpenAICompat(i *models.UserIntegration, system, user string, jsonMode bool) (string, error) {
	baseURL := i.BaseURL
	if baseURL == "" {
		switch i.Provider {
		case models.ProviderDeepSeek:
			baseURL = "https://api.deepseek.com"
		case models.ProviderOpenRouter:
			baseURL = "https://openrouter.ai/api"
		case models.ProviderKilo:
			baseURL = "https://api.kilo.ai"
		case models.ProviderZai:
			baseURL = "https://api.z.ai"
		case models.ProviderKimi:
			baseURL = "https://api.moonshot.cn/v1"
		case models.ProviderQwen:
			baseURL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
		case models.ProviderMiniMax:
			baseURL = "https://api.minimaxi.com/v1"
		case models.ProviderManus:
			baseURL = "https://api.manus.chat/v1"
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
		case models.ProviderKilo:
			model = "kilo/kilo-auto/balanced"
		case models.ProviderZai:
			model = "zai/balanco-7b"
		case models.ProviderKimi:
			model = "moonshot-v1-8k"
		case models.ProviderQwen:
			model = "qwen-turbo"
		case models.ProviderMiniMax:
			model = "abab6.5-chat"
		case models.ProviderManus:
			model = "manus-base"
		default:
			model = "gpt-4o-mini"
		}
	}

	payload := map[string]interface{}{
		"model":       model,
		"temperature": 0.1,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
	}
	if jsonMode {
		payload["response_format"] = map[string]string{"type": "json_object"}
	}

	body, _ := json.Marshal(payload)
	url := baseURL + "/v1/chat/completions"
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+i.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(raw, &result)
	if len(result.Choices) > 0 {
		return result.Choices[0].Message.Content, nil
	}
	if result.Error.Message != "" {
		return "", fmt.Errorf("%s error: %s", i.Provider, result.Error.Message)
	}
	return "", fmt.Errorf("resposta vazia da API %s", i.Provider)
}

func (s *LLMService) callGemini(i *models.UserIntegration, prompt string, jsonMode bool) (string, error) {
	model := i.Model
	if model == "" {
		model = "gemini-1.5-flash"
	}
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", model, i.APIKey)

	config := map[string]interface{}{}
	if jsonMode {
		config["response_mime_type"] = "application/json"
	}

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]interface{}{{"text": prompt}}},
		},
		"generationConfig": config,
	})
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
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
	json.Unmarshal(raw, &result)
	if len(result.Candidates) > 0 && len(result.Candidates[0].Content.Parts) > 0 {
		return result.Candidates[0].Content.Parts[0].Text, nil
	}
	return "", fmt.Errorf("resposta vazia do Gemini")
}
