"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Lock, Users, Clock3, Activity } from "lucide-react";
import { queuesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

interface Queue {
  id: string;
  name: string;
  description?: string;
  department?: { name?: string };
  assignment_strategy: string;
}

interface QueueStats {
  waiting: number;
  active: number;
  members_online: number;
}

// Queues hub — lists all queues with live stats so the supervisor can pick
// which one to drill into. Also works as an agent's "my queues" entry when
// they are a member of multiple filas.
export default function QueuesHubPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.queuesView);

  const { data, isLoading } = useQuery({
    queryKey: ["queues", wsId],
    queryFn: () => queuesApi.list(wsId as string).then((r) => r.data as { items: Queue[] }),
    enabled: !!wsId && canView,
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Sem permissão para ver filas.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold">Filas</h1>
        <p className="text-sm text-zinc-500">Status ao vivo de cada fila. Clique para abrir.</p>
      </header>
      {isLoading && <div className="text-sm text-zinc-500">Carregando…</div>}
      {!isLoading && !data?.items.length && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nenhuma fila configurada.{" "}
          <Link href="/settings/queues" className="text-blue-600 hover:underline">
            Criar primeira fila →
          </Link>
        </div>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {data?.items.map((q) => (
          <li key={q.id}>
            <QueueCard queue={q} wsId={wsId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueCard({ queue, wsId }: { queue: Queue; wsId: string }) {
  const stats = useQuery({
    queryKey: ["queue-stats", wsId, queue.id],
    queryFn: () => queuesApi.stats(wsId, queue.id).then((r) => r.data as QueueStats),
    refetchInterval: 15_000,
  });
  return (
    <Link
      href={`/inbox/queue/${queue.id}`}
      className="block rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-blue-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{queue.name}</h3>
          <p className="text-xs text-zinc-500">
            {queue.department?.name && `${queue.department.name} · `}
            {queue.assignment_strategy}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Mini icon={<Clock3 className="h-3.5 w-3.5" />} label="Aguardando" value={stats.data?.waiting ?? 0} tone="amber" />
        <Mini icon={<Activity className="h-3.5 w-3.5" />} label="Ativos" value={stats.data?.active ?? 0} tone="emerald" />
        <Mini icon={<Users className="h-3.5 w-3.5" />} label="Online" value={stats.data?.members_online ?? 0} tone="blue" />
      </div>
    </Link>
  );
}

function Mini({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "emerald" | "amber" | "blue" }) {
  const cls = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
  }[tone];
  return (
    <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
      <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500">
        {icon} {label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
