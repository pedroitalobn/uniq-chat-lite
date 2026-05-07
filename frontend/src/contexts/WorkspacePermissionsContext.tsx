"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { workspacePermissionsApi } from "@/lib/api";
import { useWorkspace } from "./WorkspaceContext";

interface Permission {
  id: string;
  key: string;
  name: string;
  category: string;
}

interface Role {
  id: string;
  name: string;
  permissions?: Permission[];
}

interface UserWorkspace {
  user_id: string;
  role_id: string | null;
  role: Role | null;
  is_owner: boolean;
}

type Ctx = {
  isLoading: boolean;
  isOwner: boolean;
  isSuperAdmin: boolean;
  roleName: string | null;
  permissions: Set<string>;
  hasPerm: (key: string) => boolean;
  hasAnyPerm: (keys: string[]) => boolean;
  hasAllPerms: (keys: string[]) => boolean;
};

const defaultCtx: Ctx = {
  isLoading: true,
  isOwner: false,
  isSuperAdmin: false,
  roleName: null,
  permissions: new Set<string>(),
  hasPerm: () => false,
  hasAnyPerm: () => false,
  hasAllPerms: () => false,
};

const WorkspacePermissionsContext = createContext<Ctx>(defaultCtx);

// WorkspacePermissionsProvider fetches the current user's role+permissions for
// the ACTIVE workspace and exposes hasPerm() to any descendant. Re-fetches on
// workspace switch via queryKey.
export function WorkspacePermissionsProvider({ children }: { children: ReactNode }) {
  const { currentWorkspace } = useWorkspace();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "super_admin";
  const workspaceId = currentWorkspace?.id;

  const queryEnabled = !!workspaceId && !!session?.user?.id;
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["workspace-permissions", workspaceId, session?.user?.id],
    queryFn: async () => {
      if (!workspaceId) return null;
      const res = await workspacePermissionsApi.mine(workspaceId);
      const members: UserWorkspace[] = res.members || res;
      const mine = members.find((m) => m.user_id === session?.user?.id);
      return mine || null;
    },
    enabled: queryEnabled,
    staleTime: 2 * 60 * 1000,
  });

  const value = useMemo<Ctx>(() => {
    const perms = new Set<string>();
    if (data?.role?.permissions) {
      data.role.permissions.forEach((p) => perms.add(p.key));
    }
    const isOwner = !!data?.is_owner || isSuperAdmin;
    const hasPerm = (key: string) => {
      if (isOwner) return true;
      return perms.has(key);
    };
    // TanStack Query reporta isLoading=true enquanto NÃO há data, mesmo
    // se a query está disabled (enabled=false). Resultado: páginas que
    // usam permsLoading como gate (ex: /inbox) ficam no <PageSkeleton/>
    // pra sempre quando workspaceId/session.user.id ainda não chegaram.
    // Loading "real" = query habilitada E não tem data E está buscando.
    const realLoading = queryEnabled && isLoading && isFetching;
    return {
      isLoading: realLoading,
      isOwner,
      isSuperAdmin,
      roleName: data?.role?.name ?? null,
      permissions: perms,
      hasPerm,
      hasAnyPerm: (keys) => keys.some(hasPerm),
      hasAllPerms: (keys) => keys.every(hasPerm),
    };
  }, [data, isLoading, isFetching, isSuperAdmin, queryEnabled]);

  return (
    <WorkspacePermissionsContext.Provider value={value}>
      {children}
    </WorkspacePermissionsContext.Provider>
  );
}

export function useWorkspacePermissions() {
  return useContext(WorkspacePermissionsContext);
}

// Permission key constants mirroring backend models/workspace.go.
export const PERM = {
  ticketsView: "tickets:view",
  ticketsViewAll: "tickets:view_all",
  ticketsViewTeam: "tickets:view_team",
  ticketsCreate: "tickets:create",
  ticketsUpdate: "tickets:update",
  ticketsAssign: "tickets:assign",
  ticketsTransfer: "tickets:transfer",
  ticketsClose: "tickets:close",
  ticketsReopen: "tickets:reopen",
  ticketsSnooze: "tickets:snooze",
  notesView: "notes:view",
  notesCreate: "notes:create",
  notesUpdate: "notes:update",
  notesDelete: "notes:delete",
  queuesView: "queues:view",
  queuesManage: "queues:manage",
  teamsView: "teams:view",
  teamsManage: "teams:manage",
  departmentsView: "departments:view",
  departmentsManage: "departments:manage",
  quickRepliesView: "quickreplies:view",
  quickRepliesManageOwn: "quickreplies:manage_own",
  quickRepliesManageShared: "quickreplies:manage_shared",
  reportsView: "reports:view",
  presenceViewOthers: "presence:view_others",
  inboxView: "inbox:view",
  inboxSend: "inbox:send",
  // CRM (legacy + v2)
  crmView: "crm:view",
  crmCreate: "crm:create",
  crmEdit: "crm:edit",
  crmDelete: "crm:delete",
  companiesView: "companies:view",
  companiesCreate: "companies:create",
  companiesEdit: "companies:edit",
  companiesDelete: "companies:delete",
  dealsView: "deals:view",
  dealsCreate: "deals:create",
  dealsEdit: "deals:edit",
  dealsDelete: "deals:delete",
  dealsMoveStage: "deals:move_stage",
  funnelsManage: "funnels:manage",
  // Módulos de infra/config (cada item da sidebar tem o seu)
  dashboardView: "dashboard:view",
  serversView: "servers:view",
  serversManage: "servers:manage",
  agentsView: "agents:view",
  agentsManage: "agents:manage",
  // Uniq AI — chat interativo central que cria/lista/edita recursos via NL.
  uniqAiUse: "uniqai:use",
  // Jornadas — módulo top-level (saiu de dentro de /agents em Apr/26).
  // No backend ainda compartilha o flag agents:* — gateamos a UI já com
  // chaves próprias pra que roles futuras (vendedor sem builder, etc) possam
  // restringir só o módulo de jornada sem mexer em /agents.
  journeysView: "journeys:view",
  journeysManage: "journeys:manage",
  instancesView: "instances:view",
  instancesCreate: "instances:create",
  instancesEdit: "instances:edit",
  instancesDelete: "instances:delete",
  campaignsView: "campaigns:view",
  campaignsManage: "campaigns:send",
  integrationsView: "integrations:view",
  integrationsManage: "integrations:manage",
  billingView: "billing:view",
  billingManage: "billing:manage",
} as const;
