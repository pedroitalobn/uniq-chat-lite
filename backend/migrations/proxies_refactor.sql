-- Refactor do gerenciamento de proxies:
--   * Cria a tabela `proxies` unificada (platform + custom)
--   * Migra dados existentes de `global_proxy_configs` e campos inline
--     dos `servers` pra `proxies`
--   * Adiciona `servers.proxy_id` apontando pro Proxy correto
--   * Remove colunas proxy_* de `servers` e `instances`
--
-- Rodar uma vez em produção. É idempotente pros passos já aplicados (usa
-- IF [NOT] EXISTS) mas não re-migra linhas já movidas.

BEGIN;

-- 1. Nova tabela de proxies (se ainda não criada pelo AutoMigrate)
CREATE TABLE IF NOT EXISTS proxies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NULL,
    is_platform boolean NOT NULL DEFAULT false,
    name varchar(100) NOT NULL,
    country varchar(10) NOT NULL DEFAULT 'br',
    provider varchar(30) NOT NULL DEFAULT 'manual',
    proxy_type varchar(10) NOT NULL DEFAULT 'http',
    host varchar(255) NOT NULL DEFAULT '',
    port int NOT NULL DEFAULT 0,
    username varchar(255) NOT NULL DEFAULT '',
    password varchar(512) NOT NULL DEFAULT '',
    use_env boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proxies_owner ON proxies(owner_id);
CREATE INDEX IF NOT EXISTS idx_proxies_is_platform ON proxies(is_platform);

-- 2. Migrar global_proxy_configs → proxies (as plataforma)
INSERT INTO proxies (id, is_platform, name, country, provider, proxy_type, host, port, username, password, use_env, is_active, created_at, updated_at)
SELECT
    gen_random_uuid(),
    true,
    COALESCE(NULLIF(name, ''), 'Proxy ' || COALESCE(country, 'br')),
    COALESCE(country, 'br'),
    COALESCE(NULLIF(provider, ''), 'manual'),
    COALESCE(NULLIF(proxy_type, ''), 'http'),
    COALESCE(host, ''),
    COALESCE(port, 0),
    COALESCE(username, ''),
    COALESCE(password, ''),
    COALESCE(use_env, false),
    COALESCE(is_active, true),
    COALESCE(created_at, now()),
    COALESCE(updated_at, now())
FROM global_proxy_configs
WHERE NOT EXISTS (
    SELECT 1 FROM proxies p
    WHERE p.is_platform = true AND p.host = global_proxy_configs.host AND p.port = global_proxy_configs.port
)
ON CONFLICT DO NOTHING;

-- 3. Criar coluna servers.proxy_id e popular a partir dos campos inline
ALTER TABLE servers ADD COLUMN IF NOT EXISTS proxy_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_servers_proxy_id ON servers(proxy_id);

-- 3a. Server com proxy manual inline → criar um Proxy custom pro dono do server e linkar
INSERT INTO proxies (id, owner_id, is_platform, name, country, provider, proxy_type, host, port, username, password, use_env, is_active, created_at, updated_at)
SELECT
    gen_random_uuid(),
    s.user_id,
    false,
    'Proxy do server ' || s.name,
    'br',
    'custom',
    COALESCE(NULLIF(s.proxy_type, ''), 'http'),
    s.proxy_host,
    s.proxy_port,
    COALESCE(s.proxy_username, ''),
    COALESCE(s.proxy_password, ''),
    false,
    true,
    now(),
    now()
FROM servers s
WHERE s.proxy_host <> '' AND s.proxy_port > 0 AND s.proxy_id IS NULL;

UPDATE servers s
SET proxy_id = p.id
FROM proxies p
WHERE p.owner_id = s.user_id
  AND p.host = s.proxy_host
  AND p.port = s.proxy_port
  AND s.proxy_host <> ''
  AND s.proxy_port > 0
  AND s.proxy_id IS NULL;

-- 3b. Server com global_proxy_id (legado) → achar o Proxy de plataforma equivalente
UPDATE servers s
SET proxy_id = p.id
FROM proxies p
JOIN global_proxy_configs g ON p.host = g.host AND p.port = g.port AND p.is_platform = true
WHERE s.global_proxy_id = g.id
  AND s.proxy_id IS NULL;

-- 4. Remover colunas legadas de servers e instances
ALTER TABLE servers
    DROP COLUMN IF EXISTS proxy_mode,
    DROP COLUMN IF EXISTS proxy_pool_id,
    DROP COLUMN IF EXISTS global_proxy_id,
    DROP COLUMN IF EXISTS proxy_type,
    DROP COLUMN IF EXISTS proxy_host,
    DROP COLUMN IF EXISTS proxy_port,
    DROP COLUMN IF EXISTS proxy_username,
    DROP COLUMN IF EXISTS proxy_password;

ALTER TABLE instances
    DROP COLUMN IF EXISTS proxy_mode,
    DROP COLUMN IF EXISTS proxy_enabled,
    DROP COLUMN IF EXISTS proxy_type,
    DROP COLUMN IF EXISTS proxy_host,
    DROP COLUMN IF EXISTS proxy_port,
    DROP COLUMN IF EXISTS proxy_username,
    DROP COLUMN IF EXISTS proxy_password,
    DROP COLUMN IF EXISTS proxy_status,
    DROP COLUMN IF EXISTS proxy_last_tested,
    DROP COLUMN IF EXISTS proxy_error,
    DROP COLUMN IF EXISTS proxy_external_ip,
    DROP COLUMN IF EXISTS proxy_pool_id,
    DROP COLUMN IF EXISTS use_global_proxy,
    DROP COLUMN IF EXISTS global_proxy_id;

-- 5. Tabelas antigas que não são mais usadas (opcional — deixe por último se quiser
--    conferir antes de dropar).
DROP TABLE IF EXISTS proxy_pools CASCADE;
DROP TABLE IF EXISTS proxy_provider_configs CASCADE;
DROP TABLE IF EXISTS instance_proxy_assignments CASCADE;
DROP TABLE IF EXISTS global_proxy_configs CASCADE;

COMMIT;
