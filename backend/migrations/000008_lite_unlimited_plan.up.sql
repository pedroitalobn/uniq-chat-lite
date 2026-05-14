-- White-label lite: plano único ilimitado. Tudo -1 (sentinela) ou valores
-- altíssimos para que nada bloqueie. Marcado como default para que novos
-- workspaces/users já caiam nele.

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
    -1, -1,
    -1, true
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
