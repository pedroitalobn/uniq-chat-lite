package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type GlobalWebhookHandler struct {
	db *gorm.DB
}

func NewGlobalWebhookHandler(db *gorm.DB) *GlobalWebhookHandler {
	return &GlobalWebhookHandler{db: db}
}

// SystemEventItem é o shape retornado pela API (lista de eventos disponíveis).
// AdminOnly=true esconde o evento de não-admins (ex: pagamento, billing,
// plan changes — informação financeira que workspace owner não deve ver
// por padrão sem ser super admin).
type SystemEventItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	AdminOnly   bool   `json:"admin_only,omitempty"`
	// Scope indica se é evento de instância (instance.* / message.* /
	// chat.* etc — fica disponível em webhooks de instância) ou se é
	// global-only (CRM, journey, deal, billing — só global webhook).
	// "both" disponível nos dois.
	Scope string `json:"scope"` // "instance" | "global" | "both"
}

// SystemEvents — fonte única da verdade. Cobertura completa do que o
// backend emite hoje. Antes era só ~20; agora ~70 cobrindo todos os
// módulos. Eventos AdminOnly são filtrados pra usuários comuns.
var SystemEvents = []SystemEventItem{
	// ─── Connection / Instance ─────────────────────────────────────
	{ID: "instance.created", Name: "Instância criada", Description: "Nova instância foi criada", Category: "Instância", Scope: "global"},
	{ID: "instance.deleted", Name: "Instância deletada", Description: "Instância foi removida", Category: "Instância", Scope: "global", AdminOnly: true},
	{ID: "instance.connected", Name: "Instância conectada", Description: "Pareou com WhatsApp e ficou online", Category: "Instância", Scope: "both"},
	{ID: "instance.disconnected", Name: "Instância desconectada", Description: "Perdeu conexão / logout", Category: "Instância", Scope: "both"},
	{ID: "instance.qr", Name: "QR Code emitido", Description: "Pairing QR atualizado", Category: "Instância", Scope: "instance"},
	{ID: "instance.pairing_code", Name: "Código de pareamento", Description: "Pairing code emitido", Category: "Instância", Scope: "instance"},
	{ID: "instance.banned", Name: "Instância banida", Description: "WhatsApp baniu o número", Category: "Instância", Scope: "both"},

	// ─── Messages (in/out) ─────────────────────────────────────────
	{ID: "message.received", Name: "Mensagem recebida", Description: "Inbound de qualquer tipo", Category: "Mensagem", Scope: "both"},
	{ID: "message.sent", Name: "Mensagem enviada", Description: "Outbound entregue ao servidor", Category: "Mensagem", Scope: "both"},
	{ID: "message.text", Name: "Texto recebido/enviado", Description: "Granular: só msgs de texto", Category: "Mensagem", Scope: "instance"},
	{ID: "message.image", Name: "Imagem", Description: "Granular: foto", Category: "Mensagem", Scope: "instance"},
	{ID: "message.video", Name: "Vídeo", Description: "Granular: vídeo", Category: "Mensagem", Scope: "instance"},
	{ID: "message.audio", Name: "Áudio", Description: "Granular: áudio/voz", Category: "Mensagem", Scope: "instance"},
	{ID: "message.document", Name: "Documento", Description: "Granular: arquivo", Category: "Mensagem", Scope: "instance"},
	{ID: "message.sticker", Name: "Sticker", Description: "Granular: figurinha", Category: "Mensagem", Scope: "instance"},
	{ID: "message.location", Name: "Localização", Description: "Granular: GPS", Category: "Mensagem", Scope: "instance"},
	{ID: "message.contact", Name: "Contato (vCard)", Description: "Granular: contato compartilhado", Category: "Mensagem", Scope: "instance"},
	{ID: "message.reaction", Name: "Reação", Description: "Emoji em cima de mensagem", Category: "Mensagem", Scope: "instance"},
	{ID: "message.edited", Name: "Mensagem editada", Description: "Edit de mensagem (janela 15min)", Category: "Mensagem", Scope: "instance"},
	{ID: "message.deleted", Name: "Mensagem apagada", Description: "Revoke (apagar pra todos)", Category: "Mensagem", Scope: "instance"},
	{ID: "message.status", Name: "Status (delivered/read)", Description: "Receipt de entrega ou leitura", Category: "Mensagem", Scope: "both"},
	{ID: "message.receipt", Name: "Recibo bruto", Description: "Receipt sem agregação (advanced)", Category: "Mensagem", Scope: "instance"},
	{ID: "message.button_response", Name: "Botão clicado", Description: "Resposta de NativeFlow buttons", Category: "Mensagem", Scope: "instance"},
	{ID: "message.list_response", Name: "Item de lista selecionado", Description: "Resposta de ListMessage", Category: "Mensagem", Scope: "instance"},
	{ID: "message.poll_vote", Name: "Voto em enquete", Description: "Cliente votou na poll", Category: "Mensagem", Scope: "instance"},

	// ─── Chat / Presence ──────────────────────────────────────────
	{ID: "chat.presence", Name: "Presença em chat", Description: "Typing/recording indicator", Category: "Conversa", Scope: "instance"},
	{ID: "presence.update", Name: "Presença geral", Description: "Online/offline do contato", Category: "Conversa", Scope: "instance"},
	{ID: "contact.pushname", Name: "Push name atualizado", Description: "Mudou nome de exibição", Category: "Conversa", Scope: "instance"},
	{ID: "contact.update", Name: "Contato atualizado", Description: "Foto/business info mudou", Category: "Conversa", Scope: "instance"},

	// ─── Conversations / Ticketing ────────────────────────────────
	{ID: "conversation.created", Name: "Conversa criada", Description: "Novo ticket aberto", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.assigned", Name: "Conversa atribuída", Description: "Distribuída pra agente/fila", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.transferred", Name: "Conversa transferida", Description: "Trocou de agente/fila", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.resolved", Name: "Conversa resolvida", Description: "Marcada como resolvida", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.reopened", Name: "Conversa reaberta", Description: "Reaberta após resolved", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.closed", Name: "Conversa fechada", Description: "Encerrada definitivamente", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.snoozed", Name: "Conversa adiada", Description: "Snooze ativado", Category: "Atendimento", Scope: "global"},
	{ID: "conversation.note_added", Name: "Nota interna", Description: "Comentário interno entre agentes", Category: "Atendimento", Scope: "global"},

	// ─── Calls ────────────────────────────────────────────────────
	{ID: "call.received", Name: "Ligação recebida", Description: "Voice/video call inbound", Category: "Conversa", Scope: "instance"},
	{ID: "call.rejected", Name: "Ligação rejeitada", Description: "Auto/manualmente rejeitada", Category: "Conversa", Scope: "instance"},

	// ─── Groups / Communities ─────────────────────────────────────
	{ID: "group.update", Name: "Grupo atualizado", Description: "Nome/foto/descrição/announce mudou", Category: "Grupo", Scope: "instance"},
	{ID: "group.participants", Name: "Participantes alterados", Description: "Add/remove/promote/demote", Category: "Grupo", Scope: "instance"},
	{ID: "group.join_request", Name: "Pedido de entrada em grupo", Description: "Approval mode ativo", Category: "Grupo", Scope: "instance"},

	// ─── Newsletter (channels) ────────────────────────────────────
	{ID: "newsletter.message", Name: "Mensagem em canal", Description: "Recebida num newsletter inscrito", Category: "Canal", Scope: "instance"},
	{ID: "newsletter.update", Name: "Canal atualizado", Description: "Metadados/ícone mudaram", Category: "Canal", Scope: "instance"},

	// ─── CRM ──────────────────────────────────────────────────────
	{ID: "crm.contact.created", Name: "Contato criado", Description: "Novo lead/contato no CRM", Category: "CRM", Scope: "global"},
	{ID: "crm.contact.updated", Name: "Contato atualizado", Description: "Edit em campos do contato", Category: "CRM", Scope: "global"},
	{ID: "crm.contact.deleted", Name: "Contato deletado", Description: "Remoção do CRM", Category: "CRM", Scope: "global"},
	{ID: "crm.tag.created", Name: "Tag criada", Description: "Nova tag no workspace", Category: "CRM", Scope: "global"},
	{ID: "crm.tag.assigned", Name: "Tag atribuída", Description: "Tag aplicada a contato", Category: "CRM", Scope: "global"},
	{ID: "crm.tag.removed", Name: "Tag removida", Description: "Tag desvinculada do contato", Category: "CRM", Scope: "global"},
	{ID: "crm.stage.assigned", Name: "Stage atribuído", Description: "Contato moveu de etapa do funil", Category: "CRM", Scope: "global"},
	{ID: "crm.funnel.assigned", Name: "Funil atribuído", Description: "Contato vinculado a funil", Category: "CRM", Scope: "global"},

	// ─── Deals ────────────────────────────────────────────────────
	{ID: "deal.created", Name: "Deal criado", Description: "Nova oportunidade no pipeline", Category: "Deals", Scope: "global"},
	{ID: "deal.updated", Name: "Deal atualizado", Description: "Edit em valor/título/owner", Category: "Deals", Scope: "global"},
	{ID: "deal.moved", Name: "Deal moveu de stage", Description: "Mudança de etapa do pipeline", Category: "Deals", Scope: "global"},
	{ID: "deal.won", Name: "Deal ganho", Description: "Fechamento positivo", Category: "Deals", Scope: "global"},
	{ID: "deal.lost", Name: "Deal perdido", Description: "Fechamento negativo", Category: "Deals", Scope: "global"},
	{ID: "deal.deleted", Name: "Deal deletado", Description: "Removido do pipeline", Category: "Deals", Scope: "global"},

	// ─── Campaigns ────────────────────────────────────────────────
	{ID: "campaign.created", Name: "Campanha criada", Description: "Nova campanha em draft", Category: "Campanha", Scope: "global"},
	{ID: "campaign.started", Name: "Campanha iniciada", Description: "Disparo começou", Category: "Campanha", Scope: "global"},
	{ID: "campaign.paused", Name: "Campanha pausada", Description: "Pause do disparo", Category: "Campanha", Scope: "global"},
	{ID: "campaign.resumed", Name: "Campanha retomada", Description: "Resume após pause", Category: "Campanha", Scope: "global"},
	{ID: "campaign.completed", Name: "Campanha finalizada", Description: "Todos recipients processados", Category: "Campanha", Scope: "global"},
	{ID: "campaign.failed", Name: "Campanha falhou", Description: "Erro irrecuperável", Category: "Campanha", Scope: "global"},
	{ID: "campaign.recipient.sent", Name: "Recipient enviado", Description: "Mensagem entregue a 1 destinatário", Category: "Campanha", Scope: "global"},
	{ID: "campaign.recipient.failed", Name: "Recipient falhou", Description: "Falha pra 1 destinatário", Category: "Campanha", Scope: "global"},

	// ─── Journeys (automação) ─────────────────────────────────────
	{ID: "journey.started", Name: "Jornada iniciada", Description: "Execução criada pra um contato", Category: "Jornada", Scope: "global"},
	{ID: "journey.step", Name: "Step executado", Description: "Cada passo da journey emite", Category: "Jornada", Scope: "global"},
	{ID: "journey.completed", Name: "Jornada finalizada", Description: "Chegou ao fim sem erro", Category: "Jornada", Scope: "global"},
	{ID: "journey.failed", Name: "Jornada falhou", Description: "Erro durante execução", Category: "Jornada", Scope: "global"},
	{ID: "journey.aborted", Name: "Jornada abortada", Description: "Interrompida manualmente", Category: "Jornada", Scope: "global"},

	// ─── AI Agents ────────────────────────────────────────────────
	{ID: "agent.response", Name: "Resposta do agente", Description: "Bot respondeu ao cliente", Category: "Agente IA", Scope: "global"},
	{ID: "agent.handoff", Name: "Handoff humano", Description: "Bot escalou pra agente humano", Category: "Agente IA", Scope: "global"},

	// ─── Triggers (Sprint 8) ──────────────────────────────────────
	{ID: "trigger.fired", Name: "Trigger disparou", Description: "Keyword bateu e ação foi executada", Category: "Triggers", Scope: "global"},

	// ─── Warmup (Sprint 7) ────────────────────────────────────────
	{ID: "warmup.started", Name: "Warmup iniciado", Description: "Sessão de aquecimento começou", Category: "Anti-ban", Scope: "instance"},
	{ID: "warmup.completed", Name: "Warmup finalizado", Description: "Curva de 14 dias completou", Category: "Anti-ban", Scope: "instance"},

	// ─── CSAT ─────────────────────────────────────────────────────
	{ID: "csat.requested", Name: "CSAT solicitado", Description: "Pesquisa de satisfação enviada", Category: "CSAT", Scope: "global"},
	{ID: "csat.submitted", Name: "CSAT respondido", Description: "Cliente enviou nota+comentário", Category: "CSAT", Scope: "global"},

	// ─── Workspace / RBAC ─────────────────────────────────────────
	{ID: "workspace.created", Name: "Workspace criado", Description: "Novo workspace", Category: "Workspace", Scope: "global"},
	{ID: "workspace.member_added", Name: "Membro adicionado", Description: "Convite aceito", Category: "Workspace", Scope: "global"},
	{ID: "workspace.member_removed", Name: "Membro removido", Description: "Saiu do workspace", Category: "Workspace", Scope: "global"},

	// ─── Auth ─────────────────────────────────────────────────────
	{ID: "user.registered", Name: "Usuário registrado", Description: "Sign-up novo", Category: "Usuário", Scope: "global"},
	{ID: "user.login", Name: "Login", Description: "Sessão iniciada", Category: "Usuário", Scope: "global"},
	{ID: "user.logout", Name: "Logout", Description: "Sessão encerrada", Category: "Usuário", Scope: "global"},

	// ─── Pagamento / Billing — ADMIN ONLY ─────────────────────────
	{ID: "payment.success", Name: "Pagamento confirmado", Description: "Stripe/Asaas confirmou", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "payment.failed", Name: "Pagamento falhou", Description: "Cartão/boleto recusado", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "payment.refunded", Name: "Pagamento estornado", Description: "Refund processado", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "subscription.created", Name: "Assinatura criada", Description: "Trial/checkout completou", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "subscription.cancelled", Name: "Assinatura cancelada", Description: "Cliente cancelou plano", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "subscription.renewed", Name: "Assinatura renovada", Description: "Renovação bem-sucedida", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "plan.changed", Name: "Plano alterado", Description: "Upgrade/downgrade", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "billing.invoice_created", Name: "Fatura emitida", Description: "Nova invoice pendente", Category: "Pagamento", Scope: "global", AdminOnly: true},
	{ID: "billing.invoice_paid", Name: "Fatura paga", Description: "Pagamento de invoice OK", Category: "Pagamento", Scope: "global", AdminOnly: true},

	// ─── Sistema ──────────────────────────────────────────────────
	{ID: "webhook.test", Name: "Teste de webhook", Description: "Disparo manual via UI", Category: "Sistema", Scope: "both"},
}

// validEventIDs retorna um set com todos os IDs válidos (para validar input).
func validEventIDs() map[string]bool {
	out := make(map[string]bool, len(SystemEvents))
	for _, e := range SystemEvents {
		out[e.ID] = true
	}
	return out
}

// resolveWebhookUserID extrai o userID dos Locals, tolerante ao tipo (ponteiro
// ou valor). Retorna uuid.Nil se não for possível.
// Evita o panic type-assertion que causava HTTP 500 quando o request vinha via
// API key (middleware salva models.User por valor) vs JWT (por ponteiro).
func resolveWebhookUserID(c *fiber.Ctx) (uuid.UUID, error) {
	raw := c.Locals("user")
	switch u := raw.(type) {
	case *models.User:
		if u == nil {
			return uuid.Nil, fmt.Errorf("usuário nulo")
		}
		return u.ID, nil
	case models.User:
		return u.ID, nil
	default:
		// fallback: user_id setado diretamente em alguns middlewares
		if uid, ok := c.Locals("user_id").(uuid.UUID); ok {
			return uid, nil
		}
		log.Error().Str("user_type", fmt.Sprintf("%T", raw)).Msg("webhooks/system: unexpected locals[user] type")
		return uuid.Nil, fmt.Errorf("não autenticado")
	}
}

// ListEvents GET /webhooks/system/events
//
// Query params (opcionais):
//   ?scope=instance|global|both — filtra por escopo (default: tudo)
//   ?include_admin=1            — força incluir admin-only (super admin)
//
// Eventos AdminOnly são sempre filtrados pra usuários comuns. Pra super
// admin, ?include_admin=1 destrava (e o middleware de admin valida).
func (h *GlobalWebhookHandler) ListEvents(c *fiber.Ctx) error {
	wantScope := strings.ToLower(strings.TrimSpace(c.Query("scope")))
	includeAdmin := c.QueryBool("include_admin", false)

	// Detecta se o caller é super admin via Locals (setado pelo middleware
	// RequireAdmin se aplicável; senão, false).
	isAdmin := false
	if u, ok := c.Locals("user").(*models.User); ok && u != nil {
		isAdmin = u.Role == models.RoleSuperAdmin
	} else if u, ok := c.Locals("user").(models.User); ok {
		isAdmin = u.Role == models.RoleSuperAdmin
	}

	out := make([]SystemEventItem, 0, len(SystemEvents))
	for _, e := range SystemEvents {
		// Filtra admin-only pra não-admin (a não ser que admin pediu inclusivo)
		if e.AdminOnly && !(isAdmin && includeAdmin) {
			continue
		}
		// Filtra por scope quando solicitado.
		if wantScope != "" && wantScope != "both" && e.Scope != wantScope && e.Scope != "both" {
			continue
		}
		out = append(out, e)
	}
	return c.JSON(out)
}

// webhookResponse é o shape exposto pela API (esconde secret etc).
type webhookResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	IsActive  bool      `json:"is_active"`
	Events    []string  `json:"events"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toWebhookResponse(wh *models.GlobalWebhook) webhookResponse {
	var events []string
	if wh.Events != "" {
		if err := json.Unmarshal([]byte(wh.Events), &events); err != nil {
			events = []string{}
		}
	}
	if events == nil {
		events = []string{}
	}
	return webhookResponse{
		ID:        wh.ID,
		Name:      wh.Name,
		URL:       wh.URL,
		IsActive:  wh.IsActive,
		Events:    events,
		CreatedAt: wh.CreatedAt,
		UpdatedAt: wh.UpdatedAt,
	}
}

// List GET /webhooks/system
func (h *GlobalWebhookHandler) List(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	var webhooks []models.GlobalWebhook
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&webhooks).Error; err != nil {
		log.Error().Err(err).Str("user_id", userID.String()).Msg("webhooks/system list: db query failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar webhooks"})
	}

	result := make([]webhookResponse, len(webhooks))
	for i := range webhooks {
		result[i] = toWebhookResponse(&webhooks[i])
	}
	return c.JSON(result)
}

// validateEvents filtra e deduplica o array contra a lista canônica.
// Retorna erro se a lista ficar vazia após filtragem.
func validateEvents(events []string) ([]string, error) {
	valid := validEventIDs()
	seen := make(map[string]bool)
	filtered := make([]string, 0, len(events))
	invalid := make([]string, 0)

	for _, ev := range events {
		if seen[ev] {
			continue
		}
		seen[ev] = true
		if !valid[ev] {
			invalid = append(invalid, ev)
			continue
		}
		filtered = append(filtered, ev)
	}
	if len(filtered) == 0 {
		if len(invalid) > 0 {
			return nil, fmt.Errorf("nenhum evento válido — desconhecidos: %v", invalid)
		}
		return nil, fmt.Errorf("selecione ao menos um evento")
	}
	return filtered, nil
}

// Create POST /webhooks/system
func (h *GlobalWebhookHandler) Create(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	var req struct {
		Name     string   `json:"name"`
		URL      string   `json:"url"`
		Events   []string `json:"events"`
		IsActive *bool    `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Name == "" || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome e url são obrigatórios"})
	}

	cleanEvents, err := validateEvents(req.Events)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	eventsJSON, _ := json.Marshal(cleanEvents)

	secret, err := models.GenerateSecret()
	if err != nil {
		log.Error().Err(err).Msg("webhooks/system create: failed to generate secret")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar secret"})
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	wh := models.GlobalWebhook{
		UserID:   userID,
		Name:     req.Name,
		URL:      req.URL,
		Secret:   secret,
		IsActive: isActive,
		Events:   string(eventsJSON),
	}

	if err := h.db.Create(&wh).Error; err != nil {
		log.Error().Err(err).Str("user_id", userID.String()).Msg("webhooks/system create: db insert failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar webhook: " + err.Error()})
	}

	resp := toWebhookResponse(&wh)
	// Retorna o secret em texto claro APENAS na criação (única vez que ele é visível).
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":         resp.ID,
		"name":       resp.Name,
		"url":        resp.URL,
		"secret":     secret,
		"is_active":  resp.IsActive,
		"events":     resp.Events,
		"created_at": resp.CreatedAt,
		"updated_at": resp.UpdatedAt,
	})
}

// Update PUT /webhooks/system/:id — edita nome/url/events/is_active.
// Todos os campos são opcionais (patch semantics).
func (h *GlobalWebhookHandler) Update(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}

	webhookID := c.Params("id")
	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	var req struct {
		Name     *string   `json:"name"`
		URL      *string   `json:"url"`
		Events   *[]string `json:"events"`
		IsActive *bool     `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		if *req.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nome não pode ser vazio"})
		}
		updates["name"] = *req.Name
	}
	if req.URL != nil {
		if *req.URL == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "url não pode ser vazia"})
		}
		updates["url"] = *req.URL
	}
	if req.Events != nil {
		cleanEvents, err := validateEvents(*req.Events)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		eventsJSON, _ := json.Marshal(cleanEvents)
		updates["events"] = string(eventsJSON)
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	if len(updates) == 0 {
		return c.JSON(toWebhookResponse(&wh))
	}

	if err := h.db.Model(&wh).Updates(updates).Error; err != nil {
		log.Error().Err(err).Str("webhook_id", wh.ID.String()).Msg("webhooks/system update: db update failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar"})
	}
	// Reload
	h.db.First(&wh, "id = ?", wh.ID)
	return c.JSON(toWebhookResponse(&wh))
}

// Delete DELETE /webhooks/system/:id
func (h *GlobalWebhookHandler) Delete(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}
	webhookID := c.Params("id")

	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	if err := h.db.Delete(&wh).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar webhook"})
	}

	return c.JSON(fiber.Map{"success": true})
}

// Test POST /webhooks/system/:id/test — dispara um evento "webhook.test"
func (h *GlobalWebhookHandler) Test(c *fiber.Ctx) error {
	userID, err := resolveWebhookUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
	}
	webhookID := c.Params("id")

	var wh models.GlobalWebhook
	if err := h.db.Where("id = ? AND user_id = ?", webhookID, userID).First(&wh).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	if !wh.IsActive {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "webhook está inativo"})
	}

	var events []string
	_ = json.Unmarshal([]byte(wh.Events), &events)

	testEvent := fiber.Map{
		"event":      "webhook.test",
		"timestamp":  time.Now().Unix(),
		"webhook_id": wh.ID.String(),
		"data": fiber.Map{
			"type":    "test",
			"message": "Teste de webhook",
			"events":  events,
		},
	}

	payload, _ := json.Marshal(testEvent)

	req, err := http.NewRequest("POST", wh.URL, bytes.NewBuffer(payload))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "URL inválida"})
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", wh.Secret)
	req.Header.Set("X-Webhook-Event", "webhook.test")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao enviar teste: " + err.Error()})
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return c.JSON(fiber.Map{
			"success": true,
			"message": "Teste enviado com sucesso",
			"status":  resp.StatusCode,
		})
	}

	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"success": false,
		"message": "Teste enviado mas endpoint retornou erro",
		"status":  resp.StatusCode,
	})
}
