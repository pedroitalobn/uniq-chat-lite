# AGENTS.md - Uniq.chat Project Context

## Project Overview
Uniq.chat is a multi-channel messaging platform that integrates with WhatsApp, Instagram, Facebook, Telegram, LinkedIn, TikTok, and Kwai. It provides an API and dashboard for managing multiple messaging instances, contacts, campaigns, automated journeys, and payment subscriptions.

## Tech Stack

### Backend
- **Language**: Go 1.22
- **Framework**: Fiber v2
- **ORM**: GORM
- **Database**: SQLite (dev) / PostgreSQL (prod)
- **WhatsApp**: whatsmeow library
- **Payment**: Stripe, Asaas (with transparent checkout support)

### Frontend
- **Framework**: Next.js 16 (App Router)
- **UI**: React, Tailwind CSS
- **State**: TanStack Query
- **Auth**: NextAuth.js

### Infrastructure
- **Message Queue**: RabbitMQ (optional)
- **Storage**: MinIO (optional, for media)
- **Real-time**: WebSocket (gorilla/websocket)

## User Roles & Multi-Tenancy

### User Types
- `super_admin`: Platform administrator, manages all accounts, plans, and payment settings
- `customer`: Paid user who can create workspaces and invite team members
- `lead`: Pre-customer who registered for a paid plan but hasn't completed payment (inactive until payment confirmed)

### Workspace System
- Customers can create multiple workspaces (businesses)
- Each workspace has its own instances, contacts, campaigns, etc.
- First user of a workspace is automatically its admin

### RBAC (Role-Based Access Control)
- Custom roles with custom names (e.g., "SDR", "Marketing", "Support")
- Granular permissions per category:
  - `instances`: view, create, edit, delete
  - `inbox`: view, send, assign
  - `campaigns`: view, create, edit, delete, send
  - `crm`: view, create, edit, delete
  - `team`: view, invite, edit, remove
  - `roles`: view, create, edit, delete
  - `settings`: view, edit

### Key Models
- `User`: User account with role (super_admin/customer/lead), password authentication
- `Workspace`: Business/account grouping resources
- `UserWorkspace`: User membership with role assignment
- `Role`: Custom role within workspace
- `Permission`: Granular permission key
- `Invite`: Invitation to join workspace
- `Plan`: Subscription plans (Free, Starter, Pro, Business)
- `PaymentSettings`: Payment provider configuration (Stripe/Asaas)

## Authentication

### Methods
1. **Email/Password**: Traditional registration and login
2. **Anthropic API Key**: Legacy validation (optional via config)

### Registration Flow
- Free plans: User created immediately as `customer`, active, receives JWT
- Paid plans: User created as `lead` (inactive), checkout URL returned, only activated after payment confirmed via webhook

## Payment System

### Providers
- **Stripe**: International cards, transparent/redirect checkout
- **Asaas**: Brazilian Pix, Boleto, Cartão, transparent checkout (checkout transparente)
- **Hotmart**: Reserved for future

### Configuration (Admin)
- `/admin/payment-settings` - Configure provider, API keys, checkout type
- Settings stored in database (not .env)

### Checkout Flow
1. User selects paid plan → registers with plan_id
2. Backend creates lead (inactive), returns checkout URL
3. Frontend redirects to payment (Stripe redirect or transparent Asaas)
4. Payment success → webhook activates lead → converts to customer
5. For transparent checkout: frontend calls `/stripe/activate-lead` after success

## Features

### Messaging
- Multi-instance WhatsApp management
- Send/receive text, media (image, video, audio, document), stickers, location, contacts
- Reactions, polls
- Webhook notifications

### Channels
- WhatsApp (via whatsmeow)
- Instagram
- Facebook
- Telegram
- LinkedIn
- TikTok
- Kwai

### CRM
- Contacts management
- Tags
- Funnels/stages
- Journeys (automations)

### Campaigns
- Bulk messaging
- Scheduling
- Recipient management

### Proxy System
- SOCKS5 / HTTP / HTTPS per instance
- Residential proxy pools (Pro/Business plans)
- AES-256-GCM encrypted passwords

### API Keys
- User-generated API keys for external integrations

## Key API Endpoints

### Auth
- `POST /auth/register` - Register (with optional plan_id for paid plans)
- `POST /auth/login` - Login with email/password
- `POST /auth/refresh` - Refresh token
- `POST /auth/forgot-password` - Password recovery
- `POST /auth/reset-password` - Reset with token

### Workspaces
- `GET/POST /workspaces` - List/create workspaces
- `GET/PUT/DELETE /workspaces/:id` - CRUD workspace
- `GET/DELETE /workspaces/:id/members` - Manage members
- `POST /workspaces/:id/invites` - Create invitation

### Instances
- `GET/POST /instances` - List/create instances
- `GET/PUT/DELETE /instances/:id` - CRUD instance
- `GET /instances/:id/qr` - Get QR code for WhatsApp connection
- `POST /instances/:id/disconnect` - Disconnect WhatsApp
- `PUT/GET/DELETE /instances/:id/proxy` - Proxy configuration
- `GET/POST/DELETE /instances/:id/webhooks` - Webhook management

### Messages
- `POST /instances/:id/messages/text` - Send text
- `GET /instances/:id/messages` - List messages

### Payments (Admin)
- `GET/PUT /admin/payment-settings` - Configure payment providers
- `POST /stripe/checkout` - Create checkout session
- `POST /stripe/activate-lead` - Activate lead after payment
- `POST /stripe/webhook` - Stripe webhook handler

### Admin
- `GET /admin/stats` - Platform statistics
- `GET/POST /admin/users` - List/create users
- `PUT/DELETE /admin/users/:id` - Update/delete users
- `GET/POST/PUT /admin/plans` - Manage subscription plans

## Environment

- Backend: port 8080
- Frontend: port 3011 (dev)
- Database: `backend/uniqdot_dev.db` (SQLite)
- All paths prefixed with `/api` for protected routes

## Key Files

| File | Purpose |
|------|---------|
| `backend/cmd/server/main.go` | Entry point, migrations, seeding |
| `backend/internal/models/user.go` | User model with roles (super_admin/customer/lead) |
| `backend/internal/models/plan.go` | Subscription plans |
| `backend/internal/models/payment_settings.go` | Payment provider config |
| `backend/internal/api/handlers/auth.go` | Auth handlers, lead creation |
| `backend/internal/api/handlers/stripe.go` | Stripe checkout, webhooks, lead activation |
| `backend/internal/api/handlers/admin.go` | Admin handlers, payment settings |
| `backend/internal/api/router.go` | Route definitions |
| `frontend/src/app/(dashboard)/admin/payment-settings/page.tsx` | Payment settings UI |
| `frontend/src/app/(auth)/register/page.tsx` | Registration with plan selection |
| `frontend/src/app/(auth)/checkout/page.tsx` | Transparent checkout page |
| `frontend/src/app/(auth)/payment/success/page.tsx` | Payment success handler |
| `frontend/src/types/index.ts` | TypeScript types including UserRole |