package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CSATSurvey is the post-resolve customer satisfaction survey. A token lets
// the customer answer it without authentication via /csat/:token.
type CSATSurvey struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	ConversationID uuid.UUID  `gorm:"type:uuid;not null;index" json:"conversation_id"`
	WorkspaceID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Token          string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"token"`
	SentAt         time.Time  `json:"sent_at"`
	AnsweredAt     *time.Time `json:"answered_at,omitempty"`
	Rating         *int       `json:"rating,omitempty"` // 1..5
	Comment        string     `gorm:"type:text" json:"comment,omitempty"`
	Channel        string     `gorm:"type:varchar(30)" json:"channel,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func (s *CSATSurvey) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.SentAt.IsZero() {
		s.SentAt = time.Now()
	}
	return nil
}
