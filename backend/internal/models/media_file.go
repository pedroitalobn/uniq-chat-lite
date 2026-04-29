package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MediaFileStatus string

const (
	MediaFileStatusReady   MediaFileStatus = "ready"
	MediaFileStatusMissing MediaFileStatus = "missing"
)

type MediaFile struct {
	ID           uuid.UUID       `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID  *uuid.UUID      `gorm:"type:uuid;index" json:"workspace_id,omitempty"`
	UserID       *uuid.UUID      `gorm:"type:uuid;index" json:"user_id,omitempty"`
	InstanceID   *uuid.UUID      `gorm:"type:uuid;index" json:"instance_id,omitempty"`
	MessageLogID *uuid.UUID      `gorm:"type:uuid;index" json:"message_log_id,omitempty"`
	Bucket       string          `gorm:"type:varchar(120)" json:"bucket,omitempty"`
	Provider     string          `gorm:"type:varchar(40);default:'s3'" json:"provider"`
	ObjectKey    string          `gorm:"type:text;not null;uniqueIndex" json:"object_key"`
	PublicURL    string          `gorm:"type:text" json:"public_url,omitempty"`
	MediaType    string          `gorm:"type:varchar(30);index" json:"media_type,omitempty"`
	MimeType     string          `gorm:"type:varchar(120)" json:"mime_type,omitempty"`
	Filename     string          `gorm:"type:varchar(255)" json:"filename,omitempty"`
	SizeBytes    int64           `json:"size_bytes,omitempty"`
	Status       MediaFileStatus `gorm:"type:varchar(20);default:'ready';index" json:"status"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

func (m *MediaFile) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.Status == "" {
		m.Status = MediaFileStatusReady
	}
	if m.Provider == "" {
		m.Provider = "s3"
	}
	return nil
}
