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
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
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
	// Sprint C — capacidades nativas da instância (WhatsApp + Instagram)
	case "send_image":
		return toolSendMedia(ctx, args, "image")
	case "send_video":
		return toolSendMedia(ctx, args, "video")
	case "send_audio":
		return toolSendMedia(ctx, args, "audio")
	case "send_document":
		return toolSendMedia(ctx, args, "document")
	case "send_location":
		return toolSendLocation(ctx, args)
	case "send_contact":
		return toolSendContact(ctx, args)
	case "send_pix":
		return toolSendPix(ctx, args)
	case "send_buttons":
		return toolSendButtons(ctx, args)
	case "send_poll":
		return toolSendPoll(ctx, args)
	case "react_to_last":
		return toolReactToLast(ctx, args)
	case "instagram_follow":
		return toolInstagramFollow(ctx, args)
	case "instagram_unfollow":
		return toolInstagramUnfollow(ctx, args)
	// Sprint D — Help Desk
	case "search_help_articles":
		return toolSearchHelpArticles(ctx, args)
	case "send_help_article":
		return toolSendHelpArticle(ctx, args)
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
	// Sprint C — capacidades nativas da instância
	"send_image":        `send_image({"url":"https://...","caption":"opcional"}) — envia imagem por URL.`,
	"send_video":        `send_video({"url":"https://...","caption":"opcional"}) — envia vídeo por URL.`,
	"send_audio":        `send_audio({"url":"https://...","ptt":true}) — envia áudio (ptt=true vira "voice note").`,
	"send_document":     `send_document({"url":"https://...","filename":"proposta.pdf"}) — envia PDF/doc.`,
	"send_location":     `send_location({"lat":-23.55,"lon":-46.63,"name":"Av Paulista 1000"}) — envia localização GPS.`,
	"send_contact":      `send_contact({"name":"Maria Vendas","phone":"5511999998888","email":"opcional"}) — envia vCard.`,
	"send_pix":          `send_pix({"merchant":"Empresa X","key":"55119...","key_type":"PHONE","title":"Pagamento","body":"Plano Pro mensal"}) — envia cobrança PIX interativa.`,
	"send_buttons":      `send_buttons({"body":"Como prefere?","buttons":["WhatsApp","Email","Ligação"]}) — envia mensagem com botões interativos.`,
	"send_poll":         `send_poll({"question":"Qual horário?","options":["Manhã","Tarde","Noite"],"multi":false}) — envia enquete.`,
	"react_to_last":     `react_to_last({"emoji":"👍"}) — reage à última mensagem inbound do cliente.`,
	"instagram_follow":  `instagram_follow({"username":"cliente_handle"}) — segue o usuário (instâncias Instagram).`,
	"instagram_unfollow": `instagram_unfollow({"username":"cliente_handle"}) — deixa de seguir.`,
	// Sprint D — Help Desk
	"search_help_articles": `search_help_articles({"query":"como cancelar plano"}) — busca artigos publicados no help desk; até 5 hits.`,
	"send_help_article":    `send_help_article({"slug":"como-cancelar-plano"}) — envia link/preview do artigo pra o cliente.`,
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

// ─── Sprint C: capacidades nativas da instância ──────────────────────────

// fetchURLAsBytes — baixa o asset apontado pela URL com timeout curto.
// Limita 25MB pra não estourar memória do server. Retorna bytes + content-type
// (útil pra send_*Message que pede mime).
func fetchURLAsBytes(rawURL string) ([]byte, string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, "", fmt.Errorf("url vazia")
	}
	httpC := &http.Client{Timeout: 25 * time.Second}
	resp, err := httpC.Get(rawURL)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("download falhou: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 25*1024*1024))
	if err != nil {
		return nil, "", err
	}
	mime := resp.Header.Get("Content-Type")
	return body, mime, nil
}

// resolveTargetJID — determina pra qual JID enviar. Default = contato
// atual da conversa. Permite override via args["to"].
func resolveTargetJID(ctx AgentToolContext, args map[string]any) string {
	if to := strings.TrimSpace(asString(args["to"])); to != "" {
		if !strings.Contains(to, "@") {
			return to + "@s.whatsapp.net"
		}
		return to
	}
	if ctx.Conversation != nil && ctx.Conversation.ChannelKey != "" {
		return ctx.Conversation.ChannelKey
	}
	if ctx.Contact != nil && ctx.Contact.Phone != "" {
		return ctx.Contact.Phone + "@s.whatsapp.net"
	}
	return ""
}

// toolSendMedia — handler unificado pra image/video/audio/document. Aceita
// `url` (obrigatório) + `caption`/`filename` conforme o tipo.
func toolSendMedia(ctx AgentToolContext, args map[string]any, kind string) AgentToolResult {
	if ctx.Agent == nil {
		return AgentToolResult{OK: false, Detail: "agent não resolvido"}
	}
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	url := strings.TrimSpace(asString(args["url"]))
	if url == "" {
		return AgentToolResult{OK: false, Detail: "url obrigatória"}
	}

	mgr := agentToolsGlobalManager()
	if mgr == nil {
		return AgentToolResult{OK: false, Detail: "manager indisponível"}
	}
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}

	data, mime, err := fetchURLAsBytes(url)
	if err != nil {
		return AgentToolResult{OK: false, Detail: "download: " + err.Error()}
	}

	caption := asString(args["caption"])
	switch kind {
	case "image":
		if mime == "" {
			mime = "image/jpeg"
		}
		id, err := client.SendImageMessage(to, data, mime, caption)
		if err != nil {
			return AgentToolResult{OK: false, Detail: err.Error()}
		}
		return AgentToolResult{OK: true, ID: id, Detail: "imagem enviada"}
	case "video":
		if mime == "" {
			mime = "video/mp4"
		}
		id, err := client.SendVideoMessage(to, data, mime, caption)
		if err != nil {
			return AgentToolResult{OK: false, Detail: err.Error()}
		}
		return AgentToolResult{OK: true, ID: id, Detail: "vídeo enviado"}
	case "audio":
		if mime == "" {
			mime = "audio/ogg"
		}
		ptt := false
		if v, ok := args["ptt"].(bool); ok {
			ptt = v
		}
		id, err := client.SendAudioMessage(to, data, mime, ptt, 0)
		if err != nil {
			return AgentToolResult{OK: false, Detail: err.Error()}
		}
		return AgentToolResult{OK: true, ID: id, Detail: "áudio enviado"}
	case "document":
		if mime == "" {
			mime = "application/octet-stream"
		}
		filename := strings.TrimSpace(asString(args["filename"]))
		if filename == "" {
			filename = "documento"
		}
		id, err := client.SendDocumentMessage(to, data, mime, filename)
		if err != nil {
			return AgentToolResult{OK: false, Detail: err.Error()}
		}
		return AgentToolResult{OK: true, ID: id, Detail: "documento enviado: " + filename}
	}
	return AgentToolResult{OK: false, Detail: "kind inválido"}
}

func toolSendLocation(ctx AgentToolContext, args map[string]any) AgentToolResult {
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	lat, latOK := asFloat(args["lat"])
	lon, lonOK := asFloat(args["lon"])
	if !latOK || !lonOK {
		return AgentToolResult{OK: false, Detail: "lat e lon obrigatórios"}
	}
	mgr := agentToolsGlobalManager()
	if mgr == nil {
		return AgentToolResult{OK: false, Detail: "manager indisponível"}
	}
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	id, err := client.SendLocationMessage(to, lat, lon, asString(args["name"]))
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "localização enviada"}
}

func toolSendContact(ctx AgentToolContext, args map[string]any) AgentToolResult {
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	name := strings.TrimSpace(asString(args["name"]))
	phone := strings.TrimSpace(asString(args["phone"]))
	if name == "" || phone == "" {
		return AgentToolResult{OK: false, Detail: "name e phone obrigatórios"}
	}
	email := strings.TrimSpace(asString(args["email"]))
	// vCard 3.0 mínimo (whatsmeow aceita o blob completo).
	vcard := "BEGIN:VCARD\nVERSION:3.0\nFN:" + name + "\nTEL;type=CELL;waid=" + phone + ":" + phone + "\n"
	if email != "" {
		vcard += "EMAIL:" + email + "\n"
	}
	vcard += "END:VCARD"
	mgr := agentToolsGlobalManager()
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	id, err := client.SendContactMessage(to, name, vcard)
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "contato enviado: " + name}
}

func toolSendPix(ctx AgentToolContext, args map[string]any) AgentToolResult {
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	mgr := agentToolsGlobalManager()
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	data := whatsappPixDataFromArgs(args)
	if data.MerchantName == "" || data.PixKey == "" {
		return AgentToolResult{OK: false, Detail: "merchant e key obrigatórios"}
	}
	id, err := client.SendPixMessage(to, data)
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "PIX enviado pra " + data.MerchantName}
}

func toolSendButtons(ctx AgentToolContext, args map[string]any) AgentToolResult {
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	body := strings.TrimSpace(asString(args["body"]))
	if body == "" {
		return AgentToolResult{OK: false, Detail: "body obrigatório"}
	}
	rawButtons, ok := args["buttons"].([]any)
	if !ok || len(rawButtons) == 0 {
		return AgentToolResult{OK: false, Detail: "buttons (lista) obrigatório"}
	}
	if len(rawButtons) > 3 {
		return AgentToolResult{OK: false, Detail: "máximo 3 botões"}
	}
	var buttons []whatsappButtonItem
	for i, b := range rawButtons {
		text := strings.TrimSpace(asString(b))
		if text == "" {
			continue
		}
		buttons = append(buttons, whatsappButtonItem{
			ID:   fmt.Sprintf("btn_%d", i+1),
			Text: text,
		})
	}
	if len(buttons) == 0 {
		return AgentToolResult{OK: false, Detail: "nenhum botão válido"}
	}
	mgr := agentToolsGlobalManager()
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	id, err := whatsappCallSendButtons(client, to, body, asString(args["footer"]), buttons)
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "botões enviados"}
}

func toolSendPoll(ctx AgentToolContext, args map[string]any) AgentToolResult {
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	question := strings.TrimSpace(asString(args["question"]))
	if question == "" {
		return AgentToolResult{OK: false, Detail: "question obrigatório"}
	}
	rawOpts, ok := args["options"].([]any)
	if !ok || len(rawOpts) < 2 {
		return AgentToolResult{OK: false, Detail: "options (mín 2) obrigatório"}
	}
	options := make([]string, 0, len(rawOpts))
	for _, o := range rawOpts {
		s := strings.TrimSpace(asString(o))
		if s != "" {
			options = append(options, s)
		}
	}
	if len(options) < 2 {
		return AgentToolResult{OK: false, Detail: "opções válidas insuficientes"}
	}
	selectable := 1
	if v, ok := args["multi"].(bool); ok && v {
		selectable = 0 // 0 = múltiplas escolhas no whatsmeow
	}
	mgr := agentToolsGlobalManager()
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	id, err := client.SendPollMessage(to, question, options, selectable)
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "enquete enviada"}
}

// toolReactToLast — reage à última mensagem inbound do contato com o
// emoji passado. Sem msg_id explícito, busca a última do MessageLog.
func toolReactToLast(ctx AgentToolContext, args map[string]any) AgentToolResult {
	emoji := strings.TrimSpace(asString(args["emoji"]))
	if emoji == "" {
		return AgentToolResult{OK: false, Detail: "emoji obrigatório"}
	}
	if ctx.Conversation == nil {
		return AgentToolResult{OK: false, Detail: "conversa não resolvida"}
	}
	var lastMsg models.MessageLog
	if err := ctx.DB.Where("conversation_id = ? AND direction = ?", ctx.Conversation.ID, models.DirectionIn).
		Order("created_at DESC").First(&lastMsg).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "nenhuma msg inbound encontrada"}
	}
	to := resolveTargetJID(ctx, args)
	mgr := agentToolsGlobalManager()
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	id, err := client.SendReaction(to, lastMsg.ExternalMessageID, lastMsg.SenderJID, emoji)
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "reação " + emoji + " enviada"}
}

func toolInstagramFollow(ctx AgentToolContext, args map[string]any) AgentToolResult {
	username := strings.TrimSpace(asString(args["username"]))
	if username == "" && ctx.Contact != nil {
		username = ctx.Contact.ExternalID
	}
	if username == "" {
		return AgentToolResult{OK: false, Detail: "username obrigatório"}
	}
	if err := agentToolsInstagramFollow(ctx.DB, ctx.Agent.InstanceID.String(), username); err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, Detail: "agora seguindo @" + username}
}

func toolInstagramUnfollow(ctx AgentToolContext, args map[string]any) AgentToolResult {
	username := strings.TrimSpace(asString(args["username"]))
	if username == "" && ctx.Contact != nil {
		username = ctx.Contact.ExternalID
	}
	if username == "" {
		return AgentToolResult{OK: false, Detail: "username obrigatório"}
	}
	if err := agentToolsInstagramUnfollow(ctx.DB, ctx.Agent.InstanceID.String(), username); err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, Detail: "deixou de seguir @" + username}
}

// ─── Sprint D: Help Desk ─────────────────────────────────────────────────

// toolSearchHelpArticles — busca artigos publicados do workspace por
// title/summary/content (substring case-insensitive). Devolve até 5
// matches em formato "Título · /help/<slug>" pra o LLM mencionar.
func toolSearchHelpArticles(ctx AgentToolContext, args map[string]any) AgentToolResult {
	q := strings.TrimSpace(asString(args["query"]))
	if q == "" {
		return AgentToolResult{OK: false, Detail: "query obrigatório"}
	}
	like := "%" + strings.ToLower(q) + "%"
	var articles []models.HelpDeskArticle
	ctx.DB.Where("workspace_id = ? AND status = ?", ctx.WorkspaceID, models.ArticlePublished).
		Where("LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(content) LIKE ?", like, like, like).
		Order("view_count DESC").
		Limit(5).
		Find(&articles)
	if len(articles) == 0 {
		return AgentToolResult{OK: true, Detail: "nenhum artigo encontrado"}
	}
	var lines []string
	for _, a := range articles {
		lines = append(lines, a.Title+" · slug="+a.Slug)
	}
	return AgentToolResult{OK: true, Detail: strings.Join(lines, " | ")}
}

// toolSendHelpArticle — envia uma mensagem com link/preview do artigo.
// Resolve por slug. URL final usa frontend_url/help/<slug>.
func toolSendHelpArticle(ctx AgentToolContext, args map[string]any) AgentToolResult {
	slug := strings.TrimSpace(asString(args["slug"]))
	if slug == "" {
		return AgentToolResult{OK: false, Detail: "slug obrigatório"}
	}
	var article models.HelpDeskArticle
	if err := ctx.DB.Where("workspace_id = ? AND slug = ? AND status = ?",
		ctx.WorkspaceID, slug, models.ArticlePublished).First(&article).Error; err != nil {
		return AgentToolResult{OK: false, Detail: "artigo não encontrado: " + slug}
	}
	to := resolveTargetJID(ctx, args)
	if to == "" {
		return AgentToolResult{OK: false, Detail: "destinatário não resolvido"}
	}
	mgr := agentToolsGlobalManager()
	client := mgr.GetInstance(ctx.Agent.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return AgentToolResult{OK: false, Detail: "instância desconectada"}
	}
	frontendURL := strings.TrimRight(agentToolsFrontendURL(), "/")
	link := frontendURL + "/help/" + slug
	body := article.Title
	if article.Summary != "" {
		body += "\n\n" + article.Summary
	}
	body += "\n\n👉 " + link
	id, err := client.SendTextMessage(to, body)
	if err != nil {
		return AgentToolResult{OK: false, Detail: err.Error()}
	}
	return AgentToolResult{OK: true, ID: id, Detail: "artigo enviado: " + article.Title}
}

// ─── Helpers compartilhados das tools de instância ──────────────────────

// asFloat — extrai float64 de json (json decodifica numbers como float64).
func asFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case string:
		var f float64
		if _, err := fmt.Sscanf(x, "%f", &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

// agentToolsGlobalManager — accessor pro singleton do whatsapp.Manager
// usado nas tools de instância. Isolado em função pra facilitar mock em
// testes futuros.
func agentToolsGlobalManager() *whatsapp.Manager {
	return whatsapp.GlobalManager
}

// whatsappButtonItem — alias local pro whatsapp.ButtonItem pra evitar
// import circular do agent_tools (que já importa whatsapp). Usado só
// no toolSendButtons.
type whatsappButtonItem = whatsapp.ButtonItem

// whatsappCallSendButtons — wrapper pra SendButtonsMessage com a
// assinatura simplificada que as tools consomem.
func whatsappCallSendButtons(client *whatsapp.InstanceClient, to, body, footer string, buttons []whatsappButtonItem) (string, error) {
	return client.SendButtonsMessage(to, body, footer, buttons)
}

// whatsappPixDataFromArgs — converte map[string]any pro PixData esperado
// por SendPixMessage. KeyType é case-insensitive; default vazio cai no
// validador interno do whatsmeow.
func whatsappPixDataFromArgs(args map[string]any) whatsapp.PixData {
	return whatsapp.PixData{
		HeaderTitle:  asString(args["title"]),
		BodyText:     asString(args["body"]),
		FooterText:   asString(args["footer"]),
		MerchantName: strings.TrimSpace(asString(args["merchant"])),
		PixKey:       strings.TrimSpace(asString(args["key"])),
		KeyType:      strings.ToUpper(strings.TrimSpace(asString(args["key_type"]))),
	}
}

// agentToolsInstagramFollow — chama Taktik via InstagramService.
// O DB vem do AgentToolContext (passado pelo runtime).
func agentToolsInstagramFollow(db *gorm.DB, instanceID, username string) error {
	svc := NewInstagramService(db)
	if svc == nil {
		return fmt.Errorf("integração Instagram não configurada (set TAKTIK_BASE_URL)")
	}
	return svc.Follow(context.Background(), instanceID, username)
}

func agentToolsInstagramUnfollow(db *gorm.DB, instanceID, username string) error {
	svc := NewInstagramService(db)
	if svc == nil {
		return fmt.Errorf("integração Instagram não configurada (set TAKTIK_BASE_URL)")
	}
	return svc.Unfollow(context.Background(), instanceID, username)
}

func agentToolsFrontendURL() string {
	if config.AppConfig != nil && strings.TrimSpace(config.AppConfig.FrontendURL) != "" {
		return config.AppConfig.FrontendURL
	}
	return "https://app.uniq.chat"
}
