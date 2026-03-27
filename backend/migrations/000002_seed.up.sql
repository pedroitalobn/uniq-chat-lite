-- Seed Plans
INSERT INTO plans (id, name, price, max_instances, max_messages_per_day, features, allow_proxy, is_active)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Free',       0,   1,  100,   '{"support":"community"}',  false, true),
    ('00000000-0000-0000-0000-000000000002', 'Pro',        49,  5,  5000,  '{"support":"email","webhooks":true}', true, true),
    ('00000000-0000-0000-0000-000000000003', 'Enterprise', 149, -1, -1,    '{"support":"priority","webhooks":true,"custom_domain":true}', true, true)
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
