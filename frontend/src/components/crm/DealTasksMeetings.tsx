"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { crmTasksApi, crmMeetingsApi, CrmTask, CrmMeeting } from "@/lib/api";
import { Plus, ListTodo, CalendarClock, CheckCircle2, Bot, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// Embed compacto pra mostrar tarefas e reuniões vinculadas a um deal
// dentro do drawer/detalhe. Cria rápido inline (título + due/start)
// e linka pra página completa pra edição mais elaborada.
export function DealTasksMeetings({ workspaceId, dealId, contactId }: {
  workspaceId: string;
  dealId: string;
  contactId?: string;
}) {
  return (
    <div className="space-y-4">
      <TasksSection workspaceId={workspaceId} dealId={dealId} contactId={contactId} />
      <MeetingsSection workspaceId={workspaceId} dealId={dealId} contactId={contactId} />
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function TasksSection({ workspaceId, dealId, contactId }: { workspaceId: string; dealId: string; contactId?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["deal-tasks", workspaceId, dealId],
    queryFn: () => crmTasksApi.list(workspaceId, { deal_id: dealId, limit: 20 }).then((r) => r.data),
    enabled: !!workspaceId && !!dealId,
  });
  const tasks: CrmTask[] = data?.items ?? [];

  const createMut = useMutation({
    mutationFn: () => crmTasksApi.create(workspaceId, {
      title: title.trim(),
      type: "follow_up",
      deal_id: dealId,
      contact_id: contactId,
      due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
    }),
    onSuccess: () => {
      setTitle(""); setDueAt(""); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["deal-tasks", workspaceId, dealId] });
    },
    onError: () => toast.error("Erro ao criar tarefa"),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => crmTasksApi.complete(workspaceId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deal-tasks", workspaceId, dealId] }),
  });

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
          <ListTodo className="w-3 h-3" /> Tarefas <span className="font-mono normal-case opacity-70">({tasks.length})</span>
        </h4>
        <div className="flex items-center gap-1">
          <Link href="/crm/tasks" className="text-[10px]" style={{ color: "var(--text-3)" }}>
            <ExternalLink className="w-3 h-3" />
          </Link>
          <button onClick={() => setShowForm((s) => !s)} className="text-[10px] inline-flex items-center gap-1"
            style={{ color: "var(--text-2)" }}>
            <Plus className="w-3 h-3" /> Nova
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-2 space-y-1.5 rounded-lg p-2" style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que precisa ser feito?"
            className="w-full px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
          <div className="flex items-center gap-1.5">
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
            <button onClick={() => createMut.mutate()} disabled={!title.trim() || createMut.isPending}
              className="px-2 py-1.5 rounded text-[11px] font-medium disabled:opacity-50"
              style={{ background: "#00d46a", color: "#03170a" }}>
              {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Criar"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-3 flex justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--text-3)" }} /></div>
      ) : tasks.length === 0 ? (
        <p className="text-[11px] py-1" style={{ color: "var(--text-3)" }}>Nenhuma tarefa neste deal.</p>
      ) : (
        <ul className="space-y-1">
          {tasks.slice(0, 5).map((t) => {
            const done = t.status === "completed" || t.status === "cancelled";
            return (
              <li key={t.id} className="flex items-center gap-2">
                <button onClick={() => !done && completeMut.mutate(t.id)} disabled={done}
                  className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center"
                  style={done
                    ? { background: "rgba(0,212,106,0.18)", border: "1px solid rgba(0,212,106,0.4)" }
                    : { background: "transparent", border: "1px solid hsl(240 12% 22%)" }}>
                  {done && <CheckCircle2 className="w-2.5 h-2.5" style={{ color: "#00d46a" }} />}
                </button>
                <span className="flex-1 text-xs truncate"
                  style={{ color: done ? "var(--text-3)" : "var(--text-2)", textDecoration: done ? "line-through" : undefined }}>
                  {t.title}
                </span>
                {t.assignee_type === "agent" && (
                  <Bot className="w-3 h-3 flex-shrink-0" style={{ color: "#a78bfa" }} />
                )}
                {t.due_at && (
                  <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
                    {new Date(t.due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Meetings ─────────────────────────────────────────────────────────────────
function MeetingsSection({ workspaceId, dealId, contactId }: { workspaceId: string; dealId: string; contactId?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["deal-meetings", workspaceId, dealId],
    queryFn: () => crmMeetingsApi.list(workspaceId, { deal_id: dealId, limit: 20 }).then((r) => r.data),
    enabled: !!workspaceId && !!dealId,
  });
  const meetings: CrmMeeting[] = data?.items ?? [];

  const createMut = useMutation({
    mutationFn: () => crmMeetingsApi.create(workspaceId, {
      title: title.trim(),
      deal_id: dealId,
      contact_id: contactId,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
    }),
    onSuccess: () => {
      setTitle(""); setStartAt(""); setEndAt(""); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["deal-meetings", workspaceId, dealId] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error || "Erro ao agendar reunião"),
  });

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
          <CalendarClock className="w-3 h-3" /> Reuniões <span className="font-mono normal-case opacity-70">({meetings.length})</span>
        </h4>
        <div className="flex items-center gap-1">
          <Link href="/crm/meetings" className="text-[10px]" style={{ color: "var(--text-3)" }}>
            <ExternalLink className="w-3 h-3" />
          </Link>
          <button onClick={() => setShowForm((s) => !s)} className="text-[10px] inline-flex items-center gap-1"
            style={{ color: "var(--text-2)" }}>
            <Plus className="w-3 h-3" /> Agendar
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-2 space-y-1.5 rounded-lg p-2" style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da reunião"
            className="w-full px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
          <div className="grid grid-cols-2 gap-1.5">
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
              className="px-2 py-1.5 rounded text-xs outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)}
              className="px-2 py-1.5 rounded text-xs outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
          </div>
          <button onClick={() => createMut.mutate()}
            disabled={!title.trim() || !startAt || !endAt || createMut.isPending}
            className="w-full px-2 py-1.5 rounded text-[11px] font-medium disabled:opacity-50"
            style={{ background: "#00d46a", color: "#03170a" }}>
            {createMut.isPending ? "Salvando..." : "Agendar"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="py-3 flex justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--text-3)" }} /></div>
      ) : meetings.length === 0 ? (
        <p className="text-[11px] py-1" style={{ color: "var(--text-3)" }}>Nenhuma reunião agendada.</p>
      ) : (
        <ul className="space-y-1">
          {meetings.slice(0, 5).map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <CalendarClock className="w-3 h-3 flex-shrink-0" style={{ color: "var(--text-3)" }} />
              <span className="flex-1 text-xs truncate" style={{ color: "var(--text-2)" }}>{m.title}</span>
              <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
                {new Date(m.start_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
