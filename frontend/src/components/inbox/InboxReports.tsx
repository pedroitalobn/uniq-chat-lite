"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, TrendingUp, AlertTriangle, Star, Users, Inbox } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

// Relatórios de inbox — mesma API do antigo /reports/overview mas agora
// renderizado dentro do /inbox e no tema escuro da Uniq.chat.

interface Overview {
  counts: { created: number; resolved: number; closed: number; open_now: number; backlog: number };
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

export function InboxReports({ workspaceId }: { workspaceId: string }) {
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const canView = hasPerm(PERM.reportsView);

  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const { from, to } = buildRange(range);

  const overview = useQuery({
    queryKey: ["reports-overview", workspaceId, range],
    queryFn: () => reportsApi.overview(workspaceId, { from, to }).then((r) => r.data as Overview),
    enabled: !!workspaceId && canView,
  });
  const byQueue = useQuery({
    queryKey: ["reports-by-queue", workspaceId, range],
    queryFn: () => reportsApi.byQueue(workspaceId, { from, to }).then((r) => r.data as QueueReport),
    enabled: !!workspaceId && canView,
  });
  const byUser = useQuery({
    queryKey: ["reports-by-user", workspaceId, range],
    queryFn: () => reportsApi.byUser(workspaceId, { from, to }).then((r) => r.data as UserReport),
    enabled: !!workspaceId && canView,
  });
  const csat = useQuery({
    queryKey: ["reports-csat", workspaceId, range],
    queryFn: () => reportsApi.csat(workspaceId, { from, to }).then((r) => r.data as CSATReport),
    enabled: !!workspaceId && canView,
  });
  const sla = useQuery({
    queryKey: ["reports-sla", workspaceId, range],
    queryFn: () => reportsApi.sla(workspaceId, { from, to }).then((r) => r.data as SLAReport),
    enabled: !!workspaceId && canView,
  });

  if (permsLoading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "hsl(240 8% 50%)" }}>
        Carregando…
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.2)" }}
        >
          <Lock className="h-6 w-6" style={{ color: "#fb923c" }} />
        </div>
        <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>
          Você precisa da permissão{" "}
          <code
            className="rounded px-1.5 py-0.5 text-xs"
            style={{ background: "rgba(255,255,255,0.06)", color: "hsl(240 15% 85%)" }}
          >
            reports:view
          </code>{" "}
          pra ver os relatórios.
        </p>
      </div>
    );
  }

  const c = overview.data?.counts;
  const maxSeries = Math.max(1, ...(overview.data?.series?.map((d) => Math.max(d.created, d.resolved)) ?? [1]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}
            >
              <Inbox className="h-4 w-4" style={{ color: "#00d46a" }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
                Relatórios do atendimento
              </h2>
              <p className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>
                Volume, SLA, CSAT e desempenho por fila/agente.
              </p>
            </div>
          </div>
          <div
            className="flex items-center gap-1 rounded-xl p-1 text-xs"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 16%)" }}
          >
            {(["7d", "30d", "90d"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className="rounded-lg px-3 py-1 transition-colors"
                style={{
                  background: range === r ? "rgba(0,212,106,0.12)" : "transparent",
                  color: range === r ? "#00d46a" : "hsl(240 8% 55%)",
                }}
              >
                {r === "7d" ? "7 dias" : r === "30d" ? "30 dias" : "90 dias"}
              </button>
            ))}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          <KPI label="Criados" value={c?.created ?? 0} tone="blue" icon={<TrendingUp className="h-3.5 w-3.5" />} />
          <KPI label="Resolvidos" value={c?.resolved ?? 0} tone="emerald" icon={<TrendingUp className="h-3.5 w-3.5" />} />
          <KPI label="Encerrados" value={c?.closed ?? 0} tone="zinc" />
          <KPI label="Abertos agora" value={c?.open_now ?? 0} tone="amber" />
          <KPI label="Backlog" value={c?.backlog ?? 0} tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        </section>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 50%)" }}>
              Criados × Resolvidos por dia
            </h3>
            <div className="flex gap-3 text-xs" style={{ color: "hsl(240 8% 55%)" }}>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded" style={{ background: "#60a5fa" }} />
                Criados
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded" style={{ background: "#00d46a" }} />
                Resolvidos
              </span>
            </div>
          </div>
          {!overview.data?.series?.length ? (
            <div className="py-8 text-center text-xs" style={{ color: "hsl(240 8% 40%)" }}>
              Sem dados para o período.
            </div>
          ) : (
            <div className="flex items-end gap-1.5 py-1" style={{ height: 140 }}>
              {overview.data.series.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full items-end gap-0.5" style={{ height: 110 }}>
                    <div
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${(d.created / maxSeries) * 100}%`,
                        background: "rgba(96,165,250,0.6)",
                        minHeight: d.created > 0 ? 2 : 0,
                      }}
                      title={`${d.created} criados`}
                    />
                    <div
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${(d.resolved / maxSeries) * 100}%`,
                        background: "rgba(0,212,106,0.7)",
                        minHeight: d.resolved > 0 ? 2 : 0,
                      }}
                      title={`${d.resolved} resolvidos`}
                    />
                  </div>
                  <span className="text-[9px]" style={{ color: "hsl(240 8% 40%)" }}>
                    {d.day.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <section className="grid gap-3 md:grid-cols-2">
          <SLAPanel sla={sla.data} />
          <CSATPanel csat={csat.data} />
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <TableCard title="Por fila" empty="Sem filas configuradas.">
            {byQueue.data?.items.map((q) => (
              <Row key={q.queue_id} left={q.name}>
                <span style={{ color: "#60a5fa" }}>{q.created} criados</span>
                <span style={{ color: "#00d46a" }}>{q.resolved} resolvidos</span>
                <span style={{ color: "#fbbf24" }}>{q.backlog} backlog</span>
              </Row>
            ))}
          </TableCard>
          <TableCard title="Por agente" icon={<Users className="h-3.5 w-3.5" />} empty="Ainda sem atividade.">
            {byUser.data?.items.slice(0, 20).map((u) => (
              <Row key={u.user_id} left={u.name || u.email}>
                <span>{u.assigned} atribuídos</span>
                <span style={{ color: "#00d46a" }}>{u.resolved} resolvidos</span>
                <span style={{ color: "hsl(240 8% 50%)" }}>{formatSec(u.avg_first_response_sec)} 1ª resp.</span>
              </Row>
            ))}
          </TableCard>
        </section>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
    >
      {children}
    </div>
  );
}

function KPI({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "blue" | "emerald" | "amber" | "red" | "zinc";
  icon?: React.ReactNode;
}) {
  const color = {
    blue: "#60a5fa",
    emerald: "#00d46a",
    amber: "#fbbf24",
    red: "#f87171",
    zinc: "hsl(240 15% 85%)",
  }[tone];
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
    >
      <div
        className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest"
        style={{ color: "hsl(240 8% 45%)" }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function SLAPanel({ sla }: { sla?: SLAReport }) {
  return (
    <Card>
      <div
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
        style={{ color: "hsl(240 8% 50%)" }}
      >
        <AlertTriangle className="h-3.5 w-3.5" /> SLA
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center">
        <div>
          <div className="text-2xl font-semibold tabular-nums" style={{ color: "#f87171" }}>
            {sla?.first_response_breaches ?? 0}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: "hsl(240 8% 50%)" }}>
            1ª resposta rompida
          </div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums" style={{ color: "#f87171" }}>
            {sla?.resolution_breaches ?? 0}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: "hsl(240 8% 50%)" }}>
            Resolução rompida
          </div>
        </div>
      </div>
    </Card>
  );
}

function CSATPanel({ csat }: { csat?: CSATReport }) {
  const max = Math.max(1, ...(csat?.distribution?.map((d) => d.count) ?? [1]));
  return (
    <Card>
      <div
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
        style={{ color: "hsl(240 8% 50%)" }}
      >
        <Star className="h-3.5 w-3.5" /> CSAT
      </div>
      <div className="mt-3 flex items-end gap-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums" style={{ color: "#fbbf24" }}>
            {(csat?.avg_rating ?? 0).toFixed(2)}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: "hsl(240 8% 50%)" }}>
            nota média · {(((csat?.response_rate ?? 0) * 100) | 0)}% respondeu
          </div>
        </div>
        <div className="flex-1">
          {[1, 2, 3, 4, 5].map((r) => {
            const count = csat?.distribution?.find((d) => d.rating === r)?.count ?? 0;
            return (
              <div key={r} className="flex items-center gap-2 text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>
                <span className="w-3">{r}</span>
                <div className="h-1.5 flex-1 rounded" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div
                    className="h-full rounded transition-all"
                    style={{ width: `${(count / max) * 100}%`, background: "#fbbf24" }}
                  />
                </div>
                <span className="w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function TableCard({
  title,
  icon,
  empty,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  empty: string;
  children?: React.ReactNode;
}) {
  const hasChildren = children && (Array.isArray(children) ? children.length > 0 : true);
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-widest"
        style={{ color: "hsl(240 8% 50%)", borderBottom: "1px solid hsl(240 12% 11%)" }}
      >
        {icon}
        {title}
      </div>
      {hasChildren ? (
        <ul>{children}</ul>
      ) : (
        <div className="p-4 text-xs" style={{ color: "hsl(240 8% 40%)" }}>
          {empty}
        </div>
      )}
    </div>
  );
}

function Row({ left, children }: { left: string; children: React.ReactNode }) {
  return (
    <li
      className="flex items-center justify-between gap-3 px-4 py-2.5"
      style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}
    >
      <span className="truncate text-sm font-medium" style={{ color: "hsl(240 15% 82%)" }}>
        {left}
      </span>
      <div className="flex flex-shrink-0 gap-3 text-xs">{children}</div>
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
