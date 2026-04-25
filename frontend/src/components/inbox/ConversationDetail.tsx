"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Send, StickyNote, CheckCircle2, Clock3, RotateCcw,
  UserCheck, UserX, ArrowRightLeft, Bot, BotOff, Lock, AlertTriangle,
  Smile, X, Star, Mic, Image as ImageIcon, FileText, MapPin, Check,
  CheckCheck, AlertCircle, Paperclip, Pin, Sparkles, Users as UsersIcon,
  Maximize2 as Maximize2Icon,
} from "lucide-react";
import { MediaViewer, type MediaViewerSource } from "@/components/inbox/MediaViewer";
import { conversationsApi, queuesApi, quickRepliesApi, teamsApi, workspacesApi, csatApi, mediaUploadApi } from "@/lib/api";
import { TemplatePicker } from "@/components/inbox/TemplatePicker";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { relativeTime } from "@/components/atendimento/ConversationList";
import { useConversationWS, type WSEvent } from "@/hooks/useConversationWS";

interface Conversation {
  id: string;
  workspace_id: string;
  instance_id: string;
  /** Backend faz Preload("Instance") quando disponível */
  instance?: { id: string; name: string; channel?: string; phone_number?: string } | null;
  contact_id?: string | null;
  channel_type: string;
  channel_key: string;
  status: string;
  priority: string;
  subject?: string;
  queue_id?: string | null;
  department_id?: string | null;
  team_id?: string | null;
  assigned_user_id?: string | null;
  assigned_user?: { id: string; name: string; email: string } | null;
  contact?: { id: string; name: string; phone?: string; email?: string; avatar_url?: string } | null;
  last_message_at?: string;
  unread_count: number;
  is_bot_active: boolean;
  reopen_count: number;
  first_response_at?: string | null;
  created_at: string;
}

// Cor + label por canal — visual hint pra que o atendente saiba de onde
// veio a mensagem sem ler texto.
function channelChipStyle(channel?: string): { label: string; bg: string; color: string; border: string } {
  switch ((channel || "").toLowerCase()) {
    case "whatsapp":  return { label: "WhatsApp",  bg: "rgba(37,211,102,0.08)", color: "#25d366", border: "rgba(37,211,102,0.2)" };
    case "waba":      return { label: "WhatsApp Business", bg: "rgba(37,211,102,0.06)", color: "#25d366", border: "rgba(37,211,102,0.18)" };
    case "instagram": return { label: "Instagram", bg: "rgba(225,48,108,0.08)", color: "#e1306c", border: "rgba(225,48,108,0.2)" };
    case "facebook":  return { label: "Facebook",  bg: "rgba(24,119,242,0.08)", color: "#1877f2", border: "rgba(24,119,242,0.2)" };
    case "telegram":  return { label: "Telegram",  bg: "rgba(34,158,217,0.08)", color: "#229ed9", border: "rgba(34,158,217,0.2)" };
    case "linkedin":  return { label: "LinkedIn",  bg: "rgba(10,102,194,0.08)", color: "#0a66c2", border: "rgba(10,102,194,0.2)" };
    case "tiktok":    return { label: "TikTok",    bg: "rgba(255,0,80,0.08)",   color: "#ff0050", border: "rgba(255,0,80,0.2)" };
    case "kwai":      return { label: "Kwai",      bg: "rgba(255,102,0,0.08)",  color: "#ff6600", border: "rgba(255,102,0,0.2)" };
    default:          return { label: channel || "Canal", bg: "rgba(255,255,255,0.04)", color: "hsl(240 8% 60%)", border: "rgba(255,255,255,0.08)" };
  }
}

interface Queue {
  id: string;
  name: string;
}

interface TimelinePayload {
  items: Array<{
    kind: "message" | "note" | "event";
    at: string;
    id: string;
    payload: MessagePayload | NotePayload | EventPayload;
  }>;
}

interface MessagePayload {
  id: string;
  direction: "in" | "out";
  type: string;
  content: string;
  sender_name?: string;
  contact_name?: string;
  created_at: string;
  status?: string;
  is_internal_note?: boolean;
  is_pinned?: boolean;
  is_favorite?: boolean;
}

interface NotePayload {
  id: string;
  body: string;
  author?: { id: string; name: string; email: string } | null;
  author_user_id: string;
  is_pinned: boolean;
  created_at: string;
}

interface EventPayload {
  id: string;
  event_type: string;
  actor_type: string;
  payload: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  open: { label: "Aberto", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  pending: { label: "Pendente", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  snoozed: { label: "Soneca", cls: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400" },
  resolved: { label: "Resolvido", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  closed: { label: "Encerrado", cls: "bg-zinc-500/10 text-zinc-500" },
};

export interface ConversationDetailProps {
  conversationId: string;
  /** Called when the user clicks the back arrow — lets the split inbox
   *  remove `?c=<id>` from the URL without navigating. If omitted,
   *  the back button links to /inbox. */
  onClose?: () => void;
}

export function ConversationDetail({ conversationId, onClose }: ConversationDetailProps) {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;

  const canView = hasPerm(PERM.ticketsView);
  const canSend = hasPerm(PERM.inboxSend);
  const canAssign = hasPerm(PERM.ticketsAssign);
  const canTransfer = hasPerm(PERM.ticketsTransfer);

  // Lightbox state — abre quando agente clica em mídia. null = fechado.
  const [viewerSource, setViewerSource] = useState<MediaViewerSource | null>(null);
  const canClose = hasPerm(PERM.ticketsClose);
  const canReopen = hasPerm(PERM.ticketsReopen);
  const canSnooze = hasPerm(PERM.ticketsSnooze);
  const canUpdate = hasPerm(PERM.ticketsUpdate);
  const canNote = hasPerm(PERM.notesCreate);

  const [transferOpen, setTransferOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const convQ = useQuery({
    queryKey: ["conversation", wsId, conversationId],
    queryFn: () => conversationsApi.get(wsId as string, conversationId).then((r) => r.data as Conversation),
    enabled: !!wsId && canView,
    refetchInterval: 10_000,
  });

  // Infinite scroll pela timeline: a primeira página traz as 100 mensagens
  // mais recentes; conforme o agente rola pro topo, fetchNextPage puxa
  // outras 100 mais antigas via `?before=<createdAt>`. O refetchInterval
  // mantém a primeira página viva (ex.: nova mensagem recebida aparece).
  const TIMELINE_PAGE = 100;
  const timelineQ = useInfiniteQuery({
    queryKey: ["conversation-timeline", wsId, conversationId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await conversationsApi.timeline(wsId as string, conversationId, {
        before: pageParam as string | undefined,
        limit: TIMELINE_PAGE,
      });
      return r.data as TimelinePayload;
    },
    getNextPageParam: (last) => {
      const items = last.items ?? [];
      if (items.length < TIMELINE_PAGE) return undefined; // sem mais antigas
      // `items` chegam DESC (mais novo primeiro); a mais antiga é a última.
      return items[items.length - 1]?.at;
    },
    enabled: !!wsId && canView,
    refetchInterval: 5_000,
  });

  const queuesQ = useQuery({
    queryKey: ["queues", wsId],
    queryFn: () => queuesApi.list(wsId as string).then((r) => r.data as { items: Queue[] }),
    enabled: !!wsId && canView,
  });

  // Mark read on open + refresh list so o badge de não-lidas some na hora.
  // Antes só zerava no backend mas o front continuava mostrando contagem
  // antiga até a próxima invalidação por WS.
  useEffect(() => {
    if (!wsId || !canView) return;
    conversationsApi
      .markRead(wsId, conversationId)
      .then(() => {
        // Invalida lista de conversas (todas as views) e contadores.
        qc.invalidateQueries({ queryKey: ["conversations", wsId] });
        qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
        qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
      })
      .catch(() => {
        /* não é crítico — o badge atualiza no próximo refetch */
      });
  }, [wsId, canView, conversationId, qc]);

  // Live updates — any server-side conversation event for this ticket
  // invalidates the relevant queries. Payloads that embed `conversation_id`
  // are filtered so we don't re-fetch for unrelated tickets.
  useConversationWS({
    prefixes: ["conversation."],
    onEvent: (evt: WSEvent) => {
      const payload = (evt.payload ?? {}) as { conversation_id?: string; conversation?: { id?: string } };
      const eventConvID = payload.conversation_id ?? payload.conversation?.id;
      if (eventConvID && eventConvID !== conversationId) return;
      qc.invalidateQueries({ queryKey: ["conversation", wsId, conversationId] });
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
  });


  const send = useMutation({
    mutationFn: (body: string) => conversationsApi.sendMessage(wsId as string, conversationId, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
      qc.invalidateQueries({ queryKey: ["conversation", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao enviar mensagem"),
  });

  const note = useMutation({
    mutationFn: (body: string) => conversationsApi.createNote(wsId as string, conversationId, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao criar nota"),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["conversation", wsId, conversationId] });
    qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    qc.invalidateQueries({ queryKey: ["conversations", wsId] });
  };

  const claim = useMutation({
    mutationFn: () => conversationsApi.assign(wsId as string, conversationId),
    onSuccess: () => {
      toast.success("Atribuído a você");
      refresh();
    },
    onError: (err) => {
      const msg = (err as { response?: { status?: number } }).response?.status === 409
        ? "Já está atribuído a outro agente"
        : "Falha ao atribuir";
      toast.error(msg);
      refresh();
    },
  });

  const unassign = useMutation({
    mutationFn: () => conversationsApi.unassign(wsId as string, conversationId),
    onSuccess: () => { toast.success("Removido da sua fila"); refresh(); },
  });

  const transfer = useMutation({
    mutationFn: (queueId: string) => conversationsApi.transfer(wsId as string, conversationId, { queue_id: queueId }),
    onSuccess: () => { toast.success("Transferido"); refresh(); },
    onError: () => toast.error("Falha ao transferir"),
  });

  const resolve = useMutation({
    mutationFn: () => conversationsApi.resolve(wsId as string, conversationId),
    onSuccess: () => { toast.success("Resolvido"); refresh(); },
  });
  const close = useMutation({
    mutationFn: () => conversationsApi.close(wsId as string, conversationId),
    onSuccess: () => { toast.success("Encerrado"); refresh(); },
  });
  const reopen = useMutation({
    mutationFn: () => conversationsApi.reopen(wsId as string, conversationId),
    onSuccess: () => { toast.success("Reaberto"); refresh(); },
  });
  const snooze = useMutation({
    mutationFn: (iso: string) => conversationsApi.snooze(wsId as string, conversationId, iso),
    onSuccess: () => { toast.success("Em soneca"); refresh(); },
  });
  const bot = useMutation({
    mutationFn: (active: boolean) =>
      active
        ? conversationsApi.enableBot(wsId as string, conversationId)
        : conversationsApi.disableBot(wsId as string, conversationId),
    onSuccess: () => refresh(),
  });

  const patchMsg = useMutation({
    mutationFn: ({ msgId, patch }: { msgId: string; patch: { is_pinned?: boolean; is_favorite?: boolean } }) =>
      conversationsApi.patchMessage(wsId as string, conversationId, msgId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao atualizar mensagem"),
  });

  // Keyboard shortcuts — declared after all mutations to avoid TDZ refs.
  const openSnoozePrompt = useCallback(() => {
    const hours = Number(prompt("Em quantas horas desnoozear?", "4") || 4);
    if (hours > 0) snooze.mutate(new Date(Date.now() + hours * 3600_000).toISOString());
  }, [snooze]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "t" && canTransfer) { e.preventDefault(); setTransferOpen(true); }
      else if (k === "a" && canAssign && !convQ.data?.assigned_user_id) { e.preventDefault(); claim.mutate(); }
      else if (k === "s" && canSnooze && convQ.data?.status === "open") { e.preventDefault(); openSnoozePrompt(); }
      else if (k === "e" && canClose && convQ.data && convQ.data.status !== "resolved" && convQ.data.status !== "closed") {
        e.preventDefault(); resolve.mutate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canTransfer, canAssign, canSnooze, canClose, convQ.data, claim, resolve, openSnoozePrompt]);

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Sem permissão para ver este atendimento.</p>
      </div>
    );
  }

  const conv = convQ.data;
  // Achata todas as páginas da infinite query (desc → asc) e remove
  // duplicatas caso backend reemita um item na borda entre pages.
  const timelineAll = useMemo(() => {
    const pages = timelineQ.data?.pages ?? [];
    const seen = new Set<string>();
    const out: TimelinePayload["items"] = [];
    for (const p of pages) {
      for (const it of p.items ?? []) {
        const key = `${it.kind}-${it.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
    }
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [timelineQ.data]);
  const timeline = timelineAll;
  const status = conv ? STATUS_LABELS[conv.status] ?? STATUS_LABELS.open : null;

  // SLA breach indicator: scan the audit events for a sla_breached row; if
  // present we show a red pill. Lightweight — no extra query.
  const slaBreached = useMemo(
    () => timeline.some((e) => e.kind === "event" && (e.payload as EventPayload).event_type === "sla_breached"),
    [timeline],
  );

  // IntersectionObserver no topo: quando o sentinel fica visível, carrega
  // a próxima página mais antiga. Preserva scroll position com
  // scrollTop anchor — sem o jump feio de "pulou 1k pixels".
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const preserveRef = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const scroller = scrollRef.current;
    if (!sentinel || !scroller) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && timelineQ.hasNextPage && !timelineQ.isFetchingNextPage) {
          preserveRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
          timelineQ.fetchNextPage();
        }
      },
      { root: scroller, rootMargin: "120px", threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [timelineQ, conversationId]);

  // Após chegar uma nova página no topo, reposiciona o scroll para o
  // mesmo ponto visual (scrollHeight cresceu no topo → precisa compensar).
  useEffect(() => {
    if (!preserveRef.current || !scrollRef.current) return;
    const scroller = scrollRef.current;
    const delta = scroller.scrollHeight - preserveRef.current.height;
    if (delta > 0) scroller.scrollTop = preserveRef.current.top + delta;
    preserveRef.current = null;
  }, [timeline.length]);

  return (
    <div className="flex h-full min-h-0">
      {/* Main pane: header + timeline + composer */}
      <section className="flex flex-1 min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 hover:bg-white/5 lg:hidden"
              style={{ color: "hsl(240 8% 48%)" }}
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link
              href="/inbox"
              className="rounded-md p-1.5 hover:bg-white/5"
              style={{ color: "hsl(240 8% 48%)" }}
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          {/* Avatar do contato/grupo — quem clica logo identifica visualmente */}
          {(() => {
            const isGroup = (conv?.channel_key || "").toLowerCase().endsWith("@g.us");
            const avatarUrl = conv?.contact?.avatar_url;
            const name = conv?.contact?.name || conv?.subject || conv?.channel_key || "?";
            if (avatarUrl) {
              return (
                <img
                  src={avatarUrl}
                  alt={name}
                  className="h-9 w-9 rounded-full object-cover flex-shrink-0"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                />
              );
            }
            if (isGroup) {
              return (
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full flex-shrink-0"
                  style={{
                    background: "rgba(167,139,250,0.12)",
                    border: "1px solid rgba(167,139,250,0.25)",
                    color: "#c4b5fd",
                  }}
                >
                  <UsersIcon className="h-4 w-4" />
                </div>
              );
            }
            const text = name;
            let hash = 0;
            for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
            const hue = Math.abs(hash) % 360;
            const initials = (text.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0] || "").join("") || "?").toUpperCase();
            return (
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full font-semibold flex-shrink-0"
                style={{
                  background: `hsl(${hue} 50% 22%)`,
                  color: `hsl(${hue} 70% 75%)`,
                  fontSize: 14,
                }}
              >
                {initials}
              </div>
            );
          })()}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {(conv?.channel_key || "").toLowerCase().endsWith("@g.us") && (
                <UsersIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#a78bfa" }} aria-label="Grupo" />
              )}
              <h1 className="truncate text-base font-semibold">
                {conv?.contact?.name || conv?.subject || "Atendimento"}
              </h1>
              {status && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                  {status.label}
                </span>
              )}
              {conv?.is_bot_active && (
                <span className="flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-600 dark:text-purple-400">
                  <Bot className="h-3 w-3" /> bot
                </span>
              )}
              {conv?.reopen_count ? (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                  reaberto {conv.reopen_count}×
                </span>
              ) : null}
              {slaBreached && (
                <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" /> SLA
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: "hsl(240 8% 50%)" }}>
              {/* Chip do canal — ícone + cor por tipo */}
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  background: channelChipStyle(conv?.channel_type).bg,
                  color: channelChipStyle(conv?.channel_type).color,
                  border: `1px solid ${channelChipStyle(conv?.channel_type).border}`,
                }}
              >
                {channelChipStyle(conv?.channel_type).label}
              </span>
              {/* Chip da instância — ajuda quando "todas as instâncias" */}
              {conv?.instance?.name && (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium truncate max-w-[160px]"
                  style={{
                    background: "rgba(0,212,106,0.06)",
                    color: "#00d46a",
                    border: "1px solid rgba(0,212,106,0.18)",
                  }}
                  title={`Instância: ${conv.instance.name}`}
                >
                  {conv.instance.name}
                </span>
              )}
              <span className="truncate" title={conv?.channel_key}>{conv?.channel_key}</span>
              <span style={{ color: "hsl(240 8% 35%)" }}>·</span>
              {conv?.assigned_user?.name ? (
                <span>responsável {conv.assigned_user.name}</span>
              ) : (
                <span style={{ color: "hsl(240 8% 42%)" }}>sem responsável</span>
              )}
            </div>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto px-5 py-6"
          style={{ background: "hsl(240 18% 5.5%)" }}
        >
          {timeline.length === 0 ? (
            <div
              className="flex h-full items-center justify-center text-sm"
              style={{ color: "hsl(240 8% 48%)" }}
            >
              Sem mensagens ainda.
            </div>
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-3">
              <div ref={topSentinelRef} />
              {timelineQ.isFetchingNextPage && (
                <div
                  className="mx-auto my-1 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px]"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: "hsl(240 8% 52%)",
                  }}
                >
                  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Carregando mensagens antigas…
                </div>
              )}
              {!timelineQ.hasNextPage && timeline.length >= TIMELINE_PAGE && (
                <div
                  className="mx-auto my-1 text-[10px]"
                  style={{ color: "hsl(240 8% 38%)" }}
                >
                  Início da conversa
                </div>
              )}
              {timeline.map((e) => (
                <li key={`${e.kind}-${e.id}`}>
                  {e.kind === "message" ? (
                    <MessageBubble
                      m={e.payload as MessagePayload}
                      onPatch={(patch) =>
                        patchMsg.mutate({ msgId: (e.payload as MessagePayload).id, patch })
                      }
                      onOpenViewer={setViewerSource}
                    />
                  ) : e.kind === "note" ? (
                    <NoteCard n={e.payload as NotePayload} />
                  ) : (
                    <EventLine e={e.payload as EventPayload} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <Composer
          wsId={wsId}
          conversationId={conversationId}
          instanceId={conv?.instance_id}
          canSend={canSend}
          canNote={canNote}
          onSendMessage={(body) => send.mutate(body)}
          onSendNote={(body) => note.mutate(body)}
          isSending={send.isPending}
          isNoting={note.isPending}
        />
      </section>

      {/* Sidepanel with actions + contact */}
      <aside className="hidden w-80 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:flex">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Contato</h2>
          <div className="mt-2">
            <div className="font-medium">{conv?.contact?.name || "—"}</div>
            <div className="text-sm text-zinc-500">{conv?.contact?.phone || conv?.channel_key}</div>
            {conv?.contact?.email && <div className="text-sm text-zinc-500">{conv.contact.email}</div>}
          </div>
        </div>

        <div className="space-y-1 border-b border-zinc-200 p-3 dark:border-zinc-800">
          {!conv?.assigned_user_id && canAssign && (
            <ActionRow onClick={() => claim.mutate()} icon={<UserCheck className="h-4 w-4" />} label="Atender (atribuir a mim)" tone="primary" />
          )}
          {conv?.assigned_user_id && canAssign && (
            <ActionRow onClick={() => unassign.mutate()} icon={<UserX className="h-4 w-4" />} label="Remover atribuição" />
          )}
          {canTransfer && (
            <ActionRow
              onClick={() => setTransferOpen(true)}
              icon={<ArrowRightLeft className="h-4 w-4" />}
              label="Transferir…"
            />
          )}
          {canSend && conv?.channel_type === "waba" && conv?.instance_id && (
            <ActionRow
              onClick={() => setTemplateOpen(true)}
              icon={<Sparkles className="h-4 w-4" />}
              label="Enviar template aprovado"
            />
          )}
          {canClose && conv?.status === "resolved" && (
            <ActionRow
              onClick={() => csatApi.send(wsId as string, conversationId).then(() => toast.success("CSAT enviado"))}
              icon={<Star className="h-4 w-4" />}
              label="Enviar pesquisa CSAT"
            />
          )}
          {conv?.status !== "resolved" && conv?.status !== "closed" && canClose && (
            <ActionRow onClick={() => resolve.mutate()} icon={<CheckCircle2 className="h-4 w-4" />} label="Marcar como resolvido" />
          )}
          {conv?.status === "resolved" && canClose && (
            <ActionRow onClick={() => close.mutate()} icon={<CheckCircle2 className="h-4 w-4" />} label="Encerrar definitivamente" />
          )}
          {(conv?.status === "resolved" || conv?.status === "closed") && canReopen && (
            <ActionRow onClick={() => reopen.mutate()} icon={<RotateCcw className="h-4 w-4" />} label="Reabrir" />
          )}
          {conv?.status === "open" && canSnooze && (
            <ActionRow
              onClick={() => {
                const hours = Number(prompt("Em quantas horas desnoozear?", "4") || 4);
                if (hours > 0) {
                  const iso = new Date(Date.now() + hours * 3600_000).toISOString();
                  snooze.mutate(iso);
                }
              }}
              icon={<Clock3 className="h-4 w-4" />}
              label="Soneca"
            />
          )}
          {canUpdate && conv && (
            <ActionRow
              onClick={() => bot.mutate(!conv.is_bot_active)}
              icon={conv.is_bot_active ? <BotOff className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              label={conv.is_bot_active ? "Desligar bot nesta conversa" : "Ligar bot nesta conversa"}
            />
          )}
        </div>

        <div className="flex-1 overflow-auto p-5 text-xs text-zinc-500">
          <div className="mb-2 font-semibold uppercase tracking-wide">Detalhes</div>
          <dl className="space-y-1">
            <DRow label="Aberto em" value={conv?.created_at && relativeTime(conv.created_at)} />
            <DRow label="Última mensagem" value={conv?.last_message_at && relativeTime(conv.last_message_at)} />
            <DRow label="Prioridade" value={conv?.priority} />
            <DRow label="Canal" value={conv?.channel_type} />
            <DRow label="Fila" value={queuesQ.data?.items.find((q) => q.id === conv?.queue_id)?.name ?? "—"} />
          </dl>
          <div className="mt-4 rounded-md border border-dashed border-zinc-300 p-3 text-[11px] dark:border-zinc-700">
            <div className="font-semibold uppercase tracking-wide text-zinc-500">Atalhos</div>
            <dl className="mt-1 space-y-0.5 text-zinc-500">
              <div className="flex justify-between"><span>Atender</span><kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">A</kbd></div>
              <div className="flex justify-between"><span>Transferir</span><kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">T</kbd></div>
              <div className="flex justify-between"><span>Soneca</span><kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">S</kbd></div>
              <div className="flex justify-between"><span>Resolver</span><kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">E</kbd></div>
              <div className="flex justify-between"><span>Resposta rápida</span><kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">/</kbd></div>
            </dl>
          </div>
        </div>
      </aside>

      {transferOpen && wsId && (
        <TransferDialog
          wsId={wsId}
          conversationId={conversationId}
          onClose={() => setTransferOpen(false)}
          onSuccess={refresh}
        />
      )}

      {templateOpen && wsId && conv?.instance_id && (
        <TemplatePicker
          wsId={wsId}
          conversationId={conversationId}
          instanceId={conv.instance_id}
          onClose={() => setTemplateOpen(false)}
          onSent={refresh}
        />
      )}

      {/* Lightbox de mídia — abre quando agente clica em foto/vídeo/audio/doc.
          Renderizado via portal pra ficar fora do split layout. */}
      <MediaViewer source={viewerSource} onClose={() => setViewerSource(null)} />
    </div>
  );
}

// TransferDialog lets the agent transfer a conversation to a Queue, a Team,
// or a specific User. Team/User variants fall back to POST /transfer with the
// appropriate body since the backend handler accepts any combination.
function TransferDialog({
  wsId, conversationId, onClose, onSuccess,
}: {
  wsId: string;
  conversationId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tab, setTab] = useState<"queue" | "team" | "user">("queue");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string>("");
  const queuesQ = useQuery({
    queryKey: ["queues-for-transfer", wsId],
    queryFn: () => queuesApi.list(wsId).then((r) => r.data as { items: Array<{ id: string; name: string }> }),
  });
  const teamsQ = useQuery({
    queryKey: ["teams-for-transfer", wsId],
    queryFn: () => teamsApi.list(wsId).then((r) => r.data as { items: Array<{ id: string; name: string }> }),
    enabled: tab === "team",
  });
  const membersQ = useQuery({
    queryKey: ["workspace-members-for-transfer", wsId],
    queryFn: () =>
      workspacesApi.listMembers(wsId).then((r) => {
        const raw = r.data as { members?: Array<{ user_id: string; user?: { name: string; email: string } }> } | Array<{ user_id: string; user?: { name: string; email: string } }>;
        return Array.isArray(raw) ? raw : raw.members ?? [];
      }),
    enabled: tab === "user",
  });

  useEffect(() => setSelected(""), [tab]);

  const submit = async () => {
    if (!selected) return;
    try {
      if (tab === "queue") await conversationsApi.transfer(wsId, conversationId, { queue_id: selected, note });
      else if (tab === "team") await conversationsApi.transfer(wsId, conversationId, { team_id: selected, note });
      else await conversationsApi.transfer(wsId, conversationId, { user_id: selected, note });
      toast.success("Transferido");
      onSuccess();
      onClose();
    } catch {
      toast.error("Falha ao transferir");
    }
  };

  const options: Array<{ id: string; label: string; hint?: string }> =
    tab === "queue"
      ? (queuesQ.data?.items ?? []).map((q) => ({ id: q.id, label: q.name }))
      : tab === "team"
      ? (teamsQ.data?.items ?? []).map((t) => ({ id: t.id, label: t.name }))
      : (membersQ.data ?? []).map((m) => ({
          id: m.user_id,
          label: m.user?.name || m.user?.email || m.user_id.slice(0, 8),
          hint: m.user?.email,
        }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 uniq-fade-in"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl uniq-scale-in"
        style={{
          background: "hsl(240 18% 6%)",
          border: "1px solid hsl(240 12% 14%)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid hsl(240 12% 16%)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
            Transferir atendimento
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-white/5"
            style={{ color: "hsl(240 8% 48%)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex" style={{ borderBottom: "1px solid hsl(240 12% 16%)" }}>
          {(["queue", "team", "user"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 px-4 py-2 text-xs font-medium"
              style={
                tab === t
                  ? {
                      color: "#00d46a",
                      borderBottom: "2px solid #00d46a",
                      marginBottom: "-1px",
                    }
                  : {
                      color: "hsl(240 8% 52%)",
                      borderBottom: "2px solid transparent",
                      marginBottom: "-1px",
                    }
              }
            >
              {t === "queue" ? "Fila" : t === "team" ? "Equipe" : "Agente"}
            </button>
          ))}
        </div>
        <div className="max-h-80 overflow-auto">
          {options.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500">Sem opções disponíveis.</div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => setSelected(o.id)}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      selected === o.id ? "bg-blue-500/10" : ""
                    }`}
                  >
                    <span>
                      <span className="font-medium">{o.label}</span>
                      {o.hint && <span className="ml-2 text-xs text-zinc-500">{o.hint}</span>}
                    </span>
                    {selected === o.id && <span className="text-xs text-blue-600 dark:text-blue-400">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <label className="block text-xs font-medium text-zinc-500">Motivo (opcional)</label>
          <textarea
            className="mt-1 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contexto para quem receber"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!selected}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Transferir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  m, onPatch, onOpenViewer,
}: {
  m: MessagePayload;
  onPatch?: (patch: { is_pinned?: boolean; is_favorite?: boolean }) => void;
  onOpenViewer: (source: MediaViewerSource) => void;
}) {
  const isOut = m.direction === "out";
  const parsed = parseMessageContent(m.content);
  const body = parsed.caption || parsed.text;

  // Reaction — bolha compacta só com emoji grande
  if (m.type === "reaction") {
    return (
      <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
        <div
          className="rounded-2xl px-3 py-1 text-2xl uniq-slide-up"
          style={{
            background: isOut ? "rgba(0,212,106,0.12)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${isOut ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.08)"}`,
          }}
        >
          {parsed.text || "👍"}
        </div>
      </div>
    );
  }

  // Mídia pura (image/video/audio sem caption) → render SEM bubble.
  // Bordas finas com cor da direção indicam emissor (verde Uniq) vs
  // receptor (cinza). Mais limpo, dá destaque visual à mídia.
  // Documentos sempre vão pra dentro do bubble (são cards verticais).
  const isPureMedia =
    (m.type === "image" || m.type === "video" || m.type === "audio") &&
    !!parsed.url &&
    !body;

  if (isPureMedia) {
    return (
      <div className={`group relative flex ${isOut ? "justify-end" : "justify-start"}`}>
        <div
          className="relative max-w-[80%] uniq-slide-up"
          style={{
            // Borda colorida fina indica direção sem precisar do bubble inteiro
            borderRadius: 14,
            padding: 3,
            background: isOut
              ? "linear-gradient(135deg, rgba(0,212,106,0.35), rgba(0,212,106,0.15))"
              : "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
          }}
        >
          <div
            className="overflow-hidden"
            style={{
              borderRadius: 12,
              background: "hsl(240 18% 5%)",
            }}
          >
            <MediaBody type={m.type} parsed={parsed} onOpenViewer={onOpenViewer} />
          </div>

          {/* Pin / favorite badges — abs positioned mantém limpo */}
          {m.is_pinned && (
            <span
              className="absolute -top-2 left-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{ background: "#00d46a", color: "#03170a" }}
              title="Fixada"
            >
              <Pin className="h-2.5 w-2.5" /> fixada
            </span>
          )}
          {m.is_favorite && !m.is_pinned && (
            <span
              className="absolute -top-2 right-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px]"
              style={{ background: "#f59e0b", color: "#1f1300" }}
              title="Favoritada"
            >
              <Star className="h-2.5 w-2.5" /> favorita
            </span>
          )}

          {/* Sender name (grupo) + timestamp em rodapé compacto */}
          <div
            className="flex items-center justify-between gap-2 mt-1.5 px-1 text-[10px]"
            style={{ color: "hsl(240 8% 50%)" }}
          >
            {!isOut && m.sender_name ? (
              <span style={{ color: "#00d46a", fontWeight: 500 }}>{m.sender_name}</span>
            ) : <span />}
            <span className="flex items-center gap-1">
              {relativeTime(m.created_at)}
              {isOut && <StatusTicks status={m.status} />}
            </span>
          </div>

          {/* Hover actions */}
          {onPatch && (
            <div
              className={`pointer-events-none absolute -top-3 flex gap-0.5 rounded-full px-1 py-0.5 opacity-0 shadow-lg transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${
                isOut ? "right-2" : "left-2"
              }`}
              style={{
                background: "hsl(240 18% 6%)",
                border: "1px solid hsl(240 12% 16%)",
              }}
            >
              <button
                type="button"
                onClick={() => onPatch({ is_pinned: !m.is_pinned })}
                className="rounded-full p-1 hover:bg-white/10"
                title={m.is_pinned ? "Desfixar" : "Fixar"}
                style={{ color: m.is_pinned ? "#00d46a" : "hsl(240 8% 62%)" }}
              >
                <Pin className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onPatch({ is_favorite: !m.is_favorite })}
                className="rounded-full p-1 hover:bg-white/10"
                title={m.is_favorite ? "Remover favorito" : "Favoritar"}
                style={{ color: m.is_favorite ? "#f59e0b" : "hsl(240 8% 62%)" }}
              >
                <Star className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`group relative flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className="relative max-w-[80%] rounded-2xl px-3 py-2 shadow-sm uniq-slide-up"
        style={
          isOut
            ? {
                background: "rgba(0,212,106,0.12)",
                border: `1px solid ${m.is_pinned ? "#00d46a" : "rgba(0,212,106,0.25)"}`,
                color: "hsl(240 15% 92%)",
                borderBottomRightRadius: 6,
              }
            : {
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${m.is_pinned ? "#00d46a" : "rgba(255,255,255,0.08)"}`,
                color: "hsl(240 15% 90%)",
                borderBottomLeftRadius: 6,
              }
        }
      >
        {m.is_pinned && (
          <span
            className="absolute -top-2 left-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
            style={{ background: "#00d46a", color: "#03170a" }}
            title="Fixada"
          >
            <Pin className="h-2.5 w-2.5" /> fixada
          </span>
        )}
        {m.is_favorite && !m.is_pinned && (
          <span
            className="absolute -top-2 right-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px]"
            style={{ background: "#f59e0b", color: "#1f1300" }}
            title="Favoritada"
          >
            <Star className="h-2.5 w-2.5" /> favorita
          </span>
        )}

        {!isOut && m.sender_name && (
          <div
            className="mb-0.5 text-[11px] font-medium"
            style={{ color: "#00d46a" }}
          >
            {m.sender_name}
          </div>
        )}

        <MediaBody type={m.type} parsed={parsed} onOpenViewer={onOpenViewer} />

        <div
          className="mt-1 flex items-center justify-end gap-1 text-[10px]"
          style={{ color: isOut ? "rgba(255,255,255,0.55)" : "hsl(240 8% 44%)" }}
        >
          <span>{relativeTime(m.created_at)}</span>
          {isOut && <StatusTicks status={m.status} />}
        </div>

        {onPatch && (
          <div
            className={`pointer-events-none absolute -top-3 flex gap-0.5 rounded-full px-1 py-0.5 opacity-0 shadow-lg transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${
              isOut ? "right-2" : "left-2"
            }`}
            style={{
              background: "hsl(240 18% 6%)",
              border: "1px solid hsl(240 12% 16%)",
            }}
          >
            <button
              type="button"
              onClick={() => onPatch({ is_pinned: !m.is_pinned })}
              className="rounded-full p-1 hover:bg-white/10"
              title={m.is_pinned ? "Desfixar" : "Fixar"}
              style={{ color: m.is_pinned ? "#00d46a" : "hsl(240 8% 62%)" }}
            >
              <Pin className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onPatch({ is_favorite: !m.is_favorite })}
              className="rounded-full p-1 hover:bg-white/10"
              title={m.is_favorite ? "Remover favorito" : "Favoritar"}
              style={{ color: m.is_favorite ? "#f59e0b" : "hsl(240 8% 62%)" }}
            >
              <Star className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// MediaBody — renderiza o conteúdo conforme msg.type. Aceita tanto o formato
// legacy (content JSON-encoded string) quanto o novo ({url, mime_type,
// filename, caption, error}). Mantém paridade total com o inbox clássico.
//
// Imagens, vídeos e documentos abrem no MediaViewer (lightbox in-app) em vez
// de nova aba. Áudios renderizam inline (pequeno) E também ganham um botão
// de "expandir" que abre o viewer com player maior.
function MediaBody({
  type, parsed, onOpenViewer,
}: {
  type: string;
  parsed: ParsedContent;
  onOpenViewer: (source: MediaViewerSource) => void;
}) {
  const { text, url, filename, caption, error, latitude, longitude, mimeType } = parsed;
  const body = caption || text;

  if (type === "image") {
    if (url) {
      return (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() =>
              onOpenViewer({ type: "image", url, filename, mimeType, caption: body })
            }
            className="block rounded-lg overflow-hidden transition-opacity hover:opacity-90 focus-visible:opacity-90"
            aria-label="Abrir imagem"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={filename || "imagem"}
              className="max-h-[280px] max-w-[280px] rounded-lg object-cover cursor-zoom-in"
            />
          </button>
          {body && <Text text={body} />}
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<ImageIcon className="h-4 w-4" />} label={body || "Imagem"} />;
  }

  if (type === "video") {
    if (url) {
      return (
        <div className="flex flex-col gap-1.5">
          {/* Preview clicável — overlay com play. Click abre lightbox.
              Mantém native controls inline também caso o user prefira. */}
          <button
            type="button"
            onClick={() =>
              onOpenViewer({ type: "video", url, filename, mimeType, caption: body })
            }
            className="relative block group"
            aria-label="Abrir vídeo"
          >
            <video
              src={url}
              className="max-w-[320px] rounded-lg"
              preload="metadata"
              muted
            />
            <span
              className="absolute inset-0 flex items-center justify-center rounded-lg transition-colors group-hover:bg-black/30"
              style={{ background: "rgba(0,0,0,0.2)" }}
            >
              <span
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
              >
                <svg className="h-6 w-6 ml-1" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
          {body && <Text text={body} />}
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<ImageIcon className="h-4 w-4" />} label={body || "Vídeo"} />;
  }

  if (type === "audio") {
    if (url) {
      // Áudio fica inline (player nativo é compacto e funcional).
      // Botão pequeno expande pro lightbox quem quiser.
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <audio src={url} controls className="max-w-[260px]" />
            <button
              type="button"
              onClick={() =>
                onOpenViewer({ type: "audio", url, filename, mimeType, caption: body })
              }
              title="Abrir em tela cheia"
              className="rounded-md p-1 transition-colors hover:bg-white/5"
              style={{ color: "hsl(240 8% 50%)" }}
            >
              <Maximize2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<Mic className="h-4 w-4" />} label={body || "Áudio"} />;
  }

  if (type === "document") {
    if (url) {
      return (
        <button
          type="button"
          onClick={() =>
            onOpenViewer({ type: "document", url, filename, mimeType, caption: body })
          }
          className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-white/5 text-left w-full"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <FileText className="h-5 w-5 flex-shrink-0" style={{ color: "hsl(240 8% 70%)" }} />
          <span className="truncate text-xs flex-1">{filename || "Documento"}</span>
          <Maximize2Icon className="h-3 w-3 flex-shrink-0" style={{ color: "hsl(240 8% 50%)" }} />
        </button>
      );
    }
    return <IconFallback icon={<FileText className="h-4 w-4" />} label={body || "Documento"} />;
  }

  if (type === "location") {
    if (latitude != null && longitude != null) {
      const mapsURL = `https://www.google.com/maps?q=${latitude},${longitude}`;
      return (
        <a
          href={mapsURL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-white/5"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <MapPin className="h-4 w-4" style={{ color: "#00d46a" }} />
          <span className="text-xs">
            {latitude.toFixed(4)}, {longitude.toFixed(4)}
            {body ? ` · ${body}` : ""}
          </span>
        </a>
      );
    }
    return <IconFallback icon={<MapPin className="h-4 w-4" />} label={body || "Localização"} />;
  }

  if (type === "revoke") {
    return (
      <span className="italic" style={{ color: "hsl(240 8% 50%)" }}>
        Mensagem apagada
      </span>
    );
  }

  // text (default)
  return <Text text={body || "—"} />;
}

function Text({ text }: { text: string }) {
  return (
    <p
      className="text-sm"
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {text}
    </p>
  );
}

function IconFallback({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm opacity-80">
      {icon}
      <span>{label}</span>
    </span>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px]" style={{ color: "#ef4444" }}>
      <AlertCircle className="h-3 w-3" />
      {text}
    </span>
  );
}

function StatusTicks({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "failed") {
    return <AlertCircle className="h-3 w-3" style={{ color: "#ef4444" }} />;
  }
  if (status === "read") {
    return <CheckCheck className="h-3 w-3" style={{ color: "#00d46a" }} />;
  }
  if (status === "delivered") {
    return <CheckCheck className="h-3 w-3" />;
  }
  if (status === "sent") {
    return <Check className="h-3 w-3" />;
  }
  if (status === "pending") {
    return <Clock3 className="h-3 w-3" style={{ opacity: 0.7 }} />;
  }
  return null;
}

function NoteCard({ n }: { n: NotePayload }) {
  return (
    <div className="mx-auto flex max-w-[90%] items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/30">
      <StickyNote className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1">
        <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
          {n.author?.name ?? "Nota interna"} · {relativeTime(n.created_at)}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-amber-900 dark:text-amber-100">{n.body}</p>
      </div>
    </div>
  );
}

function EventLine({ e }: { e: EventPayload }) {
  const label = EVENT_LABELS[e.event_type] ?? e.event_type;
  const Icon = e.event_type === "sla_breached" ? AlertTriangle : Bot;
  return (
    <div className="mx-auto flex max-w-[70%] items-center justify-center gap-2 text-xs text-zinc-400">
      <Icon className={`h-3 w-3 ${e.event_type === "sla_breached" ? "text-red-500" : ""}`} />
      <span>{label}</span>
      <span>·</span>
      <span>{relativeTime(e.created_at)}</span>
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  assignment_changed: "Atribuição alterada",
  status_changed: "Status atualizado",
  queue_changed: "Fila alterada",
  transferred: "Transferido",
  snoozed: "Em soneca",
  unsnoozed: "Retornou da soneca",
  reopened: "Reaberto",
  bot_handoff: "Transferência bot ↔ humano",
  sla_breached: "SLA rompido",
  csat_sent: "CSAT enviado",
  csat_answered: "CSAT respondido",
  priority_changed: "Prioridade alterada",
  note: "Nota interna registrada",
};

interface ParsedContent {
  text?: string;
  url?: string;
  filename?: string;
  caption?: string;
  error?: string;
  mimeType?: string;
  latitude?: number;
  longitude?: number;
}

// parseMessageContent normaliza os diferentes formatos que MessageLog.Content
// pode carregar, herdados do caminho legacy:
//   "string simples"                 → texto puro
//   "\"string json-encoded\""        → texto puro depois do unwrap
//   {text, caption, url, mime_type,  → mídia estruturada
//    filename, error, latitude, …}
function parseMessageContent(raw: string): ParsedContent {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return { text: parsed };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        text: parsed.text ?? parsed.body,
        url: parsed.url,
        filename: parsed.filename,
        caption: parsed.caption,
        error: parsed.error,
        mimeType: parsed.mime_type,
        latitude: typeof parsed.latitude === "number" ? parsed.latitude : undefined,
        longitude: typeof parsed.longitude === "number" ? parsed.longitude : undefined,
      };
    }
  } catch {
    /* not JSON — raw text */
  }
  return { text: raw };
}

function Composer({
  wsId, conversationId, instanceId, canSend, canNote, onSendMessage, onSendNote, isSending, isNoting,
}: {
  wsId?: string;
  conversationId: string;
  instanceId?: string;
  canSend: boolean;
  canNote: boolean;
  onSendMessage: (body: string) => void;
  onSendNote: (body: string) => void;
  isSending: boolean;
  isNoting: boolean;
}) {
  const [mode, setMode] = useState<"message" | "note">("message");
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftKey = `inbox:draft:${conversationId}:${mode}`;

  // Draft persistence — survive accidental reloads
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setText(saved);
      else setText("");
    } catch {
      /* localStorage disabled */
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      /* noop */
    }
  }, [text, draftKey]);

  // Focus composer when `/` is pressed while idle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      textareaRef.current?.focus();
      setText((prev) => (prev.length ? prev : "/"));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Quick reply picker — when mode=message and text starts with `/xxx`, query the API.
  const currentShortcut = useMemo(() => {
    if (mode !== "message") return "";
    const t = text.trimStart();
    if (!t.startsWith("/")) return "";
    // Only trigger while the user is still typing the shortcut (no spaces)
    if (t.indexOf(" ") !== -1) return "";
    return t;
  }, [mode, text]);

  const picker = useQuery({
    queryKey: ["quick-replies-search", wsId, currentShortcut],
    queryFn: () =>
      quickRepliesApi.search(wsId as string, currentShortcut).then((r) =>
        (r.data as { items: Array<{ id: string; shortcut: string; title?: string; body: string }> }).items ?? []
      ),
    enabled: !!wsId && currentShortcut.length >= 1 && mode === "message",
    staleTime: 5_000,
  });

  const [pickerIndex, setPickerIndex] = useState(0);
  useEffect(() => setPickerIndex(0), [currentShortcut]);

  const applyQuickReply = (qr: { id: string; body: string }) => {
    setText(qr.body);
    if (wsId) quickRepliesApi.use(wsId, qr.id).catch(() => {});
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const disabled =
    (!canSend && mode === "message") || (!canNote && mode === "note") || text.trim() === "";

  const submit = () => {
    if (disabled) return;
    const body = text.trim();
    if (mode === "message") onSendMessage(body);
    else onSendNote(body);
    setText("");
    try { localStorage.removeItem(draftKey); } catch { /* noop */ }
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const pickerItems = picker.data ?? [];
  const pickerOpen = mode === "message" && currentShortcut.length >= 1 && pickerItems.length > 0;

  // ── Anexos (imagem, áudio, vídeo, documento) ─────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; preview?: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const onPickFile = () => fileInputRef.current?.click();

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    if (!instanceId) {
      toast.error("Anexar requer instância conectada");
      return;
    }
    // Preview só para imagens; outros tipos usam ícone no bubble de preview
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    setPending({ file, preview });
  };

  const clearPending = () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setPending(null);
  };

  const sendAttachment = async () => {
    if (!pending || !wsId || !instanceId) return;
    const { file } = pending;
    const caption = text.trim();
    setUploading(true);
    try {
      const up = await mediaUploadApi.upload(instanceId, file);
      const data = up.data as { url: string; mime_type?: string };
      const url = data.url;
      const mime = data.mime_type || file.type || "application/octet-stream";
      const type = inferMediaType(file, mime);
      await conversationsApi.sendMessage(wsId, conversationId, {
        type,
        media_url: url,
        media_mime: mime,
        caption: caption || undefined,
        filename: type === "document" ? file.name : undefined,
      });
      setText("");
      try { localStorage.removeItem(draftKey); } catch { /* noop */ }
      clearPending();
    } catch {
      toast.error("Falha ao enviar anexo");
    } finally {
      setUploading(false);
    }
  };

  // ── Typing indicator ─────────────────────────────────────────────────────
  // Enquanto o agente digita no modo "message", envia typing=true ao canal
  // a cada 3s. Quando o composer zera ou o usuário para de digitar por >3s,
  // dispara um único typing=false.
  const typingActiveRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushTyping = (active: boolean) => {
    if (!wsId) return;
    typingActiveRef.current = active;
    conversationsApi.sendTyping(wsId, conversationId, active).catch(() => {});
  };

  useEffect(() => {
    if (mode !== "message") {
      if (typingActiveRef.current) pushTyping(false);
      return;
    }
    if (text.trim() === "") {
      if (typingActiveRef.current) pushTyping(false);
      return;
    }
    if (!typingActiveRef.current) pushTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => pushTyping(false), 3500);
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode, wsId, conversationId]);

  useEffect(() => {
    // cleanup on unmount — garante que não deixa o "digitando..." preso
    return () => {
      if (typingActiveRef.current) pushTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accentBg = mode === "note" ? "#f59e0b" : "#00d46a";
  const accentFg = mode === "note" ? "#1f1300" : "#03170a";
  const composerBg = mode === "note" ? "rgba(245,158,11,0.06)" : "hsl(240 18% 6.5%)";

  const hasAttachment = !!pending;

  return (
    <div
      className="p-3"
      style={{
        background: composerBg,
        borderTop: "1px solid hsl(240 12% 16%)",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept="image/*,video/*,audio/*,application/pdf,application/*"
        onChange={onFileSelected}
      />

      {/* Mode tabs */}
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <button
          onClick={() => setMode("message")}
          className="rounded-md px-2 py-1 font-medium transition-colors"
          style={
            mode === "message"
              ? { background: "#00d46a", color: "#03170a" }
              : { color: "hsl(240 8% 52%)" }
          }
          disabled={!canSend}
          type="button"
        >
          Mensagem
        </button>
        <button
          onClick={() => setMode("note")}
          className="rounded-md px-2 py-1 font-medium transition-colors"
          style={
            mode === "note"
              ? { background: "#f59e0b", color: "#1f1300" }
              : { color: "hsl(240 8% 52%)" }
          }
          disabled={!canNote}
          type="button"
        >
          Nota interna
        </button>
        <span className="ml-auto text-[11px]" style={{ color: "hsl(240 8% 38%)" }}>
          {mode === "message"
            ? "Enter envia · Shift+Enter quebra linha · / resposta rápida"
            : "Nota visível só para a equipe"}
        </span>
      </div>

      {/* Pending attachment preview */}
      {hasAttachment && pending && (
        <div
          className="mb-2 flex items-center gap-3 rounded-lg p-2"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {pending.preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={pending.preview} alt="" className="h-12 w-12 rounded object-cover" />
          ) : (
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded"
              style={{ background: "rgba(0,212,106,0.08)" }}
            >
              {pending.file.type.startsWith("audio/") ? (
                <Mic className="h-5 w-5" style={{ color: "#00d46a" }} />
              ) : pending.file.type.startsWith("video/") ? (
                <ImageIcon className="h-5 w-5" style={{ color: "#00d46a" }} />
              ) : (
                <FileText className="h-5 w-5" style={{ color: "#00d46a" }} />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm" style={{ color: "hsl(240 15% 90%)" }}>
              {pending.file.name}
            </div>
            <div className="text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>
              {humanSize(pending.file.size)} · {pending.file.type || "desconhecido"}
            </div>
          </div>
          <button
            type="button"
            onClick={clearPending}
            disabled={uploading}
            className="rounded-md p-1.5 disabled:opacity-40 hover:bg-white/5"
            style={{ color: "hsl(240 8% 48%)" }}
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={sendAttachment}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            style={{ background: accentBg, color: accentFg }}
          >
            {uploading ? "Enviando…" : "Enviar anexo"}
          </button>
        </div>
      )}

      <div className="relative">
        {pickerOpen && (
          <div
            className="absolute bottom-full left-0 right-20 mb-2 max-h-60 overflow-auto rounded-lg shadow-xl"
            style={{
              background: "hsl(240 18% 6%)",
              border: "1px solid hsl(240 12% 14%)",
            }}
          >
            <div
              className="flex items-center gap-2 border-b px-3 py-1.5 text-[11px]"
              style={{
                borderColor: "hsl(240 12% 16%)",
                color: "hsl(240 8% 52%)",
              }}
            >
              <Smile className="h-3.5 w-3.5" /> Respostas rápidas · {pickerItems.length}
            </div>
            <ul>
              {pickerItems.map((qr, i) => (
                <li key={qr.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setPickerIndex(i)}
                    onClick={() => applyQuickReply(qr)}
                    className="flex w-full items-start gap-3 px-3 py-2 text-left"
                    style={{
                      background: i === pickerIndex ? "rgba(0,212,106,0.08)" : "transparent",
                    }}
                  >
                    <span
                      className="mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px]"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        color: "hsl(240 15% 85%)",
                      }}
                    >
                      {qr.shortcut || "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      {qr.title && (
                        <div className="text-xs font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                          {qr.title}
                        </div>
                      )}
                      <div className="line-clamp-2 text-xs" style={{ color: "hsl(240 8% 52%)" }}>
                        {qr.body}
                      </div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onPickFile}
            disabled={!canSend || mode !== "message" || !instanceId || uploading}
            title={instanceId ? "Anexar arquivo" : "Instância não disponível"}
            className="flex h-10 w-10 items-center justify-center rounded-md transition-colors disabled:opacity-40"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "hsl(240 8% 52%)",
            }}
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <textarea
            ref={textareaRef}
            className="min-h-[44px] max-h-40 flex-1 resize-y rounded-md px-3 py-2 text-sm outline-none"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${mode === "note" ? "rgba(245,158,11,0.35)" : "hsl(240 12% 16%)"}`,
              color: "hsl(240 15% 90%)",
            }}
            placeholder={mode === "message"
              ? (hasAttachment ? "Legenda do anexo (opcional)…" : "Digite sua mensagem… (/ para respostas rápidas)")
              : "Registre uma nota interna…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (pickerOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setPickerIndex((i) => {
                  if (e.key === "ArrowDown") return Math.min(i + 1, pickerItems.length - 1);
                  return Math.max(i - 1, 0);
                });
                return;
              }
              if (pickerOpen && e.key === "Tab") {
                e.preventDefault();
                const selected = pickerItems[pickerIndex];
                if (selected) applyQuickReply(selected);
                return;
              }
              if (e.key === "Escape" && pickerOpen) {
                e.preventDefault();
                setText("");
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                if (pickerOpen) {
                  e.preventDefault();
                  const selected = pickerItems[pickerIndex];
                  if (selected) applyQuickReply(selected);
                  return;
                }
                e.preventDefault();
                if (hasAttachment) sendAttachment();
                else submit();
              }
            }}
          />
          <button
            onClick={hasAttachment ? sendAttachment : submit}
            disabled={
              hasAttachment
                ? uploading
                : disabled || isSending || isNoting
            }
            className="flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: accentBg, color: accentFg }}
            type="button"
          >
            {mode === "note" ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {hasAttachment ? (uploading ? "Enviando…" : "Enviar") : (mode === "note" ? "Adicionar" : "Enviar")}
          </button>
        </div>
      </div>
    </div>
  );
}

function inferMediaType(file: File, mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/") || file.type.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || file.type.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/") || file.type.startsWith("video/")) return "video";
  return "document";
}

function humanSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function ActionRow({
  onClick, icon, label, tone,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: "primary";
}) {
  const cls = tone === "primary"
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${cls}`}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function DRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-700 dark:text-zinc-300">{value || "—"}</dd>
    </div>
  );
}
