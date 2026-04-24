package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// FunnelViewKind is the display flavor: kanban by stage, list/table with
// sort & filters, or timeline ordered by stage_change_at. Inspired by
// HubSpot/Twenty views.
type FunnelViewKind string

const (
	FunnelViewKanban   FunnelViewKind = "kanban"
	FunnelViewList     FunnelViewKind = "list"
	FunnelViewTable    FunnelViewKind = "table"
	FunnelViewForecast FunnelViewKind = "forecast"
)

// FunnelView is a saved configuration (filters, sort, grouping, visible
// columns) of a funnel. Views live at workspace OR user scope: when
// OwnerUserID is set, only the owner sees it; when nil, the whole workspace
// shares it.
//
// FilterJSON, SortJSON, ColumnsJSON and ExtraJSON are free-form so the UI
// can evolve without schema churn — the backend just persists and echoes.
type FunnelView struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID      `gorm:"type:uuid;not null;index" json:"workspace_id"`
	FunnelID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"funnel_id"`
	OwnerUserID *uuid.UUID     `gorm:"type:uuid;index" json:"owner_user_id,omitempty"`
	Name        string         `gorm:"type:varchar(120);not null" json:"name"`
	Icon        string         `gorm:"type:varchar(40)" json:"icon,omitempty"`
	Kind        FunnelViewKind `gorm:"type:varchar(20);default:'kanban'" json:"kind"`
	FilterJSON  string         `gorm:"type:text" json:"filter,omitempty"`
	SortJSON    string         `gorm:"type:text" json:"sort,omitempty"`
	ColumnsJSON string         `gorm:"type:text" json:"columns,omitempty"`
	ExtraJSON   string         `gorm:"type:text" json:"extra,omitempty"`
	IsDefault   bool           `gorm:"default:false" json:"is_default"`
	SortOrder   int            `gorm:"default:0" json:"sort_order"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (v *FunnelView) BeforeCreate(tx *gorm.DB) error {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	if v.Kind == "" {
		v.Kind = FunnelViewKanban
	}
	return nil
}
