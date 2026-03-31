package models

import (
	"encoding/json"
	"strings"
	"time"
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
	GroupJID        string     `gorm:"type:varchar(255)" json:"group_jid,omitempty"`
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

func (j *Journey) ShouldTrigger(messageText, groupJID string) bool {
	if j.Status != "active" {
		return false
	}

	if j.GroupJID != "" && j.GroupJID != groupJID {
		return false
	}

	if j.Keywords == "" {
		return true
	}

	var keywords []string
	if err := json.Unmarshal([]byte(j.Keywords), &keywords); err != nil {
		return false
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

type TriggerType string

const (
	TriggerGroupKeyword   TriggerType = "group_keyword"
	TriggerGroupMessage   TriggerType = "group_message"
	TriggerPrivateKeyword TriggerType = "private_keyword"
	TriggerContactTag     TriggerType = "contact_tag"
	TriggerScheduled      TriggerType = "scheduled"
	TriggerGroupJoin      TriggerType = "group_join"
	TriggerGroupLeave     TriggerType = "group_leave"
	TriggerAny            TriggerType = "any"
)

type ActionType string

const (
	ActionSendMessage ActionType = "send_message"
	ActionSendPrivate ActionType = "send_private"
	ActionAddTag      ActionType = "add_tag"
	ActionRemoveTag   ActionType = "remove_tag"
	ActionSendGroup   ActionType = "send_group"
	ActionAIResponse  ActionType = "ai_response"
	ActionWait        ActionType = "wait"
	ActionWebhook     ActionType = "webhook"
)

type StepType string

const (
	StepTypeMessage    StepType = "message"
	StepTypeWait       StepType = "wait"
	StepTypeCondition  StepType = "condition"
	StepTypeTag        StepType = "tag"
	StepTypeAIResponse StepType = "ai_response"
	StepTypeWebhook    StepType = "webhook"
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
