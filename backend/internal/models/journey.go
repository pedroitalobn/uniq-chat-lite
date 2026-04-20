package models

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Journey struct {
	ID              string     `gorm:"primaryKey" json:"id"`
	UserID          string     `gorm:"not null;index" json:"user_id"`
	InstanceID      string     `gorm:"index" json:"instance_id,omitempty"`
	Name            string     `gorm:"type:varchar(255)" json:"name"`
	Description     string     `gorm:"type:text" json:"description,omitempty"`
	Prompt          string     `gorm:"type:text;not null" json:"prompt"`
	TriggerType     string     `gorm:"type:varchar(50);not null;default:'group_keyword'" json:"trigger_type"`
	TriggerFilter   string     `gorm:"type:text" json:"trigger_filter"`
	TriggerConfig   string     `gorm:"type:text" json:"trigger_config,omitempty"`
	GroupJID        string     `gorm:"column:group_jid;type:varchar(255)" json:"group_jid,omitempty"`
	Keywords        string     `gorm:"type:text" json:"keywords,omitempty"`
	MessageTemplate string     `gorm:"type:text" json:"message_template,omitempty"`
	Flow            string     `gorm:"type:text" json:"flow,omitempty"`
	ParsedRules     string     `gorm:"type:text;not null;default:'{}'" json:"parsed_rules"`
	Status          string     `gorm:"type:varchar(20);not null;default:'active'" json:"status"`
	ResponseMode    string     `gorm:"type:varchar(20);default:'private'" json:"response_mode"`
	Invocations     int        `gorm:"not null;default:0" json:"invocations"`
	CompletedCount  int        `gorm:"not null;default:0" json:"completed_count"`
	LastRunAt       *time.Time `json:"last_run_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (j *Journey) BeforeCreate(tx *gorm.DB) error {
	if j.ID == "" {
		j.ID = uuid.New().String()
	}
	return nil
}

func (j *Journey) ShouldTrigger(messageText, groupJID, messageType string, isGroup bool) bool {
	if j.Status != "active" {
		return false
	}

	// Check if this is a group trigger
	isGroupTrigger := strings.Contains(j.TriggerType, "group_")
	if isGroupTrigger && !isGroup {
		return false
	}

	// Check if this is a private trigger
	isPrivateTrigger := j.TriggerType == "private_message" || j.TriggerType == "private_keyword"
	if isPrivateTrigger && isGroup {
		return false
	}

	// Check group JID match
	if j.GroupJID != "" && j.GroupJID != groupJID {
		return false
	}

	// Handle media type triggers
	switch TriggerType(j.TriggerType) {
	case TriggerContactVideo:
		if messageType != "video" {
			return false
		}
	case TriggerContactAudio:
		if messageType != "audio" {
			return false
		}
	case TriggerContactDocument:
		if messageType != "document" {
			return false
		}
	case TriggerContactImage:
		if messageType != "image" {
			return false
		}
	case TriggerContactCall:
		if messageType != "call" {
			return false
		}
	case TriggerGroupJoin:
		if messageType != "group_join" {
			return false
		}
	case TriggerGroupLeave:
		if messageType != "group_leave" {
			return false
		}
	default:
		// For other triggers, continue checking
	}

	// For message triggers, check keywords (including media triggers)
	if j.Keywords == "" || j.Keywords == "[]" {
		return true
	}

	var keywords []string
	if err := json.Unmarshal([]byte(j.Keywords), &keywords); err != nil {
		return false
	}

	if len(keywords) == 0 {
		return true
	}

	lowerMsg := strings.ToLower(messageText)
	for _, kw := range keywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return true
		}
	}
	return false
}

func (j *Journey) GetKeywords() []string {
	if j.Keywords == "" {
		return []string{}
	}
	var keywords []string
	json.Unmarshal([]byte(j.Keywords), &keywords)
	return keywords
}

func (j *Journey) GetFlow() *JourneyFlow {
	if j.Flow == "" {
		return nil
	}
	var flow JourneyFlow
	if err := json.Unmarshal([]byte(j.Flow), &flow); err != nil {
		return nil
	}
	return &flow
}

func (j *Journey) HasFlow() bool {
	flow := j.GetFlow()
	return flow != nil && len(flow.Steps) > 0
}

// SetFlow serializa e persiste o fluxo no campo JSON
func (j *Journey) SetFlow(flow *JourneyFlow) error {
	if flow == nil {
		j.Flow = ""
		return nil
	}
	data, err := json.Marshal(flow)
	if err != nil {
		return err
	}
	j.Flow = string(data)
	return nil
}

// FindStep localiza um step pelo ID no flow
func (f *JourneyFlow) FindStep(id string) *FlowStep {
	if f == nil {
		return nil
	}
	for i := range f.Steps {
		if f.Steps[i].ID == id {
			return &f.Steps[i]
		}
	}
	return nil
}

// FirstStep retorna o step inicial (StartStep ou IsStartStep ou primeiro)
func (f *JourneyFlow) FirstStep() *FlowStep {
	if f == nil || len(f.Steps) == 0 {
		return nil
	}
	if f.StartStep != "" {
		if s := f.FindStep(f.StartStep); s != nil {
			return s
		}
	}
	for i := range f.Steps {
		if f.Steps[i].IsStartStep {
			return &f.Steps[i]
		}
	}
	return &f.Steps[0]
}

// ExecutionVars representa variáveis de contexto persistidas em JourneyExecution.Metadata
type ExecutionVars struct {
	Contact  map[string]interface{} `json:"contact,omitempty"`
	Flow     map[string]interface{} `json:"flow,omitempty"`
	LastInput string                `json:"last_input,omitempty"`
	WaitingStep string              `json:"waiting_step,omitempty"` // step id aguardando input
	Instance map[string]interface{} `json:"instance,omitempty"`
}

// IsReservedCommand retorna o nome da ação se o texto for um comando reservado
func IsReservedCommand(text string) string {
	t := strings.TrimSpace(text)
	if t == "" || t[0] != '/' {
		return ""
	}
	// Extrai primeira palavra
	first := t
	if idx := strings.IndexAny(t, " \t\n"); idx > 0 {
		first = t[:idx]
	}
	first = strings.ToLower(first)
	if act, ok := ReservedCommands[first]; ok {
		return act
	}
	return ""
}

type TriggerType string

const (
	TriggerGroupMessage    TriggerType = "group_message"
	TriggerGroupKeyword    TriggerType = "group_keyword"
	TriggerGroupMention    TriggerType = "group_mention"
	TriggerPrivateMessage  TriggerType = "private_message"
	TriggerPrivateKeyword  TriggerType = "private_keyword"
	TriggerContactCall     TriggerType = "contact_call"
	TriggerContactVideo    TriggerType = "contact_media_video"
	TriggerContactAudio    TriggerType = "contact_media_audio"
	TriggerContactDocument TriggerType = "contact_media_document"
	TriggerContactImage    TriggerType = "contact_media_image"
	TriggerAnyMessage      TriggerType = "any_message"
	TriggerNoResponse      TriggerType = "no_response"
	TriggerFirstMessage    TriggerType = "first_message"
	TriggerGroupJoin       TriggerType = "group_join"
	TriggerGroupLeave      TriggerType = "group_leave"
	TriggerScheduled       TriggerType = "scheduled"
	TriggerContactTag      TriggerType = "contact_tag"
	TriggerUserCommand     TriggerType = "user_command" // /menu, /stop, /help...
	TriggerButtonClick     TriggerType = "button_click" // id de quick-reply
	TriggerListSelect      TriggerType = "list_select"  // row id de lista
)

// Reserved commands (always intercepted before flow evaluation)
var ReservedCommands = map[string]string{
	"/stop":    "cancel_execution",
	"/parar":   "cancel_execution",
	"/menu":    "restart_flow",
	"/restart": "restart_flow",
	"/help":    "show_help",
	"/ajuda":   "show_help",
}

type ActionType string

const (
	ActionSendMessage  ActionType = "send_message"
	ActionSendPrivate  ActionType = "send_private"
	ActionAddTag       ActionType = "add_tag"
	ActionRemoveTag    ActionType = "remove_tag"
	ActionAssignAgent  ActionType = "assign_agent"
	ActionCreateTicket ActionType = "create_ticket"
	ActionWebhook      ActionType = "webhook"
	ActionSendGroup    ActionType = "send_group"
	ActionAIResponse   ActionType = "ai_response"
	ActionWait         ActionType = "wait"
	// Novas actions para CRM
	ActionCreateContact ActionType = "create_contact" // Criar/lead no CRM
	ActionUpdateStage   ActionType = "update_stage"   // Atualizar estágio do funil
	ActionAddToInbox    ActionType = "add_to_inbox"   // Adicionar ao inbox
	ActionAssignUser    ActionType = "assign_user"    // Atribuir a um usuário
	ActionCreateLead    ActionType = "create_lead"    // Criar lead no funil
)

type StepType string

const (
	StepTypeMessage     StepType = "message"
	StepTypeWait        StepType = "wait"
	StepTypeCondition   StepType = "condition"
	StepTypeTag         StepType = "tag"
	StepTypeAIResponse  StepType = "ai_response"
	StepTypeWebhook     StepType = "webhook"
	StepTypeButtons     StepType = "buttons"      // mensagem com quick-replies
	StepTypeList        StepType = "list"         // lista interativa
	StepTypeInput       StepType = "input"        // capturar resposta do usuário em variável
	StepTypeMedia       StepType = "media"        // enviar imagem/vídeo/áudio/doc
	StepTypeHTTP        StepType = "http_request" // chamar API externa
	StepTypeHandoff     StepType = "handoff"      // transferir para humano
	StepTypeGoto        StepType = "goto"         // pular para step/jornada
	StepTypeRandomize   StepType = "randomize"    // A/B split
	StepTypeSetVariable StepType = "set_variable" // define variável no contexto
	StepTypeUpdateStage StepType = "update_stage" // atualiza estágio CRM
	StepTypeAddTag      StepType = "add_tag"      // adiciona tag no contato
	StepTypeRemoveTag   StepType = "remove_tag"   // remove tag
	StepTypeEnd         StepType = "end"          // encerra execução explicitamente
)

type FlowStep struct {
	ID          string          `json:"id"`
	Type        StepType        `json:"type"`
	Label       string          `json:"label,omitempty"`
	Config      json.RawMessage `json:"config,omitempty"`
	NextStepID  string          `json:"next_step_id,omitempty"`
	IsStartStep bool            `json:"is_start_step,omitempty"`
	BranchTrue  string          `json:"branch_true,omitempty"`
	BranchFalse string          `json:"branch_false,omitempty"`
}

type JourneyFlow struct {
	Steps     []FlowStep `json:"steps"`
	StartStep string     `json:"start_step,omitempty"`
}

type JourneyTrigger struct {
	Type        TriggerType `json:"type"`
	GroupJID    string      `json:"group_jid,omitempty"`
	GroupName   string      `json:"group_name,omitempty"`
	Keywords    []string    `json:"keywords,omitempty"`
	Conditions  []string    `json:"conditions,omitempty"`
	Description string      `json:"description,omitempty"`
}
