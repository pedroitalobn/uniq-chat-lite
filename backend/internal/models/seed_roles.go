package models

import (
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
)

// DefaultRoleSpec descreve uma role "padrão" do sistema — seed automático
// em todo workspace novo + backfill idempotente pra workspaces existentes.
type DefaultRoleSpec struct {
	Name        string
	Description string
	Perms       []string
}

// DefaultRoleSpecs são aplicadas em todo workspace — Admin é criado pelo
// handler de Create já com TODAS as permissões (não entra aqui pra evitar
// duplicar), mas Supervisor / Agente / Agente RO são seedadas aqui.
func DefaultRoleSpecs() []DefaultRoleSpec {
	return []DefaultRoleSpec{
		{
			Name:        "Supervisor",
			Description: "Gestão da equipe: vê todos os atendimentos, filas, equipes, relatórios e presença",
			Perms: []string{
				PermTicketsView, PermTicketsViewAll, PermTicketsViewTeam,
				PermTicketsUpdate, PermTicketsAssign, PermTicketsTransfer,
				PermTicketsClose, PermTicketsReopen, PermTicketsSnooze,
				PermNotesView, PermNotesCreate, PermNotesUpdate,
				PermQueuesView, PermTeamsView, PermDepartmentsView,
				PermQuickRepliesView, PermQuickRepliesManageShared,
				PermReportsView, PermReportsExport,
				PermPresenceViewOthers,
				PermInboxView, PermInboxSend, PermInboxAssign,
			},
		},
		{
			Name:        "Agente",
			Description: "Atendente: trabalha seus atendimentos e filas em que participa",
			Perms: []string{
				PermTicketsView, PermTicketsCreate, PermTicketsUpdate,
				PermTicketsAssign, PermTicketsTransfer, PermTicketsClose,
				PermTicketsReopen, PermTicketsSnooze,
				PermNotesView, PermNotesCreate, PermNotesUpdate, PermNotesDelete,
				PermQuickRepliesView, PermQuickRepliesManageOwn,
				PermInboxView, PermInboxSend,
				PermCRMView,
			},
		},
		{
			Name:        "Agente (Somente Leitura)",
			Description: "Agente com acesso apenas de leitura a atendimentos e notas",
			Perms: []string{
				PermTicketsView, PermNotesView,
				PermQuickRepliesView, PermInboxView,
			},
		},
	}
}

// SeedDefaultRolesForWorkspace cria as roles padrão (além do Admin já
// criado pelo handler) num workspace específico. Idempotente: pula roles
// que já existem pelo name+workspace_id.
func SeedDefaultRolesForWorkspace(db *gorm.DB, workspace *Workspace) {
	if workspace == nil || workspace.ID.String() == "" {
		return
	}
	for _, spec := range DefaultRoleSpecs() {
		var existing Role
		if err := db.Where("workspace_id = ? AND name = ?", workspace.ID, spec.Name).First(&existing).Error; err == nil {
			continue
		}
		role := Role{
			WorkspaceID: workspace.ID,
			Name:        spec.Name,
			Description: spec.Description,
			IsDefault:   true,
		}
		if err := db.Create(&role).Error; err != nil {
			log.Warn().Err(err).Str("workspace", workspace.ID.String()).Str("role", spec.Name).
				Msg("failed to create default role")
			continue
		}
		var perms []Permission
		db.Where("key IN ?", spec.Perms).Find(&perms)
		for _, p := range perms {
			db.Create(&RolePermission{RoleID: role.ID, PermissionID: p.ID})
		}
	}
}

// SeedDefaultRolesForAllWorkspaces é o passo que roda no boot — garante
// que workspaces criados antes do seed existir também tenham as roles.
func SeedDefaultRolesForAllWorkspaces(db *gorm.DB) int {
	var workspaces []Workspace
	db.Find(&workspaces)
	for i := range workspaces {
		SeedDefaultRolesForWorkspace(db, &workspaces[i])
	}
	return len(workspaces)
}
