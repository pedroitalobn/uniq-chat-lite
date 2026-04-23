"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Search } from "lucide-react";
import { conversationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { useConversationWS } from "@/hooks/useConversationWS";

export default function AllConversationsPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.ticketsViewAll);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "pending" | "snoozed" | "resolved" | "closed">("all");

  useConversationWS({
    prefixes: ["conversation."],
    onEvent: () => qc.invalidateQueries({ queryKey: ["conversations", wsId, "all"] }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["conversations", wsId, "all", statusFilter, q],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, {
          status: statusFilter === "all" ? undefined : statusFilter,
          q: q || undefined,
          limit: 200,
        })
        .then((r) => r.data as { items: ConversationRow[] }),
    enabled: !!wsId && canView,
    refetchInterval: 30_000,
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Requer permissão <code>tickets:view_all</code>.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Todos os atendimentos</h1>
            <p className="text-sm text-zinc-500">Visão global — todos status, todos responsáveis.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-zinc-400" />
              <input
                className="rounded-md border border-zinc-200 bg-white py-2 pl-8 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                placeholder="Buscar assunto/preview…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1 text-xs">
          {(["all", "open", "pending", "snoozed", "resolved", "closed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-2.5 py-1 ${
                statusFilter === s
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {s === "all" ? "Todos" : STATUS_PT[s]}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <ConversationList items={data?.items ?? []} isLoading={isLoading} />
      </div>
    </div>
  );
}

const STATUS_PT: Record<string, string> = {
  open: "Abertos",
  pending: "Pendentes",
  snoozed: "Soneca",
  resolved: "Resolvidos",
  closed: "Encerrados",
};
