"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { conversationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { useConversationWS } from "@/hooks/useConversationWS";

export default function MyConversationsPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();

  const canView = hasPerm(PERM.ticketsView);
  const wsId = currentWorkspace?.id;
  const qc = useQueryClient();

  useConversationWS({
    prefixes: ["conversation.", "queue."],
    onEvent: () => {
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "mine"] });
      qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["conversations", wsId, "mine"],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, {
          assigned_user_id: "me",
          status: ["open", "pending", "snoozed"],
          limit: 50,
        })
        .then((r) => r.data as { items: ConversationRow[]; total: number; has_more: boolean }),
    enabled: !!wsId && canView,
    refetchInterval: 30_000,
  });

  const { data: counts } = useQuery({
    queryKey: ["conversations-count", wsId],
    queryFn: () => conversationsApi.count(wsId as string).then((r) => r.data as Record<string, number>),
    enabled: !!wsId && canView,
    refetchInterval: 30_000,
  });

  if (!wsId || permsLoading) return <PageSkeleton />;

  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <h2 className="text-lg font-medium">Sem acesso ao módulo de atendimento</h2>
        <p className="max-w-md text-sm text-zinc-500">
          Peça ao administrador do workspace para adicionar a permissão
          {" "}<code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">tickets:view</code>{" "}
          à sua função.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold">Meus atendimentos</h1>
          <p className="text-sm text-zinc-500">
            Conversas atribuídas a você, abertas, pendentes ou em soneca.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Chip>Abertos: {counts?.mine_open ?? 0}</Chip>
          <Chip variant="muted">Sem atribuição: {counts?.unassigned_open ?? 0}</Chip>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="p-8 text-sm text-red-500">Erro ao carregar atendimentos.</div>
        ) : (
          <ConversationList
            items={data?.items ?? []}
            isLoading={isLoading}
            emptyLabel="Você não tem atendimentos abertos."
          />
        )}
      </div>
    </div>
  );
}

function Chip({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "muted";
}) {
  const cls =
    variant === "muted"
      ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function PageSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <div className="h-8 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
    </div>
  );
}
