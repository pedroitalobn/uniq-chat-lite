package models

import "time"

import "github.com/google/uuid"

// PresenceStatus is the agent availability for receiving new conversations.
type PresenceStatus string

const (
	PresenceOnline  PresenceStatus = "online"
	PresenceAway    PresenceStatus = "away"
	PresenceBusy    PresenceStatus = "busy"
	PresenceOffline PresenceStatus = "offline"
)

// UserPresence is the per-workspace live status for each agent. active_count
// is a cache of open conversations assigned to that user in that workspace,
// used to enforce Queue.MaxConcurrentPerUser and by least_busy strategy.
type UserPresence struct {
	UserID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"user_id"`
	WorkspaceID   uuid.UUID      `gorm:"type:uuid;primaryKey" json:"workspace_id"`
	Status        PresenceStatus `gorm:"type:varchar(20);default:'offline'" json:"status"`
	StatusMessage string         `gorm:"type:varchar(140)" json:"status_message,omitempty"`
	AwayReason    string         `gorm:"type:varchar(50)" json:"away_reason,omitempty"`
	MaxLoad       int            `gorm:"default:0" json:"max_load"`
	ActiveCount   int            `gorm:"default:0" json:"active_count"`
	LastSeenAt    time.Time      `json:"last_seen_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}
