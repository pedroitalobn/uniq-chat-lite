"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { conversationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { useConversationWS } from "@/hooks/useConversationWS";

// Team view: everything the supervisor's role can see via tickets:view_team.
// Backend filtering is permissive today — agents with view_team see whatever
// matches the workspace scope. Fase 4 will narrow to "my team" via a
// team_id filter once supervisors are linked to teams.
export default function TeamInboxPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.ticketsViewTeam) || hasPerm(PERM.ticketsViewAll);

  useConversationWS({
    prefixes: ["conversation.", "queue."],
    onEvent: () => qc.invalidateQueries({ queryKey: ["conversations", wsId, "team"] }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["conversations", wsId, "team"],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, {
          status: ["open", "pending", "snoozed"],
          limit: 100,
        })
        .then((r) => r.data as { items: ConversationRow[] }),
    enabled: !!wsId && canView,
    refetchInterval: 20_000,
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Sem permissão para ver atendimentos da equipe.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold">Equipe</h1>
        <p className="text-sm text-zinc-500">Todos os atendimentos ativos da sua equipe.</p>
      </header>
      <div className="flex-1 overflow-auto">
        <ConversationList items={data?.items ?? []} isLoading={isLoading} />
      </div>
    </div>
  );
}
