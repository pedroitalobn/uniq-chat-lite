package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type GlobalProxyConfig struct {
	ID        string `gorm:"type:varchar(32);primaryKey" json:"id"`
	Enabled   bool   `gorm:"default:false" json:"enabled"`
	IsDefault bool   `gorm:"default:false" json:"is_default"` // padrão para auto-assign
	Provider  string `gorm:"type:varchar(30);default:'manual'" json:"provider"`
	ProxyType string `gorm:"type:varchar(10);default:'http'" json:"proxy_type"`
	Host      string `gorm:"type:varchar(255)" json:"host"`
	Port      int    `json:"port"`
	Username  string `gorm:"type:varchar(255)" json:"username"`
	Password  string `gorm:"type:varchar(512)" json:"-"`
	UseEnv    bool   `gorm:"default:true" json:"use_env"`
	IsActive  bool   `gorm:"default:true" json:"is_active"`
	Country   string `gorm:"type:varchar(10);default:'br'" json:"country"`
	Name      string `gorm:"type:varchar(100)" json:"name"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (g *GlobalProxyConfig) BeforeCreate(tx *gorm.DB) error {
	if g.ID == "" {
		g.ID = "default"
	}
	return nil
}

type ProxyUsageStats struct {
	TotalUsers            int64 `json:"total_users"`
	TotalInstances        int64 `json:"total_instances"`
	GlobalProxyInstances  int64 `json:"global_proxy_instances"`
	EligibleUsersByPlan   int64 `json:"eligible_users_by_plan"`
	ConnectedProxySamples int64 `json:"connected_proxy_samples"`
}

type ProxyUserUsage struct {
	UserID        uuid.UUID `json:"user_id"`
	Name          string    `json:"name"`
	Email         string    `json:"email"`
	PlanName      string    `json:"plan_name"`
	Instances     int64     `json:"instances"`
	Connected     int64     `json:"connected"`
	LastUpdatedAt time.Time `json:"last_updated_at"`
}
