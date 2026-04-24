"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Send, StickyNote, CheckCircle2, Clock3, RotateCcw,
  UserCheck, UserX, ArrowRightLeft, Bot, BotOff, Lock, AlertTriangle,
  Smile, X, Star, Mic, Image as ImageIcon, FileText, MapPin, Check,
  CheckCheck, AlertCircle,
} from "lucide-react";
import { conversationsApi, queuesApi, quickRepliesApi, teamsApi, workspacesApi, csatApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { relativeTime } from "@/components/atendimento/ConversationList";
import { useConversationWS, type WSEvent } from "@/hooks/useConversationWS";

interface Conversation {
  id: string;
  workspace_id: string;
  instance_id: string;
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

export default function ConversationDetailPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;

  const canView = hasPerm(PERM.ticketsView);
  const canSend = hasPerm(PERM.inboxSend);
  const canAssign = hasPerm(PERM.ticketsAssign);
  const canTransfer = hasPerm(PERM.ticketsTransfer);
  const canClose = hasPerm(PERM.ticketsClose);
  const canReopen = hasPerm(PERM.ticketsReopen);
  const canSnooze = hasPerm(PERM.ticketsSnooze);
  const canUpdate = hasPerm(PERM.ticketsUpdate);
  const canNote = hasPerm(PERM.notesCreate);

  const [transferOpen, setTransferOpen] = useState(false);

  const convQ = useQuery({
    queryKey: ["conversation", wsId, conversationId],
    queryFn: () => conversationsApi.get(wsId as string, conversationId).then((r) => r.data as Conversation),
    enabled: !!wsId && canView,
    refetchInterval: 10_000,
  });

  const timelineQ = useQuery({
    queryKey: ["conversation-timeline", wsId, conversationId],
    queryFn: () => conversationsApi.timeline(wsId as string, conversationId).then((r) => r.data as TimelinePayload),
    enabled: !!wsId && canView,
    refetchInterval: 5_000,
  });

  const queuesQ = useQuery({
    queryKey: ["queues", wsId],
    queryFn: () => queuesApi.list(wsId as string).then((r) => r.data as { items: Queue[] }),
    enabled: !!wsId && canView,
  });

  // Mark read on open
  useEffect(() => {
    if (!wsId || !canView) return;
    conversationsApi.markRead(wsId, conversationId).catch(() => {});
  }, [wsId, canView, conversationId]);

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
  const timeline = useMemo(
    () => timelineQ.data?.items?.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()) ?? [],
    [timelineQ.data]
  );
  const status = conv ? STATUS_LABELS[conv.status] ?? STATUS_LABELS.open : null;

  // SLA breach indicator: scan the audit events for a sla_breached row; if
  // present we show a red pill. Lightweight — no extra query.
  const slaBreached = useMemo(() => {
    const items = timelineQ.data?.items ?? [];
    return items.some((e) => e.kind === "event" && (e.payload as EventPayload).event_type === "sla_breached");
  }, [timelineQ.data]);

  return (
    <div className="flex h-full min-h-0">
      {/* Main pane: header + timeline + composer */}
      <section className="flex flex-1 min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <Link
            href="/inbox/mine"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
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
            <p className="truncate text-xs text-zinc-500">
              {conv?.channel_type} · {conv?.channel_key}
              {conv?.assigned_user?.name && ` · responsável ${conv.assigned_user.name}`}
              {!conv?.assigned_user && " · sem responsável"}
            </p>
          </div>
        </header>

        <div
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
              {timeline.map((e) => (
                <li key={`${e.kind}-${e.id}`}>
                  {e.kind === "message" ? (
                    <MessageBubble m={e.payload as MessagePayload} />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">Transferir atendimento</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          {(["queue", "team", "user"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2 text-sm ${
                tab === t
                  ? "border-b-2 border-blue-500 font-medium text-blue-600 dark:text-blue-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
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

function MessageBubble({ m }: { m: MessagePayload }) {
  const isOut = m.direction === "out";
  const parsed = parseMessageContent(m.content);
  // Reaction — bolha compacta só com emoji grande
  if (m.type === "reaction") {
    return (
      <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
        <div
          className="rounded-2xl px-3 py-1 text-2xl"
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

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[80%] rounded-2xl px-3 py-2 shadow-sm"
        style={
          isOut
            ? {
                background: "rgba(0,212,106,0.12)",
                border: "1px solid rgba(0,212,106,0.25)",
                color: "hsl(240 15% 92%)",
                borderBottomRightRadius: 6,
              }
            : {
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "hsl(240 15% 90%)",
                borderBottomLeftRadius: 6,
              }
        }
      >
        {!isOut && m.sender_name && (
          <div
            className="mb-0.5 text-[11px] font-medium"
            style={{ color: "#00d46a" }}
          >
            {m.sender_name}
          </div>
        )}

        <MediaBody type={m.type} parsed={parsed} />

        <div
          className="mt-1 flex items-center justify-end gap-1 text-[10px]"
          style={{ color: isOut ? "rgba(255,255,255,0.55)" : "hsl(240 8% 44%)" }}
        >
          <span>{relativeTime(m.created_at)}</span>
          {isOut && <StatusTicks status={m.status} />}
        </div>
      </div>
    </div>
  );
}

// MediaBody — renderiza o conteúdo conforme msg.type. Aceita tanto o formato
// legacy (content JSON-encoded string) quanto o novo ({url, mime_type,
// filename, caption, error}). Mantém paridade total com o inbox clássico.
function MediaBody({
  type, parsed,
}: {
  type: string;
  parsed: ParsedContent;
}) {
  const { text, url, filename, caption, error, latitude, longitude } = parsed;
  const body = caption || text;

  if (type === "image") {
    if (url) {
      return (
        <div className="flex flex-col gap-1.5">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={filename || "imagem"}
              className="max-h-[280px] max-w-[280px] rounded-lg object-cover"
            />
          </a>
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
          <video src={url} controls className="max-w-[320px] rounded-lg" />
          {body && <Text text={body} />}
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<ImageIcon className="h-4 w-4" />} label={body || "Vídeo"} />;
  }

  if (type === "audio") {
    if (url) {
      return (
        <div className="flex flex-col gap-1.5">
          <audio src={url} controls className="max-w-[260px]" />
          {error && <ErrorLine text={error} />}
        </div>
      );
    }
    return <IconFallback icon={<Mic className="h-4 w-4" />} label={body || "Áudio"} />;
  }

  if (type === "document") {
    if (url) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-white/5"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <FileText className="h-5 w-5 flex-shrink-0" style={{ color: "hsl(240 8% 70%)" }} />
          <span className="truncate text-xs">{filename || "Documento"}</span>
        </a>
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
  wsId, conversationId, canSend, canNote, onSendMessage, onSendNote, isSending, isNoting,
}: {
  wsId?: string;
  conversationId: string;
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

  return (
    <div
      className={`border-t border-zinc-200 p-3 dark:border-zinc-800 ${
        mode === "note" ? "bg-amber-50/60 dark:bg-amber-950/20" : "bg-white dark:bg-zinc-950"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <button
          onClick={() => setMode("message")}
          className={`rounded-md px-2 py-1 font-medium ${
            mode === "message"
              ? "bg-blue-600 text-white"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
          disabled={!canSend}
          type="button"
        >
          Mensagem
        </button>
        <button
          onClick={() => setMode("note")}
          className={`rounded-md px-2 py-1 font-medium ${
            mode === "note"
              ? "bg-amber-500 text-white"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
          disabled={!canNote}
          type="button"
        >
          Nota interna
        </button>
        <span className="ml-auto text-zinc-400">
          {mode === "message"
            ? "Enter envia · Shift+Enter quebra linha · / resposta rápida"
            : "Nota visível só para a equipe"}
        </span>
      </div>

      <div className="relative">
        {pickerOpen && (
          <div className="absolute bottom-full left-0 right-20 mb-2 max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800">
              <Smile className="h-3.5 w-3.5" /> Respostas rápidas · {pickerItems.length}
            </div>
            <ul>
              {pickerItems.map((qr, i) => (
                <li key={qr.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setPickerIndex(i)}
                    onClick={() => applyQuickReply(qr)}
                    className={`flex w-full items-start gap-3 px-3 py-2 text-left ${
                      i === pickerIndex ? "bg-blue-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="mt-0.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {qr.shortcut || "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      {qr.title && <div className="text-xs font-medium">{qr.title}</div>}
                      <div className="line-clamp-2 text-xs text-zinc-500">{qr.body}</div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            className={`min-h-[44px] max-h-40 flex-1 resize-y rounded-md border px-3 py-2 text-sm outline-none ${
              mode === "note"
                ? "border-amber-300 bg-white focus:border-amber-500 dark:border-amber-500/30 dark:bg-zinc-900"
                : "border-zinc-200 bg-white focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            }`}
            placeholder={mode === "message" ? "Digite sua mensagem… (/ para respostas rápidas)" : "Registre uma nota interna…"}
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
                submit();
              }
            }}
          />
          <button
            onClick={submit}
            disabled={disabled || isSending || isNoting}
            className={`flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-white disabled:opacity-50 ${
              mode === "note" ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
            }`}
            type="button"
          >
            {mode === "note" ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {mode === "note" ? "Adicionar" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
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
