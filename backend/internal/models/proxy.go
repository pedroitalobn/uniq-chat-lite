package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Proxy é a entidade única do catálogo de proxies.
// Um proxy é "da plataforma" (is_platform=true, owner_id=nil) — gerenciado
// pelo admin e disponível pra todos — ou "custom" (is_platform=false,
// owner_id=user) — criado pelo usuário na aba Integrations.
//
// Servers apontam pra exatamente um Proxy (ou nenhum). Instâncias herdam
// do server onde estão e nunca carregam proxy próprio.
type Proxy struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	OwnerID    *uuid.UUID `gorm:"type:uuid;index" json:"owner_id,omitempty"`
	Owner      *User      `gorm:"foreignKey:OwnerID" json:"-"`
	IsPlatform bool       `gorm:"default:false;index" json:"is_platform"`

	Name     string `gorm:"type:varchar(100);not null" json:"name"`
	Country  string `gorm:"type:varchar(10);default:'br'" json:"country"`
	Provider string `gorm:"type:varchar(30);default:'manual'" json:"provider"`

	ProxyType string `gorm:"type:varchar(10);default:'http'" json:"proxy_type"`
	Host      string `gorm:"type:varchar(255)" json:"host"`
	Port      int    `json:"port"`
	Username  string `gorm:"type:varchar(255)" json:"username"`
	Password  string `gorm:"type:varchar(512)" json:"-"` // encrypted

	// UseEnv aplica-se apenas a proxies da plataforma: quando true, host/
	// port/user/pass são sobrescritos pelas envs BRIGHTDATA_* no momento
	// da conexão. Útil pra rotação de credenciais sem update no banco.
	UseEnv   bool `gorm:"default:false" json:"use_env"`
	IsActive bool `gorm:"default:true" json:"is_active"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Proxy) TableName() string { return "proxies" }

// ProxyMode é legado — os valores ainda são aceitos por handlers antigos mas
// o resolver novo ignora; a configuração efetiva vem do Proxy vinculado ao
// Server. Mantido apenas para não quebrar código que ainda referencia as
// constantes.
type ProxyMode string

const (
	ProxyModeNone        ProxyMode = "none"
	ProxyModeManual      ProxyMode = "manual"
	ProxyModeResidencial ProxyMode = "residencial"
	ProxyModeGlobal      ProxyMode = "global"
	ProxyModeInherit     ProxyMode = "inherit"
)

// ProxyUsageStats é usado pelo endpoint admin de estatísticas de proxy.
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

func (p *Proxy) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// VisibleTo returns whether the given user can see/use this proxy.
func (p *Proxy) VisibleTo(userID uuid.UUID) bool {
	if p.IsPlatform {
		return true
	}
	return p.OwnerID != nil && *p.OwnerID == userID
}

// EditableBy returns whether the given user can edit this proxy.
// Platform proxies can only be edited by super admins (caller must check
// that separately); this method only validates ownership.
func (p *Proxy) EditableBy(userID uuid.UUID) bool {
	if p.IsPlatform {
		return false
	}
	return p.OwnerID != nil && *p.OwnerID == userID
}
