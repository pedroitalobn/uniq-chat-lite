package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type mcpSession struct {
	ch   chan []byte
	done chan struct{}
}

type MCPHandler struct {
	db       *gorm.DB
	manager  *whatsapp.Manager
	mu       sync.RWMutex
	sessions map[string]*mcpSession
}

func NewMCPHandler(db *gorm.DB, manager *whatsapp.Manager) *MCPHandler {
	return &MCPHandler{
		db:       db,
		manager:  manager,
		sessions: make(map[string]*mcpSession),
	}
}

// SSE godoc
// GET /instances/:id/mcp/sse
func (h *MCPHandler) SSE(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if !instance.MCPEnabled {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "MCP não habilitado para esta instância"})
	}

	sessionID := uuid.New().String()
	sess := &mcpSession{
		ch:   make(chan []byte, 100),
		done: make(chan struct{}),
	}

	h.mu.Lock()
	h.sessions[sessionID] = sess
	h.mu.Unlock()

	log.Debug().Str("instance", instance.ID.String()).Str("session", sessionID).Msg("MCP session opened")

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	c.Context().SetBodyStreamWriter(fasthttp.StreamWriter(func(w *bufio.Writer) {
		defer func() {
			close(sess.done)
			h.mu.Lock()
			delete(h.sessions, sessionID)
			h.mu.Unlock()
			log.Debug().Str("session", sessionID).Msg("MCP session closed")
		}()

		// Send the POST endpoint path to the client
		postPath := fmt.Sprintf("/instances/%s/mcp/message?session=%s", instance.ID, sessionID)
		if _, err := fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", postPath); err != nil {
			return
		}
		if err := w.Flush(); err != nil {
			return
		}

		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case msg := <-sess.ch:
				if _, err := fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(msg)); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			}
		}
	}))

	return nil
}

// Message godoc
// POST /instances/:id/mcp/message?session=<id>
func (h *MCPHandler) Message(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if !instance.MCPEnabled {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "MCP não habilitado"})
	}

	sessionID := c.Query("session")
	h.mu.RLock()
	sess, ok := h.sessions[sessionID]
	h.mu.RUnlock()
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "sessão MCP não encontrada"})
	}

	var req map[string]interface{}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}

	go func() {
		resp := h.handleRPC(instance, req)
		if resp == nil {
			return
		}
		b, _ := json.Marshal(resp)
		select {
		case sess.ch <- b:
		case <-sess.done:
		}
	}()

	return c.SendStatus(fiber.StatusAccepted)
}

// Tools godoc
// GET /instances/:id/mcp/tools  (convenience endpoint for UIs)
func (h *MCPHandler) Tools(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"tools": mcpToolsList()})
}

func (h *MCPHandler) handleRPC(instance *models.Instance, req map[string]interface{}) map[string]interface{} {
	method, _ := req["method"].(string)
	id := req["id"]

	switch method {
	case "initialize":
		return rpcResult(id, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
			"serverInfo":      map[string]interface{}{"name": "uniq-chat-whatsapp", "version": "1.0"},
		})
	case "notifications/initialized", "notifications/cancelled":
		return nil
	case "ping":
		return rpcResult(id, map[string]interface{}{})
	case "tools/list":
		return rpcResult(id, map[string]interface{}{"tools": mcpToolsList()})
	case "tools/call":
		params, _ := req["params"].(map[string]interface{})
		return h.callTool(instance, id, params)
	default:
		return rpcError(id, -32601, "Method not found: "+method)
	}
}

func (h *MCPHandler) callTool(instance *models.Instance, id interface{}, params map[string]interface{}) map[string]interface{} {
	if params == nil {
		return rpcError(id, -32602, "params missing")
	}
	toolName, _ := params["name"].(string)
	args, _ := params["arguments"].(map[string]interface{})
	if args == nil {
		args = map[string]interface{}{}
	}

	client := h.manager.GetInstance(instance.ID.String())

	switch toolName {
	case "send_message":
		if client == nil || !client.IsConnected() {
			return rpcResult(id, toolError("Instância WhatsApp não conectada"))
		}
		to, _ := args["to"].(string)
		message, _ := args["message"].(string)
		if to == "" || message == "" {
			return rpcResult(id, toolError("Parâmetros 'to' e 'message' são obrigatórios"))
		}
		msgID, err := client.SendTextMessage(to, message)
		if err != nil {
			return rpcResult(id, toolError(err.Error()))
		}
		return rpcResult(id, toolText(fmt.Sprintf("Mensagem enviada com sucesso. ID: %s", msgID)))

	case "list_chats":
		limit := 20
		if l, ok := args["limit"].(float64); ok && l > 0 {
			limit = int(l)
		}
		type chatRow struct {
			JID    string    `json:"jid"`
			LastAt time.Time `json:"last_message_at"`
		}
		var rows []chatRow
		h.db.Raw(`
			SELECT to_jid as jid, MAX(created_at) as last_at
			FROM message_logs
			WHERE instance_id = ? AND to_jid != ''
			GROUP BY to_jid
			ORDER BY last_at DESC
			LIMIT ?
		`, instance.ID, limit).Scan(&rows)
		b, _ := json.MarshalIndent(rows, "", "  ")
		return rpcResult(id, toolText(string(b)))

	case "get_messages":
		chatJID, _ := args["chat_jid"].(string)
		if chatJID == "" {
			return rpcResult(id, toolError("Parâmetro 'chat_jid' é obrigatório"))
		}
		limit := 20
		if l, ok := args["limit"].(float64); ok && l > 0 {
			limit = int(l)
		}
		var logs []models.MessageLog
		h.db.Where("instance_id = ? AND to_jid = ?", instance.ID, chatJID).
			Order("created_at DESC").
			Limit(limit).
			Find(&logs)
		b, _ := json.MarshalIndent(logs, "", "  ")
		return rpcResult(id, toolText(string(b)))

	case "check_number":
		if client == nil || !client.IsConnected() {
			return rpcResult(id, toolError("Instância WhatsApp não conectada"))
		}
		phone, _ := args["phone"].(string)
		if phone == "" {
			return rpcResult(id, toolError("Parâmetro 'phone' é obrigatório"))
		}
		exists, jid, err := client.CheckNumber(phone)
		if err != nil {
			return rpcResult(id, toolError(err.Error()))
		}
		result := map[string]interface{}{"exists": exists}
		if jid != "" {
			result["jid"] = jid
		}
		b, _ := json.MarshalIndent(result, "", "  ")
		return rpcResult(id, toolText(string(b)))

	default:
		return rpcError(id, -32601, "Ferramenta não encontrada: "+toolName)
	}
}

func mcpToolsList() []map[string]interface{} {
	return []map[string]interface{}{
		{
			"name":        "send_message",
			"description": "Envia uma mensagem de texto via WhatsApp",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"to":      map[string]interface{}{"type": "string", "description": "Número do destinatário (ex: 5511999999999) ou JID completo"},
					"message": map[string]interface{}{"type": "string", "description": "Conteúdo da mensagem de texto"},
				},
				"required": []string{"to", "message"},
			},
		},
		{
			"name":        "list_chats",
			"description": "Lista as conversas recentes da instância WhatsApp",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"limit": map[string]interface{}{"type": "integer", "description": "Número máximo de conversas retornadas (padrão: 20)"},
				},
			},
		},
		{
			"name":        "get_messages",
			"description": "Retorna o histórico de mensagens de uma conversa específica",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"chat_jid": map[string]interface{}{"type": "string", "description": "JID do chat (ex: 5511999999999@s.whatsapp.net ou grupo@g.us)"},
					"limit":    map[string]interface{}{"type": "integer", "description": "Número de mensagens (padrão: 20)"},
				},
				"required": []string{"chat_jid"},
			},
		},
		{
			"name":        "check_number",
			"description": "Verifica se um número de telefone tem conta no WhatsApp",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"phone": map[string]interface{}{"type": "string", "description": "Número com código do país (ex: 5511999999999)"},
				},
				"required": []string{"phone"},
			},
		},
	}
}

// JSON-RPC helpers

func rpcResult(id interface{}, result interface{}) map[string]interface{} {
	return map[string]interface{}{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcError(id interface{}, code int, msg string) map[string]interface{} {
	return map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]interface{}{"code": code, "message": msg},
	}
}

func toolText(text string) map[string]interface{} {
	return map[string]interface{}{
		"content": []map[string]interface{}{{"type": "text", "text": text}},
	}
}

func toolError(msg string) map[string]interface{} {
	return map[string]interface{}{
		"content": []map[string]interface{}{{"type": "text", "text": "Erro: " + msg}},
		"isError": true,
	}
}
