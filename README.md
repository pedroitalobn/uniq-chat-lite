# Story-Chat — WhatsApp API SaaS

Multi-tenant WhatsApp API platform powered by [whatsmeow](https://github.com/tulir/whatsmeow). Connect multiple WhatsApp numbers, send/receive messages via REST API, configure per-instance proxies, and manage everything through a modern dashboard.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Go 1.22 · Fiber v2 · GORM · whatsmeow |
| Database | PostgreSQL 16 (SQLite fallback for dev) |
| Auth | Anthropic API Key → JWT (access 15m + refresh 7d) |
| Frontend | Next.js 15 · App Router · TanStack Query · Tailwind CSS |
| Real-time | WebSocket (gorilla/websocket) |
| Proxy | SOCKS5 / HTTP / HTTPS per instance · AES-256-GCM encrypted passwords |

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/your-org/story-chat
cd story-chat
cp .env.example .env
```

Edit `.env` — the only required values are:

```env
DATABASE_URL=postgres://storychat:storychat@localhost:5432/storychat?sslmode=disable
JWT_SECRET=change-me-32-chars-minimum-secret
PROXY_ENCRYPTION_KEY=exactly-32-bytes-key-here-padded!   # must be exactly 32 bytes
ANTHROPIC_VALIDATE_KEYS=true
```

### 2. Start with Docker Compose

```bash
docker compose up -d
```

Services:
- **Backend** → `http://localhost:8080`
- **Frontend** → `http://localhost:3000`
- **PostgreSQL** → `localhost:5432`

### 3. Login

Open `http://localhost:3000` and enter your Anthropic API key (`sk-ant-...`).
The platform validates the key against Anthropic's API — no passwords stored.

---

## Authentication

Story-Chat uses **Anthropic API Keys** as the authentication credential.

1. User submits their `sk-ant-...` key
2. Backend calls `GET https://api.anthropic.com/v1/models` to validate
3. On success, the key hash is stored and a JWT is issued
4. User account is created automatically on first login

The plaintext API key is **never stored** — only a SHA-256 hash is kept for identity.

---

## REST API Reference

Base URL: `http://localhost:8080`

All authenticated endpoints require:
```
Authorization: Bearer <access_token>
```

---

### Auth

#### Validate an Anthropic key
```bash
curl -X POST http://localhost:8080/auth/validate-key \
  -H "Content-Type: application/json" \
  -d '{"anthropic_api_key": "sk-ant-..."}'
```

#### Login (get JWT)
```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"anthropic_api_key": "sk-ant-..."}'
# Returns: { "access_token": "...", "refresh_token": "...", "user": {...} }
```

#### Refresh token
```bash
curl -X POST http://localhost:8080/auth/refresh \
  -H "Authorization: Bearer <access_token>"
```

#### Current user
```bash
curl http://localhost:8080/auth/me \
  -H "Authorization: Bearer <access_token>"
```

---

### Instances

#### List instances
```bash
curl http://localhost:8080/instances \
  -H "Authorization: Bearer <token>"
```

#### Create instance
```bash
curl -X POST http://localhost:8080/instances \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Suporte Principal"}'
```

#### Get QR Code (to connect WhatsApp)
```bash
curl http://localhost:8080/instances/<id>/qr \
  -H "Authorization: Bearer <token>"
# Returns: { "qr": "<base64-encoded-qr-data>" }
# Or: { "message": "instância já conectada" }
```

#### Get instance status
```bash
curl http://localhost:8080/instances/<id>/status \
  -H "Authorization: Bearer <token>"
```

#### Disconnect
```bash
curl -X POST http://localhost:8080/instances/<id>/disconnect \
  -H "Authorization: Bearer <token>"
```

#### Delete instance
```bash
curl -X DELETE http://localhost:8080/instances/<id> \
  -H "Authorization: Bearer <token>"
```

---

### Messages

#### Send a text message
```bash
curl -X POST http://localhost:8080/instances/<id>/messages/text \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to": "5511999999999", "text": "Olá! Tudo bem?"}'
```

#### List received/sent messages
```bash
curl "http://localhost:8080/instances/<id>/messages?limit=50&offset=0" \
  -H "Authorization: Bearer <token>"
```

---

### Proxy (Pro/Enterprise plans)

#### Get proxy config
```bash
curl http://localhost:8080/instances/<id>/proxy \
  -H "Authorization: Bearer <token>"
```

#### Set/update proxy
```bash
curl -X PUT http://localhost:8080/instances/<id>/proxy \
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
```

Supported types: `socks5`, `http`, `https`

#### Test proxy connectivity
```bash
# Test the saved proxy
curl -X POST http://localhost:8080/instances/<id>/proxy/test \
  -H "Authorization: Bearer <token>" \
  -d '{}'

# Test an unsaved config
curl -X POST http://localhost:8080/instances/<id>/proxy/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "type": "socks5",
    "host": "proxy.example.com",
    "port": 1080
  }'
# Returns: { "success": true, "external_ip": "1.2.3.4", "latency_ms": 142 }
```

#### Remove proxy
```bash
curl -X DELETE http://localhost:8080/instances/<id>/proxy \
  -H "Authorization: Bearer <token>"
```

---

### Webhooks

#### List webhooks for an instance
```bash
curl http://localhost:8080/instances/<id>/webhooks \
  -H "Authorization: Bearer <token>"
```

#### Create webhook
```bash
curl -X POST http://localhost:8080/instances/<id>/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["message.received", "status.changed"]
  }'
```

Available events: `message.received`, `message.sent`, `status.changed`, `qr.updated`

#### Update webhook
```bash
curl -X PUT http://localhost:8080/instances/<id>/webhooks/<webhook_id> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"is_active": false}'
```

#### Delete webhook
```bash
curl -X DELETE http://localhost:8080/instances/<id>/webhooks/<webhook_id> \
  -H "Authorization: Bearer <token>"
```

---

### API Keys

#### List API keys
```bash
curl http://localhost:8080/api-keys \
  -H "Authorization: Bearer <token>"
```

#### Create API key
```bash
curl -X POST http://localhost:8080/api-keys \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Produção"}'
# Returns: { "id": "...", "key": "sc_...", "name": "Produção" }
# The plaintext key is only returned once — store it securely
```

#### Delete API key
```bash
curl -X DELETE http://localhost:8080/api-keys/<id> \
  -H "Authorization: Bearer <token>"
```

---

### Admin (role: admin only)

#### Stats
```bash
curl http://localhost:8080/admin/stats \
  -H "Authorization: Bearer <admin_token>"
```

#### List all users
```bash
curl http://localhost:8080/admin/users \
  -H "Authorization: Bearer <admin_token>"
```

#### Update user (block, change plan, etc.)
```bash
curl -X PUT http://localhost:8080/admin/users/<user_id> \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"is_active": false}'
```

#### List plans
```bash
curl http://localhost:8080/admin/plans \
  -H "Authorization: Bearer <admin_token>"
```

#### Update plan
```bash
curl -X PUT http://localhost:8080/admin/plans/<plan_id> \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 49,
    "max_instances": 5,
    "max_messages_per_day": 10000,
    "allow_proxy": true,
    "is_active": true
  }'
```

---

## WebSocket

Connect to receive real-time events per instance:

```
ws://localhost:8080/instances/<id>/ws
```

Requires `Authorization: Bearer <token>` as a query param or header.

### Event types

```json
{ "type": "qr",     "data": { "qr": "<qr-string>" } }
{ "type": "status", "data": { "status": "connected" } }
{ "type": "message","data": { "direction": "in", "from": "5511...", "content": "Oi!" } }
```

---

## Webhook Payload

When a webhook fires, the POST body is:

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

## Plans

| Plan | Price | Instances | Msgs/day | Proxy |
|---|---|---|---|---|
| Free | R$0 | 1 | 1,000 | — |
| Pro | R$49/mês | 5 | 10,000 | SOCKS5/HTTP/HTTPS |
| Enterprise | R$149/mês | Unlimited | Unlimited | SOCKS5/HTTP/HTTPS |

Plans can be edited by an admin via the dashboard or API.

---

## Default Admin

The first deploy seeds an admin account:
- **Email**: `admin@storychat.app`
- **Password**: The admin logs in using an Anthropic API key like any user, then their role is promoted to `admin` via direct DB update or via `/admin/users`.

To promote a user to admin via SQL:
```sql
UPDATE users SET role = 'admin' WHERE email = 'user@example.com';
```

---

## Development

### Backend only

```bash
cd backend
go run ./cmd/server
```

### Frontend only

```bash
cd frontend
npm install
npm run dev
```

### Environment variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Secret for signing JWTs (min 32 chars) | Yes |
| `PROXY_ENCRYPTION_KEY` | AES-256-GCM key for proxy passwords (exactly 32 bytes) | Yes |
| `PORT` | Backend port (default: `8080`) | No |
| `ANTHROPIC_VALIDATE_KEYS` | Whether to validate keys against Anthropic API (default: `true`) | No |
| `NEXT_PUBLIC_API_URL` | Backend URL for the frontend (default: `http://localhost:8080`) | No |

---

## Project Structure

```
story-chat/
├── backend/
│   ├── cmd/server/main.go          # Entry point
│   ├── internal/
│   │   ├── api/
│   │   │   ├── handlers/           # HTTP handlers (auth, instances, proxy, ...)
│   │   │   ├── middleware/         # JWT auth, OwnsInstance, RequireAdmin
│   │   │   └── router.go
│   │   ├── config/                 # Env config
│   │   ├── models/                 # GORM models
│   │   └── whatsapp/
│   │       ├── instance.go         # InstanceClient (wraps whatsmeow)
│   │       ├── manager.go          # Singleton managing all instances
│   │       └── proxy.go            # Proxy builder, tester, encryption
│   └── migrations/                 # SQL migrations
└── frontend/
    └── src/
        ├── app/
        │   ├── (auth)/login/       # Login page (Anthropic key input)
        │   └── (dashboard)/
        │       ├── dashboard/      # Stats + chart
        │       ├── instances/      # List + detail (tabs: Geral/Proxy/Webhooks/Logs)
        │       ├── api-keys/       # API key management
        │       └── admin/          # users + plans (admin only)
        ├── components/
        │   ├── instances/          # ProxyConfigForm, QRCodeModal, CreateInstanceModal
        │   └── layout/             # Sidebar
        ├── lib/api.ts              # Typed Axios helpers
        └── types/index.ts          # Shared TypeScript types
```

---

## License

MIT
