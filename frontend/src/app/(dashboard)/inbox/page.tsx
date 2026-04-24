"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Users, Lock, Search, ChevronDown, User as UserIcon, MessageSquare,
  Layers,
} from "lucide-react";
import { conversationsApi, queuesApi, workspacesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { useConversationWS } from "@/hooks/useConversationWS";

// A consolidated /inbox page replaces the previous per-view routes
// (/mine, /unassigned, /team, /all). Instead of multiple sidebar entries,
// the admin/supervisor switches the scope from this header:
//
//   [ Agente ▾ ]  [ Fila ▾ ]   Todos · Meus · Sem atrib. · …   [ 🔍 ]
//
// Permission rules:
//   - tickets:view_all  → full agent dropdown + "Todos agentes" + "Sem atribuição"
//   - tickets:view_team → agent dropdown limited to teammates (fase 4); for
//                         now same as view_all but scoped by workspace
//   - tickets:view only → dropdown is locked to the current user
//
// The previous standalone pages (/inbox/mine, /unassigned, /team, /all) were
// removed; /inbox/queue/[id] and /inbox/[conversationId] still exist for
// deep linking.

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

  // "me" | "<uuid>" | "all"
  const [agentScope, setAgentScope] = useState<string>("me");
  const [queueScope, setQueueScope] = useState<string>("all"); // "all" | "none" | uuid
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [q, setQ] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Only fetch the agent roster when the viewer can switch scopes.
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

  // Derive list filters from the UI state.
  const listParams = useMemo(() => {
    const p: Record<string, string | string[]> = {};
    // Agent scope
    if (agentScope === "me") p.assigned_user_id = "me";
    else if (agentScope !== "all") p.assigned_user_id = agentScope;
    // Status tab
    if (statusTab === "unassigned") {
      p.assigned_user_id = "none";
      p.status = ["open", "pending"];
    } else if (statusTab !== "all") {
      p.status = statusTab;
    }
    // Queue scope
    if (queueScope !== "all") p.queue_id = queueScope;
    if (q) p.q = q;
    return p;
  }, [agentScope, statusTab, queueScope, q]);

  useConversationWS({
    prefixes: ["conversation.", "queue."],
    onEvent: () => {
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unified"] });
      qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
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

  if (!wsId || permsLoading) return <PageSkeleton />;
  if (!canView) return <Forbidden />;

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

  const list = listQ.data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Header — scope selectors + search + tabs */}
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
              {agentLabel} · {queueLabel}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Agent dropdown — locked when you can't view others */}
            <Dropdown
              open={agentOpen}
              onClose={() => setAgentOpen(false)}
              trigger={
                <button
                  onClick={() => setAgentOpen((o) => !o)}
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
                  {agentLabel}
                  <ChevronDown className="h-3 w-3" />
                </button>
              }
            >
              <DropdownItem
                active={agentScope === "me"}
                onClick={() => { setAgentScope("me"); setAgentOpen(false); }}
              >
                Meus atendimentos
              </DropdownItem>
              {canViewAll && (
                <DropdownItem
                  active={agentScope === "all"}
                  onClick={() => { setAgentScope("all"); setAgentOpen(false); }}
                >
                  Todos os agentes
                </DropdownItem>
              )}
              {canViewAll && membersQ.data && membersQ.data.length > 0 && (
                <>
                  <DropdownDivider label="Agentes" />
                  {membersQ.data
                    .filter((m) => m.user_id !== myUserID)
                    .map((m) => (
                      <DropdownItem
                        key={m.user_id}
                        active={agentScope === m.user_id}
                        onClick={() => { setAgentScope(m.user_id); setAgentOpen(false); }}
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

            {/* Queue dropdown */}
            <Dropdown
              open={queueOpen}
              onClose={() => setQueueOpen(false)}
              trigger={
                <button
                  onClick={() => setQueueOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "hsl(240 15% 90%)",
                  }}
                >
                  <Layers className="h-3.5 w-3.5" style={{ color: "hsl(240 8% 48%)" }} />
                  {queueLabel}
                  <ChevronDown className="h-3 w-3" />
                </button>
              }
            >
              <DropdownItem
                active={queueScope === "all"}
                onClick={() => { setQueueScope("all"); setQueueOpen(false); }}
              >
                Todas as filas
              </DropdownItem>
              <DropdownItem
                active={queueScope === "none"}
                onClick={() => { setQueueScope("none"); setQueueOpen(false); }}
              >
                Sem fila
              </DropdownItem>
              {queuesQ.data?.items.length ? (
                <>
                  <DropdownDivider label="Filas" />
                  {queuesQ.data.items.map((q) => (
                    <DropdownItem
                      key={q.id}
                      active={queueScope === q.id}
                      onClick={() => { setQueueScope(q.id); setQueueOpen(false); }}
                    >
                      {q.name}
                    </DropdownItem>
                  ))}
                </>
              ) : null}
              <DropdownDivider />
              <Link
                href="/inbox/queues"
                className="block px-3 py-2 text-xs"
                style={{ color: "hsl(240 8% 52%)" }}
              >
                Gerenciar filas →
              </Link>
            </Dropdown>

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
                className="w-48 rounded-lg py-1.5 pl-8 pr-3 text-xs outline-none"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid hsl(240 12% 16%)",
                  color: "hsl(240 15% 90%)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Status tabs + counters */}
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
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {listQ.isError ? (
          <div className="p-8 text-sm" style={{ color: "#ef4444" }}>
            Erro ao carregar atendimentos.
          </div>
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
              maxHeight: "50vh",
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
      style={{ color: "hsl(240 8% 38%)", borderTop: label ? "none" : "1px solid hsl(240 12% 16%)" }}
    >
      {label ?? ""}
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
        Peça ao administrador do workspace a permissão{" "}
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
