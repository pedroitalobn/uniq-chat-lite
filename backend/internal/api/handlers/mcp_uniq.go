package handlers

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// UniqMCPHandler — expõe as tools do agente IA (models.AvailableTools)
// via Model Context Protocol pra clientes externos (Claude Desktop,
// Cursor, n8n) consumirem dados da Uniq como context provider.
//
// Diferente de handlers.MCPHandler (que é o MCP do WhatsApp instance);
// este é o MCP da PLATAFORMA — devolve list_products, search_contacts,
// list_journeys, etc. tudo orientado por workspace do user autenticado.
//
// Endpoint: POST /v1/mcp (JSON-RPC 2.0). Auth: Bearer token padrão.
type UniqMCPHandler struct {
	db    *gorm.DB
	tools *ToolsHandler
}

func NewUniqMCPHandler(db *gorm.DB, tools *ToolsHandler) *UniqMCPHandler {
	return &UniqMCPHandler{db: db, tools: tools}
}

func (h *UniqMCPHandler) HandleRPC(c *fiber.Ctx) error {
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(uniqRPCError(req.ID, -32700, "Parse error"))
	}
	if req.JSONRPC != "2.0" {
		return c.JSON(uniqRPCError(req.ID, -32600, "Invalid Request"))
	}

	switch req.Method {
	case "initialize":
		return c.JSON(uniqRPCResult(req.ID, fiber.Map{
			"protocolVersion": "2024-11-05",
			"serverInfo": fiber.Map{
				"name":    "uniq-chat",
				"version": "1.0.0",
			},
			"capabilities": fiber.Map{
				"tools": fiber.Map{},
			},
		}))

	case "tools/list":
		out := make([]fiber.Map, 0, len(models.AvailableTools))
		for _, t := range models.AvailableTools {
			props := fiber.Map{}
			required := []string{}
			for name, p := range t.Parameters {
				props[name] = fiber.Map{
					"type":        p.Type,
					"description": p.Description,
				}
				if p.Required {
					required = append(required, name)
				}
			}
			out = append(out, fiber.Map{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": fiber.Map{
					"type":       "object",
					"properties": props,
					"required":   required,
				},
			})
		}
		return c.JSON(uniqRPCResult(req.ID, fiber.Map{"tools": out}))

	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return c.JSON(uniqRPCError(req.ID, -32602, "Invalid params"))
		}
		userID := middleware.GetCurrentUserID(c)
		if userID == uuid.Nil {
			return c.JSON(uniqRPCError(req.ID, -32001, "Auth required"))
		}
		tc := models.ToolCall{
			ID:        "mcp-call",
			Name:      p.Name,
			Arguments: p.Arguments,
		}
		result := h.tools.ExecuteToolCall(userID, tc)
		return c.JSON(uniqRPCResult(req.ID, fiber.Map{
			"content": []fiber.Map{
				{"type": "text", "text": jsonStringifyV2(result.Result)},
			},
			"isError": result.Error != "",
		}))

	default:
		return c.JSON(uniqRPCError(req.ID, -32601, "Method not found: "+req.Method))
	}
}

func uniqRPCResult(id any, result any) fiber.Map {
	return fiber.Map{"jsonrpc": "2.0", "id": id, "result": result}
}

func uniqRPCError(id any, code int, msg string) fiber.Map {
	return fiber.Map{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   fiber.Map{"code": code, "message": msg},
	}
}

func jsonStringifyV2(v any) string {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return ""
	}
	return string(b)
}
