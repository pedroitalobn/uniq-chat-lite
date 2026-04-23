"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { conversationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { useConversationWS } from "@/hooks/useConversationWS";

export default function UnassignedQueuePage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();

  const canView = hasPerm(PERM.queuesView) || hasPerm(PERM.ticketsViewAll);
  const canAssign = hasPerm(PERM.ticketsAssign);
  const wsId = currentWorkspace?.id;

  useConversationWS({
    prefixes: ["conversation.", "queue."],
    onEvent: () => qc.invalidateQueries({ queryKey: ["conversations", wsId, "unassigned"] }),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["conversations", wsId, "unassigned"],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, {
          assigned_user_id: "none",
          status: ["open", "pending"],
          limit: 100,
        })
        .then((r) => r.data as { items: ConversationRow[] }),
    enabled: !!wsId && canView,
    refetchInterval: 15_000,
  });

  const claim = useMutation({
    mutationFn: (id: string) => conversationsApi.assign(wsId as string, id),
    onSuccess: (_, id) => {
      toast.success("Atendimento atribuído a você");
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unassigned"] });
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "mine"] });
    },
    onError: (err) => {
      // 409 Conflict when another agent picked it up first
      const msg = (err as { response?: { status?: number } }).response?.status === 409
        ? "Outro agente já pegou esse atendimento"
        : "Falha ao atribuir — tente novamente";
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unassigned"] });
    },
  });

  if (!wsId || permsLoading) {
    return <div className="p-6">Carregando…</div>;
  }
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Você não tem permissão para ver a fila de pendentes.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold">Sem atribuição</h1>
        <p className="text-sm text-zinc-500">
          Atendimentos aguardando agente. Clique em “Atender” para assumir — a primeira
          atribuição vence em caso de corrida.
        </p>
      </header>
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="p-8 text-sm text-red-500">Erro ao carregar atendimentos.</div>
        ) : (
          <ConversationList
            items={data?.items ?? []}
            isLoading={isLoading}
            emptyLabel="Nenhum atendimento pendente."
            actionLabel={canAssign ? "Atender" : undefined}
            onAction={canAssign ? (conv) => claim.mutate(conv.id) : undefined}
          />
        )}
      </div>
    </div>
  );
}
