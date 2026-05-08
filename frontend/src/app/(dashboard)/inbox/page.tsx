"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Lock, Search, ChevronDown, User as UserIcon, MessageSquare,
  Layers, Smartphone, Radio, RefreshCw, Check, BarChart3,
  MoreVertical, Users, Building2, Zap, Bell, BellOff, X, Phone, PhoneMissed, Sparkles,
  Filter, UserCircle2, Megaphone,
} from "lucide-react";
import { usePreferences } from "@/lib/preferences";
import {
  conversationsApi, queuesApi, workspacesApi, channelsApi, instancesApi, crmApi, callsApi,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConversationList, type ConversationRow } from "@/components/atendimento/ConversationList";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
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
type ViewKind = "all" | "messages" | "groups" | "contacts" | "channels" | "status";

// Filtros persistidos por workspace — sobrevivem a F5 e troca de janela.
// Chave inclui wsId pra cada workspace ter sua própria configuração de inbox.
const FILTERS_KEY_PREFIX = "inbox:filters:v1:";
type PersistedFilters = {
  agentScope: string;
  queueScope: string;
  channelFilter: string[];
  instanceFilter: string[];
  statusTab: StatusTab;
  viewKind: ViewKind;
};
function loadFilters(wsId?: string): Partial<PersistedFilters> | null {
  if (typeof window === "undefined" || !wsId) return null;
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY_PREFIX + wsId);
    return raw ? (JSON.parse(raw) as Partial<PersistedFilters>) : null;
  } catch {
    return null;
  }
}
function saveFilters(wsId: string | undefined, f: PersistedFilters) {
  if (typeof window === "undefined" || !wsId) return;
  try {
    window.localStorage.setItem(FILTERS_KEY_PREFIX + wsId, JSON.stringify(f));
  } catch { /* quota exceeded — ignora */ }
}

// Detectores de tipo (espelham os helpers do ConversationList) — usados pra
// filtrar client-side sem ida no backend. Mantemos local pra evitar
// dependência circular, mas a lógica precisa bater 1:1 com a lista.
function isGroupKey(k?: string): boolean {
  if (!k) return false;
  const s = k.toLowerCase();
  return (
    s.endsWith("@g.us") ||
    s.endsWith("-g.us") ||
    s.startsWith("group:") ||
    /^\d+-\d+@/.test(s)
  );
}
function isNewsletterKey(k?: string): boolean {
  if (!k) return false;
  const s = k.toLowerCase();
  return (
    s.endsWith("@newsletter") ||
    s.endsWith("@broadcast") ||
    s.includes("@broadcast.") ||
    s.startsWith("newsletter:") ||
    s.startsWith("channel:")
  );
}
function isStatusKey(k?: string): boolean {
  if (!k) return false;
  const s = k.toLowerCase();
  return s === "status@broadcast" || s.startsWith("status@") || s === "status:broadcast";
}

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

function getTabs(t: (k: string) => string): { id: StatusTab; label: string }[] {
  return [
    { id: "open",       label: t("inbox_open") },
    { id: "all",        label: t("inbox_all") },
    { id: "pending",    label: t("inbox_pending") },
    { id: "unassigned", label: t("inbox_unassigned") },
    { id: "snoozed",    label: t("inbox_snoozed") },
    { id: "resolved",   label: t("inbox_resolved") },
    { id: "closed",     label: t("inbox_closed") },
  ];
}

export default function InboxPageWrapper() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InboxPage />
    </Suspense>
  );
}

function InboxPage() {
  const { t } = usePreferences();
  const TABS = getTabs(t);
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading, isOwner } = useWorkspacePermissions();
  const { data: session } = useSession();
  // Desktop notifications + audio ping + title badge para msgs inbound.
  // Hook é silencioso até o agente clicar em "Ativar notificações". Mute
  // local persiste no localStorage e é independente da permissão do browser.
  const {
    permission: notifPerm,
    requestPermission: requestNotif,
    muted: notifMuted,
    toggleMute: toggleNotifMute,
  } = useDesktopNotifications();
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

  const seenConvsRef = useRef<Set<string>>(new Set());
  // Guarda o last_message_at por conversa para detectar nova mensagem em conversa existente.
  const convLastMsgRef = useRef<Map<string, string>>(new Map());
  const seenInitializedRef = useRef(false);
  // Timestamp de quando a página foi aberta — só mensagens posteriores disparam notificação.
  const pageOpenedAtRef = useRef(Date.now());

  // Incoming call state: null = no active call, else { instanceId, callFrom, callId }
  const [incomingCall, setIncomingCall] = useState<{ instanceId: string; callFrom: string; callId: string } | null>(null);

  // Estado inicial = defaults para SSR e primeiro render no cliente baterem.
  // A hidratação a partir do localStorage acontece num useEffect logo
  // abaixo, então não há mismatch (a UI só "muda" depois de hidratada).
  // Sem essa separação, React #418: server renderiza "all"+"open", cliente
  // renderiza valores salvos, hydration explode.
  const [agentScope, setAgentScope] = useState<string>("all"); // "me" | "<uuid>" | "all"
  const [queueScope, setQueueScope] = useState<string>("all"); // "all" | "none" | uuid
  const [channelFilter, setChannelFilter] = useState<string[]>([]); // multi-select
  const [instanceFilter, setInstanceFilter] = useState<string[]>([]); // multi-select
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [viewKind, setViewKind] = useState<ViewKind>("all");
  const [q, setQ] = useState("");
  const filtersHydratedRef = useRef(false);

  // Persiste sempre que algum filtro muda. q (busca) intencionalmente fora —
  // expectativa é que busca seja efêmera; persistir confunde quem volta.
  // Skip antes de hidratar pra não sobrescrever localStorage com defaults.
  useEffect(() => {
    if (!wsId) return;
    if (!filtersHydratedRef.current) return;
    saveFilters(wsId, { agentScope, queueScope, channelFilter, instanceFilter, statusTab, viewKind });
  }, [wsId, agentScope, queueScope, channelFilter, instanceFilter, statusTab, viewKind]);

  // Hidratação do localStorage acontece SEMPRE no cliente, depois do mount.
  // Re-roda quando wsId muda pra trocar de workspace e pegar a config dele.
  const lastHydratedWsRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!wsId) return;
    if (wsId === lastHydratedWsRef.current) return;
    lastHydratedWsRef.current = wsId;
    const f = loadFilters(wsId);
    if (!f) {
      // Workspace sem config salva — reseta pros defaults.
      setAgentScope("all");
      setQueueScope("all");
      setChannelFilter([]);
      setInstanceFilter([]);
      setStatusTab("open");
      setViewKind("all");
    } else {
      if (f.agentScope) setAgentScope(f.agentScope);
      if (f.queueScope) setQueueScope(f.queueScope);
      if (f.channelFilter) setChannelFilter(f.channelFilter);
      if (f.instanceFilter) setInstanceFilter(f.instanceFilter);
      if (f.statusTab) setStatusTab(f.statusTab);
      if (f.viewKind) setViewKind(f.viewKind);
    }
    filtersHydratedRef.current = true;
  }, [wsId]);

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

  useConversationWS({
    prefixes: ["call."],
    onEvent: (evt) => {
      if (evt.type === "call.incoming") {
        const p = evt.payload as { call_id: string; from: string };
        setIncomingCall({
          instanceId: evt.instance ?? "",
          callFrom: p.from,
          callId: p.call_id,
        });
      } else if (
        evt.type === "call.terminate" ||
        evt.type === "call.missed" ||
        evt.type === "call.rejected" ||
        evt.type === "call.accepted"
      ) {
        setIncomingCall(null);
      }
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

  useEffect(() => {
    // Aguarda o primeiro fetch completar antes de inicializar o seen set.
    // Se inicializarmos com array vazio (loading), todas as conversas
    // carregadas depois disparariam notificação.
    if (!listQ.isSuccess) return;
    const items = listQ.data?.items ?? [];
    if (!seenInitializedRef.current) {
      items.forEach((c) => {
        seenConvsRef.current.add(c.id);
        if (c.last_message_at) convLastMsgRef.current.set(c.id, c.last_message_at);
      });
      seenInitializedRef.current = true;
      return;
    }
    items.forEach((c) => {
      const prevAt = convLastMsgRef.current.get(c.id);
      const isNewConv = !seenConvsRef.current.has(c.id);
      const hasNewMsg = !isNewConv && c.last_message_at && c.last_message_at !== prevAt;

      if (isNewConv || hasNewMsg) {
        seenConvsRef.current.add(c.id);
        if (c.last_message_at) convLastMsgRef.current.set(c.id, c.last_message_at);

        // Só notifica mensagens recebidas (não enviadas por nós) após a página abrir.
        const msgAt = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
        if (msgAt > pageOpenedAtRef.current && !c.last_message_from_me) {
          const who = c.contact?.name || c.push_name || c.channel_key || "Contato";
          toast(isNewConv ? "Nova conversa" : "Nova mensagem", {
            description: who,
            duration: 5000,
          });
        }
      }
    });
  }, [listQ.data?.items, listQ.isSuccess]);

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
  // Swipe-to-archive (esquerda) e swipe-to-read (direita) — gestos
  // mobile aplicados em cada row da ConversationList. Resolve = arquiva
  // pra UX mobile (segue padrão Telegram/iOS Mail "swipe to delete/archive").
  const archiveMut = useMutation({
    mutationFn: (id: string) => conversationsApi.resolve(wsId as string, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations", wsId, "unified"] });
    },
    onError: () => toast.error("Falha ao arquivar"),
  });
  const markReadMut = useMutation({
    mutationFn: (id: string) => conversationsApi.markRead(wsId as string, id),
    onSuccess: () => {
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

  // CUIDADO: este useMutation precisa ficar ANTES dos early returns. Antes
  // estava depois do `if (!wsId) return <PageSkeleton />` lá embaixo, o que
  // violava as Rules of Hooks — quando wsId virava truthy, React via 1 hook
  // a mais que no render anterior e disparava error #310 ("rendered more
  // hooks than during the previous render"), quebrando a página inteira.
  const rejectCallMutation = useMutation({
    mutationFn: () =>
      callsApi.reject(incomingCall!.instanceId, incomingCall!.callFrom, incomingCall!.callId),
    onSettled: () => setIncomingCall(null),
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
    const arr = Array.from(seen.values());
    // Filtragem client-side por tipo (mensagens 1:1 / grupos / contatos /
    // canais / status). Status do WhatsApp (status@broadcast) ficam SEMPRE
    // ocultos no modo "all" — a UX antiga colava esses broadcasts no meio
    // dos atendimentos como se fosse um chat chamado "cad" (channel_key
    // truncado). Agora só aparecem quando o agente seleciona viewKind="status".
    return arr.filter((c) => {
      const k = c.channel_key;
      const group = isGroupKey(k);
      const newsletter = isNewsletterKey(k);
      const status = isStatusKey(k);
      switch (viewKind) {
        case "all": return !status;
        case "messages": return !group && !newsletter && !status;
        case "groups": return group;
        case "channels": return newsletter;
        case "status": return status;
        case "contacts": return !!c.contact?.id && !group && !newsletter && !status;
        default: return true;
      }
    });
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
    if (agentScope === "me") return t("inbox_my");
    if (agentScope === "all") return t("inbox_all_agents");
    const m = membersQ.data?.find((x) => x.user_id === agentScope);
    return m?.user?.name || m?.user?.email || "Agente";
  })();

  const queueLabel =
    queueScope === "all" ? t("inbox_all_queues")
    : queueScope === "none" ? "Sem fila"
    : queuesQ.data?.items.find((q) => q.id === queueScope)?.name ?? "Fila";

  const availableChannels = (channelsQ.data ?? []).filter((c) => c.available);
  const channelLabel =
    channelFilter.length === 0 ? t("inbox_all_channels")
    : channelFilter.length === 1
      ? availableChannels.find((c) => c.id === channelFilter[0])?.label ?? channelFilter[0]
      : `${channelFilter.length} canais`;

  const connectedInstances = instancesQ.data ?? [];
  const instanceLabel =
    instanceFilter.length === 0 ? t("inbox_all_instances")
    : instanceFilter.length === 1
      ? connectedInstances.find((i) => i.id === instanceFilter[0])?.name ?? "Instância"
      : `${instanceFilter.length} instâncias`;

  const statusLabel = TABS.find((tb) => tb.id === statusTab)?.label ?? t("inbox_attendances");

  const viewKindLabel = (() => {
    switch (viewKind) {
      case "messages": return "Mensagens";
      case "groups": return "Grupos";
      case "contacts": return "Contatos";
      case "channels": return "Canais";
      case "status": return "Status";
      default: return "Todos os tipos";
    }
  })();

  return (
    <div className="flex h-full flex-col uniq-page rounded-xl overflow-hidden">
      {/* Incoming call banner */}
      {incomingCall && (
        <div
          className="flex items-center gap-3 px-4 py-3 animate-pulse-once"
          style={{
            background: "linear-gradient(90deg, rgba(0,212,106,0.12), rgba(0,212,106,0.06))",
            borderBottom: "1px solid rgba(0,212,106,0.25)",
          }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,212,106,0.2)" }}>
              <Phone className="w-4 h-4 animate-bounce" style={{ color: "var(--green)" }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--green)" }}>Chamada recebida</p>
              <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>
                {incomingCall.callFrom.replace("@s.whatsapp.net", "").replace("@c.us", "")}
              </p>
            </div>
          </div>
          <button
            onClick={() => rejectCallMutation.mutate()}
            disabled={rejectCallMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <PhoneMissed className="w-3.5 h-3.5" />
            Rejeitar
          </button>
          <button
            onClick={() => setIncomingCall(null)}
            className="p-1.5 rounded-lg"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <header
        className="border-b px-4 sm:px-6 py-3 sm:py-4"
        style={{
          borderColor: "rgba(255,255,255,0.06)",
          background: "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          // Em mobile, quando uma conversa está aberta, escondemos o
          // header inteiro (título + filtros + busca) — a conversa ocupa
          // a tela toda, padrão UX dos apps de mensageria. O header da
          // própria ConversationDetail tem o back arrow pra voltar.
          display: (isMobile && selectedId) ? "none" : undefined,
        }}
      >
        {/* Linha 1: título + sinalizadores ativos + ações globais (notif, menu).
            Filtros vão na linha 2 abaixo, pra ficarem agrupados visualmente. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>
              {t("inbox_title")}
            </h1>
            <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>
              {viewMode === "reports"
                ? t("inbox_reports")
                : `${agentLabel} · ${channelLabel} · ${instanceLabel} · ${queueLabel}`}
            </p>
          </div>

          {viewMode === "conversations" && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <NotificationsButton
                permission={notifPerm}
                muted={notifMuted}
                onRequest={requestNotif}
                onToggleMute={toggleNotifMute}
              />
              {showBackfillPill && statsQ.data && (
                <BackfillPillButton
                  pending={statsQ.data.pending_backfill}
                  running={backfill.isPending}
                  onClick={() => backfill.mutate()}
                />
              )}
              <InboxMenu viewMode={viewMode} setViewMode={setViewMode} />
            </div>
          )}
          {viewMode === "reports" && (
            <div className="flex-shrink-0">
              <InboxMenu viewMode={viewMode} setViewMode={setViewMode} />
            </div>
          )}
        </div>

        {/* Linha 2: filtros em row próprio, abaixo dos sinalizadores. */}
        {viewMode === "conversations" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Atendimentos — status filter dropdown */}
            <SingleSelectDropdown
              icon={<MessageSquare className="h-3.5 w-3.5" />}
              label={statusLabel}
              active={statusTab !== "open"}
              items={TABS.map((t) => ({
                id: t.id,
                label: t.label,
                hint: t.id === "unassigned" && countsQ.data?.unassigned_open
                  ? `${countsQ.data.unassigned_open}`
                  : t.id === "open" && agentScope === "me" && countsQ.data?.mine_open
                  ? `${countsQ.data.mine_open}`
                  : undefined,
              }))}
              selected={statusTab}
              onChange={(id) => setStatusTab(id as StatusTab)}
            />

            {/* Tipo de visualização — mensagens 1:1, grupos, contatos, canais */}
            <SingleSelectDropdown
              icon={<Filter className="h-3.5 w-3.5" />}
              label={viewKindLabel}
              active={viewKind !== "all"}
              items={[
                { id: "all", label: "Todos os tipos" },
                { id: "messages", label: "Mensagens" },
                { id: "groups", label: "Grupos" },
                { id: "contacts", label: "Contatos" },
                { id: "channels", label: "Canais / Newsletter" },
                { id: "status", label: "Status (broadcast)" },
              ]}
              selected={viewKind}
              onChange={(id) => setViewKind(id as ViewKind)}
            />

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
              icon={<Radio className="h-3.5 w-3.5" />}
              label={channelLabel}
              items={availableChannels.map((c) => ({
                id: c.id,
                label: c.label,
                hint: c.color,
              }))}
              selected={channelFilter}
              onChange={setChannelFilter}
              emptyMsg={t("common_no_results")}
            />

            {/* Instances (multi) */}
            <MultiSelectDropdown
              icon={<Smartphone className="h-3.5 w-3.5" />}
              label={instanceLabel}
              items={connectedInstances.map((inst) => ({
                id: inst.id,
                label: inst.name,
                hint: inst.phone_number || inst.channel,
                sub: inst.channel,
              }))}
              selected={instanceFilter}
              onChange={setInstanceFilter}
              emptyMsg={t("common_no_results")}
            />

            {/* Queue */}
            <SingleSelectDropdown
              icon={<Layers className="h-3.5 w-3.5" />}
              label={queueLabel}
              active={queueScope !== "all"}
              items={[
                { id: "all", label: t("inbox_all_queues") },
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
                  {t("inbox_manage_queues")}
                </Link>
              }
            />

            {/* Clear filters — só aparece quando há ao menos um ativo */}
            {(channelFilter.length > 0 || instanceFilter.length > 0 || queueScope !== "all" || viewKind !== "all" || statusTab !== "open") && (
              <button
                onClick={() => {
                  setChannelFilter([]);
                  setInstanceFilter([]);
                  setQueueScope("all");
                  setViewKind("all");
                  setStatusTab("open");
                }}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                style={{
                  background: "rgba(248,113,113,0.10)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(248,113,113,0.22)",
                  color: "#f87171",
                  transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                }}
                title="Remover todos os filtros"
              >
                <X className="h-3 w-3" />
                Limpar
              </button>
            )}

            {/* Search */}
            <div className="relative ml-auto">
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
                  background: "rgba(255,255,255,0.05)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "hsl(240 15% 90%)",
                  transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                }}
              />
            </div>
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
            background: "var(--surface-1)",
            borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Urgency heat strip — only when we have conversations */}
          {!listQ.isLoading && list.length > 0 && (() => {
            const now = Date.now();
            const urgent = list.filter(c => {
              if (c.last_message_from_me) return false;
              const ms = c.last_message_at ? now - new Date(c.last_message_at).getTime() : 0;
              return ms > 30 * 60_000;
            }).length;
            const waiting = list.filter(c => {
              if (c.last_message_from_me) return false;
              const ms = c.last_message_at ? now - new Date(c.last_message_at).getTime() : 0;
              return ms >= 5 * 60_000 && ms <= 30 * 60_000;
            }).length;
            if (urgent === 0 && waiting === 0) return null;
            return (
              <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.20)" }}>
                {urgent > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.20)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    {urgent} urgente{urgent !== 1 ? "s" : ""}
                  </span>
                )}
                {waiting > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(245,158,11,0.10)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.18)" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#f59e0b" }} />
                    {waiting} aguardando
                  </span>
                )}
                <span className="ml-auto text-[9px]" style={{ color: "hsl(240 8% 36%)" }}>
                  {list.length} total
                </span>
              </div>
            );
          })()}
          {/* Pull-to-refresh em mobile — gesto nativo iOS/Android.
              No desktop o overflow:auto + touch events não disparam,
              comporta-se como um div normal de scroll. */}
          <PullToRefresh
            className="flex-1 uniq-no-bounce"
            onRefresh={async () => {
              await Promise.all([listQ.refetch(), statsQ.refetch()]);
            }}
          >
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
                onRenameContact={async (contactId, newName) => {
                  await crmApi.updateContact(contactId, { name: newName });
                  qc.invalidateQueries({ queryKey: ["conversations", wsId] });
                }}
                onArchive={isMobile ? (conv) => archiveMut.mutate(conv.id) : undefined}
                onMarkRead={isMobile ? (conv) => markReadMut.mutate(conv.id) : undefined}
              />
            )}
          </PullToRefresh>
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
    <div className="flex h-full flex-col items-center justify-center gap-5 p-12 text-center">
      {/* Ambient glow behind icon */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full blur-2xl" style={{ background: "rgba(0,212,106,0.08)" }} />
        <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center" style={{
          background: "linear-gradient(135deg, rgba(0,212,106,0.1) 0%, rgba(0,212,106,0.04) 100%)",
          border: "1px solid rgba(0,212,106,0.15)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 0 32px rgba(0,212,106,0.08)",
        }}>
          <MessageSquare className="h-7 w-7" style={{ color: "var(--green)", opacity: 0.7 }} />
        </div>
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          Selecione um atendimento
        </h2>
        <p className="max-w-xs text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
          {count > 0
            ? `${count} conversa${count > 1 ? "s" : ""} na lista. Clique em uma para abrir aqui.`
            : "Clique em um atendimento à esquerda para abrir a conversa completa."}
        </p>
      </div>
      <Link href="/uniq-ai">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all hover:scale-[1.02]" style={{
          background: "rgba(0,212,106,0.08)",
          border: "1px solid rgba(0,212,106,0.18)",
          color: "var(--green)",
        }}>
          <Sparkles className="w-3.5 h-3.5" />
          Perguntar ao Uniq AI →
        </div>
      </Link>
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
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  // "all" é o default do agente (visão geral). Qualquer outro valor é
  // considerado filtro ativo e ganha a cor verde.
  const isActive = agentScope !== "all";
  const bg = isActive ? "rgba(0,212,106,0.12)" : "rgba(255,255,255,0.06)";
  const bgHover = isActive ? "rgba(0,212,106,0.18)" : "rgba(255,255,255,0.10)";
  const border = isActive ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.10)";
  const borderHover = isActive ? "rgba(0,212,106,0.35)" : "rgba(255,255,255,0.15)";
  const fg = isActive ? "#00d46a" : "hsl(240 15% 90%)";
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={!canViewAll}
          className="flex items-center gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium"
          title={currentLabel}
          style={{
            background: bg,
            backdropFilter: "blur(8px)",
            border: `1px solid ${border}`,
            boxShadow: isActive ? "0 0 12px rgba(0,212,106,0.10)" : "none",
            color: fg,
            opacity: canViewAll ? 1 : 0.6,
            transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
          }}
          onMouseEnter={e => { if (canViewAll) { e.currentTarget.style.background = bgHover; e.currentTarget.style.borderColor = borderHover; } }}
          onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.borderColor = border; }}
        >
          <UserIcon className="h-3.5 w-3.5" style={{ color: isActive ? "#00d46a" : "hsl(240 8% 48%)" }} />
          <span className={isActive ? "" : "hidden sm:inline"}>{currentLabel}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      <DropdownItem
        active={agentScope === "me"}
        onClick={() => { setAgentScope("me"); setOpen(false); }}
      >
        {t("inbox_my")}
      </DropdownItem>
      {canViewAll && (
        <DropdownItem
          active={agentScope === "all"}
          onClick={() => { setAgentScope("all"); setOpen(false); }}
        >
          {t("inbox_all_agents")}
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
  icon, label, items, selected, onChange, footer, active,
}: {
  icon: React.ReactNode;
  label: string;
  items: { id: string; label: string; hint?: string }[];
  selected: string;
  onChange: (id: string) => void;
  footer?: React.ReactNode;
  /** Se true, pinta o trigger em verde (filtro com valor não-default) */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Cores conforme estado (active = filtro divergindo do default).
  const triggerBg = active ? "rgba(0,212,106,0.12)" : "rgba(255,255,255,0.06)";
  const triggerBgHover = active ? "rgba(0,212,106,0.18)" : "rgba(255,255,255,0.10)";
  const triggerBorder = active ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.10)";
  const triggerBorderHover = active ? "rgba(0,212,106,0.35)" : "rgba(255,255,255,0.15)";
  const triggerColor = active ? "#00d46a" : "hsl(240 15% 90%)";
  const iconColor = active ? "#00d46a" : "hsl(240 8% 48%)";
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium"
          title={label}
          style={{
            background: triggerBg,
            backdropFilter: "blur(8px)",
            border: `1px solid ${triggerBorder}`,
            color: triggerColor,
            boxShadow: active ? "0 0 12px rgba(0,212,106,0.10)" : "none",
            transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = triggerBgHover; e.currentTarget.style.borderColor = triggerBorderHover; }}
          onMouseLeave={e => { e.currentTarget.style.background = triggerBg; e.currentTarget.style.borderColor = triggerBorder; }}
        >
          <span style={{ color: iconColor, display: "inline-flex" }}>{icon}</span>
          {/* Label esconde em mobile QUANDO o filtro está no default — fica
              só o ícone, libera espaço pra caber tudo numa linha. Quando
              ativo (não-default) o label aparece pra dar feedback claro. */}
          <span className={active ? "" : "hidden sm:inline"}>{label}</span>
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
          className="flex items-center gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium"
          title={label}
          style={{
            background: selected.length > 0 ? "rgba(0,212,106,0.12)" : "rgba(255,255,255,0.06)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${selected.length > 0 ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.10)"}`,
            boxShadow: selected.length > 0 ? "0 0 12px rgba(0,212,106,0.10)" : "none",
            color: selected.length > 0 ? "#00d46a" : "hsl(240 15% 90%)",
            transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
          }}
          onMouseEnter={e => {
            const active = selected.length > 0;
            e.currentTarget.style.background = active ? "rgba(0,212,106,0.18)" : "rgba(255,255,255,0.10)";
            e.currentTarget.style.borderColor = active ? "rgba(0,212,106,0.35)" : "rgba(255,255,255,0.15)";
          }}
          onMouseLeave={e => {
            const active = selected.length > 0;
            e.currentTarget.style.background = active ? "rgba(0,212,106,0.12)" : "rgba(255,255,255,0.06)";
            e.currentTarget.style.borderColor = active ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.10)";
          }}
        >
          <span style={{ color: selected.length > 0 ? "#00d46a" : "hsl(240 8% 48%)", display: "inline-flex" }}>{icon}</span>
          {/* Em mobile: só label se houver seleção (= filtro ativo). Sem
              seleção, fica ícone-only pra economizar largura. */}
          <span className={selected.length > 0 ? "" : "hidden sm:inline"}>{label}</span>
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Recalcula posição quando abre + acompanha scroll/resize. Isso é
  // essencial agora que o painel renderiza via Portal: sem listeners
  // o menu fica "preso" no lugar e sai do alinhamento ao scrollar.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 4,
        left: Math.max(4, Math.min(window.innerWidth - 260, r.right - 256)),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // O painel é renderizado via createPortal direto no <body>. Sem isso,
  // o `backdropFilter` no header do inbox vira containing block para
  // descendentes `position: fixed`, prendendo o dropdown dentro do
  // header — quando o painel de chat abre por cima, ele cobre o menu.
  // Portal escapa qualquer ancestor com transform/filter/backdrop-filter
  // e o `overflow: hidden` da página nunca corta o popup.
  const portalNode =
    open && mounted && typeof document !== "undefined" ? (
      createPortal(
        <>
          <div className="fixed inset-0 z-[2000]" onClick={onClose} />
          <div
            className="fixed z-[2001] w-64 overflow-auto rounded-lg shadow-xl"
            style={{
              top: pos.top,
              left: pos.left,
              background: "linear-gradient(135deg, rgba(18,18,30,0.97) 0%, rgba(10,10,20,0.99) 100%)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.60), inset 0 1px 0 rgba(255,255,255,0.07)",
              maxHeight: "60vh",
            }}
          >
            {children}
          </div>
        </>,
        document.body,
      )
    ) : null;

  return (
    <div ref={wrapRef} className="inline-block">
      {trigger}
      {portalNode}
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
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5"
      style={{
        color: active ? "#00d46a" : "hsl(240 15% 90%)",
        background: active ? "rgba(0,212,106,0.08)" : "transparent",
        transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
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
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
      }}>
        <MessageSquare className="h-5 w-5" style={{ color: "var(--text-3)", opacity: 0.5 }} />
      </div>
      <p className="text-sm" style={{ color: "var(--text-3)" }}>{message}</p>
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
          className="flex items-center justify-center rounded-lg p-1.5"
          style={{
            background: open ? "rgba(0,212,106,0.12)" : "rgba(255,255,255,0.06)",
            backdropFilter: "blur(8px)",
            border: open ? "1px solid rgba(0,212,106,0.25)" : "1px solid rgba(255,255,255,0.10)",
            color: open ? "#00d46a" : "hsl(240 8% 60%)",
            transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
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

// NotificationsButton — botão de toggle de notificações desktop. Persiste:
//   1) lê Notification.permission no mount (sem isso some após F5 com perm
//      já concedida);
//   2) quando "default", clique pede permissão;
//   3) quando "granted", clique alterna mute local (independente do browser);
//   4) quando "denied", botão fica disabled com tooltip explicando.
function NotificationsButton({
  permission, muted, onRequest, onToggleMute,
}: {
  permission: NotificationPermission;
  muted: boolean;
  onRequest: () => void | Promise<unknown>;
  onToggleMute: () => void;
}) {
  const denied = permission === "denied";
  const granted = permission === "granted";
  const showOff = (granted && muted) || denied;
  const handle = () => {
    if (denied) return;
    if (granted) onToggleMute();
    else onRequest();
  };
  const title = denied
    ? "Notificações bloqueadas no browser — habilite nas preferências do site"
    : granted
      ? muted ? "Reativar som e notificações" : "Silenciar notificações"
      : "Ativar notificações desktop e som de mensagens";
  // Verde quando ativas (perm granted + não-muted). Cinza quando off/denied.
  const bg = showOff ? "rgba(255,255,255,0.06)" : "rgba(0,212,106,0.10)";
  const border = showOff ? "rgba(255,255,255,0.10)" : "rgba(0,212,106,0.22)";
  const fg = showOff ? "hsl(240 8% 60%)" : "#00d46a";
  return (
    <button
      type="button"
      onClick={handle}
      disabled={denied}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-lg w-7 h-7 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: bg, border: `1px solid ${border}`, color: fg }}
    >
      {showOff ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
    </button>
  );
}

// Pill verde de backfill — extraído pra desentupir o JSX do header.
function BackfillPillButton({
  pending, running, onClick,
}: {
  pending: number;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      className="relative flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-50"
      style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.25)" }}
      title={`Sincronizar histórico · ${pending} mensagens antigas pendentes`}
      aria-label="Sincronizar histórico"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
      {pending > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold flex items-center justify-center"
          style={{ background: "#00d46a", color: "#03170a" }}
        >
          {pending > 99 ? "99+" : pending}
        </span>
      )}
    </button>
  );
}

function Forbidden() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{
        background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
      }}>
        <Lock className="h-6 w-6" style={{ color: "#f87171" }} />
      </div>
      <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>
        Sem acesso ao módulo de atendimento
      </h2>
      <p className="max-w-md text-sm" style={{ color: "var(--text-3)" }}>
        Peça ao administrador a permissão{" "}
        <code className="rounded px-1 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          tickets:view
        </code>.
      </p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 space-y-2" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <div className="h-6 w-28 animate-pulse rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="h-3 w-56 animate-pulse rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-80 border-r p-3 space-y-2" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 w-full animate-pulse rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }} />
          ))}
        </div>
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
