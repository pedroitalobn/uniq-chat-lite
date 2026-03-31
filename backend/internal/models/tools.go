package models

import "encoding/json"

type Tool struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Parameters  map[string]Parameter `json:"parameters"`
}

type Parameter struct {
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Required    bool     `json:"required"`
	Enum        []string `json:"enum,omitempty"`
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type ToolResult struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Result interface{} `json:"result"`
	Error  string      `json:"error,omitempty"`
}

var AvailableTools = []Tool{
	{
		Name:        "list_instances",
		Description: "Lista todas as instâncias WhatsApp do usuário. Retorna nome, status, número de telefone e ID.",
		Parameters:  map[string]Parameter{},
	},
	{
		Name:        "list_groups",
		Description: "Lista todos os grupos de uma instância específica. Parâmetro: instance_id (opcional, usa a primeira se não especificado).",
		Parameters: map[string]Parameter{
			"instance_id": {
				Type:        "string",
				Description: "ID da instância (UUID)",
				Required:    false,
			},
		},
	},
	{
		Name:        "list_journeys",
		Description: "Lista todas as jornadas de automação do usuário. Retorna nome, status, gatilho e contagem de execuções.",
		Parameters:  map[string]Parameter{},
	},
	{
		Name:        "get_journey",
		Description: "Obtém detalhes de uma jornada específica pelo ID.",
		Parameters: map[string]Parameter{
			"journey_id": {
				Type:        "string",
				Description: "ID da jornada (UUID)",
				Required:    true,
			},
		},
	},
	{
		Name:        "toggle_journey",
		Description: "Ativa ou desativa uma jornada. Parâmetros: journey_id e status ('active' ou 'paused').",
		Parameters: map[string]Parameter{
			"journey_id": {
				Type:        "string",
				Description: "ID da jornada (UUID)",
				Required:    true,
			},
			"status": {
				Type:        "string",
				Description: "Novo status: 'active' ou 'paused'",
				Required:    true,
				Enum:        []string{"active", "paused"},
			},
		},
	},
	{
		Name:        "delete_journey",
		Description: "Remove uma jornada de automação pelo ID.",
		Parameters: map[string]Parameter{
			"journey_id": {
				Type:        "string",
				Description: "ID da jornada (UUID)",
				Required:    true,
			},
		},
	},
	{
		Name:        "create_journey",
		Description: "Cria uma nova jornada de automação. Parâmetros: prompt (descrição em linguagem natural do que a jornada deve fazer), instance_id (opcional).",
		Parameters: map[string]Parameter{
			"prompt": {
				Type:        "string",
				Description: "Descrição da jornada em português. Ex: 'Quando alguém mencionar orçamento no grupo Marketing, envie uma mensagem privada de boas-vindas'",
				Required:    true,
			},
			"instance_id": {
				Type:        "string",
				Description: "ID da instância WhatsApp para associar (UUID, opcional)",
				Required:    false,
			},
		},
	},
	{
		Name:        "list_integrations",
		Description: "Lista todas as integrações de IA configuradas pelo usuário (OpenAI, Claude, DeepSeek, etc).",
		Parameters:  map[string]Parameter{},
	},
	{
		Name:        "send_message",
		Description: "Envia uma mensagem de teste via WhatsApp. Parâmetros: instance_id, to (número ou @grupo), text (mensagem).",
		Parameters: map[string]Parameter{
			"instance_id": {
				Type:        "string",
				Description: "ID da instância WhatsApp (UUID)",
				Required:    true,
			},
			"to": {
				Type:        "string",
				Description: "Número do destinatário (ex: 5511999999999) ou @nomedogrupo",
				Required:    true,
			},
			"text": {
				Type:        "string",
				Description: "Texto da mensagem",
				Required:    true,
			},
		},
	},
	{
		Name:        "get_user_context",
		Description: "Obtém contexto geral do usuário: instâncias, integrações ativas, contagem de jornadas e grupos.",
		Parameters:  map[string]Parameter{},
	},
}

func GetToolsJSON() string {
	data, _ := json.Marshal(AvailableTools)
	return string(data)
}
