-- Seed Plans
INSERT INTO plans (id, name, price, max_instances, max_messages_per_day, features, allow_proxy, is_active)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Free',     0,   1,  100,   '{"support":"community","description":"Comece de graça"}', false, true),
    ('00000000-0000-0000-0000-000000000004', 'Starter',  29,  3,  2000,  '{"support":"email","whatsapp":true,"crm":true,"description":"Para pequenos negócios"}', false, true),
    ('00000000-0000-0000-0000-000000000002', 'Pro',      49,  5,  5000,  '{"support":"email","whatsapp":true,"crm":true,"webhooks":true,"campaigns":true,"description":"Para times em crescimento"}', true, true),
    ('00000000-0000-0000-0000-000000000003', 'Business', 149, -1, -1,    '{"support":"priority","whatsapp":true,"crm":true,"webhooks":true,"campaigns":true,"integrations":true,"api":true,"mcp":true,"description":"Para empresas"}', true, true),
    ('00000000-0000-0000-0000-000000000005', 'Lifetime', 0,   -1, -1,    '{"support":"priority","whatsapp":true,"crm":true,"webhooks":true,"campaigns":true,"integrations":true,"api":true,"mcp":true,"description":"Acesso vitalício completo"}', true, false)
ON CONFLICT (id) DO NOTHING;

-- Seed Admin User (password: Admin@123456)
-- bcrypt hash for "Admin@123456" with cost 12
INSERT INTO users (id, name, email, password_hash, role, plan_id, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    'Admin',
    'admin@storychat.app',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oKZ9F6K9.',
    'admin',
    '00000000-0000-0000-0000-000000000003',
    true
) ON CONFLICT (email) DO NOTHING;
