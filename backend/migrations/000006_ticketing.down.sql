DROP INDEX IF EXISTS uk_conv_live_per_channel;
DROP INDEX IF EXISTS idx_conv_mine;
DROP INDEX IF EXISTS idx_conv_queue;
DROP INDEX IF EXISTS idx_conv_contact_status;

DROP TABLE IF EXISTS user_presences;
DROP TABLE IF EXISTS quick_replies;
DROP TABLE IF EXISTS conversation_participants;
DROP TABLE IF EXISTS conversation_notes;
DROP TABLE IF EXISTS conversation_assignments;
DROP TABLE IF EXISTS conversation_events;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS queue_channels;
DROP TABLE IF EXISTS queue_members;
DROP TABLE IF EXISTS queues;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS departments;
