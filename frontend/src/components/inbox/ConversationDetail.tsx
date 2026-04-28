"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Send, StickyNote, CheckCircle2, Clock3, RotateCcw,
  UserCheck, UserX, ArrowRightLeft, Bot, BotOff, Lock, AlertTriangle,
  Smile, X, Star, Mic, Image as ImageIcon, FileText, MapPin, Check,
  CheckCheck, AlertCircle, Paperclip, Pin, Sparkles, Users as UsersIcon,
  Maximize2 as Maximize2Icon, Phone, Video as VideoIcon, PhoneMissed,
  UserPlus, MessageSquare, ListChecks, CornerUpLeft, CornerUpRight,
  Pencil, Trash2, Search, Info, Bell, BellOff,
} from "lucide-react";
import { AudioPlayer } from "@/components/inbox/AudioPlayer";
import { AudioRecorderButton } from "@/components/inbox/AudioRecorderButton";
import { MediaViewer, type MediaViewerSource } from "@/components/inbox/MediaViewer";
import { conversationsApi, queuesApi, quickRepliesApi, teamsApi, workspacesApi, csatApi, mediaUploadApi, crmContactsApi, linkPreviewApi } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  is_pinned?: boolean;
  is_muted?: boolean;
  reopen_count: number;
  first_response_at?: string | null;
  created_at: string;
}

// Cor + label por canal — visual hint pra que o atendente saiba de onde
// veio a mensagem sem ler texto.
function channelChipStyle(channel?: string): { label: string; bg: string; color: string; border: string } {
  switch ((channel || "").toLowerCase()) {
    case "whatsapp":  return { label: "WhatsApp",  bg: "rgba(37,211,102,0.08)", color: "#25d366", border: "rgba(37,211,102,0.2)" };
    case "waba":      return { label: "WhatsApp API", bg: "rgba(0,136,255,0.08)", color: "#0088ff", border: "rgba(0,136,255,0.22)" };
    case "instagram": return { label: "Instagram", bg: "rgba(225,48,108,0.08)", color: "#e1306c", border: "rgba(225,48,108,0.2)" };
    case "facebook":  return { label: "Facebook",  bg: "rgba(24,119,242,0.08)", color: "#1877f2", border: "rgba(24,119,242,0.2)" };
    case "telegram":  return { label: "Telegram",  bg: "rgba(34,158,217,0.08)", color: "#229ed9", border: "rgba(34,158,217,0.2)" };
    case "linkedin":  return { label: "LinkedIn",  bg: "rgba(10,102,194,0.08)", color: "#0a66c2", border: "rgba(10,102,194,0.2)" };
    case "tiktok":    return { label: "TikTok",    bg: "rgba(255,0,80,0.08)",   color: "#ff0050", border: "rgba(255,0,80,0.2)" };
    case "kwai":      return { label: "Kwai",      bg: "rgba(255,102,0,0.08)",  color: "#ff6600", border: "rgba(255,102,0,0.2)" };
    default:          return { label: channel || "Canal", bg: "var(--surface-2)", color: "hsl(240 8% 60%)", border: "var(--border-default)" };
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
  is_edited?: boolean;
  delivered_at?: string | null;
  read_at?: string | null;
  external_message_id?: string;
  reply_to_id?: string;
  reply_to?: {
    id?: string;
    type?: string;
    text?: string;
    sender_name?: string;
    direction?: string;
    media_url?: string;
    mime_type?: string;
  };
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
  // Reply context — composer mostra barra com preview e envia reply_to_message_id
  const [replyTo, setReplyTo] = useState<MessagePayload | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessagePayload | null>(null);
  const [editingMsg, setEditingMsg] = useState<MessagePayload | null>(null);
  const [infoMsg, setInfoMsg] = useState<MessagePayload | null>(null);
  const [confirmRevokeMsg, setConfirmRevokeMsg] = useState<MessagePayload | null>(null);
  // Presence state — preenchido quando WS emite presence.update / chat.presence
  // pra channel_key desta conversation. typing reseta após 5s de silêncio.
  const [presence, setPresence] = useState<{ online?: boolean; lastSeen?: string; typing?: boolean }>({});
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // Polling reduzido: WS dispara invalidate em conversation.message,
    // então 30s é fallback caso o WS caia. Polling agressivo (2s) fazia
    // <audio src> "mudar" toda vez que ResolveMediaURLs gerava signed URL
    // nova → browser descartava o buffer e reproducão reiniciava.
    refetchInterval: 30_000,
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
    prefixes: ["conversation.", "message."],
    onEvent: (evt: WSEvent) => {
      const payload = (evt.payload ?? {}) as { conversation_id?: string; conversation?: { id?: string } };
      const eventConvID = payload.conversation_id ?? payload.conversation?.id;
      if (eventConvID && eventConvID !== conversationId) return;
      qc.invalidateQueries({ queryKey: ["conversation", wsId, conversationId] });
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
  });

  // Presence WS — escuta presence.update + chat.presence pro channel_key
  // dessa conversation. Atualiza online/lastSeen/typing no header.
  useConversationWS({
    prefixes: ["presence.", "chat."],
    onEvent: (evt: WSEvent) => {
      if (!convQ.data?.channel_key) return;
      const channelKey = convQ.data.channel_key;
      const payload = (evt.payload ?? {}) as { from?: string; chat?: string; unavailable?: boolean; last_seen?: string; state?: string };
      const target = payload.chat || payload.from || "";
      // Match por phone — channel_key normalmente vem como "5511...@s.whatsapp.net"
      // Eventos podem vir só com phone ou JID completo.
      const matches = target && (target === channelKey || target.startsWith(channelKey.split("@")[0]) || channelKey.startsWith(target.split("@")[0]));
      if (!matches) return;

      if (evt.type === "presence.update") {
        setPresence((p) => ({ ...p, online: !payload.unavailable, lastSeen: payload.last_seen }));
      } else if (evt.type === "chat.presence") {
        const isTyping = payload.state === "composing";
        setPresence((p) => ({ ...p, typing: isTyping }));
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (isTyping) {
          typingTimeoutRef.current = setTimeout(() => setPresence((p) => ({ ...p, typing: false })), 5000);
        }
      }
    },
  });


  const send = useMutation({
    mutationFn: (input: { body: string; replyToMessageId?: string }) =>
      conversationsApi.sendMessage(wsId as string, conversationId, {
        body: input.body,
        ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
      }),
    onSuccess: () => {
      setReplyTo(null);
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
    // Counters do header das colunas (Abertos / Resolvidos / etc) ficam num
    // queryKey separado — sem isso o badge fica defasado e a UX parece
    // bugada ("resolvi mas a coluna Resolvidos não muda").
    qc.invalidateQueries({ queryKey: ["conversations-count", wsId] });
    qc.invalidateQueries({ queryKey: ["inbox-stats", wsId] });
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

  // Pin / Mute conversation — patch direto na conversation.
  const patchConv = useMutation({
    mutationFn: (patch: { is_pinned?: boolean; is_muted?: boolean; is_archived?: boolean }) =>
      conversationsApi.patch(wsId as string, conversationId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation", wsId, conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations", wsId] });
    },
  });

  const patchMsg = useMutation({
    mutationFn: ({ msgId, patch }: { msgId: string; patch: { is_pinned?: boolean; is_favorite?: boolean } }) =>
      conversationsApi.patchMessage(wsId as string, conversationId, msgId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao atualizar mensagem"),
  });

  const revokeMsg = useMutation({
    mutationFn: (msgId: string) => conversationsApi.revokeMessage(wsId as string, conversationId, msgId),
    onSuccess: () => {
      toast.success("Mensagem apagada");
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao apagar"),
  });

  const editMsg = useMutation({
    mutationFn: ({ msgId, body }: { msgId: string; body: string }) =>
      conversationsApi.editMessage(wsId as string, conversationId, msgId, body),
    onSuccess: () => {
      toast.success("Mensagem editada");
      setEditingMsg(null);
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao editar"),
  });

  const reactMsg = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) =>
      conversationsApi.reactToMessage(wsId as string, conversationId, msgId, emoji),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao reagir"),
  });

  const forwardMutation = useMutation({
    mutationFn: ({ msgId, conversationIds }: { msgId: string; conversationIds: string[] }) =>
      conversationsApi.forwardMessage(wsId as string, conversationId, msgId, conversationIds),
    onSuccess: (res) => {
      const data = res.data as { results: Array<{ error?: string }> };
      const failed = (data.results || []).filter((r) => r.error).length;
      if (failed === 0) toast.success("Encaminhado");
      else toast.warning(`Encaminhado com ${failed} falha(s)`);
      setForwardMsg(null);
      qc.invalidateQueries({ queryKey: ["conversation-timeline", wsId, conversationId] });
    },
    onError: () => toast.error("Falha ao encaminhar"),
  });

  // Snooze dialog state — substitui prompt() nativo do browser.
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const openSnoozePrompt = useCallback(() => setSnoozeOpen(true), []);

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
  // Agrupa reactions por mensagem-alvo. Reaction msgs têm reply_to_id apontando
  // pra msg original. Filtramos elas do timeline e injetamos como chips dentro
  // da bubble da msg referenciada (paridade WhatsApp Web).
  const { timeline, reactionsByTarget } = useMemo(() => {
    const reactions = new Map<string, ReactionEntry[]>();
    const filtered: TimelinePayload["items"] = [];
    for (const e of timelineAll) {
      if (e.kind === "message") {
        const m = e.payload as MessagePayload;
        if (m.type === "reaction" && m.reply_to_id) {
          const list = reactions.get(m.reply_to_id) ?? [];
          if (m.content && m.content !== "" && m.content !== '""') {
            const emoji = parseMessageContent(m.content).text || m.content;
            list.push({
              id: m.id,
              emoji,
              sender_name: m.sender_name,
              direction: m.direction,
              created_at: m.created_at,
            });
          }
          reactions.set(m.reply_to_id, list);
          continue;
        }
      }
      filtered.push(e);
    }
    return { timeline: filtered, reactionsByTarget: reactions };
  }, [timelineAll]);
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

  // Scroll inicial pra mensagem mais recente quando conversation abre.
  // didInitialScrollRef garante que só rola na PRIMEIRA carga; depois disso,
  // o user controla o scroll. Reseta quando troca de conversation.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    didInitialScrollRef.current = false;
  }, [conversationId]);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (timeline.length === 0) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    // Próximo frame pra garantir que o DOM já mediu altura final.
    requestAnimationFrame(() => {
      // Desliga scroll suave pro jump inicial (chat abre direto no fim).
      const original = scroller.style.scrollBehavior;
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop = scroller.scrollHeight;
      // Reativa pra scrolls subsequentes serem suaves.
      requestAnimationFrame(() => {
        scroller.style.scrollBehavior = original || "smooth";
      });
      didInitialScrollRef.current = true;
    });
  }, [timeline.length, conversationId]);

  // Auto-scroll quando chega msg nova SE o user já está perto do fim.
  // Se ele rolou pra cima pra ler histórico antigo, não puxamos pro fim
  // — respeita a leitura. Threshold: 120px do bottom.
  const lastMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (timeline.length === 0) return;
    const last = timeline[timeline.length - 1];
    if (!last || last.id === lastMessageIdRef.current) return;
    const scroller = scrollRef.current;
    if (!scroller) {
      lastMessageIdRef.current = last.id;
      return;
    }
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const isNearBottom = distanceFromBottom < 120;
    if (isNearBottom && didInitialScrollRef.current) {
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    }
    lastMessageIdRef.current = last.id;
  }, [timeline]);

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
          {/* Avatar do contato/grupo — clicável quando tem foto, abre lightbox */}
          {(() => {
            const isGroup = (conv?.channel_key || "").toLowerCase().endsWith("@g.us");
            const avatarUrl = conv?.contact?.avatar_url;
            const name = conv?.contact?.name || conv?.subject || conv?.channel_key || "?";
            if (avatarUrl) {
              return (
                <button
                  type="button"
                  onClick={() => setViewerSource({ type: "image", url: avatarUrl, filename: `${name}.jpg` })}
                  title="Ver foto de perfil"
                  className="h-9 w-9 rounded-full overflow-hidden flex-shrink-0 transition-opacity hover:opacity-80"
                  style={{ background: "var(--surface-2)" }}
                >
                  <img
                    src={avatarUrl}
                    alt={name}
                    className="h-9 w-9 object-cover"
                  />
                </button>
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
                className="flex h-9 w-9 items-center justify-center rounded-full font-medium flex-shrink-0"
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
              <h1 className="truncate text-base font-medium">
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
              {/* Presence indicator — typing > online > last seen */}
              <PresenceLabel presence={presence} />
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
          key={conversationId}
          ref={scrollRef}
          className="flex-1 overflow-auto px-5 py-6 uniq-fade-in"
          style={{ background: "hsl(240 18% 5.5%)", scrollBehavior: "smooth" }}
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
                    background: "var(--surface-2)",
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
              {timeline.map((e, idx) => {
                const prev = idx > 0 ? timeline[idx - 1] : null;
                const dayChanged = !prev || !sameDay(prev.at, e.at);
                return (
                  <Fragment key={`${e.kind}-${e.id}`}>
                    {dayChanged && <DaySeparator at={e.at} />}
                    <li>
                      {e.kind === "message" ? (
                    <MessageBubble
                      m={e.payload as MessagePayload}
                      wsId={wsId}
                      reactions={reactionsByTarget.get((e.payload as MessagePayload).id)}
                      onPatch={(patch) =>
                        patchMsg.mutate({ msgId: (e.payload as MessagePayload).id, patch })
                      }
                      onOpenViewer={setViewerSource}
                      onReply={(msg) => setReplyTo(msg)}
                      onRevoke={(msg) => setConfirmRevokeMsg(msg)}
                      onForward={(msg) => setForwardMsg(msg)}
                      onReact={(msg, emoji) => reactMsg.mutate({ msgId: msg.id, emoji })}
                      onEdit={(msg) => setEditingMsg(msg)}
                      onInfo={(msg) => setInfoMsg(msg)}
                    />
                      ) : e.kind === "note" ? (
                        <NoteCard n={e.payload as NotePayload} />
                      ) : (
                        <EventLine e={e.payload as EventPayload} />
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          )}
        </div>

        <Composer
          wsId={wsId}
          conversationId={conversationId}
          instanceId={conv?.instance_id}
          canSend={canSend}
          canNote={canNote}
          onSendMessage={(body) => send.mutate({ body, replyToMessageId: replyTo?.id })}
          onSendNote={(body) => note.mutate(body)}
          isSending={send.isPending}
          isNoting={note.isPending}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
        />
      </section>

      {/* Sidepanel with actions + contact */}
      <aside className="hidden w-80 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:flex">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contato</h2>
          <div className="mt-2 flex items-center gap-3">
            {(() => {
              const isGroup = (conv?.channel_key || "").toLowerCase().endsWith("@g.us");
              const avatarUrl = conv?.contact?.avatar_url;
              const name = conv?.contact?.name || conv?.subject || conv?.channel_key || "?";
              if (avatarUrl) {
                return (
                  <button
                    type="button"
                    onClick={() => setViewerSource({ type: "image", url: avatarUrl, filename: `${name}.jpg` })}
                    title="Ver foto de perfil"
                    className="h-12 w-12 rounded-full overflow-hidden flex-shrink-0 transition-opacity hover:opacity-80"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <img src={avatarUrl} alt={name} className="h-12 w-12 object-cover" />
                  </button>
                );
              }
              if (isGroup) {
                return (
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full flex-shrink-0"
                    style={{
                      background: "rgba(167,139,250,0.12)",
                      border: "1px solid rgba(167,139,250,0.25)",
                      color: "#c4b5fd",
                    }}
                  >
                    <UsersIcon className="h-5 w-5" />
                  </div>
                );
              }
              let hash = 0;
              for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
              const hue = Math.abs(hash) % 360;
              const initials = (name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0] || "").join("") || "?").toUpperCase();
              return (
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full font-medium flex-shrink-0"
                  style={{
                    background: `hsl(${hue} 50% 22%)`,
                    color: `hsl(${hue} 70% 75%)`,
                    fontSize: 16,
                  }}
                >
                  {initials}
                </div>
              );
            })()}
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{conv?.contact?.name || "—"}</div>
              <div className="text-sm text-zinc-500 truncate">{conv?.contact?.phone || conv?.channel_key}</div>
              {conv?.contact?.email && <div className="text-xs text-zinc-500 truncate">{conv.contact.email}</div>}
            </div>
          </div>
        </div>

        <div className="space-y-1 border-b border-zinc-200 p-3 dark:border-zinc-800">
          {!conv?.assigned_user_id && canAssign && (
            <ActionRow onClick={() => claim.mutate()} icon={<UserCheck className="h-4 w-4" />} label="Atender" tone="primary" />
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
              onClick={openSnoozePrompt}
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
          {canUpdate && conv && (
            <ActionRow
              onClick={() => patchConv.mutate({ is_pinned: !conv.is_pinned })}
              icon={<Pin className="h-4 w-4" style={{ color: conv.is_pinned ? "#00d46a" : undefined }} />}
              label={conv.is_pinned ? "Desfixar conversa" : "Fixar conversa no topo"}
            />
          )}
          {canUpdate && conv && (
            <ActionRow
              onClick={() => patchConv.mutate({ is_muted: !conv.is_muted })}
              icon={conv.is_muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              label={conv.is_muted ? "Reativar notificações" : "Silenciar notificações"}
            />
          )}
        </div>

        <div className="flex-1 overflow-auto p-5 text-xs text-zinc-500">
          <div className="mb-2 font-medium uppercase tracking-wide">Detalhes</div>
          <dl className="space-y-1">
            <DRow label="Aberto em" value={conv?.created_at && relativeTime(conv.created_at)} />
            <DRow label="Última mensagem" value={conv?.last_message_at && relativeTime(conv.last_message_at)} />
            <DRow label="Prioridade" value={conv?.priority} />
            <DRow label="Canal" value={conv?.channel_type} />
            <DRow label="Fila" value={queuesQ.data?.items.find((q) => q.id === conv?.queue_id)?.name ?? "—"} />
          </dl>
          <div className="mt-4 rounded-md border border-dashed border-zinc-300 p-3 text-[11px] dark:border-zinc-700">
            <div className="font-medium uppercase tracking-wide text-zinc-500">Atalhos</div>
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

      {forwardMsg && wsId && (
        <ForwardDialog
          wsId={wsId}
          msg={forwardMsg}
          fromConversationId={conversationId}
          onClose={() => setForwardMsg(null)}
          onSubmit={(ids) => forwardMutation.mutate({ msgId: forwardMsg.id, conversationIds: ids })}
          isPending={forwardMutation.isPending}
        />
      )}

      {editingMsg && (
        <EditMessageDialog
          msg={editingMsg}
          onClose={() => setEditingMsg(null)}
          onSubmit={(body) => editMsg.mutate({ msgId: editingMsg.id, body })}
          isPending={editMsg.isPending}
        />
      )}

      {infoMsg && wsId && (
        <MessageInfoDialog
          wsId={wsId}
          conversationId={conversationId}
          msg={infoMsg}
          onClose={() => setInfoMsg(null)}
        />
      )}

      {snoozeOpen && (
        <SnoozeDialog
          onClose={() => setSnoozeOpen(false)}
          onSubmit={(iso) => {
            snooze.mutate(iso);
            setSnoozeOpen(false);
          }}
        />
      )}

      {confirmRevokeMsg && (
        <ConfirmDialog
          title="Apagar mensagem"
          body="A mensagem será removida pra você e pro destinatário no canal. Não pode ser desfeito."
          confirmLabel="Apagar"
          variant="danger"
          onConfirm={() => {
            revokeMsg.mutate(confirmRevokeMsg.id);
            setConfirmRevokeMsg(null);
          }}
          onCancel={() => setConfirmRevokeMsg(null)}
          isPending={revokeMsg.isPending}
        />
      )}
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
        style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}
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
          <h2 className="text-sm font-medium" style={{ color: "hsl(240 15% 93%)" }}>
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

interface ReactionEntry {
  id: string;
  emoji: string;
  sender_name?: string;
  direction: "in" | "out";
  created_at: string;
}

function MessageBubble({
  m, onPatch, onOpenViewer, wsId, onReply, onRevoke, onForward, onReact, onEdit, onInfo, reactions,
}: {
  m: MessagePayload;
  onPatch?: (patch: { is_pinned?: boolean; is_favorite?: boolean }) => void;
  onOpenViewer: (source: MediaViewerSource) => void;
  wsId?: string;
  onReply?: (m: MessagePayload) => void;
  onRevoke?: (m: MessagePayload) => void;
  onForward?: (m: MessagePayload) => void;
  onReact?: (m: MessagePayload, emoji: string) => void;
  onEdit?: (m: MessagePayload) => void;
  onInfo?: (m: MessagePayload) => void;
  reactions?: ReactionEntry[];
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
            background: isOut ? "rgba(0,212,106,0.12)" : "var(--surface-2)",
            border: `1px solid ${isOut ? "rgba(0,212,106,0.25)" : "var(--border-default)"}`,
          }}
        >
          {parsed.text || "👍"}
        </div>
      </div>
    );
  }

  // Mídia pura (image/video/audio/sticker sem caption) → render SEM bubble.
  // Bordas finas com cor da direção indicam emissor (verde Uniq) vs
  // receptor (cinza). Mais limpo, dá destaque visual à mídia.
  // Documentos, location, contact, poll sempre vão pra dentro do bubble
  // (cards verticais com layout próprio). Sticker fica isolado pra dar
  // a sensação flutuante característica do WhatsApp.
  const isPureMedia =
    ((m.type === "image" || m.type === "video" || m.type === "audio" || m.type === "gif") &&
      !!parsed.url && !body) ||
    (m.type === "sticker" && !!parsed.url);

  if (isPureMedia) {
    // Audio já vem com pill estilizada estilo WhatsApp pelo AudioPlayer —
    // dispensar a borda gradiente externa pra não ficar bubble dentro de bubble.
    const isAudioOnly = m.type === "audio";
    return (
      <div className={`group relative flex ${isOut ? "justify-end" : "justify-start"}`}>
        <div
          className="relative max-w-[80%] uniq-slide-up"
          style={
            isAudioOnly
              ? undefined
              : {
                  borderRadius: 14,
                  padding: 3,
                  background: isOut
                    ? "linear-gradient(135deg, rgba(0,212,106,0.35), rgba(0,212,106,0.15))"
                    : "linear-gradient(135deg, var(--border-strong), var(--border-default))",
                }
          }
        >
          <div
            className={isAudioOnly ? "" : "overflow-hidden"}
            style={isAudioOnly ? undefined : { borderRadius: 12, background: "hsl(240 18% 5%)" }}
          >
            <MediaBody type={m.type} parsed={parsed} onOpenViewer={onOpenViewer} wsId={wsId} isOut={isOut} />
          </div>

          {/* Pin / favorite / view-once badges — abs positioned mantém limpo */}
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
          {parsed.isViewOnce && !m.is_pinned && !m.is_favorite && (
            <span
              className="absolute -top-2 right-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{ background: "#a78bfa", color: "#1a1a2e" }}
              title="Visualização única"
            >
              👁 única
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

          <MessageActionsToolbar
            m={m}
            isOut={isOut}
            onPatch={onPatch}
            onReply={onReply}
            onRevoke={onRevoke}
            onForward={onForward}
            onReact={onReact}
            onEdit={onEdit}
            onInfo={onInfo}
          />
          <ReactionChips reactions={reactions} isOut={isOut} />
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
                background: "var(--surface-2)",
                border: `1px solid ${m.is_pinned ? "#00d46a" : "var(--border-default)"}`,
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

        {m.reply_to && <QuotedReply reply={m.reply_to} isOut={isOut} />}

        {(parsed.isViewOnce || parsed.isEphemeral) && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px]" style={{ color: parsed.isViewOnce ? "#a78bfa" : "hsl(240 8% 60%)" }}>
            {parsed.isViewOnce ? (
              <>
                <span className="inline-block h-3 w-3 text-center leading-3">👁</span>
                <span className="font-medium">Visualização única</span>
              </>
            ) : (
              <>
                <Clock3 className="h-3 w-3" />
                <span className="font-medium">Mensagem temporária</span>
              </>
            )}
          </div>
        )}

        <MediaBody type={m.type} parsed={parsed} onOpenViewer={onOpenViewer} wsId={wsId} isOut={isOut} />

        <div
          className="mt-1 flex items-center justify-end gap-1 text-[10px]"
          style={{ color: isOut ? "var(--text-3)" : "hsl(240 8% 44%)" }}
        >
          {m.is_edited && <span className="italic">editada</span>}
          <span>{relativeTime(m.created_at)}</span>
          {isOut && <StatusTicks status={m.status} />}
        </div>

        <MessageActionsToolbar
          m={m}
          isOut={isOut}
          onPatch={onPatch}
          onReply={onReply}
          onRevoke={onRevoke}
          onForward={onForward}
          onReact={onReact}
          onEdit={onEdit}
          onInfo={onInfo}
        />
        <ReactionChips reactions={reactions} isOut={isOut} />
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
  type, parsed, onOpenViewer, wsId, isOut,
}: {
  type: string;
  parsed: ParsedContent;
  onOpenViewer: (source: MediaViewerSource) => void;
  wsId?: string;
  isOut?: boolean;
}) {
  const { text, url, mediaKey, filename, caption, error, latitude, longitude, mimeType } = parsed;
  const body = caption || text;

  if (type === "image") {
    if (url) {
      return (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() =>
              onOpenViewer({ type: "image", url, mediaKey, filename, mimeType, caption: body })
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

  // GIF — VideoMessage com gifPlayback=true. Renderiza com autoplay+loop+muted
  // pra simular comportamento de imagem animada. Sem controles, sem reset de
  // ratio. Click abre lightbox em modo "video" pra quem quiser pausar/scrubar.
  if (type === "gif" || (type === "video" && parsed.isGif)) {
    if (url) {
      return (
        <div className="flex flex-col gap-1.5 relative">
          <button
            type="button"
            onClick={() =>
              onOpenViewer({ type: "video", url, mediaKey, filename, mimeType, caption: body })
            }
            className="relative block group"
            aria-label="Abrir GIF"
          >
            <video
              src={url}
              className="max-w-[280px] rounded-lg"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
            />
            <span
              className="absolute bottom-1.5 left-1.5 rounded px-1 text-[9px] font-semibold tracking-wider"
              style={{ background: "var(--surface-overlay)", color: "white" }}
            >
              GIF
            </span>
          </button>
          {body && <Text text={body} />}
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<ImageIcon className="h-4 w-4" />} label={body || "GIF"} />;
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
              onOpenViewer({ type: "video", url, mediaKey, filename, mimeType, caption: body })
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
                style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}
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
    // Tenta resolver URL: 1) url direto, 2) constrói via mediaKey + storage
    // público. Áudios devem SEMPRE renderizar player — IconFallback só
    // aparece se não houver nenhuma forma de obter o áudio + houver erro.
    const audioURL = url || (mediaKey ? buildMediaURL(mediaKey) : "");
    if (audioURL) {
      return (
        <div className="flex flex-col gap-1.5">
          <AudioPlayer url={audioURL} variant={isOut ? "out" : "in"} />
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <IconFallback icon={<Mic className="h-4 w-4" />} label={body || "Áudio"} />
        {error && <ErrorLine text={error} />}
      </div>
    );
  }

  if (type === "document") {
    if (url) {
      // Detecção de mime: documentos enviados como arquivo mas que são
      // imagem/vídeo/áudio renderizam com preview do tipo real, não como
      // ícone genérico de doc. WhatsApp permite "enviar como documento" e
      // mantém mime em image/jpeg, application/pdf, etc.
      if (mimeType?.startsWith("image/")) {
        return (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() =>
                onOpenViewer({ type: "image", url, mediaKey, filename, mimeType, caption: body })
              }
              className="block rounded-lg overflow-hidden transition-opacity hover:opacity-90"
              aria-label={filename || "imagem"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={filename || "imagem"}
                className="max-h-[280px] max-w-[280px] rounded-lg object-cover cursor-zoom-in"
              />
            </button>
            {filename && (
              <span className="text-[10px] truncate" style={{ color: "hsl(240 8% 50%)" }}>
                📎 {filename}
              </span>
            )}
            {body && <Text text={body} />}
          </div>
        );
      }
      if (mimeType?.startsWith("video/")) {
        return (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() =>
                onOpenViewer({ type: "video", url, mediaKey, filename, mimeType, caption: body })
              }
              className="relative block group"
              aria-label="Abrir vídeo"
            >
              <video src={url} className="max-w-[320px] rounded-lg" preload="metadata" muted />
              <span className="absolute inset-0 flex items-center justify-center rounded-lg group-hover:bg-black/30" style={{ background: "rgba(0,0,0,0.2)" }}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--surface-overlay)" }}>
                  <svg className="h-6 w-6 ml-1" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </button>
            {filename && (
              <span className="text-[10px] truncate" style={{ color: "hsl(240 8% 50%)" }}>
                📎 {filename}
              </span>
            )}
            {body && <Text text={body} />}
          </div>
        );
      }
      if (mimeType?.startsWith("audio/")) {
        return (
          <div className="flex flex-col gap-1.5">
            <AudioPlayer url={url} variant={isOut ? "out" : "in"} />
            {filename && (
              <span className="text-[10px] truncate" style={{ color: "hsl(240 8% 50%)" }}>
                📎 {filename}
              </span>
            )}
          </div>
        );
      }
      // Documento "real" — PDF/Word/Excel/etc. Vai pro lightbox em PDF
      // ou só botão download nos outros.
      return (
        <button
          type="button"
          onClick={() =>
            onOpenViewer({ type: "document", url, mediaKey, filename, mimeType, caption: body })
          }
          className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-white/5 text-left w-full"
          style={{ background: "var(--surface-2)" }}
        >
          <FileText className="h-5 w-5 flex-shrink-0" style={{ color: "hsl(240 8% 70%)" }} />
          <span className="truncate text-xs flex-1">{filename || "Documento"}</span>
          <Maximize2Icon className="h-3 w-3 flex-shrink-0" style={{ color: "hsl(240 8% 50%)" }} />
        </button>
      );
    }
    return <IconFallback icon={<FileText className="h-4 w-4" />} label={body || "Documento"} />;
  }

  // Sticker — renderiza como imagem pequena (max ~120px), sem zoom-in
  // forçado. WhatsApp animated stickers (.webp animado) tocam direto no
  // <img>. Não passa por lightbox por design (são gestuais, fluem na conversa).
  if (type === "sticker") {
    if (url) {
      return (
        <div className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={filename || "sticker"}
            className="max-h-[120px] max-w-[120px] object-contain"
            style={{ background: "transparent" }}
          />
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<ImageIcon className="h-4 w-4" />} label="Sticker" />;
  }

  if (type === "location" || type === "live_location") {
    if (latitude != null && longitude != null) {
      const mapsURL = `https://www.google.com/maps?q=${latitude},${longitude}`;
      // Mini-map preview via OpenStreetMap (sem chave). Mostra um quadrado
      // com pin centrado nas coords. Click abre Google Maps em nova aba.
      const bbox = [longitude - 0.005, latitude - 0.005, longitude + 0.005, latitude + 0.005].join(",");
      const mapEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;
      const isLive = type === "live_location" || parsed.isLive;
      return (
        <div className="flex flex-col gap-1.5 max-w-[280px]">
          <a
            href={mapsURL}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg overflow-hidden border transition-opacity hover:opacity-95"
            style={{ borderColor: "var(--border-default)" }}
            title="Abrir no Google Maps"
          >
            <iframe
              src={mapEmbed}
              className="w-full pointer-events-none"
              style={{ height: 160, background: "#1a1d29", border: 0 }}
              title="Mapa"
              loading="lazy"
            />
            <div
              className="flex items-start gap-2 px-2.5 py-2"
              style={{ background: "var(--surface-overlay)" }}
            >
              <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: isLive ? "#ef4444" : "#00d46a" }} />
              <div className="min-w-0 flex-1">
                {isLive && (
                  <div className="flex items-center gap-1 text-[10px] font-medium" style={{ color: "#ef4444" }}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full ring-pulse" style={{ background: "#ef4444" }} />
                    AO VIVO
                  </div>
                )}
                {parsed.name && (
                  <div className="text-xs font-medium truncate" style={{ color: "hsl(240 15% 90%)" }}>
                    {parsed.name}
                  </div>
                )}
                {parsed.address && (
                  <div className="text-[10px] truncate" style={{ color: "hsl(240 8% 60%)" }}>
                    {parsed.address}
                  </div>
                )}
                <div className="text-[10px] tabular-nums" style={{ color: "hsl(240 8% 50%)" }}>
                  {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </div>
              </div>
            </div>
          </a>
        </div>
      );
    }
    return <IconFallback icon={<MapPin className="h-4 w-4" />} label={body || "Localização"} />;
  }

  // Contact — vCard com ações de "Adicionar ao CRM" e "Iniciar conversa".
  if (type === "contact") {
    return <ContactCard parsed={parsed} body={body} wsId={wsId} />;
  }

  // Múltiplos contatos (ContactsArrayMessage)
  if (type === "contacts") {
    const list = parsed.contacts || [];
    return (
      <div
        className="flex flex-col gap-1.5 rounded-lg p-3 max-w-[300px]"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}
      >
        <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 50%)" }}>
          {list.length} contatos
        </div>
        {list.map((c, i) => (
          <div key={i} className="text-xs flex items-center justify-between gap-2 py-0.5" style={{ color: "hsl(240 15% 88%)" }}>
            <span className="truncate">{c.display_name || "Sem nome"}</span>
            {c.phones && c.phones[0] && (
              <span className="font-mono text-[10px] flex-shrink-0" style={{ color: "hsl(240 8% 60%)" }}>
                {c.phones[0].number}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Poll — pergunta + opções (visualização read-only — agente não pode votar)
  if (type === "poll") {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg p-3 max-w-[300px]"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}
      >
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 50%)" }}>
          📊 Enquete{parsed.multi ? " · múltipla escolha" : ""}
        </div>
        {parsed.question && (
          <div className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>
            {parsed.question}
          </div>
        )}
        {parsed.pollOptions && parsed.pollOptions.length > 0 && (
          <div className="space-y-1 mt-1">
            {parsed.pollOptions.map((opt, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-default)",
                  color: "hsl(240 15% 88%)",
                }}
              >
                <span
                  className="inline-block h-3 w-3 rounded flex-shrink-0"
                  style={{ border: "1.5px solid hsl(240 8% 40%)", borderRadius: parsed.multi ? 3 : "50%" }}
                />
                <span className="truncate">{opt.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Buttons / Interactive — botões de CTA (read-only no view do agente).
  if (type === "buttons" || type === "interactive") {
    const btns = parsed.buttons || [];
    return (
      <div className="flex flex-col gap-2 max-w-[300px]">
        {parsed.interactive?.header && (
          <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "hsl(240 8% 60%)" }}>
            {parsed.interactive.header}
          </div>
        )}
        {(text || parsed.interactive?.body) && (
          <Text text={text || parsed.interactive?.body || ""} />
        )}
        {btns.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {btns.map((b, i) => (
              <div
                key={i}
                className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium"
                style={{
                  background: "rgba(0,212,106,0.06)",
                  border: "1px solid rgba(0,212,106,0.2)",
                  color: "#00d46a",
                }}
                title={b.id ? `id: ${b.id}` : undefined}
              >
                <ListChecks className="h-3 w-3" /> {b.title || b.id || "Botão"}
              </div>
            ))}
          </div>
        )}
        {parsed.listFooter && (
          <div className="text-[10px]" style={{ color: "hsl(240 8% 55%)" }}>
            {parsed.listFooter}
          </div>
        )}
      </div>
    );
  }

  if (type === "list") {
    return (
      <div className="flex flex-col gap-2 max-w-[320px]">
        {parsed.listHeader && (
          <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "hsl(240 8% 60%)" }}>
            {parsed.listHeader}
          </div>
        )}
        {parsed.listTitle && (
          <div className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>
            {parsed.listTitle}
          </div>
        )}
        {body && <Text text={body} />}
        {parsed.listSections && parsed.listSections.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            {parsed.listSections.map((sec, i) => (
              <div key={i}>
                {sec.title && (
                  <div className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 50%)" }}>
                    {sec.title}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {(sec.rows || []).map((r, j) => (
                    <div
                      key={j}
                      className="rounded-md p-2 text-xs"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border-default)",
                        color: "hsl(240 15% 88%)",
                      }}
                    >
                      <div className="font-medium">{r.title}</div>
                      {r.description && (
                        <div className="text-[10px] mt-0.5" style={{ color: "hsl(240 8% 60%)" }}>
                          {r.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {parsed.listButtonText && (
          <div
            className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium"
            style={{
              background: "rgba(0,212,106,0.06)",
              border: "1px solid rgba(0,212,106,0.2)",
              color: "#00d46a",
            }}
          >
            <ListChecks className="h-3 w-3" /> {parsed.listButtonText}
          </div>
        )}
        {parsed.listFooter && (
          <div className="text-[10px]" style={{ color: "hsl(240 8% 55%)" }}>
            {parsed.listFooter}
          </div>
        )}
      </div>
    );
  }

  if (type === "call") {
    return <CallCard parsed={parsed} isOut={!!isOut} />;
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

// CallCard — render de chamada perdida/atendida/rejeitada com ícone+duração.
function CallCard({ parsed, isOut }: { parsed: ParsedContent; isOut: boolean }) {
  const isVideo = parsed.callType === "video";
  const status = parsed.callStatus || "missed";
  const dur = parsed.callDurationSec;
  const missed = status === "missed" || status === "rejected" || status === "timeout";
  const color = missed ? "#ef4444" : "#00d46a";
  const Icon = missed ? PhoneMissed : isVideo ? VideoIcon : Phone;
  const labelByStatus: Record<string, string> = {
    missed: "Chamada perdida",
    answered: "Chamada atendida",
    rejected: "Chamada rejeitada",
    timeout: "Chamada não atendida",
  };
  const label = labelByStatus[status] || (isVideo ? "Chamada de vídeo" : "Chamada de voz");
  const fmtDur = (s?: number) => {
    if (!s || s <= 0) return "";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}min ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
  };
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 max-w-[280px]"
      style={{
        background: "var(--surface-2)",
        border: `1px solid ${missed ? "rgba(239,68,68,0.25)" : "rgba(0,212,106,0.2)"}`,
      }}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0"
        style={{ background: `${color}20`, color }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium" style={{ color: "hsl(240 15% 92%)" }}>
          {label}
        </div>
        <div className="text-[10px]" style={{ color: "hsl(240 8% 60%)" }}>
          {isOut ? "Saída" : "Recebida"}
          {isVideo && " · vídeo"}
          {dur ? ` · ${fmtDur(dur)}` : ""}
        </div>
      </div>
    </div>
  );
}

// QuotedReply — bloco compacto acima da bubble mostrando a mensagem citada.
function QuotedReply({
  reply, isOut,
}: {
  reply: NonNullable<MessagePayload["reply_to"]>;
  isOut: boolean;
}) {
  const accent = reply.direction === "out" ? "#00d46a" : "hsl(240 8% 70%)";
  const isMedia = reply.type && reply.type !== "text" && reply.type !== "reaction";
  const typeLabel = REPLY_TYPE_LABELS[reply.type || ""] || reply.type;
  const showThumb = !!reply.media_url && (reply.type === "image" || (reply.mime_type || "").startsWith("image/"));
  return (
    <div
      className="mb-1 flex gap-2 rounded-md py-1 pl-2 pr-2 text-[11px]"
      style={{
        background: isOut ? "rgba(0,0,0,0.18)" : "var(--surface-2)",
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate" style={{ color: accent }}>
          {reply.sender_name || (reply.direction === "out" ? "Você" : "Cliente")}
        </div>
        {isMedia && !reply.text && (
          <div className="flex items-center gap-1 opacity-80" style={{ color: "hsl(240 15% 80%)" }}>
            {reply.type === "image" && <ImageIcon className="h-3 w-3" />}
            {reply.type === "video" && <ImageIcon className="h-3 w-3" />}
            {reply.type === "audio" && <Mic className="h-3 w-3" />}
            {reply.type === "document" && <FileText className="h-3 w-3" />}
            {reply.type === "location" && <MapPin className="h-3 w-3" />}
            <span>{typeLabel || "Mídia"}</span>
          </div>
        )}
        {reply.text && (
          <div
            className="truncate"
            style={{ color: "hsl(240 15% 80%)", maxWidth: 240 }}
            title={reply.text}
          >
            {reply.text}
          </div>
        )}
      </div>
      {showThumb && reply.media_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reply.media_url}
          alt=""
          className="h-9 w-9 flex-shrink-0 rounded object-cover"
        />
      )}
    </div>
  );
}

const REPLY_TYPE_LABELS: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Sticker",
  location: "Localização",
  live_location: "Localização ao vivo",
  contact: "Contato",
  contacts: "Contatos",
  poll: "Enquete",
  call: "Chamada",
};

// ContactCard — vCard rico com ações: copiar, abrir WhatsApp, adicionar ao CRM.
function ContactCard({
  parsed, body, wsId,
}: {
  parsed: ParsedContent;
  body?: string;
  wsId?: string;
}) {
  const name = parsed.displayName || body || "Contato";
  const phones = parsed.phones || [];
  const primaryPhone = phones[0]?.number || "";
  const cleanPhone = (n: string) => n.replace(/[^\d]/g, "");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const addToCrm = async () => {
    if (!wsId || !primaryPhone || adding) return;
    setAdding(true);
    try {
      await crmContactsApi.create(wsId, {
        name,
        phone: cleanPhone(primaryPhone),
      });
      setAdded(true);
      toast.success(`${name} adicionado ao CRM`);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err?.response?.data?.error || "Falha ao adicionar contato");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-3 max-w-[300px]"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full font-medium flex-shrink-0"
          style={{
            background: "rgba(0,212,106,0.1)",
            color: "#00d46a",
            border: "1px solid rgba(0,212,106,0.25)",
          }}
        >
          {name.split(/\s+/).slice(0, 2).map(p => p[0] || "").join("").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 92%)" }}>
            {name}
          </div>
          {phones.length > 0 && (
            <div className="text-[10px]" style={{ color: "hsl(240 8% 55%)" }}>
              {phones.length} {phones.length === 1 ? "telefone" : "telefones"}
            </div>
          )}
        </div>
      </div>
      {phones.length > 0 && (
        <div className="space-y-1">
          {phones.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs"
              style={{ color: "hsl(240 15% 88%)", background: "var(--surface-2)" }}
            >
              <span className="font-mono truncate">{p.number}</span>
              {p.type && (
                <span className="text-[9px] uppercase tracking-wider opacity-70 flex-shrink-0">{p.type}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {primaryPhone && (
        <div className="flex items-center gap-1.5 mt-1">
          <a
            href={`https://wa.me/${cleanPhone(primaryPhone)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md flex-1 py-1.5 text-[11px] font-medium transition-colors"
            style={{
              background: "rgba(0,212,106,0.12)",
              color: "#00d46a",
              border: "1px solid rgba(0,212,106,0.25)",
            }}
            title="Abrir conversa no WhatsApp"
          >
            <MessageSquare className="h-3 w-3" /> Conversar
          </a>
          {wsId && (
            <button
              type="button"
              onClick={addToCrm}
              disabled={adding || added}
              className="flex items-center justify-center gap-1.5 rounded-md flex-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-60"
              style={{
                background: added ? "rgba(245,158,11,0.12)" : "var(--surface-2)",
                color: added ? "#f59e0b" : "hsl(240 15% 88%)",
                border: `1px solid ${added ? "rgba(245,158,11,0.25)" : "var(--border-default)"}`,
              }}
              title="Adicionar ao CRM"
            >
              <UserPlus className="h-3 w-3" /> {added ? "No CRM" : adding ? "Salvando…" : "+ CRM"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// PresenceLabel — chip compacto que prioriza typing > online > last seen.
// Tipos: digitando (verde animado), online (verde sólido), "visto às X" (cinza).
function PresenceLabel({ presence }: { presence: { online?: boolean; lastSeen?: string; typing?: boolean } }) {
  if (presence.typing) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "#00d46a" }}>
        <span className="inline-flex gap-0.5">
          <span className="h-1 w-1 rounded-full" style={{ background: "#00d46a", animation: "uniq-typing-dot 1.2s infinite" }} />
          <span className="h-1 w-1 rounded-full" style={{ background: "#00d46a", animation: "uniq-typing-dot 1.2s infinite 0.15s" }} />
          <span className="h-1 w-1 rounded-full" style={{ background: "#00d46a", animation: "uniq-typing-dot 1.2s infinite 0.3s" }} />
        </span>
        digitando…
      </span>
    );
  }
  if (presence.online) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "#00d46a" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#00d46a" }} />
        online
      </span>
    );
  }
  if (presence.lastSeen) {
    const d = new Date(presence.lastSeen);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
    let label = "visto há pouco";
    if (diffMin > 60 * 24) label = `visto em ${d.toLocaleDateString("pt-BR")}`;
    else if (diffMin > 60) label = `visto há ${Math.floor(diffMin / 60)}h`;
    else if (diffMin > 1) label = `visto há ${diffMin} min`;
    return <span className="text-[11px]" style={{ color: "hsl(240 8% 55%)" }}>{label}</span>;
  }
  return null;
}

// sameDay — true se os dois timestamps caem no mesmo dia local.
function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

// DaySeparator — selo central "Hoje" / "Ontem" / "12 de março, 2026".
function DaySeparator({ at }: { at: string }) {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  let label: string;
  if (sameDay(at, today.toISOString())) label = "Hoje";
  else if (sameDay(at, yesterday.toISOString())) label = "Ontem";
  else label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <li className="flex justify-center my-2 list-none">
      <span
        className="rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-default)",
          color: "hsl(240 8% 60%)",
        }}
      >
        {label}
      </span>
    </li>
  );
}

// replyPreviewText extrai um label compacto pro reply bar do composer.
function replyPreviewText(m: MessagePayload): string {
  const parsed = parseMessageContent(m.content);
  const txt = parsed.caption || parsed.text;
  if (txt) return txt.length > 80 ? txt.slice(0, 80) + "…" : txt;
  switch (m.type) {
    case "image": return "📷 Imagem";
    case "video": return "🎬 Vídeo";
    case "audio": return "🔊 Áudio";
    case "document": return "📄 Documento";
    case "sticker": return "😊 Sticker";
    case "location": case "live_location": return "📍 Localização";
    case "contact": case "contacts": return "👤 Contato";
    case "poll": return "📊 Enquete";
    case "call": return "📞 Chamada";
    default: return "Mensagem";
  }
}

// ReactionChips — agrupa reactions por emoji e mostra chip "👍 3" abaixo da bubble.
function ReactionChips({ reactions, isOut }: { reactions?: ReactionEntry[]; isOut: boolean }) {
  if (!reactions || reactions.length === 0) return null;
  const counts = new Map<string, number>();
  const senders = new Map<string, string[]>();
  for (const r of reactions) {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    const list = senders.get(r.emoji) ?? [];
    list.push(r.sender_name || (r.direction === "out" ? "Você" : "Cliente"));
    senders.set(r.emoji, list);
  }
  const items = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <div
      className={`absolute -bottom-3.5 flex gap-0.5 ${isOut ? "right-2" : "left-2"}`}
      style={{ zIndex: 1 }}
    >
      {items.map(([emoji, count]) => (
        <span
          key={emoji}
          title={(senders.get(emoji) ?? []).join(", ")}
          className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
          style={{
            background: "hsl(240 18% 8%)",
            border: "1px solid hsl(240 12% 18%)",
            color: "hsl(240 15% 90%)",
          }}
        >
          <span className="text-[12px] leading-none">{emoji}</span>
          {count > 1 && <span className="font-medium tabular-nums">{count}</span>}
        </span>
      ))}
    </div>
  );
}

// MessageActionsToolbar — barra flutuante no hover.
function MessageActionsToolbar({
  m, isOut, onPatch, onReply, onRevoke, onForward, onReact, onEdit, onInfo,
}: {
  m: MessagePayload;
  isOut: boolean;
  onPatch?: (patch: { is_pinned?: boolean; is_favorite?: boolean }) => void;
  onReply?: (m: MessagePayload) => void;
  onRevoke?: (m: MessagePayload) => void;
  onForward?: (m: MessagePayload) => void;
  onReact?: (m: MessagePayload, emoji: string) => void;
  onEdit?: (m: MessagePayload) => void;
  onInfo?: (m: MessagePayload) => void;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const canRevoke = isOut && !!onRevoke && m.type !== "revoke";
  const canEdit = isOut && !!onEdit && m.type === "text";
  const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
  return (
    <div
      className={`pointer-events-none absolute -top-3.5 flex gap-0.5 rounded-full px-1 py-0.5 opacity-0 shadow-lg transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${
        isOut ? "right-2" : "left-2"
      }`}
      style={{
        background: "hsl(240 18% 6%)",
        border: "1px solid hsl(240 12% 16%)",
      }}
    >
      {onReact && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            className="rounded-full p-1 hover:bg-white/10"
            title="Reagir"
            style={{ color: "hsl(240 8% 62%)" }}
          >
            <Smile className="h-3 w-3" />
          </button>
          {emojiOpen && (
            <div
              className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full px-1.5 py-1 shadow-xl z-30"
              style={{
                background: "hsl(240 18% 8%)",
                border: "1px solid hsl(240 12% 18%)",
              }}
            >
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(m, e);
                    setEmojiOpen(false);
                  }}
                  className="rounded-full px-1 py-0.5 text-base hover:bg-white/10"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onReply && (
        <button
          type="button"
          onClick={() => onReply(m)}
          className="rounded-full p-1 hover:bg-white/10"
          title="Responder"
          style={{ color: "hsl(240 8% 62%)" }}
        >
          <CornerUpLeft className="h-3 w-3" />
        </button>
      )}
      {onForward && (
        <button
          type="button"
          onClick={() => onForward(m)}
          className="rounded-full p-1 hover:bg-white/10"
          title="Encaminhar"
          style={{ color: "hsl(240 8% 62%)" }}
        >
          <CornerUpRight className="h-3 w-3" />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => onEdit!(m)}
          className="rounded-full p-1 hover:bg-white/10"
          title="Editar"
          style={{ color: "hsl(240 8% 62%)" }}
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {onPatch && (
        <>
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
        </>
      )}
      {isOut && onInfo && (
        <button
          type="button"
          onClick={() => onInfo(m)}
          className="rounded-full p-1 hover:bg-white/10"
          title="Informações da mensagem"
          style={{ color: "hsl(240 8% 62%)" }}
        >
          <Info className="h-3 w-3" />
        </button>
      )}
      {canRevoke && (
        <button
          type="button"
          onClick={() => onRevoke!(m)}
          className="rounded-full p-1 hover:bg-red-500/20"
          title="Apagar para todos"
          style={{ color: "#ef4444" }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Text({ text }: { text: string }) {
  const segments = useMemo(() => splitLinks(text), [text]);
  const firstURL = useMemo(() => segments.find((s) => s.type === "url")?.value, [segments]);
  return (
    <>
      <p className="text-sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {segments.map((seg, i) => {
          if (seg.type === "url") {
            return (
              <a
                key={i}
                href={seg.value}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
                style={{ color: "#60a5fa" }}
                onClick={(e) => e.stopPropagation()}
              >
                {seg.value}
              </a>
            );
          }
          if (seg.type === "mention") {
            const phone = seg.value.slice(1); // strip @
            return (
              <a
                key={i}
                href={`https://wa.me/${phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
                style={{ color: "#00d46a" }}
                onClick={(e) => e.stopPropagation()}
                title={`Abrir conversa com ${phone}`}
              >
                {seg.value}
              </a>
            );
          }
          return <WhatsAppMarkdown key={i} text={seg.value} />;
        })}
      </p>
      {firstURL && <LinkPreviewCard url={firstURL} />}
    </>
  );
}

function splitLinks(text: string): Array<{ type: "url" | "text" | "mention"; value: string }> {
  // Combinado: URL OR @<phone-digits>. Captura ambos numa só pass pra preservar ordem.
  const re = /(https?:\/\/[^\s<>"']+)|(@\d{7,15})/g;
  const out: Array<{ type: "url" | "text" | "mention"; value: string }> = [];
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) out.push({ type: "text", value: text.slice(lastIdx, m.index) });
    if (m[1]) {
      // URL
      let url = m[1];
      const trail = url.match(/[.,);!?]+$/);
      if (trail) url = url.slice(0, -trail[0].length);
      out.push({ type: "url", value: url });
      lastIdx = m.index + url.length;
    } else if (m[2]) {
      out.push({ type: "mention", value: m[2] });
      lastIdx = m.index + m[2].length;
    }
  }
  if (lastIdx < text.length) out.push({ type: "text", value: text.slice(lastIdx) });
  if (out.length === 0) out.push({ type: "text", value: text });
  return out;
}

// WhatsAppMarkdown — *bold*, _italic_, ~strike~, ```mono``` inline.
function WhatsAppMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const tokens: Array<{ type: "plain" | "bold" | "italic" | "strike" | "mono"; value: string }> = [];
  const re = /(```[^`\n]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) tokens.push({ type: "plain", value: text.slice(lastIdx, m.index) });
    const t = m[1];
    if (t.startsWith("```")) tokens.push({ type: "mono", value: t.slice(3, -3) });
    else if (t.startsWith("*")) tokens.push({ type: "bold", value: t.slice(1, -1) });
    else if (t.startsWith("_")) tokens.push({ type: "italic", value: t.slice(1, -1) });
    else if (t.startsWith("~")) tokens.push({ type: "strike", value: t.slice(1, -1) });
    lastIdx = m.index + t.length;
  }
  if (lastIdx < text.length) tokens.push({ type: "plain", value: text.slice(lastIdx) });
  if (tokens.length === 0) return <>{text}</>;
  return (
    <>
      {tokens.map((tk, i) => {
        switch (tk.type) {
          case "bold":
            return <strong key={i}>{tk.value}</strong>;
          case "italic":
            return <em key={i}>{tk.value}</em>;
          case "strike":
            return <s key={i}>{tk.value}</s>;
          case "mono":
            return (
              <code
                key={i}
                className="rounded px-1 py-0.5 text-[12px]"
                style={{ background: "var(--surface-2)", fontFamily: "monospace" }}
              >
                {tk.value}
              </code>
            );
          default:
            return <span key={i}>{tk.value}</span>;
        }
      })}
    </>
  );
}

function LinkPreviewCard({ url }: { url: string }) {
  const q = useQuery({
    queryKey: ["link-preview", url],
    queryFn: () => linkPreviewApi.get(url).then((r) => r.data),
    enabled: !!url,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  if (!q.data || q.data.fetch_err) return null;
  const { title, description, image_url, site_name, favicon_url } = q.data;
  if (!title && !description && !image_url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-md transition-opacity hover:opacity-95"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
        maxWidth: 320,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image_url} alt="" className="h-32 w-full object-cover" loading="lazy" />
      )}
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "hsl(240 8% 60%)" }}>
          {favicon_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={favicon_url} alt="" className="h-3 w-3" />
          )}
          <span className="truncate">{site_name || new URL(url).host}</span>
        </div>
        {title && (
          <div className="mt-0.5 text-xs font-medium line-clamp-2" style={{ color: "hsl(240 15% 92%)" }}>
            {title}
          </div>
        )}
        {description && (
          <div className="mt-0.5 text-[11px] line-clamp-2" style={{ color: "hsl(240 8% 65%)" }}>
            {description}
          </div>
        )}
      </div>
    </a>
  );
}

// Quando o backend não devolve url resolvida (presign falhou, bucket privado,
// migração de storage, etc.) mas tem media_key, tentamos construir uma URL
// via endpoint público do backend que faz o presign on-demand.
function buildMediaURL(mediaKey: string): string {
  if (!mediaKey) return "";
  const base = process.env.NEXT_PUBLIC_API_URL || "";
  return `${base}/v1/media/${encodeURIComponent(mediaKey)}`;
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
  mediaKey?: string;
  filename?: string;
  caption?: string;
  error?: string;
  mimeType?: string;
  latitude?: number;
  longitude?: number;
  // Location ao vivo
  isLive?: boolean;
  durationSec?: number;
  // Poll
  question?: string;
  pollOptions?: { name: string }[];
  multi?: boolean;
  // Contact
  displayName?: string;
  vcard?: string;
  phones?: { number: string; type?: string }[];
  // Contacts array
  contacts?: { display_name?: string; phones?: { number: string; type?: string }[] }[];
  // Address (location)
  name?: string;
  address?: string;
  // Reply (quoted)
  replyToId?: string;
  replyTo?: {
    id?: string;
    type?: string;
    text?: string;
    sender_name?: string;
    direction?: string;
    media_url?: string;
    mime_type?: string;
  };
  // Interactive / buttons / list
  interactive?: { type?: string; body?: string; header?: string; footer?: string };
  buttons?: { id?: string; title: string }[];
  listTitle?: string;
  listHeader?: string;
  listFooter?: string;
  listButtonText?: string;
  listSections?: { title?: string; rows: { id?: string; title: string; description?: string }[] }[];
  // Call
  callType?: string;
  callStatus?: string;
  callDurationSec?: number;
  // TTL / visibilidade
  isViewOnce?: boolean;
  isEphemeral?: boolean;
  // GIF — VideoMessage com gifPlayback=true; renderiza como autoplay+loop+muted
  isGif?: boolean;
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
        mediaKey: parsed.media_key,
        filename: parsed.filename,
        caption: parsed.caption,
        error: parsed.error,
        mimeType: parsed.mime_type,
        latitude: typeof parsed.latitude === "number" ? parsed.latitude : undefined,
        longitude: typeof parsed.longitude === "number" ? parsed.longitude : undefined,
        isLive: parsed.is_live === true,
        durationSec: typeof parsed.duration_sec === "number" ? parsed.duration_sec : undefined,
        question: parsed.question,
        pollOptions: Array.isArray(parsed.options) ? parsed.options : undefined,
        multi: parsed.multi === true,
        displayName: parsed.display_name,
        vcard: parsed.vcard,
        phones: Array.isArray(parsed.phones) ? parsed.phones : undefined,
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : undefined,
        name: parsed.name,
        address: parsed.address,
        replyToId: parsed.reply_to_id,
        replyTo: parsed.reply_to,
        interactive: parsed.interactive,
        buttons: Array.isArray(parsed.buttons) ? parsed.buttons : undefined,
        listSections: Array.isArray(parsed.sections) ? parsed.sections : undefined,
        listTitle: parsed.list_title,
        listFooter: parsed.footer,
        listHeader: parsed.header,
        listButtonText: parsed.button_text,
        callType: parsed.call_type,
        callStatus: parsed.call_status,
        callDurationSec: typeof parsed.call_duration_sec === "number" ? parsed.call_duration_sec : undefined,
        isViewOnce: parsed.is_view_once === true,
        isEphemeral: parsed.is_ephemeral === true,
        isGif: parsed.is_gif === true,
      };
    }
  } catch {
    /* not JSON — raw text */
  }
  return { text: raw };
}

function Composer({
  wsId, conversationId, instanceId, canSend, canNote, onSendMessage, onSendNote, isSending, isNoting,
  replyTo, onClearReply,
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
  replyTo?: MessagePayload | null;
  onClearReply?: () => void;
}) {
  const [mode, setMode] = useState<"message" | "note">("message");
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftKey = `inbox:draft:${conversationId}:${mode}`;

  // Send constraints — endpoint informa o que o canal aceita.
  // window_open=false + allows_template=true → fora da janela 24h, só template.
  // allowed_types informa o que mostrar como botão (image/audio/video/etc).
  const constraintsQ = useQuery({
    queryKey: ["send-constraints", wsId, conversationId],
    queryFn: () =>
      conversationsApi.sendConstraints(wsId as string, conversationId).then(
        (r) =>
          r.data as {
            channel: string;
            window_open: boolean;
            allows_template: boolean;
            supports_reply: boolean;
            supports_reaction: boolean;
            supports_edit: boolean;
            supports_revoke: boolean;
            allowed_types: string[];
            max_body_chars: number;
          },
      ),
    enabled: !!wsId && !!conversationId,
    staleTime: 60_000,
  });
  const constraints = constraintsQ.data;
  const allowsType = (t: string) => !constraints || constraints.allowed_types.includes(t);
  const windowClosed = !!constraints && !constraints.window_open;

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

  const tooLong = !!constraints && text.length > constraints.max_body_chars;
  const disabled =
    (!canSend && mode === "message") ||
    (!canNote && mode === "note") ||
    text.trim() === "" ||
    tooLong ||
    (mode === "message" && windowClosed && !constraints?.allows_template);

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
  // Múltiplos anexos: queue local, envio sequencial. Caption (text) vai
  // anexada ao PRIMEIRO item enviado; os demais vão sem caption.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_ATTACHMENTS = 10;
  const [pending, setPending] = useState<Array<{ id: string; file: File; preview?: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const onPickFile = () => fileInputRef.current?.click();

  // Aceita um ou vários Files (drag-drop, paste ou input). Centralizado pra
  // todos os caminhos de attach passarem pela mesma validação + preview.
  const acceptFiles = useCallback((files: File[] | FileList) => {
    if (!instanceId) {
      toast.error("Anexar requer instância conectada");
      return;
    }
    if (mode !== "message") return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setPending((prev) => {
      const remaining = MAX_ATTACHMENTS - prev.length;
      if (remaining <= 0) {
        toast.warning(`Máximo de ${MAX_ATTACHMENTS} anexos por envio`);
        return prev;
      }
      const slice = arr.slice(0, remaining);
      const additions = slice.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      }));
      if (arr.length > slice.length) {
        toast.warning(`${arr.length - slice.length} arquivo(s) ignorado(s) — limite ${MAX_ATTACHMENTS}`);
      }
      return [...prev, ...additions];
    });
  }, [instanceId, mode]);

  // Wrapper compatível pro paste que ainda recebe um único File
  const acceptFile = useCallback((file: File) => acceptFiles([file]), [acceptFiles]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (files && files.length > 0) acceptFiles(files);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.id !== id);
    });
  };

  // Drag-drop sobre o composer. Highlight visual + accept primeiro File.
  const [dragActive, setDragActive] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = () => setDragActive(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) acceptFiles(e.dataTransfer.files);
  };

  // Paste image — Ctrl+V de um screenshot/imagem do clipboard.
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (mode !== "message" || !instanceId) return;
      const target = e.target as HTMLElement | null;
      // Só intercepta paste na conversa (não em outros inputs da página)
      if (target && target.tagName === "INPUT") return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            acceptFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [mode, instanceId, acceptFile]);

  const clearPending = () => {
    setPending((prev) => {
      prev.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      return [];
    });
  };

  // Envia em sequência. Caption vai SOMENTE no primeiro (alinhado ao WhatsApp,
  // que só renderiza caption no primeiro media de uma "salva"). Se um falha,
  // os demais ainda tentam — feedback agregado no toast final.
  const sendAttachment = async () => {
    if (pending.length === 0 || !wsId || !instanceId) return;
    const caption = text.trim();
    setUploading(true);
    let okCount = 0;
    let failCount = 0;
    try {
      for (let i = 0; i < pending.length; i++) {
        const { file } = pending[i];
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
            caption: i === 0 && caption ? caption : undefined,
            filename: type === "document" ? file.name : undefined,
          });
          okCount++;
        } catch {
          failCount++;
        }
      }
      if (failCount === 0) {
        if (okCount > 1) toast.success(`${okCount} anexos enviados`);
      } else if (okCount === 0) {
        toast.error("Falha ao enviar anexos");
      } else {
        toast.warning(`${okCount} enviados, ${failCount} falharam`);
      }
      setText("");
      try { localStorage.removeItem(draftKey); } catch { /* noop */ }
      clearPending();
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

  const hasAttachment = pending.length > 0;

  return (
    <div
      className="p-3 relative"
      style={{
        background: composerBg,
        borderTop: "1px solid hsl(240 12% 16%)",
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragActive && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center rounded-md pointer-events-none"
          style={{
            background: "rgba(0,212,106,0.1)",
            border: "2px dashed #00d46a",
            color: "#00d46a",
          }}
        >
          <span className="text-sm font-medium">Solte para anexar</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
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

      {/* Pending attachments — múltiplos chips horizontais. Caption só vai no
          primeiro envio (alinhado ao WhatsApp). */}
      {hasAttachment && (
        <div
          className="mb-2 rounded-lg p-2"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div className="flex items-center justify-between gap-2 mb-2 px-1">
            <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 55%)" }}>
              {pending.length} anexo{pending.length > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPickFile}
                disabled={uploading || pending.length >= MAX_ATTACHMENTS}
                className="text-[10px] font-medium hover:underline disabled:opacity-40"
                style={{ color: "#00d46a" }}
              >
                + Adicionar
              </button>
              <button
                type="button"
                onClick={clearPending}
                disabled={uploading}
                className="text-[10px] hover:underline disabled:opacity-40"
                style={{ color: "hsl(240 8% 60%)" }}
              >
                Limpar tudo
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pending.map((att) => (
              <div
                key={att.id}
                className="relative flex-shrink-0 rounded-md"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-default)",
                  width: 84,
                }}
              >
                <button
                  type="button"
                  onClick={() => removePending(att.id)}
                  disabled={uploading}
                  title="Remover"
                  className="absolute -top-1.5 -right-1.5 z-10 rounded-full p-0.5 disabled:opacity-40"
                  style={{
                    background: "hsl(240 18% 8%)",
                    border: "1px solid hsl(240 12% 18%)",
                    color: "hsl(240 8% 70%)",
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                {att.preview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={att.preview} alt="" className="h-16 w-full rounded-t-md object-cover" />
                ) : (
                  <div
                    className="flex h-16 w-full items-center justify-center rounded-t-md"
                    style={{ background: "rgba(0,212,106,0.08)" }}
                  >
                    {att.file.type.startsWith("audio/") ? (
                      <Mic className="h-6 w-6" style={{ color: "#00d46a" }} />
                    ) : att.file.type.startsWith("video/") ? (
                      <ImageIcon className="h-6 w-6" style={{ color: "#00d46a" }} />
                    ) : (
                      <FileText className="h-6 w-6" style={{ color: "#00d46a" }} />
                    )}
                  </div>
                )}
                <div className="px-1.5 py-1">
                  <div className="truncate text-[10px]" style={{ color: "hsl(240 15% 88%)" }} title={att.file.name}>
                    {att.file.name}
                  </div>
                  <div className="text-[9px]" style={{ color: "hsl(240 8% 50%)" }}>
                    {humanSize(att.file.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
                        background: "var(--surface-2)",
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

        {replyTo && mode === "message" && (
          <div
            className="mb-2 flex items-start gap-2 rounded-md px-3 py-2 text-[11px]"
            style={{
              background: "rgba(0,212,106,0.06)",
              borderLeft: "3px solid #00d46a",
            }}
          >
            <CornerUpLeft className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: "#00d46a" }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium" style={{ color: "#00d46a" }}>
                Respondendo a {replyTo.sender_name || (replyTo.direction === "out" ? "você" : "cliente")}
              </div>
              <div className="truncate" style={{ color: "hsl(240 15% 80%)" }}>
                {replyPreviewText(replyTo)}
              </div>
            </div>
            {onClearReply && (
              <button
                type="button"
                onClick={onClearReply}
                className="rounded-full p-0.5 hover:bg-white/10"
                title="Cancelar resposta"
                style={{ color: "hsl(240 8% 60%)" }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Banner: janela 24h fechada (WABA/Instagram fora da janela) */}
        {mode === "message" && windowClosed && (
          <div
            className="mb-2 flex items-start gap-2 rounded-md px-3 py-2 text-[11px]"
            style={{
              background: "rgba(245,158,11,0.08)",
              borderLeft: "3px solid #f59e0b",
              color: "hsl(240 15% 88%)",
            }}
          >
            <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium" style={{ color: "#f59e0b" }}>
                Janela de 24h fechada
              </div>
              <div style={{ color: "hsl(240 8% 65%)" }}>
                {constraints?.allows_template
                  ? "Para iniciar conversa, use um template aprovado."
                  : "Aguarde o cliente responder pra reabrir o canal."}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onPickFile}
            disabled={!canSend || mode !== "message" || !instanceId || uploading || !allowsType("image")}
            title={
              !instanceId
                ? "Instância não disponível"
                : !allowsType("image")
                  ? "Canal não aceita anexos"
                  : "Anexar arquivo (foto, vídeo, áudio, doc)"
            }
            className="flex h-10 w-10 items-center justify-center rounded-md transition-colors disabled:opacity-40"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
              color: "hsl(240 8% 52%)",
            }}
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {/* Gravar áudio direto da plataforma — entrega como anexo pendente */}
          <AudioRecorderButton
            disabled={!canSend || mode !== "message" || !instanceId || uploading || !allowsType("audio")}
            onRecorded={(file) => acceptFiles([file])}
            title={
              !instanceId
                ? "Instância não disponível"
                : !allowsType("audio")
                  ? "Canal não aceita áudio"
                  : "Gravar áudio"
            }
          />

          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              disabled={!canSend || mode !== "message"}
              title="Emoji"
              className="flex h-10 w-10 items-center justify-center rounded-md transition-colors disabled:opacity-40"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-default)",
                color: emojiOpen ? "#00d46a" : "hsl(240 8% 52%)",
              }}
            >
              <Smile className="h-4 w-4" />
            </button>
            {emojiOpen && (
              <EmojiPickerPanel
                onPick={(e) => {
                  const ta = textareaRef.current;
                  if (!ta) {
                    setText((t) => t + e);
                    return;
                  }
                  const start = ta.selectionStart ?? text.length;
                  const end = ta.selectionEnd ?? text.length;
                  const next = text.slice(0, start) + e + text.slice(end);
                  setText(next);
                  // Reposiciona cursor após o emoji
                  requestAnimationFrame(() => {
                    ta.focus();
                    const pos = start + e.length;
                    ta.setSelectionRange(pos, pos);
                  });
                }}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </div>

          <textarea
            ref={textareaRef}
            className="min-h-[44px] max-h-40 flex-1 resize-y rounded-md px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--surface-2)",
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
            className="flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium disabled:opacity-50"
            style={{ background: accentBg, color: accentFg }}
            type="button"
          >
            {mode === "note" ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {hasAttachment ? (uploading ? "Enviando…" : "Enviar") : (mode === "note" ? "Adicionar" : "Enviar")}
          </button>
        </div>

        {/* Char counter — só aparece quando passa de 80% do limite do canal */}
        {constraints && mode === "message" && text.length > constraints.max_body_chars * 0.8 && (
          <div
            className="mt-1 text-right text-[10px] tabular-nums"
            style={{ color: tooLong ? "#ef4444" : "hsl(240 8% 55%)" }}
          >
            {text.length} / {constraints.max_body_chars}
          </div>
        )}
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
  // tone=primary é discreto: ícone verde + texto normal + borda fina.
  // Foi excessivamente azul/destacado antes; agora destaque é só pelo ícone.
  if (tone === "primary") {
    return (
      <button
        onClick={onClick}
        type="button"
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
        style={{
          background: "transparent",
          color: "hsl(240 15% 88%)",
          border: "1px solid hsl(240 12% 16%)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,212,106,0.06)";
          e.currentTarget.style.borderColor = "rgba(0,212,106,0.25)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "hsl(240 12% 16%)";
        }}
      >
        <span style={{ color: "#00d46a" }}>{icon}</span>
        {label}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
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


// ───────────────────────────────────────────────────────────────────────────
// Dialogs: Forward, Edit, MessageInfo
// ───────────────────────────────────────────────────────────────────────────

function ForwardDialog({
  wsId, msg, fromConversationId, onClose, onSubmit, isPending,
}: {
  wsId: string;
  msg: MessagePayload;
  fromConversationId: string;
  onClose: () => void;
  onSubmit: (ids: string[]) => void;
  isPending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listQ = useQuery({
    queryKey: ["forward-conversations", wsId, search],
    queryFn: () =>
      conversationsApi.list(wsId, { q: search || undefined, limit: 50 }).then(
        (r) => r.data as { items: Conversation[] },
      ),
    enabled: !!wsId,
  });
  const items = (listQ.data?.items || []).filter((c) => c.id !== fromConversationId);
  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center uniq-fade-in" style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl uniq-scale-in" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
          <h3 className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>Encaminhar mensagem</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-white/10" style={{ color: "hsl(240 8% 60%)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3">
          <div className="mb-2 rounded-md px-3 py-2 text-[11px]" style={{ background: "var(--surface-2)", borderLeft: "3px solid #00d46a" }}>
            <div className="font-medium" style={{ color: "hsl(240 15% 90%)" }}>
              {msg.sender_name || (msg.direction === "out" ? "Você" : "Cliente")}
            </div>
            <div className="truncate" style={{ color: "hsl(240 8% 60%)" }}>
              {replyPreviewText(msg)}
            </div>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "hsl(240 8% 50%)" }} />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato ou conversa…" className="w-full rounded-md py-2 pl-9 pr-3 text-sm outline-none" style={{ background: "var(--surface-2)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md" style={{ background: "var(--surface-2)" }}>
            {items.length === 0 ? (
              <div className="p-4 text-center text-xs" style={{ color: "hsl(240 8% 55%)" }}>
                {listQ.isLoading ? "Carregando…" : "Nenhuma conversa encontrada"}
              </div>
            ) : (
              <ul>
                {items.map((c) => {
                  const isSel = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => toggle(c.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: "hsl(240 15% 88%)" }}>
                        <span className="min-w-0 flex-1 truncate">{c.contact?.name || c.subject || c.channel_key}</span>
                        {isSel ? (
                          <Check className="h-4 w-4 flex-shrink-0" style={{ color: "#00d46a" }} />
                        ) : (
                          <span className="h-4 w-4 flex-shrink-0 rounded-full border" style={{ borderColor: "hsl(240 8% 30%)" }} />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs" style={{ color: "hsl(240 8% 70%)" }}>Cancelar</button>
          <button type="button" onClick={() => onSubmit(Array.from(selected))} disabled={selected.size === 0 || isPending} className="rounded-md px-4 py-1.5 text-xs font-medium disabled:opacity-50" style={{ background: "#00d46a", color: "#03170a" }}>
            {isPending ? "Enviando…" : `Encaminhar ${selected.size > 0 ? `(${selected.size})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMessageDialog({
  msg, onClose, onSubmit, isPending,
}: {
  msg: MessagePayload;
  onClose: () => void;
  onSubmit: (body: string) => void;
  isPending: boolean;
}) {
  const initial = parseMessageContent(msg.content).text || "";
  const [text, setText] = useState(initial);
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center uniq-fade-in" style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl uniq-scale-in" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
          <h3 className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>Editar mensagem</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-white/10" style={{ color: "hsl(240 8% 60%)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3">
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded-md px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-2)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} />
          <p className="mt-1 text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>WhatsApp aceita edição em até 15 minutos do envio.</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs" style={{ color: "hsl(240 8% 70%)" }}>Cancelar</button>
          <button type="button" onClick={() => onSubmit(text.trim())} disabled={text.trim() === "" || text.trim() === initial || isPending} className="rounded-md px-4 py-1.5 text-xs font-medium disabled:opacity-50" style={{ background: "#00d46a", color: "#03170a" }}>
            {isPending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageInfoDialog({
  wsId, conversationId, msg, onClose,
}: {
  wsId: string;
  conversationId: string;
  msg: MessagePayload;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["msg-receipts", wsId, conversationId, msg.id],
    queryFn: () =>
      conversationsApi.getMessageReceipts(wsId, conversationId, msg.id).then(
        (r) =>
          r.data as {
            delivered: Array<{ participant_jid: string; timestamp: string }>;
            read: Array<{ participant_jid: string; timestamp: string }>;
            delivered_at?: string | null;
            read_at?: string | null;
          },
      ),
    refetchInterval: 5_000,
  });
  const data = q.data;
  const fmt = (ts?: string | null) => (ts ? new Date(ts).toLocaleString("pt-BR") : "—");
  const phone = (jid: string) => jid.split("@")[0];
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center uniq-fade-in" style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl uniq-scale-in" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
          <h3 className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>Informações da mensagem</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-white/10" style={{ color: "hsl(240 8% 60%)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3">
          <div className="mb-3 rounded-md px-3 py-2 text-[11px]" style={{ background: "var(--surface-2)" }}>
            <div className="font-medium" style={{ color: "hsl(240 15% 90%)" }}>{replyPreviewText(msg)}</div>
            <div className="mt-0.5 text-[10px]" style={{ color: "hsl(240 8% 55%)" }}>Enviada {fmt(msg.created_at)}</div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <StatusCard label="Entregue" when={msg.delivered_at || data?.delivered_at} icon={<CheckCheck className="h-3 w-3" />} color="hsl(240 8% 65%)" />
            <StatusCard label="Lida" when={msg.read_at || data?.read_at} icon={<CheckCheck className="h-3 w-3" />} color="#00d46a" />
          </div>
          {(data?.read?.length || data?.delivered?.length) ? (
            <div className="space-y-3">
              {data && data.read.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest" style={{ color: "#00d46a" }}>
                    <CheckCheck className="h-3 w-3" /> Lida por · {data.read.length}
                  </div>
                  <ul className="space-y-1">
                    {data.read.map((r, i) => (
                      <li key={i} className="flex items-center justify-between text-xs" style={{ color: "hsl(240 15% 88%)" }}>
                        <span className="font-mono">{phone(r.participant_jid)}</span>
                        <span className="text-[10px]" style={{ color: "hsl(240 8% 60%)" }}>{fmt(r.timestamp)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data && data.delivered.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 65%)" }}>
                    <CheckCheck className="h-3 w-3" /> Entregue a · {data.delivered.length}
                  </div>
                  <ul className="space-y-1">
                    {data.delivered.map((r, i) => (
                      <li key={i} className="flex items-center justify-between text-xs" style={{ color: "hsl(240 15% 88%)" }}>
                        <span className="font-mono">{phone(r.participant_jid)}</span>
                        <span className="text-[10px]" style={{ color: "hsl(240 8% 60%)" }}>{fmt(r.timestamp)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
          {q.isLoading && (
            <div className="text-center text-xs py-2" style={{ color: "hsl(240 8% 55%)" }}>Carregando…</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  label, when, icon, color,
}: {
  label: string;
  when?: string | null;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-md px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid hsl(240 12% 14%)" }}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest" style={{ color }}>
        {icon} {label}
      </div>
      <div className="mt-0.5 text-xs" style={{ color: when ? "hsl(240 15% 88%)" : "hsl(240 8% 50%)" }}>
        {when ? new Date(when).toLocaleString("pt-BR") : "Aguardando"}
      </div>
    </div>
  );
}



// EmojiPickerPanel — picker compacto in-file (sem dependência externa).
// Categorias básicas; busca por nome. Emoji frequents in localStorage.
function EmojiPickerPanel({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("inbox:emoji-recent");
      if (raw) setRecent(JSON.parse(raw).slice(0, 16));
    } catch { /* noop */ }
  }, []);

  const pick = (e: string) => {
    onPick(e);
    setRecent((r) => {
      const next = [e, ...r.filter((x) => x !== e)].slice(0, 16);
      try { localStorage.setItem("inbox:emoji-recent", JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  // Click outside fecha
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-emoji-picker]")) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = (cat: { label: string; emojis: { e: string; n: string }[] }) => {
    if (!search) return cat.emojis;
    const q = search.toLowerCase();
    return cat.emojis.filter((it) => it.n.includes(q));
  };

  return (
    <div
      data-emoji-picker
      className="absolute bottom-full mb-2 left-0 z-50 w-72 rounded-lg shadow-2xl"
      style={{
        background: "hsl(240 18% 7%)",
        border: "1px solid hsl(240 12% 16%)",
        maxHeight: 360,
      }}
    >
      <div className="p-2 border-b" style={{ borderColor: "hsl(240 12% 14%)" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar emoji..."
          autoFocus
          className="w-full rounded px-2 py-1 text-xs outline-none"
          style={{ background: "var(--surface-2)", color: "hsl(240 15% 90%)", border: "1px solid hsl(240 12% 16%)" }}
        />
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
        {!search && recent.length > 0 && (
          <Section title="Recentes">
            {recent.map((e, i) => (
              <button key={i} type="button" onClick={() => pick(e)} className="text-xl leading-none p-1 rounded hover:bg-white/5">{e}</button>
            ))}
          </Section>
        )}
        {EMOJI_CATEGORIES.map((cat) => {
          const items = filtered(cat);
          if (items.length === 0) return null;
          return (
            <Section key={cat.label} title={cat.label}>
              {items.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(it.e)}
                  title={it.n}
                  className="text-xl leading-none p-1 rounded hover:bg-white/5"
                >
                  {it.e}
                </button>
              ))}
            </Section>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 50%)" }}>
        {title}
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {children}
      </div>
    </div>
  );
}

const EMOJI_CATEGORIES: Array<{ label: string; emojis: { e: string; n: string }[] }> = [
  {
    label: "Smileys",
    emojis: [
      { e: "😀", n: "feliz" }, { e: "😁", n: "sorrir" }, { e: "😂", n: "rir" },
      { e: "🤣", n: "gargalhar" }, { e: "😊", n: "fofo" }, { e: "😇", n: "anjo" },
      { e: "🙂", n: "leve" }, { e: "😉", n: "piscar" }, { e: "😍", n: "amor" },
      { e: "🥰", n: "amoroso" }, { e: "😘", n: "beijo" }, { e: "😎", n: "legal" },
      { e: "🤩", n: "estrela" }, { e: "🤔", n: "pensando" }, { e: "😐", n: "neutro" },
      { e: "😴", n: "dormindo" }, { e: "🤯", n: "explodir" }, { e: "🥳", n: "festa" },
      { e: "😢", n: "triste" }, { e: "😭", n: "chorar" }, { e: "😤", n: "bufar" },
      { e: "😠", n: "raiva" }, { e: "😡", n: "furioso" }, { e: "🤬", n: "xingar" },
      { e: "😱", n: "assustado" }, { e: "😨", n: "medo" }, { e: "🤢", n: "enjoado" },
      { e: "🤮", n: "vomitar" }, { e: "🥺", n: "pidao" }, { e: "🙄", n: "olhos" },
    ],
  },
  {
    label: "Mãos",
    emojis: [
      { e: "👍", n: "joinha" }, { e: "👎", n: "joia baixo" }, { e: "👏", n: "palmas" },
      { e: "🙌", n: "viva" }, { e: "🤝", n: "aperto mao" }, { e: "🙏", n: "obrigado" },
      { e: "💪", n: "forca" }, { e: "👌", n: "ok" }, { e: "✌️", n: "paz" },
      { e: "🤞", n: "sorte" }, { e: "🤟", n: "amor metal" }, { e: "🤘", n: "rock" },
      { e: "👋", n: "aceno tchau" }, { e: "🫶", n: "coracao mao" }, { e: "🫡", n: "saudar" },
      { e: "🤲", n: "duas maos" },
    ],
  },
  {
    label: "Coração",
    emojis: [
      { e: "❤️", n: "amor" }, { e: "🧡", n: "laranja" }, { e: "💛", n: "amarelo" },
      { e: "💚", n: "verde" }, { e: "💙", n: "azul" }, { e: "💜", n: "roxo" },
      { e: "🖤", n: "preto" }, { e: "🤍", n: "branco" }, { e: "🤎", n: "marrom" },
      { e: "💔", n: "partido" }, { e: "❣️", n: "exclamacao" }, { e: "💕", n: "dois" },
      { e: "💞", n: "girando" }, { e: "💓", n: "batendo" }, { e: "💗", n: "crescendo" },
      { e: "💖", n: "brilhando" }, { e: "💘", n: "flecha" }, { e: "💝", n: "presente" },
    ],
  },
  {
    label: "Objetos",
    emojis: [
      { e: "🔥", n: "fogo" }, { e: "✨", n: "brilho" }, { e: "🎉", n: "festa" },
      { e: "🎊", n: "confete" }, { e: "🎁", n: "presente" }, { e: "💯", n: "100" },
      { e: "💰", n: "dinheiro" }, { e: "💸", n: "voando" }, { e: "💎", n: "diamante" },
      { e: "🏆", n: "trofeu" }, { e: "🥇", n: "primeiro" }, { e: "🎯", n: "alvo" },
      { e: "📌", n: "fixar" }, { e: "📎", n: "clipe" }, { e: "✅", n: "check" },
      { e: "❌", n: "x" }, { e: "⚠️", n: "alerta" }, { e: "❓", n: "pergunta" },
      { e: "💡", n: "ideia" }, { e: "📞", n: "telefone" }, { e: "📱", n: "celular" },
      { e: "💻", n: "computador" }, { e: "📧", n: "email" }, { e: "🔔", n: "sino" },
    ],
  },
  {
    label: "Comida",
    emojis: [
      { e: "🍕", n: "pizza" }, { e: "🍔", n: "hamburguer" }, { e: "🍟", n: "batata" },
      { e: "🌮", n: "taco" }, { e: "🍣", n: "sushi" }, { e: "🍜", n: "lamen" },
      { e: "🍰", n: "bolo" }, { e: "🍦", n: "sorvete" }, { e: "🍩", n: "rosquinha" },
      { e: "☕", n: "cafe" }, { e: "🍺", n: "cerveja" }, { e: "🍷", n: "vinho" },
      { e: "🥂", n: "brinde" }, { e: "🥃", n: "whisky" }, { e: "🧉", n: "chimarrao" },
    ],
  },
];


// SnoozeDialog — substitui prompt() nativo. Presets de duração + custom.
function SnoozeDialog({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (iso: string) => void;
}) {
  const [hours, setHours] = useState(4);
  const presets: Array<{ label: string; h: number }> = [
    { label: "1 hora", h: 1 },
    { label: "4 horas", h: 4 },
    { label: "Final do expediente (8h)", h: 8 },
    { label: "Amanhã (24h)", h: 24 },
    { label: "Próxima semana", h: 24 * 7 },
  ];
  const submit = (h: number) => {
    if (h <= 0) return;
    onSubmit(new Date(Date.now() + h * 3600_000).toISOString());
  };
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center uniq-fade-in" style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl uniq-scale-in" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
          <h3 className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>Colocar em soneca</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-white/10" style={{ color: "hsl(240 8% 60%)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {presets.map((p) => (
            <button
              key={p.h}
              type="button"
              onClick={() => submit(p.h)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5"
              style={{ color: "hsl(240 15% 88%)", border: "1px solid hsl(240 12% 16%)" }}
            >
              <span className="flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5" style={{ color: "hsl(240 8% 55%)" }} />
                {p.label}
              </span>
              <span className="text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>
                até {new Date(Date.now() + p.h * 3600_000).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
              </span>
            </button>
          ))}
          <div className="border-t pt-3 mt-3" style={{ borderColor: "hsl(240 12% 14%)" }}>
            <div className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 55%)" }}>
              Personalizar
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(parseInt(e.target.value) || 0)}
                className="w-20 rounded-md px-2 py-1.5 text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}
              />
              <span className="text-xs" style={{ color: "hsl(240 8% 60%)" }}>horas</span>
              <button
                type="button"
                onClick={() => submit(hours)}
                disabled={hours <= 0}
                className="ml-auto rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                style={{ background: "#00d46a", color: "#03170a" }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
