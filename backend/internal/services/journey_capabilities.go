package services

import "github.com/uniq-chat/backend/internal/models"

type JourneyCapabilityStatus string

const (
	JourneyCapabilityImplemented JourneyCapabilityStatus = "implemented"
	JourneyCapabilityPartial     JourneyCapabilityStatus = "partial"
	JourneyCapabilityMissing     JourneyCapabilityStatus = "missing"
)

type JourneyCapability struct {
	Status JourneyCapabilityStatus
	Family string
	Notes  string
}

type JourneyCapabilityMatrix struct {
	InboundWhatsAppTriggers map[models.TriggerType]JourneyCapability
	ExecutableSteps         map[models.StepType]JourneyCapability
}

func NewJourneyCapabilityMatrix() JourneyCapabilityMatrix {
	return JourneyCapabilityMatrix{
		InboundWhatsAppTriggers: map[models.TriggerType]JourneyCapability{
			models.TriggerAnyMessage:      {Status: JourneyCapabilityImplemented, Family: "inbound", Notes: "qualquer mensagem inbound"},
			models.TriggerGroupMessage:    {Status: JourneyCapabilityImplemented, Family: "inbound", Notes: "mensagem em grupo"},
			models.TriggerGroupKeyword:    {Status: JourneyCapabilityImplemented, Family: "inbound", Notes: "keyword em grupo"},
			models.TriggerGroupMention:    {Status: JourneyCapabilityPartial, Family: "inbound", Notes: "avaliado como trigger de grupo; menção específica ainda depende do parser"},
			models.TriggerPrivateMessage:  {Status: JourneyCapabilityImplemented, Family: "inbound", Notes: "mensagem privada"},
			models.TriggerPrivateKeyword:  {Status: JourneyCapabilityImplemented, Family: "inbound", Notes: "keyword em conversa privada"},
			models.TriggerFirstMessage:    {Status: JourneyCapabilityPartial, Family: "inbound", Notes: "modelado, mas a verificação de primeira conversa ainda não é centralizada"},
			models.TriggerContactVideo:    {Status: JourneyCapabilityImplemented, Family: "inbound_media", Notes: "vídeo recebido"},
			models.TriggerContactAudio:    {Status: JourneyCapabilityImplemented, Family: "inbound_media", Notes: "áudio recebido"},
			models.TriggerContactDocument: {Status: JourneyCapabilityImplemented, Family: "inbound_media", Notes: "documento recebido"},
			models.TriggerContactImage:    {Status: JourneyCapabilityImplemented, Family: "inbound_media", Notes: "imagem recebida"},
			models.TriggerContactLocation: {Status: JourneyCapabilityImplemented, Family: "inbound_media", Notes: "localização recebida"},
			models.TriggerContactCall:     {Status: JourneyCapabilityImplemented, Family: "inbound_call", Notes: "ligação recebida"},
			models.TriggerContactCallMissed: {
				Status: JourneyCapabilityImplemented,
				Family: "inbound_call",
				Notes:  "ligação perdida",
			},
			models.TriggerContactCallRejected: {
				Status: JourneyCapabilityImplemented,
				Family: "inbound_call",
				Notes:  "ligação rejeitada",
			},
			models.TriggerGroupJoin:  {Status: JourneyCapabilityImplemented, Family: "group_lifecycle", Notes: "entrada em grupo"},
			models.TriggerGroupLeave: {Status: JourneyCapabilityImplemented, Family: "group_lifecycle", Notes: "saída de grupo"},
			models.TriggerButtonClick: {
				Status: JourneyCapabilityPartial,
				Family: "interactive",
				Notes:  "tipo modelado; depende do inbound chegar normalizado como button_click",
			},
			models.TriggerListSelect: {
				Status: JourneyCapabilityPartial,
				Family: "interactive",
				Notes:  "tipo modelado; depende do inbound chegar normalizado como list_select",
			},
		},
		ExecutableSteps: map[models.StepType]JourneyCapability{
			models.StepTypeMessage:      {Status: JourneyCapabilityImplemented, Family: "communication", Notes: "envio de texto"},
			models.StepTypeButtons:      {Status: JourneyCapabilityImplemented, Family: "communication", Notes: "quick replies"},
			models.StepTypeList:         {Status: JourneyCapabilityImplemented, Family: "communication", Notes: "lista interativa"},
			models.StepTypeMedia:        {Status: JourneyCapabilityImplemented, Family: "communication", Notes: "mídia"},
			models.StepTypeAIResponse:   {Status: JourneyCapabilityImplemented, Family: "communication", Notes: "resposta via IA"},
			models.StepTypeEmail:        {Status: JourneyCapabilityPartial, Family: "communication", Notes: "depende de serviço de email configurado"},
			models.StepTypeSMS:          {Status: JourneyCapabilityPartial, Family: "communication", Notes: "stub/provedor externo"},
			models.StepTypeInput:        {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "aguarda input"},
			models.StepTypeWait:         {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "delay"},
			models.StepTypeWaitUntil:    {Status: JourneyCapabilityPartial, Family: "orchestration", Notes: "controle avançado"},
			models.StepTypeCondition:    {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "branch condicional"},
			models.StepTypeGoto:         {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "salto no fluxo"},
			models.StepTypeRandomize:    {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "split aleatório"},
			models.StepTypeMultivariate: {Status: JourneyCapabilityPartial, Family: "orchestration", Notes: "split multivariado"},
			models.StepTypeSetVariable:  {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "variável de execução"},
			models.StepTypeEnd:          {Status: JourneyCapabilityImplemented, Family: "orchestration", Notes: "fim explícito"},
			models.StepTypeAddTag:       {Status: JourneyCapabilityImplemented, Family: "crm", Notes: "adiciona tag"},
			models.StepTypeTag:          {Status: JourneyCapabilityImplemented, Family: "crm", Notes: "alias legado de add_tag"},
			models.StepTypeRemoveTag:    {Status: JourneyCapabilityImplemented, Family: "crm", Notes: "remove tag"},
			models.StepTypeUpdateStage:  {Status: JourneyCapabilityImplemented, Family: "crm", Notes: "move/cria deal em estágio"},
			models.StepTypeHandoff:      {Status: JourneyCapabilityPartial, Family: "inbox", Notes: "handoff registrado; depende de assignee válido"},
			models.StepTypeHTTP:         {Status: JourneyCapabilityImplemented, Family: "integration", Notes: "requisição HTTP"},
			models.StepTypeWebhook:      {Status: JourneyCapabilityImplemented, Family: "integration", Notes: "alias visual de http_request"},
			models.StepTypeProductSearch: {
				Status: JourneyCapabilityPartial,
				Family: "commerce",
				Notes:  "depende de catálogo/shop configurado",
			},
			models.StepTypeProductCarousel: {
				Status: JourneyCapabilityPartial,
				Family: "commerce",
				Notes:  "depende de catálogo/shop configurado",
			},
			models.StepTypeSendInTimezone: {
				Status: JourneyCapabilityPartial,
				Family: "orchestration",
				Notes:  "janela por timezone",
			},
			models.StepTypeUnsubscribe: {
				Status: JourneyCapabilityPartial,
				Family: "compliance",
				Notes:  "suppression list",
			},
		},
	}
}

func SupportsInboundWhatsAppTrigger(trigger models.TriggerType) (JourneyCapability, bool) {
	capability, ok := NewJourneyCapabilityMatrix().InboundWhatsAppTriggers[trigger]
	return capability, ok && capability.Status != JourneyCapabilityMissing
}

func SupportsExecutableStep(step models.StepType) (JourneyCapability, bool) {
	capability, ok := NewJourneyCapabilityMatrix().ExecutableSteps[step]
	return capability, ok && capability.Status != JourneyCapabilityMissing
}

func UnsupportedFlowSteps(flow *models.JourneyFlow) []models.FlowStep {
	if flow == nil {
		return nil
	}
	unsupported := make([]models.FlowStep, 0)
	for _, step := range flow.Steps {
		if _, ok := SupportsExecutableStep(step.Type); !ok {
			unsupported = append(unsupported, step)
		}
	}
	return unsupported
}
