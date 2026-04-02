-- Create global_webhooks table for system-wide webhooks
CREATE TABLE IF NOT EXISTS global_webhooks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    name varchar(100) NOT NULL,
    is_active boolean DEFAULT true,
    url text NOT NULL,
    secret varchar(100),
    events text DEFAULT '[]',
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_global_webhooks_user_id ON global_webhooks(user_id);