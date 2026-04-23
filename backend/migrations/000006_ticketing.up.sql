-- Ticketing / Atendimento — partial unique index and helper indexes that
-- GORM AutoMigrate cannot express via tags.
-- Applied idempotently; safe to run multiple times.

-- 1) At most ONE "live" conversation per (workspace, instance, channel_key).
--    Live statuses: open | pending | snoozed. Closed/resolved conversations do
--    not block reopening a ticket on the same channel.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uk_conv_live_per_channel'
  ) THEN
    CREATE UNIQUE INDEX uk_conv_live_per_channel
      ON conversations (workspace_id, instance_id, channel_key)
      WHERE status IN ('open','pending','snoozed')
        AND deleted_at IS NULL;
  END IF;
END $$;

-- 2) Hot-path indexes for the Inbox listing queries:
--    "meus tickets"
CREATE INDEX IF NOT EXISTS idx_conv_mine
  ON conversations (workspace_id, status, assigned_user_id, last_message_at DESC)
  WHERE deleted_at IS NULL;

--    "fila"
CREATE INDEX IF NOT EXISTS idx_conv_queue
  ON conversations (workspace_id, status, queue_id, last_message_at DESC)
  WHERE deleted_at IS NULL;

--    "histórico por contato"
CREATE INDEX IF NOT EXISTS idx_conv_contact_status
  ON conversations (workspace_id, contact_id, status)
  WHERE deleted_at IS NULL;
