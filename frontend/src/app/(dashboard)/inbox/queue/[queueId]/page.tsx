"use client";

import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Users } from "lucide-react";
import { conversationsApi, queuesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";

interface QueueDetails {
  id: string;
  name: string;
  description?: string;
  color?: string;
  assignment_strategy: string;
  auto_assign_on_open: boolean;
  department?: { name?: string } | null;
  team?: { name?: string } | null;
}

interface QueueStats {
  waiting: number;
  active: number;
  members_online: number;
}

export default function QueuePage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();

  const canView = hasPerm(PERM.queuesView) || hasPerm(PERM.ticketsView);
  const canAssign = hasPerm(PERM.ticketsAssign);
  const wsId = currentWorkspace?.id;

  const { data: queue } = useQuery({
    queryKey: ["queue", wsId, queueId],
    queryFn: () => queuesApi.get(wsId as string, queueId).then((r) => r.data as QueueDetails),
    enabled: !!wsId && canView,
  });

  const { data: stats } = useQuery({
    queryKey: ["queue-stats", wsId, queueId],
    queryFn: () => queuesApi.stats(wsId as string, queueId).then((r) => r.data as QueueStats),
    enabled: !!wsId && canView,
    refetchInterval: 15_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["conversations", wsId, "queue", queueId],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, {
          queue_id: queueId,
          status: ["open", "pending", "snoozed"],
          limit: 100,
        })
        .then((r) => r.data as { items: ConversationRow[] }),
    enabled: !!wsId && canView,
    refetchInterval: 15_000,
  });

  const claim = useMutation({
    mutationFn: (id: string) => conversationsApi.assign(wsId as string, id),
    onSuccess: () => {
      toast.success("Atendimento atribuído a você");
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "queue", queueId] });
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "mine"] });
    },
    onError: (err) => {
      const msg = (err as { response?: { status?: number } }).response?.status === 409
        ? "Outro agente já pegou esse atendimento"
        : "Falha ao atribuir";
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "queue", queueId] });
    },
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Sem permissão para esta fila.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{queue?.name ?? "Fila"}</h1>
            <p className="text-sm text-zinc-500">
              {queue?.department?.name && `${queue.department.name} · `}
              Estratégia <b>{queue?.assignment_strategy ?? "—"}</b>
              {queue?.auto_assign_on_open === false && " · distribuição manual"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Stat label="Aguardando" value={stats?.waiting ?? 0} tone="amber" />
            <Stat label="Em atendimento" value={stats?.active ?? 0} tone="emerald" />
            <Stat label="Online" value={stats?.members_online ?? 0} tone="blue" icon={<Users className="h-3.5 w-3.5" />} />
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <ConversationList
          items={data?.items ?? []}
          isLoading={isLoading}
          emptyLabel="Nenhum atendimento nesta fila."
          actionLabel={canAssign ? "Atender" : undefined}
          onAction={canAssign ? (conv) => claim.mutate(conv.id) : undefined}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "blue";
  icon?: React.ReactNode;
}) {
  const toneCls = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
  }[tone];
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
      {icon}
      <span className="text-zinc-500">{label}</span>
      <span className={`font-semibold ${toneCls}`}>{value}</span>
    </div>
  );
}
