package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ContactGroup persists a WhatsApp (or other channel) group so we can
// correlate: Contact X is a member of Group Y on Instance Z since date D.
// Today the WhatsApp layer exposes group info ad-hoc via GetJoinedGroups —
// this table is the CRM-side cache that powers enrichment views like
// "contacts in this group" and "groups this contact participates in".
type ContactGroup struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	InstanceID  uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`

	ChannelType string `gorm:"type:varchar(30);default:'whatsapp'" json:"channel_type"`
	GroupKey    string `gorm:"type:varchar(190);not null;index" json:"group_key"` // JID or channel-specific id
	Name        string `gorm:"type:varchar(200)" json:"name,omitempty"`
	Description string `gorm:"type:text" json:"description,omitempty"`
	AvatarURL   string `gorm:"type:text" json:"avatar_url,omitempty"`
	ParticipantCount int  `gorm:"default:0" json:"participant_count"`
	IsAnnounce       bool `gorm:"default:false" json:"is_announce"` // WhatsApp "only admins can send"
	IsLocked         bool `gorm:"default:false" json:"is_locked"`

	// First time we saw it / last seen in a sync
	FirstSeenAt time.Time  `json:"first_seen_at"`
	LastSyncAt  *time.Time `json:"last_sync_at,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (g *ContactGroup) BeforeCreate(tx *gorm.DB) error {
	if g.ID == uuid.Nil {
		g.ID = uuid.New()
	}
	if g.FirstSeenAt.IsZero() {
		g.FirstSeenAt = time.Now()
	}
	return nil
}

// ContactGroupMembership links a Contact to a ContactGroup. Kept separate
// from ContactGroup so we can persist historical memberships (left_at != nil
// means the contact has since left the group) without losing audit.
type ContactGroupMembership struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	GroupID   uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:uk_group_contact;index" json:"group_id"`
	ContactID uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:uk_group_contact;index" json:"contact_id"`
	Role      string     `gorm:"type:varchar(20);default:'member'" json:"role"` // member | admin | superadmin
	JoinedAt  time.Time  `json:"joined_at"`
	LeftAt    *time.Time `json:"left_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (m *ContactGroupMembership) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.JoinedAt.IsZero() {
		m.JoinedAt = time.Now()
	}
	return nil
}
