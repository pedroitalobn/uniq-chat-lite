"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LayoutGrid, List, Plus, Search, ChevronDown, TrendingUp, Briefcase, Filter as FilterIcon,
} from "lucide-react";
import { dealsApi, crmApi, funnelViewsApi } from "@/lib/api";
import { readLastFunnelId, useLastFunnelPersistor } from "@/lib/last-funnel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { KanbanBoard, type KanbanStage, type KanbanStageStats } from "@/components/crm/KanbanBoard";
import type { DealCardData } from "@/components/crm/DealCard";
import { formatCurrency, uniq, statusColor, statusLabel, relativeTime } from "@/components/crm/tokens";
import { NewDealDialog } from "@/components/crm/NewDealDialog";
import { CRMFilterBar, type CRMFilters } from "@/components/crm/CRMFilterBar";
import { CrmHeader, CrmHeaderButton } from "@/components/crm/CrmHeader";

interface Funnel {
  id: string;
  name: string;
  type: string;
  probability_on: boolean;
  currency: string;
  stages?: KanbanStage[];
}

interface DealsResponse {
  items: Array<DealCardData & { stage_id: string; funnel_id: string; status: string }>;
  total: number;
}

interface SummaryResponse {
  stages: KanbanStageStats[];
  total_open: number;
  won_count: number;
  won_value: number;
  lost_count: number;
}

type ViewMode = "kanban" | "list";

export default function DealsPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.dealsView) || hasPerm(PERM.crmView);
  const canCreate = hasPerm(PERM.dealsCreate) || hasPerm(PERM.crmCreate);
  const canMove = hasPerm(PERM.dealsMoveStage) || hasPerm(PERM.dealsEdit);

  const [funnelId, setFunnelId] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "me">("all");
  const [newOpen, setNewOpen] = useState(false);
  // Filtros adicionais (instância, tag) que o backend aceita desde
  // o último PR de filtros. Sem eles a UI tava cega — backend filtrava
  // só se a request mandasse, mas nada na UI mandava.
  const [extraFilters, setExtraFilters] = useState<CRMFilters>({});

  // Funnels — only deal-type funnels (we filter client-side since the list API
  // doesn't yet expose a type filter).
  const funnelsQ = useQuery({
    queryKey: ["crm-funnels", wsId],
    queryFn: () =>
      crmApi.listFunnels(wsId as string).then((r) => {
        const raw = r.data as { items?: Funnel[] } | Funnel[];
        const items = Array.isArray(raw) ? raw : raw.items ?? [];
        // Keep all for now — FE still works when type is missing; user can
        // filter or later enforce funnel.type === "deals"
        return items;
      }),
    enabled: !!wsId && canView,
  });

  // Pick funnel ao chegar a lista: prefere o ÚLTIMO usado (localStorage),
  // depois o is_default, depois o primeiro. Sem isso o user que trabalha
  // sempre num funil específico era jogado de volta no default cada visita.
  useEffect(() => {
    if (!funnelId && funnelsQ.data && funnelsQ.data.length > 0) {
      const lastId = readLastFunnelId(wsId);
      const last = lastId ? funnelsQ.data.find((f) => f.id === lastId) : undefined;
      const def = last
        ?? funnelsQ.data.find((f) => (f as unknown as { is_default?: boolean }).is_default)
        ?? funnelsQ.data[0];
      setFunnelId(def.id);
    }
  }, [funnelId, funnelsQ.data, wsId]);
  useLastFunnelPersistor(wsId, funnelId);

  const activeFunnel = useMemo(
    () => funnelsQ.data?.find((f) => f.id === funnelId) ?? null,
    [funnelsQ.data, funnelId]
  );

  const stagesQ = useQuery({
    queryKey: ["funnel-stages", funnelId],
    queryFn: () =>
      crmApi.listFunnelStages(funnelId).then((r) => {
        const raw = r.data as { items?: KanbanStage[] } | KanbanStage[];
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: !!funnelId,
  });

  const summaryQ = useQuery({
    queryKey: ["deals-summary", wsId, funnelId],
    queryFn: () => dealsApi.summary(wsId as string, funnelId).then((r) => r.data as SummaryResponse),
    enabled: !!wsId && !!funnelId,
    refetchInterval: 30_000,
  });

  const dealsQ = useQuery({
    queryKey: ["deals", wsId, funnelId, ownerFilter, q, viewMode, extraFilters],
    queryFn: () =>
      dealsApi
        .list(wsId as string, {
          funnel_id: funnelId,
          owner_id: ownerFilter === "me" ? "me" : undefined,
          q: q || undefined,
          instance_id: extraFilters.instanceId,
          tag_id: extraFilters.tagId,
          // Kanban shows open; list lets you see all (toggle later)
          status: viewMode === "list" ? "open,won,lost" : "open",
          limit: 500,
        })
        .then((r) => r.data as DealsResponse),
    enabled: !!wsId && !!funnelId,
    refetchInterval: 30_000,
  });

  const move = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      dealsApi.move(wsId as string, dealId, stageId),
    onMutate: async ({ dealId, stageId }) => {
      // Optimistic — update the deal's stage_id in place so the UI moves
      // immediately. If the request fails we refetch and it'll snap back.
      await qc.cancelQueries({ queryKey: ["deals", wsId, funnelId] });
      const previous = qc.getQueryData<DealsResponse>(["deals", wsId, funnelId, ownerFilter, q, viewMode]);
      if (previous) {
        qc.setQueryData<DealsResponse>(
          ["deals", wsId, funnelId, ownerFilter, q, viewMode],
          {
            ...previous,
            items: previous.items.map((d) =>
              d.id === dealId ? { ...d, stage_id: stageId, stage_change_at: new Date().toISOString() } : d
            ),
          }
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(["deals", wsId, funnelId, ownerFilter, q, viewMode], ctx.previous);
      }
      toast.error("Falha ao mover deal — restaurado");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["deals", wsId, funnelId] });
      qc.invalidateQueries({ queryKey: ["deals-summary", wsId, funnelId] });
    },
  });

  if (!wsId || permsLoading) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm" style={{ color: uniq.textDim }}>
        Sem permissão para ver deals.
      </div>
    );
  }

  if (!funnelsQ.isLoading && (!funnelsQ.data || funnelsQ.data.length === 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
        <Briefcase className="h-10 w-10" style={{ color: uniq.textFaint }} />
        <h2 className="text-lg font-medium" style={{ color: uniq.textPrimary }}>
          Crie seu primeiro funil
        </h2>
        <p className="max-w-md text-sm" style={{ color: uniq.textDim }}>
          Um funil organiza os deals em estágios. Você pode ter múltiplos funis
          (ex.: Vendas, Pós-venda, Suporte) com visualizações separadas.
        </p>
        <Link
          href="/crm/funnels"
          className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium inline-flex items-center"
          style={{
            background: "var(--green-dim)",
            border: "1px solid var(--green-border)",
            color: "var(--green)",
          }}
        >
          Criar funil →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3 sm:p-4 uniq-page">
      <CrmHeader
        icon={<Briefcase className="w-4 h-4" style={{ color: "var(--green)" }} />}
        title="Deals"
        subtitle={activeFunnel ? `Funil: ${activeFunnel.name}` : "Carregando funis…"}
        actions={
          <>
            <FunnelSelector
              funnels={funnelsQ.data ?? []}
              activeId={funnelId}
              onChange={setFunnelId}
            />
            {canCreate && (
              <CrmHeaderButton accent onClick={() => setNewOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Novo deal</span>
                <span className="sm:hidden">Novo</span>
              </CrmHeaderButton>
            )}
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-0.5 rounded-xl p-0.5"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <ViewToggle active={viewMode === "kanban"} onClick={() => setViewMode("kanban")} label="Kanban" icon={<LayoutGrid className="h-3.5 w-3.5" />} />
              <ViewToggle active={viewMode === "list"} onClick={() => setViewMode("list")} label="Lista" icon={<List className="h-3.5 w-3.5" />} />
            </div>
            <div
              className="flex items-center gap-0.5 rounded-xl p-0.5"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <ViewToggle active={ownerFilter === "all"} onClick={() => setOwnerFilter("all")} label="Todos" />
              <ViewToggle active={ownerFilter === "me"} onClick={() => setOwnerFilter("me")} label="Meus" />
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--text-3)" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar deal…"
                className="w-full rounded-xl py-1.5 pl-8 pr-3 text-xs outline-none"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--text-1)",
                }}
              />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {activeFunnel?.probability_on && (
                <span
                  className="hidden md:flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-medium"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--text-3)" }}
                >
                  <TrendingUp className="h-3 w-3" /> Probabilidade ativa
                </span>
              )}
              <CompactMetric label="Aberto" value={summaryQ.data?.total_open ?? 0} color={uniq.statusOpen} />
              <CompactMetric label="Ganho" value={formatCurrency(summaryQ.data?.won_value ?? 0, activeFunnel?.currency ?? "BRL")} color={uniq.statusWon} />
              <CompactMetric label="Perdido" value={summaryQ.data?.lost_count ?? 0} color={uniq.statusLost} />
            </div>
          </div>
        }
      >
        <CRMFilterBar
          workspaceId={wsId}
          value={extraFilters}
          onChange={setExtraFilters}
          showFunnel={false}
          showJourney={false}
        />
      </CrmHeader>

      <div className="flex-1 overflow-hidden" style={{ background: "transparent" }}>
        {viewMode === "kanban" ? (
          <div className="h-full p-3">
            <KanbanBoard
              stages={stagesQ.data ?? []}
              deals={(dealsQ.data?.items ?? []) as DealCardData[]}
              stats={summaryQ.data?.stages}
              currency={activeFunnel?.currency ?? "BRL"}
              stageOf={(d) => (d as unknown as { stage_id: string }).stage_id}
              onMove={(dealId, destStageId, srcStageId) => {
                if (!canMove) {
                  toast.error("Sem permissão para mover deals");
                  return;
                }
                if (destStageId !== srcStageId) move.mutate({ dealId, stageId: destStageId });
              }}
              isLoading={dealsQ.isLoading || stagesQ.isLoading}
            />
          </div>
        ) : (
          <DealsList
            deals={(dealsQ.data?.items ?? []) as (DealCardData & { stage_id: string; status: string })[]}
            stages={stagesQ.data ?? []}
            currency={activeFunnel?.currency ?? "BRL"}
            isLoading={dealsQ.isLoading}
          />
        )}
      </div>

      {newOpen && (
        <NewDealDialog
          wsId={wsId}
          funnel={activeFunnel}
          stages={stagesQ.data ?? []}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["deals", wsId, funnelId] });
            qc.invalidateQueries({ queryKey: ["deals-summary", wsId, funnelId] });
          }}
        />
      )}
    </div>
  );
}

function ViewToggle({ active, onClick, label, icon }: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
      style={{
        background: active ? "rgba(0,212,106,0.12)" : "transparent",
        border: active ? "1px solid rgba(0,212,106,0.20)" : "1px solid transparent",
        boxShadow: active ? "0 0 10px rgba(0,212,106,0.10)" : "none",
        color: active ? uniq.green : uniq.textDim,
        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function CompactMetric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] flex-shrink-0"
      style={{ background: `${color}10`, border: `1px solid ${color}25` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span className="font-semibold" style={{ color: "var(--text-1)" }}>{value}</span>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{
      background: `${accent}0f`,
      backdropFilter: "blur(8px)",
      border: `1px solid ${accent}22`,
      boxShadow: `0 2px 8px ${accent}10`,
      transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
    }}>
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: accent, boxShadow: `0 0 6px ${accent}80` }}
      />
      <span style={{ color: uniq.textFaint }}>{label}</span>
      <span className="font-medium" style={{ color: uniq.textPrimary }}>{value}</span>
      {sub && <span className="text-[10px]" style={{ color: uniq.textFaint }}>· {sub}</span>}
    </div>
  );
}

function FunnelSelector({ funnels, activeId, onChange }: {
  funnels: Funnel[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = funnels.find((f) => f.id === activeId);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium"
        style={{
          background: "rgba(255,255,255,0.07)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.08)",
          color: uniq.textStrong,
          transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.11)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
      >
        <FilterIcon className="h-3.5 w-3.5" style={{ color: uniq.green }} aria-hidden />
        {active?.name ?? "Selecionar funil"}
        <ChevronDown className="h-3 w-3" style={{ color: uniq.textFaint }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-40 mt-1 min-w-64 overflow-auto rounded-lg shadow-xl"
            style={{
              background: "linear-gradient(135deg, rgba(18,18,30,0.95) 0%, rgba(10,10,20,0.98) 100%)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.07)",
              maxHeight: "60vh",
            }}
          >
            {funnels.map((f) => (
              <button
                key={f.id}
                onClick={() => { onChange(f.id); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/5"
                style={{
                  color: f.id === activeId ? uniq.green : uniq.textPrimary,
                  background: f.id === activeId ? "rgba(0,212,106,0.08)" : "transparent",
                  transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <span>{f.name}</span>
                <span className="text-[10px]" style={{ color: uniq.textFaint }}>{f.currency}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DealsList({ deals, stages, currency, isLoading }: {
  deals: (DealCardData & { stage_id: string; status: string })[];
  stages: KanbanStage[];
  currency: string;
  isLoading: boolean;
}) {
  const stageMap = useMemo(() => {
    const m: Record<string, string> = {};
    stages.forEach((s) => (m[s.id] = s.name));
    return m;
  }, [stages]);

  if (isLoading) return <div className="p-6 text-sm" style={{ color: uniq.textDim }}>Carregando…</div>;
  if (deals.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-12 text-sm" style={{ color: uniq.textDim }}>
        Nenhum deal encontrado.
      </div>
    );
  }

  return (
    <div className="overflow-auto p-3">
      <table className="w-full text-sm" style={{ color: uniq.textPrimary }}>
        <thead>
          <tr className="text-left text-xs" style={{ color: uniq.textFaint, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <Th>Título</Th>
            <Th>Contato</Th>
            <Th>Estágio</Th>
            <Th>Valor</Th>
            <Th>Status</Th>
            <Th>Dono</Th>
            <Th>Última alteração</Th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr
              key={d.id}
              className="hover:bg-white/5"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)", transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)" }}
            >
              <Td>
                <Link href={`/crm/deals/${d.id}`} className="font-medium hover:underline">
                  {d.title}
                </Link>
              </Td>
              <Td>{d.contact?.name ?? "—"}</Td>
              <Td>
                <span style={{ color: uniq.textDim }}>{stageMap[d.stage_id] ?? "—"}</span>
              </Td>
              <Td>
                <span className="font-medium" style={{ color: uniq.green }}>
                  {formatCurrency(d.value, d.currency || currency)}
                </span>
              </Td>
              <Td>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: statusColor(d.status) + "22", color: statusColor(d.status) }}
                >
                  {statusLabel(d.status)}
                </span>
              </Td>
              <Td>{d.owner?.name?.split(" ")[0] ?? "—"}</Td>
              <Td>
                <span style={{ color: uniq.textFaint }}>{relativeTime(d.stage_change_at ?? undefined)}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-medium uppercase tracking-wide" style={{ fontSize: 10 }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-middle text-xs">{children}</td>;
}
