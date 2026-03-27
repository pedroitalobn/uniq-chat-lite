package whatsapp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// GetDeviceStore returns a SQLite-backed device store for the given instance ID.
func GetDeviceStore(sessionDir, instanceID string) (*sqlstore.Container, error) {
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create session dir: %w", err)
	}

	dbPath := filepath.Join(sessionDir, instanceID+".db")
	container, err := sqlstore.New(context.Background(), "sqlite3", "file:"+dbPath+"?_foreign_keys=on", waLog.Noop)
	if err != nil {
		return nil, fmt.Errorf("failed to open session store: %w", err)
	}

	return container, nil
}
