package services

// agent_tools.go — ações nativas que o agente pode executar dentro da
// Uniq durante uma conversa. Em vez de function-calling do provider
// (Anthropic tools / OpenAI functions — que cada um implementa diferente),
// adotamos uma convenção textual portável: o LLM emite no fim da resposta
//
//   [[action:NAME({"key":"value"})]]
//
// e o runtime parseia, executa, e devolve resultado pro LLM no próximo
// turn (via último-turno do histórico). Marker é stripado da resposta
// que vai pro cliente.

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// actionMarkerRe — pega NAME e o JSON literal entre os parênteses. Tolera
// espaços e múltiplos markers no mesmo turno.
var actionMarkerRe = regexp.MustCompile(`(?s)\[\[action:([a-z_]+)\((\{.*?\})\)\]\]`)

// AgentToolContext — info que o executor precisa pra completar a ação.
type AgentToolContext struct {
	DB             *gorm.DB
	Agent          *models.InstanceAgent
	Conversation   *models.Conversation
	Contact        *models.Contact
	WorkspaceID    uuid.UUID
	CreatedByID    uuid.UUID // user_id do dono da instância (pra rastreabilidade)
}

// AgentToolResult — devolvido pra ser injetado no histórico/log.
type AgentToolResult struct {
	Tool   string `json:"tool"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
	ID     string `json:"id,omitempty"` // id da entidade criada (task/meeting/etc)
}

// ParseAndExecuteActions extrai todos os markers do reply, executa cada
// um (respeitando ActionConfirmation: client = só se já houve confirmação,
// não roda automático aqui), e devolve a reply limpa + lista de resultados.
//
// Política de confirmação:
//   - "auto"   — executa direto. Risco assumido pelo user na config.
//   - "client" — DEFAULT. Executa só se o LLM já fez a pergunta no turno
//                anterior e o cliente confirmou (heurística: marker presente
//                já significa que o LLM recebeu sinal verde — o próprio
//                modelo decide quando emitir baseado no histórico). Em
//                caso de dúvida prefere não executar.
//   - "human"  — não executa; cria CrmTask pra time humano aprovar.
func ParseAndExecuteActions(ctx AgentToolContext, reply string) (string, []AgentToolResult) {
	matches := actionMarkerRe.FindAllStringSubmatchIndex(reply, -1)
	if len(matches) == 0 {
		return reply, nil
	}

	var results []AgentToolResult
	confirmation := strings.ToLower(strings.TrimSpace(ctx.Agent.ActionConfirmation))
	if confirmation == "" {
		confirmation = "client"
	}

	for _, m := range matches {
		toolName := strings.ToLower(reply[m[2]:m[3]])
		argsRaw := reply[m[4]:m[5]]

		var args map[string]any
		if err := json.Unmarshal([]byte(argsRaw), &args); err != nil {
			results = append(results, AgentToolResult{
				Tool: toolName, OK: false,
				Detail: "args inválidos: " + err.Error(),
			})
			continue
		}

		// Modo human: cria CrmTask de aprovação em vez de executar.
		if confirmation == "human" {
			id, err := createApprovalTask(ctx, toolName, args)
			results = append(results, AgentToolResult{
				Tool: toolName, OK: err == nil, ID: id,
				Detail: ifErr(err, "tarefa de aprovação criada — humano vai revisar"),
			})
			continue
		}

		// Auto e client → executam aqui. (Para "client", o LLM só emite
		// o marker quando o cliente confirmou no chat — responsabilidade
		// é do prompt instruir esse comportamento.)
		res := executeAction(ctx, toolName, args)
		res.Tool = toolName
		results = append(results, res)
	}

	clean := actionMarkerRe.ReplaceAllString(reply, "")
	clean = strings.TrimSpace(clean)
	return clean, results
}

func executeAction(ctx AgentToolContext, name string, args map[string]any) AgentToolResult {
	switch name {
	case "add_tag":
		return toolAddTag(ctx, args)
	case "remove_tag":
		return toolRemoveTag(ctx, args)
	case "note":
		return toolNote(ctx, args)
	case "create_task":
		return toolCreateTask(ctx, args)
	case "schedule_meeting":
		return toolScheduleMeeting(ctx, args)
	case "transfer_to_human":
		return toolTransferToHuman(ctx, args)
	// Sprint A — CRM
	case "update_contact":
		return toolUpdateContact(ctx, args)
	case "create_deal":
		return toolCreateDeal(ctx, args)
	case "update_deal_stage":
		return toolUpdateDealStage(ctx, args)
	case "search_contact":
		return toolSearchContact(ctx, args)
	// Sprint B — jornada
	case "enroll_in_journey":
		return toolEnrollInJourney(ctx, args)
	}
	return AgentToolResult{OK: false, Detail: "tool desconhecida: " + name}
}

// ─── Tools individuais ────────────────────────────────────────────────────

func toolAddTag(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Contact == nil {
		return AgentToolResult{OK: false, Detail: "contato não resolvido"}
	}
	tagName := strings.TrimSpace(asString(args["tag"]))
	if tagName == "" {
		tagName = strings.TrimSpace(asString(args["name"]))
	}
	if tagName == "" {
		return AgentToolResult{OK: false, Detail: "tag obrigatória"}
	}

	// Busca/cria tag no workspace.
	var tag models.Tag
	err := ctx.DB.Where("workspace_id = ? AND LOWER(name) = LOWER(?)", ctx.WorkspaceID, tagName).
		First(&tag).Error
	if err != nil {
		tag = models.Tag{
			ID:          uuid.New(),
			UserID:      ctx.CreatedByID,
			WorkspaceID: &ctx.WorkspaceID,
			Name:        tagName,
		}
		if err := ctx.DB.Create(&tag).Error; err != nil {
			return AgentToolResult{OK: false, Detail: "falha ao criar tag: " + err.Error()}
		}
	}

	// Many-to-many via tabela contact_tags (GORM gera com DSL Append).
	if err := ctx.DB.Model(ctx.Contact).Association("Tags").Append(&tag); err != nil {
		return AgentToolResult{OK: false, Detail: "falha ao associar tag: " + err.Error()}
	}
	log.Info().Str("tag", tag.Name).Str("contact", ctx.Contact.ID.String()).
		Msg("agent-tools: tag adicionada")
	return AgentToolResult{OK: true, ID: tag.ID.String(), Detail: "tag aplicada: " + tag.Name}
}

func toolRemoveTag(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Contact == nil {
		return AgentToolResult{OK: false, Detail: "contato não resolvido"}
	}
	tagName := strings.TrimSpace(asString(args["tag"]))
	if tagName == "" {
		return AgentToolResult{OK: false, Detail: "tag obrigatória"}
	}
	var tag models.Tag
	if err := ctx.DB.Where("workspace_id = ? AND LOWER(name) = LOWER(?)", ctx.WorkspaceID, tagName).
		First(&tag).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "tag não encontrada"}
	}
	if err := ctx.DB.Model(ctx.Contact).Association("Tags").Delete(&tag); err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, Detail: "tag removida: " + tag.Name}
}

func toolNote(ctx AgentToolContext, args map[string]any) AgentToolResult {
	text := strings.TrimSpace(asString(args["text"]))
	if text == "" {
		return AgentToolResult{OK: false, Detail: "text obrigatório"}
	}
	// Por enquanto persistimos como CrmTask type=custom completed — usa
	// infra existente sem precisar de modelo de Note dedicado.
	now := time.Now()
	task := models.CrmTask{
		WorkspaceID:  ctx.WorkspaceID,
		CreatedByID:  ctx.CreatedByID,
		Title:        firstNRunesStr(text, 80),
		Description:  text,
		Type:         "note",
		Status:       "done",
		Priority:     "medium",
		AssigneeType: "agent",
		CompletedAt:  &now,
	}
	if ctx.Contact != nil {
		task.ContactID = &ctx.Contact.ID
	}
	if ctx.Conversation != nil {
		task.ConversationID = &ctx.Conversation.ID
	}
	if ctx.Agent != nil {
		task.AssigneeAgentID = &ctx.Agent.ID
		task.AgentInstanceID = &ctx.Agent.InstanceID
	}
	if err := ctx.DB.Create(&task).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: task.ID.String(), Detail: "anotado"}
}

func toolCreateTask(ctx AgentToolContext, args map[string]any) AgentToolResult {
	title := strings.TrimSpace(asString(args["title"]))
	if title == "" {
		return AgentToolResult{OK: false, Detail: "title obrigatório"}
	}
	due := parseTimeFlexible(asString(args["due_at"]))
	task := models.CrmTask{
		WorkspaceID:  ctx.WorkspaceID,
		CreatedByID:  ctx.CreatedByID,
		Title:        firstNRunesStr(title, 200),
		Description:  asString(args["description"]),
		Type:         "custom",
		Status:       "pending",
		Priority:     "medium",
		AssigneeType: "user",
		DueAt:        due,
	}
	if ctx.Contact != nil {
		task.ContactID = &ctx.Contact.ID
	}
	if ctx.Conversation != nil {
		task.ConversationID = &ctx.Conversation.ID
	}
	if err := ctx.DB.Create(&task).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: task.ID.String(), Detail: "tarefa criada"}
}

func toolScheduleMeeting(ctx AgentToolContext, args map[string]any) AgentToolResult {
	title := strings.TrimSpace(asString(args["title"]))
	if title == "" {
		title = "Reunião com cliente"
	}
	start := parseTimeFlexible(asString(args["when"]))
	if start == nil {
		start = parseTimeFlexible(asString(args["start_at"]))
	}
	if start == nil {
		return AgentToolResult{OK: false, Detail: "campo 'when' (ISO8601) obrigatório"}
	}
	dur := 60
	if v, ok := args["duration_min"]; ok {
		switch x := v.(type) {
		case float64:
			dur = int(x)
		case string:
			if n, err := atoiSafe(x); err == nil {
				dur = n
			}
		}
	}
	end := start.Add(time.Duration(dur) * time.Minute)

	meeting := models.CrmMeeting{
		WorkspaceID: ctx.WorkspaceID,
		CreatedByID: ctx.CreatedByID,
		Title:       firstNRunesStr(title, 200),
		Description: asString(args["description"]),
		Status:      "scheduled",
		StartAt:     *start,
		EndAt:       end,
		Timezone:    "America/Sao_Paulo",
		Provider:    "manual",
	}
	if ctx.Contact != nil {
		meeting.ContactID = &ctx.Contact.ID
	}
	if err := ctx.DB.Create(&meeting).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{
		OK:     true,
		ID:     meeting.ID.String(),
		Detail: "reunião agendada para " + start.Format("02/01/2006 15:04"),
	}
}

func toolTransferToHuman(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Conversation == nil {
		return AgentToolResult{OK: false, Detail: "conversa não resolvida"}
	}
	reason := strings.TrimSpace(asString(args["reason"]))
	state := models.ConversationAgentState{
		ConversationID: ctx.Conversation.ID,
		Mode:           models.AgentModeDisabled,
		HandoffReason:  reason,
	}
	ctx.DB.Where("conversation_id = ?", ctx.Conversation.ID).
		Assign(map[string]any{"mode": models.AgentModeDisabled, "handoff_reason": reason}).
		FirstOrCreate(&state)
	// Atualiza conversation pra is_bot_active=false como segundo cinto.
	ctx.DB.Model(ctx.Conversation).Update("is_bot_active", false)
	return AgentToolResult{OK: true, Detail: "transferido para humano"}
}

// createApprovalTask — modo human: agente sugere ação e humano aprova.
func createApprovalTask(ctx AgentToolContext, toolName string, args map[string]any) (string, error) {
	argsJSON, _ := json.Marshal(args)
	task := models.CrmTask{
		WorkspaceID:  ctx.WorkspaceID,
		CreatedByID:  ctx.CreatedByID,
		Title:        "Aprovar ação do agente: " + toolName,
		Description:  string(argsJSON),
		Type:         "approval",
		Status:       "pending",
		Priority:     "high",
		AssigneeType: "user",
	}
	if ctx.Contact != nil {
		task.ContactID = &ctx.Contact.ID
	}
	if ctx.Conversation != nil {
		task.ConversationID = &ctx.Conversation.ID
	}
	if err := ctx.DB.Create(&task).Error; err != nil {
		return "", err
	}
	return task.ID.String(), nil
}

// ─── Prompt section: descreve as tools disponíveis ──────────────────────

// BuildToolsPromptSection — texto a ser concatenado no system prompt do
// agente listando o set de tools que ele pode invocar via marker
// [[action:NAME({...})]]. Filtra pelos tools habilitados em
// agent.AppAccess (entries com type="action" e enabled=true). Se vazio,
// retorna string vazia (zero tools liberadas — modo conversacional puro).
func BuildToolsPromptSection(agent *models.InstanceAgent) string {
	enabled := parseEnabledTools(agent)
	if len(enabled) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("AÇÕES DISPONÍVEIS\n")
	b.WriteString("Você pode executar ações no sistema da Uniq emitindo no FIM da sua resposta um marker ")
	b.WriteString("literal `[[action:NAME({\"key\":\"value\"})]]`. Use APENAS quando estritamente necessário e ")
	switch strings.ToLower(strings.TrimSpace(agent.ActionConfirmation)) {
	case "auto":
		b.WriteString("após deixar claro pro cliente o que vai fazer.\n")
	case "human":
		b.WriteString("o time humano vai revisar antes de executar — você pode prometer follow-up.\n")
	default:
		b.WriteString("APÓS o cliente confirmar explicitamente. Pergunte sempre antes.\n")
	}
	for _, t := range enabled {
		if def, ok := toolCatalog[t]; ok {
			b.WriteString("- " + def + "\n")
		}
	}
	return b.String()
}

// toolCatalog — descrição compacta de cada ação. Mantém em PT-BR pra
// alinhar com o resto do system prompt.
var toolCatalog = map[string]string{
	"add_tag":           `add_tag({"tag":"vip"}) — adiciona tag ao contato.`,
	"remove_tag":        `remove_tag({"tag":"vip"}) — remove tag do contato.`,
	"note":              `note({"text":"Cliente pediu retorno na quinta"}) — registra nota interna.`,
	"create_task":       `create_task({"title":"...","due_at":"2026-05-10T15:00:00Z","description":"..."}) — cria tarefa pra time humano.`,
	"schedule_meeting":  `schedule_meeting({"title":"...","when":"2026-05-10T15:00:00Z","duration_min":60,"description":"..."}) — agenda reunião com o contato.`,
	"transfer_to_human": `transfer_to_human({"reason":"cliente pediu cancelamento"}) — transfere a conversa pra humano e desliga o bot.`,
	// Sprint A — CRM
	"update_contact":    `update_contact({"email":"x@y.com","name":"Novo nome","custom_fields":{"cargo":"Diretor"}}) — atualiza dados do contato.`,
	"create_deal":       `create_deal({"title":"Plano Pro - empresa X","value":99,"funnel":"Vendas","stage":"Proposta"}) — cria deal no funil/estágio (por nome).`,
	"update_deal_stage": `update_deal_stage({"stage":"Fechado-Ganho"}) — move o deal mais recente do contato pra esta etapa (por nome).`,
	"search_contact":    `search_contact({"query":"João Silva"}) — busca contato por nome/telefone/email; retorna até 5 matches.`,
	// Sprint B — jornadas
	"enroll_in_journey": `enroll_in_journey({"journey":"Onboarding"}) — inscreve o contato na jornada (por nome).`,
}

func parseEnabledTools(agent *models.InstanceAgent) []string {
	if agent == nil {
		return nil
	}
	type appAccess struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Enabled bool   `json:"enabled"`
	}
	var entries []appAccess
	_ = json.Unmarshal([]byte(agent.AppAccess), &entries)
	var out []string
	for _, e := range entries {
		if strings.EqualFold(e.Type, "action") && e.Enabled {
			n := strings.ToLower(strings.TrimSpace(e.Name))
			if _, ok := toolCatalog[n]; ok {
				out = append(out, n)
			}
		}
	}
	return out
}

// ─── Helpers compartilhados ─────────────────────────────────────────────

func asString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func parseTimeFlexible(s string) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return &t
		}
	}
	return nil
}

func firstNRunesStr(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n])
}

func ifErr(err error, ok string) string {
	if err != nil {
		return err.Error()
	}
	return ok
}

// ─── Sprint A: CRM tools ──────────────────────────────────────────────────

// toolUpdateContact — atualiza name/email e merge custom_fields.
// Não toca telefone (segurança: phone é identidade, evita spoof por LLM).
func toolUpdateContact(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Contact == nil {
		return AgentToolResult{OK: false, Detail: "contato não resolvido"}
	}
	updates := map[string]any{}
	if v := strings.TrimSpace(asString(args["name"])); v != "" && v != ctx.Contact.Name {
		updates["name"] = v
	}
	if v := strings.TrimSpace(asString(args["email"])); v != "" && v != ctx.Contact.Email {
		updates["email"] = v
	}
	// Merge custom_fields (não substitui — preserva o que existe).
	if cf, ok := args["custom_fields"].(map[string]any); ok && len(cf) > 0 {
		var existing map[string]any
		if ctx.Contact.CustomFields != "" {
			_ = json.Unmarshal([]byte(ctx.Contact.CustomFields), &existing)
		}
		if existing == nil {
			existing = map[string]any{}
		}
		for k, v := range cf {
			existing[k] = v
		}
		if b, err := json.Marshal(existing); err == nil {
			updates["custom_fields"] = string(b)
		}
	}
	if len(updates) == 0 {
		return AgentToolResult{OK: true, Detail: "nada a atualizar"}
	}
	if err := ctx.DB.Model(ctx.Contact).Updates(updates).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: ctx.Contact.ID.String(), Detail: "contato atualizado"}
}

// toolCreateDeal — cria um deal no funil/estágio especificado (por nome,
// case-insensitive). Default value=0, currency=BRL.
func toolCreateDeal(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Contact == nil {
		return AgentToolResult{OK: false, Detail: "contato não resolvido"}
	}
	title := strings.TrimSpace(asString(args["title"]))
	if title == "" {
		return AgentToolResult{OK: false, Detail: "title obrigatório"}
	}
	funnelName := strings.TrimSpace(asString(args["funnel"]))
	stageName := strings.TrimSpace(asString(args["stage"]))

	// Resolve funil.
	var funnel models.Funnel
	q := ctx.DB.Where("workspace_id = ?", ctx.WorkspaceID)
	if funnelName != "" {
		q = q.Where("LOWER(name) = LOWER(?)", funnelName)
	} else {
		q = q.Where("is_default = ?", true)
	}
	if err := q.First(&funnel).Error; err != nil {
		// Fallback: pega o primeiro do workspace.
		if err2 := ctx.DB.Where("workspace_id = ?", ctx.WorkspaceID).Order("created_at ASC").First(&funnel).Error; err2 != nil {
			return AgentToolResult{OK: false, Detail: "nenhum funil encontrado pra criar deal"}
		}
	}

	// Resolve stage do funil.
	var stage models.FunnelStage
	sq := ctx.DB.Where("funnel_id = ?", funnel.ID)
	if stageName != "" {
		sq = sq.Where("LOWER(name) = LOWER(?)", stageName)
	} else {
		sq = sq.Order(`"order" ASC`)
	}
	if err := sq.First(&stage).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "estágio não encontrado no funil " + funnel.Name}
	}

	// Value em centavos (mesma convenção dos outros endpoints).
	var valueCents int
	switch v := args["value"].(type) {
	case float64:
		valueCents = int(v * 100)
	case int:
		valueCents = v * 100
	case string:
		if n, err := atoiSafe(v); err == nil {
			valueCents = n * 100
		}
	}
	currency := strings.ToUpper(strings.TrimSpace(asString(args["currency"])))
	if currency == "" {
		currency = "BRL"
	}

	deal := models.Deal{
		WorkspaceID: ctx.WorkspaceID,
		FunnelID:    funnel.ID,
		StageID:     stage.ID,
		ContactID:   ctx.Contact.ID,
		Title:       firstNRunesStr(title, 200),
		Value:       int64(valueCents),
		Currency:    currency,
		Status:      models.DealStatusOpen,
		OwnerID:     &ctx.CreatedByID,
	}
	if ctx.Contact.CompanyID != nil {
		deal.CompanyID = ctx.Contact.CompanyID
	}
	if err := ctx.DB.Create(&deal).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: deal.ID.String(),
		Detail: "deal criado em " + funnel.Name + " · " + stage.Name}
}

// toolUpdateDealStage — move o deal aberto mais recente do contato pra
// novo estágio (por nome). Se cliente tem vários deals abertos, atualiza
// o mais recente — caller mais ambicioso fica pra futuro.
func toolUpdateDealStage(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Contact == nil {
		return AgentToolResult{OK: false, Detail: "contato não resolvido"}
	}
	stageName := strings.TrimSpace(asString(args["stage"]))
	if stageName == "" {
		return AgentToolResult{OK: false, Detail: "stage obrigatório"}
	}
	var deal models.Deal
	if err := ctx.DB.Where("contact_id = ? AND status = ?", ctx.Contact.ID, models.DealStatusOpen).
		Order("created_at DESC").First(&deal).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "nenhum deal aberto pra esse contato"}
	}
	var newStage models.FunnelStage
	if err := ctx.DB.Where("funnel_id = ? AND LOWER(name) = LOWER(?)", deal.FunnelID, stageName).
		First(&newStage).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "estágio '" + stageName + "' não existe no funil"}
	}
	now := time.Now()
	if err := ctx.DB.Model(&deal).Updates(map[string]any{
		"stage_id":        newStage.ID,
		"stage_change_at": &now,
	}).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: deal.ID.String(),
		Detail: "deal movido pra " + newStage.Name}
}

// toolSearchContact — busca contatos do workspace por nome/phone/email
// (substring case-insensitive). Devolve até 5 matches no Detail
// (formato "Nome · phone · id").
func toolSearchContact(ctx AgentToolContext, args map[string]any) AgentToolResult {
	q := strings.TrimSpace(asString(args["query"]))
	if q == "" {
		return AgentToolResult{OK: false, Detail: "query obrigatório"}
	}
	like := "%" + strings.ToLower(q) + "%"
	var contacts []models.Contact
	ctx.DB.Where("workspace_id = ?", ctx.WorkspaceID).
		Where("LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(email) LIKE ?", like, "%"+q+"%", like).
		Limit(5).
		Find(&contacts)
	if len(contacts) == 0 {
		return AgentToolResult{OK: true, Detail: "nenhum contato encontrado"}
	}
	var lines []string
	for _, c := range contacts {
		name := c.Name
		if name == "" {
			name = "(sem nome)"
		}
		lines = append(lines, name+" · "+c.Phone+" · "+c.ID.String())
	}
	return AgentToolResult{OK: true, Detail: strings.Join(lines, " | ")}
}

// ─── Sprint B: jornadas ──────────────────────────────────────────────────

// toolEnrollInJourney — inicia execução de jornada pra esse contato.
// Resolve por nome (case-insensitive). Não bloqueia se contato já tinha
// execução anterior — JourneyExecution.canReEnter trata isso.
func toolEnrollInJourney(ctx AgentToolContext, args map[string]any) AgentToolResult {
	if ctx.Contact == nil {
		return AgentToolResult{OK: false, Detail: "contato não resolvido"}
	}
	name := strings.TrimSpace(asString(args["journey"]))
	if name == "" {
		name = strings.TrimSpace(asString(args["name"]))
	}
	if name == "" {
		return AgentToolResult{OK: false, Detail: "journey (nome) obrigatório"}
	}
	var journey models.Journey
	if err := ctx.DB.Where("workspace_id = ? AND LOWER(name) = LOWER(?)", ctx.WorkspaceID, name).
		First(&journey).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "jornada '" + name + "' não encontrada"}
	}
	exec := models.JourneyExecution{
		ID:         uuid.New().String(),
		JourneyID:  journey.ID,
		InstanceID: ctx.Agent.InstanceID.String(),
		ContactJID: ctx.Contact.Phone + "@s.whatsapp.net",
		Status:     models.ExecutionActive,
		StartedAt:  time.Now(),
	}
	if err := ctx.DB.Create(&exec).Error; err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: exec.ID,
		Detail: "contato inscrito na jornada " + journey.Name}
}
