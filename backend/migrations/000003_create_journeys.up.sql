CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT,
    prompt TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT DEFAULT 'keyword',
    trigger_filter TEXT,
    keywords TEXT,
    message_template TEXT,
    flow TEXT,
    trigger_config TEXT,
    response_mode TEXT DEFAULT 'private',
    status TEXT NOT NULL DEFAULT 'active',
    invocations INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    instance_id TEXT,
    group_jid TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journeys_user_id ON journeys(user_id);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);
CREATE INDEX IF NOT EXISTS idx_journeys_instance_id ON journeys(instance_id);

CREATE TABLE IF NOT EXISTS journey_executions (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    instance_id TEXT,
    contact_jid TEXT NOT NULL,
    contact_name TEXT,
    group_jid TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    current_step TEXT,
    step_index INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    messages TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_executions_journey_id ON journey_executions(journey_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON journey_executions(status);
