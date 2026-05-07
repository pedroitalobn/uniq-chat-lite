package models

import "time"

// ProcessedWebhookEvent — tabela de dedup pra webhooks de provider.
// Stripe (e outros) reenviam o mesmo evento em caso de timeout / erro
// no nosso lado, e sem dedup o handler executa duas vezes (criar User
// duplicado, materializar pending 2x, etc). Antes de processar a gente
// faz INSERT … ON CONFLICT DO NOTHING; se afetou 0 rows, evento já foi
// visto e ignoramos.
//
// Por que tabela própria e não cache em memória: process restart limpa
// memória e o handler pode duplicar; deploy frequente em prod
// expõe isso. Tabela é idempotente entre instances.
type ProcessedWebhookEvent struct {
	// EventID = id do evento do provider (ex: Stripe `evt_...`).
	// Único per provider; usamos como chave primária composta com Provider.
	EventID  string `gorm:"primaryKey;type:varchar(190)"`
	Provider string `gorm:"primaryKey;type:varchar(20)"` // "stripe", "asaas", etc.

	ProcessedAt time.Time `gorm:"autoCreateTime"`
}
