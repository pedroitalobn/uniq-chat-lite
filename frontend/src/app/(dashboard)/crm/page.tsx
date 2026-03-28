"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { crmApi } from "@/lib/api";
import { Contact, Tag } from "@/types";
import {
  Plus, Search, Tag as TagIcon, Trash2, Phone, Mail, Edit2,
  X, Check, User, StickyNote, GitBranch, Layers, Route,
  Hash, UserCheck, ChevronDown, Filter, List as ListIcon, KanbanSquare, GripVertical,
} from "lucide-react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TagBadge({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}44` }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-60 transition-opacity">
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

function PipelineBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium"
      style={{ background: color + "18", color, border: `1px solid ${color}30` }}
    >
      {value}
    </span>
  );
}

function FieldInput({
  icon: Icon, label, value, onChange, placeholder, required, type = "text",
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 48%)" }}>
        {label}{required && " *"}
      </label>
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 16%)" }}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }} />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "hsl(240 15% 90%)" }}
        />
      </div>
    </div>
  );
}

// ─── Contact Modal ─────────────────────────────────────────────────────────────

function ContactModal({
  contact, tags, onClose, onSaved,
}: {
  contact?: Contact; tags: Tag[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName]           = useState(contact?.name ?? "");
  const [phone, setPhone]         = useState(contact?.phone ?? "");
  const [email, setEmail]         = useState(contact?.email ?? "");
  const [notes, setNotes]         = useState(contact?.notes ?? "");
  const [funnel, setFunnel]       = useState(contact?.funnel ?? "");
  const [stage, setStage]         = useState(contact?.stage ?? "");
  const [journey, setJourney]     = useState(contact?.journey ?? "");
  const [externalId, setExtId]    = useState(contact?.external_id ?? "");
  const [owner, setOwner]         = useState(contact?.owner ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(
    contact?.tags?.map((t) => t.id) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"basic" | "pipeline">("basic");

  const toggleTag = (id: string) =>
    setSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!name.trim() || !phone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    setSaving(true);
    const payload = { name, phone, email, notes, funnel, stage, journey, external_id: externalId, owner };
    try {
      if (contact) {
        await crmApi.updateContact(contact.id, payload);
        await crmApi.assignTags(contact.id, selectedTags);
      } else {
        const res = await crmApi.createContact(payload);
        if (selectedTags.length > 0) await crmApi.assignTags(res.data.id, selectedTags);
      }
      toast.success(contact ? "Contato atualizado" : "Contato criado");
      onSaved();
      onClose();
    } catch {
      toast.error("Erro ao salvar contato");
    } finally {
      setSaving(false);
    }
  };

  const tabStyle = (active: boolean) => ({
    background: active ? "rgba(255,255,255,0.07)" : "transparent",
    color: active ? "hsl(240 15% 90%)" : "hsl(240 8% 46%)",
    border: active ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl animate-fade-in-up flex flex-col"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
            {contact ? "Editar Contato" : "Novo Contato"}
          </h2>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }} className="hover:opacity-70 transition-opacity">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="px-6 mb-4 flex gap-1.5">
          {(["basic", "pipeline"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={tabStyle(tab === t)}
            >
              {t === "basic" ? "Dados básicos" : "Pipeline / CRM"}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6">
          {tab === "basic" ? (
            <div className="space-y-3 pb-1">
              <FieldInput icon={User}  label="Nome"     value={name}  onChange={setName}  placeholder="João Silva" required />
              <FieldInput icon={Phone} label="Telefone" value={phone} onChange={setPhone} placeholder="5511999999999" required />
              <FieldInput icon={Mail}  label="Email"    value={email} onChange={setEmail} placeholder="joao@email.com" />

              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 48%)" }}>Notas</label>
                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 16%)" }}>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observações sobre o contato..."
                    rows={3}
                    className="w-full bg-transparent text-sm outline-none resize-none"
                    style={{ color: "hsl(240 15% 90%)" }}
                  />
                </div>
              </div>

              {tags.length > 0 && (
                <div>
                  <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 48%)" }}>Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const selected = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all"
                          style={{
                            background: selected ? tag.color + "22" : "rgba(255,255,255,0.04)",
                            color: selected ? tag.color : "hsl(240 8% 46%)",
                            border: `1px solid ${selected ? tag.color + "44" : "rgba(255,255,255,0.08)"}`,
                          }}
                        >
                          {selected && <Check className="w-2.5 h-2.5" />}
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 pb-1">
              <div className="rounded-xl p-3 mb-1" style={{ background: "rgba(0,212,106,0.04)", border: "1px solid rgba(0,212,106,0.1)" }}>
                <p className="text-[11px]" style={{ color: "hsl(240 8% 52%)" }}>
                  Estas variáveis ajudam a segmentar e rastrear o lead dentro do seu processo de vendas.
                </p>
              </div>

              <FieldInput icon={GitBranch} label="Funil (funnel)"     value={funnel}   onChange={setFunnel}   placeholder="ex: Vendas B2B" />
              <FieldInput icon={Layers}    label="Etapa (stage)"      value={stage}    onChange={setStage}    placeholder="ex: Qualificação" />
              <FieldInput icon={Route}     label="Jornada (journey)"  value={journey}  onChange={setJourney}  placeholder="ex: Consideração" />
              <FieldInput icon={Hash}      label="ID Externo"         value={externalId} onChange={setExtId} placeholder="ex: CRM-001 ou Hubspot ID" />
              <FieldInput icon={UserCheck} label="Responsável (owner)" value={owner}   onChange={setOwner}   placeholder="ex: Maria Santos" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-5 mt-1">
          <button
            onClick={onClose}
            className="flex-1 text-sm py-2.5 rounded-xl transition-all"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "hsl(240 8% 46%)" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-sm font-semibold py-2.5 rounded-xl transition-all disabled:opacity-40"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tag Manager ──────────────────────────────────────────────────────────────

const PRESET_COLORS = ["#00d46a", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function TagManager({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: tags = [] } = useQuery<Tag[]>({ queryKey: ["tags"], queryFn: () => crmApi.listTags().then(r => r.data) });
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const createTag = useMutation({
    mutationFn: () => crmApi.createTag(name.trim(), color),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tags"] }); setName(""); toast.success("Tag criada"); },
    onError: () => toast.error("Erro ao criar tag"),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => crmApi.deleteTag(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tags"] }); queryClient.invalidateQueries({ queryKey: ["contacts"] }); },
    onError: () => toast.error("Erro ao deletar tag"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Gerenciar Tags</h2>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }} className="hover:opacity-70 transition-opacity"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 16%)" }}>
            <TagIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da tag"
              className="flex-1 bg-transparent text-sm outline-none" style={{ color: "hsl(240 15% 90%)" }}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && createTag.mutate()} />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} className="w-6 h-6 rounded-full transition-all"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(240 18% 6%), 0 0 0 4px ${c}` : "none" }} />
            ))}
          </div>
          <button onClick={() => name.trim() && createTag.mutate()} disabled={!name.trim() || createTag.isPending}
            className="w-full text-sm font-semibold py-2 rounded-xl transition-all disabled:opacity-40"
            style={{ background: "var(--green)", color: "#03170a" }}>
            Criar Tag
          </button>
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between p-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)" }}>
              <TagBadge tag={tag} />
              <button onClick={() => deleteTag.mutate(tag.id)} className="p-1 rounded-lg transition-colors hover:text-red-400" style={{ color: "hsl(240 8% 38%)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {tags.length === 0 && <p className="text-center text-xs py-4" style={{ color: "hsl(240 8% 38%)" }}>Nenhuma tag ainda</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Filter Panel ─────────────────────────────────────────────────────────────

function FilterPanel({
  contacts,
  filters,
  onChange,
  onClose,
}: {
  contacts: Contact[];
  filters: Record<string, string>;
  onChange: (k: string, v: string) => void;
  onClose: () => void;
}) {
  // Build unique value lists from loaded contacts
  const uniq = (key: keyof Contact) =>
    [...new Set(contacts.map((c) => c[key] as string).filter(Boolean))].sort();

  const funnels  = uniq("funnel");
  const stages   = uniq("stage");
  const journeys = uniq("journey");
  const owners   = uniq("owner");

  const SelectFilter = ({
    label, field, options, icon: Icon,
  }: {
    label: string; field: string; options: string[];
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }) => (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium mb-1" style={{ color: "hsl(240 8% 48%)" }}>
        <Icon className="w-3 h-3" /> {label}
      </label>
      <div className="relative">
        <select
          value={filters[field] ?? ""}
          onChange={(e) => onChange(field, e.target.value)}
          className="w-full appearance-none text-sm rounded-xl px-3 py-2 pr-8 outline-none"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid hsl(240 12% 16%)",
            color: filters[field] ? "hsl(240 15% 90%)" : "hsl(240 8% 42%)",
          }}
        >
          <option value="">Todos</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "hsl(240 8% 38%)" }} />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative w-72 rounded-2xl p-5 shadow-2xl animate-fade-in-up mt-16"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Filtros de Pipeline</h3>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }} className="hover:opacity-70 transition-opacity">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <SelectFilter label="Funil"      field="funnel"  options={funnels}  icon={GitBranch} />
          <SelectFilter label="Etapa"      field="stage"   options={stages}   icon={Layers} />
          <SelectFilter label="Jornada"    field="journey" options={journeys} icon={Route} />
          <SelectFilter label="Responsável" field="owner"  options={owners}   icon={UserCheck} />
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1" style={{ color: "hsl(240 8% 48%)" }}>
              <Hash className="w-3 h-3" /> ID Externo
            </label>
            <input
              value={filters.external_id ?? ""}
              onChange={(e) => onChange("external_id", e.target.value)}
              placeholder="Buscar por ID externo..."
              className="w-full text-sm rounded-xl px-3 py-2 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}
            />
          </div>
        </div>
        {Object.values(filters).some(Boolean) && (
          <button
            onClick={() => { ["funnel","stage","journey","owner","external_id"].forEach((k) => onChange(k, "")); }}
            className="w-full mt-4 text-xs py-2 rounded-xl transition-all"
            style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.15)" }}
          >
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CRMPage() {
  const queryClient = useQueryClient();
  const [search, setSearch]               = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [pipelineFilters, setPipelineFilters] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen]       = useState(false);
  const [editContact, setEditContact]     = useState<Contact | null>(null);
  const [tagsOpen, setTagsOpen]           = useState(false);
  const [filterOpen, setFilterOpen]       = useState(false);
  const [viewMode, setViewMode]           = useState<"list" | "kanban">("list");
  const [kanbanGroup, setKanbanGroup]     = useState<"stage" | "journey" | "funnel">("stage");

  const updateContactMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Contact> }) => crmApi.updateContact(id, payload),
    onSuccess: () => {
      // Background refetch
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => toast.error("Erro ao mover contato"),
  });

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const contactId = result.draggableId;
    let newCol = result.destination.droppableId;
    if (newCol === "Sem categoria") newCol = "";
    
    // Optimistic update
    queryClient.setQueryData<Contact[]>(["contacts", search, activeTagFilter, pipelineFilters], (old) => {
      if (!old) return old;
      return old.map(c => c.id === contactId ? { ...c, [kanbanGroup]: newCol } : c);
    });

    updateContactMutation.mutate({ id: contactId, payload: { [kanbanGroup]: newCol } });
  };

  const activeFilterCount = Object.values(pipelineFilters).filter(Boolean).length;

  const queryParams = {
    search: search || undefined,
    tag_id: activeTagFilter || undefined,
    ...Object.fromEntries(Object.entries(pipelineFilters).filter(([, v]) => v !== "")),
  };

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", search, activeTagFilter, pipelineFilters],
    queryFn: () => crmApi.listContacts(queryParams).then((r) => r.data.data),
  });

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ["tags"],
    queryFn: () => crmApi.listTags().then((r) => r.data),
  });

  // All contacts (unfiltered) for populating filter dropdowns
  const { data: allContacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts-all"],
    queryFn: () => crmApi.listContacts({ limit: 500 } as never).then((r) => r.data.data),
    staleTime: 60_000,
  });

  const deleteContact = useMutation({
    mutationFn: (id: string) => crmApi.deleteContact(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["contacts"] }); toast.success("Contato removido"); },
    onError: () => toast.error("Erro ao remover contato"),
  });

  const setPipelineFilter = (k: string, v: string) =>
    setPipelineFilters((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>CRM</h1>
          <p className="text-sm mt-1.5" style={{ color: "hsl(240 8% 46%)" }}>
            {contacts.length} contato{contacts.length !== 1 ? "s" : ""}
            {activeFilterCount > 0 && (
              <span style={{ color: "var(--green)" }}> · {activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""} ativo{activeFilterCount > 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {/* View toggle */}
          <div className="flex bg-white/5 p-1 rounded-xl items-center" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <button
              onClick={() => setViewMode("list")}
              className="p-1.5 rounded-lg transition-colors"
              style={{ background: viewMode === "list" ? "rgba(255,255,255,0.1)" : "transparent", color: viewMode === "list" ? "white" : "hsl(240 8% 62%)" }}
            >
              <ListIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className="p-1.5 rounded-lg transition-colors"
              style={{ background: viewMode === "kanban" ? "rgba(255,255,255,0.1)" : "transparent", color: viewMode === "kanban" ? "white" : "hsl(240 8% 62%)" }}
            >
              <KanbanSquare className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setTagsOpen(true)}
            className="flex items-center gap-2 text-sm font-medium px-3.5 py-2.5 rounded-xl transition-all"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "hsl(240 8% 62%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 93%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
          >
            <TagIcon className="w-4 h-4" /> Tags
          </button>
          <button
            onClick={() => setFilterOpen(true)}
            className="relative flex items-center gap-2 text-sm font-medium px-3.5 py-2.5 rounded-xl transition-all"
            style={{
              background: activeFilterCount > 0 ? "rgba(0,212,106,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${activeFilterCount > 0 ? "rgba(0,212,106,0.2)" : "rgba(255,255,255,0.08)"}`,
              color: activeFilterCount > 0 ? "var(--green)" : "hsl(240 8% 62%)",
            }}
          >
            <Filter className="w-4 h-4" />
            Pipeline
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: "var(--green)", color: "#03170a" }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Novo Contato
          </button>
        </div>
      </div>

      {/* Search + tag filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1 min-w-48"
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone, email, ID externo..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "hsl(240 15% 90%)" }}
          />
          {search && <button onClick={() => setSearch("")}><X className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 46%)" }} /></button>}
        </div>

        {tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <button onClick={() => setActiveTagFilter(null)} className="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: activeTagFilter === null ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                color: activeTagFilter === null ? "hsl(240 15% 90%)" : "hsl(240 8% 46%)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}>
              Todos
            </button>
            {tags.map((tag) => (
              <button key={tag.id} onClick={() => setActiveTagFilter(activeTagFilter === tag.id ? null : tag.id)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: activeTagFilter === tag.id ? tag.color + "22" : "rgba(255,255,255,0.03)",
                  color: activeTagFilter === tag.id ? tag.color : "hsl(240 8% 46%)",
                  border: `1px solid ${activeTagFilter === tag.id ? tag.color + "44" : "rgba(255,255,255,0.06)"}`,
                }}>
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Kanban Group Selector */}
      {viewMode === "kanban" && contacts.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: "hsl(240 8% 46%)" }}>Agrupar colunas por:</span>
          <select
            value={kanbanGroup}
            onChange={(e) => setKanbanGroup(e.target.value as any)}
            className="text-sm rounded-xl px-3 py-1.5 outline-none font-medium transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "white" }}
          >
            <option value="stage">Etapa / Fase</option>
            <option value="journey">Jornada</option>
            <option value="funnel">Funil</option>
          </select>
        </div>
      )}

      {/* Active pipeline filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>Pipeline:</span>
          {Object.entries(pipelineFilters).filter(([, v]) => v).map(([k, v]) => (
            <span key={k}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg"
              style={{ background: "rgba(0,212,106,0.08)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.2)" }}
            >
              {k === "funnel" ? "Funil" : k === "stage" ? "Etapa" : k === "journey" ? "Jornada" : k === "owner" ? "Responsável" : "ID Externo"}: {v}
              <button onClick={() => setPipelineFilter(k, "")} className="hover:opacity-60 transition-opacity">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Contact View rendering */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
      ) : contacts.length === 0 ? (
        <div className="rounded-2xl p-14 text-center animate-fade-in-up"
          style={{ background: "hsl(240 18% 6%)", border: "1px dashed hsl(240 12% 16%)" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <User className="w-6 h-6" style={{ color: "hsl(240 8% 35%)" }} />
          </div>
          <p className="font-semibold text-sm" style={{ color: "hsl(240 8% 70%)" }}>Nenhum contato encontrado</p>
          <p className="text-sm mt-1.5 mb-6" style={{ color: "hsl(240 8% 42%)" }}>
            {activeFilterCount > 0 || search || activeTagFilter
              ? "Tente ajustar os filtros"
              : "Crie seus primeiros contatos para gerenciar o CRM"}
          </p>
          {!activeFilterCount && !search && !activeTagFilter && (
            <button onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all active:scale-[0.97]"
              style={{ background: "var(--green)", color: "#03170a" }}>
              <Plus className="w-4 h-4" /> Criar primeiro contato
            </button>
          )}
        </div>
      ) : viewMode === "list" ? (
        <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          {contacts.map((contact, i) => (
            <div
              key={contact.id}
              className="flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
              style={{ borderTop: i > 0 ? "1px solid hsl(240 12% 11%)" : undefined }}
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold mt-0.5"
                style={{
                  background: "linear-gradient(135deg, rgba(0,212,106,0.15), rgba(0,212,106,0.04))",
                  border: "1px solid rgba(0,212,106,0.15)",
                  color: "var(--green)",
                }}>
                {contact.name[0]?.toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {/* Name + tags row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>{contact.name}</p>
                  {contact.tags?.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                </div>

                {/* Phone + email */}
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs font-mono" style={{ color: "hsl(240 8% 46%)" }}>{contact.phone}</span>
                  {contact.email && <span className="text-xs" style={{ color: "hsl(240 8% 38%)" }}>{contact.email}</span>}
                </div>

                {/* Pipeline badges */}
                {(contact.funnel || contact.stage || contact.journey || contact.owner || contact.external_id) && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {contact.funnel  && <PipelineBadge label="funil"      value={contact.funnel}      color="#a78bfa" />}
                    {contact.stage   && <PipelineBadge label="etapa"      value={contact.stage}       color="#60a5fa" />}
                    {contact.journey && <PipelineBadge label="jornada"    value={contact.journey}     color="#f59e0b" />}
                    {contact.owner   && <PipelineBadge label="responsável" value={`👤 ${contact.owner}`} color="#34d399" />}
                    {contact.external_id && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono"
                        style={{ background: "rgba(100,116,139,0.12)", color: "#94a3b8", border: "1px solid rgba(100,116,139,0.2)" }}>
                        # {contact.external_id}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                {contact.notes && (
                  <span title={contact.notes}>
                    <StickyNote className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 38%)" }} />
                  </span>
                )}
                <button
                  onClick={() => setEditContact(contact)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: "hsl(240 8% 42%)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 80%)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 42%)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => { if (!await showConfirm(`Remover o contato "${contact.name}"?`, { title: "Remover contato", confirmLabel: "Remover" })) return; deleteContact.mutate(contact.id); }}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: "hsl(240 8% 42%)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 42%)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
            {(() => {
              const columnsInfo = Array.from(new Set(contacts.map(c => c[kanbanGroup] || "Sem categoria"))).sort();
              // Ensure 'Sem categoria' goes last
              const sortedCols = columnsInfo.filter(c => c !== "Sem categoria").concat(columnsInfo.includes("Sem categoria") ? ["Sem categoria"] : []);
              
              return sortedCols.map((colName) => {
                const colContacts = contacts.filter(c => (c[kanbanGroup] || "Sem categoria") === colName);
                return (
                  <div key={colName} className="flex-shrink-0 w-80 flex flex-col snap-start rounded-2xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                      <h3 className="text-sm font-semibold truncate" style={{ color: "hsl(240 15% 90%)" }}>
                        {colName}
                      </h3>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" 
                        style={{ background: "rgba(255,255,255,0.08)", color: "hsl(240 8% 62%)" }}>
                        {colContacts.length}
                      </span>
                    </div>
                    
                    <Droppable droppableId={colName}>
                      {(provided, snapshot) => (
                        <div
                          {...provided.droppableProps}
                          ref={provided.innerRef}
                          className="flex-1 p-3 space-y-3 min-h-[150px] transition-colors"
                          style={{ background: snapshot.isDraggingOver ? "rgba(255,255,255,0.02)" : "transparent" }}
                        >
                          {colContacts.map((contact, index) => (
                            <Draggable key={contact.id} draggableId={contact.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className="group rounded-xl p-3 shadow-xl transition-shadow"
                                  style={{
                                    ...provided.draggableProps.style,
                                    background: "hsl(240 18% 8%)",
                                    border: `1px solid ${snapshot.isDragging ? "var(--green)" : "hsl(240 12% 16%)"}`,
                                    boxShadow: snapshot.isDragging ? "0 12px 24px rgba(0,0,0,0.5)" : "0 4px 12px rgba(0,0,0,0.2)",
                                  }}
                                  onClick={(e) => {
                                    // Make click open edit modal but don't steal drag
                                    if (!(e.target as HTMLElement).closest("button")) {
                                      setEditContact(contact);
                                    }
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold truncate" style={{ color: "hsl(240 15% 93%)" }}>{contact.name}</p>
                                      <p className="text-xs font-mono truncate" style={{ color: "hsl(240 8% 46%)" }}>{contact.phone}</p>
                                    </div>
                                    <GripVertical className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-grab active:cursor-grabbing" style={{ color: "hsl(240 8% 38%)" }} />
                                  </div>
                                  
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {contact.tags?.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                                  </div>
                                  
                                  <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                                    <div className="flex items-center gap-1">
                                      {contact.owner && <span className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }}>👤 {contact.owner}</span>}
                                    </div>
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={(e) => { e.stopPropagation(); setEditContact(contact); }} className="hover:text-white" style={{ color: "hsl(240 8% 42%)" }}><Edit2 className="w-3.5 h-3.5" /></button>
                                      <button onClick={async (e) => { e.stopPropagation(); if (!await showConfirm(`Remover "${contact.name}"?`)) return; deleteContact.mutate(contact.id); }} className="hover:text-red-400" style={{ color: "hsl(240 8% 42%)" }}><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              });
            })()}
          </div>
        </DragDropContext>
      )}

      {/* Modals */}
      {(createOpen || editContact) && (
        <ContactModal
          contact={editContact ?? undefined}
          tags={tags}
          onClose={() => { setCreateOpen(false); setEditContact(null); }}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["contacts"] }); queryClient.invalidateQueries({ queryKey: ["contacts-all"] }); }}
        />
      )}
      {tagsOpen  && <TagManager onClose={() => setTagsOpen(false)} />}
      {filterOpen && (
        <FilterPanel
          contacts={allContacts}
          filters={pipelineFilters}
          onChange={setPipelineFilter}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}
