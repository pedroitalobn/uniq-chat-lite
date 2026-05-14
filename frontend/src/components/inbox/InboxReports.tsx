"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, TrendingUp, AlertTriangle, Star, Users, Inbox, RefreshCw, AlertCircle } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

// Relatórios do inbox — métricas de atendimento (volume, SLA, CSAT, fila/agente).
// Mesmo backend do antigo /reports/overview, agora dentro de /inbox?view=reports
// no tema escuro da Qchat (var(--surface-solid) + accent #2563EB).

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

const CARD_BG = "var(--surface-solid)";
const CARD_BORDER = "1px solid var(--border)";

export function InboxReports({ workspaceId }: { workspaceId: string }) {
  const { hasPerm, hasAnyPerm, isLoading: permsLoading, isOwner } = useWorkspacePermissions();
  // Reports é métrica de atendimento — qualquer um com tickets:view ou inbox:view
  // deveria conseguir ver pelo menos os números do que está atendendo. Usamos
  // reports:view como primary mas caímos pra ticketsView/inboxView como fallback
  // pra não bloquear quem tem acesso ao inbox de ver os números do próprio
  // trabalho. Owner/super-admin sempre passa via hasPerm.
  const canView =
    isOwner ||
    hasPerm(PERM.reportsView) ||
    hasAnyPerm([PERM.ticketsView, PERM.inboxView]);

  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const { from, to } = buildRange(range);

  const enabled = !!workspaceId && canView;

  const overview = useQuery({
    queryKey: ["reports-overview", workspaceId, range],
    queryFn: () => reportsApi.overview(workspaceId, { from, to }).then((r) => r.data as Overview),
    enabled,
    retry: 1,
  });
  const byQueue = useQuery({
    queryKey: ["reports-by-queue", workspaceId, range],
    queryFn: () => reportsApi.byQueue(workspaceId, { from, to }).then((r) => r.data as QueueReport),
    enabled,
    retry: 1,
  });
  const byUser = useQuery({
    queryKey: ["reports-by-user", workspaceId, range],
    queryFn: () => reportsApi.byUser(workspaceId, { from, to }).then((r) => r.data as UserReport),
    enabled,
    retry: 1,
  });
  const csat = useQuery({
    queryKey: ["reports-csat", workspaceId, range],
    queryFn: () => reportsApi.csat(workspaceId, { from, to }).then((r) => r.data as CSATReport),
    enabled,
    retry: 1,
  });
  const sla = useQuery({
    queryKey: ["reports-sla", workspaceId, range],
    queryFn: () => reportsApi.sla(workspaceId, { from, to }).then((r) => r.data as SLAReport),
    enabled,
    retry: 1,
  });

  // Loading: inclui carregamento de permissões + workspace + a primeira query.
  // Mostra skeleton ao invés de "Carregando…" pra não parecer travado.
  const initialLoading = permsLoading || !workspaceId || (overview.isLoading && !overview.data);

  // Erro persistente em qualquer query (após retry). Só mostra full-screen
  // se for o overview que falhou — outros são erros parciais que viram
  // empty state local.
  const fatalError =
    overview.isError &&
    !overview.isPending &&
    !overview.data;

  // Permission lock — fica DEPOIS de checar permsLoading pra não piscar.
  if (!permsLoading && !canView) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
        style={{ background: "var(--surface-solid)" }}
      >
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)" }}
        >
          <Lock className="h-7 w-7" style={{ color: "#fb923c" }} />
        </div>
        <div className="space-y-1.5 max-w-sm">
          <h3 className="text-base font-medium" style={{ color: "var(--text-1)" }}>
            Sem acesso aos relatórios
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
            Peça pro administrador do workspace marcar a permissão{" "}
            <code
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
            >
              reports:view
            </code>{" "}
            na sua função.
          </p>
        </div>
      </div>
    );
  }

  // Estado: carregando inicial → skeleton.
  if (initialLoading) {
    return <InboxReportsSkeleton range={range} setRange={setRange} />;
  }

  // Estado: erro fatal no overview (rota não responde, 401, 500…).
  if (fatalError) {
    const status = (overview.error as { response?: { status?: number } })?.response?.status;
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6 space-y-4">
          <ReportsHeader range={range} setRange={setRange} />
          <div
            className="rounded-2xl p-6 flex flex-col items-center text-center gap-3"
            style={{ background: CARD_BG, border: CARD_BORDER }}
          >
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <AlertCircle className="h-6 w-6" style={{ color: "#f87171" }} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                Não foi possível carregar os relatórios
              </h3>
              <p className="text-xs" style={{ color: "var(--text-3)" }}>
                {status === 403
                  ? "Permissão insuficiente — fale com o admin do workspace."
                  : status === 401
                    ? "Sua sessão expirou. Recarregue a página."
                    : "A API de relatórios não respondeu. Tente novamente."}
              </p>
            </div>
            <button
              onClick={() => {
                overview.refetch();
                byQueue.refetch();
                byUser.refetch();
                csat.refetch();
                sla.refetch();
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-xl transition-colors"
              style={{ background: "rgba(37, 99, 235,0.1)", color: "#2563EB", border: "1px solid rgba(37, 99, 235,0.25)" }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  const c = overview.data?.counts;
  const maxSeries = Math.max(1, ...(overview.data?.series?.map((d) => Math.max(d.created, d.resolved)) ?? [1]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <ReportsHeader range={range} setRange={setRange} />

        <section className="grid gap-3 md:grid-cols-5">
          <KPI label="Criados" value={c?.created ?? 0} tone="blue" icon={<TrendingUp className="h-3.5 w-3.5" />} loading={overview.isFetching} />
          <KPI label="Resolvidos" value={c?.resolved ?? 0} tone="emerald" icon={<TrendingUp className="h-3.5 w-3.5" />} loading={overview.isFetching} />
          <KPI label="Encerrados" value={c?.closed ?? 0} tone="zinc" loading={overview.isFetching} />
          <KPI label="Abertos agora" value={c?.open_now ?? 0} tone="amber" loading={overview.isFetching} />
          <KPI label="Backlog" value={c?.backlog ?? 0} tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />} loading={overview.isFetching} />
        </section>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
              Criados × Resolvidos por dia
            </h3>
            <div className="flex gap-3 text-xs" style={{ color: "var(--text-3)" }}>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded" style={{ background: "#60a5fa" }} />
                Criados
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded" style={{ background: "#2563EB" }} />
                Resolvidos
              </span>
            </div>
          </div>
          {!overview.data?.series?.length ? (
            <div className="py-8 text-center text-xs" style={{ color: "var(--text-4)" }}>
              Sem dados para o período.
            </div>
          ) : (
            <div className="flex items-end gap-1.5 py-1" style={{ height: 140 }}>
              {overview.data.series.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full items-end gap-0.5" style={{ height: 110 }}>
                    <div
                      className="flex-1 rounded-sm transition-all"
                      style={{
                        height: `${(d.created / maxSeries) * 100}%`,
                        background: "rgba(96,165,250,0.6)",
                        minHeight: d.created > 0 ? 2 : 0,
                      }}
                      title={`${d.created} criados`}
                    />
                    <div
                      className="flex-1 rounded-sm transition-all"
                      style={{
                        height: `${(d.resolved / maxSeries) * 100}%`,
                        background: "rgba(37, 99, 235,0.7)",
                        minHeight: d.resolved > 0 ? 2 : 0,
                      }}
                      title={`${d.resolved} resolvidos`}
                    />
                  </div>
                  <span className="text-[9px]" style={{ color: "var(--text-4)" }}>
                    {d.day.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <section className="grid gap-3 md:grid-cols-2">
          <SLAPanel sla={sla.data} loading={sla.isFetching} error={sla.isError} />
          <CSATPanel csat={csat.data} loading={csat.isFetching} error={csat.isError} />
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <TableCard
            title="Por fila"
            empty="Sem filas configuradas."
            loading={byQueue.isLoading}
            error={byQueue.isError}
          >
            {byQueue.data?.items?.map((q) => (
              <Row key={q.queue_id} left={q.name}>
                <span style={{ color: "#60a5fa" }}>{q.created} criados</span>
                <span style={{ color: "#2563EB" }}>{q.resolved} resolvidos</span>
                <span style={{ color: "#fbbf24" }}>{q.backlog} backlog</span>
              </Row>
            ))}
          </TableCard>
          <TableCard
            title="Por agente"
            icon={<Users className="h-3.5 w-3.5" />}
            empty="Ainda sem atividade."
            loading={byUser.isLoading}
            error={byUser.isError}
          >
            {byUser.data?.items?.slice(0, 20).map((u) => (
              <Row key={u.user_id} left={u.name || u.email}>
                <span>{u.assigned} atribuídos</span>
                <span style={{ color: "#2563EB" }}>{u.resolved} resolvidos</span>
                <span style={{ color: "var(--text-3)" }}>{formatSec(u.avg_first_response_sec)} 1ª resp.</span>
              </Row>
            ))}
          </TableCard>
        </section>
      </div>
    </div>
  );
}

// ─── Header (compartilhado entre estados) ─────────────────────────────────────

function ReportsHeader({
  range,
  setRange,
}: {
  range: "7d" | "30d" | "90d";
  setRange: (r: "7d" | "30d" | "90d") => void;
}) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "rgba(37, 99, 235,0.1)", border: "1px solid rgba(37, 99, 235,0.2)" }}
        >
          <Inbox className="h-4 w-4" style={{ color: "#2563EB" }} />
        </div>
        <div>
          <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Relatórios do atendimento
          </h2>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            Volume, SLA, CSAT e desempenho por fila/agente.
          </p>
        </div>
      </div>
      <div
        className="flex items-center gap-1 rounded-xl p-1 text-xs"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      >
        {(["7d", "30d", "90d"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className="rounded-lg px-3 py-1 transition-colors"
            style={{
              background: range === r ? "rgba(37, 99, 235,0.12)" : "transparent",
              color: range === r ? "#2563EB" : "var(--text-3)",
            }}
          >
            {r === "7d" ? "7 dias" : r === "30d" ? "30 dias" : "90 dias"}
          </button>
        ))}
      </div>
    </header>
  );
}

// ─── Skeleton (loading inicial) ───────────────────────────────────────────────

function InboxReportsSkeleton({
  range,
  setRange,
}: {
  range: "7d" | "30d" | "90d";
  setRange: (r: "7d" | "30d" | "90d") => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <ReportsHeader range={range} setRange={setRange} />

        <section className="grid gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-3"
              style={{ background: CARD_BG, border: CARD_BORDER }}
            >
              <div className="h-3 w-16 rounded mb-2" style={{ background: "var(--surface-2)" }} />
              <div className="h-7 w-12 rounded" style={{ background: "var(--surface-2)" }} />
            </div>
          ))}
        </section>

        <Card>
          <div className="h-3 w-44 rounded mb-3" style={{ background: "var(--surface-2)" }} />
          <div className="flex items-end gap-1.5" style={{ height: 110 }}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm animate-pulse"
                style={{
                  height: `${30 + ((i * 13) % 70)}%`,
                  background: "var(--surface-2)",
                }}
              />
            ))}
          </div>
        </Card>

        <section className="grid gap-3 md:grid-cols-2">
          <Card>
            <div className="h-3 w-12 rounded mb-3" style={{ background: "var(--surface-2)" }} />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-14 rounded" style={{ background: "var(--surface-2)" }} />
              <div className="h-14 rounded" style={{ background: "var(--surface-2)" }} />
            </div>
          </Card>
          <Card>
            <div className="h-3 w-14 rounded mb-3" style={{ background: "var(--surface-2)" }} />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-2 w-full rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
              ))}
            </div>
          </Card>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-2xl overflow-hidden"
              style={{ background: CARD_BG, border: CARD_BORDER }}
            >
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="h-3 w-20 rounded" style={{ background: "var(--surface-2)" }} />
              </div>
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="px-4 py-2.5 flex justify-between" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
                  <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

// ─── Componentes ──────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: CARD_BG, border: CARD_BORDER }}
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
  loading,
}: {
  label: string;
  value: number;
  tone: "blue" | "emerald" | "amber" | "red" | "zinc";
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  const color = {
    blue: "#60a5fa",
    emerald: "#2563EB",
    amber: "#fbbf24",
    red: "#f87171",
    zinc: "var(--text-1)",
  }[tone];
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: CARD_BG, border: CARD_BORDER }}
    >
      <div
        className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest"
        style={{ color: "var(--text-3)" }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1.5 text-2xl font-medium tabular-nums transition-opacity ${loading ? "opacity-50" : ""}`}
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function SLAPanel({
  sla,
  loading,
  error,
}: {
  sla?: SLAReport;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <Card>
      <div
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest"
        style={{ color: "var(--text-3)" }}
      >
        <AlertTriangle className="h-3.5 w-3.5" /> SLA
      </div>
      {error ? (
        <div className="py-6 text-center text-xs" style={{ color: "var(--text-4)" }}>
          Falha ao carregar SLA.
        </div>
      ) : (
        <div className={`mt-3 grid grid-cols-2 gap-3 text-center transition-opacity ${loading ? "opacity-50" : ""}`}>
          <div>
            <div className="text-2xl font-medium tabular-nums" style={{ color: "#f87171" }}>
              {sla?.first_response_breaches ?? 0}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>
              1ª resposta rompida
            </div>
          </div>
          <div>
            <div className="text-2xl font-medium tabular-nums" style={{ color: "#f87171" }}>
              {sla?.resolution_breaches ?? 0}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>
              Resolução rompida
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function CSATPanel({
  csat,
  loading,
  error,
}: {
  csat?: CSATReport;
  loading?: boolean;
  error?: boolean;
}) {
  const max = Math.max(1, ...(csat?.distribution?.map((d) => d.count) ?? [1]));
  return (
    <Card>
      <div
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest"
        style={{ color: "var(--text-3)" }}
      >
        <Star className="h-3.5 w-3.5" /> CSAT
      </div>
      {error ? (
        <div className="py-6 text-center text-xs" style={{ color: "var(--text-4)" }}>
          Falha ao carregar CSAT.
        </div>
      ) : (
        <div className={`mt-3 flex items-end gap-4 transition-opacity ${loading ? "opacity-50" : ""}`}>
          <div>
            <div className="text-2xl font-medium tabular-nums" style={{ color: "#fbbf24" }}>
              {(csat?.avg_rating ?? 0).toFixed(2)}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>
              nota média · {(((csat?.response_rate ?? 0) * 100) | 0)}% respondeu
            </div>
          </div>
          <div className="flex-1">
            {[1, 2, 3, 4, 5].map((r) => {
              const count = csat?.distribution?.find((d) => d.rating === r)?.count ?? 0;
              return (
                <div key={r} className="flex items-center gap-2 text-[10px]" style={{ color: "var(--text-3)" }}>
                  <span className="w-3">{r}</span>
                  <div className="h-1.5 flex-1 rounded" style={{ background: "var(--surface-2)" }}>
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
      )}
    </Card>
  );
}

function TableCard({
  title,
  icon,
  empty,
  children,
  loading,
  error,
}: {
  title: string;
  icon?: React.ReactNode;
  empty: string;
  children?: React.ReactNode;
  loading?: boolean;
  error?: boolean;
}) {
  const hasChildren = children && (Array.isArray(children) ? children.length > 0 : true);
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: CARD_BG, border: CARD_BORDER }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 text-xs font-medium uppercase tracking-widest"
        style={{ color: "var(--text-3)", borderBottom: "1px solid var(--border)" }}
      >
        {icon}
        {title}
      </div>
      {error ? (
        <div className="p-4 text-xs" style={{ color: "var(--text-3)" }}>
          Falha ao carregar.
        </div>
      ) : loading ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
          ))}
        </div>
      ) : hasChildren ? (
        <ul>{children}</ul>
      ) : (
        <div className="p-4 text-xs" style={{ color: "var(--text-4)" }}>
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
      style={{ borderTop: "1px solid var(--border-subtle)" }}
    >
      <span className="truncate text-sm font-medium" style={{ color: "var(--text-2)" }}>
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
