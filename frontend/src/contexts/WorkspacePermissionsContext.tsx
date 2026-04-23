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

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-permissions", workspaceId, session?.user?.id],
    queryFn: async () => {
      if (!workspaceId) return null;
      const res = await workspacePermissionsApi.mine(workspaceId);
      const members: UserWorkspace[] = res.members || res;
      const mine = members.find((m) => m.user_id === session?.user?.id);
      return mine || null;
    },
    enabled: !!workspaceId && !!session?.user?.id,
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
    return {
      isLoading,
      isOwner,
      isSuperAdmin,
      roleName: data?.role?.name ?? null,
      permissions: perms,
      hasPerm,
      hasAnyPerm: (keys) => keys.some(hasPerm),
      hasAllPerms: (keys) => keys.every(hasPerm),
    };
  }, [data, isLoading, isSuperAdmin]);

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
  reportsView: "reports:view",
  presenceViewOthers: "presence:view_others",
  inboxView: "inbox:view",
  inboxSend: "inbox:send",
} as const;
