"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Building2, Tag, CheckSquare, CalendarDays, Users,
  UserCog, ChevronDown, ChevronUp, ArrowRight, X, Loader2,
  Plus, Minus, Save, Phone, Mail, FileText, Hash,
} from "lucide-react";
import { crmApi, dealsApi, crmTasksApi, crmMeetingsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";

interface CRMQuickActionsProps {
  conversationId: string;
  contactId?: string | null;
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {children}
    </div>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-md rounded-xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-white/5" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto custom-scrollbar">{children}</div>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>{label}</label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-xs outline-none transition-colors ${props.className || ""}`}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border-default)",
        color: "var(--text-1)",
        ...props.style,
      }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  const { options, ...rest } = props;
  return (
    <select
      {...rest}
      className={`w-full rounded-lg px-3 py-2 text-xs outline-none transition-colors ${props.className || ""}`}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border-default)",
        color: "var(--text-1)",
        ...props.style,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-xs outline-none transition-colors resize-none ${props.className || ""}`}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border-default)",
        color: "var(--text-1)",
        ...props.style,
      }}
    />
  );
}

function Button({ onClick, disabled, loading, children, variant = "primary" }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost";
}) {
  const base = "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-50";
  const styles = variant === "primary"
    ? { background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.25)", color: "#00d46a" }
    : variant === "secondary"
    ? { background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-default)", color: "var(--text-2)" }
    : { background: "transparent", border: "1px solid transparent", color: "var(--text-3)" };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={base} style={styles}>
      {loading && <Loader2 className="w-3 h-3 animate-spin" />}
      {children}
    </button>
  );
}

// ─── Deal Create Modal ────────────────────────────────────────────────────────

function DealCreateModal({ open, onClose, contactId, wsId }: { open: boolean; onClose: () => void; contactId?: string | null; wsId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [funnelId, setFunnelId] = useState("");
  const [stageId, setStageId] = useState("");
  const [desc, setDesc] = useState("");

  const funnelsQ = useQuery({
    queryKey: ["crm-funnels", wsId],
    queryFn: () => crmApi.listFunnels(wsId).then((r) => (r.data as any)?.data ?? []),
    enabled: !!wsId && open,
  });

  const stagesQ = useQuery({
    queryKey: ["crm-funnel-stages", wsId, funnelId],
    queryFn: () => crmApi.listFunnelStages(funnelId).then((r) => (r.data as any)?.data ?? []),
    enabled: !!funnelId && open,
  });

  const create = useMutation({
    mutationFn: () => dealsApi.create(wsId, {
      title: title.trim() || "Nova negociação",
      contact_id: contactId!,
      funnel_id: funnelId,
      stage_id: stageId,
      value: value ? parseFloat(value.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".")) : undefined,
      description: desc || undefined,
    }),
    onSuccess: () => {
      toast.success("Negociação criada");
      qc.invalidateQueries({ queryKey: ["inbox-contact-deals"] });
      onClose();
      setTitle(""); setValue(""); setFunnelId(""); setStageId(""); setDesc("");
    },
    onError: () => toast.error("Erro ao criar negociação"),
  });

  const funnels = funnelsQ.data ?? [];
  const stages = stagesQ.data ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Nova negociação">
      <div className="space-y-3">
        <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Proposta comercial" /></Field>
        <Field label="Valor"><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="R$ 0,00" inputMode="decimal" /></Field>
        <Field label="Funil">
          <Select value={funnelId} onChange={(e) => { setFunnelId(e.target.value); setStageId(""); }} options={[
            { value: "", label: "Selecione..." },
            ...funnels.map((f: any) => ({ value: f.id, label: f.name })),
          ]} />
        </Field>
        <Field label="Etapa">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)} options={[
            { value: "", label: funnelId ? "Selecione..." : "Escolha um funil primeiro" },
            ...stages.map((s: any) => ({ value: s.id, label: s.name })),
          ]} />
        </Field>
        <Field label="Descrição"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Observações..." /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!funnelId || !stageId || !contactId}>Criar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Contact Edit Modal ───────────────────────────────────────────────────────

function ContactEditModal({ open, onClose, contactId, wsId }: { open: boolean; onClose: () => void; contactId?: string | null; wsId: string }) {
  const qc = useQueryClient();
  const contactQ = useQuery({
    queryKey: ["inbox-contact-crm", contactId],
    queryFn: () => crmApi.getContact(contactId!).then((r) => r.data as any),
    enabled: !!contactId && open,
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [funnel, setFunnel] = useState("");
  const [stage, setStage] = useState("");
  const [journey, setJourney] = useState("");

  useMemo(() => {
    const c = contactQ.data;
    if (c) {
      setName(c.name || "");
      setPhone(c.phone || "");
      setEmail(c.email || "");
      setNotes(c.notes || "");
      setFunnel(c.funnel || "");
      setStage(c.stage || "");
      setJourney(c.journey || "");
    }
  }, [contactQ.data]);

  const update = useMutation({
    mutationFn: () => crmApi.updateContact(contactId!, {
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
      funnel: funnel.trim() || undefined,
      stage: stage.trim() || undefined,
      journey: journey.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success("Contato atualizado");
      qc.invalidateQueries({ queryKey: ["inbox-contact-crm"] });
      onClose();
    },
    onError: () => toast.error("Erro ao atualizar contato"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Editar contato">
      <div className="space-y-3">
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" /></Field>
        <Field label="Telefone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55..." inputMode="tel" /></Field>
        <Field label="E-mail"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@..." inputMode="email" /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Funil"><Input value={funnel} onChange={(e) => setFunnel(e.target.value)} placeholder="Funil" /></Field>
          <Field label="Etapa"><Input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Etapa" /></Field>
          <Field label="Jornada"><Input value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="Jornada" /></Field>
        </div>
        <Field label="Notas"><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anotações..." /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => update.mutate()} loading={update.isPending} disabled={!contactId}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Tag Manage Modal ─────────────────────────────────────────────────────────

function TagManageModal({ open, onClose, contactId, wsId }: { open: boolean; onClose: () => void; contactId?: string | null; wsId: string }) {
  const qc = useQueryClient();
  const tagsQ = useQuery({
    queryKey: ["crm-tags", wsId],
    queryFn: () => crmApi.listTags(wsId).then((r) => (r.data as any)?.data ?? []),
    enabled: !!wsId && open,
  });

  const contactQ = useQuery({
    queryKey: ["inbox-contact-crm", contactId],
    queryFn: () => crmApi.getContact(contactId!).then((r) => r.data as any),
    enabled: !!contactId && open,
  });

  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#38bdf8");
  const contactTagIds = useMemo(() => new Set((contactQ.data?.tags ?? []).map((t: any) => t.id)), [contactQ.data]);

  const assignTag = useMutation({
    mutationFn: (tagId: string) => crmApi.assignTags(contactId!, Array.from(new Set([...contactTagIds, tagId])) as string[]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inbox-contact-crm"] }); toast.success("Tag atribuída"); },
    onError: () => toast.error("Erro"),
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) => crmApi.assignTags(contactId!, Array.from(contactTagIds).filter((id) => id !== tagId) as string[]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inbox-contact-crm"] }); toast.success("Tag removida"); },
    onError: () => toast.error("Erro"),
  });

  const createTag = useMutation({
    mutationFn: () => crmApi.createTag(newTagName.trim(), newTagColor, wsId),
    onSuccess: (res: any) => {
      const tagId = res.data?.id;
      if (tagId && contactId) assignTag.mutate(tagId);
      qc.invalidateQueries({ queryKey: ["crm-tags"] });
      setNewTagName("");
    },
    onError: () => toast.error("Erro ao criar tag"),
  });

  const allTags = tagsQ.data ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Tags do contato">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {allTags.map((t: any) => {
            const active = contactTagIds.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => active ? removeTag.mutate(t.id) : assignTag.mutate(t.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all"
                style={{
                  background: active ? `${t.color}20` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? t.color + "40" : "var(--border-default)"}`,
                  color: active ? t.color : "var(--text-3)",
                }}
              >
                {active ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                {t.name}
              </button>
            );
          })}
          {allTags.length === 0 && <p className="text-[11px]" style={{ color: "var(--text-4)" }}>Nenhuma tag criada ainda.</p>}
        </div>
        <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Nova tag</p>
          <div className="flex gap-2">
            <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Nome da tag" className="flex-1" />
            <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
            <Button onClick={() => createTag.mutate()} loading={createTag.isPending} disabled={!newTagName.trim()}>
              <Plus className="w-3 h-3" /> Criar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Task Create Modal ────────────────────────────────────────────────────────

function TaskCreateModal({ open, onClose, contactId, wsId }: { open: boolean; onClose: () => void; contactId?: string | null; wsId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"call" | "follow_up" | "message" | "meeting_prep" | "email" | "custom">("follow_up");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [dueAt, setDueAt] = useState("");
  const [desc, setDesc] = useState("");

  const create = useMutation({
    mutationFn: () => crmTasksApi.create(wsId, {
      title: title.trim() || "Nova tarefa",
      type,
      priority,
      due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
      description: desc || undefined,
      contact_id: contactId || undefined,
      status: "pending",
      assignee_type: "user",
    }),
    onSuccess: () => {
      toast.success("Tarefa criada");
      onClose();
      setTitle(""); setType("follow_up"); setPriority("medium"); setDueAt(""); setDesc("");
    },
    onError: () => toast.error("Erro ao criar tarefa"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nova tarefa">
      <div className="space-y-3">
        <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que precisa ser feito?" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value as any)} options={[
              { value: "call", label: "Ligação" },
              { value: "follow_up", label: "Acompanhamento" },
              { value: "message", label: "Mensagem" },
              { value: "meeting_prep", label: "Prep. reunião" },
              { value: "email", label: "E-mail" },
              { value: "custom", label: "Custom" },
            ]} />
          </Field>
          <Field label="Prioridade">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as any)} options={[
              { value: "low", label: "Baixa" },
              { value: "medium", label: "Média" },
              { value: "high", label: "Alta" },
            ]} />
          </Field>
        </div>
        <Field label="Prazo"><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        <Field label="Descrição"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Detalhes..." /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>Criar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Meeting Create Modal ─────────────────────────────────────────────────────

function MeetingCreateModal({ open, onClose, contactId, wsId }: { open: boolean; onClose: () => void; contactId?: string | null; wsId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [desc, setDesc] = useState("");

  const create = useMutation({
    mutationFn: () => crmMeetingsApi.create(wsId, {
      title: title.trim() || "Nova reunião",
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: location || undefined,
      description: desc || undefined,
      contact_id: contactId || undefined,
      provider: "manual",
      status: "scheduled",
    }),
    onSuccess: () => {
      toast.success("Reunião criada");
      onClose();
      setTitle(""); setStart(""); setEnd(""); setLocation(""); setDesc("");
    },
    onError: () => toast.error("Erro ao criar reunião"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nova reunião">
      <div className="space-y-3">
        <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assunto da reunião" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Início"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Término"><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Local / Link"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala, link do Meet..." /></Field>
        <Field label="Descrição"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Agenda..." /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!start || !end}>Criar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function CRMQuickActions({ contactId }: CRMQuickActionsProps) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<"deal" | "contact" | "tags" | "tasks" | "meetings" | null>(null);

  const contactQ = useQuery({
    queryKey: ["inbox-contact-crm", contactId],
    queryFn: () => crmApi.getContact(contactId!).then((r) => r.data as any),
    enabled: !!contactId,
  });

  const dealsQ = useQuery({
    queryKey: ["inbox-contact-deals", wsId, contactId],
    queryFn: () =>
      dealsApi.list(wsId, { contact_id: contactId, status: "open", limit: 5 }).then(
        (r) => (r.data as any)?.items ?? []
      ),
    enabled: !!wsId && !!contactId,
  });

  const contact = contactQ.data;
  const deals = dealsQ.data ?? [];

  const buttons = [
    { id: "deal" as const, label: "Negociação", icon: Briefcase, color: "#fbbf24" },
    { id: "contact" as const, label: "Contato", icon: UserCog, color: "#38bdf8" },
    { id: "tags" as const, label: "Tags", icon: Tag, color: "#00d46a" },
    { id: "tasks" as const, label: "Tarefa", icon: CheckSquare, color: "#f59e0b" },
    { id: "meetings" as const, label: "Reunião", icon: CalendarDays, color: "#a78bfa" },
  ];

  return (
    <>
      <GlassCard className="overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)" }}>
              <Briefcase className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-1)" }}>CRM</h3>
              <p className="text-[10px]" style={{ color: "var(--text-4)" }}>Ações e dados do contato</p>
            </div>
          </div>
          {open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                {/* CRM Info Cards */}
                {contactId && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Funil</p>
                      <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: "var(--text-1)" }}>{contact?.funnel || "—"}</p>
                      <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{contact?.stage || ""}</p>
                    </div>
                    <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Deals</p>
                      <p className="text-xs font-semibold mt-0.5" style={{ color: "var(--text-1)" }}>{deals.length}</p>
                      <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{deals[0]?.title || ""}</p>
                    </div>
                    <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Tags</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {contact?.tags?.slice(0, 3).map((t: any) => (
                          <span key={t.id} className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: `${t.color}15`, color: t.color, border: `1px solid ${t.color}30` }}>
                            {t.name}
                          </span>
                        )) || <span className="text-[10px]" style={{ color: "var(--text-3)" }}>—</span>}
                      </div>
                    </div>
                    <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Jornada</p>
                      <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: "var(--text-1)" }}>{contact?.journey || "—"}</p>
                    </div>
                  </div>
                )}

                {/* Quick Action Buttons */}
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-4)" }}>Ações rápidas</label>
                  <div className="grid grid-cols-3 gap-2">
                    {buttons.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setModal(b.id)}
                        className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-[10px] font-medium transition-all hover:brightness-110"
                        style={{ background: `${b.color}08`, border: `1px solid ${b.color}18`, color: b.color }}
                      >
                        <b.icon className="w-3.5 h-3.5" />
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Deals list */}
                {deals.length > 0 && (
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-4)" }}>Negociações abertas</label>
                    <div className="space-y-1.5">
                      {deals.map((d: any) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between p-2.5 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium truncate" style={{ color: "var(--text-1)" }}>{d.title}</p>
                            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{d.stage_name || d.stage || ""}</p>
                          </div>
                          {d.value > 0 && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
                              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: d.currency || "BRL" }).format(d.value)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      <DealCreateModal open={modal === "deal"} onClose={() => setModal(null)} contactId={contactId} wsId={wsId} />
      <ContactEditModal open={modal === "contact"} onClose={() => setModal(null)} contactId={contactId} wsId={wsId} />
      <TagManageModal open={modal === "tags"} onClose={() => setModal(null)} contactId={contactId} wsId={wsId} />
      <TaskCreateModal open={modal === "tasks"} onClose={() => setModal(null)} contactId={contactId} wsId={wsId} />
      <MeetingCreateModal open={modal === "meetings"} onClose={() => setModal(null)} contactId={contactId} wsId={wsId} />
    </>
  );
}
