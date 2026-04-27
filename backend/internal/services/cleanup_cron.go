package services

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// CleanupCron — worker periódico de housekeeping de segurança:
//
//   1. Deleta contas com email NÃO verificado após 14 dias do signup.
//      Bots de signup raramente confirmam email — esse cron tira o lixo
//      sozinho sem precisar de admin manual.
//
//   2. Limpa challenge tokens expirados (não há tabela; tokens são JWT
//      stateless, expiram sozinhos — sem cleanup necessário).
//
// Idempotente: rodar 2x sem efeito colateral.
type CleanupCron struct {
	db   *gorm.DB
	stop chan struct{}
}

func NewCleanupCron(db *gorm.DB) *CleanupCron {
	return &CleanupCron{db: db, stop: make(chan struct{})}
}

func (c *CleanupCron) Start() {
	go c.loop()
	log.Info().Msg("cleanup cron: started (6h interval)")
}

func (c *CleanupCron) Stop() {
	close(c.stop)
}

func (c *CleanupCron) loop() {
	c.tick() // arranque imediato
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
			c.tick()
		}
	}
}

func (c *CleanupCron) tick() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	c.cleanupUnverified(ctx)
}

// cleanupUnverified deleta users:
//   - email_verified_at IS NULL
//   - email_verification_sent_at < NOW() - 14d  (passaram do prazo de cura)
//   - role != super_admin (jamais deletar admin sem manualmente)
//
// Cascateia via descoberta de FKs (mesma lógica do admin handler).
// Para cada user, tenta deletar dependentes em retry-com-savepoint.
func (c *CleanupCron) cleanupUnverified(ctx context.Context) {
	cutoff := time.Now().AddDate(0, 0, -14)
	var stale []models.User
	if err := c.db.WithContext(ctx).
		Where("email_verified_at IS NULL AND email_verification_sent_at < ? AND role <> ?",
			cutoff, models.RoleSuperAdmin).
		Find(&stale).Error; err != nil {
		log.Error().Err(err).Msg("cleanup: failed to query stale users")
		return
	}
	if len(stale) == 0 {
		return
	}
	log.Info().Int("count", len(stale)).Msg("cleanup: deleting unverified users")

	deleted := 0
	for _, u := range stale {
		err := c.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			ids := []string{u.ID.String()}
			counts := map[string]int64{}

			// Cascade direto via FK discovery (workspaces que esse user é dono).
			var ownerWs []string
			tx.Raw(`SELECT id::text FROM workspaces WHERE owner_id = ?`, u.ID).Scan(&ownerWs)
			if len(ownerWs) > 0 {
				if err := cascadeFKs(tx, "workspaces", "id", ownerWs, counts); err != nil {
					return err
				}
				if err := tx.Exec(`DELETE FROM workspaces WHERE id = ANY($1)`, ownerWs).Error; err != nil {
					return err
				}
			}
			if err := cascadeFKs(tx, "users", "id", ids, counts); err != nil {
				return err
			}
			return tx.Exec(`DELETE FROM users WHERE id = ?`, u.ID).Error
		})
		if err != nil {
			log.Warn().Err(err).Str("user_id", u.ID.String()).Str("email", u.Email).
				Msg("cleanup: failed to delete user")
			continue
		}
		deleted++
	}
	log.Info().Int("deleted", deleted).Msg("cleanup: done")
}

// cascadeFKs — versão local do helper de cascade. Mesma lógica do
// admin.cascadeDeleteByFK (retry-com-savepoint até resolver cadeias).
func cascadeFKs(tx *gorm.DB, parentTable, parentCol string, ids []string, counts map[string]int64) error {
	if len(ids) == 0 {
		return nil
	}
	type fk struct {
		Table  string
		Column string
	}
	var fks []fk
	q := `
		SELECT cl.relname AS table, att.attname AS column
		FROM pg_constraint con
		JOIN pg_class cl  ON cl.oid = con.conrelid
		JOIN pg_class pcl ON pcl.oid = con.confrelid
		JOIN pg_attribute att  ON att.attrelid = cl.oid  AND att.attnum  = ANY(con.conkey)
		JOIN pg_attribute patt ON patt.attrelid = pcl.oid AND patt.attnum = ANY(con.confkey)
		WHERE con.contype = 'f' AND pcl.relname = ? AND patt.attname = ?
	`
	if err := tx.Raw(q, parentTable, parentCol).Scan(&fks).Error; err != nil {
		return err
	}
	pending := make([]fk, 0, len(fks))
	for _, f := range fks {
		if f.Table == parentTable {
			continue
		}
		pending = append(pending, f)
	}
	for pass := 0; pass < 6 && len(pending) > 0; pass++ {
		next := pending[:0]
		progress := false
		for _, f := range pending {
			sp := "sp_" + f.Table + "_" + f.Column
			if err := tx.Exec("SAVEPOINT " + sp).Error; err != nil {
				return err
			}
			res := tx.Exec(`DELETE FROM "`+f.Table+`" WHERE "`+f.Column+`" = ANY($1)`, ids)
			if res.Error != nil {
				_ = tx.Exec("ROLLBACK TO SAVEPOINT " + sp).Error
				next = append(next, f)
				continue
			}
			_ = tx.Exec("RELEASE SAVEPOINT " + sp).Error
			counts[f.Table] += res.RowsAffected
			progress = true
		}
		pending = next
		if !progress {
			break
		}
	}
	return nil
}
