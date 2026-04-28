package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/senders"
	"github.com/uniq-chat/backend/internal/services/template"
	"gorm.io/gorm"
)

// Re-exports dos tipos de senders para compatibilidade do código chamador
type MessageSender = senders.MessageSender
type Button = senders.Button
type ListSection = senders.ListSection
type ListRow = senders.ListRow

// SimulationEvent representa uma ação que aconteceria (usado em modo simulação)
type SimulationEvent struct {
	StepID    string                 `json:"step_id"`
	StepType  string                 `json:"step_type"`
	Action    string                 `json:"action"` // send_text, wait, http_call, etc.
	Payload   map[string]interface{} `json:"payload"`
	Timestamp time.Time              `json:"timestamp"`
}

// JourneyExecutor é o motor de execução multi-step
type JourneyExecutor struct {
	db     *gorm.DB
	sender MessageSender
	llm    *LLMService
	// MaxSteps limita o total de steps executados por execução. Flows
	// normais têm 3-10 steps; se estamos passando disso algo está
	// errado (ciclo, build defeituoso do LLM, etc).
	MaxSteps int
	// MaxStepVisits cap por step ID — mesmo em flows com goto
	// legítimo, re-entrar no mesmo step mais que isso é ciclo.
	MaxStepVisits int

	// Dedup de mensagens: whatsmeow re-emite o mesmo *events.Message em
	// history-sync/reconexão. Sem dedup cada re-emissão dispara as
	// jornadas de novo, gerando loop de envio. Guardamos os últimos
	// IDs vistos por `dedupWindow` e ignoramos repetidos.
	dedupMu     sync.Mutex
	seenMsgs    map[string]time.Time
	dedupWindow time.Duration
}

func NewJourneyExecutor(db *gorm.DB, sender MessageSender, llm *LLMService) *JourneyExecutor {
	return &JourneyExecutor{
		db:            db,
		sender:        sender,
		llm:           llm,
		MaxSteps:      20,
		MaxStepVisits: 3,
		seenMsgs:      make(map[string]time.Time),
		dedupWindow:   5 * time.Minute,
	}
}

// seenRecently retorna true se o (instanceID, messageID) foi processado nos
// últimos `dedupWindow`. Atualiza o cache e faz GC oportunista de entradas
// expiradas.
func (e *JourneyExecutor) seenRecently(instanceID, messageID string) bool {
	if messageID == "" {
		return false // sem ID não dá pra deduplicar — deixa passar
	}
	key := instanceID + "|" + messageID
	now := time.Now()
	e.dedupMu.Lock()
	defer e.dedupMu.Unlock()
	if e.seenMsgs == nil {
		e.seenMsgs = make(map[string]time.Time)
	}
	// GC oportunista: se o mapa está grande, limpa entradas velhas.
	if len(e.seenMsgs) > 1024 {
		for k, t := range e.seenMsgs {
			if now.Sub(t) > e.dedupWindow {
				delete(e.seenMsgs, k)
			}
		}
	}
	if t, ok := e.seenMsgs[key]; ok && now.Sub(t) < e.dedupWindow {
		return true
	}
	e.seenMsgs[key] = now
	return false
}

// firstN retorna no máximo n runes do começo da string — útil em logs
// pra não imprimir mensagens enormes quebrando o JSON no logger.
func firstN(s string, n int) string {
	if n <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// triggerMatchReason: espelha ShouldTrigger mas RETORNA A RAZÃO do não-match
// em string (ou "" quando match). Usado só pra logs diagnósticos; o
// ShouldTrigger original continua sendo a fonte de verdade.
func triggerMatchReason(j *models.Journey, messageText, groupJID, messageType string, isGroup bool) string {
	if j.Status != "active" {
		return "journey_status_not_active:" + j.Status
	}
	isGroupTrigger := strings.Contains(j.TriggerType, "group_")
	if isGroupTrigger && !isGroup {
		return "trigger_exige_grupo_mas_msg_nao_eh_de_grupo"
	}
	isPrivateTrigger := j.TriggerType == "private_message" || j.TriggerType == "private_keyword"
	if isPrivateTrigger && isGroup {
		return "trigger_exige_privado_mas_msg_eh_de_grupo"
	}
	if j.GroupJID != "" && j.GroupJID != groupJID {
		return fmt.Sprintf("group_jid_diff:esperado=%s recebido=%s", j.GroupJID, groupJID)
	}
	switch models.TriggerType(j.TriggerType) {
	case models.TriggerContactVideo:
		if messageType != "video" {
			return "msg_type_nao_eh_video:" + messageType
		}
	case models.TriggerContactAudio:
		if messageType != "audio" {
			return "msg_type_nao_eh_audio:" + messageType
		}
	case models.TriggerContactDocument:
		if messageType != "document" {
			return "msg_type_nao_eh_document:" + messageType
		}
	case models.TriggerContactImage:
		if messageType != "image" {
			return "msg_type_nao_eh_image:" + messageType
		}
	case models.TriggerContactLocation:
		if messageType != "location" {
			return "msg_type_nao_eh_location:" + messageType
		}
	case models.TriggerContactCall:
		if messageType != "call" {
			return "msg_type_nao_eh_call:" + messageType
		}
	}
	// Keywords: se não há, passa. Usa GetKeywordRules pra respeitar o
	// operador de cada palavra (equal/contains/starts_with/etc).
	rules := j.GetKeywordRules()
	if len(rules) == 0 {
		return ""
	}
	lowerMsg := strings.ToLower(messageText)
	for _, r := range rules {
		if evalKeywordRuleLocal(lowerMsg, r) {
			return ""
		}
	}
	// Monta lista pra diagnóstico
	parts := make([]string, 0, len(rules))
	for _, r := range rules {
		op := r.Op
		if op == "" {
			op = "contains"
		}
		parts = append(parts, op+":"+r.Word)
	}
	return "nenhuma_keyword_bateu:" + strings.Join(parts, ",")
}

// evalKeywordRuleLocal é um espelho de models.evalKeywordRule — duplicado
// aqui pra o triggerMatchReason (diagnóstico) não depender de detalhes
// internos do pacote de models. Mudanças no operador precisam ser feitas
// nos dois lugares.
func evalKeywordRuleLocal(lowerMsg string, r models.KeywordRule) bool {
	word := strings.ToLower(strings.TrimSpace(r.Word))
	op := strings.ToLower(strings.TrimSpace(r.Op))
	if op == "" {
		op = "contains"
	}
	switch op {
	case "equal":
		return lowerMsg == word
	case "not_equal":
		return lowerMsg != word
	case "contains":
		return word != "" && strings.Contains(lowerMsg, word)
	case "not_contains":
		return word != "" && !strings.Contains(lowerMsg, word)
	case "starts_with":
		return word != "" && strings.HasPrefix(lowerMsg, word)
	case "not_starts_with":
		return word != "" && !strings.HasPrefix(lowerMsg, word)
	case "ends_with":
		return word != "" && strings.HasSuffix(lowerMsg, word)
	case "not_ends_with":
		return word != "" && !strings.HasSuffix(lowerMsg, word)
	default:
		return word != "" && strings.Contains(lowerMsg, word)
	}
}

// sanitizeFlowForExec zera ponteiros next/branch que criam self-loop ou
// apontam pra steps inexistentes. Não reorganiza o flow — só evita que
// o executor entre em ciclo óbvio. O FlowBuilder (journey_flow_builder.go)
// faz essa mesma normalização em novas gerações; aqui é defesa extra
// pra jornadas antigas salvas com flow quebrado.
func sanitizeFlowForExec(f *models.JourneyFlow) {
	if f == nil {
		return
	}
	seen := make(map[string]bool, len(f.Steps))
	for i := range f.Steps {
		seen[f.Steps[i].ID] = true
	}
	for i := range f.Steps {
		s := &f.Steps[i]
		if s.NextStepID == s.ID || (s.NextStepID != "" && !seen[s.NextStepID]) {
			s.NextStepID = ""
		}
		if s.BranchTrue == s.ID || (s.BranchTrue != "" && !seen[s.BranchTrue]) {
			s.BranchTrue = ""
		}
		if s.BranchFalse == s.ID || (s.BranchFalse != "" && !seen[s.BranchFalse]) {
			s.BranchFalse = ""
		}
	}
}

// isJourneyActive confere no banco se a jornada continua ativa. Pausas feitas
// pelo usuário depois que o goroutine começou devem interromper o envio.
func (e *JourneyExecutor) isJourneyActive(journeyID string) bool {
	var row struct {
		Status string
	}
	if err := e.db.Table("journeys").Select("status").Where("id = ?", journeyID).Scan(&row).Error; err != nil {
		return false
	}
	return row.Status == "active"
}

// execCtx é o contexto mutável de uma execução em andamento
type execCtx struct {
	journey    *models.Journey
	execution  *models.JourneyExecution
	flow       *models.JourneyFlow
	vars       *models.ExecutionVars
	fromJID    string
	fromName   string
	groupJID   string
	instanceID string
	inboundMsg string
	simulate   bool
	sim        []SimulationEvent
	stepsRun   int
}

func (e *execCtx) emit(stepID, stepType, action string, payload map[string]interface{}) {
	if !e.simulate {
		return
	}
	e.sim = append(e.sim, SimulationEvent{
		StepID: stepID, StepType: stepType, Action: action,
		Payload: payload, Timestamp: time.Now(),
	})
}

// HandleIncoming recebe mensagem do WhatsApp e decide se inicia/retoma jornada.
// Retorna true se a mensagem foi "consumida" por uma jornada.
//
// messageID é o ID único da mensagem WhatsApp. Usamos pra deduplicar eventos
// duplicados em history-sync/reconexão (sem isso o whatsmeow re-emite o
// mesmo *events.Message e cada re-emissão dispara a jornada → loop).
func (e *JourneyExecutor) HandleIncoming(instanceID, messageID, fromJID, fromName, groupJID, messageText, messageType string, isGroup bool) bool {
	// 0. Dedup: se já processamos esse ID recentemente, ignora. Protege
	//    contra re-emissão de eventos em reconexão/history-sync.
	if e.seenRecently(instanceID, messageID) {
		log.Debug().Str("instance", instanceID).Str("msg", messageID).Msg("journey: dedup — mensagem já processada")
		return false
	}

	// 1. Comando reservado: sempre prioritário
	if cmd := models.IsReservedCommand(messageText); cmd != "" {
		return e.handleReservedCommand(cmd, instanceID, fromJID, fromName)
	}

	// 2. Tem execução ativa aguardando input desse contato?
	var active models.JourneyExecution
	err := e.db.Where(
		"instance_id = ? AND contact_jid = ? AND status IN (?, ?)",
		instanceID, fromJID,
		models.ExecutionActive, "waiting_input",
	).Order("started_at DESC").First(&active).Error

	if err == nil && string(active.Status) == "waiting_input" {
		// Retoma jornada aguardando input
		var journey models.Journey
		if e.db.Where("id = ?", active.JourneyID).First(&journey).Error == nil {
			e.resumeWithInput(&journey, &active, messageText)
			return true
		}
	}

	// 3. Buscar jornadas aplicáveis
	var journeys []models.Journey
	if err := e.db.Where("instance_id = ? AND status = 'active'", instanceID).Find(&journeys).Error; err != nil {
		return false
	}

	// Sem jornadas ativas → early return SEM log. Antes logávamos sempre
	// pra debug "por que a jornada não disparou", mas isso polui o log
	// em instâncias que não usam jornadas (1 linha por mensagem inbound).
	if len(journeys) == 0 {
		return false
	}

	// Com jornadas ativas, log Info pra diagnosticar match/no-match.
	log.Info().
		Str("instance", instanceID).
		Str("from", fromJID).
		Str("group", groupJID).
		Bool("is_group", isGroup).
		Str("msg_type", messageType).
		Int("text_len", len(messageText)).
		Int("active_journeys", len(journeys)).
		Str("msg_preview", firstN(messageText, 40)).
		Msg("journey: avaliando trigger")

	triggered := false
	for i := range journeys {
		j := &journeys[i]
		reason := triggerMatchReason(j, messageText, groupJID, messageType, isGroup)
		if reason != "" {
			log.Info().
				Str("journey", j.ID).
				Str("name", j.Name).
				Str("trigger_type", j.TriggerType).
				Str("journey_group_jid", j.GroupJID).
				Str("journey_keywords", j.Keywords).
				Str("skipped_because", reason).
				Msg("journey: trigger NÃO bateu — ver campo skipped_because")
			continue
		}
		log.Info().
			Str("journey", j.ID).
			Str("name", j.Name).
			Str("trigger_type", j.TriggerType).
			Str("from", fromJID).
			Msg("journey: trigger bateu — iniciando execução")
		triggered = true
		go e.startNew(j, fromJID, fromName, groupJID, messageText)
	}
	return triggered
}

func (e *JourneyExecutor) handleReservedCommand(action, instanceID, fromJID, fromName string) bool {
	switch action {
	case "cancel_execution":
		now := time.Now()
		e.db.Model(&models.JourneyExecution{}).
			Where("instance_id = ? AND contact_jid = ? AND status IN (?, ?)",
				instanceID, fromJID, models.ExecutionActive, "waiting_input").
			Updates(map[string]interface{}{
				"status":       models.ExecutionPaused,
				"completed_at": now,
				"updated_at":   now,
			})
		_ = e.sender.SendText(instanceID, fromJID, "Conversa encerrada. Digite /menu para recomeçar.")
		return true
	case "restart_flow":
		// Cancela execução atual
		now := time.Now()
		e.db.Model(&models.JourneyExecution{}).
			Where("instance_id = ? AND contact_jid = ? AND status IN (?, ?)",
				instanceID, fromJID, models.ExecutionActive, "waiting_input").
			Updates(map[string]interface{}{
				"status":       models.ExecutionCompleted,
				"completed_at": now,
				"updated_at":   now,
			})
		_ = e.sender.SendText(instanceID, fromJID, "Fluxo reiniciado. Envie sua mensagem para começar.")
		return true
	case "show_help":
		help := "Comandos disponíveis:\n" +
			"/menu - reiniciar o fluxo\n" +
			"/stop - encerrar conversa\n" +
			"/ajuda - exibir esta mensagem"
		_ = e.sender.SendText(instanceID, fromJID, help)
		return true
	}
	return false
}

// isSendStepType retorna true se o tipo de step produz mensagem outbound.
func isSendStepType(t models.StepType) bool {
	switch t {
	case models.StepTypeMessage,
		models.StepTypeButtons,
		models.StepTypeList,
		models.StepTypeMedia,
		models.StepTypeAIResponse,
		models.StepTypeHandoff:
		return true
	}
	return false
}

// reachableSendStepFromStart faz BFS do start_step seguindo next_step_id +
// BranchTrue + BranchFalse e retorna true se QUALQUER step de envio é
// alcançável. Diferente do flowHasSendStep, que só checava presença, esse
// cobre o caso "flow tem send step mas condition no início não leva a ele"
// — LLM às vezes gera branches vazios que fazem a execução morrer no
// primeiro step sem nunca atingir o send.
func reachableSendStepFromStart(f *models.JourneyFlow) bool {
	if f == nil || len(f.Steps) == 0 {
		return false
	}
	stepByID := make(map[string]*models.FlowStep, len(f.Steps))
	for i := range f.Steps {
		stepByID[f.Steps[i].ID] = &f.Steps[i]
	}
	startID := f.StartStep
	if startID == "" {
		// usa o primeiro step marcado IsStartStep, ou o primeiro do array
		for i := range f.Steps {
			if f.Steps[i].IsStartStep {
				startID = f.Steps[i].ID
				break
			}
		}
		if startID == "" && len(f.Steps) > 0 {
			startID = f.Steps[0].ID
		}
	}
	visited := make(map[string]bool, len(f.Steps))
	queue := []string{startID}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if id == "" || visited[id] {
			continue
		}
		visited[id] = true
		s := stepByID[id]
		if s == nil {
			continue
		}
		if isSendStepType(s.Type) {
			return true
		}
		// Enfileira todos os próximos possíveis
		if s.NextStepID != "" {
			queue = append(queue, s.NextStepID)
		}
		if s.BranchTrue != "" {
			queue = append(queue, s.BranchTrue)
		}
		if s.BranchFalse != "" {
			queue = append(queue, s.BranchFalse)
		}
	}
	return false
}

// upsertContactForJourney garante que existe um Contact no CRM pra esse
// fromJID e marca a jornada ativa em contact.Journey. Usa o nome atual
// da jornada — renames propagam via cascade em UpdateTrigger.
// Não bloqueia a execução: qualquer erro é só logado.
func (e *JourneyExecutor) upsertContactForJourney(journey *models.Journey, fromJID, fromName string) {
	if e.db == nil || fromJID == "" {
		return
	}
	// Ignora grupos: fromJID no executor é sempre o remetente individual.
	// Mas preservamos a checagem pra @lid e formatos estranhos.
	if strings.HasSuffix(fromJID, "@g.us") || strings.HasSuffix(fromJID, "@newsletter") || strings.Contains(fromJID, "-") {
		return
	}
	// Extrai o telefone cru (parte antes do @)
	phone := fromJID
	if idx := strings.Index(phone, "@"); idx > 0 {
		phone = phone[:idx]
	}
	if phone == "" {
		return
	}
	userUUID, err := uuid.Parse(journey.UserID)
	if err != nil {
		return
	}

	// Busca contato existente pelo phone do usuário dono da jornada.
	var contact models.Contact
	err = e.db.Where("user_id = ? AND phone LIKE ?", userUUID, "%"+phone+"%").First(&contact).Error
	if err == nil {
		// Já existe — atualiza apenas journey se mudou.
		if contact.Journey != journey.Name {
			e.db.Model(&contact).Update("journey", journey.Name)
			log.Info().Str("contact", contact.ID.String()).Str("journey", journey.Name).
				Msg("journey → crm: contato atualizado com nova jornada")
		}
		return
	}

	// Cria novo contato. Nome = fromName (push name) ou o phone.
	name := strings.TrimSpace(fromName)
	if name == "" || name == "Cliente" {
		name = phone
	}
	newContact := models.Contact{
		ID:      uuid.New(),
		UserID:  userUUID,
		Name:    name,
		Phone:   phone,
		Journey: journey.Name,
		Source:  models.SourceWhatsApp,
	}
	// workspace: herda da instância
	var inst models.Instance
	if e.db.Where("id = ?", journey.InstanceID).First(&inst).Error == nil && inst.WorkspaceID != nil {
		newContact.WorkspaceID = inst.WorkspaceID
	}
	if err := e.db.Create(&newContact).Error; err != nil {
		log.Warn().Err(err).Str("phone", phone).Msg("journey → crm: falha ao criar contato")
		return
	}
	log.Info().
		Str("contact", newContact.ID.String()).
		Str("phone", phone).
		Str("journey", journey.Name).
		Msg("journey → crm: contato criado automaticamente pela jornada")
}

// startNew inicia uma nova execução de jornada
func (e *JourneyExecutor) startNew(journey *models.Journey, fromJID, fromName, groupJID, messageText string) {
	// Recover pra evitar que panic num step (config inválida, etc) deixe
	// o goroutine morrendo sem log. Loga o panic como erro pra
	// diagnosticarmos qualquer crash silencioso.
	defer func() {
		if r := recover(); r != nil {
			log.Error().
				Str("journey", journey.ID).
				Interface("panic", r).
				Msg("journey: PANIC em startNew — execução abortada")
		}
	}()

	// Integra jornada ↔ CRM: cria/atualiza Contact pra todo usuário que
	// entra numa jornada. Best-effort (não bloqueia execução).
	e.upsertContactForJourney(journey, fromJID, fromName)

	flow := journey.GetFlow()
	flowSteps := 0
	if flow != nil {
		flowSteps = len(flow.Steps)
	}
	log.Info().
		Str("journey", journey.ID).
		Str("name", journey.Name).
		Bool("flow_nil", flow == nil).
		Int("flow_steps", flowSteps).
		Bool("has_reachable_send", reachableSendStepFromStart(flow)).
		Int("msg_template_len", len(journey.MessageTemplate)).
		Str("response_mode", journey.ResponseMode).
		Str("from_jid", fromJID).
		Str("group_jid", groupJID).
		Msg("journey: startNew iniciado")

	if flow == nil || len(flow.Steps) == 0 {
		log.Info().Str("journey", journey.ID).Msg("journey: flow vazio/nulo → legacyFallback")
		e.legacyFallback(journey, fromJID, fromName, groupJID, messageText)
		return
	}
	// Rede de segurança: se o flow salvo não tem NENHUM step de envio
	// (caso comum de FlowBuilder gerando só "end" ou step desconhecido
	// que não dispara SendText), e mesmo assim temos messageTemplate
	// definido, preferimos o legacyFallback — pelo menos o DM sai.
	if !reachableSendStepFromStart(flow) && strings.TrimSpace(journey.MessageTemplate) != "" {
		log.Info().
			Str("journey", journey.ID).
			Int("steps", len(flow.Steps)).
			Str("start_step", flow.StartStep).
			Msg("journey: nenhum step de envio alcançável a partir do start + messageTemplate presente → legacyFallback")
		e.legacyFallback(journey, fromJID, fromName, groupJID, messageText)
		return
	}
	// Heurística anti-condition-sem-sentido: LLM às vezes gera flow com
	// condition como primeiro step testando algo bobo (ex: last_input
	// contains "Palavra-chave"), cujos branches mandam o fluxo pra lugar
	// nenhum quando a condition dá false. Se temos um messageTemplate
	// explícito (user marcou /ação), o flow de condition é um erro de
	// interpretação da LLM e preferimos o caminho simples legacyFallback.
	if first := flow.FirstStep(); first != nil && first.Type == models.StepTypeCondition &&
		strings.TrimSpace(journey.MessageTemplate) != "" {
		log.Info().
			Str("journey", journey.ID).
			Str("first_step_type", string(first.Type)).
			Msg("journey: flow começa com condition + messageTemplate presente (provável alucinação da LLM) → legacyFallback")
		e.legacyFallback(journey, fromJID, fromName, groupJID, messageText)
		return
	}
	// Sanitiza flow em runtime — jornadas antigas podem ter sido salvas
	// com self-loops (next_step_id == id do próprio step) ou refs pra
	// steps inexistentes. Isso é o que causava "manda 50x a mesma msg".
	sanitizeFlowForExec(flow)

	start := flow.FirstStep()
	if start == nil {
		log.Warn().
			Str("journey", journey.ID).
			Str("start_step_id", flow.StartStep).
			Msg("journey: flow.FirstStep() retornou nil — nada a executar")
		// Se temos messageTemplate, ao menos cai no fallback pra enviar
		if strings.TrimSpace(journey.MessageTemplate) != "" {
			e.legacyFallback(journey, fromJID, fromName, groupJID, messageText)
		}
		return
	}
	log.Info().
		Str("journey", journey.ID).
		Str("start_step", start.ID).
		Str("start_type", string(start.Type)).
		Msg("journey: entrando no run — primeiro step identificado")

	vars := &models.ExecutionVars{
		Contact: map[string]interface{}{
			"name":  fromName,
			"jid":   fromJID,
			"phone": strings.Split(fromJID, "@")[0],
		},
		Flow:      map[string]interface{}{},
		LastInput: messageText,
	}

	execution := &models.JourneyExecution{
		ID:          uuid.New().String(),
		JourneyID:   journey.ID,
		InstanceID:  journey.InstanceID,
		ContactJID:  fromJID,
		ContactName: fromName,
		GroupJID:    groupJID,
		Status:      models.ExecutionActive,
		CurrentStep: start.ID,
		StepIndex:   0,
		TotalSteps:  len(flow.Steps),
		StartedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	e.saveVars(execution, vars)
	execution.AddMessage("inbound", messageText, "trigger")
	e.db.Create(execution)

	ctx := &execCtx{
		journey:    journey,
		execution:  execution,
		flow:       flow,
		vars:       vars,
		fromJID:    fromJID,
		fromName:   fromName,
		groupJID:   groupJID,
		instanceID: journey.InstanceID,
		inboundMsg: messageText,
	}

	e.run(ctx, start)
}

// resumeWithInput retoma execução que aguardava input do usuário
func (e *JourneyExecutor) resumeWithInput(journey *models.Journey, execution *models.JourneyExecution, inputText string) {
	flow := journey.GetFlow()
	if flow == nil {
		return
	}

	vars := e.loadVars(execution)
	vars.LastInput = inputText

	// O step que estava aguardando
	waitingStepID := vars.WaitingStep
	if waitingStepID == "" {
		waitingStepID = execution.CurrentStep
	}
	vars.WaitingStep = ""

	// Step que estava capturando input
	current := flow.FindStep(waitingStepID)
	if current == nil {
		return
	}

	// Salvar input em variável configurada
	var cfg struct {
		VariableName string `json:"variable_name"`
		NextStepID   string `json:"next_step_id"`
	}
	_ = json.Unmarshal(current.Config, &cfg)
	if cfg.VariableName != "" {
		vars.Flow[cfg.VariableName] = inputText
	}

	execution.AddMessage("inbound", inputText, current.ID)
	execution.Status = models.ExecutionActive
	execution.UpdatedAt = time.Now()
	e.saveVars(execution, vars)
	e.db.Save(execution)

	// Próximo step
	nextID := cfg.NextStepID
	if nextID == "" {
		nextID = current.NextStepID
	}
	next := flow.FindStep(nextID)
	if next == nil {
		e.complete(&execCtx{journey: journey, execution: execution, vars: vars})
		return
	}

	ctx := &execCtx{
		journey:    journey,
		execution:  execution,
		flow:       flow,
		vars:       vars,
		fromJID:    execution.ContactJID,
		fromName:   execution.ContactName,
		groupJID:   execution.GroupJID,
		instanceID: execution.InstanceID,
		inboundMsg: inputText,
	}
	e.run(ctx, next)
}

// run executa steps sequencialmente até fim, wait ou input.
// Proteções contra ciclo no flow (evita "manda a mesma mensagem 50x"):
//  - MaxSteps total (limite duro global)
//  - MaxStepVisits por step ID (detecta revisita excessiva)
//  - self-loop check (step.NextStepID == step.ID → encerra)
func (e *JourneyExecutor) run(ctx *execCtx, step *models.FlowStep) {
	visits := make(map[string]int)
	for step != nil {
		if ctx.stepsRun >= e.MaxSteps {
			log.Warn().
				Str("journey", ctx.journey.ID).
				Str("exec", ctx.execution.ID).
				Int("max", e.MaxSteps).
				Msg("journey: flow atingiu MaxSteps — possível ciclo; abortando")
			e.fail(ctx, "max_steps_exceeded")
			return
		}
		// Cap de revisita por step — pega ciclos indiretos (A→B→A→B…).
		visits[step.ID]++
		if visits[step.ID] > e.MaxStepVisits {
			log.Warn().
				Str("journey", ctx.journey.ID).
				Str("exec", ctx.execution.ID).
				Str("step", step.ID).
				Str("step_type", string(step.Type)).
				Int("visits", visits[step.ID]).
				Msg("journey: step revisitado acima do limite — ciclo no flow; abortando")
			e.fail(ctx, fmt.Sprintf("step_cycle:%s", step.ID))
			return
		}
		// Re-checa status da jornada antes de cada step. Se o usuário
		// pausou enquanto a goroutine estava em flight (ex: durante um
		// wait ou entre sends), abortamos imediatamente — o que vier
		// depois não deve ser enviado.
		if !ctx.simulate && !e.isJourneyActive(ctx.journey.ID) {
			log.Info().Str("journey", ctx.journey.ID).Str("exec", ctx.execution.ID).
				Msg("journey: execução abortada — jornada foi pausada/desativada")
			e.fail(ctx, "journey_paused")
			return
		}
		ctx.stepsRun++

		ctx.execution.CurrentStep = step.ID
		ctx.execution.StepIndex = ctx.stepsRun
		ctx.execution.UpdatedAt = time.Now()
		if !ctx.simulate {
			e.db.Save(ctx.execution)
		}

		next, pause, err := e.executeStep(ctx, step)
		if err != nil {
			log.Error().Err(err).Str("step", step.ID).Str("type", string(step.Type)).Msg("step failed")
			e.fail(ctx, err.Error())
			return
		}
		if pause {
			// Aguardando input - salvar estado e sair
			ctx.execution.Status = "waiting_input"
			ctx.vars.WaitingStep = step.ID
			e.saveVars(ctx.execution, ctx.vars)
			if !ctx.simulate {
				e.db.Save(ctx.execution)
			}
			return
		}
		// Self-loop direto: step aponta pra si mesmo. Isso é sempre bug
		// (flow mal gerado); encerramos com log pra usuário identificar.
		if next != nil && next.ID == step.ID {
			log.Warn().
				Str("journey", ctx.journey.ID).
				Str("step", step.ID).
				Str("step_type", string(step.Type)).
				Msg("journey: self-loop detectado — step aponta pra ele mesmo; encerrando flow aqui")
			break
		}
		step = next
	}
	e.complete(ctx)
}

// executeStep processa um step e retorna (próximo step, pausar para input, erro)
func (e *JourneyExecutor) executeStep(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	switch step.Type {
	case models.StepTypeMessage:
		return e.stepMessage(ctx, step)
	case models.StepTypeButtons:
		return e.stepButtons(ctx, step)
	case models.StepTypeList:
		return e.stepList(ctx, step)
	case models.StepTypeInput:
		return e.stepInput(ctx, step)
	case models.StepTypeWait:
		return e.stepWait(ctx, step)
	case models.StepTypeCondition:
		return e.stepCondition(ctx, step)
	case models.StepTypeAIResponse:
		return e.stepAIResponse(ctx, step)
	case models.StepTypeHTTP:
		return e.stepHTTP(ctx, step)
	case models.StepTypeMedia:
		return e.stepMedia(ctx, step)
	case models.StepTypeHandoff:
		return e.stepHandoff(ctx, step)
	case models.StepTypeGoto:
		return e.stepGoto(ctx, step)
	case models.StepTypeRandomize:
		return e.stepRandomize(ctx, step)
	case models.StepTypeSetVariable:
		return e.stepSetVariable(ctx, step)
	case models.StepTypeAddTag, models.StepTypeTag:
		return e.stepAddTag(ctx, step)
	case models.StepTypeRemoveTag:
		return e.stepRemoveTag(ctx, step)
	case models.StepTypeUpdateStage:
		return e.stepUpdateStage(ctx, step)
	case models.StepTypeProductSearch:
		return e.stepProductSearch(ctx, step)
	case models.StepTypeProductCarousel:
		return e.stepProductCarousel(ctx, step)
	case models.StepTypeWaitUntil:
		return e.stepWaitUntil(ctx, step)
	case models.StepTypeMultivariate:
		return e.stepMultivariate(ctx, step)
	case models.StepTypeSendInTimezone:
		return e.stepSendInTimezone(ctx, step)
	case models.StepTypeUnsubscribe:
		return e.stepUnsubscribe(ctx, step)
	case models.StepTypeEnd:
		return nil, false, nil
	default:
		// Step desconhecido: segue para next
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
}

// ─── Step handlers ────────────────────────────────────────────────────────────

func (e *JourneyExecutor) stepMessage(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Message string `json:"message"`
		Mode    string `json:"mode"` // "private" | "group"
	}
	_ = json.Unmarshal(step.Config, &cfg)
	text := e.interpolate(cfg.Message, ctx.vars)
	jid := e.resolveRecipient(ctx, cfg.Mode)

	ctx.emit(step.ID, string(step.Type), "send_text", map[string]interface{}{"to": jid, "text": text})
	if !ctx.simulate {
		log.Info().
			Str("journey", ctx.journey.ID).
			Str("step", step.ID).
			Str("mode", cfg.Mode).
			Str("to", jid).
			Int("text_len", len(text)).
			Str("text_preview", firstN(text, 60)).
			Msg("journey: enviando mensagem")
		if err := e.sender.SendText(ctx.instanceID, jid, text); err != nil {
			log.Error().Err(err).
				Str("journey", ctx.journey.ID).
				Str("step", step.ID).
				Str("to", jid).
				Msg("journey: falha ao enviar mensagem")
			return nil, false, err
		}
		ctx.execution.AddMessage("outbound", text, step.ID)
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepButtons(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Message string   `json:"message"`
		Buttons []Button `json:"buttons"`
		Mode    string   `json:"mode"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	text := e.interpolate(cfg.Message, ctx.vars)
	jid := e.resolveRecipient(ctx, cfg.Mode)

	ctx.emit(step.ID, string(step.Type), "send_buttons",
		map[string]interface{}{"to": jid, "text": text, "buttons": cfg.Buttons})
	if !ctx.simulate {
		if err := e.sender.SendButtons(ctx.instanceID, jid, text, cfg.Buttons); err != nil {
			return nil, false, err
		}
		ctx.execution.AddMessage("outbound", text, step.ID)
	}
	// Botão pausa para input (próxima msg = seleção)
	return nil, true, nil
}

func (e *JourneyExecutor) stepList(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Message    string        `json:"message"`
		ButtonText string        `json:"button_text"`
		Sections   []ListSection `json:"sections"`
		Mode       string        `json:"mode"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	text := e.interpolate(cfg.Message, ctx.vars)
	jid := e.resolveRecipient(ctx, cfg.Mode)
	btn := cfg.ButtonText
	if btn == "" {
		btn = "Ver opções"
	}

	ctx.emit(step.ID, string(step.Type), "send_list",
		map[string]interface{}{"to": jid, "text": text, "button": btn, "sections": cfg.Sections})
	if !ctx.simulate {
		if err := e.sender.SendList(ctx.instanceID, jid, text, btn, cfg.Sections); err != nil {
			return nil, false, err
		}
		ctx.execution.AddMessage("outbound", text, step.ID)
	}
	return nil, true, nil
}

func (e *JourneyExecutor) stepInput(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Prompt       string `json:"prompt"`
		VariableName string `json:"variable_name"`
		Mode         string `json:"mode"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.Prompt != "" {
		text := e.interpolate(cfg.Prompt, ctx.vars)
		jid := e.resolveRecipient(ctx, cfg.Mode)
		ctx.emit(step.ID, string(step.Type), "send_text", map[string]interface{}{"to": jid, "text": text})
		if !ctx.simulate {
			if err := e.sender.SendText(ctx.instanceID, jid, text); err != nil {
				return nil, false, err
			}
			ctx.execution.AddMessage("outbound", text, step.ID)
		}
	}
	// Modo simulação: usa inboundMsg como se fosse a resposta
	if ctx.simulate {
		if cfg.VariableName != "" {
			ctx.vars.Flow[cfg.VariableName] = ctx.inboundMsg
		}
		ctx.vars.LastInput = ctx.inboundMsg
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	return nil, true, nil
}

func (e *JourneyExecutor) stepWait(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Duration string `json:"duration"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	d, err := time.ParseDuration(cfg.Duration)
	if err != nil || d <= 0 {
		d = 2 * time.Second
	}
	if d > 24*time.Hour {
		d = 24 * time.Hour
	}
	ctx.emit(step.ID, string(step.Type), "wait", map[string]interface{}{"duration_ms": d.Milliseconds()})
	if !ctx.simulate {
		time.Sleep(d)
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepCondition(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Left     string `json:"left"`     // e.g. "{{last_input}}"
		Operator string `json:"operator"` // eq, neq, contains, not_contains, gt, lt, regex, exists
		Right    string `json:"right"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	left := e.interpolate(cfg.Left, ctx.vars)
	right := e.interpolate(cfg.Right, ctx.vars)

	branchTrue := step.BranchTrue
	branchFalse := step.BranchFalse
	if branchFalse == "" {
		branchFalse = step.NextStepID
	}

	ok := evalCondition(left, cfg.Operator, right)
	ctx.emit(step.ID, string(step.Type), "condition",
		map[string]interface{}{"left": left, "op": cfg.Operator, "right": right, "result": ok})

	// Log do resultado da condition. Essencial pra diagnosticar flows
	// que "completam" sem enviar — se o branch resolvido aponta pra step
	// inexistente (BFS cancela), run() termina limpo sem mandar nada.
	var nextBranch string
	if ok {
		nextBranch = branchTrue
	} else {
		nextBranch = branchFalse
	}
	nextStep := ctx.flow.FindStep(nextBranch)
	log.Info().
		Str("journey", ctx.journey.ID).
		Str("step", step.ID).
		Str("op", cfg.Operator).
		Bool("result", ok).
		Str("left", firstN(left, 40)).
		Str("right", firstN(right, 40)).
		Str("next_branch_id", nextBranch).
		Bool("next_found", nextStep != nil).
		Msg("journey: condition avaliada")

	return nextStep, false, nil
}

func (e *JourneyExecutor) stepAIResponse(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		SystemPrompt   string `json:"system_prompt"`
		UserPrompt     string `json:"user_prompt"`
		IntegrationID  string `json:"integration_id"`
		VariableName   string `json:"variable_name"` // opcional: salva resposta em var
		SendToUser     bool   `json:"send_to_user"`
		Mode           string `json:"mode"`
	}
	_ = json.Unmarshal(step.Config, &cfg)

	sysP := e.interpolate(cfg.SystemPrompt, ctx.vars)
	usrP := e.interpolate(cfg.UserPrompt, ctx.vars)
	if usrP == "" {
		usrP = ctx.vars.LastInput
	}

	var integration *models.UserIntegration
	if cfg.IntegrationID != "" {
		_ = e.db.Where("id = ? AND is_active = true", cfg.IntegrationID).First(&integration).Error
	}
	if integration == nil {
		e.db.Where("user_id = ? AND is_active = true AND provider IN ?",
			ctx.journey.UserID,
			[]string{"openai", "claude", "deepseek", "gemini", "openrouter"}).First(&integration)
	}

	c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	reply, err := e.llm.CallChatWithSystem(c, integration, sysP, usrP, false)
	if err != nil {
		return nil, false, err
	}

	if cfg.VariableName != "" {
		ctx.vars.Flow[cfg.VariableName] = reply
	}

	ctx.emit(step.ID, string(step.Type), "ai_response",
		map[string]interface{}{"reply": reply, "variable": cfg.VariableName})

	if cfg.SendToUser || cfg.VariableName == "" {
		jid := e.resolveRecipient(ctx, cfg.Mode)
		if !ctx.simulate {
			if err := e.sender.SendText(ctx.instanceID, jid, reply); err != nil {
				return nil, false, err
			}
			ctx.execution.AddMessage("outbound", reply, step.ID)
		}
	}

	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepHTTP(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Method      string            `json:"method"`
		URL         string            `json:"url"`
		Headers     map[string]string `json:"headers"`
		Body        string            `json:"body"`
		SaveResult  string            `json:"save_result"`  // nome da variável
		SaveField   string            `json:"save_field"`   // dot-path no JSON de resposta
	}
	_ = json.Unmarshal(step.Config, &cfg)
	method := strings.ToUpper(cfg.Method)
	if method == "" {
		method = "GET"
	}
	url := e.interpolate(cfg.URL, ctx.vars)

	var bodyReader io.Reader
	if cfg.Body != "" {
		body := e.interpolate(cfg.Body, ctx.vars)
		bodyReader = bytes.NewBufferString(body)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, false, err
	}
	for k, v := range cfg.Headers {
		req.Header.Set(k, e.interpolate(v, ctx.vars))
	}

	ctx.emit(step.ID, string(step.Type), "http_request",
		map[string]interface{}{"method": method, "url": url})

	if ctx.simulate {
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if cfg.SaveResult != "" {
		val := string(respBody)
		if cfg.SaveField != "" {
			var parsed map[string]interface{}
			if json.Unmarshal(respBody, &parsed) == nil {
				if v := digField(parsed, cfg.SaveField); v != nil {
					val = fmt.Sprintf("%v", v)
				}
			}
		}
		ctx.vars.Flow[cfg.SaveResult] = val
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepMedia(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		MediaType string `json:"media_type"` // image, video, audio, document
		URL       string `json:"url"`
		Caption   string `json:"caption"`
		Mode      string `json:"mode"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	url := e.interpolate(cfg.URL, ctx.vars)
	caption := e.interpolate(cfg.Caption, ctx.vars)
	jid := e.resolveRecipient(ctx, cfg.Mode)

	ctx.emit(step.ID, string(step.Type), "send_media",
		map[string]interface{}{"to": jid, "type": cfg.MediaType, "url": url, "caption": caption})
	if !ctx.simulate {
		if err := e.sender.SendMedia(ctx.instanceID, jid, cfg.MediaType, url, caption); err != nil {
			return nil, false, err
		}
		ctx.execution.AddMessage("outbound", "["+cfg.MediaType+"] "+caption, step.ID)
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepHandoff(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Message string `json:"message"`
		UserID  string `json:"user_id"` // atribuir a qual operador
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.Message != "" {
		text := e.interpolate(cfg.Message, ctx.vars)
		jid := e.resolveRecipient(ctx, "private")
		if !ctx.simulate {
			_ = e.sender.SendText(ctx.instanceID, jid, text)
			ctx.execution.AddMessage("outbound", text, step.ID)
		}
		ctx.emit(step.ID, string(step.Type), "handoff",
			map[string]interface{}{"assigned_user": cfg.UserID, "message": text})
	}
	// Marca execução como completa e cria flag de handoff em metadata
	ctx.vars.Flow["handed_off_to"] = cfg.UserID
	return nil, false, nil
}

func (e *JourneyExecutor) stepGoto(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		TargetStepID    string `json:"target_step_id"`
		TargetJourneyID string `json:"target_journey_id"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	ctx.emit(step.ID, string(step.Type), "goto",
		map[string]interface{}{"target_step": cfg.TargetStepID, "target_journey": cfg.TargetJourneyID})

	if cfg.TargetStepID != "" {
		return ctx.flow.FindStep(cfg.TargetStepID), false, nil
	}
	// TODO: suporte a jump para outra jornada (TargetJourneyID) — marcado para fase 3
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepRandomize(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Branches []struct {
			StepID string  `json:"step_id"`
			Weight float64 `json:"weight"`
		} `json:"branches"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if len(cfg.Branches) == 0 {
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	total := 0.0
	for _, b := range cfg.Branches {
		w := b.Weight
		if w <= 0 {
			w = 1
		}
		total += w
	}
	r := rand.Float64() * total
	acc := 0.0
	for _, b := range cfg.Branches {
		w := b.Weight
		if w <= 0 {
			w = 1
		}
		acc += w
		if r <= acc {
			ctx.emit(step.ID, string(step.Type), "randomize_pick",
				map[string]interface{}{"picked": b.StepID})
			return ctx.flow.FindStep(b.StepID), false, nil
		}
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepSetVariable(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.Name != "" {
		ctx.vars.Flow[cfg.Name] = e.interpolate(cfg.Value, ctx.vars)
	}
	ctx.emit(step.ID, string(step.Type), "set_var",
		map[string]interface{}{"name": cfg.Name, "value": ctx.vars.Flow[cfg.Name]})
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepAddTag(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Tag string `json:"tag"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	tag := e.interpolate(cfg.Tag, ctx.vars)
	ctx.emit(step.ID, string(step.Type), "add_tag", map[string]interface{}{"tag": tag, "contact": ctx.fromJID})

	if !ctx.simulate && tag != "" {
		// Best-effort: localizar Contact por JID e adicionar tag — depende do schema CRM.
		// Grava na metadata da execução para auditoria.
		ctx.vars.Flow["_last_tag_added"] = tag
	}
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepRemoveTag(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Tag string `json:"tag"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	tag := e.interpolate(cfg.Tag, ctx.vars)
	ctx.emit(step.ID, string(step.Type), "remove_tag", map[string]interface{}{"tag": tag})
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func (e *JourneyExecutor) stepUpdateStage(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		StageID string `json:"stage_id"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	ctx.emit(step.ID, string(step.Type), "update_stage", map[string]interface{}{"stage_id": cfg.StageID})
	ctx.vars.Flow["_last_stage"] = cfg.StageID
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func (e *JourneyExecutor) resolveRecipient(ctx *execCtx, mode string) string {
	if mode == "group" && ctx.groupJID != "" {
		return ctx.groupJID
	}
	jid := ctx.fromJID
	if !strings.Contains(jid, "@") {
		jid = jid + "@s.whatsapp.net"
	}
	return jid
}

func (e *JourneyExecutor) complete(ctx *execCtx) {
	if ctx.simulate {
		return
	}
	now := time.Now()
	ctx.execution.Status = models.ExecutionCompleted
	ctx.execution.CompletedAt = &now
	ctx.execution.UpdatedAt = now
	e.saveVars(ctx.execution, ctx.vars)
	e.db.Save(ctx.execution)

	e.db.Model(ctx.journey).Updates(map[string]interface{}{
		"invocations":     ctx.journey.Invocations + 1,
		"completed_count": ctx.journey.CompletedCount + 1,
		"last_run_at":     now,
	})
	log.Info().
		Str("journey", ctx.journey.ID).
		Str("execution", ctx.execution.ID).
		Int("steps_run", ctx.stepsRun).
		Msg("journey: execução completa")
}

func (e *JourneyExecutor) fail(ctx *execCtx, errMsg string) {
	if ctx.simulate {
		return
	}
	now := time.Now()
	ctx.execution.Status = models.ExecutionFailed
	ctx.execution.ErrorMessage = errMsg
	ctx.execution.UpdatedAt = now
	if ctx.execution.CompletedAt == nil {
		ctx.execution.CompletedAt = &now
	}
	e.saveVars(ctx.execution, ctx.vars)
	e.db.Save(ctx.execution)
	log.Error().Str("execution", ctx.execution.ID).Str("erro", errMsg).Msg("jornada falhou")
}

func (e *JourneyExecutor) saveVars(exec *models.JourneyExecution, vars *models.ExecutionVars) {
	data, err := json.Marshal(vars)
	if err == nil {
		exec.Metadata = string(data)
	}
}

func (e *JourneyExecutor) loadVars(exec *models.JourneyExecution) *models.ExecutionVars {
	vars := &models.ExecutionVars{
		Contact: map[string]interface{}{},
		Flow:    map[string]interface{}{},
	}
	if exec.Metadata != "" && exec.Metadata != "{}" {
		_ = json.Unmarshal([]byte(exec.Metadata), vars)
	}
	if vars.Contact == nil {
		vars.Contact = map[string]interface{}{"name": exec.ContactName, "jid": exec.ContactJID}
	}
	if vars.Flow == nil {
		vars.Flow = map[string]interface{}{}
	}
	return vars
}

var reVar = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

// interpolate substitui {{var.path}} pelo valor no contexto
func (e *JourneyExecutor) interpolate(s string, vars *models.ExecutionVars) string {
	if s == "" || vars == nil {
		return s
	}
	// Caminho Liquid: se o template tem {% (lógica) ou |  filter, usa o
	// engine completo. Caso contrário, fica no atalho regex (retrocompat
	// com templates simples {{var}}).
	if strings.Contains(s, "{%") || strings.Contains(s, "| ") {
		ctx := map[string]any{
			"contact":    vars.Contact,
			"flow":       vars.Flow,
			"last_input": vars.LastInput,
			"vars":       vars.Flow,
		}
		out, err := template.Render(s, ctx)
		if err == nil {
			return out
		}
		// Fallback pro regex se Liquid falhar.
	}
	return reVar.ReplaceAllStringFunc(s, func(m string) string {
		sub := reVar.FindStringSubmatch(m)
		if len(sub) < 2 {
			return m
		}
		path := sub[1]
		return fmt.Sprintf("%v", resolvePath(path, vars))
	})
}

func resolvePath(path string, vars *models.ExecutionVars) interface{} {
	parts := strings.Split(path, ".")
	// atalhos comuns
	switch parts[0] {
	case "name", "contact_name":
		if v, ok := vars.Contact["name"]; ok {
			return v
		}
	case "last_input":
		return vars.LastInput
	}
	if len(parts) == 1 {
		if v, ok := vars.Flow[parts[0]]; ok {
			return v
		}
		if v, ok := vars.Contact[parts[0]]; ok {
			return v
		}
		return ""
	}
	var cur interface{}
	switch parts[0] {
	case "contact":
		cur = vars.Contact
	case "flow", "vars":
		cur = vars.Flow
	case "instance":
		cur = vars.Instance
	default:
		return ""
	}
	for _, p := range parts[1:] {
		m, ok := cur.(map[string]interface{})
		if !ok {
			return ""
		}
		cur = m[p]
	}
	if cur == nil {
		return ""
	}
	return cur
}

func digField(m map[string]interface{}, path string) interface{} {
	parts := strings.Split(path, ".")
	var cur interface{} = m
	for _, p := range parts {
		mm, ok := cur.(map[string]interface{})
		if !ok {
			return nil
		}
		cur = mm[p]
	}
	return cur
}

func evalCondition(left, op, right string) bool {
	switch strings.ToLower(op) {
	case "eq", "=", "==":
		return left == right
	case "neq", "!=":
		return left != right
	case "contains", "includes":
		return strings.Contains(strings.ToLower(left), strings.ToLower(right))
	case "not_contains":
		return !strings.Contains(strings.ToLower(left), strings.ToLower(right))
	case "starts_with":
		return strings.HasPrefix(strings.ToLower(left), strings.ToLower(right))
	case "ends_with":
		return strings.HasSuffix(strings.ToLower(left), strings.ToLower(right))
	case "exists", "not_empty":
		return strings.TrimSpace(left) != ""
	case "empty":
		return strings.TrimSpace(left) == ""
	case "regex":
		re, err := regexp.Compile(right)
		if err != nil {
			return false
		}
		return re.MatchString(left)
	case "gt", ">":
		return parseFloat(left) > parseFloat(right)
	case "lt", "<":
		return parseFloat(left) < parseFloat(right)
	case "gte", ">=":
		return parseFloat(left) >= parseFloat(right)
	case "lte", "<=":
		return parseFloat(left) <= parseFloat(right)
	}
	return false
}

func parseFloat(s string) float64 {
	var f float64
	_, _ = fmt.Sscanf(strings.TrimSpace(s), "%f", &f)
	return f
}

// ─── Legacy fallback ─────────────────────────────────────────────────────────

// legacyFallback reproduz o comportamento original (message_template único)
// para jornadas ainda sem flow estruturado.
func (e *JourneyExecutor) legacyFallback(j *models.Journey, fromJID, fromName, groupJID, messageText string) {
	// Integra jornada ↔ CRM (idempotente — startNew pode já ter chamado).
	e.upsertContactForJourney(j, fromJID, fromName)

	vars := &models.ExecutionVars{
		Contact:   map[string]interface{}{"name": fromName, "jid": fromJID},
		Flow:      map[string]interface{}{},
		LastInput: messageText,
	}

	msg := j.MessageTemplate
	if msg == "" {
		msg = "Olá {{name}}! Recebi sua mensagem."
	}
	msg = e.interpolate(msg, vars)

	recipient := fromJID
	if j.ResponseMode == "group" && groupJID != "" {
		recipient = groupJID
	} else if !strings.Contains(recipient, "@") {
		recipient = recipient + "@s.whatsapp.net"
	}

	exec := &models.JourneyExecution{
		ID:          uuid.New().String(),
		JourneyID:   j.ID,
		InstanceID:  j.InstanceID,
		ContactJID:  fromJID,
		ContactName: fromName,
		GroupJID:    groupJID,
		Status:      models.ExecutionActive,
		TotalSteps:  1,
		CurrentStep: "send",
		StartedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	exec.AddMessage("inbound", messageText, "trigger")
	e.db.Create(exec)

	log.Info().
		Str("journey", j.ID).
		Str("mode", j.ResponseMode).
		Str("to", recipient).
		Int("text_len", len(msg)).
		Str("text_preview", firstN(msg, 60)).
		Msg("journey (legacy): enviando mensagem")

	if err := e.sender.SendText(j.InstanceID, recipient, msg); err != nil {
		log.Error().Err(err).
			Str("journey", j.ID).
			Str("to", recipient).
			Msg("journey (legacy): falha ao enviar mensagem")
		now := time.Now()
		exec.Status = models.ExecutionFailed
		exec.ErrorMessage = err.Error()
		exec.CompletedAt = &now
		exec.UpdatedAt = now
		e.db.Save(exec)
		return
	}
	exec.AddMessage("outbound", msg, "send")
	now := time.Now()
	exec.Status = models.ExecutionCompleted
	exec.CompletedAt = &now
	exec.UpdatedAt = now
	e.db.Save(exec)

	e.db.Model(j).Updates(map[string]interface{}{
		"invocations":     j.Invocations + 1,
		"completed_count": j.CompletedCount + 1,
		"last_run_at":     now,
	})
}

// ─── Simulação (sandbox) ─────────────────────────────────────────────────────

// SimulationResult é o retorno da simulação
type SimulationResult struct {
	Events     []SimulationEvent      `json:"events"`
	FinalVars  map[string]interface{} `json:"final_vars"`
	StepsRun   int                    `json:"steps_run"`
	StoppedAt  string                 `json:"stopped_at,omitempty"`
	WaitingFor string                 `json:"waiting_for,omitempty"` // step id aguardando input
	Error      string                 `json:"error,omitempty"`
}

// Simulate roda a jornada em modo sandbox (sem enviar mensagens reais)
func (e *JourneyExecutor) Simulate(journey *models.Journey, inboundMsg, contactName string) *SimulationResult {
	flow := journey.GetFlow()
	if flow == nil || len(flow.Steps) == 0 {
		return &SimulationResult{Error: "jornada sem fluxo configurado"}
	}
	start := flow.FirstStep()
	if start == nil {
		return &SimulationResult{Error: "start step não encontrado"}
	}
	if contactName == "" {
		contactName = "Teste"
	}

	vars := &models.ExecutionVars{
		Contact: map[string]interface{}{
			"name":  contactName,
			"jid":   "5511999999999@s.whatsapp.net",
			"phone": "5511999999999",
		},
		Flow:      map[string]interface{}{},
		LastInput: inboundMsg,
	}

	ctx := &execCtx{
		journey:    journey,
		flow:       flow,
		vars:       vars,
		fromJID:    "5511999999999@s.whatsapp.net",
		fromName:   contactName,
		groupJID:   "",
		instanceID: journey.InstanceID,
		inboundMsg: inboundMsg,
		simulate:   true,
		execution:  &models.JourneyExecution{ID: "sim"},
	}

	res := &SimulationResult{}
	defer func() {
		res.Events = ctx.sim
		res.StepsRun = ctx.stepsRun
		res.FinalVars = map[string]interface{}{
			"contact":    ctx.vars.Contact,
			"flow":       ctx.vars.Flow,
			"last_input": ctx.vars.LastInput,
		}
	}()

	step := start
	for step != nil {
		if ctx.stepsRun >= e.MaxSteps {
			res.Error = "max_steps_exceeded"
			return res
		}
		ctx.stepsRun++
		next, pause, err := e.executeStep(ctx, step)
		if err != nil {
			res.Error = err.Error()
			res.StoppedAt = step.ID
			return res
		}
		if pause {
			res.WaitingFor = step.ID
			return res
		}
		step = next
	}
	return res
}
