"use client";

// FunnelManager — extraído de /crm/contacts pra ser reusado em
// outras páginas (deals, /crm/funnels dedicado). Exporta:
//   - FunnelManagerPanel: render inline (page mode), sem overlay
//   - FunnelManagerModal: wrapper com backdrop + dialog
//   - FunnelSwitcher: dropdown pra trocar de pipeline
//   - tipos Funnel/FunnelStage
//
// Tokens visuais usam var(--surface-*) pra acompanhar tema.

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, GitBranch, Layers, List as ListIcon, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { crmApi } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";

export type FunnelStage = { id: string; funnel_id: string; name: string; color?: string; order?: number };
export type Funnel = { id: string; name: string; description?: string; color?: string; stages?: FunnelStage[] };

const PRESET_COLORS = ["#00d46a", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

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
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text-1)" }} />
      </div>
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

function FunnelListItem({ funnel, onEdit, onDelete }: { funnel: Funnel; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl group"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: funnel.color || "#a78bfa" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{funnel.name}</p>
        {funnel.description && (
          <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>{funnel.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="text-[11px] px-2 py-1 rounded-lg" style={{ color: "var(--text-2)" }}>Editar</button>
        <button onClick={async () => { if (await showConfirm("Remover este funil? Etapas e referências em deals serão perdidas.", { title: "Remover funil", confirmLabel: "Remover" })) onDelete(); }}
          className="p-1.5 rounded-lg" style={{ color: "#f87171", background: "rgba(248,113,113,0.10)" }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function FunnelList({ funnels, onCreate, onEdit, onDelete }: {
  funnels: Funnel[]; onCreate: () => void; onEdit: (f: Funnel) => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <button onClick={onCreate}
        className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium"
        style={{ background: "rgba(0,212,106,0.10)", border: "1px dashed rgba(0,212,106,0.30)", color: "var(--green)" }}>
        <Plus className="w-4 h-4" /> Novo funil
      </button>
      {funnels.length === 0 ? (
        <div className="rounded-xl py-8 text-center" style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
          <GitBranch className="w-7 h-7 mx-auto mb-2" style={{ color: "var(--text-3)" }} />
          <p className="text-xs" style={{ color: "var(--text-3)" }}>Nenhum funil criado.</p>
        </div>
      ) : (
        funnels.map((f) => <FunnelListItem key={f.id} funnel={f} onEdit={() => onEdit(f)} onDelete={() => onDelete(f.id)} />)
      )}
    </div>
  );
}

function FunnelForm({ funnel, workspaceId, onDone }: {
  funnel: Funnel | null; workspaceId?: string; onDone: () => void;
}) {
  const qc = useQueryClient();
  const editing = !!funnel;
  const [name, setName] = useState(funnel?.name ?? "");
  const [description, setDescription] = useState(funnel?.description ?? "");
  const [color, setColor] = useState(funnel?.color ?? PRESET_COLORS[0]);

  type LocalStage = { id: string; name: string; color: string; persisted: boolean };
  const { data: existingStages = [] } = useQuery<FunnelStage[]>({
    queryKey: ["funnel-stages", funnel?.id],
    queryFn: () => (funnel ? crmApi.listFunnelStages(funnel.id).then((r) => r.data) : Promise.resolve([])),
    enabled: editing,
  });

  const [stages, setStages] = useState<LocalStage[]>([]);
  useEffect(() => {
    if (editing && existingStages.length > 0 && stages.length === 0) {
      setStages(existingStages.map((s) => ({ id: s.id, name: s.name, color: s.color || PRESET_COLORS[1]!, persisted: true })));
    } else if (!editing && stages.length === 0) {
      setStages([
        { id: "tmp-1", name: "Novo Lead",     color: "#60a5fa", persisted: false },
        { id: "tmp-2", name: "Qualificação",  color: "#fbbf24", persisted: false },
        { id: "tmp-3", name: "Proposta",      color: "#a78bfa", persisted: false },
        { id: "tmp-4", name: "Negociação",    color: "#fb923c", persisted: false },
        { id: "tmp-5", name: "Fechado",       color: "#00d46a", persisted: false },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingStages, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let funnelId = funnel?.id;
      if (!funnelId) {
        const r = await crmApi.createFunnel({ name: name.trim(), description: description.trim() || undefined, color, workspace_id: workspaceId });
        funnelId = r.data?.id;
        if (!funnelId) throw new Error("Backend não retornou ID do funil");
      } else {
        await crmApi.updateFunnel(funnelId, { name: name.trim(), description: description.trim() || undefined, color });
      }
      const safeExisting = existingStages ?? [];
      const localPersistedIds = new Set(stages.filter((s) => s.persisted).map((s) => s.id));
      for (const ex of safeExisting) {
        if (!localPersistedIds.has(ex.id)) await crmApi.deleteFunnelStage(funnelId!, ex.id);
      }
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i]!;
        if (!s.persisted) {
          await crmApi.createFunnelStage(funnelId!, { name: s.name, color: s.color, order: i });
        } else {
          try { await crmApi.updateFunnelStage(funnelId!, s.id, { name: s.name, color: s.color, order: i }); }
          catch (err) { const e = err as { response?: { status?: number } }; if (e?.response?.status !== 404) throw err; }
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
      toast.error(e?.response?.data?.error || e?.message || "Erro ao salvar funil");
    },
  });

  const addStage = () => setStages((p) => [...p, { id: `tmp-${Date.now()}`, name: "", color: PRESET_COLORS[p.length % PRESET_COLORS.length] || "#60a5fa", persisted: false }]);
  const updateStage = (i: number, patch: Partial<LocalStage>) => setStages((p) => p.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const removeStage = (i: number) => setStages((p) => p.filter((_, idx) => idx !== i));
  const moveStage = (i: number, dir: -1 | 1) => setStages((p) => {
    const next = [...p]; const t = i + dir;
    if (t < 0 || t >= next.length) return p;
    [next[i], next[t]] = [next[t]!, next[i]!]; return next;
  });

  const canSave = name.trim().length > 0 && stages.every((s) => s.name.trim().length > 0);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionHeading icon={GitBranch}>Identidade do funil</SectionHeading>
        <FieldInput icon={GitBranch} label="Nome" value={name} onChange={setName} placeholder="Ex: Vendas B2B" required />
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-3)" }}>Descrição (opcional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para que serve esse funil?" rows={2}
            className="w-full bg-transparent rounded-xl px-3 py-2 text-sm outline-none resize-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-3)" }}>Cor</label>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className="w-7 h-7 rounded-full transition-all"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${c}` : "none" }} />
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionHeading icon={Layers}>Etapas do pipeline</SectionHeading>
          <button type="button" onClick={addStage}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(0,212,106,0.10)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.20)" }}>
            <Plus className="w-3 h-3" /> Adicionar etapa
          </button>
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          Os contatos/deals vão se mover por essas etapas no kanban. Ordem importa.
        </p>
        <div className="space-y-1.5">
          {stages.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-2 rounded-xl p-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
              <div className="flex flex-col">
                <button type="button" onClick={() => moveStage(idx, -1)} disabled={idx === 0}
                  className="p-0.5 rounded hover:bg-white/5 disabled:opacity-30" style={{ color: "var(--text-3)" }}>
                  <ChevronDown className="w-3 h-3 rotate-180" />
                </button>
                <button type="button" onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1}
                  className="p-0.5 rounded hover:bg-white/5 disabled:opacity-30" style={{ color: "var(--text-3)" }}>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <span className="text-xs tabular-nums w-5 text-center" style={{ color: "var(--text-3)" }}>{idx + 1}</span>
              <input value={s.name} onChange={(e) => updateStage(idx, { name: e.target.value })} placeholder="Nome da etapa"
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: "var(--text-1)" }} />
              <select value={s.color} onChange={(e) => updateStage(idx, { color: e.target.value })}
                className="rounded-lg px-2 py-1 text-xs outline-none"
                style={{ background: s.color + "22", color: s.color, border: `1px solid ${s.color}44`, fontWeight: 500 }}>
                {PRESET_COLORS.map((c) => <option key={c} value={c} style={{ background: "#111", color: c }}>{c}</option>)}
              </select>
              <button type="button" onClick={() => removeStage(idx)} className="p-1.5 rounded-lg hover:bg-red-500/10"
                style={{ color: "var(--text-3)" }}>
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

      <div className="pt-2 flex items-center justify-end gap-2">
        <button type="button" onClick={onDone} className="text-sm px-4 py-2 rounded-xl" style={{ color: "var(--text-2)" }}>
          Cancelar
        </button>
        <button type="button" onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}
          className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-40"
          style={{ background: "var(--green)", color: "#0a0a0f" }}>
          <Check className="w-4 h-4" />
          {editing ? "Salvar alterações" : "Criar funil"}
        </button>
      </div>
    </div>
  );
}

// FunnelManagerPanel — modo página (sem overlay/modal)
export function FunnelManagerPanel({ workspaceId }: { workspaceId?: string }) {
  const qc = useQueryClient();
  const { data: funnels = [], isLoading } = useQuery<Funnel[]>({
    queryKey: ["funnels", workspaceId],
    queryFn: () => crmApi.listFunnels(workspaceId).then((r) => r.data),
  });
  const [mode, setMode] = useState<"list" | "create">("list");
  const [editing, setEditing] = useState<Funnel | null>(null);
  const deleteFunnel = useMutation({
    mutationFn: (id: string) => crmApi.deleteFunnel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funnels"] });
      toast.success("Funil removido");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
            {mode === "list" ? "Funis e Etapas" : editing ? `Editar ${editing.name}` : "Novo funil"}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
            {mode === "list"
              ? "Pipelines compartilhados entre Contatos, Deals e CRM."
              : "Defina nome, cor e etapas — usado pelo kanban e filtros."}
          </p>
        </div>
        {mode === "create" && (
          <button onClick={() => { setMode("list"); setEditing(null); }}
            className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
            ← Voltar
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando…</p>
      ) : mode === "list" ? (
        <FunnelList funnels={funnels} onCreate={() => { setEditing(null); setMode("create"); }}
          onEdit={(f) => { setEditing(f); setMode("create"); }}
          onDelete={(id) => deleteFunnel.mutate(id)} />
      ) : (
        <FunnelForm funnel={editing} workspaceId={workspaceId}
          onDone={() => { setEditing(null); setMode("list"); }} />
      )}
    </div>
  );
}

// FunnelManagerModal — wrapper antigo, ainda usado em /crm/contacts/page.tsx
// como atalho. Reusa o mesmo Panel internamente.
export function FunnelManagerModal({ workspaceId, onClose }: { workspaceId?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/5"
          style={{ color: "var(--text-3)" }}>
          <X className="w-4 h-4" />
        </button>
        <FunnelManagerPanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}

// FunnelSwitcher — dropdown pra trocar de pipeline. Versão exportada.
export function FunnelSwitcher({ funnels, selectedId, onSelect, onManage }: {
  funnels: Funnel[]; selectedId: string; onSelect: (id: string) => void; onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = funnels.find((f) => f.id === selectedId);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium min-w-[200px]"
        style={{
          background: selectedId ? "rgba(167,139,250,0.10)" : "var(--surface-2)",
          border: `1px solid ${selectedId ? "rgba(167,139,250,0.30)" : "var(--surface-border)"}`,
          color: selectedId ? "#c4b5fd" : "var(--text-1)",
        }}>
        <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
        {selected ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: selected.color || "#a78bfa" }} />
            <span className="truncate flex-1 text-left">{selected.name}</span>
          </>
        ) : (
          <span className="truncate flex-1 text-left">Todos</span>
        )}
        <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl shadow-2xl overflow-hidden"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            <button type="button" onClick={() => { onSelect(""); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.03]"
              style={{ color: !selectedId ? "var(--green)" : "var(--text-2)" }}>
              <ListIcon className="w-3.5 h-3.5" /> Todos
              {!selectedId && <Check className="w-3.5 h-3.5 ml-auto" />}
            </button>
            <div className="max-h-72 overflow-y-auto">
              {funnels.map((f) => (
                <button key={f.id} type="button" onClick={() => { onSelect(f.id); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.03] text-left"
                  style={{ color: f.id === selectedId ? "var(--green)" : "var(--text-2)" }}>
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: f.color || "#a78bfa" }} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{f.name}</div>
                    {f.description && <div className="truncate text-[10px]" style={{ color: "var(--text-3)" }}>{f.description}</div>}
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
            <button type="button" onClick={() => { setOpen(false); onManage(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium hover:bg-white/[0.03]"
              style={{ color: "var(--green)", borderTop: "1px solid var(--surface-border)" }}>
              <Plus className="w-3.5 h-3.5" /> Gerenciar funis e etapas
            </button>
          </div>
        </>
      )}
    </div>
  );
}
