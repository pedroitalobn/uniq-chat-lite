package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
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
	// db é opcional — quando setado, ativa fallback automático pra
	// PlatformAI ativa configurada via /admin/platform-ai (ou
	// /admin/providers → AI). Sem isso o serviço só tinha env
	// OPENAI_API_KEY como fallback, e quem não tinha env perdia toda
	// IA ("nenhuma integração configurada e OPENAI_API_KEY ausente").
	db *gorm.DB
}

type LLMUsage struct {
	InputTokens  int64
	OutputTokens int64
	TotalTokens  int64
	Estimated    bool
}

type LLMResult struct {
	Content  string
	Provider string
	Model    string
	Usage    LLMUsage
}

func NewLLMService() *LLMService {
	apiKey := os.Getenv("OPENAI_API_KEY")
	var client *openai.Client
	if apiKey != "" {
		client = openai.NewClient(apiKey)
	}
	return &LLMService{defaultClient: client}
}

// SetDB injeta o ponteiro do GORM pra LLMService poder consultar
// PlatformAI ativa quando o caller não passa um UserIntegration.
// Idempotente — chame uma vez no bootstrap.
func (s *LLMService) SetDB(db *gorm.DB) { s.db = db }

// resolveIntegration recebe a integration que veio do caller. Se for nil
// ou zero-value, tenta resolver pela PlatformAI ativa do banco. Retorna
// nil se nenhum dos dois estiver disponível — caller cai no defaultClient
// (env OPENAI_API_KEY) ou erra.
func (s *LLMService) resolveIntegration(i *models.UserIntegration) *models.UserIntegration {
	if i != nil && i.ID != [16]byte{} {
		return i
	}
	if s.db == nil {
		return nil
	}
	var pai models.PlatformAI
	if err := s.db.
		Where("is_active = true AND api_key <> ''").
		Order("created_at ASC").
		First(&pai).Error; err != nil {
		return nil
	}
	return PlatformAIToIntegration(&pai)
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
	res, err := s.CallChatWithSystemResult(ctx, i, system, user, jsonMode)
	if err != nil {
		return "", err
	}
	return res.Content, nil
}

func (s *LLMService) CallChatWithSystemResult(ctx context.Context, i *models.UserIntegration, system, user string, jsonMode bool) (LLMResult, error) {
	if system == "" {
		system = "Você é um assistente útil e conciso. Responda de forma direta e amigável."
	}
	// Resolve integração: caller > PlatformAI ativa > defaultClient (env).
	if resolved := s.resolveIntegration(i); resolved != nil {
		return s.callProvider(ctx, resolved, system, user, jsonMode)
	}
	if s.defaultClient == nil {
		return LLMResult{}, fmt.Errorf("nenhuma integração de IA configurada — admin precisa configurar em /admin/providers → Uniq AI")
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
		return LLMResult{}, err
	}
	return LLMResult{
		Content:  resp.Choices[0].Message.Content,
		Provider: string(models.ProviderOpenAI),
		Model:    req.Model,
		Usage: LLMUsage{
			InputTokens:  int64(resp.Usage.PromptTokens),
			OutputTokens: int64(resp.Usage.CompletionTokens),
			TotalTokens:  int64(resp.Usage.TotalTokens),
		},
	}, nil
}

func (s *LLMService) CallChat(ctx context.Context, i *models.UserIntegration, prompt string, jsonMode bool) (string, error) {
	res, err := s.CallChatResult(ctx, i, prompt, jsonMode)
	if err != nil {
		return "", err
	}
	return res.Content, nil
}

func (s *LLMService) CallChatResult(ctx context.Context, i *models.UserIntegration, prompt string, jsonMode bool) (LLMResult, error) {
	systemPrompt := "Você é um assistente útil e conciso. Responda de forma direta e amigável."
	if jsonMode {
		systemPrompt = `Você é um orquestrador de automação que converte intenções de usuários em linguagem natural para um pipeline estruturado (Gatilho → Ações).

Sua resposta DEVE ser SOMENTE um JSON válido com este schema:

{
  "trigger": {
    "type": "tipo_do_gatilho",
    "filter": "Descrição curta do gatilho para UI",
    "keywords": ["palavra1", "palavra2"],
    "target": "grupo ou contato específico se houver"
  },
  "actions": [
    {
      "icon": "LucideIcon",
      "text": "Descrição da ação",
      "condition": "Condição se houver",
      "color": "#hex"
    }
  ]
}

=== TIPOS DE GATILHOS SUPORTADOS ===

1. GROUP_MESSAGE - Qualquer mensagem em grupo específico
   - Ex: "quando alguém enviar mensagem no grupo X"
   - target: nome ou JID do grupo

2. GROUP_KEYWORD - Palavra-chave em grupo
   - Ex: "quando alguém mandar 'oi' no grupo X"
   - keywords: ["oi"]

3. GROUP_MENTION - Menção a contato em grupo
   - Ex: "quando me mencionarem no grupo X"
   - target: nome do contato mencionado

4. PRIVATE_MESSAGE - Qualquer mensagem privada
   - Ex: "quando alguém me mandar mensagem"

5. PRIVATE_KEYWORD - Palavra-chave em mensagem privada
   - Ex: "quando alguém mandar 'suporte' no privado"
   - keywords: ["suporte"]

6. CONTACT_CALL - Chamada recebida
   - Ex: "quando alguém me ligar"

7. CONTACT_MEDIA_VIDEO - Envio de vídeo
   - Ex: "quando alguém enviar um vídeo"

8. CONTACT_MEDIA_AUDIO - Envio de áudio
   - Ex: "quando alguém enviar um áudio"

9. CONTACT_MEDIA_DOCUMENT - Envio de documento
   - Ex: "quando alguém enviar um documento"

10. CONTACT_MEDIA_IMAGE - Envio de imagem
    - Ex: "quando alguém enviar uma foto"

11. ANY_MESSAGE - Qualquer mensagem (grupo ou privado)
    - Ex: "toda vez que receber uma mensagem"

12. NO_RESPONSE - Sem resposta após X horas
    - Ex: "se não responder em 2 horas"
    - condition: "hours:2"

13. FIRST_MESSAGE - Primeira mensagem do contato
    - Ex: "quando um novo contato me mandar mensagem"

=== EXEMPLOS DE AÇÕES ===

- send_message: Enviar mensagem de texto
- send_private: Enviar mensagem privada (se gatilho for grupo)
- add_tag: Adicionar tag ao contato
- remove_tag: Remover tag
- assign_agent: Atribuir a agente
- create_ticket: Criar ticket de suporte
- webhook: Chamar webhook

=== ÍCONES LUCIDE ===
Tag, Users, MessageSquare, Bot, CheckCircle2, Send, Clock, Workflow, Zap, Phone, Video, FileText, Image, Mic

=== CORES ===
- #10b981 (verde): sucesso/finalização
- #3b82f6 (azul): CRM/usuários
- #f59e0b (amarelo): tags/alertas
- #8b5cf6 (roxo): IA/bots
- #ef4444 (vermelho): erros/urgente

Responda APENAS com JSON, sem markdown.`
	}

	// Resolve integração: caller > PlatformAI ativa > defaultClient (env).
	if resolved := s.resolveIntegration(i); resolved != nil {
		return s.callProvider(ctx, resolved, systemPrompt, prompt, jsonMode)
	}

	// Fallback to default OpenAI
	if s.defaultClient == nil {
		return LLMResult{}, fmt.Errorf("nenhuma integração de IA configurada — admin precisa configurar em /admin/providers → Uniq AI (ou setar OPENAI_API_KEY)")
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
		return LLMResult{}, err
	}
	return LLMResult{
		Content:  resp.Choices[0].Message.Content,
		Provider: string(models.ProviderOpenAI),
		Model:    req.Model,
		Usage: LLMUsage{
			InputTokens:  int64(resp.Usage.PromptTokens),
			OutputTokens: int64(resp.Usage.CompletionTokens),
			TotalTokens:  int64(resp.Usage.TotalTokens),
		},
	}, nil
}

func (s *LLMService) callProvider(ctx context.Context, i *models.UserIntegration, system, user string, jsonMode bool) (LLMResult, error) {
	switch i.Provider {
	case models.ProviderClaude:
		return s.callClaude(ctx, i, system, user, jsonMode)
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter,
		models.ProviderKilo, models.ProviderZai, models.ProviderKimi,
		models.ProviderQwen, models.ProviderMiniMax, models.ProviderManus,
		models.ProviderMistral:
		return s.callOpenAICompat(ctx, i, system, user, jsonMode)
	case models.ProviderGemini:
		return s.callGemini(ctx, i, system+"\n\nUsuário: "+user, jsonMode)
	default:
		return LLMResult{}, fmt.Errorf("provider %s não suportado", i.Provider)
	}
}

// PlatformAIToIntegration converte o singleton PlatformAI para um
// *UserIntegration transitório (não persiste no DB), permitindo reusar
// todos os callProvider existentes sem duplicar lógica.
func PlatformAIToIntegration(pai *models.PlatformAI) *models.UserIntegration {
	return &models.UserIntegration{
		Provider: pai.Provider,
		APIKey:   pai.APIKey,
		BaseURL:  pai.BaseURL,
		Models:   pai.Models,
	}
}

// ─── Provider Specific Calls (logic moved from IntegrationHandler) ───────────

func (s *LLMService) callClaude(ctx context.Context, i *models.UserIntegration, system, user string, jsonMode bool) (LLMResult, error) {
	model := i.GetFirstModel()
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
	_ = jsonMode

	body, _ := json.Marshal(bodyData)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	// Autenticação: OAuth (Bearer) quando AuthType=oauth, senão x-api-key.
	// Claude Code e outras ferramentas first-party também usam o header
	// "anthropic-beta: oauth-2025-04-20" quando acessam via OAuth.
	if i.HasOAuth() {
		req.Header.Set("Authorization", "Bearer "+i.OAuthAccessToken)
		req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	} else {
		req.Header.Set("x-api-key", i.APIKey)
	}

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return LLMResult{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Model string `json:"model"`
		Usage struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
		} `json:"usage"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(raw, &result)
	if len(result.Content) > 0 {
		if result.Model == "" {
			result.Model = model
		}
		return LLMResult{
			Content:  result.Content[0].Text,
			Provider: string(i.Provider),
			Model:    result.Model,
			Usage: LLMUsage{
				InputTokens:  result.Usage.InputTokens,
				OutputTokens: result.Usage.OutputTokens,
				TotalTokens:  result.Usage.InputTokens + result.Usage.OutputTokens,
			},
		}, nil
	}
	if result.Error.Message != "" {
		return LLMResult{}, fmt.Errorf("claude error: %s", result.Error.Message)
	}
	return LLMResult{}, fmt.Errorf("resposta vazia da Claude API (status %d)", resp.StatusCode)
}

func (s *LLMService) callOpenAICompat(ctx context.Context, i *models.UserIntegration, system, user string, jsonMode bool) (LLMResult, error) {
	baseURL, chatPath := resolveOpenAICompatBase(i.Provider, i.BaseURL)
	model := i.GetFirstModel()
	if model == "" {
		model = defaultModelFor(i.Provider)
	}

	payload := map[string]interface{}{
		"model":       model,
		"temperature": 0.1,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
	}
	if jsonMode && providerSupportsJSONMode(i.Provider) {
		payload["response_format"] = map[string]string{"type": "json_object"}
	}

	body, _ := json.Marshal(payload)
	url := baseURL + chatPath
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+i.APIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return LLMResult{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var result struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
			TotalTokens      int64 `json:"total_tokens"`
		} `json:"usage"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(raw, &result)
	if len(result.Choices) > 0 {
		if result.Model == "" {
			result.Model = model
		}
		total := result.Usage.TotalTokens
		if total == 0 {
			total = result.Usage.PromptTokens + result.Usage.CompletionTokens
		}
		return LLMResult{
			Content:  result.Choices[0].Message.Content,
			Provider: string(i.Provider),
			Model:    result.Model,
			Usage: LLMUsage{
				InputTokens:  result.Usage.PromptTokens,
				OutputTokens: result.Usage.CompletionTokens,
				TotalTokens:  total,
			},
		}, nil
	}
	if result.Error.Message != "" {
		return LLMResult{}, fmt.Errorf("%s error: %s", i.Provider, result.Error.Message)
	}
	return LLMResult{}, fmt.Errorf("resposta vazia da API %s", i.Provider)
}

// resolveOpenAICompatBase retorna (baseURL, chatCompletionsPath) para cada provider.
// Alguns providers (Kimi, Qwen, MiniMax) já embutem "/v1" na própria base — por
// isso o chatPath varia.
func resolveOpenAICompatBase(p models.IntegrationProvider, override string) (string, string) {
	if override != "" {
		// Se o usuário passou base custom, assume que já é a raiz antes de /v1
		return strings.TrimRight(override, "/"), "/v1/chat/completions"
	}
	switch p {
	case models.ProviderDeepSeek:
		return "https://api.deepseek.com", "/v1/chat/completions"
	case models.ProviderOpenRouter:
		return "https://openrouter.ai/api", "/v1/chat/completions"
	case models.ProviderKilo:
		return "https://api.kilo.ai", "/v1/chat/completions"
	case models.ProviderZai:
		// Z.ai (ChatGLM) API compat
		return "https://api.z.ai/api/paas", "/v4/chat/completions"
	case models.ProviderKimi:
		// Moonshot/Kimi — api global usa .ai, api china usa .cn
		return "https://api.moonshot.ai", "/v1/chat/completions"
	case models.ProviderQwen:
		// DashScope compatible-mode endpoint (OpenAI compat)
		return "https://dashscope-intl.aliyuncs.com/compatible-mode", "/v1/chat/completions"
	case models.ProviderMiniMax:
		return "https://api.minimaxi.chat", "/v1/chat/completions"
	case models.ProviderManus:
		return "https://api.manus.chat", "/v1/chat/completions"
	case models.ProviderMistral:
		return "https://api.mistral.ai", "/v1/chat/completions"
	default:
		return "https://api.openai.com", "/v1/chat/completions"
	}
}

func defaultModelFor(p models.IntegrationProvider) string {
	switch p {
	case models.ProviderDeepSeek:
		return "deepseek-chat"
	case models.ProviderOpenRouter:
		return "openai/gpt-4o-mini"
	case models.ProviderKilo:
		return "kilo/kilo-auto/balanced"
	case models.ProviderZai:
		return "glm-4-flash"
	case models.ProviderKimi:
		return "moonshot-v1-8k"
	case models.ProviderQwen:
		return "qwen-turbo"
	case models.ProviderMiniMax:
		return "MiniMax-Text-01"
	case models.ProviderManus:
		return "manus-base"
	case models.ProviderMistral:
		return "mistral-small-latest"
	default:
		return "gpt-4o-mini"
	}
}

// providerSupportsJSONMode reporta se o provider aceita response_format=json_object.
// Nem todos os compatíveis suportam — enviar para quem não suporta pode causar 400.
func providerSupportsJSONMode(p models.IntegrationProvider) bool {
	switch p {
	case models.ProviderOpenAI, models.ProviderDeepSeek, models.ProviderOpenRouter,
		models.ProviderMistral, models.ProviderKimi, models.ProviderZai:
		return true
	default:
		return false
	}
}

func (s *LLMService) callGemini(ctx context.Context, i *models.UserIntegration, prompt string, jsonMode bool) (LLMResult, error) {
	model := i.GetFirstModel()
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
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return LLMResult{}, err
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
		UsageMetadata struct {
			PromptTokenCount     int64 `json:"promptTokenCount"`
			CandidatesTokenCount int64 `json:"candidatesTokenCount"`
			TotalTokenCount      int64 `json:"totalTokenCount"`
			ThoughtsTokenCount   int64 `json:"thoughtsTokenCount"`
		} `json:"usageMetadata"`
	}
	json.Unmarshal(raw, &result)
	if len(result.Candidates) > 0 && len(result.Candidates[0].Content.Parts) > 0 {
		outputTokens := result.UsageMetadata.CandidatesTokenCount + result.UsageMetadata.ThoughtsTokenCount
		total := result.UsageMetadata.TotalTokenCount
		if total == 0 {
			total = result.UsageMetadata.PromptTokenCount + outputTokens
		}
		return LLMResult{
			Content:  result.Candidates[0].Content.Parts[0].Text,
			Provider: string(i.Provider),
			Model:    model,
			Usage: LLMUsage{
				InputTokens:  result.UsageMetadata.PromptTokenCount,
				OutputTokens: outputTokens,
				TotalTokens:  total,
			},
		}, nil
	}
	return LLMResult{}, fmt.Errorf("resposta vazia do Gemini")
}
