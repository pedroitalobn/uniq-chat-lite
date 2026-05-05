package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/uniq-chat/backend/internal/models"
)

// AgentMessage mirrors the OpenAI chat message format for multi-turn agent loops.
type AgentMessage struct {
	Role       string           `json:"role"`
	Content    interface{}      `json:"content"` // string or []AgentContentBlock
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []AgentToolCall  `json:"tool_calls,omitempty"`
	Name       string           `json:"name,omitempty"`
}

type AgentToolCall struct {
	ID       string                `json:"id"`
	Type     string                `json:"type"` // "function"
	Function AgentToolCallFunction `json:"function"`
}

type AgentToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// AgentContentBlock is used for Claude's multi-block content (tool_use, text, tool_result).
type AgentContentBlock struct {
	Type      string      `json:"type"`
	Text      string      `json:"text,omitempty"`
	ID        string      `json:"id,omitempty"`
	Name      string      `json:"name,omitempty"`
	Input     interface{} `json:"input,omitempty"`
	ToolUseID string      `json:"tool_use_id,omitempty"`
	Content   interface{} `json:"content,omitempty"`
	IsError   bool        `json:"is_error,omitempty"`
}

const maxAgentIterations = 10

// ToolsExecutor is a function that executes a single tool call and returns a result.
type ToolsExecutor func(toolCall models.ToolCall) models.ToolResult

// RunAgentLoop executes a ReAct-style agent loop: the LLM can call tools repeatedly
// until it produces a final text response. Compatible with OpenAI and Claude APIs.
func (s *LLMService) RunAgentLoop(
	ctx context.Context,
	integration *models.UserIntegration,
	systemPrompt string,
	userMessage string,
	executor ToolsExecutor,
) (string, error) {
	if integration == nil {
		return "", fmt.Errorf("nenhuma integração de IA configurada")
	}

	switch integration.Provider {
	case models.ProviderClaude:
		return s.runClaudeAgentLoop(ctx, integration, systemPrompt, userMessage, executor)
	default:
		return s.runOpenAIAgentLoop(ctx, integration, systemPrompt, userMessage, executor)
	}
}

// ─── OpenAI-compatible agent loop ────────────────────────────────────────────

func (s *LLMService) runOpenAIAgentLoop(
	ctx context.Context,
	i *models.UserIntegration,
	system, user string,
	executor ToolsExecutor,
) (string, error) {
	baseURL, chatPath := resolveOpenAICompatBase(i.Provider, i.BaseURL)
	model := i.GetFirstModel()
	if model == "" {
		model = defaultModelFor(i.Provider)
	}

	tools := buildOpenAITools()

	messages := []AgentMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}

	for iter := 0; iter < maxAgentIterations; iter++ {
		payload := map[string]interface{}{
			"model":       model,
			"temperature": 0.2,
			"messages":    messages,
			"tools":       tools,
			"tool_choice": "auto",
		}

		body, _ := json.Marshal(payload)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+chatPath, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+i.APIKey)
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result struct {
			Choices []struct {
				Message struct {
					Role      string         `json:"role"`
					Content   *string        `json:"content"`
					ToolCalls []AgentToolCall `json:"tool_calls"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Error struct{ Message string } `json:"error"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			return "", fmt.Errorf("erro ao parsear resposta: %w", err)
		}
		if result.Error.Message != "" {
			return "", fmt.Errorf("LLM error: %s", result.Error.Message)
		}
		if len(result.Choices) == 0 {
			return "", fmt.Errorf("resposta vazia do LLM")
		}

		choice := result.Choices[0]

		// No tool calls → final answer
		if len(choice.Message.ToolCalls) == 0 {
			if choice.Message.Content != nil {
				return *choice.Message.Content, nil
			}
			return "", nil
		}

		// Append assistant message with tool calls
		assistantMsg := AgentMessage{
			Role:      "assistant",
			ToolCalls: choice.Message.ToolCalls,
		}
		if choice.Message.Content != nil {
			assistantMsg.Content = *choice.Message.Content
		}
		messages = append(messages, assistantMsg)

		// Execute each tool call and collect results
		for _, tc := range choice.Message.ToolCalls {
			toolResult := executor(models.ToolCall{
				ID:        tc.ID,
				Name:      tc.Function.Name,
				Arguments: json.RawMessage(tc.Function.Arguments),
			})

			var resultStr string
			if toolResult.Error != "" {
				resultStr = `{"error":"` + toolResult.Error + `"}`
			} else {
				b, _ := json.Marshal(toolResult.Result)
				resultStr = string(b)
			}

			messages = append(messages, AgentMessage{
				Role:       "tool",
				Content:    resultStr,
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
			})
		}
	}

	return "", fmt.Errorf("limite de iterações do agente atingido")
}

// ─── Claude agent loop ────────────────────────────────────────────────────────

func (s *LLMService) runClaudeAgentLoop(
	ctx context.Context,
	i *models.UserIntegration,
	system, user string,
	executor ToolsExecutor,
) (string, error) {
	model := i.GetFirstModel()
	if model == "" {
		model = "claude-3-5-sonnet-latest"
	}

	tools := buildClaudeTools()

	type claudeMessage struct {
		Role    string      `json:"role"`
		Content interface{} `json:"content"` // string or []AgentContentBlock
	}

	messages := []claudeMessage{
		{Role: "user", Content: user},
	}

	httpClient := &http.Client{Timeout: 60 * time.Second}

	for iter := 0; iter < maxAgentIterations; iter++ {
		payload := map[string]interface{}{
			"model":      model,
			"max_tokens": 4096,
			"system":     system,
			"messages":   messages,
			"tools":      tools,
		}

		body, _ := json.Marshal(payload)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
		req.Header.Set("anthropic-version", "2023-06-01")
		req.Header.Set("Content-Type", "application/json")
		if i.HasOAuth() {
			req.Header.Set("Authorization", "Bearer "+i.OAuthAccessToken)
			req.Header.Set("anthropic-beta", "oauth-2025-04-20")
		} else {
			req.Header.Set("x-api-key", i.APIKey)
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			return "", err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result struct {
			StopReason string `json:"stop_reason"`
			Content    []struct {
				Type  string          `json:"type"`
				Text  string          `json:"text,omitempty"`
				ID    string          `json:"id,omitempty"`
				Name  string          `json:"name,omitempty"`
				Input json.RawMessage `json:"input,omitempty"`
			} `json:"content"`
			Error struct{ Message string } `json:"error"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			return "", fmt.Errorf("erro ao parsear resposta Claude: %w", err)
		}
		if result.Error.Message != "" {
			return "", fmt.Errorf("Claude error: %s", result.Error.Message)
		}

		// Collect text blocks and tool_use blocks
		var textOut string
		var toolUseBlocks []AgentContentBlock

		for _, block := range result.Content {
			switch block.Type {
			case "text":
				textOut += block.Text
			case "tool_use":
				var input interface{}
				json.Unmarshal(block.Input, &input)
				toolUseBlocks = append(toolUseBlocks, AgentContentBlock{
					Type:  "tool_use",
					ID:    block.ID,
					Name:  block.Name,
					Input: input,
				})
			}
		}

		// No tool calls → final answer
		if result.StopReason == "end_turn" || len(toolUseBlocks) == 0 {
			return textOut, nil
		}

		// Append assistant message
		assistantContent := make([]AgentContentBlock, 0)
		if textOut != "" {
			assistantContent = append(assistantContent, AgentContentBlock{Type: "text", Text: textOut})
		}
		assistantContent = append(assistantContent, toolUseBlocks...)
		messages = append(messages, claudeMessage{Role: "assistant", Content: assistantContent})

		// Execute tools and build user message with results
		toolResults := make([]AgentContentBlock, 0, len(toolUseBlocks))
		for _, tu := range toolUseBlocks {
			argsJSON, _ := json.Marshal(tu.Input)
			toolResult := executor(models.ToolCall{
				ID:        tu.ID,
				Name:      tu.Name,
				Arguments: json.RawMessage(argsJSON),
			})

			var content interface{}
			if toolResult.Error != "" {
				content = `{"error":"` + toolResult.Error + `"}`
			} else {
				b, _ := json.Marshal(toolResult.Result)
				content = string(b)
			}

			toolResults = append(toolResults, AgentContentBlock{
				Type:      "tool_result",
				ToolUseID: tu.ID,
				Content:   content,
				IsError:   toolResult.Error != "",
			})
		}
		messages = append(messages, claudeMessage{Role: "user", Content: toolResults})
	}

	return "", fmt.Errorf("limite de iterações do agente atingido")
}

// ─── Tool schema builders ─────────────────────────────────────────────────────

// buildOpenAITools converts AvailableTools to OpenAI function tool format.
func buildOpenAITools() []map[string]interface{} {
	tools := make([]map[string]interface{}, 0, len(models.AvailableTools))
	for _, t := range models.AvailableTools {
		props := map[string]interface{}{}
		required := []string{}

		for name, p := range t.Parameters {
			prop := map[string]interface{}{
				"type":        p.Type,
				"description": p.Description,
			}
			if len(p.Enum) > 0 {
				prop["enum"] = p.Enum
			}
			props[name] = prop
			if p.Required {
				required = append(required, name)
			}
		}

		tools = append(tools, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"parameters": map[string]interface{}{
					"type":       "object",
					"properties": props,
					"required":   required,
				},
			},
		})
	}
	return tools
}

// buildClaudeTools converts AvailableTools to Anthropic tool format.
func buildClaudeTools() []map[string]interface{} {
	tools := make([]map[string]interface{}, 0, len(models.AvailableTools))
	for _, t := range models.AvailableTools {
		props := map[string]interface{}{}
		required := []string{}

		for name, p := range t.Parameters {
			prop := map[string]interface{}{
				"type":        p.Type,
				"description": p.Description,
			}
			if len(p.Enum) > 0 {
				prop["enum"] = p.Enum
			}
			props[name] = prop
			if p.Required {
				required = append(required, name)
			}
		}

		tools = append(tools, map[string]interface{}{
			"name":        t.Name,
			"description": t.Description,
			"input_schema": map[string]interface{}{
				"type":       "object",
				"properties": props,
				"required":   required,
			},
		})
	}
	return tools
}
