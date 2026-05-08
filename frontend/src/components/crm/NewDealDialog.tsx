"use client";

// NewDealDialog v2 — modal limpo de criação de deal usando tokens
// var(--surface-*) do design system. Cria contato/empresa inline via
// mini-form expandido (não só nome — phone é obrigatório no backend).
// Mobile-friendly: 100dvh em telas < md, max-w-xl em desktop.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { crmApi, companiesApi, dealsApi, customFieldsApi } from "@/lib/api";
import { MemberOptionPicker } from "@/components/crm/FunnelStagePicker";
import type { KanbanStage } from "./KanbanBoard";
import { CustomFieldsRenderer, type CustomFieldsValue } from "./CustomFieldsRenderer";

// Estilos compartilhados pra inputs/selects/textarea — usados via spread.
// Antes era styled-jsx, mas o scoping causava confusão dentro dos pickers.
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.75rem",
  fontSize: "0.875rem",
  background: "var(--surface-2)",
  border: "1px solid var(--surface-border)",
  color: "var(--text-1)",
  outline: "none",
};

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
  const [customFieldsValue, setCustomFieldsValue] = useState<CustomFieldsValue>({});
  // Owner — membro do workspace dono do deal. Era ausente da UI; sem ele
  // não dava pra dizer "esse deal é da Maria". Default vazio = sem owner.
  const [ownerId, setOwnerId] = useState("");

  // Definições de campos personalizados pra deals — carrega 1x e renderiza
  // dinâmico no fim do form. Vazio se o workspace não criou nenhum em Propriedades.
  const customFieldsQ = useQuery({
    queryKey: ["custom-fields", wsId, "deal"],
    queryFn: () => customFieldsApi.list(wsId, "deal").then((r) => r.data.items ?? []),
    enabled: !!wsId,
    staleTime: 60_000,
  });

  // Pre-seleciona o primeiro estágio quando os stages chegam.
  useEffect(() => {
    if (!stageId && stages.length > 0) {
      setStageId([...stages].sort((a, b) => a.order - b.order)[0]!.id);
    }
  }, [stages, stageId]);

  // ESC fecha — UX padrão pra modais.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pool local de contatos/empresas recém-criados — pra o picker não
  // perder a referência depois de criar inline (a query principal pode
  // demorar 1 frame pra refetchar).
  const [extraContacts, setExtraContacts] = useState<Array<{ id: string; name: string; phone?: string }>>([]);
  const [extraCompanies, setExtraCompanies] = useState<Array<{ id: string; name: string }>>([]);

  const contactsQ = useQuery({
    queryKey: ["crm-contacts-search", wsId, contactQuery],
    queryFn: () =>
      crmApi.listContacts({ search: contactQuery || undefined, limit: 20, workspace_id: wsId }).then((r) => {
        // Backend retorna {data: [...]} — alguns endpoints usam {items}, então
        // aceitamos os dois pra robustez.
        const raw = r.data as { items?: any[]; data?: any[] };
        const arr = (raw.items ?? raw.data ?? []) as Array<{ id: string; name: string; phone?: string }>;
        return arr;
      }),
    enabled: !!wsId,
    staleTime: 5_000,
  });

  const companiesQ = useQuery({
    queryKey: ["crm-companies-search", wsId, companyQuery],
    queryFn: () =>
      companiesApi.list(wsId, { q: companyQuery || undefined, limit: 20 }).then((r) => {
        const raw = r.data as { items?: any[]; data?: any[] };
        const arr = (raw.items ?? raw.data ?? []) as Array<{ id: string; name: string }>;
        return arr;
      }),
    enabled: !!wsId,
    staleTime: 5_000,
  });

  // Combina resultado da busca + criados-na-sessão, dedup por id.
  const contactItems = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; phone?: string }> = [];
    for (const c of [...extraContacts, ...(contactsQ.data ?? [])]) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }, [extraContacts, contactsQ.data]);

  const companyItems = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const c of [...extraCompanies, ...(companiesQ.data ?? [])]) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }, [extraCompanies, companiesQ.data]);

  const create = useMutation({
    mutationFn: () => {
      const valueMinor = parseValueToMinor(valueMajor);
      if (!funnel) throw new Error("Selecione um funil antes de criar o deal");
      if (!contactId) throw new Error("Selecione ou crie um contato");
      if (!stageId) throw new Error("Selecione um estágio");
      // Backend espera time.Time (RFC3339). O <input type="date"> devolve
      // YYYY-MM-DD, então normalizamos pra ISO 00:00 UTC antes de mandar.
      const closeISO = expectedCloseDate ? `${expectedCloseDate}T00:00:00Z` : undefined;
      return dealsApi.create(wsId, {
        title: title.trim(),
        contact_id: contactId,
        funnel_id: funnel.id,
        stage_id: stageId,
        company_id: companyId || undefined,
        owner_id: ownerId || undefined,
        value: valueMinor,
        currency,
        expected_close_date: closeISO,
        description: description || undefined,
        // custom_fields é tratado pelo handler como objeto JSON.
        // Não está no tipo do client (Record<string, unknown>), então
        // forçamos via assertion.
        ...(Object.keys(customFieldsValue).length > 0 ? { custom_fields: customFieldsValue } : {}),
      } as any);
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
      {/* Backdrop — clicar fecha. */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full md:max-w-xl rounded-t-2xl md:rounded-2xl flex flex-col"
        style={{
          background: "var(--surface-solid)",
          border: "1px solid var(--surface-border)",
          maxHeight: "90dvh",
          boxShadow: "0 24px 48px rgba(0,0,0,0.55)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--surface-border)" }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Novo deal</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              Funil: <span style={{ color: "var(--text-2)" }}>{funnel?.name ?? "—"}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Título do deal *">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Ex.: Venda recorrente — Empresa X"
              style={inputStyle}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Contato *">
              <ContactPicker
                wsId={wsId}
                query={contactQuery}
                onQueryChange={setContactQuery}
                items={contactItems}
                selectedId={contactId}
                onSelect={setContactId}
                onCreated={(c) => {
                  setExtraContacts((prev) => [c, ...prev]);
                  setContactId(c.id);
                }}
              />
            </Field>
            <Field label="Empresa (opcional)">
              <CompanyPicker
                wsId={wsId}
                query={companyQuery}
                onQueryChange={setCompanyQuery}
                items={companyItems}
                selectedId={companyId}
                onSelect={setCompanyId}
                onCreated={(c) => {
                  setExtraCompanies((prev) => [c, ...prev]);
                  setCompanyId(c.id);
                }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Estágio *">
              <select value={stageId} onChange={(e) => setStageId(e.target.value)} style={inputStyle}>
                {sortedStages.length === 0 && <option value="">— sem estágios —</option>}
                {sortedStages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Data prevista de fechamento">
              <input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="Responsável (owner)">
            <MemberOptionPicker
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Atribuir a um membro do workspace"
            />
          </Field>

          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Valor">
              <input
                value={valueMajor}
                onChange={(e) => setValueMajor(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                style={inputStyle}
              />
            </Field>
            <Field label="Moeda">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle}>
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </Field>
          </div>

          <Field label="Descrição (opcional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Notas iniciais sobre o deal…"
              style={{ ...inputStyle, resize: "none" }}
            />
          </Field>

          {(customFieldsQ.data?.length ?? 0) > 0 && (
            <div className="pt-3 border-t" style={{ borderColor: "var(--surface-border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
                style={{ color: "var(--text-3)" }}>
                Campos personalizados
              </p>
              <CustomFieldsRenderer
                defs={customFieldsQ.data ?? []}
                value={customFieldsValue}
                onChange={setCustomFieldsValue}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4 border-t flex-shrink-0"
          style={{ borderColor: "var(--surface-border)", paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm hover:bg-white/5"
            style={{ color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={!canSave || create.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Criar deal
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>{label}</span>
      {children}
    </div>
  );
}

// Hook reutilizável: detecta clique fora do ref e chama handler.
// Substitui o overlay fixed inset-0 que tava bloqueando o resto do modal.
function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

// ─── ContactPicker — busca + criar inline com modal expansível ────────────────
function ContactPicker({ wsId, query, onQueryChange, items, selectedId, onSelect, onCreated }: {
  wsId: string;
  query: string;
  onQueryChange: (v: string) => void;
  items: Array<{ id: string; name: string; phone?: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  onCreated?: (c: { id: string; name: string; phone?: string }) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const selected = items.find((i) => i.id === selectedId);
  const wrapRef = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const createMut = useMutation({
    mutationFn: () => crmApi.createContact({
      name: newName.trim(),
      phone: newPhone.trim(),
      workspace_id: wsId,
    } as any),
    onSuccess: (res) => {
      const data = (res.data as any) ?? {};
      const id = data.id || data.data?.id;
      const name = data.name || data.data?.name || newName.trim();
      const phone = data.phone || data.data?.phone || newPhone.trim();
      if (id) {
        onCreated?.({ id, name, phone });
        onSelect(id);
        onQueryChange("");
        toast.success("Contato criado e selecionado");
        qc.invalidateQueries({ queryKey: ["crm-contacts-search"] });
      } else {
        toast.error("Contato criado mas não foi possível ler o ID — tente buscar manualmente");
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
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      {selected && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left flex items-center justify-between gap-2"
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{selected.name}</span>
            {selected.phone && <span className="block text-[11px]" style={{ color: "var(--text-3)" }}>{selected.phone}</span>}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>trocar</span>
        </button>
      ) : (
        <input
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar contato…"
          style={inputStyle}
        />
      )}

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl shadow-2xl max-h-72 overflow-y-auto"
          style={{ background: "var(--surface-solid)", border: "1px solid var(--surface-border)" }}
        >
          {items.length === 0 && (
            <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--text-3)" }}>
              Nenhum contato encontrado.
            </div>
          )}
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c.id); setOpen(false); onQueryChange(""); }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/[0.03]"
              style={{ color: c.id === selectedId ? "var(--green)" : "var(--text-1)" }}
            >
              <span className="text-sm truncate">{c.name}</span>
              {c.phone && <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-3)" }}>{c.phone}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={startCreate}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-t hover:bg-white/[0.03]"
            style={{ color: "var(--green)", borderColor: "var(--surface-border)" }}
          >
            <Plus className="w-3 h-3" /> Criar novo contato
            {query.trim() && <span className="opacity-60">&quot;{query.trim()}&quot;</span>}
          </button>
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-5 space-y-3"
            style={{ background: "var(--surface-solid)", border: "1px solid var(--surface-border)" }}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Novo contato</h3>
            <Field label="Nome *">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                placeholder="Ex.: João Silva"
                style={inputStyle}
              />
            </Field>
            <Field label="WhatsApp / Telefone *">
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="55 11 98765-4321"
                inputMode="tel"
                style={inputStyle}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-sm rounded-xl hover:bg-white/5"
                style={{ color: "var(--text-2)" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => createMut.mutate()}
                disabled={!newName.trim() || !newPhone.trim() || createMut.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
                style={{ background: "var(--green)", color: "#03170a" }}
              >
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
function CompanyPicker({ wsId, query, onQueryChange, items, selectedId, onSelect, onCreated }: {
  wsId: string;
  query: string;
  onQueryChange: (v: string) => void;
  items: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  onCreated?: (c: { id: string; name: string }) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const selected = items.find((i) => i.id === selectedId);
  const wrapRef = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const createMut = useMutation({
    mutationFn: (name: string) => companiesApi.create(wsId, { name } as any),
    onSuccess: (res, name) => {
      const data = (res.data as any) ?? {};
      const id = data.id || data.data?.id;
      const finalName = data.name || data.data?.name || name;
      if (id) {
        onCreated?.({ id, name: finalName });
        onSelect(id);
        onQueryChange("");
        setOpen(false);
        toast.success("Empresa criada e selecionada");
        qc.invalidateQueries({ queryKey: ["crm-companies-search"] });
      } else {
        toast.error("Empresa criada mas não foi possível ler o ID");
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
    <div ref={wrapRef} className="relative">
      {selected && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left flex items-center justify-between gap-2"
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <span className="truncate">{selected.name}</span>
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>trocar</span>
        </button>
      ) : (
        <input
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar empresa…"
          style={inputStyle}
        />
      )}

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl shadow-2xl max-h-72 overflow-y-auto"
          style={{ background: "var(--surface-solid)", border: "1px solid var(--surface-border)" }}
        >
          {selected && (
            <button
              type="button"
              onClick={() => { onSelect(""); onQueryChange(""); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-white/[0.03]"
              style={{ color: "var(--text-3)" }}
            >
              Remover seleção
            </button>
          )}
          {items.length === 0 && !query.trim() && (
            <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--text-3)" }}>
              Digite pra buscar ou criar nova.
            </div>
          )}
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c.id); setOpen(false); onQueryChange(""); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-white/[0.03]"
              style={{ color: c.id === selectedId ? "var(--green)" : "var(--text-1)" }}
            >
              {c.name}
            </button>
          ))}
          {query.trim() && !items.some((i) => i.name.toLowerCase() === query.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={() => { setCreating(true); createMut.mutate(query.trim()); }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-t hover:bg-white/[0.03]"
              style={{ color: "var(--green)", borderColor: "var(--surface-border)" }}
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Criar empresa &quot;{query.trim()}&quot;
            </button>
          )}
        </div>
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
