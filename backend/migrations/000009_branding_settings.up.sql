-- White-label branding: tabela singleton com a configuração visual editável
-- pelo admin (cores, fontes, logos, preset de tema, nome do app).

CREATE TABLE IF NOT EXISTS branding_settings (
    id              SERIAL PRIMARY KEY,
    app_name        VARCHAR(120) NOT NULL DEFAULT 'Uniq',
    primary_color   VARCHAR(32)  NOT NULL DEFAULT '#6366F1',
    secondary_color VARCHAR(32)  NOT NULL DEFAULT '#8B5CF6',
    accent_color    VARCHAR(32)  NOT NULL DEFAULT '#EC4899',
    font_family     VARCHAR(80)  NOT NULL DEFAULT 'inter',
    theme_preset    VARCHAR(32)  NOT NULL DEFAULT 'modern',
    logo_light_url  TEXT NOT NULL DEFAULT '',
    logo_dark_url   TEXT NOT NULL DEFAULT '',
    favicon_url     TEXT NOT NULL DEFAULT '',
    login_bg_url    TEXT NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton (id=1). Idempotente.
INSERT INTO branding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
