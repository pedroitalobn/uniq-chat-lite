package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// DealStatus mirrors Pipedrive: a deal is open until you explicitly mark it
// won or lost. Archived exists for housekeeping without destroying history.
type DealStatus string

const (
	DealStatusOpen     DealStatus = "open"
	DealStatusWon      DealStatus = "won"
	DealStatusLost     DealStatus = "lost"
	DealStatusArchived DealStatus = "archived"
)

// Deal is the opportunity tracked through a funnel/pipeline. Links to a
// Contact (required) and optionally a Company and/or a source Conversation
// from the atendimento module.
type Deal struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	OwnerID     *uuid.UUID `gorm:"type:uuid;index" json:"owner_id,omitempty"`
	Owner       *User      `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`

	Title       string `gorm:"type:varchar(200);not null" json:"title"`
	Description string `gorm:"type:text" json:"description,omitempty"`

	// Money — stored as minor units (cents) to avoid floating point drift.
	Value       int64      `gorm:"default:0" json:"value"`
	Currency    string     `gorm:"type:varchar(8);default:'BRL'" json:"currency"`
	Probability *int       `gorm:"" json:"probability,omitempty"` // 0..100, default from stage
	ExpectedCloseDate *time.Time `json:"expected_close_date,omitempty"`

	// Pipeline position
	FunnelID uuid.UUID  `gorm:"type:uuid;not null;index" json:"funnel_id"`
	StageID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"stage_id"`
	Status   DealStatus `gorm:"type:varchar(20);default:'open';index" json:"status"`

	// Relationships
	ContactID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"contact_id"`
	Contact        *Contact   `gorm:"foreignKey:ContactID" json:"contact,omitempty"`
	CompanyID      *uuid.UUID `gorm:"type:uuid;index" json:"company_id,omitempty"`
	Company        *Company   `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	ConversationID *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`

	// Lifecycle timestamps
	StageChangeAt *time.Time `json:"stage_change_at,omitempty"`
	WonAt         *time.Time `gorm:"index" json:"won_at,omitempty"`
	LostAt        *time.Time `gorm:"index" json:"lost_at,omitempty"`
	LostReason    string     `gorm:"type:varchar(200)" json:"lost_reason,omitempty"`

	// Housekeeping
	Priority   string `gorm:"type:varchar(10);default:'normal'" json:"priority"` // low|normal|high|urgent
	Source     string `gorm:"type:varchar(60)" json:"source,omitempty"`          // whatsapp|website|referral|manual|…
	IsArchived bool   `gorm:"default:false;index" json:"is_archived"`

	// Tags via the same join table as Contact for reuse (deal_tags separate)
	Tags []Tag `gorm:"many2many:deal_tags;joinForeignKey:DealID;joinReferences:TagID" json:"tags,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (d *Deal) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	if d.Currency == "" {
		d.Currency = "BRL"
	}
	if d.Status == "" {
		d.Status = DealStatusOpen
	}
	if d.Priority == "" {
		d.Priority = "normal"
	}
	return nil
}

// DealActivity is the timeline of everything that happens to a deal:
// creation, stage moves, value updates, won/lost, attached message/call,
// notes. Polymorphic payload in JSON like ConversationEvent.
type DealActivityType string

const (
	DealActivityCreated        DealActivityType = "created"
	DealActivityStageChanged   DealActivityType = "stage_changed"
	DealActivityValueChanged   DealActivityType = "value_changed"
	DealActivityOwnerChanged   DealActivityType = "owner_changed"
	DealActivityWon            DealActivityType = "won"
	DealActivityLost           DealActivityType = "lost"
	DealActivityReopened       DealActivityType = "reopened"
	DealActivityNoteAdded      DealActivityType = "note_added"
	DealActivityCallLogged     DealActivityType = "call_logged"
	DealActivityEmailLogged    DealActivityType = "email_logged"
	DealActivityTaskCreated    DealActivityType = "task_created"
	DealActivityContactLinked  DealActivityType = "contact_linked"
	DealActivityCompanyLinked  DealActivityType = "company_linked"
	DealActivityTagAdded       DealActivityType = "tag_added"
	DealActivityTagRemoved     DealActivityType = "tag_removed"
)

type DealActivity struct {
	ID          uuid.UUID        `gorm:"type:uuid;primaryKey" json:"id"`
	DealID      uuid.UUID        `gorm:"type:uuid;not null;index" json:"deal_id"`
	WorkspaceID uuid.UUID        `gorm:"type:uuid;not null;index" json:"workspace_id"`
	ActorUserID *uuid.UUID       `gorm:"type:uuid;index" json:"actor_user_id,omitempty"`
	Type        DealActivityType `gorm:"type:varchar(40);index" json:"type"`
	Title       string           `gorm:"type:varchar(200)" json:"title,omitempty"`
	Body        string           `gorm:"type:text" json:"body,omitempty"`
	Payload     string           `gorm:"type:text" json:"payload,omitempty"` // JSON
	CreatedAt   time.Time        `gorm:"index" json:"created_at"`
}

func (a *DealActivity) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
