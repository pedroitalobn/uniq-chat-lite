-- Add message status columns for pin, favorite, archive, delete
ALTER TABLE message_logs ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE message_logs ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE;
ALTER TABLE message_logs ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE message_logs ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_message_logs_pinned ON message_logs(is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX idx_message_logs_favorite ON message_logs(is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX idx_message_logs_archived ON message_logs(is_archived) WHERE is_archived = TRUE;