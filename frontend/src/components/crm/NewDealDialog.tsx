"use client";

// NewDealDialog v2 — modal limpo de criação de deal usando tokens
// var(--surface-*) do design system. Cria contato/empresa inline via
// mini-form expandido (não só nome — phone é obrigatório no backend).
// Mobile-friendly: 100dvh em telas < md, max-w-xl em desktop.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { crmApi, companiesApi, dealsApi } from "@/lib/api";
import type { KanbanStage } from "./KanbanBoard";

export function NewDealDialog({
  wsId, funnel, stages, onClose, onCreated, defaultContactId, defaultCompanyId, defaultStageId,
}: {
  wsId: string;
  funnel: { id: string; name: string; currency: string; probability_on?: boolean } | null;
  stages: KanbanStage[];
  onClose: () => void;
  onCreated: () => void;
  defaultContactId?: string;
  defaultCompanyId?: string;
  defaultStageId?: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(defaultContactId ?? "");
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [stageId, setStageId] = useState(defaultStageId ?? "");
  const [valueMajor, setValueMajor] = useState("");
  const [currency, setCurrency] = useState(funnel?.currency ?? "BRL");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [description, setDescription] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");

  // Pre-seleciona o primeiro estágio quando os stages chegam.
  useEffect(() => {
    if (!stageId && stages.length > 0) {
      setStageId([...stages].sort((a, b) => a.order - b.order)[0]!.id);
    }
  }, [stages, stageId]);

  const contactsQ = useQuery({
    queryKey: ["crm-contacts-search", wsId, contactQuery],
    queryFn: () =>
      crmApi.listContacts({ search: contactQuery || undefined, limit: 12, workspace_id: wsId }).then((r) =>
        ((r.data as { items?: Array<{ id: string; name: string; phone?: string }> }).items ?? [])
      ),
    enabled: !!wsId,
    staleTime: 5_000,
  });

  const companiesQ = useQuery({
    queryKey: ["crm-companies-search", wsId, companyQuery],
    queryFn: () =>
      companiesApi.list(wsId, { q: companyQuery || undefined, limit: 12 }).then((r) =>
        ((r.data as { items?: Array<{ id: string; name: string }> }).items ?? [])
      ),
    enabled: !!wsId,
    staleTime: 5_000,
  });

  const create = useMutation({
    mutationFn: () => {
      const valueMinor = parseValueToMinor(valueMajor);
      if (!funnel) throw new Error("Selecione um funil antes de criar o deal");
      if (!contactId) throw new Error("Selecione ou crie um contato");
      if (!stageId) throw new Error("Selecione um estágio");
      return dealsApi.create(wsId, {
        title: title.trim(),
        contact_id: contactId,
        funnel_id: funnel.id,
        stage_id: stageId,
        company_id: companyId || undefined,
        value: valueMinor,
        currency,
        expected_close_date: expectedCloseDate || undefined,
        description: description || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Deal criado");
      qc.invalidateQueries({ queryKey: ["deals"] });
      onCreated();
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as Error)?.message
        || "Falha ao criar deal";
      toast.error(msg);
    },
  });

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.order - b.order), [stages]);
  const canSave = !!title.trim() && !!contactId && !!stageId && !!funnel;

  return (
    <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full md:max-w-xl rounded-t-2xl md:rounded-2xl flex flex-col"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--surface-border)",
          maxHeight: "90dvh",
          boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
        }}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--surface-border)" }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Novo deal</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              Funil: <span style={{ color: "var(--text-2)" }}>{funnel?.name ?? "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Título do deal *">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Ex.: Venda recorrente — Empresa X"
              className="input-base" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Contato *">
              <ContactPicker
                wsId={wsId}
                query={contactQuery}
                onQueryChange={setContactQuery}
                items={contactsQ.data ?? []}
                selectedId={contactId}
                onSelect={setContactId}
              />
            </Field>
            <Field label="Empresa (opcional)">
              <CompanyPicker
                wsId={wsId}
                query={companyQuery}
                onQueryChange={setCompanyQuery}
                items={companiesQ.data ?? []}
                selectedId={companyId}
                onSelect={setCompanyId}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Estágio *">
              <select value={stageId} onChange={(e) => setStageId(e.target.value)}
                className="input-base">
                {sortedStages.length === 0 && <option value="">— sem estágios —</option>}
                {sortedStages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Data prevista de fechamento">
              <input type="date" value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="input-base" />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Valor">
              <input value={valueMajor} onChange={(e) => setValueMajor(e.target.value)}
                placeholder="0,00" inputMode="decimal"
                className="input-base" />
            </Field>
            <Field label="Moeda">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="input-base">
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </Field>
          </div>

          <Field label="Descrição (opcional)">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} placeholder="Notas iniciais sobre o deal…"
              className="input-base resize-none" />
          </Field>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t flex-shrink-0"
          style={{ borderColor: "var(--surface-border)", paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text-2)" }}>
            Cancelar
          </button>
          <button onClick={() => create.mutate()}
            disabled={!canSave || create.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--green)", color: "#03170a" }}>
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Criar deal
          </button>
        </div>
      </div>

      <style jsx>{`
        .input-base {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.75rem;
          font-size: 0.875rem;
          background: var(--surface-2);
          border: 1px solid var(--surface-border);
          color: var(--text-1);
          outline: none;
          transition: border-color 0.15s;
        }
        .input-base:focus {
          border-color: var(--green);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>{label}</span>
      {children}
    </label>
  );
}

// ─── ContactPicker — busca + criar inline com modal expansível ────────────────
function ContactPicker({ wsId, query, onQueryChange, items, selectedId, onSelect }: {
  wsId: string;
  query: string;
  onQueryChange: (v: string) => void;
  items: Array<{ id: string; name: string; phone?: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const selected = items.find((i) => i.id === selectedId);

  const createMut = useMutation({
    mutationFn: () => crmApi.createContact({
      name: newName.trim(),
      phone: newPhone.trim(),
      workspace_id: wsId,
    } as any),
    onSuccess: (res) => {
      const id = (res.data as any)?.id || (res.data as any)?.data?.id;
      if (id) {
        onSelect(id);
        onQueryChange("");
        toast.success("Contato criado");
        qc.invalidateQueries({ queryKey: ["crm-contacts-search"] });
      }
      setShowCreate(false);
      setNewName("");
      setNewPhone("");
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Falha ao criar contato";
      toast.error(msg);
    },
  });

  const startCreate = () => {
    setNewName(query.trim());
    setShowCreate(true);
  };

  return (
    <div className="relative">
      {selected && !open ? (
        <button onClick={() => setOpen(true)}
          className="w-full text-left input-base flex items-center justify-between gap-2"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}>
          <div className="min-w-0">
            <div className="truncate text-sm">{selected.name}</div>
            {selected.phone && <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{selected.phone}</div>}
          </div>
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>trocar</span>
        </button>
      ) : (
        <input value={query} onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar contato…"
          className="input-base"
          style={{
            width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.75rem", fontSize: "0.875rem",
            background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)", outline: "none"
          }} />
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl shadow-2xl max-h-72 overflow-y-auto"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            {items.length === 0 && (
              <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--text-3)" }}>
                Nenhum contato encontrado.
              </div>
            )}
            {items.map((c) => (
              <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); onQueryChange(""); }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/[0.03]"
                style={{ color: c.id === selectedId ? "var(--green)" : "var(--text-1)" }}>
                <span className="text-sm truncate">{c.name}</span>
                {c.phone && <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-3)" }}>{c.phone}</span>}
              </button>
            ))}
            <button onClick={startCreate}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-t hover:bg-white/[0.03]"
              style={{ color: "var(--green)", borderColor: "var(--surface-border)" }}>
              <Plus className="w-3 h-3" /> Criar novo contato
              {query.trim() && <span className="opacity-60">"{query.trim()}"</span>}
            </button>
          </div>
        </>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-5 space-y-3"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Novo contato</h3>
            <Field label="Nome *">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                placeholder="Ex.: João Silva"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
            </Field>
            <Field label="WhatsApp / Telefone *">
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                placeholder="55 11 98765-4321"
                inputMode="tel"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-sm rounded-xl" style={{ color: "var(--text-2)" }}>
                Cancelar
              </button>
              <button onClick={() => createMut.mutate()}
                disabled={!newName.trim() || !newPhone.trim() || createMut.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
                style={{ background: "var(--green)", color: "#03170a" }}>
                {createMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Criar e selecionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CompanyPicker — análogo, sem phone obrigatório ──────────────────────────
function CompanyPicker({ wsId, query, onQueryChange, items, selectedId, onSelect }: {
  wsId: string;
  query: string;
  onQueryChange: (v: string) => void;
  items: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const selected = items.find((i) => i.id === selectedId);

  const createMut = useMutation({
    mutationFn: (name: string) => companiesApi.create(wsId, { name } as any),
    onSuccess: (res) => {
      const id = (res.data as any)?.id || (res.data as any)?.data?.id;
      if (id) {
        onSelect(id);
        onQueryChange("");
        setOpen(false);
        toast.success("Empresa criada");
        qc.invalidateQueries({ queryKey: ["crm-companies-search"] });
      }
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Falha ao criar empresa";
      toast.error(msg);
    },
    onSettled: () => setCreating(false),
  });

  return (
    <div className="relative">
      {selected && !open ? (
        <button onClick={() => setOpen(true)}
          className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}>
          <span className="truncate">{selected.name}</span>
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>trocar</span>
        </button>
      ) : (
        <input value={query} onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar empresa…"
          style={{
            width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.75rem", fontSize: "0.875rem",
            background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)", outline: "none"
          }} />
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl shadow-2xl max-h-72 overflow-y-auto"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            {selected && (
              <button onClick={() => { onSelect(""); onQueryChange(""); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-white/[0.03]"
                style={{ color: "var(--text-3)" }}>
                Remover seleção
              </button>
            )}
            {items.length === 0 && !query.trim() && (
              <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--text-3)" }}>
                Digite pra buscar ou criar nova.
              </div>
            )}
            {items.map((c) => (
              <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); onQueryChange(""); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/[0.03]"
                style={{ color: c.id === selectedId ? "var(--green)" : "var(--text-1)" }}>
                {c.name}
              </button>
            ))}
            {query.trim() && !items.some((i) => i.name.toLowerCase() === query.trim().toLowerCase()) && (
              <button onClick={() => { setCreating(true); createMut.mutate(query.trim()); }}
                disabled={creating}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-t hover:bg-white/[0.03]"
                style={{ color: "var(--green)", borderColor: "var(--surface-border)" }}>
                {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Criar empresa "{query.trim()}"
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function parseValueToMinor(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
