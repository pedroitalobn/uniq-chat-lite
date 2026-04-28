"use client";

// Segmentações agnósticas — builder de condições AND/OR pra recortar
// contatos por critérios cruzados (funil + jornada + compra + tag…).
//
// Backend: usa o endpoint de campanhas (segment_filter) — mesma estrutura
// já suportada por /v1/campaigns. Aqui é só o construtor visual; salvar
// um segmento gera um record reutilizável (próximo passo: persistir em
// /v1/segments).

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Filter as FilterIcon, Save, Search, Layers, ChevronRight, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { CRMTabs } from "@/components/crm/CRMTabs";
import { segmentsApi } from "@/lib/api";

type Op = "and" | "or";
type Field =
  | "funnel" | "stage" | "journey" | "tag" | "owner"
  | "purchased_shop" | "purchased_since_days" | "purchased_min_total" | "never_purchased"
  | "passed_agent" | "signup_after" | "signup_before" | "channel";

type Cond = {
  id: string;
  field: Field;
  value: string;
};

const FIELDS: { value: Field; label: string; group: string; type?: "text" | "number" | "date" | "boolean" }[] = [
  { value: "funnel",               label: "Está no funil",                group: "CRM" },
  { value: "stage",                label: "Está no estágio",              group: "CRM" },
  { value: "tag",                  label: "Tem a tag",                    group: "CRM" },
  { value: "owner",                label: "Owner é o usuário",            group: "CRM" },
  { value: "channel",              label: "Veio pelo canal",              group: "CRM" },
  { value: "journey",              label: "Está/passou na jornada",       group: "Jornada" },
  { value: "passed_agent",         label: "Conversou com o agente IA",    group: "Jornada" },
  { value: "purchased_shop",       label: "Comprou na loja (shop_id)",    group: "Shop" },
  { value: "purchased_since_days", label: "Comprou nos últimos N dias",   group: "Shop", type: "number" },
  { value: "purchased_min_total",  label: "Compras totais ≥ R$",          group: "Shop", type: "number" },
  { value: "never_purchased",      label: "Nunca comprou",                group: "Shop", type: "boolean" },
  { value: "signup_after",         label: "Cadastrou-se após",            group: "Tempo", type: "date" },
  { value: "signup_before",        label: "Cadastrou-se antes de",        group: "Tempo", type: "date" },
];

const FIELD_BY: Record<Field, typeof FIELDS[number]> = FIELDS.reduce((acc, f) => {
  acc[f.value] = f;
  return acc;
}, {} as Record<Field, typeof FIELDS[number]>);

export default function CRMSegmentsPage() {
  const [name, setName] = useState("");
  const [op, setOp] = useState<Op>("and");
  const [conds, setConds] = useState<Cond[]>([
    { id: crypto.randomUUID(), field: "funnel", value: "" },
  ]);

  const addCond = () => setConds((c) => [...c, { id: crypto.randomUUID(), field: "tag", value: "" }]);
  const removeCond = (id: string) => setConds((c) => c.filter((x) => x.id !== id));
  const updateCond = (id: string, patch: Partial<Cond>) =>
    setConds((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Preview do filter JSON (mesmo shape do segment_filter de campanhas).
  const previewJson = useMemo(() => {
    const out: Record<string, any> = { _op: op };
    const tags: string[] = [];
    for (const c of conds) {
      if (!c.value && c.field !== "never_purchased") continue;
      switch (c.field) {
        case "funnel":               out.funnel = c.value; break;
        case "stage":                out.stage = c.value; break;
        case "journey":              out.journey = c.value; break;
        case "owner":                out.owner = c.value; break;
        case "channel":              out.channel = c.value; break;
        case "tag":                  tags.push(c.value); break;
        case "passed_agent":         out.passed_agent_id = c.value; break;
        case "purchased_shop":       out.purchased_shop_id = c.value; break;
        case "purchased_since_days": out.purchased_since_days = Number(c.value) || 0; break;
        case "purchased_min_total":  out.purchased_min_total = Number(c.value) || 0; break;
        case "never_purchased":      out.never_purchased = true; break;
        case "signup_after":         out.signup_after = c.value; break;
        case "signup_before":        out.signup_before = c.value; break;
      }
    }
    if (tags.length) out.tags = tags;
    return out;
  }, [conds, op]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 lg:py-8 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>Segmentações</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Recortes de contatos por critérios cruzados — usados em campanhas, jornadas e relatórios.
          </p>
        </div>
        <CRMTabs />
      </div>

      <div className="rounded-2xl p-5 space-y-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Nome do segmento</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Compradores VIP — últimos 30 dias"
            className="input-field w-full max-w-md" />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-3)" }}>Combinar condições com:</span>
          <div className="inline-flex rounded-lg overflow-hidden" style={{ background: "var(--surface-3)" }}>
            {(["and", "or"] as Op[]).map((o) => (
              <button key={o} onClick={() => setOp(o)}
                className="px-3 py-1.5 text-xs font-medium transition"
                style={op === o
                  ? { background: "var(--green-soft)", color: "var(--green)" }
                  : { color: "var(--text-3)" }}>
                {o === "and" ? "TODAS" : "QUALQUER"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {conds.map((c, idx) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg p-2"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
              {idx > 0 && (
                <span className="text-[10px] font-medium uppercase px-2 py-0.5 rounded"
                  style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                  {op === "and" ? "E" : "OU"}
                </span>
              )}
              <select value={c.field}
                onChange={(e) => updateCond(c.id, { field: e.target.value as Field, value: "" })}
                className="input-field text-xs flex-shrink-0" style={{ minWidth: 240 }}>
                {Array.from(new Set(FIELDS.map((f) => f.group))).map((g) => (
                  <optgroup key={g} label={g}>
                    {FIELDS.filter((f) => f.group === g).map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {FIELD_BY[c.field].type === "boolean" ? (
                <span className="text-xs" style={{ color: "var(--text-3)" }}>
                  (true)
                </span>
              ) : (
                <input
                  type={FIELD_BY[c.field].type === "number" ? "number" : FIELD_BY[c.field].type === "date" ? "date" : "text"}
                  value={c.value}
                  onChange={(e) => updateCond(c.id, { value: e.target.value })}
                  placeholder="valor"
                  className="input-field text-xs flex-1"
                />
              )}
              <button onClick={() => removeCond(c.id)} disabled={conds.length === 1}
                className="p-1.5 rounded-md disabled:opacity-30" style={{ color: "#f87171" }}
                title="Remover condição">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={addCond}
            className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
            <Plus className="w-3.5 h-3.5" /> Adicionar condição
          </button>
          <SegmentActions name={name} previewJson={previewJson} />
        </div>
      </div>

      <SegmentList />

      <details className="rounded-2xl"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <summary className="cursor-pointer px-5 py-3 text-xs font-medium flex items-center gap-2"
          style={{ color: "var(--text-2)" }}>
          <Layers className="w-3.5 h-3.5" /> JSON do filtro (use direto em campanhas)
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        </summary>
        <pre className="p-5 text-[11px] font-mono overflow-x-auto" style={{ color: "var(--text-2)" }}>
{JSON.stringify(previewJson, null, 2)}
        </pre>
      </details>

    </div>
  );
}

// ─── SegmentActions ──────────────────────────────────────────────────
function SegmentActions({ name, previewJson }: { name: string; previewJson: any }) {
  const qc = useQueryClient();
  const [previewing, setPreviewing] = useState<{ total: number; sample: any[] } | null>(null);

  const previewMut = useMutation({
    mutationFn: () => segmentsApi.preview(previewJson).then((r) => r.data),
    onSuccess: (data: any) => setPreviewing({ total: data.total, sample: data.sample || [] }),
    onError: () => toast.error("Erro ao prever"),
  });

  const saveMut = useMutation({
    mutationFn: () => segmentsApi.create({
      name: name.trim() || "Segmento sem nome",
      type: "dynamic",
      filter: previewJson,
    }),
    onSuccess: () => {
      toast.success("Segmento salvo");
      qc.invalidateQueries({ queryKey: ["segments"] });
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  return (
    <div className="flex items-center gap-2">
      {previewing && (
        <span className="text-xs" style={{ color: "var(--text-3)" }}>
          {previewing.total} contato{previewing.total !== 1 ? "s" : ""}
        </span>
      )}
      <button onClick={() => previewMut.mutate()} disabled={previewMut.isPending}
        className="text-xs px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
        style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
        {previewMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        Pré-visualizar
      </button>
      <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name.trim()}
        className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
        style={{ background: "var(--green)", color: "var(--green-fg)" }}>
        {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Salvar segmento
      </button>
    </div>
  );
}

// ─── SegmentList ─────────────────────────────────────────────────────
function SegmentList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["segments"],
    queryFn: () => segmentsApi.list().then((r) => r.data?.data ?? []),
  });
  const list: any[] = data || [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => segmentsApi.delete(id),
    onSuccess: () => {
      toast.success("Segmento removido");
      qc.invalidateQueries({ queryKey: ["segments"] });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} /></div>;
  }
  if (list.length === 0) {
    return null;
  }
  return (
    <div className="rounded-2xl"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
        <Users className="w-4 h-4" style={{ color: "var(--text-3)" }} />
        <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
          Segmentos salvos ({list.length})
        </h3>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--surface-border)" }}>
        {list.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between px-5 py-3 gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{s.name}</p>
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {s.type === "dynamic" ? "Dinâmico" : "Manual"}
                {typeof s.member_count === "number" && s.member_count > 0 && ` · ${s.member_count} contatos`}
              </p>
            </div>
            <button
              onClick={() => { if (confirm(`Remover "${s.name}"?`)) deleteMut.mutate(s.id); }}
              className="p-1.5 rounded-md" style={{ color: "#f87171" }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
