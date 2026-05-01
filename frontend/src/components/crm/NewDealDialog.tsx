"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { crmApi, companiesApi, dealsApi } from "@/lib/api";
import { uniq, cardStyle } from "./tokens";
import type { KanbanStage } from "./KanbanBoard";

// NewDealDialog — modal para criação rápida de deal. Reusa o estilo Uniq
// (modal com backdrop blur, panel hsl(240 18% 6%), accent verde).
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

  // Pre-select the first stage once stages arrive
  useEffect(() => {
    if (!stageId && stages.length > 0) {
      setStageId([...stages].sort((a, b) => a.order - b.order)[0].id);
    }
  }, [stages, stageId]);

  const contactsQ = useQuery({
    queryKey: ["crm-contacts-search", wsId, contactQuery],
    queryFn: () =>
      crmApi.listContacts({ search: contactQuery || undefined, limit: 12, workspace_id: wsId }).then((r) =>
        (r.data as { items?: Array<{ id: string; name: string; phone?: string }> }).items ?? []
      ),
    enabled: !!wsId,
    staleTime: 5_000,
  });

  const companiesQ = useQuery({
    queryKey: ["crm-companies-search", wsId, companyQuery],
    queryFn: () =>
      companiesApi.list(wsId, { q: companyQuery || undefined, limit: 12 }).then((r) =>
        (r.data as { items?: Array<{ id: string; name: string }> }).items ?? []
      ),
    enabled: !!wsId,
    staleTime: 5_000,
  });

  const create = useMutation({
    mutationFn: () => {
      const valueMinor = parseValueToMinor(valueMajor);
      if (!funnel) throw new Error("sem funil selecionado");
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
      onCreated();
      onClose();
    },
    onError: () => toast.error("Falha ao criar deal"),
  });

  const disabled = !title.trim() || !contactId || !stageId;
  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.order - b.order), [stages]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: uniq.backdrop }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-xl rounded-2xl p-6 shadow-xl"
        style={{ background: uniq.bg, border: `1px solid ${uniq.border}` }}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-medium" style={{ color: uniq.textStrong }}>
              Novo deal
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: uniq.textDim }}>
              Funil: <span style={{ color: uniq.textPrimary }}>{funnel?.name ?? "—"}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 transition-opacity hover:opacity-70"
            style={{ color: uniq.textFaint }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Título *">
            <input
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ ...cardStyle, color: uniq.textPrimary }}
              placeholder="Ex.: Venda recorrente — Empresa X"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contato *">
              <ComboBox
                query={contactQuery}
                onQueryChange={setContactQuery}
                placeholder="Buscar ou criar contato…"
                items={(contactsQ.data ?? []).map((c) => ({
                  id: c.id,
                  label: c.name,
                  hint: c.phone,
                }))}
                selectedId={contactId}
                onSelect={setContactId}
                createLabel="Criar contato"
                onCreate={async (name) => {
                  try {
                    const r = await crmApi.createContact({ name, workspace_id: wsId } as any);
                    const created = (r.data as any)?.id || (r.data as any)?.data?.id;
                    if (created) {
                      toast.success("Contato criado");
                      return created as string;
                    }
                  } catch {
                    toast.error("Falha ao criar contato");
                  }
                  return null;
                }}
              />
            </Field>
            <Field label="Empresa (opcional)">
              <ComboBox
                query={companyQuery}
                onQueryChange={setCompanyQuery}
                placeholder="Buscar ou criar empresa…"
                items={(companiesQ.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
                selectedId={companyId}
                onSelect={setCompanyId}
                allowClear
                createLabel="Criar empresa"
                onCreate={async (name) => {
                  try {
                    const r = await companiesApi.create(wsId, { name } as any);
                    const created = (r.data as any)?.id || (r.data as any)?.data?.id;
                    if (created) {
                      toast.success("Empresa criada");
                      return created as string;
                    }
                  } catch {
                    toast.error("Falha ao criar empresa");
                  }
                  return null;
                }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Estágio *">
              <select
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
              >
                {sortedStages.map((s) => (
                  <option key={s.id} value={s.id} style={{ background: "#111" }}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data prevista">
              <input
                type="date"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Valor">
              <input
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                placeholder="0,00"
                value={valueMajor}
                onChange={(e) => setValueMajor(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Moeda">
              <select
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="BRL" style={{ background: "#111" }}>BRL</option>
                <option value="USD" style={{ background: "#111" }}>USD</option>
                <option value="EUR" style={{ background: "#111" }}>EUR</option>
              </select>
            </Field>
          </div>

          <Field label="Descrição">
            <textarea
              rows={3}
              className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
              style={{ ...cardStyle, color: uniq.textPrimary }}
              placeholder="Notas rápidas, contexto, links…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${uniq.borderFaint}`,
              color: uniq.textDim,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={disabled || create.isPending}
            className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ background: uniq.green, color: "#03170a" }}
          >
            {create.isPending ? "Criando…" : "Criar deal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: uniq.textDim }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ComboBox({
  query, onQueryChange, placeholder, items, selectedId, onSelect, allowClear, onCreate, createLabel,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  placeholder: string;
  items: { id: string; label: string; hint?: string }[];
  selectedId?: string;
  onSelect: (id: string) => void;
  allowClear?: boolean;
  onCreate?: (name: string) => Promise<string | null>; // retorna id criado
  createLabel?: string;
}) {
  const selected = items.find((i) => i.id === selectedId);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!onCreate || !query.trim()) return;
    setCreating(true);
    const id = await onCreate(query.trim());
    setCreating(false);
    if (id) {
      onSelect(id);
      onQueryChange("");
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        className="w-full rounded-xl px-3 py-2 text-sm outline-none"
        style={{ ...cardStyle, color: uniq.textPrimary }}
        placeholder={selected?.label ?? placeholder}
        value={query}
        onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg shadow-xl"
            style={{ background: uniq.bg, border: `1px solid ${uniq.border}` }}
          >
            {onCreate && query.trim() && !items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase()) && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-50 border-b"
                style={{ color: "#00d46a", borderColor: uniq.border }}
              >
                {creating ? "Criando…" : `+ ${createLabel ?? "Criar"} "${query.trim()}"`}
              </button>
            )}
            {allowClear && selected && (
              <button
                onClick={() => { onSelect(""); onQueryChange(""); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-white/5"
                style={{ color: uniq.textFaint }}
              >
                Remover seleção
              </button>
            )}
            {items.length === 0 && !onCreate && (
              <div className="px-3 py-2 text-xs" style={{ color: uniq.textFaint }}>
                Nenhum resultado.
              </div>
            )}
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => { onSelect(it.id); onQueryChange(""); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/5"
                style={{ color: it.id === selectedId ? uniq.green : uniq.textPrimary }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="text-[10px]" style={{ color: uniq.textFaint }}>{it.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function parseValueToMinor(raw: string): number {
  if (!raw) return 0;
  // Accept "1234,56" / "1234.56" / "1,234.56" — strip thousand separators
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // drop dots that look like thousand sep
    .replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
