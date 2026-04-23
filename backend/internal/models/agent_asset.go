package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AgentAssetCategory string

const (
	AgentAssetKnowledge AgentAssetCategory = "knowledge"
	AgentAssetFAQ       AgentAssetCategory = "faq"
	AgentAssetSkill     AgentAssetCategory = "skill"
)

// AgentAsset stores uploaded documents and markdown skills attached to an instance agent.
type AgentAsset struct {
	ID              uuid.UUID          `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceAgentID uuid.UUID          `gorm:"type:uuid;not null;index" json:"instance_agent_id"`
	Category        AgentAssetCategory `gorm:"type:varchar(20);not null;index" json:"category"`
	Name            string             `gorm:"type:varchar(255);not null" json:"name"`
	FileName        string             `gorm:"type:varchar(255);not null" json:"file_name"`
	ContentType     string             `gorm:"type:varchar(120)" json:"content_type,omitempty"`
	SizeBytes       int64              `json:"size_bytes"`
	ExtractedText   string             `gorm:"type:text" json:"extracted_text,omitempty"`
	ContentBase64   string             `gorm:"type:text" json:"-"`
	IsActive        bool               `gorm:"default:true" json:"is_active"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

func (a *AgentAsset) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
