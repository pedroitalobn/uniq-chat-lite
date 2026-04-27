package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AuditLog registra ações sensíveis (admin/auth/billing). Usado pra
// investigar ataques, abuse de admin, e responder LGPD ("quem mexeu nos
// meus dados?"). Append-only: nunca atualiza ou deleta registros.
//
// Indexação:
//   - actor_user_id: "tudo que fulano fez"
//   - target_type+target_id: "tudo que aconteceu com este recurso"
//   - created_at desc: feed cronológico no admin panel
type AuditLog struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`

	ActorUserID *uuid.UUID `gorm:"type:uuid;index" json:"actor_user_id,omitempty"`
	ActorEmail  string     `gorm:"type:varchar(255);index" json:"actor_email,omitempty"`
	ActorRole   string     `gorm:"type:varchar(50)" json:"actor_role,omitempty"`

	// Ex: "user.delete", "user.update", "plan.change", "2fa.enable",
	// "auth.login_success", "auth.login_failed", "admin.access".
	Action string `gorm:"type:varchar(60);not null;index" json:"action"`

	// Recurso afetado (opcional). target_type ex: "user", "workspace",
	// "instance", "plan".
	TargetType string     `gorm:"type:varchar(40);index:idx_audit_target" json:"target_type,omitempty"`
	TargetID   *uuid.UUID `gorm:"type:uuid;index:idx_audit_target" json:"target_id,omitempty"`

	IPAddress  string `gorm:"type:varchar(64);index" json:"ip_address,omitempty"`
	UserAgent  string `gorm:"type:varchar(512)" json:"user_agent,omitempty"`

	// Detalhes livres (JSON). Use pra antes/depois em updates, motivo, etc.
	Metadata string `gorm:"type:text" json:"metadata,omitempty"`

	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (a *AuditLog) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
