-- Plans
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    max_instances INTEGER NOT NULL DEFAULT 1,
    max_messages_per_day INTEGER NOT NULL DEFAULT 100,
    features TEXT NOT NULL DEFAULT '{}',
    allow_proxy BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'user',
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan_id ON users(plan_id);

-- Instances
CREATE TABLE IF NOT EXISTS instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'disconnected',

    -- Proxy
    proxy_enabled BOOLEAN NOT NULL DEFAULT false,
    proxy_type VARCHAR(10),
    proxy_host VARCHAR(255),
    proxy_port INTEGER,
    proxy_username VARCHAR(255),
    proxy_password VARCHAR(512),
    proxy_status VARCHAR(20) NOT NULL DEFAULT 'untested',
    proxy_last_tested TIMESTAMPTZ,
    proxy_error TEXT,
    proxy_external_ip VARCHAR(64),

    webhook_url TEXT,
    session_data TEXT,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_instances_user_id ON instances(user_id);
CREATE INDEX idx_instances_status ON instances(status);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(20) NOT NULL,
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_instance_id ON webhooks(instance_id);

-- Message Logs
CREATE TABLE IF NOT EXISTS message_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    direction VARCHAR(5) NOT NULL,
    type VARCHAR(30) NOT NULL,
    to_jid VARCHAR(100),
    content TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_logs_instance_id ON message_logs(instance_id);
CREATE INDEX idx_message_logs_created_at ON message_logs(created_at);
