"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { crmMeetingsApi, CrmMeeting } from "@/lib/api";
import {
  Plus, Loader2, Calendar, Video, Trash2, MapPin, Clock, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { CrmHeader, CrmHeaderButton } from "@/components/crm/CrmHeader";
import { showConfirm } from "@/lib/confirm";

const STATUS_FILTERS: { id: "all" | CrmMeeting["status"]; label: string; color: string }[] = [
  { id: "all",       label: "Todas",       color: "var(--text-3)" },
  { id: "scheduled", label: "Agendadas",   color: "#60a5fa" },
  { id: "completed", label: "Realizadas",  color: "#00d46a" },
  { id: "cancelled", label: "Canceladas",  color: "var(--text-3)" },
  { id: "no_show",   label: "No-show",     color: "#fbbf24" },
];

export default function MeetingsPage() {
  const { currentWorkspace } = useWorkspace();
  const wsID = currentWorkspace?.id ?? "";
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | CrmMeeting["status"]>("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CrmMeeting | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["crm-meetings", wsID, statusFilter],
    queryFn: () => crmMeetingsApi.list(wsID, statusFilter !== "all" ? { status: statusFilter } : undefined).then((r) => r.data),
    enabled: !!wsID,
  });

  const meetings: CrmMeeting[] = data?.items ?? [];

  const grouped = useMemo(() => {
    const out: Record<string, CrmMeeting[]> = {};
    for (const m of meetings) {
      const key = new Date(m.start_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
      if (!out[key]) out[key] = [];
      out[key].push(m);
    }
    return out;
  }, [meetings]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => crmMeetingsApi.delete(wsID, id),
    onSuccess: () => { toast.success("Reunião removida"); qc.invalidateQueries({ queryKey: ["crm-meetings", wsID] }); },
  });

  return (
    <div className="p-3 sm:p-4 h-full overflow-y-auto space-y-3">
      <CrmHeader
        icon={<Calendar className="w-4 h-4" style={{ color: "var(--green)" }} />}
        title="Reuniões"
        subtitle="Agende reuniões e vincule a deals. Em breve sync com Google Calendar/Outlook."
        actions={
          <CrmHeaderButton accent onClick={() => { setEditing(null); setShowModal(true); }}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nova reunião</span>
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
      ) : meetings.length === 0 ? (
        <EmptyState onCreate={() => { setEditing(null); setShowModal(true); }} />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([day, items]) => (
            <div key={day}>
              <h3 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>
                {day}
              </h3>
              <div className="space-y-2">
                {items.map((m) => (
                  <MeetingRow key={m.id} meeting={m}
                    onEdit={() => { setEditing(m); setShowModal(true); }}
                    onDelete={async () => { if (await showConfirm("Remover esta reunião?", { title: "Remover reunião", confirmLabel: "Remover" })) deleteMut.mutate(m.id); }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <MeetingModal
          workspaceId={wsID}
          meeting={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ["crm-meetings", wsID] }); }}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl py-14 text-center" style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)" }}>
        <Calendar className="w-7 h-7" style={{ color: "#60a5fa" }} />
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>Nenhuma reunião agendada</h3>
      <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
        Crie reuniões vinculadas aos seus deals e contatos.
      </p>
      <button onClick={onCreate}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
        style={{ background: "#00d46a", color: "#03170a" }}>
        <Plus className="w-4 h-4" /> Agendar primeira reunião
      </button>
    </div>
  );
}

function MeetingRow({ meeting, onEdit, onDelete }: {
  meeting: CrmMeeting; onEdit: () => void; onDelete: () => void;
}) {
  const start = new Date(meeting.start_at);
  const end = new Date(meeting.end_at);
  const fmt = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="group flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex-shrink-0 text-center" style={{ minWidth: 64 }}>
        <p className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>{fmt(start)}</p>
        <p className="text-[10px]" style={{ color: "var(--text-3)" }}>até {fmt(end)}</p>
      </div>
      <div className="w-px self-stretch" style={{ background: "var(--surface-border)" }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{meeting.title}</span>
          {meeting.provider !== "manual" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(96,165,250,0.12)", color: "#60a5fa" }}>
              {meeting.provider === "google" ? "Google" : "Outlook"}
            </span>
          )}
          {meeting.status === "completed" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(0,212,106,0.12)", color: "#00d46a" }}>Realizada</span>
          )}
          {meeting.status === "cancelled" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>Cancelada</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {meeting.location && (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--text-3)" }}>
              <MapPin className="w-3 h-3" /> {meeting.location}
            </span>
          )}
          {meeting.meeting_url && (
            <a href={meeting.meeting_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px]" style={{ color: "#60a5fa" }}>
              <Video className="w-3 h-3" /> Link da chamada <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          {meeting.description && (
            <span className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>{meeting.description}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="text-[11px] px-2 py-1 rounded" style={{ color: "var(--text-2)" }}>Editar</button>
        <button onClick={onDelete} className="p-1.5 rounded" style={{ color: "#f87171" }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function MeetingModal({ workspaceId, meeting, onClose, onSaved }: {
  workspaceId: string; meeting: CrmMeeting | null; onClose: () => void; onSaved: () => void;
}) {
  const editing = !!meeting;
  // Defaults: start = próxima hora cheia, end = +1h.
  const defaultStart = (() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  })();
  const defaultEnd = (() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 2);
    return d.toISOString().slice(0, 16);
  })();
  const [form, setForm] = useState<Partial<CrmMeeting>>(meeting ?? {
    title: "",
    description: "",
    location: "",
    meeting_url: "",
    status: "scheduled",
    provider: "manual",
    start_at: defaultStart,
    end_at: defaultEnd,
  });

  // Helper pra converter datetime-local string ↔ ISO. O input
  // datetime-local devolve "YYYY-MM-DDTHH:mm" sem timezone — convertemos
  // pra Date local e depois ISO pra mandar pro backend.
  const setStart = (v: string) => setForm({ ...form, start_at: v ? new Date(v).toISOString() : "" });
  const setEnd = (v: string) => setForm({ ...form, end_at: v ? new Date(v).toISOString() : "" });
  const startVal = form.start_at ? new Date(form.start_at).toISOString().slice(0, 16) : "";
  const endVal = form.end_at ? new Date(form.end_at).toISOString().slice(0, 16) : "";

  const saveMut = useMutation({
    mutationFn: () => editing
      ? crmMeetingsApi.patch(workspaceId, meeting!.id, form)
      : crmMeetingsApi.create(workspaceId, form),
    onSuccess: () => { toast.success(editing ? "Reunião atualizada" : "Reunião criada"); onSaved(); },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error || "Erro ao salvar"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-base font-semibold mb-4" style={{ color: "var(--text-1)" }}>
          {editing ? "Editar reunião" : "Nova reunião"}
        </h3>
        <div className="space-y-3">
          <Input label="Título *" value={form.title ?? ""} onChange={(v) => setForm({ ...form, title: v })} />
          <TextArea label="Descrição" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="datetime-local" label="Início *" value={startVal} onChange={setStart} />
            <Input type="datetime-local" label="Fim *" value={endVal} onChange={setEnd} />
          </div>
          <Input label="Local (opcional)" value={form.location ?? ""} onChange={(v) => setForm({ ...form, location: v })} />
          <Input label="Link da chamada (Zoom/Meet/etc)" value={form.meeting_url ?? ""}
            onChange={(v) => setForm({ ...form, meeting_url: v })} />
          {editing && (
            <Select label="Status" value={form.status ?? "scheduled"}
              onChange={(v) => setForm({ ...form, status: v as CrmMeeting["status"] })}
              options={[
                { value: "scheduled", label: "Agendada" },
                { value: "completed", label: "Realizada" },
                { value: "cancelled", label: "Cancelada" },
                { value: "no_show",   label: "No-show" },
              ]} />
          )}
          <div className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded-lg"
            style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.18)", color: "#60a5fa" }}>
            <Clock className="w-3 h-3" />
            Sync com Google Calendar/Outlook em breve. Por agora a reunião fica registrada só no Uniq.
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text-2)" }}>Cancelar</button>
          <button onClick={() => saveMut.mutate()} disabled={!form.title || !form.start_at || !form.end_at || saveMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
            style={{ background: "#00d46a", color: "#03170a" }}>
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {editing ? "Salvar" : "Criar reunião"}
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

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3}
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
