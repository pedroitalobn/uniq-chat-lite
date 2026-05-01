package models

import (
	"time"

	"github.com/google/uuid"
)

// MessageReceipt — registro individual de quem recebeu/leu uma mensagem.
// Usado pra painel "Visto por X, Y, Z" em grupos. Em conversas 1:1,
// MessageLog.DeliveredAt/ReadAt já basta; em grupos, precisamos de N
// linhas (uma por participante) pra montar a lista.
//
// Tipos comuns:
//   - "delivered" — entregue ao device
//   - "read"      — usuário abriu e viu
//   - "played"    — view-once aberto
type MessageReceipt struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	MessageLogID  uuid.UUID `gorm:"type:uuid;not null;index:idx_msg_receipt_msg" json:"message_log_id"`
	ParticipantJID string   `gorm:"column:participant_j_id;type:varchar(120);not null;index:idx_msg_receipt_msg,priority:2" json:"participant_jid"`
	Type          string    `gorm:"type:varchar(20);not null" json:"type"`
	Timestamp     time.Time `json:"timestamp"`
	CreatedAt     time.Time `json:"created_at"`
}

func (MessageReceipt) TableName() string { return "message_receipts" }
