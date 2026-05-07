"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { crmTasksApi, CrmTask, workspacesApi } from "@/lib/api";
import {
  Plus, ListTodo, Phone, MessageSquare, Calendar, Mail, Bot, User, Loader2,
  CheckCircle2, Clock, AlertCircle, Trash2, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { CrmHeader, CrmHeaderButton } from "@/components/crm/CrmHeader";

const TYPE_META: Record<CrmTask["type"], { label: string; icon: React.ElementType }> = {
  call:         { label: "Ligação",     icon: Phone },
  follow_up:    { label: "Follow-up",   icon: ListTodo },
  message:      { label: "Mensagem",    icon: MessageSquare },
  meeting_prep: { label: "Preparação",  icon: Calendar },
  email:        { label: "E-mail",      icon: Mail },
  custom:       { label: "Outro",       icon: ListTodo },
};

const STATUS_FILTERS: { id: "all" | CrmTask["status"]; label: string; color: string }[] = [
  { id: "all",         label: "Todas",          color: "hsl(240 8% 60%)" },
  { id: "pending",     label: "Pendentes",      color: "#fbbf24" },
  { id: "in_progress", label: "Em andamento",   color: "#60a5fa" },
  { id: "completed",   label: "Concluídas",     color: "#00d46a" },
  { id: "cancelled",   label: "Canceladas",     color: "hsl(240 8% 50%)" },
];

export default function TasksPage() {
  const { currentWorkspace } = useWorkspace();
  const wsID = currentWorkspace?.id ?? "";
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | CrmTask["status"]>("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmTask | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["crm-tasks", wsID, statusFilter],
    queryFn: () => crmTasksApi.list(wsID, statusFilter !== "all" ? { status: statusFilter } : undefined).then((r) => r.data),
    enabled: !!wsID,
  });

  const tasks: CrmTask[] = data?.items ?? [];
  const groups = useMemo(() => {
    const overdue: CrmTask[] = [];
    const today: CrmTask[] = [];
    const upcoming: CrmTask[] = [];
    const completed: CrmTask[] = [];
    const undated: CrmTask[] = [];
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const endOfToday   = new Date(); endOfToday.setHours(23, 59, 59, 999);
    for (const t of tasks) {
      if (t.status === "completed" || t.status === "cancelled") {
        completed.push(t); continue;
      }
      if (!t.due_at) { undated.push(t); continue; }
      const d = new Date(t.due_at);
      if (d < startOfToday) overdue.push(t);
      else if (d <= endOfToday) today.push(t);
      else upcoming.push(t);
    }
    return { overdue, today, upcoming, completed, undated };
  }, [tasks]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => crmTasksApi.delete(wsID, id),
    onSuccess: () => { toast.success("Tarefa removida"); qc.invalidateQueries({ queryKey: ["crm-tasks", wsID] }); },
    onError: () => toast.error("Erro ao remover"),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => crmTasksApi.complete(wsID, id),
    onSuccess: () => { toast.success("Tarefa concluída"); qc.invalidateQueries({ queryKey: ["crm-tasks", wsID] }); },
  });

  return (
    <div className="p-3 sm:p-4 h-full overflow-y-auto space-y-3">
      <CrmHeader
        icon={<ListTodo className="w-4 h-4" style={{ color: "var(--green)" }} />}
        title="Tarefas"
        subtitle="Atividades para a equipe ou agentes IA executarem"
        actions={
          <CrmHeaderButton accent onClick={() => { setEditing(null); setShowModal(true); }}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nova tarefa</span>
            <span className="sm:hidden">Nova</span>
          </CrmHeaderButton>
        }
        toolbar={
          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.id;
              return (
                <button key={f.id} onClick={() => setStatusFilter(f.id)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex-shrink-0"
                  style={active
                    ? { background: f.color + "1a", color: f.color, border: `1px solid ${f.color}55` }
                    : { background: "rgba(255,255,255,0.04)", color: "var(--text-3)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {f.label}
                </button>
              );
            })}
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-3)" }} /></div>
      ) : tasks.length === 0 ? (
        <EmptyState onCreate={() => { setEditing(null); setShowModal(true); }} />
      ) : (
        <div className="space-y-6">
          <Section title="Vencidas" tasks={groups.overdue} accent="#f87171"
            onEdit={(t) => { setEditing(t); setShowModal(true); }}
            onDelete={(t) => deleteMut.mutate(t.id)}
            onComplete={(t) => completeMut.mutate(t.id)} />
          <Section title="Hoje" tasks={groups.today} accent="#fbbf24"
            onEdit={(t) => { setEditing(t); setShowModal(true); }}
            onDelete={(t) => deleteMut.mutate(t.id)}
            onComplete={(t) => completeMut.mutate(t.id)} />
          <Section title="Próximas" tasks={groups.upcoming} accent="#60a5fa"
            onEdit={(t) => { setEditing(t); setShowModal(true); }}
            onDelete={(t) => deleteMut.mutate(t.id)}
            onComplete={(t) => completeMut.mutate(t.id)} />
          <Section title="Sem data" tasks={groups.undated} accent="hsl(240 8% 50%)"
            onEdit={(t) => { setEditing(t); setShowModal(true); }}
            onDelete={(t) => deleteMut.mutate(t.id)}
            onComplete={(t) => completeMut.mutate(t.id)} />
          <Section title="Concluídas / canceladas" tasks={groups.completed} accent="hsl(240 8% 40%)"
            onEdit={(t) => { setEditing(t); setShowModal(true); }}
            onDelete={(t) => deleteMut.mutate(t.id)}
            onComplete={() => {}} />
        </div>
      )}

      {showModal && (
        <TaskModal
          workspaceId={wsID}
          task={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ["crm-tasks", wsID] }); }}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl py-14 text-center" style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.18)" }}>
        <ListTodo className="w-7 h-7" style={{ color: "#00d46a" }} />
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>Nenhuma tarefa criada</h3>
      <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
        Crie tarefas pra você, sua equipe ou peça pra um agente IA executar.
      </p>
      <button onClick={onCreate}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
        style={{ background: "#00d46a", color: "#03170a" }}>
        <Plus className="w-4 h-4" /> Criar primeira tarefa
      </button>
    </div>
  );
}

function Section({ title, tasks, accent, onEdit, onDelete, onComplete }: {
  title: string; tasks: CrmTask[]; accent: string;
  onEdit: (t: CrmTask) => void; onDelete: (t: CrmTask) => void; onComplete: (t: CrmTask) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold mb-2"
        style={{ color: accent }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
        {title} <span style={{ color: "var(--text-3)" }}>({tasks.length})</span>
      </h3>
      <div className="space-y-1.5">
        {tasks.map((t) => <TaskRow key={t.id} task={t} onEdit={onEdit} onDelete={onDelete} onComplete={onComplete} />)}
      </div>
    </div>
  );
}

function TaskRow({ task, onEdit, onDelete, onComplete }: {
  task: CrmTask; onEdit: (t: CrmTask) => void; onDelete: (t: CrmTask) => void; onComplete: (t: CrmTask) => void;
}) {
  const meta = TYPE_META[task.type] ?? TYPE_META.custom;
  const Icon = meta.icon;
  const isAgent = task.assignee_type === "agent";
  const done = task.status === "completed" || task.status === "cancelled";
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <button onClick={() => !done && onComplete(task)} disabled={done}
        className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center"
        style={done
          ? { background: "rgba(0,212,106,0.18)", border: "1px solid rgba(0,212,106,0.4)" }
          : { background: "transparent", border: "1px solid hsl(240 12% 22%)" }}>
        {done && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#00d46a" }} />}
      </button>
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-3)" }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate"
            style={{ color: done ? "var(--text-3)" : "var(--text-1)", textDecoration: done ? "line-through" : undefined }}>
            {task.title}
          </span>
          {task.priority === "high" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>Alta</span>
          )}
          {isAgent && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(168,139,250,0.12)", color: "#a78bfa" }}>
              <Bot className="w-3 h-3" /> Agente
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {task.due_at && (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--text-3)" }}>
              <Clock className="w-3 h-3" />
              {new Date(task.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {task.description && <span className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>{task.description}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(task)} className="text-[11px] px-2 py-1 rounded" style={{ color: "var(--text-2)" }}>Editar</button>
        <button onClick={() => { if (confirm("Remover esta tarefa?")) onDelete(task); }}
          className="p-1.5 rounded" style={{ color: "#f87171" }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function TaskModal({ workspaceId, task, onClose, onSaved }: {
  workspaceId: string; task: CrmTask | null; onClose: () => void; onSaved: () => void;
}) {
  const editing = !!task;
  const [form, setForm] = useState<Partial<CrmTask>>(task ?? {
    title: "",
    description: "",
    type: "follow_up",
    priority: "medium",
    status: "pending",
    assignee_type: "user",
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? crmTasksApi.patch(workspaceId, task!.id, form)
      : crmTasksApi.create(workspaceId, form),
    onSuccess: () => { toast.success(editing ? "Tarefa atualizada" : "Tarefa criada"); onSaved(); },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error || "Erro ao salvar"),
  });

  const isAgent = form.assignee_type === "agent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-base font-semibold mb-4" style={{ color: "var(--text-1)" }}>
          {editing ? "Editar tarefa" : "Nova tarefa"}
        </h3>
        <div className="space-y-3">
          <Input label="Título *" value={form.title ?? ""} onChange={(v) => setForm({ ...form, title: v })} />
          <TextArea label="Descrição" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo" value={form.type ?? "custom"} onChange={(v) => setForm({ ...form, type: v as CrmTask["type"] })}
              options={Object.entries(TYPE_META).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Select label="Prioridade" value={form.priority ?? "medium"} onChange={(v) => setForm({ ...form, priority: v as CrmTask["priority"] })}
              options={[
                { value: "low", label: "Baixa" },
                { value: "medium", label: "Média" },
                { value: "high", label: "Alta" },
              ]} />
          </div>
          <Input
            type="datetime-local"
            label="Vencimento"
            value={form.due_at ? new Date(form.due_at).toISOString().slice(0, 16) : ""}
            onChange={(v) => setForm({ ...form, due_at: v ? new Date(v).toISOString() : undefined })}
          />

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Atribuir a</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, assignee_type: "user" })}
                className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium"
                style={form.assignee_type === "user"
                  ? { background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.3)", color: "#00d46a" }
                  : { background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                <User className="w-3.5 h-3.5" /> Membro do time
              </button>
              <button type="button" onClick={() => setForm({ ...form, assignee_type: "agent" })}
                className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium"
                style={form.assignee_type === "agent"
                  ? { background: "rgba(168,139,250,0.08)", border: "1px solid rgba(168,139,250,0.35)", color: "#a78bfa" }
                  : { background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                <Bot className="w-3.5 h-3.5" /> Agente IA
              </button>
            </div>
          </div>

          {form.assignee_type === "user" && (
            <WorkspaceMemberPicker
              workspaceId={workspaceId}
              value={form.assignee_user_id ?? ""}
              onChange={(uid) => setForm({ ...form, assignee_user_id: uid || undefined })}
            />
          )}

          {isAgent && (
            <div className="rounded-xl p-3 space-y-2"
              style={{ background: "rgba(168,139,250,0.05)", border: "1px solid rgba(168,139,250,0.2)" }}>
              <p className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#a78bfa" }}>
                <Sparkles className="w-3 h-3" /> Instruções pro agente
              </p>
              <TextArea
                label=""
                value={form.agent_instructions ?? ""}
                onChange={(v) => setForm({ ...form, agent_instructions: v })}
                placeholder="Ex: Envie uma mensagem perguntando se confirma a reunião e respondendo dúvidas. Use tom amigável."
              />
              <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                O agente IA vai executar essas instruções na data/hora de vencimento. Resultado fica registrado na tarefa.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text-2)" }}>Cancelar</button>
          <button onClick={() => saveMut.mutate()} disabled={!form.title || saveMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
            style={{ background: "#00d46a", color: "#03170a" }}>
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {editing ? "Salvar" : "Criar tarefa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl text-sm outline-none"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      {label && <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>{label}</label>}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl text-sm outline-none"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// WorkspaceMemberPicker — dropdown de members do workspace pra
// atribuir uma task. Usado quando assignee_type=user. Vazio = task
// "do workspace" (sem dono específico, qualquer member pode pegar).
function WorkspaceMemberPicker({ workspaceId, value, onChange }: {
  workspaceId: string;
  value: string;
  onChange: (uid: string) => void;
}) {
  const { data, isLoading } = useQuery<Array<{ user_id: string; name: string; email: string; role?: string }>>({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => workspacesApi.listMembers(workspaceId).then((r) => r.data?.members ?? r.data ?? []),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });

  const members = data ?? [];

  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
        Responsável
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading}
        className="w-full px-3 py-2 rounded-xl text-sm outline-none"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}>
        <option value="">Sem responsável (qualquer um do time)</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.name || m.email} {m.role ? `· ${m.role}` : ""}
          </option>
        ))}
      </select>
      {!isLoading && members.length === 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
          Nenhum member encontrado neste workspace.
        </p>
      )}
    </div>
  );
}
