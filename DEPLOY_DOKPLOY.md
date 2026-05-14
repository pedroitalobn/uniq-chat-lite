# Deploy no Dokploy (modo Compose)

Guia passo a passo para subir uma instância white-label do Uniq Lite num
servidor Dokploy. Vale para o primeiro deploy e para múltiplas instâncias
no mesmo host (basta variar `STACK_NAME`).

## Pré-requisitos

- Servidor com Dokploy instalado e rede `dokploy-network` criada
- Domínios apontando para o IP do servidor (A records ou Cloudflare):
  - `app.seudominio.com` → frontend
  - `api.seudominio.com` → backend (porta 8080)
  - *(opcional)* `media.seudominio.com` → bucket S3/MinIO
- Bucket S3-compatible já criado (Hetzner / R2 / AWS S3 / MinIO self-hosted)

## 1. Criar projeto no Dokploy

1. **New Project** → nome: `uniq-lite-CLIENTE`
2. Dentro do projeto: **New Service → Compose**
3. **Source:** GitHub → `pedroitalobn/uniq-chat-lite` → branch `main`
4. **Compose file path:** `docker-compose.yml` (raiz)

## 2. Variáveis de ambiente

Aba **Environment** → cole o conteúdo do `.env.example` e edite. Mínimo
obrigatório para o primeiro boot:

```env
STACK_NAME=cliente1                # único por instância
APP_NAME=Cliente Marca

FRONTEND_URL=https://app.cliente.com
APP_URL=https://app.cliente.com
NEXT_PUBLIC_API_URL=https://api.cliente.com

ADMIN_EMAIL=admin@cliente.com
ADMIN_PASSWORD=senha-forte-trocar-no-primeiro-login

POSTGRES_PASSWORD=<openssl rand -hex 16>
RABBITMQ_PASS=<openssl rand -hex 16>
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
NEXTAUTH_SECRET=<openssl rand -hex 32>
PROXY_ENCRYPTION_KEY=<openssl rand -hex 16>   # 32 chars exatos

MINIO_ENDPOINT=s3.seu-provider.com
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=cliente1-media
MINIO_PUBLIC_URL=https://media.cliente.com
MINIO_USE_SSL=true
```

Gere os secrets de uma vez:
```bash
for k in JWT_SECRET JWT_REFRESH_SECRET NEXTAUTH_SECRET; do
  echo "$k=$(openssl rand -hex 32)"
done
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "RABBITMQ_PASS=$(openssl rand -hex 16)"
echo "PROXY_ENCRYPTION_KEY=$(openssl rand -hex 16)"
```

## 3. Configurar domínios (Traefik via Dokploy)

Aba **Domains** do compose service:

| Domínio | Service | Container Port |
|---|---|---|
| `app.cliente.com` | `frontend` | 3000 |
| `api.cliente.com` | `backend` | 8080 |

Habilite **HTTPS** (Let's Encrypt) em ambos.

## 4. Deploy

Clique em **Deploy**. Acompanhe os logs do service `backend`:

```
lite-bootstrap: aplicando migrations e bootstrap
lite-bootstrap: pronto
super admin user created
```

Quando ver isso, está pronto. Acesse `https://app.cliente.com` e logue com
`ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## 5. Customizar a marca

1. Logado como admin → menu lateral → **Branding**
2. Faça upload do logo, defina cores, escolha o preset (Modern/Classic/Standard/Minimal)
3. Clique **Salvar** — aplica imediato, sem rebuild

## 6. Habilitar módulos opcionais

Para reativar Shops / Help Desk / Billing / Usage para algum cliente, edite
a env correspondente e clique **Redeploy** (precisa rebuild do front pois
são NEXT_PUBLIC_*):

```env
NEXT_PUBLIC_ENABLE_BILLING=true
```

## Múltiplas instâncias no mesmo host

Para um segundo cliente no mesmo Dokploy:

1. New Project → `uniq-lite-cliente2`
2. Mesmo repo, mesma branch
3. Environment com `STACK_NAME=cliente2` e domínios próprios
4. Bucket S3 separado (`MINIO_BUCKET=cliente2-media`)
5. Deploy

Cada stack roda containers independentes (`cliente1-backend`, `cliente2-backend`
etc) e bancos isolados.

## Backup

Snapshots dos volumes via Dokploy (UI) ou cron com `pg_dump`:

```bash
docker exec ${STACK_NAME}-postgres pg_dump -U uniq uniq | gzip > backup-$(date +%F).sql.gz
```

Volumes que precisam de backup: `postgres_data`, `sessions_data`, `instagram_sessions`.
Bucket S3 já tem versionamento se você habilitar no provider.

## Troubleshooting

**Backend não sobe — `lite-bootstrap: branding table create falhou`**
Comum em dev (SQLite); em Postgres só acontece se a role não tiver permissão de
DDL. Verifique que `POSTGRES_USER` é dono do `POSTGRES_DB`.

**Login retorna 401 mesmo com senha certa**
Bootstrap só cria o admin se `ADMIN_EMAIL` ainda não existir. Se você trocou a
senha no env mas o usuário já tinha sido criado com a antiga, edite direto:
```bash
docker exec -it ${STACK_NAME}-backend sh
# dentro do container: rode um one-off pra atualizar via gorm, ou via SQL direto.
```

**Frontend mostra módulo que devia estar oculto**
NEXT_PUBLIC_* são build-time. Se mudou no env, precisa **rebuild**, não só restart.
No Dokploy: clique em **Rebuild** (não em Redeploy).
