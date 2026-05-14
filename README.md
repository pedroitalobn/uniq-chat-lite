# Uniq Lite — White-Label Conversational Platform

Plataforma multi-canal (WhatsApp, Instagram, WABA) self-hosted, pronta para
revenda em modo white-label. Fork enxuto do uniq-chat com:

- **Branding completo via UI** — cores, fontes, logos, favicon, presets de tema
- **Feature flags** — esconde módulos não comerciais (Shops, Help Desk, Billing, Usage)
- **Bootstrap automático** — migrations e usuário admin criados no primeiro start
- **Plano único ilimitado** — sem gates de pagamento ou consumo

## Setup em 3 comandos

```bash
cp .env.example .env             # edite com seus secrets, ADMIN_EMAIL e ADMIN_PASSWORD
docker compose build
docker compose up -d
```

No primeiro boot:
1. Backend aplica todas as migrations (incluindo as do lite)
2. Cria o usuário admin com as credenciais do `.env`
3. Frontend já sobe escondendo Shops/Help Desk/Billing/Usage
4. Login em `https://app.seudominio.com` com `ADMIN_EMAIL` / `ADMIN_PASSWORD`

## Features incluídas

| Módulo | Habilitado por padrão |
|---|---|
| Inbox multi-canal | ✅ |
| CRM (contatos, deals, companies) | ✅ |
| Campaigns | ✅ |
| Journeys (automação) | ✅ |
| Agents (IA conversacional) | ✅ |
| WhatsApp QR + WABA | ✅ |
| Instagram | ✅ |
| Integrations | ✅ |
| Uniq AI | ✅ |
| Settings + Workspace | ✅ |
| **Shops** (e-commerce) | ❌ (flag) |
| **Help Desk** (tickets) | ❌ (flag) |
| **Billing** (pagamentos) | ❌ (flag) |
| **Usage** (consumo) | ❌ (flag) |

Os 4 módulos ocultos permanecem no código — basta setar a flag correspondente
no `.env` para reativar (ex: `NEXT_PUBLIC_ENABLE_BILLING=true`) e rebuild.

## Customizando a marca

Acesse `/admin/branding` logado como admin. Você pode:

- Definir nome do app, logo light/dark, favicon, background do login
- Escolher cores primária / secundária / destaque (color picker)
- Escolher entre 4 presets de tema:
  - **Modern** — Inter, glassmorphism, gradientes (estilo Linear/Vercel)
  - **Classic** — Serif (Playfair/Georgia), sóbrio, corporativo
  - **Standard** — Geist/shadcn neutro padrão
  - **Minimal** — Sem sombras, monocromático, ultra clean
- Preview ao vivo antes de salvar

Mais detalhes em [BRANDING.md](./BRANDING.md).

## Variáveis de ambiente principais

```
# Bootstrap (executado no startup do backend)
BOOTSTRAP_ON_START=true
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=mude-isso-agora
ADMIN_NAME=Admin

# Feature flags (build-time do Next.js)
NEXT_PUBLIC_ENABLE_SHOPS=false
NEXT_PUBLIC_ENABLE_HELPDESK=false
NEXT_PUBLIC_ENABLE_BILLING=false
NEXT_PUBLIC_ENABLE_USAGE=false
```

Veja `.env.example` (raiz, backend e frontend) para a lista completa.

## Arquitetura

```
backend/    Go + Fiber + GORM + Postgres + RabbitMQ + MinIO/S3
frontend/   Next.js 14 (App Router) + Tailwind + shadcn + TanStack Query
instagram-bridge/   Node sidecar para Instagram Private API
```

## Licença

Comercial — entre em contato com o autor para condições de uso e revenda.
