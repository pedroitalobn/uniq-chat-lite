package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

// FlowBuilder usa LLM para gerar/editar um JourneyFlow estruturado a partir
// de linguagem natural. Retorna sempre um JourneyFlow JSON-válido.
type FlowBuilder struct {
	llm *LLMService
}

func NewFlowBuilder(llm *LLMService) *FlowBuilder {
	return &FlowBuilder{llm: llm}
}

const flowSystemPrompt = `Você é um arquiteto de fluxos conversacionais estilo ManyChat para WhatsApp.
Sua tarefa: converter uma descrição em linguagem natural em um JSON estruturado de JourneyFlow.

FORMATO OBRIGATÓRIO (responda APENAS com JSON válido, sem markdown, sem explicação):

{
  "start_step": "<id do primeiro step>",
  "steps": [
    {
      "id": "<uuid curto único>",
      "type": "<um destes: message | email | sms | buttons | list | input | wait | condition | ai_response | http_request | media | handoff | goto | randomize | set_variable | add_tag | remove_tag | update_stage | end>",
      "label": "<rótulo curto legível>",
      "config": { ... objeto JSON específico ao type ... },
      "next_step_id": "<id do próximo step ou vazio>",
      "is_start_step": true/false,
      "branch_true": "<para condition/randomize>",
      "branch_false": "<para condition>"
    }
  ]
}

CONFIGS POR TYPE:
- message: { "message": "texto com {{name}} ou {{last_input}}", "mode": "private|group" }
- email:   { "to": "{{contact.email}}", "subject": "Assunto", "body_html": "<p>HTML</p>", "body_text": "Plain text fallback" }
  * "to" opcional — sem ele usa o email do contato no CRM
  * use email pra drips B2B / nurture / pós-venda longo prazo
- sms:     { "to": "{{contact.phone}}", "text": "Texto curto", "provider": "twilio" }
  * SMS é caro — use só quando precisar de delivery garantido sem internet
- buttons: { "message": "texto", "buttons": [{"id":"b1","text":"Opção 1"}, ...], "mode":"private" }
  * buttons pausam para input; use branches mapeando ID→step via condition após
- list: { "message": "texto", "button_text": "Ver opções", "sections": [{"title":"Seção","rows":[{"id":"r1","title":"Item","description":"desc"}]}] }
- input: { "prompt": "O que você quer?", "variable_name": "nome_da_var", "next_step_id": "id" }
- wait: { "duration": "5s" | "2m" | "1h" }
- condition: { "left": "{{last_input}}", "operator": "eq|neq|contains|starts_with|regex|exists|empty|gt|lt", "right": "valor" }
  * usar branch_true e branch_false
- ai_response: { "system_prompt": "Você é...", "user_prompt": "{{last_input}}", "variable_name": "resposta_ai", "send_to_user": true }
- http_request: { "method": "GET|POST", "url": "https://...", "headers": {}, "body": "", "save_result": "var", "save_field": "data.nome" }
- media: { "media_type": "image|video|audio|document", "url": "https://...", "caption": "texto" }
- handoff: { "message": "Transferindo...", "user_id": "" }
- goto: { "target_step_id": "id" }
- randomize: { "branches": [{"step_id":"a","weight":1},{"step_id":"b","weight":2}] }
- set_variable: { "name": "var_name", "value": "valor ou {{template}}" }
- add_tag: { "tag": "interessado" }
- update_stage: { "stage_id": "uuid-do-stage" }

REGRAS:
1. Todo flow começa com 1 step e "start_step" aponta para o id dele
2. IDs devem ser strings únicas e curtas (ex: "s1", "s2", "welcome", "ask_email")
3. O último step deve ter next_step_id vazio OU ser type "end"
4. Placeholders suportados: {{name}}, {{last_input}}, {{contact.phone}}, {{flow.nome_da_var}}
5. Seja conciso: se o usuário pede algo simples, não adicione steps desnecessários
6. Em português a menos que pedido contrário`

const flowEditSystemPrompt = `Você é um arquiteto de fluxos conversacionais. Recebe um JourneyFlow JSON existente
e uma instrução de edição em linguagem natural. Retorna o JSON completo modificado.

REGRAS:
1. Preserve IDs existentes quando possível
2. Mantenha o formato EXATO do JourneyFlow (mesmos campos: start_step, steps[])
3. Só modifique o necessário para atender a instrução
4. Responda APENAS com JSON válido, sem markdown, sem explicação
5. Se a instrução pedir para adicionar um step, gere um novo ID único e conecte via next_step_id ou branches

FORMATO DO FLOW (referência):
{
  "start_step": "id",
  "steps": [{ "id":"", "type":"", "label":"", "config":{}, "next_step_id":"", "branch_true":"", "branch_false":"", "is_start_step":false }]
}`

// Build gera um novo JourneyFlow a partir de uma descrição em linguagem natural
func (b *FlowBuilder) Build(ctx context.Context, integration *models.UserIntegration, prompt string) (*models.JourneyFlow, error) {
	c, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	content, err := b.llm.CallChatWithSystem(c, integration, flowSystemPrompt, prompt, true)
	if err != nil {
		return nil, fmt.Errorf("falha ao chamar LLM: %w", err)
	}
	flow, err := parseFlowJSON(content)
	if err != nil {
		return nil, err
	}
	normalizeFlow(flow)
	return flow, nil
}

// Edit modifica um JourneyFlow existente com base em uma instrução
func (b *FlowBuilder) Edit(ctx context.Context, integration *models.UserIntegration, current *models.JourneyFlow, instruction string) (*models.JourneyFlow, error) {
	c, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	currentJSON, err := json.Marshal(current)
	if err != nil {
		return nil, fmt.Errorf("falha ao serializar flow atual: %w", err)
	}

	userPrompt := fmt.Sprintf(
		"FLOW ATUAL:\n```json\n%s\n```\n\nINSTRUÇÃO:\n%s\n\nRetorne o flow completo modificado.",
		string(currentJSON), instruction,
	)

	content, err := b.llm.CallChatWithSystem(c, integration, flowEditSystemPrompt, userPrompt, true)
	if err != nil {
		return nil, fmt.Errorf("falha ao chamar LLM: %w", err)
	}
	flow, err := parseFlowJSON(content)
	if err != nil {
		return nil, err
	}
	normalizeFlow(flow)
	return flow, nil
}

// parseFlowJSON extrai um JourneyFlow de uma resposta LLM, tolerando markdown
// wrapping e outros ruídos
func parseFlowJSON(content string) (*models.JourneyFlow, error) {
	s := strings.TrimSpace(content)

	// Remove markdown fences
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx > 0 {
			s = s[idx+1:]
		}
		if idx := strings.LastIndex(s, "```"); idx > 0 {
			s = s[:idx]
		}
	}
	s = strings.TrimSpace(s)

	// Extrai primeiro objeto JSON
	if i := strings.Index(s, "{"); i > 0 {
		s = s[i:]
	}
	if i := strings.LastIndex(s, "}"); i > 0 && i < len(s)-1 {
		s = s[:i+1]
	}

	var flow models.JourneyFlow
	if err := json.Unmarshal([]byte(s), &flow); err != nil {
		return nil, fmt.Errorf("LLM retornou JSON inválido: %w (conteúdo: %.200s)", err, s)
	}
	if len(flow.Steps) == 0 {
		return nil, fmt.Errorf("flow gerado não tem steps")
	}
	return &flow, nil
}

// normalizeFlow garante IDs únicos, start_step válido, is_start_step coerente
func normalizeFlow(f *models.JourneyFlow) {
	if f == nil {
		return
	}
	seen := map[string]bool{}
	for i := range f.Steps {
		if f.Steps[i].ID == "" {
			f.Steps[i].ID = "s_" + uuid.New().String()[:8]
		}
		if seen[f.Steps[i].ID] {
			f.Steps[i].ID = f.Steps[i].ID + "_" + uuid.New().String()[:4]
		}
		seen[f.Steps[i].ID] = true
		// Garantir config não-nula
		if len(f.Steps[i].Config) == 0 {
			f.Steps[i].Config = json.RawMessage("{}")
		}
	}
	// Sanitiza ponteiros "next_step_id" que criariam ciclos óbvios:
	//  - self-reference (next = id do próprio step) → limpa (fim do flow)
	//  - aponta pra step inexistente → limpa
	// Ciclos indiretos (A→B→A) ainda podem existir, mas o executor tem
	// cap por step-visit que derruba esses em runtime.
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
	// Garantir start_step
	if f.StartStep == "" || !seen[f.StartStep] {
		for i := range f.Steps {
			if f.Steps[i].IsStartStep {
				f.StartStep = f.Steps[i].ID
				return
			}
		}
		f.StartStep = f.Steps[0].ID
		f.Steps[0].IsStartStep = true
	}
}

// ─── Built-in templates (marketplace interno) ────────────────────────────────

type JourneyTemplate struct {
	Slug        string              `json:"slug"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Category    string              `json:"category"`
	Icon        string              `json:"icon"`
	TriggerType string              `json:"trigger_type"`
	Keywords    []string            `json:"keywords"`
	Flow        *models.JourneyFlow `json:"flow"`
}

// BuiltInTemplates retorna uma lista curada de templates prontos
func BuiltInTemplates() []JourneyTemplate {
	return []JourneyTemplate{
		{
			Slug:        "welcome-faq",
			Name:        "Boas-vindas + FAQ com botões",
			Description: "Recebe o cliente, oferece 3 opções: falar com humano, ver produtos, horários",
			Category:    "Suporte",
			Icon:        "MessageSquare",
			TriggerType: "first_message",
			Keywords:    []string{},
			Flow: &models.JourneyFlow{
				StartStep: "welcome",
				Steps: []models.FlowStep{
					{
						ID:          "welcome",
						Type:        models.StepTypeButtons,
						Label:       "Boas-vindas",
						IsStartStep: true,
						Config: json.RawMessage(`{
							"message": "Olá {{name}}! 👋 Como posso ajudar?",
							"buttons": [
								{"id":"human","text":"👤 Falar com humano"},
								{"id":"products","text":"🛒 Ver produtos"},
								{"id":"hours","text":"⏰ Horários"}
							],
							"mode": "private"
						}`),
					},
					{
						ID:          "route",
						Type:        models.StepTypeCondition,
						Label:       "Roteamento",
						BranchTrue:  "human_handoff",
						BranchFalse: "check_products",
						Config:      json.RawMessage(`{"left":"{{last_input}}","operator":"contains","right":"humano"}`),
					},
					{
						ID:          "check_products",
						Type:        models.StepTypeCondition,
						Label:       "É produtos?",
						BranchTrue:  "show_products",
						BranchFalse: "hours_msg",
						Config:      json.RawMessage(`{"left":"{{last_input}}","operator":"contains","right":"produtos"}`),
					},
					{
						ID:     "human_handoff",
						Type:   models.StepTypeHandoff,
						Label:  "Transferir p/ humano",
						Config: json.RawMessage(`{"message":"Um atendente assumirá em instantes. ⏳"}`),
					},
					{
						ID:     "show_products",
						Type:   models.StepTypeMessage,
						Label:  "Lista de produtos",
						Config: json.RawMessage(`{"message":"Confira nosso catálogo: https://seusite.com/produtos","mode":"private"}`),
					},
					{
						ID:     "hours_msg",
						Type:   models.StepTypeMessage,
						Label:  "Horários",
						Config: json.RawMessage(`{"message":"Atendemos seg-sex, 9h às 18h. ⏰","mode":"private"}`),
					},
				},
			},
		},
		{
			Slug:        "lead-qualification",
			Name:        "Qualificação de Lead (SDR)",
			Description: "Captura nome, email, interesse e cria lead no CRM",
			Category:    "Vendas",
			Icon:        "Users",
			TriggerType: "first_message",
			Flow: &models.JourneyFlow{
				StartStep: "ask_name",
				Steps: []models.FlowStep{
					{
						ID: "ask_name", Type: models.StepTypeInput, Label: "Pedir nome", IsStartStep: true,
						Config: json.RawMessage(`{"prompt":"Olá! Qual é seu nome?","variable_name":"lead_name","next_step_id":"ask_email"}`),
					},
					{
						ID: "ask_email", Type: models.StepTypeInput, Label: "Pedir email",
						Config: json.RawMessage(`{"prompt":"Prazer, {{flow.lead_name}}! Qual seu melhor email?","variable_name":"lead_email","next_step_id":"ask_interest"}`),
					},
					{
						ID: "ask_interest", Type: models.StepTypeButtons, Label: "Interesse",
						Config: json.RawMessage(`{
							"message":"Em qual produto tem interesse?",
							"buttons":[{"id":"prod_a","text":"Plano Básico"},{"id":"prod_b","text":"Plano Pro"},{"id":"prod_c","text":"Enterprise"}]
						}`),
					},
					{
						ID: "add_tag_lead", Type: models.StepTypeAddTag, Label: "Marcar como lead",
						Config: json.RawMessage(`{"tag":"lead-qualificado"}`), NextStepID: "confirm",
					},
					{
						ID: "confirm", Type: models.StepTypeMessage, Label: "Confirmação",
						Config: json.RawMessage(`{"message":"Obrigado {{flow.lead_name}}! Um consultor entrará em contato em breve.","mode":"private"}`),
					},
				},
			},
		},
		{
			Slug:        "appointment",
			Name:        "Agendamento",
			Description: "Coleta horário preferido e confirma agendamento",
			Category:    "Agendamento",
			Icon:        "Clock",
			TriggerType: "private_keyword",
			Keywords:    []string{"agendar", "agendamento", "horário"},
			Flow: &models.JourneyFlow{
				StartStep: "greet",
				Steps: []models.FlowStep{
					{
						ID: "greet", Type: models.StepTypeMessage, Label: "Saudação", IsStartStep: true,
						Config:     json.RawMessage(`{"message":"Olá {{name}}! Vamos agendar.","mode":"private"}`),
						NextStepID: "pick_day",
					},
					{
						ID: "pick_day", Type: models.StepTypeList, Label: "Escolher dia",
						Config: json.RawMessage(`{
							"message":"Qual dia prefere?",
							"button_text":"Ver dias",
							"sections":[{"title":"Esta semana","rows":[
								{"id":"seg","title":"Segunda"},{"id":"ter","title":"Terça"},
								{"id":"qua","title":"Quarta"},{"id":"qui","title":"Quinta"},
								{"id":"sex","title":"Sexta"}
							]}]
						}`),
					},
					{
						ID: "save_day", Type: models.StepTypeSetVariable, Label: "Salvar dia",
						Config:     json.RawMessage(`{"name":"dia","value":"{{last_input}}"}`),
						NextStepID: "pick_time",
					},
					{
						ID: "pick_time", Type: models.StepTypeInput, Label: "Hora",
						Config: json.RawMessage(`{"prompt":"Que horário? (ex: 14:00)","variable_name":"hora","next_step_id":"confirm"}`),
					},
					{
						ID: "confirm", Type: models.StepTypeMessage, Label: "Confirmação",
						Config: json.RawMessage(`{"message":"✅ Agendado para {{flow.dia}} às {{flow.hora}}!","mode":"private"}`),
					},
				},
			},
		},
		{
			Slug:        "nps-survey",
			Name:        "Pesquisa NPS pós-venda",
			Description: "Pergunta nota 0-10 e registra feedback",
			Category:    "Pós-venda",
			Icon:        "TrendingUp",
			TriggerType: "private_message",
			Flow: &models.JourneyFlow{
				StartStep: "ask_nps",
				Steps: []models.FlowStep{
					{
						ID: "ask_nps", Type: models.StepTypeInput, Label: "Pergunta NPS", IsStartStep: true,
						Config: json.RawMessage(`{"prompt":"De 0 a 10, o quanto você recomendaria nosso serviço?","variable_name":"nps_score","next_step_id":"route_nps"}`),
					},
					{
						ID: "route_nps", Type: models.StepTypeCondition, Label: "Promotor?",
						BranchTrue: "promoter", BranchFalse: "detractor_check",
						Config: json.RawMessage(`{"left":"{{flow.nps_score}}","operator":"gte","right":"9"}`),
					},
					{
						ID: "detractor_check", Type: models.StepTypeCondition, Label: "Detrator?",
						BranchTrue: "detractor", BranchFalse: "passive",
						Config: json.RawMessage(`{"left":"{{flow.nps_score}}","operator":"lte","right":"6"}`),
					},
					{
						ID: "promoter", Type: models.StepTypeMessage, Label: "Agradece promotor",
						Config: json.RawMessage(`{"message":"🎉 Obrigado! Compartilharia com amigos? Link: https://..."}`),
					},
					{
						ID: "passive", Type: models.StepTypeMessage, Label: "Neutro",
						Config: json.RawMessage(`{"message":"Obrigado pelo feedback!"}`),
					},
					{
						ID: "detractor", Type: models.StepTypeInput, Label: "Pergunta motivo",
						Config: json.RawMessage(`{"prompt":"Sentimos muito. Pode nos contar o que pode melhorar?","variable_name":"nps_feedback","next_step_id":"detractor_tag"}`),
					},
					{
						ID: "detractor_tag", Type: models.StepTypeAddTag, Label: "Marca detrator",
						Config: json.RawMessage(`{"tag":"nps-detrator"}`),
					},
				},
			},
		},
	}
}
