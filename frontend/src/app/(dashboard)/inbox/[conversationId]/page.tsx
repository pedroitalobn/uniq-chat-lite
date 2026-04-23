"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Send, StickyNote, CheckCircle2, Clock3, RotateCcw,
  UserCheck, UserX, ArrowRightLeft, Bot, BotOff, Lock, AlertTriangle,
} from "lucide-react";
import { conversationsApi, queuesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { relativeTime } from "@/components/atendimento/ConversationList";

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
            </div>
            <p className="truncate text-xs text-zinc-500">
              {conv?.channel_type} · {conv?.channel_key}
              {conv?.assigned_user?.name && ` · responsável ${conv.assigned_user.name}`}
              {!conv?.assigned_user && " · sem responsável"}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-zinc-50 px-5 py-6 dark:bg-zinc-950/50">
          {timeline.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">
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
          {canTransfer && queuesQ.data?.items && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <ArrowRightLeft className="h-4 w-4" />
                Transferir para fila
              </summary>
              <ul className="mt-1 space-y-0.5 pl-6">
                {queuesQ.data.items.map((q) => (
                  <li key={q.id}>
                    <button
                      onClick={() => transfer.mutate(q.id)}
                      className="block w-full rounded-md px-2 py-1 text-left text-xs text-zinc-600 hover:bg-blue-500/10 hover:text-blue-600 dark:text-zinc-300"
                    >
                      {q.name}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
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
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({ m }: { m: MessagePayload }) {
  const isOut = m.direction === "out";
  const text = parseContent(m.content);
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
          isOut
            ? "rounded-br-sm bg-blue-600 text-white"
            : "rounded-bl-sm bg-white text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        }`}
      >
        {!isOut && m.sender_name && <div className="mb-0.5 text-xs font-medium opacity-70">{m.sender_name}</div>}
        <p className="whitespace-pre-wrap">{text || "—"}</p>
        <div className={`mt-1 text-[10px] ${isOut ? "text-blue-100" : "text-zinc-400"}`}>
          {relativeTime(m.created_at)}
          {isOut && m.status && m.status !== "sent" && ` · ${m.status}`}
        </div>
      </div>
    </div>
  );
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

function parseContent(raw: string): string {
  if (!raw) return "";
  // Payloads often arrive as JSON-encoded strings ("texto") or {text,caption}
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      return parsed.text || parsed.caption || parsed.body || raw;
    }
  } catch {
    /* not JSON — fall through */
  }
  return raw;
}

function Composer({
  canSend, canNote, onSendMessage, onSendNote, isSending, isNoting,
}: {
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

  const disabled =
    (!canSend && mode === "message") || (!canNote && mode === "note") || text.trim() === "";

  const submit = () => {
    if (disabled) return;
    const body = text.trim();
    if (mode === "message") onSendMessage(body);
    else onSendNote(body);
    setText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

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
          {mode === "message" ? "Enter envia · Shift+Enter quebra linha" : "Nota visível só para a equipe"}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className={`min-h-[44px] max-h-40 flex-1 resize-y rounded-md border px-3 py-2 text-sm outline-none ${
            mode === "note"
              ? "border-amber-300 bg-white focus:border-amber-500 dark:border-amber-500/30 dark:bg-zinc-900"
              : "border-zinc-200 bg-white focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          }`}
          placeholder={mode === "message" ? "Digite sua mensagem…" : "Registre uma nota interna…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
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
