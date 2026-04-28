"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Lock, Search, ChevronDown, User as UserIcon, MessageSquare,
  Layers, Smartphone, Radio, RefreshCw, Check, BarChart3,
  MoreVertical, Users, Building2, Zap, Bell, X,
} from "lucide-react";
import {
  conversationsApi, queuesApi, workspacesApi, channelsApi, instancesApi,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { ConversationDetail } from "@/components/inbox/ConversationDetail";
import { InboxReports } from "@/components/inbox/InboxReports";
import { useConversationWS } from "@/hooks/useConversationWS";
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";
import { useIsMobile } from "@/hooks/useMediaQuery";
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
  // Desktop notifications + audio ping + title badge para msgs inbound.
  // Hook é silencioso até o agente clicar em "Ativar notificações".
  const { permission: notifPerm, requestPermission: requestNotif } = useDesktopNotifications();
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const wsId = currentWorkspace?.id;
  const myUserID = session?.user?.id as string | undefined;
  const selectedId = searchParams.get("c") ?? undefined;
  // Mobile = single-pane: ou lista, ou conversa, com botão "voltar".
  // Desktop = split fixo (lista + drag handle + conversa).
  const isMobile = useIsMobile();

  // Gate da página = inbox:view. Sem inbox:view → Forbidden, mesmo que o
  // user tenha tickets:view (admin pode tirar acesso ao módulo todo).
  const canView = hasPerm(PERM.inboxView);
  const canViewAll = hasPerm(PERM.ticketsViewAll) || hasPerm(PERM.ticketsViewTeam) || isOwner;
  const canAssign = hasPerm(PERM.ticketsAssign);

  // Resize da coluna da lista — largura persistida em localStorage entre
  // sessões. Clamp em [260, 560] pra não ficar minúsculo nem maior que
  // o painel de chat.
  const LIST_WIDTH_KEY = "inbox:list:width";
  const LIST_MIN = 260;
  const LIST_MAX = 560;
  const [listWidth, setListWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 340;
    const raw = window.localStorage.getItem(LIST_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : 340;
    return Number.isFinite(n) && n >= LIST_MIN && n <= LIST_MAX ? n : 340;
  });
  const resizingRef = useRef(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LIST_WIDTH_KEY, String(listWidth));
    }
  }, [listWidth]);

  const startResize = (startClientX: number) => {
    resizingRef.current = true;
    const startWidth = listWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - startClientX;
      const next = Math.min(LIST_MAX, Math.max(LIST_MIN, startWidth + delta));
      setListWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [agentScope, setAgentScope] = useState<string>("me"); // "me" | "<uuid>" | "all"
  const [queueScope, setQueueScope] = useState<string>("all"); // "all" | "none" | uuid
  const [channelFilter, setChannelFilter] = useState<string[]>([]); // multi-select
  const [instanceFilter, setInstanceFilter] = useState<string[]>([]); // multi-select
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [q, setQ] = useState("");

  // View mode: "conversations" (padrão) | "reports". Persistido via URL
  // ?view=reports pra ser compartilhável e sobreviver a F5.
  const viewParam = searchParams.get("view");
  const viewMode: "conversations" | "reports" = viewParam === "reports" ? "reports" : "conversations";
  const setViewMode = (next: "conversations" | "reports") => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next === "reports") params.set("view", "reports");
    else params.delete("view");
    router.replace(`/inbox${params.toString() ? `?${params.toString()}` : ""}`);
  };

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
    // "Todos" (statusTab=all) é UX de visão geral: mostra TUDO no workspace
    // — atribuídas a qualquer um + sem atribuição. Não filtra por agente.
    // Para qualquer outro statusTab, respeita o agentScope normalmente.
    if (statusTab === "unassigned") {
      p.assigned_user_id = "none";
      p.status = ["open", "pending"];
    } else if (statusTab === "all") {
      // intencionalmente sem assigned_user_id e sem status — backend
      // traz todas as conversas que o usuário tem permissão de ver
      // (RBAC scope é aplicado no handler).
    } else {
      if (agentScope === "me") p.assigned_user_id = "me";
      else if (agentScope !== "all") p.assigned_user_id = agentScope;
      p.status = statusTab;
    }
    if (queueScope !== "all") p.queue_id = queueScope;
    if (channelFilter.length > 0) p.channel = channelFilter.join(",");
    if (instanceFilter.length > 0) p.instance_id = instanceFilter.join(",");
    if (q) p.q = q;
    return p;
  }, [agentScope, statusTab, queueScope, channelFilter, instanceFilter, q]);

  // Dedupe WS invalidations: várias mensagens chegando em rajada (campanha,
  // sync de history) disparariam N invalidações em < 1s = N refetches
  // simultâneos. Throttle de 800ms agrupa eventos numa janela e dispara
  // 1 refetch — mantém UI fresh sem queimar rate limit.
  const invalidateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scheduleInvalidate = useCallback(() => {
    if (invalidateTimerRef.current) return;
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unified"] });
      qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
      qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
    }, 800);
  }, [qc, wsId]);

  useConversationWS({
    prefixes: ["conversation.", "queue."],
    onEvent: () => {
      scheduleInvalidate();
    },
  });

  // queryKey usa JSON.stringify do listParams pra forçar refetch sempre que
  // qualquer filtro muda. Antes a chave era o object literal, que (mesmo
  // com useMemo correto) podia bater com cache antigo se referência fosse
  // estável após uma re-render. Stringify dá identidade determinística.
  const listQ = useQuery({
    queryKey: ["conversations", wsId, "unified", JSON.stringify(listParams)],
    queryFn: () =>
      conversationsApi
        // listParams contém arrays (status), o tipo de ConversationListParams
        // aceita ambos — o cast é só pra calar o TS no spread.
        .list(wsId as string, { ...(listParams as any), limit: 100 })
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
      const data = r.data as {
        processed: number;
        remaining: number;
        total_conversations?: number;
        open_conversations?: number;
        pending_conversations?: number;
        unassigned_open?: number;
      };
      const bits: string[] = [];
      bits.push(`${data.processed.toLocaleString("pt-BR")} mensagens`);
      if (data.total_conversations != null) {
        bits.push(`${data.total_conversations.toLocaleString("pt-BR")} atendimentos no total`);
      }
      if (data.pending_conversations) {
        bits.push(`${data.pending_conversations.toLocaleString("pt-BR")} em pendente`);
      }
      if (data.remaining > 0) {
        bits.push(`${data.remaining.toLocaleString("pt-BR")} ainda por processar`);
      }
      toast.success(bits.join(" · "));
      // Mensagens backfilladas podem cair em três estados diferentes:
      //   - open + sem assignee  (nenhuma fila para a instância)
      //   - open + assignee      (fila com agente online)
      //   - pending              (fila existe mas fora de horário OU
      //                           ninguém online no momento do backfill)
      // O default do header era "Meus + Abertos", que ignora os dois
      // primeiros casos e os pendings. Forçamos "Todos agentes + Todos
      // status" para o user ver tudo que foi criado, sem surpresa.
      if (canViewAll) setAgentScope("all");
      setStatusTab("all");
      setQueueScope("all");
      setChannelFilter([]);
      setInstanceFilter([]);
      qc.invalidateQueries({ queryKey: ["conversations", wsId] });
      qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
    },
    onError: () => toast.error("Falha ao sincronizar — tente novamente"),
  });

  if (!wsId || permsLoading) return <PageSkeleton />;
  if (!canView) return <Forbidden />;

  // Dedupe defensivo: na aba "Todos" (e em qualquer cenário onde múltiplos
  // tickets do MESMO contato aparecem por histórico), o usuário relatou
  // ver "conversas duplicadas". O DB tem partial unique index em
  // (workspace, instance, channel_key) WHERE status IN open/pending/snoozed,
  // mas tickets fechados/resolvidos do mesmo channel_key aparecem juntos.
  // Aqui ficamos com o mais recente por (instance_id + channel_key) — quem
  // quer ver histórico abre o detalhe e vê "Reaberto N vezes" + timeline.
  const rawList = listQ.data?.items ?? [];
  const list = (() => {
    const seen = new Map<string, ConversationRow>();
    for (const conv of rawList) {
      const key = `${conv.instance_id ?? ""}:${conv.channel_key ?? conv.id}`;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, conv);
        continue;
      }
      // Mantém o mais recente. Compara last_message_at (fallback id pra
      // estabilidade quando ambos sem timestamp).
      const a = prev.last_message_at ?? "";
      const b = conv.last_message_at ?? "";
      if (b > a) seen.set(key, conv);
    }
    return Array.from(seen.values());
  })();

  // Empty-state grande de backfill — só faz sentido na PRIMEIRA sincronização,
  // quando o workspace ainda não tem nenhuma Conversation criada. Se já tem
  // conversations mas a lista do filtro atual deu 0, usamos o empty state
  // normal ("Nenhum atendimento neste filtro.") em vez da tela inteira.
  const showBackfillCTA =
    !!statsQ.data &&
    statsQ.data.pending_backfill > 0 &&
    statsQ.data.conversations === 0 &&
    list.length === 0 &&
    !listQ.isLoading;

  // Pill pequeno no topo. Aparece quando:
  //  - não há nenhuma conversation ainda (primeira vez), ou
  //  - restam ≥ 100 mensagens pendentes (vale a pena sincronizar).
  // Pendentes em dígitos baixos (ex.: 14 de 2.149) costumam ser rejeitos
  // irrecuperáveis (instance deletada, etc.) — não vale poluir o header.
  const showBackfillPill =
    !!statsQ.data &&
    statsQ.data.pending_backfill > 0 &&
    (statsQ.data.conversations === 0 || statsQ.data.pending_backfill >= 100);

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
    <div className="flex h-full flex-col uniq-page">
      <header
        className="border-b px-4 sm:px-6 py-3 sm:py-4"
        style={{ borderColor: "hsl(240 12% 16%)" }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-medium" style={{ color: "hsl(240 15% 93%)" }}>
              Inbox
            </h1>
            <p className="text-xs" style={{ color: "hsl(240 8% 48%)" }}>
              {viewMode === "reports"
                ? "Relatórios e métricas do atendimento"
                : `${agentLabel} · ${channelLabel} · ${instanceLabel} · ${queueLabel}`}
            </p>
          </div>

          {viewMode === "conversations" && (
          <div className="ml-auto flex flex-nowrap items-center gap-1.5 sm:gap-2 min-w-0">
            {/* GlobalSearchButton removido — ficava redundante com o input
                "Buscar…" local. Quem quer busca full-text de mensagens
                pode usar /v1/conversations/messages/search via DevTools/API. */}
            <button
              type="button"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["conversations", wsId] });
                qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
                qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
              }}
              title="Atualizar"
              aria-label="Atualizar lista"
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{
                background: "var(--surface-2)",
                border: "1px solid hsl(240 12% 16%)",
                color: "hsl(240 8% 65%)",
              }}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            {notifPerm === "default" && (
              <button
                type="button"
                onClick={requestNotif}
                title="Ativar notificações desktop e som de mensagens"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium"
                style={{
                  background: "rgba(0,212,106,0.08)",
                  border: "1px solid rgba(0,212,106,0.25)",
                  color: "#00d46a",
                }}
              >
                <Bell className="h-3 w-3" /> Ativar notificações
              </button>
            )}
            {/* Agent */}
            <AgentDropdown
              agentScope={agentScope}
              setAgentScope={setAgentScope}
              canViewAll={canViewAll}
              myUserID={myUserID}
              members={membersQ.data ?? []}
              currentLabel={agentLabel}
            />

            {/* Channels (multi) — esconde em mobile pra economizar largura.
                User abre via "Mais filtros" (futuro) ou usa /inbox direto. */}
            <div className="shrink-0">
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
            </div>

            {/* Instances (multi) — idem channels, hidden em xs */}
            <div className="shrink-0">
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
            </div>

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

            {/* Clear filters — só aparece quando há ao menos um ativo. Útil
                pra desfazer rápido toda a combinação (canal + instância + fila). */}
            {(channelFilter.length > 0 || instanceFilter.length > 0 || queueScope !== "all") && (
              <button
                onClick={() => {
                  setChannelFilter([]);
                  setInstanceFilter([]);
                  setQueueScope("all");
                }}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: "rgba(248,113,113,0.08)",
                  border: "1px solid rgba(248,113,113,0.2)",
                  color: "#f87171",
                }}
                title="Remover todos os filtros"
              >
                <X className="h-3 w-3" />
                Limpar filtros
              </button>
            )}

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
                  background: "var(--surface-2)",
                  border: "1px solid hsl(240 12% 16%)",
                  color: "hsl(240 15% 90%)",
                }}
              />
            </div>

            <InboxMenu viewMode={viewMode} setViewMode={setViewMode} />
          </div>
          )}
          {viewMode === "reports" && (
            <div className="ml-auto">
              <InboxMenu viewMode={viewMode} setViewMode={setViewMode} />
            </div>
          )}
        </div>

        {/* Status tabs — só quando visualizando conversas */}
        {viewMode === "conversations" && (
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

          {showBackfillPill && statsQ.data && (
            <button
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
              className="ml-auto relative flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-50"
              style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.25)" }}
              title={`Sincronizar histórico · ${statsQ.data.pending_backfill} mensagens antigas pendentes`}
              aria-label="Sincronizar histórico"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${backfill.isPending ? "animate-spin" : ""}`} />
              {statsQ.data.pending_backfill > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold flex items-center justify-center"
                  style={{ background: "#00d46a", color: "#03170a" }}
                >
                  {statsQ.data.pending_backfill > 99 ? "99+" : statsQ.data.pending_backfill}
                </span>
              )}
            </button>
          )}
        </div>
        )}
      </header>

      {viewMode === "reports" ? (
        <InboxReports workspaceId={wsId as string} />
      ) : (
      /* Split messenger-style desktop · stack mobile (uma view por vez).
         Em mobile: lista visível só sem selectedId; chat fullscreen com
         selectedId. Desktop: ambos sempre visíveis com drag handle. */
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside
          className="flex flex-col overflow-hidden flex-shrink-0"
          style={{
            width: isMobile ? "100%" : listWidth,
            display: isMobile && selectedId ? "none" : "flex",
            background: "hsl(240 18% 5%)",
          }}
        >
          <div className="flex-1 overflow-y-auto uniq-no-bounce">
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
                density="compact"
                selectedId={selectedId}
                getHref={(conv) => `/inbox?c=${conv.id}`}
                actionLabel={canAssign && statusTab === "unassigned" ? "Atender" : undefined}
                onAction={canAssign && statusTab === "unassigned"
                  ? (conv) => claim.mutate(conv.id)
                  : undefined}
                showInstanceChip={instanceFilter.length !== 1}
                instanceLabel={(id) =>
                  id ? connectedInstances.find((i) => i.id === id)?.name : undefined
                }
              />
            )}
          </div>
        </aside>

        {/* Drag handle: só desktop. Em mobile o painel principal não
            convive com a lista, então não faz sentido redimensionar. */}
        {!isMobile && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={(e) => startResize(e.clientX)}
            onDoubleClick={() => setListWidth(340)}
            className="group relative flex-shrink-0 cursor-col-resize"
            style={{ width: 4, background: "hsl(240 12% 14%)" }}
            title="Arraste para redimensionar · duplo-clique restaura"
          >
            <div
              className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-[rgba(0,212,106,0.15)]"
            />
          </div>
        )}

        <main
          className="flex flex-1 min-w-0 flex-col overflow-hidden"
          style={{ display: isMobile && !selectedId ? "none" : "flex" }}
        >
          {selectedId ? (
            <ConversationDetail
              key={selectedId}
              conversationId={selectedId}
              onClose={() => router.replace("/inbox", { scroll: false })}
            />
          ) : (
            <NoneSelected count={list.length} />
          )}
        </main>
      </div>
      )}
    </div>
  );
}

function NoneSelected({ count }: { count: number }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center"
      style={{ color: "hsl(240 8% 48%)" }}
    >
      <MessageSquare className="h-12 w-12" style={{ color: "hsl(240 8% 24%)" }} />
      <h2 className="text-base font-medium" style={{ color: "hsl(240 15% 80%)" }}>
        Selecione um atendimento
      </h2>
      <p className="max-w-sm text-xs">
        {count > 0
          ? `${count} conversa${count > 1 ? "s" : ""} na lista à esquerda. Clique em uma para abrir aqui.`
          : "Quando você clicar em um atendimento, ele abre aqui sem perder os filtros do topo."}
      </p>
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
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
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
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
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
            background: selected.length > 0 ? "rgba(0,212,106,0.05)" : "var(--surface-2)",
            border: `1px solid ${selected.length > 0 ? "rgba(0,212,106,0.2)" : "var(--border-default)"}`,
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
      className="px-3 pb-1 pt-3 text-[9px] font-medium uppercase tracking-widest"
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
        <h2 className="mt-3 text-base font-medium" style={{ color: "hsl(240 15% 93%)" }}>
          Primeira sincronização
        </h2>
        <p className="mt-2 text-sm" style={{ color: "hsl(240 8% 52%)" }}>
          Seu workspace tem <b style={{ color: "hsl(240 15% 90%)" }}>{stats.message_logs.toLocaleString("pt-BR")}</b> mensagens
          históricas mas nenhum atendimento ainda. Vamos converter as conversas em tickets pra
          você operar daqui em diante.
        </p>
        <button
          onClick={onBackfill}
          disabled={running}
          className="mt-4 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: "#00d46a", color: "#03170a" }}
        >
          {running ? "Sincronizando…" : "Iniciar sincronização"}
        </button>
        <p className="mt-4 text-[11px]" style={{ color: "hsl(240 8% 38%)" }}>
          Processa em lotes de até 10k mensagens por clique. Se tiver
          histórico extenso, pode precisar de mais de uma rodada.
          <br />
          Os atendimentos criados ficam <b>sem atribuição</b> até você
          configurar uma fila — eles aparecem em “Todos os agentes” ou na
          aba <b>“Sem atribuição”</b>.
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
            background: "var(--surface-2)",
            border: "1px solid hsl(240 12% 16%)",
            color: "hsl(240 8% 48%)",
          }}
        >
          <summary className="cursor-pointer select-none">Detalhes técnicos</summary>
          <div className="mt-2 space-y-2 font-mono">
            <div>
              <div className="font-medium" style={{ color: "hsl(240 8% 60%)" }}>
                GET /v1/conversations
              </div>
              {status ? <div>status: {status}</div> : <div>sem resposta HTTP</div>}
              {backendMsg && <div className="whitespace-pre-wrap break-words">body: {backendMsg}</div>}
              {!backendMsg && e.message && <div>msg: {e.message}</div>}
            </div>
            {probe && (
              <div>
                <div className="font-medium" style={{ color: "hsl(240 8% 60%)" }}>
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

// Menu kebab/sanduíche que abre dropdown com ações + atalhos do inbox.
// Visualização (Conversas/Relatórios) + Gestão (filas, equipes, depts,
// respostas rápidas). Cada item de gestão é gateado por permissão —
// owner/super-admin veem tudo via bypass do hasPerm.
function InboxMenu({
  viewMode,
  setViewMode,
}: {
  viewMode: "conversations" | "reports";
  setViewMode: (v: "conversations" | "reports") => void;
}) {
  const router = useRouter();
  const { hasPerm, hasAnyPerm } = useWorkspacePermissions();
  const [open, setOpen] = useState(false);

  const canManageQueues = hasAnyPerm([PERM.queuesView, PERM.queuesManage]);
  const canManageTeams = hasAnyPerm([PERM.teamsView, PERM.teamsManage]);
  const canManageDepartments = hasAnyPerm([PERM.departmentsView, PERM.departmentsManage]);
  const canManageQuickReplies = hasAnyPerm([
    PERM.quickRepliesView,
    PERM.quickRepliesManageOwn,
    PERM.quickRepliesManageShared,
  ]);
  const showManagementSection =
    canManageQueues || canManageTeams || canManageDepartments || canManageQuickReplies;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-center rounded-lg p-1.5 transition-colors"
          style={{
            background: open ? "rgba(0,212,106,0.08)" : "var(--surface-2)",
            border: "1px solid hsl(240 12% 16%)",
            color: open ? "#00d46a" : "hsl(240 8% 60%)",
          }}
          title="Mais opções do inbox"
          aria-label="Menu do inbox"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      }
    >
      <SectionLabel>Visualização</SectionLabel>
      <DropdownItem
        active={viewMode === "conversations"}
        onClick={() => {
          setViewMode("conversations");
          setOpen(false);
        }}
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" />
          Conversas
        </span>
      </DropdownItem>
      <DropdownItem
        active={viewMode === "reports"}
        onClick={() => {
          setViewMode("reports");
          setOpen(false);
        }}
      >
        <span className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5" />
          Relatórios
        </span>
      </DropdownItem>

      {showManagementSection && (
        <>
          <SectionLabel>Gestão</SectionLabel>
          {canManageQueues && (
            <DropdownItem onClick={() => go("/settings/queues")}>
              <span className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5" />
                Gerenciar filas
              </span>
            </DropdownItem>
          )}
          {canManageTeams && (
            <DropdownItem onClick={() => go("/settings/teams")}>
              <span className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Gerenciar equipes
              </span>
            </DropdownItem>
          )}
          {canManageDepartments && (
            <DropdownItem onClick={() => go("/settings/departments")}>
              <span className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5" />
                Departamentos
              </span>
            </DropdownItem>
          )}
          {canManageQuickReplies && (
            <DropdownItem onClick={() => go("/settings/quick-replies")}>
              <span className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" />
                Respostas rápidas
              </span>
            </DropdownItem>
          )}
        </>
      )}
    </Dropdown>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest"
      style={{ color: "hsl(240 8% 42%)", borderBottom: "1px solid hsl(240 12% 11%)" }}
    >
      {children}
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
          style={{ background: "var(--surface-2)", color: "hsl(240 15% 85%)" }}
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
        style={{ background: "var(--surface-2)" }}
      />
      <div
        className="h-4 w-64 animate-pulse rounded"
        style={{ background: "var(--surface-2)" }}
      />
      <div className="mt-6 space-y-2">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-16 w-full animate-pulse rounded"
            style={{ background: "var(--surface-2)" }}
          />
        ))}
      </div>
    </div>
  );
}

// GlobalSearchButton — busca global por conteúdo de mensagens. Click abre
// dialog overlay com input + lista de hits. Click em hit navega pra
// /inbox?c=<conversation_id> e fecha.
type SearchHit = {
  message_id: string;
  conversation_id: string;
  direction: "in" | "out";
  type: string;
  snippet: string;
  sender_name?: string;
  contact_name?: string;
  channel_key: string;
  created_at: string;
};

function GlobalSearchButton({ wsId }: { wsId?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Atalho: Ctrl/Cmd+K abre busca
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const hitsQ = useQuery({
    queryKey: ["search-messages", wsId, debouncedQ],
    queryFn: () => conversationsApi.searchMessages(wsId as string, debouncedQ).then((r) => r.data as { hits: SearchHit[] }),
    enabled: !!wsId && debouncedQ.length >= 2 && open,
    staleTime: 10_000,
  });

  const goTo = (h: SearchHit) => {
    router.push(`/inbox?c=${h.conversation_id}`);
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Buscar mensagens (Ctrl+K)"
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium"
        style={{
          background: "var(--surface-2)",
          border: "1px solid hsl(240 12% 16%)",
          color: "hsl(240 8% 65%)",
        }}
      >
        <Search className="h-3 w-3" />
        Buscar
        <kbd className="ml-1 rounded px-1 py-0.5 text-[9px]" style={{ background: "var(--surface-2)", color: "hsl(240 8% 50%)" }}>⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[150] flex items-start justify-center pt-24" style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl shadow-2xl" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
              <Search className="h-4 w-4 flex-shrink-0" style={{ color: "hsl(240 8% 50%)" }} />
              <input
                autoFocus
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar em todas as mensagens…"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "hsl(240 15% 92%)" }}
              />
              <span className="text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>Esc fecha</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {debouncedQ.length < 2 ? (
                <div className="p-6 text-center text-xs" style={{ color: "hsl(240 8% 55%)" }}>
                  Digite ao menos 2 caracteres
                </div>
              ) : hitsQ.isLoading ? (
                <div className="p-6 text-center text-xs" style={{ color: "hsl(240 8% 55%)" }}>Buscando…</div>
              ) : !hitsQ.data?.hits || hitsQ.data.hits.length === 0 ? (
                <div className="p-6 text-center text-xs" style={{ color: "hsl(240 8% 55%)" }}>Nenhum resultado</div>
              ) : (
                <ul className="py-1">
                  {hitsQ.data.hits.map((h) => (
                    <li key={h.message_id}>
                      <button
                        type="button"
                        onClick={() => goTo(h)}
                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-white/5"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-[11px]" style={{ color: "hsl(240 8% 60%)" }}>
                            <span className="font-medium" style={{ color: h.direction === "out" ? "#00d46a" : "hsl(240 15% 88%)" }}>
                              {h.contact_name || h.sender_name || h.channel_key}
                            </span>
                            <span>·</span>
                            <span>{new Date(h.created_at).toLocaleString("pt-BR")}</span>
                          </div>
                          <div className="mt-0.5 text-xs truncate" style={{ color: "hsl(240 15% 88%)" }}>
                            {highlightMatch(h.snippet, debouncedQ)}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function highlightMatch(snippet: string, q: string): React.ReactNode {
  if (!q) return snippet;
  const lower = snippet.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx < 0) return snippet;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark style={{ background: "rgba(0,212,106,0.25)", color: "#00d46a", padding: "0 2px", borderRadius: 2 }}>
        {snippet.slice(idx, idx + q.length)}
      </mark>
      {snippet.slice(idx + q.length)}
    </>
  );
}
