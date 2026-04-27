package shop

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// RunSync executa SyncProducts pra uma integração e atualiza os
// metadados de status. Idempotente — chamar 2x na mesma integração
// não duplica produtos (usa external_id).
func RunSync(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration) (SyncStats, error) {
	provider := GetProvider(string(integration.Provider))
	if provider == nil {
		return SyncStats{}, errors.New("provider não registrado: " + string(integration.Provider))
	}

	// Marca como running
	now := time.Now()
	db.Model(integration).Updates(map[string]any{
		"last_sync_status": "running",
		"last_sync_error":  "",
	})

	stats, err := provider.SyncProducts(ctx, db, integration, nil)

	updates := map[string]any{
		"last_sync_at": &now,
		"synced_count": integration.SyncedCount + stats.Created + stats.Updated,
	}
	if err != nil {
		updates["last_sync_status"] = "failed"
		updates["last_sync_error"] = err.Error()
		log.Warn().Err(err).Str("provider", string(integration.Provider)).Msg("shop sync failed")
	} else {
		updates["last_sync_status"] = "success"
		updates["last_sync_error"] = ""
	}
	db.Model(integration).Updates(updates)
	return stats, err
}

// GenerateOAuthState produz um token aleatório (32 chars hex) pra
// validar o callback OAuth — protege contra CSRF.
func GenerateOAuthState() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}
