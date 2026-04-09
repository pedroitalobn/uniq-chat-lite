# Uniq.chat — Multi-Channel Messaging Platform

Multi-tenant messaging platform that integrates with WhatsApp, Instagram, Facebook, Telegram, LinkedIn, TikTok, and Kwai. Connect multiple messaging numbers, send/receive messages via REST API, configure per-instance proxies, and manage everything through a modern dashboard.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Go 1.22 · Fiber v2 · GORM · whatsmeow |
| Database | PostgreSQL 16 (SQLite fallback for dev) |
| Auth | Email/Password + JWT (access 15m + refresh 7d) |
| Frontend | Next.js 16 · App Router · TanStack Query · Tailwind CSS |
| Real-time | WebSocket (gorilla/websocket) |
| Proxy | SOCKS5 / HTTP / HTTPS per instance · AES-256-GCM encrypted passwords |
| Payments | Stripe, Asaas (transparent + redirect checkout) |

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/your-org/uniq-chat
cd uniq-chat
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
DATABASE_URL=postgres://uniqchat:uniqchat@localhost:5432/uniqchat?sslmode=disable
JWT_SECRET=change-me-32-chars-minimum-secret
PROXY_ENCRYPTION_KEY=exactly-32-bytes-key-here-padded!
PORT=8080
FRONTEND_URL=http://localhost:3011
```

### 2. Start with Docker Compose

```bash
docker compose up -d
```

Services:
- **Backend** → `http://localhost:8080`
- **Frontend** → `http://localhost:3011`
- **PostgreSQL** → `localhost:5432`

### 3. Access the dashboard

Open `http://localhost:3011` and:
- Register with email/password for Free plan
- Select a paid plan to go through checkout

---

## Authentication

Uniq.chat supports **email/password** authentication:

1. User registers with name, email, password
2. Password is hashed with bcrypt (cost 12)
3. JWT access token (15min) + refresh token (7 days) issued

### Registration Flow

- **Free plans**: User created immediately as `customer`, active, receives JWT
- **Paid plans**: User created as `lead` (inactive), redirected to checkout, activated after payment confirmed

### Auth Endpoints

```bash
# Register (free plan)
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "João Silva", "email": "joao@exemplo.com", "password": "senha123"}'

# Register (paid plan - creates lead)
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "João Silva", "email": "joao@exemplo.com", "password": "senha123", "plan_id": "uuid"}'

# Login
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "joao@exemplo.com", "password": "senha123"}'

# Refresh token
curl -X POST http://localhost:8080/auth/refresh \
  -H "Authorization: Bearer <access_token>"

# Forgot password
curl -X POST http://localhost:8080/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "joao@exemplo.com"}'

# Reset password
curl -X POST http://localhost:8080/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token": "xxx", "password": "novasenha123"}'
```

---

## Plans & Payments

### Subscription Plans

| Plan | Price | Instances | Msgs/day | Proxy |
|---|---|---|---|---|
| Free | R$0 | 1 | 100 | — |
| Starter | R$29 | 1 | 100 | — |
| Pro | R$99 | 150 | Unlimited | ✓ |
| Business | R$149 | 300 | Unlimited | ✓ (Residential) |

### Payment Providers

- **Stripe**: International cards, transparent/redirect checkout
- **Asaas**: Brazilian Pix, Boleto, Cartão, transparent checkout

### Admin Payment Settings

```bash
# Get payment settings
curl http://localhost:8080/admin/payment-settings \
  -H "Authorization: Bearer <admin_token>"

# Update payment settings
curl -X PUT http://localhost:8080/admin/payment-settings \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "active_provider": "stripe",
    "stripe_secret_key": "sk_live_...",
    "stripe_checkout_type": "transparent"
  }'
```

### Lead Activation

After successful payment, leads are activated via webhook or direct API:

```bash
curl -X POST http://localhost:8080/stripe/activate-lead \
  -H "Content-Type: application/json" \
  -d '{"lead_id": "uuid"}'
```

---

## REST API Reference

Base URL: `http://localhost:8080`

All authenticated endpoints require:
```
Authorization: Bearer <access_token>
```

Protected routes are prefixed with `/api`.

---

### Instances

```bash
# List instances
curl http://localhost:8080/api/instances \
  -H "Authorization: Bearer <token>"

# Create instance
curl -X POST http://localhost:8080/api/instances \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Suporte Principal"}'

# Get QR Code (to connect WhatsApp)
curl http://localhost:8080/api/instances/<id>/qr \
  -H "Authorization: Bearer <token>"

# Disconnect
curl -X POST http://localhost:8080/api/instances/<id>/disconnect \
  -H "Authorization: Bearer <token>"

# Delete instance
curl -X DELETE http://localhost:8080/api/instances/<id> \
  -H "Authorization: Bearer <token>"
```

### Messages

```bash
# Send text message
curl -X POST http://localhost:8080/api/instances/<id>/messages/text \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to": "5511999999999", "text": "Olá! Tudo bem?"}'

# List messages
curl "http://localhost:8080/api/instances/<id>/messages?limit=50" \
  -H "Authorization: Bearer <token>"
```

### Proxy

```bash
# Get proxy config
curl http://localhost:8080/api/instances/<id>/proxy \
  -H "Authorization: Bearer <token>"

# Set/update proxy
curl -X PUT http://localhost:8080/api/instances/<id>/proxy \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "type": "socks5",
    "host": "proxy.example.com",
    "port": 1080,
    "username": "user",
    "password": "pass"
  }'

# Test proxy
curl -X POST http://localhost:8080/api/instances/<id>/proxy/test \
  -H "Authorization: Bearer <token>"

# Remove proxy
curl -X DELETE http://localhost:8080/api/instances/<id>/proxy \
  -H "Authorization: Bearer <token>"
```

### Webhooks

```bash
# List webhooks
curl http://localhost:8080/api/instances/<id>/webhooks \
  -H "Authorization: Bearer <token>"

# Create webhook
curl -X POST http://localhost:8080/api/instances/<id>/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com/webhook", "events": ["message.received"]}'

# Delete webhook
curl -X DELETE http://localhost:8080/api/instances/<id>/webhooks/<webhook_id> \
  -H "Authorization: Bearer <token>"
```

### Workspaces

```bash
# List workspaces
curl http://localhost:8080/api/workspaces \
  -H "Authorization: Bearer <token>"

# Create workspace
curl -X POST http://localhost:8080/api/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Minha Empresa"}'

# Invite member
curl -X POST http://localhost:8080/api/workspaces/<id>/invites \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type": "application/json" \
  -d '{"email": "colaborador@exemplo.com", "role_id": "uuid"}'
```

### API Keys

```bash
# List API keys
curl http://localhost:8080/api/api-keys \
  -H "Authorization: Bearer <token>"

# Create API key
curl -X POST http://localhost:8080/api/api-keys \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Produção"}'
```

### Admin

```bash
# Stats
curl http://localhost:8080/api/admin/stats \
  -H "Authorization: Bearer <admin_token>"

# List users
curl http://localhost:8080/api/admin/users \
  -H "Authorization: Bearer <admin_token>"

# List plans
curl http://localhost:8080/api/admin/plans \
  -H "Authorization: Bearer <admin_token>"

# Update plan
curl -X PUT http://localhost:8080/api/admin/plans/<plan_id> \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"price": 49, "max_instances": 5}'
```

---

## WebSocket

Connect to receive real-time events:

```
ws://localhost:8080/api/instances/<id>/ws?token=<access_token>
```

### Event types

```json
{ "type": "qr",     "data": { "qr": "<qr-string>" } }
{ "type": "status", "data": { "status": "connected" } }
{ "type": "message","data": { "direction": "in", "from": "5511...", "content": "Oi!" } }
```

---

## Webhook Payload

```json
{
  "event": "message.received",
  "instance_id": "uuid",
  "timestamp": "2026-01-01T12:00:00Z",
  "data": {
    "from": "5511999999999@s.whatsapp.net",
    "content": "Olá!",
    "type": "text"
  }
}
```

---

## Development

### Backend

```bash
cd backend
go run ./cmd/server
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Secret for signing JWTs (min 32 chars) | Yes |
| `PROXY_ENCRYPTION_KEY` | AES-256-GCM key for proxy passwords (exactly 32 bytes) | Yes |
| `PORT` | Backend port (default: `8080`) | No |
| `FRONTEND_URL` | Frontend URL for redirects (default: `http://localhost:3011`) | No |
| `RABBITMQ_URI` | RabbitMQ connection string (optional) | No |
| `MINIO_ENDPOINT` | MinIO endpoint for media storage (optional) | No |

---

## Project Structure

```
uniq-chat/
├── backend/
│   ├── cmd/server/main.go          # Entry point, migrations, seeding
│   └── internal/
│       ├── api/
│       │   ├── handlers/           # HTTP handlers
│       │   ├── middleware/         # JWT auth, role checks
│       │   └── router.go           # Route definitions
│       ├── config/                 # Env config
│       ├── models/                 # GORM models
│       ├── whatsapp/               # WhatsApp client (whatsmeow)
│       ├── services/               # Business logic
│       └── email/                  # Email templates & sending
└── frontend/
    └── src/
        ├── app/
        │   ├── (auth)/             # Login, register, checkout, plans
        │   └── (dashboard)/        # Main app pages
        │       ├── dashboard/      # Stats
        │       ├── instances/      # Instance management
        │       ├── inbox/          # Messaging inbox
        │       ├── crm/             # Contacts & funnels
        │       ├── campaigns/      # Bulk messaging
        │       ├── admin/           # User & plan management
        │       └── settings/       # User settings
        ├── components/             # Reusable UI components
        ├── lib/api.ts              # API client
        └── types/                  # TypeScript definitions
```

---

## License

MIT
