"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Lock, Search, ChevronDown, User as UserIcon, MessageSquare,
  Layers, Smartphone, Radio, RefreshCw, Check,
} from "lucide-react";
import {
  conversationsApi, queuesApi, workspacesApi, channelsApi, instancesApi,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { useConversationWS } from "@/hooks/useConversationWS";
import type { ChannelInfo, Instance } from "@/types";

// Consolidated inbox:
//   [ Agente ▾ ] [ Canais ▾ ] [ Instâncias ▾ ] [ Fila ▾ ]  🔍  Tabs
// - "Agente": single-select. Admin/supervisor → full roster; agente comum →
//   travado em "Meus".
// - "Canais" e "Instâncias": multi-select (checkboxes). Recuperam a
//   seleção por linha/canal que existia na UI antiga.
// - "Fila": single-select. "Todas", "Sem fila" ou cada fila.
//
// Quando existem MessageLogs antigos sem conversation_id (pré-migração), o
// header mostra um CTA "Sincronizar histórico" que chama o backfill.

type StatusTab = "all" | "open" | "pending" | "snoozed" | "unassigned" | "resolved" | "closed";

interface WorkspaceMember {
  user_id: string;
  is_owner: boolean;
  user?: { id: string; name: string; email: string };
}

interface Queue {
  id: string;
  name: string;
}

interface InboxStats {
  message_logs: number;
  conversations: number;
  pending_backfill: number;
  open: number;
  mine_open: number;
}

const TABS: { id: StatusTab; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "open", label: "Abertos" },
  { id: "pending", label: "Pendentes" },
  { id: "unassigned", label: "Sem atribuição" },
  { id: "snoozed", label: "Soneca" },
  { id: "resolved", label: "Resolvidos" },
  { id: "closed", label: "Encerrados" },
];

export default function InboxPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading, isOwner } = useWorkspacePermissions();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const myUserID = session?.user?.id as string | undefined;

  const canView = hasPerm(PERM.ticketsView);
  const canViewAll = hasPerm(PERM.ticketsViewAll) || hasPerm(PERM.ticketsViewTeam) || isOwner;
  const canAssign = hasPerm(PERM.ticketsAssign);

  const [agentScope, setAgentScope] = useState<string>("me"); // "me" | "<uuid>" | "all"
  const [queueScope, setQueueScope] = useState<string>("all"); // "all" | "none" | uuid
  const [channelFilter, setChannelFilter] = useState<string[]>([]); // multi-select
  const [instanceFilter, setInstanceFilter] = useState<string[]>([]); // multi-select
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [q, setQ] = useState("");

  // Rosters — only fetch when viewer can actually switch scopes.
  const membersQ = useQuery({
    queryKey: ["workspace-members", wsId],
    queryFn: () =>
      workspacesApi.listMembers(wsId as string).then((r) => {
        const raw = r.data as { members?: WorkspaceMember[] } | WorkspaceMember[];
        return Array.isArray(raw) ? raw : raw.members ?? [];
      }),
    enabled: !!wsId && canViewAll,
  });

  const queuesQ = useQuery({
    queryKey: ["queues", wsId],
    queryFn: () => queuesApi.list(wsId as string).then((r) => r.data as { items: Queue[] }),
    enabled: !!wsId && canView,
  });

  const channelsQ = useQuery({
    queryKey: ["channels-catalog"],
    queryFn: () => channelsApi.list().then((r) => r.data as ChannelInfo[]),
    staleTime: 5 * 60_000,
  });

  const instancesQ = useQuery({
    queryKey: ["instances-for-inbox", wsId],
    queryFn: () =>
      instancesApi.list(undefined, wsId).then((r) => {
        const raw = r.data as Instance[] | { items: Instance[] };
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: !!wsId && canView,
  });

  const statsQ = useQuery({
    queryKey: ["inbox-stats", wsId],
    queryFn: () => conversationsApi.inboxStats(wsId as string).then((r) => r.data as InboxStats),
    enabled: !!wsId && canView,
    refetchInterval: 60_000,
  });

  const listParams = useMemo(() => {
    const p: Record<string, string | string[]> = {};
    if (agentScope === "me") p.assigned_user_id = "me";
    else if (agentScope !== "all") p.assigned_user_id = agentScope;
    if (statusTab === "unassigned") {
      p.assigned_user_id = "none";
      p.status = ["open", "pending"];
    } else if (statusTab !== "all") {
      p.status = statusTab;
    }
    if (queueScope !== "all") p.queue_id = queueScope;
    if (channelFilter.length > 0) p.channel = channelFilter.join(",");
    if (instanceFilter.length > 0) p.instance_id = instanceFilter.join(",");
    if (q) p.q = q;
    return p;
  }, [agentScope, statusTab, queueScope, channelFilter, instanceFilter, q]);

  useConversationWS({
    prefixes: ["conversation.", "queue."],
    onEvent: () => {
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unified"] });
      qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
      qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
    },
  });

  const listQ = useQuery({
    queryKey: ["conversations", wsId, "unified", listParams],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, { ...(listParams as Record<string, string>), limit: 100 })
        .then((r) => r.data as { items: ConversationRow[]; total: number }),
    enabled: !!wsId && canView,
    refetchInterval: 20_000,
  });

  const countsQ = useQuery({
    queryKey: ["conversations-count", wsId],
    queryFn: () => conversationsApi.count(wsId as string).then((r) => r.data as Record<string, number>),
    enabled: !!wsId && canView,
    refetchInterval: 30_000,
  });

  const claim = useMutation({
    mutationFn: (id: string) => conversationsApi.assign(wsId as string, id),
    onSuccess: () => {
      toast.success("Atendimento atribuído a você");
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unified"] });
    },
    onError: (err) => {
      const msg = (err as { response?: { status?: number } }).response?.status === 409
        ? "Outro agente já pegou esse atendimento"
        : "Falha ao atribuir";
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unified"] });
    },
  });

  const backfill = useMutation({
    mutationFn: () => conversationsApi.backfill(wsId as string, { limit: 500, max_batches: 20 }),
    onSuccess: (r) => {
      const data = r.data as { processed: number; remaining: number };
      toast.success(`${data.processed} mensagens sincronizadas (${data.remaining} restantes)`);
      qc.invalidateQueries({ queryKey: ["conversations", wsId] });
      qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
    },
    onError: () => toast.error("Falha ao sincronizar — tente novamente"),
  });

  if (!wsId || permsLoading) return <PageSkeleton />;
  if (!canView) return <Forbidden />;

  const list = listQ.data?.items ?? [];
  const showBackfillCTA =
    !!statsQ.data &&
    statsQ.data.pending_backfill > 0 &&
    list.length === 0 &&
    !listQ.isLoading;

  const agentLabel = (() => {
    if (agentScope === "me") return "Meus atendimentos";
    if (agentScope === "all") return "Todos os agentes";
    const m = membersQ.data?.find((x) => x.user_id === agentScope);
    return m?.user?.name || m?.user?.email || "Agente";
  })();

  const queueLabel =
    queueScope === "all" ? "Todas as filas"
    : queueScope === "none" ? "Sem fila"
    : queuesQ.data?.items.find((q) => q.id === queueScope)?.name ?? "Fila";

  const availableChannels = (channelsQ.data ?? []).filter((c) => c.available);
  const channelLabel =
    channelFilter.length === 0 ? "Todos os canais"
    : channelFilter.length === 1
      ? availableChannels.find((c) => c.id === channelFilter[0])?.label ?? channelFilter[0]
      : `${channelFilter.length} canais`;

  const connectedInstances = instancesQ.data ?? [];
  const instanceLabel =
    instanceFilter.length === 0 ? "Todas as instâncias"
    : instanceFilter.length === 1
      ? connectedInstances.find((i) => i.id === instanceFilter[0])?.name ?? "Instância"
      : `${instanceFilter.length} instâncias`;

  return (
    <div className="flex h-full flex-col">
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: "hsl(240 12% 16%)" }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
              Inbox
            </h1>
            <p className="text-xs" style={{ color: "hsl(240 8% 48%)" }}>
              {agentLabel} · {channelLabel} · {instanceLabel} · {queueLabel}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Agent */}
            <AgentDropdown
              agentScope={agentScope}
              setAgentScope={setAgentScope}
              canViewAll={canViewAll}
              myUserID={myUserID}
              members={membersQ.data ?? []}
              currentLabel={agentLabel}
            />

            {/* Channels (multi) */}
            <MultiSelectDropdown
              icon={<Radio className="h-3.5 w-3.5" style={{ color: "hsl(240 8% 48%)" }} />}
              label={channelLabel}
              items={availableChannels.map((c) => ({
                id: c.id,
                label: c.label,
                hint: c.color,
              }))}
              selected={channelFilter}
              onChange={setChannelFilter}
              emptyMsg="Nenhum canal disponível"
            />

            {/* Instances (multi) */}
            <MultiSelectDropdown
              icon={<Smartphone className="h-3.5 w-3.5" style={{ color: "hsl(240 8% 48%)" }} />}
              label={instanceLabel}
              items={connectedInstances.map((inst) => ({
                id: inst.id,
                label: inst.name,
                hint: inst.phone_number || inst.channel,
                sub: inst.channel,
              }))}
              selected={instanceFilter}
              onChange={setInstanceFilter}
              emptyMsg="Nenhuma instância conectada"
            />

            {/* Queue */}
            <SingleSelectDropdown
              icon={<Layers className="h-3.5 w-3.5" style={{ color: "hsl(240 8% 48%)" }} />}
              label={queueLabel}
              items={[
                { id: "all", label: "Todas as filas" },
                { id: "none", label: "Sem fila" },
                ...(queuesQ.data?.items.map((q) => ({ id: q.id, label: q.name })) ?? []),
              ]}
              selected={queueScope}
              onChange={setQueueScope}
              footer={
                <Link
                  href="/inbox/queues"
                  className="block border-t px-3 py-2 text-xs"
                  style={{ color: "hsl(240 8% 52%)", borderColor: "hsl(240 12% 16%)" }}
                >
                  Gerenciar filas →
                </Link>
              }
            />

            {/* Search */}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5"
                style={{ color: "hsl(240 8% 38%)" }}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-44 rounded-lg py-1.5 pl-8 pr-3 text-xs outline-none"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid hsl(240 12% 16%)",
                  color: "hsl(240 15% 90%)",
                }}
              />
            </div>

          </div>
        </div>

        {/* Status tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setStatusTab(t.id)}
              className="rounded-full px-3 py-1 text-xs transition-colors"
              style={{
                background: statusTab === t.id ? "rgba(0,212,106,0.1)" : "transparent",
                color: statusTab === t.id ? "#00d46a" : "hsl(240 8% 52%)",
                border: `1px solid ${statusTab === t.id ? "rgba(0,212,106,0.25)" : "transparent"}`,
              }}
            >
              {t.label}
              {t.id === "unassigned" && countsQ.data?.unassigned_open ? (
                <span className="ml-1 opacity-70">· {countsQ.data.unassigned_open}</span>
              ) : null}
              {t.id === "open" && agentScope === "me" && countsQ.data?.mine_open ? (
                <span className="ml-1 opacity-70">· {countsQ.data.mine_open}</span>
              ) : null}
            </button>
          ))}

          {statsQ.data && statsQ.data.pending_backfill > 0 && (
            <button
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
              className="ml-auto flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50"
              style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.25)" }}
              title={`${statsQ.data.pending_backfill} mensagens antigas sem ticket`}
            >
              <RefreshCw className={`h-3 w-3 ${backfill.isPending ? "animate-spin" : ""}`} />
              Sincronizar histórico · {statsQ.data.pending_backfill}
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {listQ.isError ? (
          <ErrorStateWithProbe
            error={listQ.error}
            onRetry={() => {
              listQ.refetch();
              statsQ.refetch();
            }}
          />
        ) : showBackfillCTA ? (
          <BackfillEmptyState
            stats={statsQ.data!}
            running={backfill.isPending}
            onBackfill={() => backfill.mutate()}
          />
        ) : list.length === 0 && !listQ.isLoading ? (
          <EmptyState agentScope={agentScope} statusTab={statusTab} />
        ) : (
          <ConversationList
            items={list}
            isLoading={listQ.isLoading}
            emptyLabel="Nenhum atendimento neste filtro."
            actionLabel={canAssign && statusTab === "unassigned" ? "Atender" : undefined}
            onAction={canAssign && statusTab === "unassigned"
              ? (conv) => claim.mutate(conv.id)
              : undefined}
          />
        )}
      </div>
    </div>
  );
}

function AgentDropdown({
  agentScope, setAgentScope, canViewAll, myUserID, members, currentLabel,
}: {
  agentScope: string;
  setAgentScope: (v: string) => void;
  canViewAll: boolean;
  myUserID?: string;
  members: WorkspaceMember[];
  currentLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={!canViewAll}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "hsl(240 15% 90%)",
            opacity: canViewAll ? 1 : 0.6,
          }}
        >
          <UserIcon className="h-3.5 w-3.5" style={{ color: "hsl(240 8% 48%)" }} />
          {currentLabel}
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      <DropdownItem
        active={agentScope === "me"}
        onClick={() => { setAgentScope("me"); setOpen(false); }}
      >
        Meus atendimentos
      </DropdownItem>
      {canViewAll && (
        <DropdownItem
          active={agentScope === "all"}
          onClick={() => { setAgentScope("all"); setOpen(false); }}
        >
          Todos os agentes
        </DropdownItem>
      )}
      {canViewAll && members.length > 0 && (
        <>
          <DropdownDivider label="Agentes" />
          {members
            .filter((m) => m.user_id !== myUserID)
            .map((m) => (
              <DropdownItem
                key={m.user_id}
                active={agentScope === m.user_id}
                onClick={() => { setAgentScope(m.user_id); setOpen(false); }}
              >
                <span className="truncate">{m.user?.name || m.user?.email}</span>
                {m.is_owner && (
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[9px]"
                    style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a" }}
                  >
                    owner
                  </span>
                )}
              </DropdownItem>
            ))}
        </>
      )}
    </Dropdown>
  );
}

function SingleSelectDropdown({
  icon, label, items, selected, onChange, footer,
}: {
  icon: React.ReactNode;
  label: string;
  items: { id: string; label: string; hint?: string }[];
  selected: string;
  onChange: (id: string) => void;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "hsl(240 15% 90%)",
          }}
        >
          {icon}
          {label}
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      {items.map((it) => (
        <DropdownItem
          key={it.id}
          active={selected === it.id}
          onClick={() => { onChange(it.id); setOpen(false); }}
        >
          <span className="truncate">{it.label}</span>
          {it.hint && <span className="ml-auto text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>{it.hint}</span>}
        </DropdownItem>
      ))}
      {footer}
    </Dropdown>
  );
}

function MultiSelectDropdown({
  icon, label, items, selected, onChange, emptyMsg,
}: {
  icon: React.ReactNode;
  label: string;
  items: { id: string; label: string; hint?: string; sub?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyMsg?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{
            background: selected.length > 0 ? "rgba(0,212,106,0.05)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${selected.length > 0 ? "rgba(0,212,106,0.2)" : "rgba(255,255,255,0.08)"}`,
            color: "hsl(240 15% 90%)",
          }}
        >
          {icon}
          {label}
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="w-full border-b px-3 py-2 text-left text-[10px] uppercase tracking-widest"
          style={{
            borderColor: "hsl(240 12% 16%)",
            color: "hsl(240 8% 52%)",
          }}
        >
          Limpar seleção ({selected.length})
        </button>
      )}
      {items.length === 0 && emptyMsg && (
        <div className="px-3 py-3 text-xs" style={{ color: "hsl(240 8% 48%)" }}>
          {emptyMsg}
        </div>
      )}
      {items.map((it) => {
        const isSelected = selected.includes(it.id);
        return (
          <button
            key={it.id}
            onClick={() => toggle(it.id)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
            style={{ color: "hsl(240 15% 90%)" }}
          >
            <span
              className="mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded"
              style={{
                background: isSelected ? "#00d46a" : "transparent",
                border: `1px solid ${isSelected ? "#00d46a" : "hsl(240 12% 24%)"}`,
              }}
            >
              {isSelected && <Check className="h-2.5 w-2.5" style={{ color: "#03170a" }} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{it.label}</span>
              {(it.hint || it.sub) && (
                <span className="block truncate text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                  {it.sub && <span className="mr-1">{it.sub}</span>}
                  {it.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </Dropdown>
  );
}

function Dropdown({
  open, onClose, trigger, children,
}: {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <div
            className="absolute right-0 top-full z-40 mt-1 w-64 overflow-auto rounded-lg shadow-xl"
            style={{
              background: "hsl(240 18% 6%)",
              border: "1px solid hsl(240 12% 14%)",
              maxHeight: "60vh",
            }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function DropdownItem({
  active, onClick, children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
      style={{
        color: active ? "#00d46a" : "hsl(240 15% 90%)",
        background: active ? "rgba(0,212,106,0.04)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function DropdownDivider({ label }: { label?: string }) {
  return (
    <div
      className="px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-widest"
      style={{ color: "hsl(240 8% 38%)" }}
    >
      {label ?? ""}
    </div>
  );
}

function BackfillEmptyState({ stats, running, onBackfill }: {
  stats: InboxStats;
  running: boolean;
  onBackfill: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div
        className="max-w-md rounded-2xl p-6 text-center"
        style={{
          background: "rgba(0,212,106,0.05)",
          border: "1px solid rgba(0,212,106,0.25)",
        }}
      >
        <RefreshCw className={`mx-auto h-8 w-8 ${running ? "animate-spin" : ""}`} style={{ color: "#00d46a" }} />
        <h2 className="mt-3 text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
          Histórico disponível para sincronizar
        </h2>
        <p className="mt-2 text-sm" style={{ color: "hsl(240 8% 52%)" }}>
          Seu workspace tem <b style={{ color: "hsl(240 15% 90%)" }}>{stats.message_logs.toLocaleString("pt-BR")}</b> mensagens
          e <b style={{ color: "hsl(240 15% 90%)" }}>{stats.pending_backfill.toLocaleString("pt-BR")}</b> ainda não foram
          convertidas em atendimentos. Sincronize para ver todos os chats aqui.
        </p>
        <button
          onClick={onBackfill}
          disabled={running}
          className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: "#00d46a", color: "#03170a" }}
        >
          {running ? "Sincronizando…" : "Sincronizar histórico"}
        </button>
        <p className="mt-4 text-[11px]" style={{ color: "hsl(240 8% 38%)" }}>
          Processa em lotes de até 10k mensagens. Chame novamente até o
          contador zerar.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ agentScope, statusTab }: { agentScope: string; statusTab: StatusTab }) {
  const message = (() => {
    if (statusTab === "unassigned") return "Nenhum atendimento aguardando atribuição.";
    if (agentScope === "me") return "Você não tem atendimentos neste filtro.";
    if (agentScope === "all") return "Sem atendimentos no workspace para este filtro.";
    return "Este agente não tem atendimentos neste filtro.";
  })();
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center"
      style={{ color: "hsl(240 8% 48%)" }}
    >
      <MessageSquare className="h-10 w-10 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ErrorStateWithProbe({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // Probes /v1/conversations/health to distinguish the two common failure
  // modes the admin sees in prod:
  //   A) backend sem a rota (deploy antigo) → probe também dá 404
  //   B) rota OK mas algo quebrou (tabela / permission / crash) → probe 200
  //      mas list continua erro → problema na request específica
  const probe = useQuery<HealthProbe>({
    queryKey: ["conversations-health"],
    queryFn: async (): Promise<HealthProbe> => {
      try {
        const r = await conversationsApi.health();
        return { ok: true, data: r.data as unknown };
      } catch (e) {
        const ax = e as { response?: { status?: number; data?: unknown } };
        return { ok: false, status: ax.response?.status, body: ax.response?.data };
      }
    },
    staleTime: 5_000,
  });
  return <ErrorState error={error} probe={probe.data} onRetry={onRetry} />;
}

type HealthProbe =
  | { ok: true; data: unknown }
  | { ok: false; status?: number; body?: unknown };

function ErrorState({ error, probe, onRetry }: { error: unknown; probe?: HealthProbe; onRetry: () => void }) {
  // Try to extract the actual HTTP status + body from the axios error so
  // the admin can tell whether the route is missing (404 → redeploy), the
  // server crashed (500 → inspect logs) or the table is missing (500 with
  // a PG error string).
  type ApiErr = {
    response?: { status?: number; data?: { error?: string } | string };
    message?: string;
    code?: string;
  };
  const e = (error ?? {}) as ApiErr;
  const status = e.response?.status;
  const responseBody = e.response?.data;
  const backendMsg =
    typeof responseBody === "string"
      ? responseBody
      : (responseBody as { error?: string } | undefined)?.error;
  const isNetwork = !status && (e.code === "ERR_NETWORK" || e.code === "ECONNABORTED");

  // Probe disambiguates "route missing" vs "route OK but list failed"
  const probeOK = probe?.ok === true;
  const probeRouteMissing = probe?.ok === false && probe.status === 404;
  const probeTableMissing = probe?.ok === false && probe.status === 500;

  const { title, explanation } = (() => {
    if (status === 401 || status === 403) {
      return {
        title: "Sem acesso ao atendimento",
        explanation: "Você não tem permissão de visualização neste workspace.",
      };
    }
    if (isNetwork || probeRouteMissing || status === 404 || probeTableMissing || (status && status >= 500) || probeOK) {
      // Qualquer cenário "técnico" cai aqui — a UI diz o óbvio pro atendente
      // (não carregou, tentar de novo) e guarda o ruído no details.
      return {
        title: "Não foi possível carregar seus atendimentos agora",
        explanation: "O serviço está temporariamente indisponível. Tente novamente em instantes.",
      };
    }
    return {
      title: "Não foi possível carregar seus atendimentos agora",
      explanation: "Tente novamente em instantes.",
    };
  })();
  const cta = "Tentar de novo";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <MessageSquare className="h-10 w-10" style={{ color: "hsl(240 8% 38%)" }} />
      <h2 className="text-base font-medium" style={{ color: "hsl(240 15% 90%)" }}>
        {title}
      </h2>
      <p className="max-w-md text-sm" style={{ color: "hsl(240 8% 52%)" }}>
        {explanation}
      </p>

      {/* Raw details — lets you copy/paste the backend error into an issue */}
      {(status || backendMsg || e.message || probe) && (
        <details
          className="mt-1 w-full max-w-md rounded-lg p-3 text-left text-[11px]"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid hsl(240 12% 16%)",
            color: "hsl(240 8% 48%)",
          }}
        >
          <summary className="cursor-pointer select-none">Detalhes técnicos</summary>
          <div className="mt-2 space-y-2 font-mono">
            <div>
              <div className="font-semibold" style={{ color: "hsl(240 8% 60%)" }}>
                GET /v1/conversations
              </div>
              {status ? <div>status: {status}</div> : <div>sem resposta HTTP</div>}
              {backendMsg && <div className="whitespace-pre-wrap break-words">body: {backendMsg}</div>}
              {!backendMsg && e.message && <div>msg: {e.message}</div>}
            </div>
            {probe && (
              <div>
                <div className="font-semibold" style={{ color: "hsl(240 8% 60%)" }}>
                  GET /v1/conversations/health (probe)
                </div>
                {probe.ok === true ? (
                  <div style={{ color: "#00d46a" }}>200 — rota responde</div>
                ) : (
                  <div>
                    <div>status: {probe.status ?? "network"}</div>
                    <div className="whitespace-pre-wrap break-words">
                      {probe.body ? JSON.stringify(probe.body) : "(sem corpo)"}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      <button
        onClick={onRetry}
        className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium"
        style={{ background: "#00d46a", color: "#03170a" }}
      >
        {cta}
      </button>
    </div>
  );
}

function Forbidden() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      style={{ color: "hsl(240 8% 52%)" }}
    >
      <Lock className="h-10 w-10" style={{ color: "hsl(240 8% 38%)" }} />
      <h2 className="text-lg font-medium" style={{ color: "hsl(240 15% 90%)" }}>
        Sem acesso ao módulo de atendimento
      </h2>
      <p className="max-w-md text-sm">
        Peça ao administrador a permissão{" "}
        <code
          className="rounded px-1 text-xs"
          style={{ background: "rgba(255,255,255,0.05)", color: "hsl(240 15% 85%)" }}
        >
          tickets:view
        </code>.
      </p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <div
        className="h-8 w-40 animate-pulse rounded"
        style={{ background: "rgba(255,255,255,0.04)" }}
      />
      <div
        className="h-4 w-64 animate-pulse rounded"
        style={{ background: "rgba(255,255,255,0.04)" }}
      />
      <div className="mt-6 space-y-2">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-16 w-full animate-pulse rounded"
            style={{ background: "rgba(255,255,255,0.03)" }}
          />
        ))}
      </div>
    </div>
  );
}
