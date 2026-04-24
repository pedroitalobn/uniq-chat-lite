package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Workspace represents a business/account that groups users, instances, and resources.
type Workspace struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	OwnerID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"owner_id"`
	Owner     *User      `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Name      string     `gorm:"not null" json:"name"`
	Slug      string     `gorm:"type:varchar(63);uniqueIndex;not null" json:"slug"`
	PlanID    *uuid.UUID `gorm:"type:uuid" json:"plan_id"`
	Plan      *Plan      `gorm:"foreignKey:PlanID" json:"plan,omitempty"`
	IsActive  bool       `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (w *Workspace) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	if w.Slug == "" {
		w.Slug = SlugFrom(w.Name)
	}
	return nil
}

// UserWorkspace represents a user's membership in a workspace with a role.
type UserWorkspace struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_user_workspace" json:"user_id"`
	User        *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_user_workspace" json:"workspace_id"`
	Workspace   *Workspace `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	RoleID      *uuid.UUID `gorm:"type:uuid" json:"role_id"`
	Role        *Role      `gorm:"foreignKey:RoleID" json:"role,omitempty"`
	IsOwner     bool       `gorm:"default:false" json:"is_owner"`
	JoinedAt    time.Time  `json:"joined_at"`
}

func (uw *UserWorkspace) BeforeCreate(tx *gorm.DB) error {
	if uw.ID == uuid.Nil {
		uw.ID = uuid.New()
	}
	if uw.JoinedAt.IsZero() {
		uw.JoinedAt = time.Now()
	}
	return nil
}

// Role represents a custom role within a workspace.
type Role struct {
	ID          uuid.UUID    `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID    `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Workspace   *Workspace   `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Name        string       `gorm:"type:varchar(100);not null" json:"name"`
	Description string       `gorm:"type:text" json:"description,omitempty"`
	Permissions []Permission `gorm:"many2many:role_permissions" json:"permissions,omitempty"`
	IsDefault   bool         `gorm:"default:false" json:"is_default"` // built-in roles
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

func (r *Role) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// Permission represents a granular permission within a workspace.
type Permission struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID *uuid.UUID `gorm:"type:uuid;index" json:"workspace_id,omitempty"` // null = global permission
	Key         string     `gorm:"type:varchar(100);uniqueIndex:idx_permission_key;not null" json:"key"`
	Name        string     `gorm:"type:varchar(200);not null" json:"name"`
	Description string     `gorm:"type:text" json:"description,omitempty"`
	Category    string     `gorm:"type:varchar(50);index" json:"category"` // inbox, campaigns, crm, instances, team
	CreatedAt   time.Time  `json:"created_at"`
}

func (p *Permission) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// RolePermission is the join table for roles and permissions.
type RolePermission struct {
	RoleID       uuid.UUID `gorm:"type:uuid;primaryKey" json:"role_id"`
	PermissionID uuid.UUID `gorm:"type:uuid;primaryKey" json:"permission_id"`
}

// Invite represents an invitation to join a workspace.
type Invite struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	Workspace   *Workspace `gorm:"foreignKey:WorkspaceID" json:"workspace,omitempty"`
	Email       string     `gorm:"type:varchar(255);not null;index" json:"email"`
	RoleID      uuid.UUID  `gorm:"type:uuid;not null" json:"role_id"`
	Role        *Role      `gorm:"foreignKey:RoleID" json:"role,omitempty"`
	InvitedBy   uuid.UUID  `gorm:"type:uuid;not null" json:"invited_by"`
	Inviter     *User      `gorm:"foreignKey:InvitedBy" json:"inviter,omitempty"`
	Token       string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"token"`
	Status      string     `gorm:"type:varchar(20);default:'pending';index" json:"status"` // pending, accepted, expired, revoked
	ExpiresAt   time.Time  `json:"expires_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (i *Invite) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}

// All available permission keys
var (
	// Instance permissions
	PermInstancesView   = "instances:view"
	PermInstancesCreate = "instances:create"
	PermInstancesEdit   = "instances:edit"
	PermInstancesDelete = "instances:delete"

	// Inbox permissions
	PermInboxView   = "inbox:view"
	PermInboxSend   = "inbox:send"
	PermInboxAssign = "inbox:assign"

	// Campaign permissions
	PermCampaignsView   = "campaigns:view"
	PermCampaignsCreate = "campaigns:create"
	PermCampaignsEdit   = "campaigns:edit"
	PermCampaignsDelete = "campaigns:delete"
	PermCampaignsSend   = "campaigns:send"

	// CRM permissions
	PermCRMView   = "crm:view"
	PermCRMCreate = "crm:create"
	PermCRMEdit   = "crm:edit"
	PermCRMDelete = "crm:delete"

	// Team permissions
	PermTeamView   = "team:view"
	PermTeamInvite = "team:invite"
	PermTeamEdit   = "team:edit"
	PermTeamRemove = "team:remove"

	// Role permissions
	PermRolesView   = "roles:view"
	PermRolesCreate = "roles:create"
	PermRolesEdit   = "roles:edit"
	PermRolesDelete = "roles:delete"

	// Settings permissions
	PermSettingsView = "settings:view"
	PermSettingsEdit = "settings:edit"

	// Ticket permissions (conversation/atendimento)
	PermTicketsView     = "tickets:view"
	PermTicketsViewAll  = "tickets:view_all"
	PermTicketsViewTeam = "tickets:view_team"
	PermTicketsCreate   = "tickets:create"
	PermTicketsUpdate   = "tickets:update"
	PermTicketsAssign   = "tickets:assign"
	PermTicketsTransfer = "tickets:transfer"
	PermTicketsClose    = "tickets:close"
	PermTicketsReopen   = "tickets:reopen"
	PermTicketsSnooze   = "tickets:snooze"
	PermTicketsDelete   = "tickets:delete"

	// Internal notes
	PermNotesView   = "notes:view"
	PermNotesCreate = "notes:create"
	PermNotesUpdate = "notes:update"
	PermNotesDelete = "notes:delete"

	// Queues / Teams / Departments
	PermQueuesView      = "queues:view"
	PermQueuesManage    = "queues:manage"
	PermTeamsView       = "teams:view"
	PermTeamsManage     = "teams:manage"
	PermDepartmentsView   = "departments:view"
	PermDepartmentsManage = "departments:manage"

	// Quick replies
	PermQuickRepliesView         = "quickreplies:view"
	PermQuickRepliesManageOwn    = "quickreplies:manage_own"
	PermQuickRepliesManageShared = "quickreplies:manage_shared"

	// Reports / Presence
	PermReportsView      = "reports:view"
	PermReportsExport    = "reports:export"
	PermPresenceViewOthers = "presence:view_others"

	// CRM v2 — granular por entidade (os flags antigos crm:view|create|edit|
	// delete continuam respeitados como fallback/compat)
	PermCompaniesView   = "companies:view"
	PermCompaniesCreate = "companies:create"
	PermCompaniesEdit   = "companies:edit"
	PermCompaniesDelete = "companies:delete"
	PermDealsView       = "deals:view"
	PermDealsCreate     = "deals:create"
	PermDealsEdit       = "deals:edit"
	PermDealsDelete     = "deals:delete"
	PermDealsMoveStage  = "deals:move_stage"
	PermFunnelsManage   = "funnels:manage"

	// Módulos de infra/config — cada um tem seu perm pra a UI gatear os
	// itens da sidebar. Admin que cria role custom ("dev", etc.) escolhe
	// quais desses o papel enxerga.
	PermDashboardView    = "dashboard:view"
	PermServersView      = "servers:view"
	PermServersManage    = "servers:manage"
	PermAgentsView       = "agents:view"
	PermAgentsManage     = "agents:manage"
	PermIntegrationsView = "integrations:view"
	PermIntegrationsManage = "integrations:manage"
	PermBillingView      = "billing:view"
	PermBillingManage    = "billing:manage"
)

// GetAllPermissions returns all default permissions that should be seeded.
func GetAllPermissions() []Permission {
	return []Permission{
		// Instances
		{Key: PermInstancesView, Name: "Visualizar Instâncias", Category: "instances"},
		{Key: PermInstancesCreate, Name: "Criar Instâncias", Category: "instances"},
		{Key: PermInstancesEdit, Name: "Editar Instâncias", Category: "instances"},
		{Key: PermInstancesDelete, Name: "Excluir Instâncias", Category: "instances"},

		// Inbox
		{Key: PermInboxView, Name: "Visualizar Inbox", Category: "inbox"},
		{Key: PermInboxSend, Name: "Enviar Mensagens", Category: "inbox"},
		{Key: PermInboxAssign, Name: "Atribuir Conversas", Category: "inbox"},

		// Campaigns
		{Key: PermCampaignsView, Name: "Visualizar Campanhas", Category: "campaigns"},
		{Key: PermCampaignsCreate, Name: "Criar Campanhas", Category: "campaigns"},
		{Key: PermCampaignsEdit, Name: "Editar Campanhas", Category: "campaigns"},
		{Key: PermCampaignsDelete, Name: "Excluir Campanhas", Category: "campaigns"},
		{Key: PermCampaignsSend, Name: "Enviar Campanhas", Category: "campaigns"},

		// CRM
		{Key: PermCRMView, Name: "Visualizar CRM", Category: "crm"},
		{Key: PermCRMCreate, Name: "Criar Contatos", Category: "crm"},
		{Key: PermCRMEdit, Name: "Editar Contatos", Category: "crm"},
		{Key: PermCRMDelete, Name: "Excluir Contatos", Category: "crm"},

		// Team
		{Key: PermTeamView, Name: "Visualizar Equipe", Category: "team"},
		{Key: PermTeamInvite, Name: "Convidar Membros", Category: "team"},
		{Key: PermTeamEdit, Name: "Editar Membros", Category: "team"},
		{Key: PermTeamRemove, Name: "Remover Membros", Category: "team"},

		// Roles
		{Key: PermRolesView, Name: "Visualizar Funções", Category: "roles"},
		{Key: PermRolesCreate, Name: "Criar Funções", Category: "roles"},
		{Key: PermRolesEdit, Name: "Editar Funções", Category: "roles"},
		{Key: PermRolesDelete, Name: "Excluir Funções", Category: "roles"},

		// Settings
		{Key: PermSettingsView, Name: "Visualizar Configurações", Category: "settings"},
		{Key: PermSettingsEdit, Name: "Editar Configurações", Category: "settings"},

		// Tickets (Atendimentos)
		{Key: PermTicketsView, Name: "Visualizar Atendimentos (próprios + filas)", Category: "tickets"},
		{Key: PermTicketsViewAll, Name: "Visualizar Todos os Atendimentos", Category: "tickets"},
		{Key: PermTicketsViewTeam, Name: "Visualizar Atendimentos da Equipe", Category: "tickets"},
		{Key: PermTicketsCreate, Name: "Criar Atendimento (outbound)", Category: "tickets"},
		{Key: PermTicketsUpdate, Name: "Editar Atendimento", Category: "tickets"},
		{Key: PermTicketsAssign, Name: "Atribuir Atendimento", Category: "tickets"},
		{Key: PermTicketsTransfer, Name: "Transferir Atendimento", Category: "tickets"},
		{Key: PermTicketsClose, Name: "Resolver / Encerrar Atendimento", Category: "tickets"},
		{Key: PermTicketsReopen, Name: "Reabrir Atendimento", Category: "tickets"},
		{Key: PermTicketsSnooze, Name: "Soneca de Atendimento", Category: "tickets"},
		{Key: PermTicketsDelete, Name: "Excluir Atendimento", Category: "tickets"},

		// Notes
		{Key: PermNotesView, Name: "Visualizar Notas Internas", Category: "notes"},
		{Key: PermNotesCreate, Name: "Criar Nota Interna", Category: "notes"},
		{Key: PermNotesUpdate, Name: "Editar Nota Interna", Category: "notes"},
		{Key: PermNotesDelete, Name: "Excluir Nota Interna", Category: "notes"},

		// Queues
		{Key: PermQueuesView, Name: "Visualizar Filas", Category: "queues"},
		{Key: PermQueuesManage, Name: "Gerenciar Filas", Category: "queues"},

		// Teams
		{Key: PermTeamsView, Name: "Visualizar Equipes", Category: "teams"},
		{Key: PermTeamsManage, Name: "Gerenciar Equipes", Category: "teams"},

		// Departments
		{Key: PermDepartmentsView, Name: "Visualizar Departamentos", Category: "departments"},
		{Key: PermDepartmentsManage, Name: "Gerenciar Departamentos", Category: "departments"},

		// Quick replies
		{Key: PermQuickRepliesView, Name: "Visualizar Respostas Rápidas", Category: "quickreplies"},
		{Key: PermQuickRepliesManageOwn, Name: "Gerenciar Respostas Rápidas Pessoais", Category: "quickreplies"},
		{Key: PermQuickRepliesManageShared, Name: "Gerenciar Respostas Rápidas do Workspace", Category: "quickreplies"},

		// Reports & Presence
		{Key: PermReportsView, Name: "Visualizar Relatórios", Category: "reports"},
		{Key: PermReportsExport, Name: "Exportar Relatórios", Category: "reports"},
		{Key: PermPresenceViewOthers, Name: "Visualizar Presença de Outros Agentes", Category: "presence"},

		// CRM v2 — granular
		{Key: PermCompaniesView, Name: "Visualizar Empresas", Category: "crm"},
		{Key: PermCompaniesCreate, Name: "Criar Empresas", Category: "crm"},
		{Key: PermCompaniesEdit, Name: "Editar Empresas", Category: "crm"},
		{Key: PermCompaniesDelete, Name: "Excluir Empresas", Category: "crm"},
		{Key: PermDealsView, Name: "Visualizar Deals", Category: "crm"},
		{Key: PermDealsCreate, Name: "Criar Deals", Category: "crm"},
		{Key: PermDealsEdit, Name: "Editar Deals", Category: "crm"},
		{Key: PermDealsDelete, Name: "Excluir Deals", Category: "crm"},
		{Key: PermDealsMoveStage, Name: "Mover Deal entre Estágios", Category: "crm"},
		{Key: PermFunnelsManage, Name: "Gerenciar Funis e Views", Category: "crm"},

		// Módulos de infra/config — gateiam a visibilidade na sidebar.
		{Key: PermDashboardView, Name: "Visualizar Dashboard", Category: "dashboard"},
		{Key: PermServersView, Name: "Visualizar Servidores", Category: "servers"},
		{Key: PermServersManage, Name: "Gerenciar Servidores", Category: "servers"},
		{Key: PermAgentsView, Name: "Visualizar Agentes IA", Category: "agents"},
		{Key: PermAgentsManage, Name: "Gerenciar Agentes IA", Category: "agents"},
		{Key: PermIntegrationsView, Name: "Visualizar Integrações", Category: "integrations"},
		{Key: PermIntegrationsManage, Name: "Gerenciar Integrações", Category: "integrations"},
		{Key: PermBillingView, Name: "Visualizar Plano/Billing", Category: "billing"},
		{Key: PermBillingManage, Name: "Gerenciar Plano/Billing", Category: "billing"},
	}
}
