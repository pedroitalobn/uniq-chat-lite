package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ConversationStatus string
type ConversationPriority string

const (
	ConversationStatusOpen     ConversationStatus = "open"
	ConversationStatusPending  ConversationStatus = "pending"
	ConversationStatusResolved ConversationStatus = "resolved"
	ConversationStatusClosed   ConversationStatus = "closed"
	ConversationStatusSnoozed  ConversationStatus = "snoozed"

	ConversationPriorityLow    ConversationPriority = "low"
	ConversationPriorityNormal ConversationPriority = "normal"
	ConversationPriorityHigh   ConversationPriority = "high"
	ConversationPriorityUrgent ConversationPriority = "urgent"
)

// Conversation is a ticket — the central unit of customer service work.
// One "live" Conversation exists per (workspace, instance, channel_key) via a
// partial unique index applied in migrations (status IN open/pending/snoozed).
type Conversation struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index:idx_conv_workspace" json:"workspace_id"`
	InstanceID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	Instance    *Instance  `gorm:"foreignKey:InstanceID" json:"instance,omitempty"`
	ContactID   *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`
	Contact     *Contact   `gorm:"foreignKey:ContactID" json:"contact,omitempty"`

	ChannelType string `gorm:"type:varchar(30);index" json:"channel_type"`
	ChannelKey  string `gorm:"type:varchar(190);index" json:"channel_key"`
	ThreadKey   string `gorm:"type:varchar(190);index" json:"thread_key,omitempty"`

	QueueID        *uuid.UUID `gorm:"type:uuid;index" json:"queue_id,omitempty"`
	DepartmentID   *uuid.UUID `gorm:"type:uuid;index" json:"department_id,omitempty"`
	TeamID         *uuid.UUID `gorm:"type:uuid;index" json:"team_id,omitempty"`
	AssignedUserID *uuid.UUID `gorm:"type:uuid;index" json:"assigned_user_id,omitempty"`
	AssignedUser   *User      `gorm:"foreignKey:AssignedUserID" json:"assigned_user,omitempty"`

	Status    ConversationStatus   `gorm:"type:varchar(20);default:'open';index" json:"status"`
	Priority  ConversationPriority `gorm:"type:varchar(10);default:'normal'" json:"priority"`
	SubStatus string               `gorm:"type:varchar(40)" json:"sub_status,omitempty"`
	Subject   string               `gorm:"type:varchar(255)" json:"subject,omitempty"`

	FirstResponseAt   *time.Time `json:"first_response_at,omitempty"`
	LastCustomerMsgAt *time.Time `json:"last_customer_msg_at,omitempty"`
	LastAgentMsgAt    *time.Time `json:"last_agent_msg_at,omitempty"`
	SnoozedUntil      *time.Time `json:"snoozed_until,omitempty"`
	ResolvedAt        *time.Time `json:"resolved_at,omitempty"`
	ClosedAt          *time.Time `gorm:"index" json:"closed_at,omitempty"`
	ReopenedAt        *time.Time `json:"reopened_at,omitempty"`
	ReopenCount       int        `gorm:"default:0" json:"reopen_count"`

	UnreadCount      int `gorm:"default:0" json:"unread_count"`
	AgentUnreadCount int `gorm:"default:0" json:"agent_unread_count"`
	MessageCount     int `gorm:"default:0" json:"message_count"`

	LastMessageAt      *time.Time `gorm:"index:idx_conv_last_msg" json:"last_message_at,omitempty"`
	LastMessagePreview string     `gorm:"type:varchar(280)" json:"last_message_preview,omitempty"`
	LastMessageFromMe  bool       `gorm:"default:false" json:"last_message_from_me"`

	FunnelID *uuid.UUID `gorm:"type:uuid;index" json:"funnel_id,omitempty"`
	StageID  *uuid.UUID `gorm:"type:uuid;index" json:"stage_id,omitempty"`

	IsBotActive bool `gorm:"default:false" json:"is_bot_active"`
	IsArchived  bool `gorm:"default:false;index" json:"is_archived"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `gorm:"index" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (c *Conversation) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.Status == "" {
		c.Status = ConversationStatusOpen
	}
	if c.Priority == "" {
		c.Priority = ConversationPriorityNormal
	}
	return nil
}

// IsLive returns true when the conversation blocks the creation of a new one
// for the same (workspace, instance, channel_key) tuple.
func (c *Conversation) IsLive() bool {
	switch c.Status {
	case ConversationStatusOpen, ConversationStatusPending, ConversationStatusSnoozed:
		return true
	}
	return false
}

// ConversationEventType describes the class of a timeline entry.
type ConversationEventType string

const (
	ConvEventMessage             ConversationEventType = "message"
	ConvEventNote                ConversationEventType = "note"
	ConvEventAssignmentChanged   ConversationEventType = "assignment_changed"
	ConvEventStatusChanged       ConversationEventType = "status_changed"
	ConvEventQueueChanged        ConversationEventType = "queue_changed"
	ConvEventTeamChanged         ConversationEventType = "team_changed"
	ConvEventDepartmentChanged   ConversationEventType = "department_changed"
	ConvEventPriorityChanged     ConversationEventType = "priority_changed"
	ConvEventTagAdded            ConversationEventType = "tag_added"
	ConvEventTagRemoved          ConversationEventType = "tag_removed"
	ConvEventSnoozed             ConversationEventType = "snoozed"
	ConvEventUnsnoozed           ConversationEventType = "unsnoozed"
	ConvEventReopened            ConversationEventType = "reopened"
	ConvEventTransferred         ConversationEventType = "transferred"
	ConvEventSLABreached         ConversationEventType = "sla_breached"
	ConvEventCSATSent            ConversationEventType = "csat_sent"
	ConvEventCSATAnswered        ConversationEventType = "csat_answered"
	ConvEventBotHandoff          ConversationEventType = "bot_handoff"
	ConvEventParticipantAdded    ConversationEventType = "participant_added"
	ConvEventParticipantRemoved  ConversationEventType = "participant_removed"
)

type ConversationActor string

const (
	ActorUser     ConversationActor = "user"
	ActorSystem   ConversationActor = "system"
	ActorBot      ConversationActor = "bot"
	ActorCustomer ConversationActor = "customer"
)

// ConversationEvent is an audit/timeline entry of anything that happens in a
// conversation. Intercom-style: messages point back via MessageLogID.
type ConversationEvent struct {
	ID                  uuid.UUID             `gorm:"type:uuid;primaryKey" json:"id"`
	ConversationID      uuid.UUID             `gorm:"type:uuid;not null;index" json:"conversation_id"`
	WorkspaceID         uuid.UUID             `gorm:"type:uuid;not null;index" json:"workspace_id"`
	ActorType           ConversationActor     `gorm:"type:varchar(20)" json:"actor_type"`
	ActorUserID         *uuid.UUID            `gorm:"type:uuid;index" json:"actor_user_id,omitempty"`
	EventType           ConversationEventType `gorm:"type:varchar(40);index" json:"event_type"`
	Payload             string                `gorm:"type:text" json:"payload,omitempty"`
	MessageLogID        *uuid.UUID            `gorm:"type:uuid;index" json:"message_log_id,omitempty"`
	IsVisibleToCustomer bool                  `gorm:"default:false" json:"is_visible_to_customer"`
	CreatedAt           time.Time             `gorm:"index" json:"created_at"`
}

func (e *ConversationEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}

// ConversationAssignment keeps an immutable history of who was assigned and
// why, so supervisors can audit transfers and auto-reassignments.
type ConversationAssignment struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	ConversationID uuid.UUID  `gorm:"type:uuid;not null;index" json:"conversation_id"`
	WorkspaceID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	FromUserID     *uuid.UUID `gorm:"type:uuid" json:"from_user_id,omitempty"`
	ToUserID       *uuid.UUID `gorm:"type:uuid;index" json:"to_user_id,omitempty"`
	FromQueueID    *uuid.UUID `gorm:"type:uuid" json:"from_queue_id,omitempty"`
	ToQueueID      *uuid.UUID `gorm:"type:uuid" json:"to_queue_id,omitempty"`
	Reason         string     `gorm:"type:varchar(40)" json:"reason"`
	ActorUserID    *uuid.UUID `gorm:"type:uuid" json:"actor_user_id,omitempty"`
	Note           string     `gorm:"type:text" json:"note,omitempty"`
	CreatedAt      time.Time  `gorm:"index" json:"created_at"`
}

func (a *ConversationAssignment) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// ConversationNote is a private note attached to a conversation, visible only
// to internal agents (never sent through the channel).
type ConversationNote struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	ConversationID uuid.UUID      `gorm:"type:uuid;not null;index" json:"conversation_id"`
	WorkspaceID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"workspace_id"`
	AuthorUserID   uuid.UUID      `gorm:"type:uuid;not null;index" json:"author_user_id"`
	Author         *User          `gorm:"foreignKey:AuthorUserID" json:"author,omitempty"`
	Body           string         `gorm:"type:text;not null" json:"body"`
	MentionedJSON  string         `gorm:"type:text" json:"mentioned,omitempty"` // JSON []uuid
	IsPinned       bool           `gorm:"default:false" json:"is_pinned"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

func (n *ConversationNote) BeforeCreate(tx *gorm.DB) error {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	return nil
}

// ConversationParticipant is a collaborator beyond the assignee (follower,
// collaborator, watcher). Used to broadcast WS events to interested parties.
type ConversationParticipant struct {
	ConversationID uuid.UUID `gorm:"type:uuid;primaryKey" json:"conversation_id"`
	UserID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	Role           string    `gorm:"type:varchar(20);default:'follower'" json:"role"`
	AddedAt        time.Time `json:"added_at"`
}
