package main

// Bootstrap automático para a versão white-label (uniq-chat-lite).
//
// Quando BOOTSTRAP_ON_START=true:
//   1. Aplica as migrations SQL específicas do lite (lite unlimited plan +
//      branding_settings) de forma idempotente.
//   2. Aceita ADMIN_EMAIL/ADMIN_PASSWORD como aliases para SUPER_ADMIN_*
//      — o bloco em main.go já cria o usuário se essas envs estiverem
//      preenchidas, então só fazemos o mapeamento.
//
// Mantemos tudo idempotente para que reiniciar o container nunca quebre
// um banco já populado.

import (
	"os"

	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
)

// liteBootstrap roda no startup quando BOOTSTRAP_ON_START=true. Idempotente.
func liteBootstrap(db *gorm.DB) {
	if os.Getenv("BOOTSTRAP_ON_START") != "true" && os.Getenv("BOOTSTRAP_ON_START") != "1" {
		return
	}
	log.Info().Msg("lite-bootstrap: aplicando migrations e bootstrap")

	// Aceita ADMIN_EMAIL/ADMIN_PASSWORD como alias para SUPER_ADMIN_*. A
	// criação real do usuário acontece no bloco existente em main.go.
	if os.Getenv("SUPER_ADMIN_EMAIL") == "" && os.Getenv("ADMIN_EMAIL") != "" {
		os.Setenv("SUPER_ADMIN_EMAIL", os.Getenv("ADMIN_EMAIL"))
	}
	if os.Getenv("SUPER_ADMIN_PASSWORD") == "" && os.Getenv("ADMIN_PASSWORD") != "" {
		os.Setenv("SUPER_ADMIN_PASSWORD", os.Getenv("ADMIN_PASSWORD"))
	}
	if os.Getenv("SUPER_ADMIN_NAME") == "" {
		if v := os.Getenv("ADMIN_NAME"); v != "" {
			os.Setenv("SUPER_ADMIN_NAME", v)
		} else {
			os.Setenv("SUPER_ADMIN_NAME", "Admin")
		}
	}

	// Branding singleton — idempotente via IF NOT EXISTS / ON CONFLICT.
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS branding_settings (
			id              SERIAL PRIMARY KEY,
			app_name        VARCHAR(120) NOT NULL DEFAULT 'qchat',
			primary_color   VARCHAR(32)  NOT NULL DEFAULT '#2563EB',
			secondary_color VARCHAR(32)  NOT NULL DEFAULT '#3B82F6',
			accent_color    VARCHAR(32)  NOT NULL DEFAULT '#0EA5E9',
			font_family     VARCHAR(80)  NOT NULL DEFAULT 'inter',
			theme_preset    VARCHAR(32)  NOT NULL DEFAULT 'modern',
			logo_light_url  TEXT NOT NULL DEFAULT '',
			logo_dark_url   TEXT NOT NULL DEFAULT '',
			favicon_url     TEXT NOT NULL DEFAULT '',
			login_bg_url    TEXT NOT NULL DEFAULT '',
			updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`).Error; err != nil {
		log.Warn().Err(err).Msg("lite-bootstrap: branding table create falhou (ignorável em sqlite/dev)")
	}
	_ = db.Exec(`INSERT INTO branding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`).Error

	// Plano Lite Unlimited — só insere se a tabela plans existe e o slug
	// ainda não existe. Usamos plain SQL para não acoplar com o model.
	_ = db.Exec(`
		INSERT INTO plans (
			name, slug,
			max_users, max_workspaces, max_agents, max_journeys, max_campaigns,
			max_triggers, max_webhooks, max_contacts, max_deals, max_shops,
			max_products, max_shop_integrations, max_instances_per_proxy, max_proxy_pool,
			allow_ai, allow_journeys, allow_crm, allow_inbox, allow_campaigns,
			allow_triggers, allow_warmup, allow_newsletters, allow_communities,
			allow_instagram, allow_tiktok, allow_api_access, allow_global_webhook,
			allow_shop, allow_proxy_residencial, allow_whatsapp_qr, allow_waba,
			allow_voice, allow_proxy,
			ai_credits_included_per_cycle, voice_credits_included_per_cycle,
			message_credits_included_per_cycle, overage_allowed_default
		) VALUES (
			'Lite Unlimited', 'lite_unlimited',
			-1, -1, -1, -1, -1,
			-1, -1, -1, -1, -1,
			-1, -1, -1, -1,
			true, true, true, true, true,
			true, true, true, true,
			true, true, true, true,
			true, true, true, true,
			true, true,
			-1, -1, -1, true
		)
		ON CONFLICT (slug) WHERE slug != '' DO UPDATE SET
			max_users = -1, max_workspaces = -1, max_agents = -1, max_journeys = -1,
			max_campaigns = -1, max_triggers = -1, max_webhooks = -1, max_contacts = -1,
			max_deals = -1, max_shops = -1, max_products = -1, max_shop_integrations = -1,
			max_instances_per_proxy = -1, max_proxy_pool = -1,
			allow_ai = true, allow_journeys = true, allow_crm = true, allow_inbox = true,
			allow_campaigns = true, allow_triggers = true, allow_warmup = true,
			allow_newsletters = true, allow_communities = true, allow_instagram = true,
			allow_tiktok = true, allow_api_access = true, allow_global_webhook = true,
			allow_shop = true, allow_proxy_residencial = true, allow_whatsapp_qr = true,
			allow_waba = true, allow_voice = true, allow_proxy = true,
			ai_credits_included_per_cycle = -1, voice_credits_included_per_cycle = -1,
			message_credits_included_per_cycle = -1, overage_allowed_default = true;
	`).Error

	log.Info().Msg("lite-bootstrap: pronto")
}
