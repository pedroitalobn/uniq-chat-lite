package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// RecoverySnapshot stores a snapshot of groups (with invite links) taken
// before or at the time a number gets banned, so the data can be used to
// rejoin groups and resume conversations after reconnecting with a new number.
type RecoverySnapshot struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	InstanceID uuid.UUID `gorm:"type:uuid;uniqueIndex;not null"`
	// Groups is a JSON-encoded array of GroupSnapshotEntry.
	Groups string `gorm:"type:text"`
	// Contacts is a JSON-encoded array of ContactSnapshotEntry.
	Contacts string `gorm:"type:text"`
	// SnapshotSchedule: "", "daily", "weekly"
	SnapshotSchedule string `gorm:"type:varchar(20);default:''"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (r *RecoverySnapshot) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// GroupSnapshotEntry is one record inside RecoverySnapshot.Groups (JSON).
type GroupSnapshotEntry struct {
	JID         string `json:"jid"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MemberCount int    `json:"member_count"`
	IsAdmin     bool   `json:"is_admin"`
	InviteLink  string `json:"invite_link,omitempty"`
}

type ContactSnapshotEntry struct {
	JID          string    `json:"jid"`
	Phone        string    `json:"phone"`
	Name         string    `json:"name,omitempty"`
	MessageCount int       `json:"message_count"`
	LastMessage  time.Time `json:"last_message"`
}
