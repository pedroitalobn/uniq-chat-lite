package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Suppression — bloqueio global de envio outbound pra um destinatário
// dentro do workspace. Inspirado em Customer.io suppression lists.
//
// Reasons comuns: "user_optout" (clicou em descadastrar), "bounced",
// "complained", "manual_admin".
//
// Lookup é por (workspace_id, key) onde key normaliza phone/email pra
// match em qualquer canal.
type Suppression struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index:idx_suppression_lookup" json:"workspace_id"`
	// Key — telefone (E.164) OU email lowercased OU jid completo. Comparação exata.
	Key         string     `gorm:"type:varchar(255);not null;index:idx_suppression_lookup" json:"key"`
	Channel     string     `gorm:"type:varchar(30);default:'all';index" json:"channel"` // all/whatsapp/instagram/email/sms
	Reason      string     `gorm:"type:varchar(60);not null" json:"reason"`
	Note        string     `gorm:"type:text" json:"note,omitempty"`
	ContactID   *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`
	ActorUserID *uuid.UUID `gorm:"type:uuid" json:"actor_user_id,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (s *Suppression) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.Channel == "" {
		s.Channel = "all"
	}
	return nil
}

// IsSuppressed retorna true se o destinatário está na lista de bloqueio.
// channel="" matcha apenas reasons "all" + canal específico.
func IsSuppressed(db *gorm.DB, workspaceID uuid.UUID, key, channel string) bool {
	var count int64
	q := db.Model(&Suppression{}).
		Where("workspace_id = ? AND key = ?", workspaceID, key).
		Where("channel = ? OR channel = 'all'", channel)
	q.Count(&count)
	return count > 0
}
