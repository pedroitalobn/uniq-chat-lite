# AGENTS.md - Uniq.chat Project Context

## Project Overview
Uniq.chat is a multi-channel messaging platform that integrates with WhatsApp, Instagram, Facebook, Telegram, LinkedIn, TikTok, and Kwai. It provides an API and dashboard for managing multiple WhatsApp instances, contacts, campaigns, and automated journeys.

## Tech Stack
- **Backend**: Go (Fiber framework, GORM, SQLite/PostgreSQL)
- **Frontend**: Next.js 16, React, Tailwind CSS
- **WhatsApp**: whatsmeow library
- **Database**: SQLite (dev) / PostgreSQL (prod)

## User Roles & Multi-Tenancy

### User Types
- `super_admin`: Platform administrator (you), manages all accounts
- `customer`: Paid user who can create workspaces and invite team members

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
- `User`: User account with role (super_admin/customer)
- `Workspace`: Business/account grouping resources
- `UserWorkspace`: User membership with role assignment
- `Role`: Custom role within workspace
- `Permission`: Granular permission key
- `Invite`: Invitation to join workspace

## API Endpoints - Workspace & Team

### Workspaces
- `GET /workspaces` - List user's workspaces
- `POST /workspaces` - Create new workspace
- `GET /workspaces/:id` - Get workspace details
- `PUT /workspaces/:id` - Update workspace
- `DELETE /workspaces/:id` - Deactivate workspace

### Members
- `GET /workspaces/:id/members` - List members
- `DELETE /workspaces/:id/members/:member_id` - Remove member

### Invites
- `POST /workspaces/:id/invites` - Create invitation
- `GET /workspaces/:id/invites` - List pending invites
- `DELETE /workspaces/:id/invites/:invite_id` - Revoke invite
- `POST /workspaces/accept-invite/:token` - Accept invitation

### Roles
- `GET /workspaces/:workspace_id/roles` - List roles
- `POST /workspaces/:workspace_id/roles` - Create role
- `GET /workspaces/:workspace_id/roles/:id` - Get role
- `PUT /workspaces/:workspace_id/roles/:id` - Update role
- `DELETE /workspaces/:workspace_id/roles/:id` - Delete role

### Permissions
- `GET /permissions` - List all available permissions
- `POST /permissions/seed` - Seed default permissions (admin only)

## Key Files

| File | Purpose |
|------|---------|
| `backend/internal/models/workspace.go` | Workspace, Role, Permission models |
| `backend/internal/api/handlers/workspace.go` | Workspace API handler |
| `backend/internal/api/handlers/role.go` | Role/Permission API handler |
| `frontend/src/types/index.ts` | TypeScript types (Workspace, Role, etc.) |
| `frontend/src/lib/api.ts` | API client methods |

## Current State - Inbox Feature

### Working
- Conversations display correctly
- Text messages send and receive
- Channel multiselect works
- Real-time updates via polling
- Media message types are saved to database
- Empty state uses static color #1d1d25

### Message Types Supported
**Receive (saved to DB)**:
- Text, Image, Video, Audio, Document, Sticker, Location, Contact, Reaction, Poll

**Display (frontend)**:
- Shows appropriate icon and label for each type

## Database Schema
- `message_logs` table with `to_j_id` column
- Content stored as JSON-encoded string
- All models now have `workspace_id` where applicable

## Environment
- Backend runs on port 8080
- Frontend runs on port 3000 (dev) / 3011 (configured)
- SQLite database: `backend/uniqdot_dev.db`
- Auth required - redirect to /login if not authenticated
