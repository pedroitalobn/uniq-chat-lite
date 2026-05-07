"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { crmApi, journeysApi } from "@/lib/api";
import { Contact, Tag } from "@/types";
import {
  Plus, Search, Tag as TagIcon, Trash2, Phone, Mail, Edit2,
  X, Check, User, StickyNote, GitBranch, Layers, Route,
  Hash, UserCheck, ChevronDown, Filter, List as ListIcon, KanbanSquare, GripVertical,
  Pause, Play, ExternalLink, MoreVertical,
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
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { CrmHeader, CrmHeaderButton } from "@/components/crm/CrmHeader";

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
      <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-3)" }}>
        {label}{required && " *"}
      </label>
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text-1)" }}
        />
      </div>
    </div>
  );
}

function FieldSelect({
  icon: Icon, label, value, onChange, options, onManage, manageLabel, emptyHint, disabled,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  onManage?: () => void; manageLabel?: string; emptyHint?: string; disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: "var(--text-3)" }}>{label}</label>
        {onManage && (
          <button type="button" onClick={onManage} className="text-[10px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--green)" }}>
            + {manageLabel}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", opacity: disabled ? 0.5 : 1 }}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          className="flex-1 bg-transparent text-sm outline-none cursor-pointer" style={{ color: "var(--text-1)" }}>
          <option value="" style={{ background: "#111" }}>— nenhum —</option>
          {options.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
        </select>
      </div>
      {options.length === 0 && emptyHint && (
        <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>{emptyHint}</p>
      )}
    </div>
  );
}

// ─── Contact Modal ─────────────────────────────────────────────────────────────

function ContactModal({
  contact, tags, onClose, onSaved, workspaceId, onManageFunnels, onManageJourneys,
}: {
  contact?: Contact; tags: Tag[]; onClose: () => void; onSaved: () => void; workspaceId?: string;
  onManageFunnels: () => void; onManageJourneys: () => void;
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

  const { data: funnels = [] } = useQuery<Funnel[]>({
    queryKey: ["funnels", workspaceId],
    queryFn: () => crmApi.listFunnels(workspaceId).then(r => r.data),
  });
  const selectedFunnel = funnels.find(f => f.name === funnel);
  const { data: funnelStages = [] } = useQuery<FunnelStage[]>({
    queryKey: ["funnel-stages", selectedFunnel?.id],
    queryFn: () => selectedFunnel ? crmApi.listFunnelStages(selectedFunnel.id).then(r => r.data) : Promise.resolve([]),
    enabled: !!selectedFunnel,
  });
  const { data: journeys = [] } = useQuery<Journey[]>({
    queryKey: ["journeys"],
    queryFn: () => journeysApi.list().then(r => r.data),
  });

  const toggleTag = (id: string) =>
    setSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!name.trim() || !phone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    setSaving(true);
    const payload = { name, phone, email, notes, funnel, stage, journey, external_id: externalId, owner, workspace_id: workspaceId };
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
    background: active ? "var(--border-default)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-3)",
    border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl animate-fade-in-up flex flex-col"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-base font-medium" style={{ color: "var(--text-1)" }}>
            {contact ? "Editar Contato" : "Novo Contato"}
          </h2>
          <button onClick={onClose} style={{ color: "var(--text-3)" }} className="hover:opacity-70 transition-opacity">
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
                <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-3)" }}>Notas</label>
                <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observações sobre o contato..."
                    rows={3}
                    className="w-full bg-transparent text-sm outline-none resize-none"
                    style={{ color: "var(--text-1)" }}
                  />
                </div>
              </div>

              {tags.length > 0 && (
                <div>
                  <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-3)" }}>Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const selected = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all"
                          style={{
                            background: selected ? tag.color + "22" : "var(--surface-2)",
                            color: selected ? tag.color : "var(--text-3)",
                            border: `1px solid ${selected ? tag.color + "44" : "var(--border-default)"}`,
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
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  Estas variáveis ajudam a segmentar e rastrear o lead dentro do seu processo de vendas.
                </p>
              </div>

              <FieldSelect
                icon={GitBranch}
                label="Funil"
                value={funnel}
                onChange={(v) => { setFunnel(v); setStage(""); }}
                options={funnels.map(f => ({ value: f.name, label: f.name }))}
                onManage={onManageFunnels}
                manageLabel="Gerenciar funis"
                emptyHint="Nenhum funil criado — crie antes de atribuir."
              />
              <FieldSelect
                icon={Layers}
                label="Etapa"
                value={stage}
                onChange={setStage}
                options={funnelStages.map(s => ({ value: s.name, label: s.name }))}
                onManage={onManageFunnels}
                manageLabel="Gerenciar etapas do funil"
                emptyHint={selectedFunnel ? "Este funil ainda não tem etapas." : "Escolha um funil primeiro."}
                disabled={!selectedFunnel}
              />
              <FieldSelect
                icon={Route}
                label="Jornada"
                value={journey}
                onChange={setJourney}
                options={journeys.filter(j => j.status === "active").map(j => ({ value: j.name, label: j.name }))}
                onManage={onManageJourneys}
                manageLabel="Gerenciar jornadas"
                emptyHint="Nenhuma jornada ativa."
              />
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
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-3)" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-sm font-medium py-2.5 rounded-xl transition-all disabled:opacity-40"
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

function TagManager({ onClose, workspaceId }: { onClose: () => void; workspaceId?: string }) {
  const queryClient = useQueryClient();
  const { data: tags = [] } = useQuery<Tag[]>({ queryKey: ["tags", workspaceId], queryFn: () => crmApi.listTags(workspaceId).then(r => r.data) });
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const createTag = useMutation({
    mutationFn: () => crmApi.createTag(name.trim(), color, workspaceId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tags"] }); setName(""); toast.success("Tag criada"); },
    onError: () => toast.error("Erro ao criar tag"),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => crmApi.deleteTag(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tags"] }); queryClient.invalidateQueries({ queryKey: ["contacts"] }); },
    onError: () => toast.error("Erro ao deletar tag"),
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-fade-in-up"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-medium" style={{ color: "var(--text-1)" }}>Gerenciar Tags</h2>
          <button onClick={onClose} style={{ color: "var(--text-3)" }} className="hover:opacity-70 transition-opacity"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            <TagIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da tag"
              className="flex-1 bg-transparent text-sm outline-none" style={{ color: "var(--text-1)" }}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && createTag.mutate()} />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} className="w-6 h-6 rounded-full transition-all"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--surface-2), 0 0 0 4px ${c}` : "none" }} />
            ))}
          </div>
          <button onClick={() => name.trim() && createTag.mutate()} disabled={!name.trim() || createTag.isPending}
            className="w-full text-sm font-medium py-2 rounded-xl transition-all disabled:opacity-40"
            style={{ background: "var(--green)", color: "#03170a" }}>
            Criar Tag
          </button>
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between p-2 rounded-xl" style={{ background: "var(--surface-2)" }}>
              <TagBadge tag={tag} />
              <button onClick={() => deleteTag.mutate(tag.id)} className="p-1 rounded-lg transition-colors hover:text-red-400" style={{ color: "var(--text-3)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {tags.length === 0 && <p className="text-center text-xs py-4" style={{ color: "var(--text-3)" }}>Nenhuma tag ainda</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Funnel Manager ───────────────────────────────────────────────────────────

type FunnelStage = { id: string; funnel_id: string; name: string; color?: string; order?: number };
type Funnel = { id: string; name: string; description?: string; color?: string; stages?: FunnelStage[] };

function FunnelManager({ onClose, workspaceId }: { onClose: () => void; workspaceId?: string }) {
  const qc = useQueryClient();
  const { data: funnels = [] } = useQuery<Funnel[]>({
    queryKey: ["funnels", workspaceId],
    queryFn: () => crmApi.listFunnels(workspaceId).then(r => r.data),
  });
  // Modo: lista de funis OU formulário de criar/editar.
  const [mode, setMode] = useState<"list" | "create">("list");
  const [editingFunnel, setEditingFunnel] = useState<Funnel | null>(null);

  const deleteFunnel = useMutation({
    mutationFn: (id: string) => crmApi.deleteFunnel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funnels"] });
      qc.invalidateQueries({ queryKey: ["funnel-options"] });
      toast.success("Funil removido");
    },
    onError: () => toast.error("Erro ao remover funil"),
  });

  const onCreate = () => {
    setEditingFunnel(null);
    setMode("create");
  };
  const onEdit = (f: Funnel) => {
    setEditingFunnel(f);
    setMode("create");
  };
  const back = () => {
    setEditingFunnel(null);
    setMode("list");
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div
        className="relative w-full max-w-2xl rounded-2xl shadow-2xl animate-fade-in-up overflow-hidden flex flex-col"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--surface-border)",
          maxHeight: "min(90vh, 720px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--surface-border)" }}>
          <div className="flex items-center gap-3">
            {mode === "create" && (
              <button onClick={back} className="p-1 rounded-lg transition-colors hover:bg-white/5" style={{ color: "var(--text-3)" }}>
                <ChevronDown className="w-4 h-4 rotate-90" />
              </button>
            )}
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)" }}
            >
              <GitBranch className="w-4 h-4" style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                {mode === "list" ? "Funis e Etapas" : editingFunnel ? `Editar ${editingFunnel.name}` : "Novo funil"}
              </h2>
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {mode === "list"
                  ? "Pipelines de vendas configuráveis por workspace"
                  : "Defina o nome, cor e as etapas do pipeline"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {mode === "list" ? (
            <FunnelList
              funnels={funnels}
              onCreate={onCreate}
              onEdit={onEdit}
              onDelete={(id) => deleteFunnel.mutate(id)}
            />
          ) : (
            <FunnelForm
              funnel={editingFunnel}
              workspaceId={workspaceId}
              onDone={back}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelList({
  funnels,
  onCreate,
  onEdit,
  onDelete,
}: {
  funnels: Funnel[];
  onCreate: () => void;
  onEdit: (f: Funnel) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <button
        onClick={onCreate}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
        style={{ background: "var(--green, #00d46a)", color: "#0a0a0f" }}
      >
        <Plus className="w-4 h-4" />
        Criar novo funil
      </button>

      {funnels.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}
        >
          <GitBranch className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Nenhum funil ainda</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Crie seu primeiro pipeline de vendas pra organizar leads
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {funnels.map((f) => (
            <FunnelListItem key={f.id} funnel={f} onEdit={() => onEdit(f)} onDelete={() => onDelete(f.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FunnelListItem({
  funnel,
  onEdit,
  onDelete,
}: {
  funnel: Funnel;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data: stages = [] } = useQuery<FunnelStage[]>({
    queryKey: ["funnel-stages", funnel.id],
    queryFn: () => crmApi.listFunnelStages(funnel.id).then((r) => r.data),
  });
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3 transition-colors hover:bg-white/[0.02]"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: funnel.color || "#a78bfa" }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{funnel.name}</div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
          {stages.length} {stages.length === 1 ? "etapa" : "etapas"}
          {stages.length > 0 && (
            <span className="ml-2 opacity-70">
              · {stages.slice(0, 4).map((s) => s.name).join(" → ")}
              {stages.length > 4 && " → …"}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onEdit}
        className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
        style={{ color: "var(--text-3)" }}
        title="Editar funil e etapas"
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={async () => {
          if (!(await showConfirm(`Excluir funil "${funnel.name}"?`, { title: "Excluir funil", confirmLabel: "Excluir" }))) return;
          onDelete();
        }}
        className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
        style={{ color: "var(--text-3)" }}
        title="Excluir"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// FunnelForm — cria ou edita um funil completo (nome, descrição, cor, stages
// reordenáveis). Em modo create, cria o funil + cada stage sequencialmente
// pra que o usuário monte o pipeline em uma única tela.
function FunnelForm({
  funnel,
  workspaceId,
  onDone,
}: {
  funnel: Funnel | null;
  workspaceId?: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const editing = !!funnel;

  const [name, setName] = useState(funnel?.name ?? "");
  const [description, setDescription] = useState(funnel?.description ?? "");
  const [color, setColor] = useState(funnel?.color ?? PRESET_COLORS[0]);

  // Stages locais (id pode ser temporário ou real). Em modo create, criamos
  // tudo no save; em modo edit, modificações de stage existente vão direto.
  type LocalStage = { id: string; name: string; color: string; persisted: boolean };
  const { data: existingStages = [] } = useQuery<FunnelStage[]>({
    queryKey: ["funnel-stages", funnel?.id],
    queryFn: () => (funnel ? crmApi.listFunnelStages(funnel.id).then((r) => r.data) : Promise.resolve([])),
    enabled: editing,
  });

  const [stages, setStages] = useState<LocalStage[]>([]);
  // Sincroniza stages locais com as do servidor (apenas em edit).
  useEffect(() => {
    if (editing && existingStages.length > 0 && stages.length === 0) {
      setStages(
        existingStages.map((s) => ({ id: s.id, name: s.name, color: s.color || PRESET_COLORS[1], persisted: true })),
      );
    } else if (!editing && stages.length === 0) {
      // Defaults úteis pra começar — user pode editar/excluir.
      setStages([
        { id: "tmp-1", name: "Novo Lead", color: "#60a5fa", persisted: false },
        { id: "tmp-2", name: "Qualificação", color: "#fbbf24", persisted: false },
        { id: "tmp-3", name: "Proposta", color: "#a78bfa", persisted: false },
        { id: "tmp-4", name: "Negociação", color: "#fb923c", persisted: false },
        { id: "tmp-5", name: "Fechado", color: "#00d46a", persisted: false },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingStages, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let funnelId = funnel?.id;
      if (!funnelId) {
        const r = await crmApi.createFunnel({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          workspace_id: workspaceId,
        });
        funnelId = r.data?.id;
        if (!funnelId) {
          throw new Error("Backend não retornou o ID do funil — verifique se a migração rodou");
        }
      } else {
        await crmApi.updateFunnel(funnelId, {
          name: name.trim(),
          description: description.trim() || undefined,
          color,
        });
      }
      // Stages existentes que foram removidos localmente → delete no servidor.
      // Defesa contra existingStages possivelmente null (Go nil slice → JSON null).
      const safeExisting = existingStages ?? [];
      const existingIds = new Set(safeExisting.map((s) => s.id));
      const localPersistedIds = new Set(stages.filter((s) => s.persisted).map((s) => s.id));
      for (const exId of existingIds) {
        if (!localPersistedIds.has(exId)) {
          await crmApi.deleteFunnelStage(funnelId!, exId);
        }
      }
      // Cria novas / atualiza existentes preservando ordem.
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i]!;
        if (!s.persisted) {
          await crmApi.createFunnelStage(funnelId!, { name: s.name, color: s.color, order: i });
        } else {
          // updateFunnelStage requer o backend novo (PUT). Em backend antigo
          // ele retorna 404 — capturamos e seguimos. As stages persisted que
          // não foram tocadas não importam (color/name já estão certos no DB).
          try {
            await crmApi.updateFunnelStage(funnelId!, s.id, { name: s.name, color: s.color, order: i });
          } catch (err) {
            const e = err as { response?: { status?: number } };
            if (e?.response?.status !== 404) throw err;
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funnels"] });
      qc.invalidateQueries({ queryKey: ["funnel-options"] });
      qc.invalidateQueries({ queryKey: ["funnel-stages"] });
      qc.invalidateQueries({ queryKey: ["stage-options"] });
      toast.success(editing ? "Funil atualizado" : "Funil criado");
      onDone();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = e?.response?.data?.error || e?.message || "Erro ao salvar funil";
      toast.error(msg);
    },
  });

  const addStage = () => {
    setStages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, name: "", color: PRESET_COLORS[prev.length % PRESET_COLORS.length] || "#60a5fa", persisted: false },
    ]);
  };
  const updateStage = (idx: number, patch: Partial<LocalStage>) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx));
  };
  const moveStage = (idx: number, dir: -1 | 1) => {
    setStages((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  };

  const canSave = name.trim().length > 0 && stages.every((s) => s.name.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* Identidade */}
      <section className="space-y-3">
        <SectionHeading icon={GitBranch}>Identidade do funil</SectionHeading>
        <FieldInput icon={GitBranch} label="Nome" value={name} onChange={setName} placeholder="Ex: Vendas B2B" required />
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-3)" }}>
            Descrição (opcional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Para que serve esse funil? Quem usa?"
            rows={2}
            className="w-full bg-transparent rounded-xl px-3 py-2 text-sm outline-none resize-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-1)",
            }}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-3)" }}>Cor</label>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full transition-all"
                style={{
                  background: c,
                  boxShadow: color === c ? `0 0 0 2px var(--surface-2), 0 0 0 4px ${c}` : "none",
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Stages */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionHeading icon={Layers}>Etapas do pipeline</SectionHeading>
          <button
            type="button"
            onClick={addStage}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ background: "rgba(0,212,106,0.08)", color: "var(--green, #00d46a)", border: "1px solid rgba(0,212,106,0.2)" }}
          >
            <Plus className="w-3 h-3" />
            Adicionar etapa
          </button>
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          Os contatos vão se mover por essas etapas no kanban. Ordem importa.
        </p>
        <div className="space-y-1.5">
          {stages.map((s, idx) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-xl p-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveStage(idx, -1)}
                  disabled={idx === 0}
                  className="p-0.5 rounded hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: "var(--text-3)" }}
                >
                  <ChevronDown className="w-3 h-3 rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => moveStage(idx, 1)}
                  disabled={idx === stages.length - 1}
                  className="p-0.5 rounded hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: "var(--text-3)" }}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <span className="text-xs tabular-nums w-5 text-center" style={{ color: "var(--text-3)" }}>{idx + 1}</span>
              <input
                value={s.name}
                onChange={(e) => updateStage(idx, { name: e.target.value })}
                placeholder="Nome da etapa"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--text-1)" }}
              />
              <select
                value={s.color}
                onChange={(e) => updateStage(idx, { color: e.target.value })}
                className="rounded-lg px-2 py-1 text-xs outline-none"
                style={{
                  background: s.color + "22",
                  color: s.color,
                  border: `1px solid ${s.color}44`,
                  fontWeight: 500,
                }}
                title="Cor da etapa"
              >
                {PRESET_COLORS.map((c) => (
                  <option key={c} value={c} style={{ background: "#111", color: c }}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeStage(idx)}
                className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                style={{ color: "var(--text-3)" }}
                title="Remover"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {stages.length === 0 && (
            <div className="text-center text-xs py-4" style={{ color: "var(--text-3)" }}>
              Nenhuma etapa — adicione ao menos uma.
            </div>
          )}
        </div>
      </section>

      {/* Save */}
      <div className="pt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="text-sm px-4 py-2 rounded-xl transition-colors"
          style={{ color: "var(--text-2)" }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!canSave || saveMutation.isPending}
          className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl transition-all disabled:opacity-40"
          style={{ background: "var(--green, #00d46a)", color: "#0a0a0f" }}
        >
          <Check className="w-4 h-4" />
          {editing ? "Salvar alterações" : "Criar funil"}
        </button>
      </div>
    </div>
  );
}

// FunnelSwitcher — dropdown estilizado pra trocar de pipeline. Mostra nome
// do funil + dot da cor + descrição opcional. Clica fora pra fechar.
function FunnelSwitcher({
  funnels,
  selectedId,
  onSelect,
  onManage,
}: {
  funnels: Funnel[];
  selectedId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = funnels.find((f) => f.id === selectedId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors min-w-[200px]"
        style={{
          background: selectedId ? "rgba(167,139,250,0.1)" : "var(--surface-2)",
          border: `1px solid ${selectedId ? "rgba(167,139,250,0.3)" : "var(--border-default)"}`,
          color: selectedId ? "#c4b5fd" : "var(--text-1)",
        }}
      >
        <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
        {selected ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: selected.color || "#a78bfa" }} />
            <span className="truncate flex-1 text-left">{selected.name}</span>
          </>
        ) : (
          <span className="truncate flex-1 text-left">Todos os contatos</span>
        )}
        <ChevronDown className="w-3 h-3 flex-shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl shadow-2xl overflow-hidden animate-fade-in-up"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
          >
            <div
              className="px-3 py-2 text-[10px] font-medium uppercase tracking-widest"
              style={{ color: "var(--text-3)", borderBottom: "1px solid var(--surface-border)" }}
            >
              Selecionar funil
            </div>
            <button
              type="button"
              onClick={() => {
                onSelect("");
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/[0.03]"
              style={{
                color: !selectedId ? "#00d46a" : "var(--text-2)",
                background: !selectedId ? "rgba(0,212,106,0.05)" : "transparent",
              }}
            >
              <ListIcon className="w-3.5 h-3.5" />
              Todos os contatos
              {!selectedId && <Check className="w-3.5 h-3.5 ml-auto" />}
            </button>
            <div className="max-h-72 overflow-y-auto">
              {funnels.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onSelect(f.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/[0.03] text-left"
                  style={{
                    color: f.id === selectedId ? "#00d46a" : "var(--text-1)",
                    background: f.id === selectedId ? "rgba(0,212,106,0.05)" : "transparent",
                  }}
                >
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: f.color || "#a78bfa" }} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{f.name}</div>
                    {f.description && (
                      <div className="truncate text-[10px]" style={{ color: "var(--text-3)" }}>
                        {f.description}
                      </div>
                    )}
                  </div>
                  {f.id === selectedId && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
              {funnels.length === 0 && (
                <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--text-3)" }}>
                  Nenhum funil ainda
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-white/[0.03]"
              style={{ color: "var(--green, #00d46a)", borderTop: "1px solid var(--surface-border)" }}
            >
              <Plus className="w-3.5 h-3.5" />
              Gerenciar funis e etapas
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeading({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
      <Icon className="w-3 h-3" />
      {children}
    </h3>
  );
}

// FunnelRow legado removido — substituído por FunnelListItem dentro do
// novo FunnelManager.

// ─── Journey Manager ──────────────────────────────────────────────────────────

type Journey = { id: string; name: string; description?: string; prompt?: string; status: string };

function JourneyManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: journeys = [] } = useQuery<Journey[]>({
    queryKey: ["journeys"],
    queryFn: () => journeysApi.list().then(r => r.data),
  });
  const [prompt, setPrompt] = useState("");

  const createJourney = useMutation({
    mutationFn: () => journeysApi.create(prompt.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journeys"] });
      qc.invalidateQueries({ queryKey: ["journey-options"] });
      setPrompt("");
      toast.success("Jornada criada — refine o fluxo em /journeys");
    },
    onError: () => toast.error("Erro ao criar jornada"),
  });

  const deleteJourney = useMutation({
    mutationFn: (id: string) => journeysApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journeys"] });
      qc.invalidateQueries({ queryKey: ["journey-options"] });
    },
    onError: () => toast.error("Erro ao remover jornada"),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) => journeysApi.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journeys"] }),
    onError: () => toast.error("Erro ao alterar status"),
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl animate-fade-in-up"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-medium" style={{ color: "var(--text-1)" }}>Gerenciar Jornadas</h2>
          <button onClick={onClose} style={{ color: "var(--text-3)" }} className="hover:opacity-70 transition-opacity"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3 mb-4">
          <div className="rounded-xl p-3" style={{ background: "rgba(0,212,106,0.04)", border: "1px solid rgba(0,212,106,0.1)" }}>
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Descreva o objetivo da jornada em linguagem natural — a IA gera o fluxo inicial. Você pode refinar depois em <Link href="/journeys" className="underline" style={{ color: "var(--green)" }}>/journeys</Link>.
            </p>
          </div>
          <div className="rounded-xl px-3 py-2.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: Qualificar leads B2B, agendar reunião com SDR quando interesse for confirmado..."
              rows={3}
              className="w-full bg-transparent text-sm outline-none resize-none" style={{ color: "var(--text-1)" }} />
          </div>
          <button onClick={() => prompt.trim() && createJourney.mutate()} disabled={!prompt.trim() || createJourney.isPending}
            className="w-full text-sm font-medium py-2 rounded-xl transition-all disabled:opacity-40"
            style={{ background: "var(--green)", color: "#03170a" }}>
            {createJourney.isPending ? "Criando..." : "Criar Jornada"}
          </button>
        </div>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {journeys.map((j) => (
            <div key={j.id} className="flex items-center justify-between gap-2 p-2 rounded-xl" style={{ background: "var(--surface-2)" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Route className="w-3.5 h-3.5 flex-shrink-0" style={{ color: j.status === "active" ? "var(--green)" : "var(--text-3)" }} />
                  <span className="text-sm truncate" style={{ color: "var(--text-1)" }}>{j.name}</span>
                </div>
                <span className="text-[10px] ml-5" style={{ color: j.status === "active" ? "var(--green)" : "var(--text-3)" }}>
                  {j.status === "active" ? "ativa" : "pausada"}
                </span>
              </div>
              <button onClick={() => toggleStatus.mutate({ id: j.id, status: j.status === "active" ? "paused" : "active" })}
                className="p-1 rounded-lg transition-colors" style={{ color: "var(--text-3)" }}
                title={j.status === "active" ? "Pausar" : "Ativar"}>
                {j.status === "active" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <Link href={`/agents/builder/${j.id}`} className="p-1 rounded-lg transition-colors hover:opacity-80" style={{ color: "var(--text-3)" }} title="Editar fluxo">
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <button onClick={() => deleteJourney.mutate(j.id)} className="p-1 rounded-lg transition-colors hover:text-red-400" style={{ color: "var(--text-3)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {journeys.length === 0 && <p className="text-center text-xs py-4" style={{ color: "var(--text-3)" }}>Nenhuma jornada ainda</p>}
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
      <label className="flex items-center gap-1 text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>
        <Icon className="w-3 h-3" /> {label}
      </label>
      <div className="relative">
        <select
          value={filters[field] ?? ""}
          onChange={(e) => onChange(field, e.target.value)}
          className="w-full appearance-none text-sm rounded-xl px-3 py-2.5 pr-8 outline-none cursor-pointer transition-all"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            color: filters[field] ? "var(--text-1)" : "var(--text-3)",
          }}
        >
          <option value="" style={{ background: "var(--surface-2)" }}>Todos</option>
          {options.map((o) => <option key={o} value={o} style={{ background: "var(--surface-2)" }}>{o}</option>)}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-3)" }} />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-end p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative w-72 rounded-2xl p-5 shadow-2xl animate-fade-in-up mt-16"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Filtros de Pipeline</h3>
          <button onClick={onClose} style={{ color: "var(--text-3)" }} className="hover:opacity-70 transition-opacity">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <SelectFilter label="Funil"      field="funnel"  options={funnels}  icon={GitBranch} />
          <SelectFilter label="Etapa"      field="stage"   options={stages}   icon={Layers} />
          <SelectFilter label="Jornada"    field="journey" options={journeys} icon={Route} />
          <SelectFilter label="Responsável" field="owner"  options={owners}   icon={UserCheck} />
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1" style={{ color: "var(--text-3)" }}>
              <Hash className="w-3 h-3" /> ID Externo
            </label>
            <input
              value={filters.external_id ?? ""}
              onChange={(e) => onChange("external_id", e.target.value)}
              placeholder="Buscar por ID externo..."
              className="w-full text-sm rounded-xl px-3 py-2 outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
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

// SecondaryButton — usado no header do CRM em desktop pra Tags/Funis/Jornadas
function SecondaryButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 text-sm font-medium px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl transition-all"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-2)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-1)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-2)")}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// CRMOverflowMenu — kebab que consolida Tags / Funis / Jornadas em mobile.
// Mantém o header limpo sem perder funcionalidade.
function CRMOverflowMenu({
  onTags,
  onFunnels,
  onJourneys,
}: {
  onTags: () => void;
  onFunnels: () => void;
  onJourneys: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const Item = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.04] text-left"
      style={{ color: "var(--text-1)" }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center p-2 rounded-xl transition-colors"
        style={{
          background: open ? "rgba(0,212,106,0.08)" : "var(--surface-2)",
          border: "1px solid " + (open ? "rgba(0,212,106,0.2)" : "var(--border-default)"),
          color: open ? "#00d46a" : "var(--text-2)",
        }}
        aria-label="Mais opções"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl shadow-2xl overflow-hidden uniq-scale-in"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
        >
          <Item icon={<TagIcon className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />} label="Tags" onClick={onTags} />
          <Item icon={<GitBranch className="w-3.5 h-3.5" style={{ color: "#60a5fa" }} />} label="Funis" onClick={onFunnels} />
          <Item icon={<Route className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />} label="Jornadas" onClick={onJourneys} />
        </div>
      )}
    </div>
  );
}

export default function CRMPage() {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const isMobile = useIsMobile();
  const [search, setSearch]               = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [pipelineFilters, setPipelineFilters] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen]       = useState(false);
  const [editContact, setEditContact]     = useState<Contact | null>(null);
  const [tagsOpen, setTagsOpen]           = useState(false);
  const [funnelsOpen, setFunnelsOpen]     = useState(false);
  const [journeysOpen, setJourneysOpen]   = useState(false);

  // Auto-abre o modal correspondente quando a URL traz ?manage=funnels|tags|journeys.
  // Usado pelo botão "Gerenciar funis" da página /crm/deals — em vez de
  // duplicar o FunnelManager em cada página, levamos o user pra contatos
  // com o modal já aberto. Roda só uma vez no mount pra não reabrir
  // depois que o user fecha.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const manage = params.get("manage");
    if (manage === "funnels") setFunnelsOpen(true);
    else if (manage === "tags") setTagsOpen(true);
    else if (manage === "journeys") setJourneysOpen(true);
    if (manage) {
      // limpa o param da URL pra não reabrir num refresh
      params.delete("manage");
      const next = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState(null, "", window.location.pathname + next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filterOpen, setFilterOpen]       = useState(false);
  const [viewMode, setViewMode]           = useState<"list" | "kanban">("list");
  const [kanbanGroup, setKanbanGroup]     = useState<"stage" | "journey" | "funnel">("stage");
  const [columnOrder, setColumnOrder]    = useState<string[]>([]);
  // Quando view="kanban" + agrupado por etapa, este é o funil que define
  // quais colunas aparecem (stages do funil + "Sem etapa").
  // Vazio = modo antigo (stages distintas agregadas de todos os contatos).
  const [pipelineFunnelId, setPipelineFunnelId] = useState<string>("");

  const { data: pipelineFunnels = [] } = useQuery<Funnel[]>({
    queryKey: ["funnels", currentWorkspace?.id],
    queryFn: () => crmApi.listFunnels(currentWorkspace?.id).then(r => r.data),
  });

  const selectedPipelineFunnel = pipelineFunnels.find(f => f.id === pipelineFunnelId);

  const { data: pipelineStages = [] } = useQuery<FunnelStage[]>({
    queryKey: ["funnel-stages", pipelineFunnelId],
    enabled: !!pipelineFunnelId,
    queryFn: () => crmApi.listFunnelStages(pipelineFunnelId).then(r => r.data),
  });

  const updateContactMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Contact> }) => crmApi.updateContact(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => toast.error("Erro ao mover contato"),
  });

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const contactId = result.draggableId;
    let newCol = result.destination.droppableId;
    // Colunas "sem categoria" / "sem etapa" significam campo vazio no DB.
    if (newCol === "Sem categoria" || newCol === "__no_stage__") newCol = "";

    queryClient.setQueryData<Contact[]>(["contacts", currentWorkspace?.id, search, activeTagFilter, pipelineFilters, pipelineFunnelId], (old) => {
      if (!old) return old;
      return old.map(c => c.id === contactId ? { ...c, [kanbanGroup]: newCol } : c);
    });

    updateContactMutation.mutate({ id: contactId, payload: { [kanbanGroup]: newCol } });
  };

  const activeFilterCount = Object.values(pipelineFilters).filter(Boolean).length;

  // Se o user está no modo pipeline-por-funil, força o filtro de funil
  // pra puxar só os contatos daquele funil.
  const effectiveFunnelFilter = selectedPipelineFunnel?.name || pipelineFilters.funnel;

  const queryParams = {
    search: search || undefined,
    tag_id: activeTagFilter || undefined,
    workspace_id: currentWorkspace?.id,
    ...Object.fromEntries(Object.entries(pipelineFilters).filter(([, v]) => v !== "")),
    ...(effectiveFunnelFilter ? { funnel: effectiveFunnelFilter } : {}),
  };

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", currentWorkspace?.id, search, activeTagFilter, pipelineFilters, pipelineFunnelId],
    queryFn: () => crmApi.listContacts(queryParams).then((r) => r.data.data),
  });

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ["tags", currentWorkspace?.id],
    queryFn: () => crmApi.listTags(currentWorkspace?.id).then((r) => r.data),
  });

  const { data: allContacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts-all", currentWorkspace?.id],
    queryFn: () => crmApi.listContacts({ limit: 500, workspace_id: currentWorkspace?.id }).then((r) => r.data.data),
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
    <div className="space-y-3 p-3 sm:p-4 uniq-page">
      <CrmHeader
        icon={<User className="w-4 h-4" style={{ color: "var(--green)" }} />}
        title="Contatos"
        subtitle={
          <>
            {contacts.length} contato{contacts.length !== 1 ? "s" : ""}
            {activeFilterCount > 0 && (
              <span style={{ color: "var(--green)" }}> · {activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""} ativo{activeFilterCount > 1 ? "s" : ""}</span>
            )}
          </>
        }
        actions={
          <>
            <CrmHeaderButton onClick={() => setJourneysOpen(true)} title="Jornadas">
              <Route className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Jornadas</span>
            </CrmHeaderButton>
            <CrmHeaderButton accent onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo contato</span>
              <span className="sm:hidden">Novo</span>
            </CrmHeaderButton>
          </>
        }
        toolbar={
          <div className="flex gap-2 flex-wrap items-center">
            <div
              className="flex items-center gap-0.5 rounded-xl p-0.5"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <button
                onClick={() => setViewMode("list")}
                className="p-1.5 rounded-lg transition-colors"
                style={{ background: viewMode === "list" ? "rgba(255,255,255,0.10)" : "transparent", color: viewMode === "list" ? "var(--text-1)" : "var(--text-2)" }}
                aria-label="Vista em lista"
              >
                <ListIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className="p-1.5 rounded-lg transition-colors"
                style={{ background: viewMode === "kanban" ? "rgba(255,255,255,0.10)" : "transparent", color: viewMode === "kanban" ? "var(--text-1)" : "var(--text-2)" }}
                aria-label="Vista em kanban"
              >
                <KanbanSquare className="w-4 h-4" />
              </button>
            </div>
            <CrmHeaderButton
              onClick={() => setFilterOpen(true)}
              active={activeFilterCount > 0}
              accent={activeFilterCount > 0}
              title="Filtros do pipeline"
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Pipeline</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full text-[9px] font-semibold flex items-center justify-center"
                  style={{ background: "var(--green)", color: "#03170a" }}>
                  {activeFilterCount}
                </span>
              )}
            </CrmHeaderButton>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1 min-w-[180px]"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contato…"
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: "var(--text-1)" }}
              />
              {search && <button onClick={() => setSearch("")}><X className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} /></button>}
            </div>
          </div>
        }
      />

      {tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap items-center">
          <button onClick={() => setActiveTagFilter(null)} className="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
            style={{
              background: activeTagFilter === null ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
              color: activeTagFilter === null ? "var(--text-1)" : "var(--text-3)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}>
            Todos
          </button>
          {tags.map((tag) => (
            <button key={tag.id} onClick={() => setActiveTagFilter(activeTagFilter === tag.id ? null : tag.id)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: activeTagFilter === tag.id ? tag.color + "22" : "rgba(255,255,255,0.04)",
                color: activeTagFilter === tag.id ? tag.color : "var(--text-3)",
                border: `1px solid ${activeTagFilter === tag.id ? tag.color + "44" : "rgba(255,255,255,0.08)"}`,
              }}>
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Kanban toolbar: seletor de funil (pipeline) + agrupamento */}
      {viewMode === "kanban" && (
        <div
          className="flex items-center justify-between gap-3 flex-wrap rounded-2xl px-4 py-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <FunnelSwitcher
              funnels={pipelineFunnels}
              selectedId={pipelineFunnelId}
              onSelect={(id) => {
                setPipelineFunnelId(id);
                if (id) setKanbanGroup("stage");
              }}
              onManage={() => setFunnelsOpen(true)}
            />

            {/* Agrupamento só faz sentido quando NÃO estamos num funil específico.
                No modo pipeline de funil, as colunas são fixas = stages do funil. */}
            {!pipelineFunnelId && contacts.length > 0 && (
              <>
                <span className="h-4 w-px" style={{ background: "var(--surface-border)" }} />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: "var(--text-3)" }}>
                    Agrupar por
                  </span>
                  <select
                    value={kanbanGroup}
                    onChange={(e) => setKanbanGroup(e.target.value as any)}
                    className="text-xs rounded-lg px-2.5 py-1.5 outline-none font-medium transition-colors cursor-pointer"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-1)" }}
                  >
                    <option value="stage" style={{ background: "#111" }}>Etapa</option>
                    <option value="journey" style={{ background: "#111" }}>Jornada</option>
                    <option value="funnel" style={{ background: "#111" }}>Funil</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {selectedPipelineFunnel && (
            <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
              {pipelineStages.length} {pipelineStages.length === 1 ? "etapa" : "etapas"}
              {pipelineStages.length > 0 && (
                <> · {pipelineStages.slice(0, 4).map((s) => s.name).join(" → ")}{pipelineStages.length > 4 && " → …"}</>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active pipeline filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: "var(--text-3)" }}>Pipeline:</span>
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
        (activeFilterCount > 0 || search || activeTagFilter) ? (
          <div className="rounded-2xl p-14 text-center animate-fade-in-up"
            style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: "var(--text-3)" }} />
            <p className="font-medium text-sm" style={{ color: "var(--text-2)" }}>Nenhum contato encontrado</p>
            <p className="text-sm mt-1.5" style={{ color: "var(--text-3)" }}>Tente ajustar os filtros</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-fade-in-up">
            {/* SVG: duas figuras humanas com ícone + */}
            <div className="mb-6 opacity-60">
              <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
                {/* Pessoa 1 — esquerda */}
                <circle cx="38" cy="38" r="12" stroke="var(--text-3)" strokeWidth="2" fill="none" />
                <path d="M18 78 C18 62 58 62 58 78" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" fill="none" />
                {/* Pessoa 2 — direita, levemente sobreposta */}
                <circle cx="66" cy="38" r="12" stroke="var(--text-3)" strokeWidth="2" fill="none" />
                <path d="M46 78 C46 62 86 62 86 78" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" fill="none" />
                {/* Ícone + verde — canto superior direito */}
                <circle cx="94" cy="26" r="14" fill="none" stroke="var(--green)" strokeWidth="2" />
                <line x1="94" y1="20" x2="94" y2="32" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="88" y1="26" x2="100" y2="26" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-1)" }}>
              Nenhum contato ainda
            </h3>
            <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--text-3)" }}>
              Importe contatos ou adicione manualmente para começar seu CRM
            </p>
            <Link
              href="/crm/import"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,106,0.18)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--green-dim)"; }}
            >
              <Plus className="w-4 h-4" />
              Importar contatos
            </Link>
          </div>
        )
      ) : viewMode === "list" ? (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          {contacts.map((contact, i) => {
            // Temperature based on days since last update
            const daysSince = contact.updated_at
              ? Math.floor((Date.now() - new Date(contact.updated_at).getTime()) / 86_400_000)
              : 999;
            const temp = daysSince <= 3 ? "hot" : daysSince <= 14 ? "warm" : "cold";
            const tempColor = temp === "hot" ? "#00d46a" : temp === "warm" ? "#f59e0b" : "#475569";
            const tempLabel = temp === "hot" ? "Ativo" : temp === "warm" ? "Morno" : "Inativo";

            // Avatar color based on name initial
            const charCode = (contact.name.charCodeAt(0) || 65) % 6;
            const avatarColors = [
              ["rgba(0,212,106,0.15)", "rgba(0,212,106,0.12)", "#00d46a"],
              ["rgba(96,165,250,0.15)", "rgba(96,165,250,0.12)", "#60a5fa"],
              ["rgba(167,139,250,0.15)", "rgba(167,139,250,0.12)", "#a78bfa"],
              ["rgba(245,158,11,0.15)", "rgba(245,158,11,0.12)", "#f59e0b"],
              ["rgba(236,72,153,0.15)", "rgba(236,72,153,0.12)", "#ec4899"],
              ["rgba(34,211,238,0.15)", "rgba(34,211,238,0.12)", "#22d3ee"],
            ];
            const [avBg, avBorder, avText] = avatarColors[charCode];

            return (
            <div
              key={contact.id}
              className="group flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
              style={{
                borderTop: i > 0 ? "1px solid var(--surface-border)" : undefined,
                borderLeft: `3px solid ${tempColor}30`,
              }}
            >
              {/* Avatar */}
              <div className="relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold mt-0.5"
                style={{
                  background: `linear-gradient(135deg, ${avBg}, transparent)`,
                  border: `1px solid ${avBorder}`,
                  color: avText,
                }}>
                {contact.name[0]?.toUpperCase()}
                {/* Temperature dot */}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{ background: tempColor, borderColor: "var(--surface-2)" }}
                  title={tempLabel} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {/* Name + tags row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{contact.name}</p>
                  {contact.tags?.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                </div>

                {/* Phone + email */}
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs font-mono" style={{ color: "var(--text-3)" }}>{contact.phone}</span>
                  {contact.email && <span className="text-xs" style={{ color: "var(--text-3)" }}>{contact.email}</span>}
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
                    <StickyNote className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
                  </span>
                )}
                <button
                  onClick={() => setEditContact(contact)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: "var(--text-3)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => { if (!await showConfirm(`Remover o contato "${contact.name}"?`, { title: "Remover contato", confirmLabel: "Remover" })) return; deleteContact.mutate(contact.id); }}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: "var(--text-3)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
            {(() => {
              // Modo pipeline de funil: colunas = stages do funil selecionado
              // (ordenadas pelo campo `order`) + "Sem etapa" no fim.
              // No drop, o droppableId é o nome exato da stage (ou
              // "__no_stage__" para a coluna sem etapa).
              if (selectedPipelineFunnel) {
                const orderedStages = [...pipelineStages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                const stageNames = new Set(orderedStages.map(s => s.name));
                const cols: Array<{ key: string; label: string; color?: string; isNoStage?: boolean }> = [
                  ...orderedStages.map(s => ({ key: s.name, label: s.name, color: s.color })),
                  { key: "__no_stage__", label: "Sem etapa", isNoStage: true },
                ];
                return cols.map((col) => {
                  const colContacts = col.isNoStage
                    ? contacts.filter(c => !c.stage || !stageNames.has(c.stage))
                    : contacts.filter(c => c.stage === col.key);
                  return (
                    <div
                      key={col.key}
                      className="flex-shrink-0 w-80 flex flex-col snap-start rounded-2xl"
                      style={{
                        background: "var(--surface-2)",
                        border: `1px solid ${col.isNoStage ? "var(--surface-2)" : (col.color || "#60a5fa") + "33"}`,
                      }}
                    >
                      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border-default)" }}>
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: col.isNoStage ? "#64748b" : (col.color || "#60a5fa") }} />
                          <h3 className="text-sm font-medium truncate" style={{ color: col.isNoStage ? "var(--text-2)" : "var(--text-1)" }}>
                            {col.label}
                          </h3>
                        </div>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                          {colContacts.length}
                        </span>
                      </div>
                      <Droppable droppableId={col.key}>
                        {(provided, snapshot) => (
                          <div
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                            className="flex-1 p-3 space-y-3 min-h-[150px] transition-colors"
                            style={{ background: snapshot.isDraggingOver ? "var(--surface-2)" : "transparent" }}
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
                                      background: "var(--surface-2)",
                                      border: `1px solid ${snapshot.isDragging ? "var(--green)" : "var(--surface-border)"}`,
                                      boxShadow: snapshot.isDragging ? "0 12px 24px rgba(0,0,0,0.5)" : "0 4px 12px rgba(0,0,0,0.2)",
                                    }}
                                    onClick={(e) => {
                                      if (!(e.target as HTMLElement).closest("button")) setEditContact(contact);
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{contact.name}</p>
                                        <p className="text-xs font-mono truncate" style={{ color: "var(--text-3)" }}>{contact.phone}</p>
                                      </div>
                                      <GripVertical className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-grab active:cursor-grabbing" style={{ color: "var(--text-3)" }} />
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {contact.tags?.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                                    </div>
                                    <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: "var(--border-default)" }}>
                                      <div className="flex items-center gap-1">
                                        {contact.owner && <span className="text-[10px]" style={{ color: "var(--text-3)" }}>👤 {contact.owner}</span>}
                                      </div>
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={(e) => { e.stopPropagation(); setEditContact(contact); }} className="hover:text-white" style={{ color: "var(--text-3)" }}><Edit2 className="w-3.5 h-3.5" /></button>
                                        <button onClick={async (e) => { e.stopPropagation(); if (!await showConfirm(`Remover "${contact.name}"?`)) return; deleteContact.mutate(contact.id); }} className="hover:text-red-400" style={{ color: "var(--text-3)" }}><Trash2 className="w-3.5 h-3.5" /></button>
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
              }

              // Modo genérico (sem funil selecionado): agrupamento por kanbanGroup.
              const columnsInfo = Array.from(new Set(contacts.map(c => c[kanbanGroup] || "Sem categoria"))).sort();
              // Use saved order or default (Sem categoria last)
              let sortedCols: string[];
              if (columnOrder.length > 0) {
                sortedCols = columnOrder.filter(c => columnsInfo.includes(c)).concat(columnsInfo.filter(c => !columnOrder.includes(c)));
              } else {
                sortedCols = columnsInfo.filter(c => c !== "Sem categoria").concat(columnsInfo.includes("Sem categoria") ? ["Sem categoria"] : []);
              }

              return sortedCols.map((colName) => {
                const colContacts = contacts.filter(c => (c[kanbanGroup] || "Sem categoria") === colName);
                const colIdx = sortedCols.indexOf(colName);
                return (
                  <div 
                    key={colName} 
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("colIdx", String(colIdx));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const fromIdx = parseInt(e.dataTransfer.getData("colIdx"));
                      const toIdx = colIdx;
                      if (fromIdx !== toIdx) {
                        const newOrder = [...sortedCols];
                        const [moved] = newOrder.splice(fromIdx, 1);
                        newOrder.splice(toIdx, 0, moved);
                        setColumnOrder(newOrder);
                      }
                    }}
                    className="flex-shrink-0 w-80 flex flex-col snap-start rounded-2xl transition-opacity"
                    style={{ 
                      background: "var(--surface-2)", 
                      border: "1px solid var(--border-default)",
                      cursor: "grab"
                    }}
                  >
                    <div className="px-4 py-3 border-b flex items-center justify-between select-none" style={{ borderColor: "var(--border-default)" }}>
                      <div className="flex items-center gap-2">
                        <GripVertical className="w-4 h-4 opacity-40" style={{ color: "var(--text-3)" }} />
                        <h3 className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                          {colName}
                        </h3>
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" 
                        style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                        {colContacts.length}
                      </span>
                    </div>
                    
                    <Droppable droppableId={colName}>
                      {(provided, snapshot) => (
                        <div
                          {...provided.droppableProps}
                          ref={provided.innerRef}
                          className="flex-1 p-3 space-y-3 min-h-[150px] transition-colors"
                          style={{ background: snapshot.isDraggingOver ? "var(--surface-2)" : "transparent" }}
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
                                    background: "var(--surface-2)",
                                    border: `1px solid ${snapshot.isDragging ? "var(--green)" : "var(--surface-border)"}`,
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
                                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{contact.name}</p>
                                      <p className="text-xs font-mono truncate" style={{ color: "var(--text-3)" }}>{contact.phone}</p>
                                    </div>
                                    <GripVertical className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-grab active:cursor-grabbing" style={{ color: "var(--text-3)" }} />
                                  </div>
                                  
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {contact.tags?.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                                  </div>
                                  
                                  <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: "var(--border-default)" }}>
                                    <div className="flex items-center gap-1">
                                      {contact.owner && <span className="text-[10px]" style={{ color: "var(--text-3)" }}>👤 {contact.owner}</span>}
                                    </div>
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={(e) => { e.stopPropagation(); setEditContact(contact); }} className="hover:text-white" style={{ color: "var(--text-3)" }}><Edit2 className="w-3.5 h-3.5" /></button>
                                      <button onClick={async (e) => { e.stopPropagation(); if (!await showConfirm(`Remover "${contact.name}"?`)) return; deleteContact.mutate(contact.id); }} className="hover:text-red-400" style={{ color: "var(--text-3)" }}><Trash2 className="w-3.5 h-3.5" /></button>
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
          workspaceId={currentWorkspace?.id}
          onClose={() => { setCreateOpen(false); setEditContact(null); }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["contacts"] });
            queryClient.invalidateQueries({ queryKey: ["contacts-all"] });
            // Mantém o painel do Inbox em sincronia com o contato editado.
            queryClient.invalidateQueries({ queryKey: ["contact"] });
            queryClient.invalidateQueries({ queryKey: ["funnel-options"] });
            queryClient.invalidateQueries({ queryKey: ["stage-options"] });
          }}
          onManageFunnels={() => setFunnelsOpen(true)}
          onManageJourneys={() => setJourneysOpen(true)}
        />
      )}
      {tagsOpen     && <TagManager     onClose={() => setTagsOpen(false)}     workspaceId={currentWorkspace?.id} />}
      {funnelsOpen  && <FunnelManager  onClose={() => setFunnelsOpen(false)}  workspaceId={currentWorkspace?.id} />}
      {journeysOpen && <JourneyManager onClose={() => setJourneysOpen(false)} />}
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
