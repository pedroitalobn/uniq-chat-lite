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
	// ─── CRM: Contacts ──────────────────────────────────────────────────
	{
		Name:        "list_contacts",
		Description: "Lista contatos do CRM. Parâmetros opcionais: search (busca por nome/telefone/email), stage (filtrar por estágio), limit (max 100, default 20).",
		Parameters: map[string]Parameter{
			"search": {Type: "string", Description: "Busca por nome, telefone ou email", Required: false},
			"stage":  {Type: "string", Description: "Filtrar por estágio do funil", Required: false},
			"limit":  {Type: "integer", Description: "Máximo de resultados (default 20)", Required: false},
		},
	},
	{
		Name:        "get_contact",
		Description: "Obtém detalhes completos de um contato pelo ID.",
		Parameters: map[string]Parameter{
			"contact_id": {Type: "string", Description: "UUID do contato", Required: true},
		},
	},
	{
		Name:        "create_contact",
		Description: "Cria um novo contato no CRM. Obrigatório: name e phone.",
		Parameters: map[string]Parameter{
			"name":   {Type: "string", Description: "Nome do contato", Required: true},
			"phone":  {Type: "string", Description: "Telefone (ex: 5511999999999)", Required: true},
			"email":  {Type: "string", Description: "E-mail (opcional)", Required: false},
			"notes":  {Type: "string", Description: "Observações", Required: false},
			"stage":  {Type: "string", Description: "Estágio no funil (opcional)", Required: false},
			"funnel": {Type: "string", Description: "Nome do funil (opcional)", Required: false},
		},
	},
	{
		Name:        "update_contact",
		Description: "Atualiza campos de um contato existente.",
		Parameters: map[string]Parameter{
			"contact_id": {Type: "string", Description: "UUID do contato", Required: true},
			"name":       {Type: "string", Description: "Novo nome", Required: false},
			"email":      {Type: "string", Description: "Novo e-mail", Required: false},
			"notes":      {Type: "string", Description: "Observações", Required: false},
			"stage":      {Type: "string", Description: "Novo estágio", Required: false},
			"funnel":     {Type: "string", Description: "Novo funil", Required: false},
			"job_title":  {Type: "string", Description: "Cargo", Required: false},
		},
	},
	// ─── CRM: Companies ─────────────────────────────────────────────────
	{
		Name:        "list_companies",
		Description: "Lista empresas do CRM. Parâmetro opcional: search (nome/domínio).",
		Parameters: map[string]Parameter{
			"search": {Type: "string", Description: "Busca por nome ou domínio", Required: false},
			"limit":  {Type: "integer", Description: "Máximo de resultados (default 20)", Required: false},
		},
	},
	{
		Name:        "create_company",
		Description: "Cria uma nova empresa no CRM.",
		Parameters: map[string]Parameter{
			"name":     {Type: "string", Description: "Nome da empresa", Required: true},
			"domain":   {Type: "string", Description: "Domínio (ex: empresa.com)", Required: false},
			"industry": {Type: "string", Description: "Setor/indústria", Required: false},
			"phone":    {Type: "string", Description: "Telefone", Required: false},
			"email":    {Type: "string", Description: "E-mail", Required: false},
		},
	},
	// ─── CRM: Deals ─────────────────────────────────────────────────────
	{
		Name:        "list_deals",
		Description: "Lista deals (oportunidades) do CRM. Filtros: status, funnel_id.",
		Parameters: map[string]Parameter{
			"status":    {Type: "string", Description: "open | won | lost | archived", Required: false, Enum: []string{"open", "won", "lost", "archived"}},
			"funnel_id": {Type: "string", Description: "UUID do funil para filtrar", Required: false},
			"limit":     {Type: "integer", Description: "Máximo de resultados (default 20)", Required: false},
		},
	},
	{
		Name:        "create_deal",
		Description: "Cria um novo deal no funil de vendas.",
		Parameters: map[string]Parameter{
			"title":      {Type: "string", Description: "Título do deal", Required: true},
			"contact_id": {Type: "string", Description: "UUID do contato", Required: true},
			"funnel_id":  {Type: "string", Description: "UUID do funil", Required: true},
			"stage_id":   {Type: "string", Description: "UUID do estágio inicial", Required: true},
			"value":      {Type: "number", Description: "Valor em reais (ex: 1500.00)", Required: false},
		},
	},
	{
		Name:        "move_deal_stage",
		Description: "Move um deal para outro estágio e/ou muda seu status (won/lost).",
		Parameters: map[string]Parameter{
			"deal_id":  {Type: "string", Description: "UUID do deal", Required: true},
			"stage_id": {Type: "string", Description: "UUID do novo estágio", Required: true},
			"status":   {Type: "string", Description: "Novo status: open | won | lost", Required: false, Enum: []string{"open", "won", "lost"}},
		},
	},
	{
		Name:        "list_funnels",
		Description: "Lista funis do CRM com seus estágios.",
		Parameters:  map[string]Parameter{},
	},
	// ─── Campaigns ──────────────────────────────────────────────────────
	{
		Name:        "list_campaigns",
		Description: "Lista campanhas do workspace. Filtro opcional por status.",
		Parameters: map[string]Parameter{
			"status": {Type: "string", Description: "draft | scheduled | running | paused | completed | failed", Required: false},
			"limit":  {Type: "integer", Description: "Máximo de resultados (default 20)", Required: false},
		},
	},
	{
		Name:        "get_campaign",
		Description: "Obtém detalhes e estatísticas de uma campanha específica.",
		Parameters: map[string]Parameter{
			"campaign_id": {Type: "string", Description: "UUID da campanha", Required: true},
		},
	},
	{
		Name:        "create_campaign",
		Description: "Cria uma nova campanha de disparo (rascunho). Use start_campaign para iniciar.",
		Parameters: map[string]Parameter{
			"name":           {Type: "string", Description: "Nome da campanha", Required: true},
			"instance_id":    {Type: "string", Description: "UUID da instância WhatsApp", Required: true},
			"message_text":   {Type: "string", Description: "Texto da mensagem a enviar", Required: true},
			"recipient_type": {Type: "string", Description: "contacts | groups | crm", Required: false},
		},
	},
	{
		Name:        "start_campaign",
		Description: "Inicia uma campanha que está em rascunho ou pausada.",
		Parameters: map[string]Parameter{
			"campaign_id": {Type: "string", Description: "UUID da campanha", Required: true},
		},
	},
	{
		Name:        "pause_campaign",
		Description: "Pausa uma campanha em execução.",
		Parameters: map[string]Parameter{
			"campaign_id": {Type: "string", Description: "UUID da campanha", Required: true},
		},
	},
	// ─── Inbox / Conversas ──────────────────────────────────────────────
	{
		Name:        "list_conversations",
		Description: "Lista conversas do inbox. Por padrão retorna abertas e pendentes.",
		Parameters: map[string]Parameter{
			"status":      {Type: "string", Description: "open | pending | resolved | closed | snoozed", Required: false},
			"assigned_to": {Type: "string", Description: "UUID do agente (filtra por responsável)", Required: false},
			"limit":       {Type: "integer", Description: "Máximo de resultados (default 20)", Required: false},
		},
	},
	{
		Name:        "get_conversation",
		Description: "Obtém detalhes de uma conversa com as últimas 10 mensagens.",
		Parameters: map[string]Parameter{
			"conversation_id": {Type: "string", Description: "UUID da conversa", Required: true},
		},
	},
	{
		Name:        "assign_conversation",
		Description: "Atribui uma conversa a um agente ou fila.",
		Parameters: map[string]Parameter{
			"conversation_id":   {Type: "string", Description: "UUID da conversa", Required: true},
			"assign_to_user_id": {Type: "string", Description: "UUID do agente", Required: false},
			"queue_id":          {Type: "string", Description: "UUID da fila", Required: false},
		},
	},
	{
		Name:        "close_conversation",
		Description: "Fecha ou resolve uma conversa.",
		Parameters: map[string]Parameter{
			"conversation_id": {Type: "string", Description: "UUID da conversa", Required: true},
			"status":          {Type: "string", Description: "resolved (default) ou closed", Required: false, Enum: []string{"resolved", "closed"}},
		},
	},
	{
		Name:        "list_queues",
		Description: "Lista filas de atendimento ativas do workspace.",
		Parameters:  map[string]Parameter{},
	},
	// ─── Stats ──────────────────────────────────────────────────────────
	{
		Name:        "get_dashboard_stats",
		Description: "Retorna painel de métricas: conversas abertas, contatos, deals ativos, campanhas rodando, valor do pipeline.",
		Parameters:  map[string]Parameter{},
	},
	{
		Name:        "get_conversation_stats",
		Description: "Estatísticas de conversas e mensagens de um período.",
		Parameters: map[string]Parameter{
			"days": {Type: "integer", Description: "Período em dias (default 7, max 90)", Required: false},
		},
	},
	// ─── Shop / Products tools ──────────────────────────────────────────
	{
		Name:        "list_products",
		Description: "Lista produtos do catálogo (Shop) do workspace ativo. Retorna nome, preço, SKU, estoque e imagem. Use limit pra controlar tamanho do retorno.",
		Parameters: map[string]Parameter{
			"shop_id": {Type: "string", Description: "Filtrar por shop específica (UUID, opcional)", Required: false},
			"limit":   {Type: "integer", Description: "Máximo de produtos (default 10, max 50)", Required: false},
		},
	},
	{
		Name:        "search_products",
		Description: "Busca produtos por palavra-chave em nome, descrição ou SKU. Use pra responder perguntas de cliente sobre disponibilidade.",
		Parameters: map[string]Parameter{
			"query":     {Type: "string", Description: "Termo de busca (ex: 'tênis nike')", Required: true},
			"shop_id":   {Type: "string", Description: "Restringir a uma shop (UUID, opcional)", Required: false},
			"max_price": {Type: "number", Description: "Preço máximo (opcional)", Required: false},
			"min_price": {Type: "number", Description: "Preço mínimo (opcional)", Required: false},
			"limit":     {Type: "integer", Description: "Máximo de resultados (default 5)", Required: false},
		},
	},
	{
		Name:        "get_product_details",
		Description: "Detalhes completos de um produto: descrição, preço, estoque, imagens, categoria.",
		Parameters: map[string]Parameter{
			"product_id": {Type: "string", Description: "UUID do produto", Required: true},
		},
	},
}

func GetToolsJSON() string {
	data, _ := json.Marshal(AvailableTools)
	return string(data)
}
