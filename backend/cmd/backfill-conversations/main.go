// backfill-conversations walks message_logs in chunks and assigns
// conversation_id to each row that still has it NULL. For each (workspace,
// instance, channel_key) tuple it locates or creates a Conversation via the
// same InboundPipeline logic used in production.
//
// Idempotent: safe to run multiple times. Emits progress every 1k rows.
//
// Usage:
//   DATABASE_URL=... go run ./cmd/backfill-conversations
package main

import (
	"context"
	"flag"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func main() {
	chunk := flag.Int("chunk", 500, "rows per batch")
	maxIters := flag.Int("max", 0, "max batches (0 = all)")
	flag.Parse()

	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	cfg := config.Load()
	db, err := openDB(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to open db")
	}

	pipeline := services.NewInboundPipeline(db, nil) // no WS broadcast during backfill

	processed := 0
	batches := 0
	start := time.Now()

	for {
		var rows []models.MessageLog
		err := db.Where("conversation_id IS NULL AND direction = ? AND to_jid <> ''",
			models.DirectionIn).
			Order("created_at ASC").
			Limit(*chunk).
			Find(&rows).Error
		if err != nil {
			log.Fatal().Err(err).Msg("fetch batch failed")
		}
		if len(rows) == 0 {
			break
		}
		for i := range rows {
			ml := &rows[i]
			// Ensure workspace_id is populated (some legacy rows don't have it)
			if ml.WorkspaceID == nil {
				var inst models.Instance
				if err := db.Select("workspace_id").First(&inst, "id = ?", ml.InstanceID).Error; err == nil && inst.WorkspaceID != nil {
					id := *inst.WorkspaceID
					ml.WorkspaceID = &id
				}
			}
			if err := pipeline.ProcessSavedInbound(context.Background(), ml); err != nil {
				log.Warn().Err(err).Str("ml_id", ml.ID.String()).Msg("backfill: skip")
				// Mark with a deterministic UUID to stop reprocessing this row
				// on next run — we use uuid.Nil as a sentinel and then fix
				// below. Simpler: continue; the row stays NULL and the next
				// run may pick it up if the situation changed.
				continue
			}
			processed++
		}
		batches++
		log.Info().Int("batch", batches).Int("processed", processed).
			Dur("elapsed", time.Since(start)).Msg("backfill: progress")
		if *maxIters > 0 && batches >= *maxIters {
			break
		}
	}

	// Backfill outbound rows too — they don't go through the InboundPipeline
	// but still need conversation_id so /inbox/mine sees complete threads.
	log.Info().Msg("backfill: outbound pass")
	for {
		var rows []models.MessageLog
		err := db.Where("conversation_id IS NULL AND direction = ?", models.DirectionOut).
			Order("created_at ASC").
			Limit(*chunk).
			Find(&rows).Error
		if err != nil {
			log.Fatal().Err(err).Msg("fetch outbound batch failed")
		}
		if len(rows) == 0 {
			break
		}
		for i := range rows {
			ml := &rows[i]
			if ml.WorkspaceID == nil || ml.ToJID == "" {
				continue
			}
			conv, err := findLiveConversation(db, *ml.WorkspaceID, ml.InstanceID, ml.ToJID, ml.CreatedAt)
			if err != nil || conv == nil {
				continue
			}
			db.Model(&models.MessageLog{}).Where("id = ?", ml.ID).Update("conversation_id", conv.ID)
			processed++
		}
	}

	log.Info().Int("total", processed).Dur("elapsed", time.Since(start)).Msg("backfill: done")
}

// findLiveConversation locates the conversation that "contains" an outbound
// MessageLog — the one whose time range covers the message's CreatedAt. Falls
// back to the most recent conversation matching (workspace, instance, channel_key).
func findLiveConversation(db *gorm.DB, wsID, instanceID uuid.UUID, channelKey string, at time.Time) (*models.Conversation, error) {
	var conv models.Conversation
	err := db.Where("workspace_id = ? AND instance_id = ? AND channel_key = ?", wsID, instanceID, channelKey).
		Where("created_at <= ?", at).
		Where("(closed_at IS NULL OR closed_at >= ?)", at).
		Order("created_at DESC").
		First(&conv).Error
	if err == nil {
		return &conv, nil
	}
	err = db.Where("workspace_id = ? AND instance_id = ? AND channel_key = ?", wsID, instanceID, channelKey).
		Order("created_at DESC").
		First(&conv).Error
	if err != nil {
		return nil, err
	}
	return &conv, nil
}

func openDB(cfg *config.Config) (*gorm.DB, error) {
	gormCfg := &gorm.Config{Logger: gormLogger.Default.LogMode(gormLogger.Silent)}
	if cfg.DatabaseURL != "" {
		return gorm.Open(postgres.Open(cfg.DatabaseURL), gormCfg)
	}
	return gorm.Open(sqlite.Open("uniqdot_dev.db"), gormCfg)
}
