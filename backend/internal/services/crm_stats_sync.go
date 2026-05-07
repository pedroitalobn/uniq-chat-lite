package services

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
)

// CrmStatsSync — recalcula denormalizações de Company/Contact a cada
// 5 min. As colunas Company.contact_count / Company.deal_count /
// Company.open_deal_sum / Contact.deals_open / Contact.deals_won
// não têm trigger de update on-write, então ficavam stale. Em vez
// de adicionar AfterCreate/AfterUpdate hooks (caros e fragéis), o
// sync periódico mantém os números em ordem com latência aceitável.
//
// Tudo idempotente: rodar 2x sem side-effect. Usa CTEs/subquery pra
// minimizar round-trips — uma query por entidade.
type CrmStatsSync struct {
	db        *gorm.DB
	tickEvery time.Duration
}

func NewCrmStatsSync(db *gorm.DB) *CrmStatsSync {
	return &CrmStatsSync{db: db, tickEvery: 5 * time.Minute}
}

func (s *CrmStatsSync) Start(ctx context.Context) {
	go func() {
		// Roda uma vez no boot (não esperar 5min pra primeira atualização).
		s.tick()
		t := time.NewTicker(s.tickEvery)
		defer t.Stop()
		log.Info().Dur("tick", s.tickEvery).Msg("crm_stats_sync: started")
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.tick()
			}
		}
	}()
}

func (s *CrmStatsSync) tick() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("crm_stats_sync: panic recovered")
		}
	}()
	start := time.Now()

	// Company stats — contact_count, deal_count, open_deal_sum.
	// Subquery agrupa por company_id e atualiza em batch.
	companyRes := s.db.Exec(`
		UPDATE companies SET
			contact_count = COALESCE(c.cnt, 0),
			deal_count = COALESCE(d.cnt, 0),
			open_deal_sum = COALESCE(d.open_sum, 0)
		FROM (
			SELECT company_id, COUNT(*) AS cnt
			FROM contacts
			WHERE deleted_at IS NULL AND company_id IS NOT NULL
			GROUP BY company_id
		) c
		FULL OUTER JOIN (
			SELECT company_id,
				COUNT(*) AS cnt,
				SUM(CASE WHEN status = 'open' THEN value ELSE 0 END) AS open_sum
			FROM deals
			WHERE deleted_at IS NULL AND company_id IS NOT NULL
			GROUP BY company_id
		) d ON c.company_id = d.company_id
		WHERE companies.id = COALESCE(c.company_id, d.company_id)
	`)

	// Contact stats — deals_open, deals_won, last_contact_at.
	// last_contact_at = MAX(deal.updated_at) OR MAX(message.created_at).
	// Pra simplificar, usamos só deal.updated_at; conversation.last_msg
	// fica fora do scope desse sync.
	contactRes := s.db.Exec(`
		UPDATE contacts SET
			deals_open = COALESCE(d.open_cnt, 0),
			deals_won = COALESCE(d.won_cnt, 0)
		FROM (
			SELECT contact_id,
				SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_cnt,
				SUM(CASE WHEN status = 'won'  THEN 1 ELSE 0 END) AS won_cnt
			FROM deals
			WHERE deleted_at IS NULL
			GROUP BY contact_id
		) d
		WHERE contacts.id = d.contact_id
	`)

	log.Debug().
		Int64("companies_updated", companyRes.RowsAffected).
		Int64("contacts_updated", contactRes.RowsAffected).
		Dur("duration", time.Since(start)).
		Msg("crm_stats_sync: tick done")
}
