"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, TrendingUp, AlertTriangle, Star, Users } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

interface Overview {
  counts: {
    created: number;
    resolved: number;
    closed: number;
    open_now: number;
    backlog: number;
  };
  series: Array<{ day: string; created: number; resolved: number }>;
}

interface QueueReport {
  items: Array<{ queue_id: string; name: string; created: number; resolved: number; backlog: number }>;
}

interface UserReport {
  items: Array<{ user_id: string; name: string; email: string; assigned: number; resolved: number; avg_first_response_sec: number }>;
}

interface CSATReport {
  sent: number;
  answered: number;
  response_rate: number;
  avg_rating: number;
  distribution: Array<{ rating: number; count: number }>;
}

interface SLAReport {
  first_response_breaches: number;
  resolution_breaches: number;
}

export default function ReportsOverviewPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.reportsView);

  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const { from, to } = buildRange(range);

  const overview = useQuery({
    queryKey: ["reports-overview", wsId, range],
    queryFn: () => reportsApi.overview(wsId as string, { from, to }).then((r) => r.data as Overview),
    enabled: !!wsId && canView,
  });
  const byQueue = useQuery({
    queryKey: ["reports-by-queue", wsId, range],
    queryFn: () => reportsApi.byQueue(wsId as string, { from, to }).then((r) => r.data as QueueReport),
    enabled: !!wsId && canView,
  });
  const byUser = useQuery({
    queryKey: ["reports-by-user", wsId, range],
    queryFn: () => reportsApi.byUser(wsId as string, { from, to }).then((r) => r.data as UserReport),
    enabled: !!wsId && canView,
  });
  const csat = useQuery({
    queryKey: ["reports-csat", wsId, range],
    queryFn: () => reportsApi.csat(wsId as string, { from, to }).then((r) => r.data as CSATReport),
    enabled: !!wsId && canView,
  });
  const sla = useQuery({
    queryKey: ["reports-sla", wsId, range],
    queryFn: () => reportsApi.sla(wsId as string, { from, to }).then((r) => r.data as SLAReport),
    enabled: !!wsId && canView,
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Requer permissão <code>reports:view</code>.</p>
      </div>
    );
  }

  const c = overview.data?.counts;
  const maxSeries = Math.max(1, ...(overview.data?.series.map((d) => Math.max(d.created, d.resolved)) ?? [1]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios</h1>
          <p className="text-sm text-zinc-500">Visão consolidada de atendimento, SLA e CSAT.</p>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-zinc-100 p-1 text-xs dark:bg-zinc-800">
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 ${
                range === r ? "bg-white text-zinc-900 shadow dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500"
              }`}
            >
              {r === "7d" ? "7 dias" : r === "30d" ? "30 dias" : "90 dias"}
            </button>
          ))}
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <KPI label="Criados" value={c?.created ?? 0} tone="blue" icon={<TrendingUp className="h-4 w-4" />} />
        <KPI label="Resolvidos" value={c?.resolved ?? 0} tone="emerald" icon={<TrendingUp className="h-4 w-4" />} />
        <KPI label="Encerrados" value={c?.closed ?? 0} tone="zinc" />
        <KPI label="Abertos agora" value={c?.open_now ?? 0} tone="amber" />
        <KPI label="Backlog" value={c?.backlog ?? 0} tone="red" icon={<AlertTriangle className="h-4 w-4" />} />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Criados × resolvidos por dia</h2>
        {!overview.data?.series?.length ? (
          <div className="py-8 text-center text-xs text-zinc-500">Sem dados para o período.</div>
        ) : (
          <div className="flex items-end gap-1 py-2" style={{ height: 140 }}>
            {overview.data.series.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="flex w-full items-end gap-0.5" style={{ height: 110 }}>
                  <div
                    className="flex-1 rounded-sm bg-blue-500/70"
                    style={{ height: `${(d.created / maxSeries) * 100}%` }}
                    title={`${d.created} criados`}
                  />
                  <div
                    className="flex-1 rounded-sm bg-emerald-500/70"
                    style={{ height: `${(d.resolved / maxSeries) * 100}%` }}
                    title={`${d.resolved} resolvidos`}
                  />
                </div>
                <span className="text-[9px] text-zinc-500">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-blue-500/70" /> Criados</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-emerald-500/70" /> Resolvidos</span>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <SLAPanel sla={sla.data} />
        <CSATPanel csat={csat.data} />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <TableCard title="Por fila" empty="Sem filas configuradas.">
          {byQueue.data?.items.map((q) => (
            <Row key={q.queue_id} left={q.name}>
              <span>{q.created} criados</span>
              <span>{q.resolved} resolvidos</span>
              <span className="text-amber-600 dark:text-amber-400">{q.backlog} backlog</span>
            </Row>
          ))}
        </TableCard>
        <TableCard title="Por agente" icon={<Users className="h-4 w-4" />} empty="Ainda sem atividade.">
          {byUser.data?.items.slice(0, 20).map((u) => (
            <Row key={u.user_id} left={u.name || u.email}>
              <span>{u.assigned} atribuídos</span>
              <span>{u.resolved} resolvidos</span>
              <span className="text-zinc-500">{formatSec(u.avg_first_response_sec)} 1ª resp.</span>
            </Row>
          ))}
        </TableCard>
      </section>
    </div>
  );
}

function KPI({ label, value, tone, icon }: { label: string; value: number; tone: "blue" | "emerald" | "amber" | "red" | "zinc"; icon?: React.ReactNode }) {
  const cls = {
    blue: "text-blue-600 dark:text-blue-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    zinc: "text-zinc-700 dark:text-zinc-300",
  }[tone];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function SLAPanel({ sla }: { sla?: SLAReport }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
        <AlertTriangle className="h-4 w-4" /> SLA
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center">
        <div>
          <div className="text-3xl font-semibold text-red-600 dark:text-red-400">{sla?.first_response_breaches ?? 0}</div>
          <div className="text-xs text-zinc-500">1ª resposta rompida</div>
        </div>
        <div>
          <div className="text-3xl font-semibold text-red-600 dark:text-red-400">{sla?.resolution_breaches ?? 0}</div>
          <div className="text-xs text-zinc-500">Resolução rompida</div>
        </div>
      </div>
    </div>
  );
}

function CSATPanel({ csat }: { csat?: CSATReport }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
        <Star className="h-4 w-4" /> CSAT
      </div>
      <div className="mt-3 flex items-end gap-4">
        <div>
          <div className="text-3xl font-semibold text-amber-500">{(csat?.avg_rating ?? 0).toFixed(2)}</div>
          <div className="text-xs text-zinc-500">nota média · {(((csat?.response_rate ?? 0) * 100) | 0)}% respondeu</div>
        </div>
        <div className="flex-1">
          {[1, 2, 3, 4, 5].map((r) => {
            const count = csat?.distribution.find((d) => d.rating === r)?.count ?? 0;
            const max = Math.max(1, ...(csat?.distribution.map((d) => d.count) ?? [1]));
            return (
              <div key={r} className="flex items-center gap-2 text-[10px] text-zinc-500">
                <span className="w-3">{r}</span>
                <div className="h-1.5 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full rounded bg-amber-500" style={{ width: `${(count / max) * 100}%` }} />
                </div>
                <span className="w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TableCard({
  title, icon, empty, children,
}: {
  title: string;
  icon?: React.ReactNode;
  empty: string;
  children?: React.ReactNode;
}) {
  const hasChildren = children && (Array.isArray(children) ? children.length > 0 : true);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500 dark:border-zinc-800">
        {icon}
        {title}
      </div>
      {hasChildren ? <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">{children}</ul> : <div className="p-4 text-xs text-zinc-500">{empty}</div>}
    </div>
  );
}

function Row({ left, children }: { left: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="truncate font-medium">{left}</span>
      <div className="flex flex-shrink-0 gap-3 text-xs text-zinc-500">{children}</div>
    </li>
  );
}

function buildRange(range: "7d" | "30d" | "90d") {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatSec(s: number): string {
  if (!s || s <= 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
}
