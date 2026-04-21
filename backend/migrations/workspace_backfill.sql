-- Backfill de workspace padrão pros usuários existentes.
--
-- Contexto: antes do refactor, era possível criar conta sem workspace, e
-- servers/instances ficavam com workspace_id=NULL. Quando o usuário criou
-- um workspace depois, a lista filtrada por esse workspace passou a esconder
-- os recursos órfãos, dando a impressão de que "sumiram".
--
-- Este script:
--   1. Cria um workspace "<primeiro nome>'s Workspace" pra cada usuário sem
--      workspace próprio.
--   2. Cria um role Admin com todas as permissions nesse workspace.
--   3. Adiciona o usuário como owner.
--   4. Vincula servers e instances órfãos (workspace_id IS NULL, user_id = X)
--      ao workspace recém-criado.
--
-- Roda uma vez. Idempotente: usuários que já têm workspace próprio não são
-- afetados.

BEGIN;

-- 1. Cria workspace pros usuários que ainda não são donos de nenhum
WITH orphan_users AS (
    SELECT u.id AS user_id, u.name
    FROM users u
    WHERE NOT EXISTS (
        SELECT 1 FROM user_workspaces uw
        WHERE uw.user_id = u.id AND uw.is_owner = true
    )
),
new_workspaces AS (
    INSERT INTO workspaces (id, owner_id, name, created_at, updated_at)
    SELECT
        gen_random_uuid(),
        user_id,
        COALESCE(NULLIF(SPLIT_PART(name, ' ', 1), ''), 'Meu') || '''s Workspace',
        now(),
        now()
    FROM orphan_users
    RETURNING id, owner_id
)
SELECT 1 FROM new_workspaces;

-- 2. Cria role Admin pros workspaces novos + popula role_permissions
WITH new_ws AS (
    SELECT w.id AS workspace_id, w.owner_id
    FROM workspaces w
    WHERE NOT EXISTS (
        SELECT 1 FROM roles r
        WHERE r.workspace_id = w.id AND r.name = 'Admin'
    )
),
new_roles AS (
    INSERT INTO roles (id, workspace_id, name, description, is_default, created_at, updated_at)
    SELECT gen_random_uuid(), workspace_id, 'Admin', 'Acesso total ao workspace', true, now(), now()
    FROM new_ws
    RETURNING id, workspace_id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT nr.id, p.id
FROM new_roles nr
CROSS JOIN permissions p
ON CONFLICT DO NOTHING;

-- 3. Adiciona o owner como membro do workspace com o role Admin
INSERT INTO user_workspaces (id, user_id, workspace_id, role_id, is_owner, joined_at)
SELECT gen_random_uuid(), w.owner_id, w.id, r.id, true, now()
FROM workspaces w
JOIN roles r ON r.workspace_id = w.id AND r.name = 'Admin'
WHERE NOT EXISTS (
    SELECT 1 FROM user_workspaces uw
    WHERE uw.user_id = w.owner_id AND uw.workspace_id = w.id
);

-- 4. Liga servers órfãos ao workspace do dono
UPDATE servers s
SET workspace_id = (
    SELECT uw.workspace_id
    FROM user_workspaces uw
    WHERE uw.user_id = s.user_id AND uw.is_owner = true
    ORDER BY uw.joined_at ASC
    LIMIT 1
)
WHERE s.workspace_id IS NULL;

-- 5. Liga instances órfãs ao workspace do dono
UPDATE instances i
SET workspace_id = (
    SELECT uw.workspace_id
    FROM user_workspaces uw
    WHERE uw.user_id = i.user_id AND uw.is_owner = true
    ORDER BY uw.joined_at ASC
    LIMIT 1
)
WHERE i.workspace_id IS NULL;

COMMIT;
