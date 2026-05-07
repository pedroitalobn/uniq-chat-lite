"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, Search, Layers, ChevronRight, Loader2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { segmentsApi } from "@/lib/api";
import { FunnelOptionPicker, StageOptionPicker, CompanyOptionPicker } from "@/components/crm/FunnelStagePicker";
import { CrmHeader } from "@/components/crm/CrmHeader";
import { Filter } from "lucide-react";

type GroupMatch = "all" | "any";

type Field =
  | "funnel" | "stage" | "journey" | "tag" | "owner" | "channel"
  // CRM v2 — filtros cross-entity (FK-based, JOIN com deals)
  | "funnel_id" | "stage_id" | "deal_status" | "company_id"
  | "min_deal_value" | "max_deal_value"
  | "purchased_shop" | "purchased_since_days" | "purchased_min_total" | "never_purchased"
  | "passed_agent" | "signup_after" | "signup_before"
  | "inbox_assigned_to" | "inbox_department" | "inbox_team" | "inbox_queue"
  | "inbox_response_time_max" | "inbox_conversation_count_min"
  | "inbox_last_contact_after" | "inbox_first_contact_after"
  | "participated_campaign";

type Cond = { id: string; field: Field; value: string };
type Group = { id: string; match: GroupMatch; conds: Cond[] };
type FilterState = { groups_match: GroupMatch; groups: Group[] };

interface FieldDef {
  value: Field;
  label: string;
  group: string;
  type?: "text" | "number" | "date" | "boolean";
  placeholder?: string;
}

const FIELDS: FieldDef[] = [
  { value: "funnel",                    label: "Está no funil (legacy)",       group: "CRM" },
  { value: "stage",                     label: "Está no estágio (legacy)",     group: "CRM" },
  { value: "tag",                       label: "Tem a tag",                    group: "CRM" },
  { value: "owner",                     label: "Owner é o usuário (ID)",       group: "CRM" },
  { value: "channel",                   label: "Veio pelo canal",              group: "CRM" },
  // CRM v2 — combinam com deals (cross-entity). Backend faz INNER JOIN
  // contacts → deals e aplica esses filtros.
  { value: "funnel_id",                 label: "Tem deal no funil (UUID)",     group: "Deals", placeholder: "UUID do funil" },
  { value: "stage_id",                  label: "Tem deal no estágio (UUID)",   group: "Deals", placeholder: "UUID do stage" },
  { value: "deal_status",               label: "Status do deal",               group: "Deals", placeholder: "open | won | lost" },
  { value: "company_id",                label: "Pertence à empresa (UUID)",    group: "Deals", placeholder: "UUID da company" },
  { value: "min_deal_value",            label: "Deal valor ≥ (cents)",         group: "Deals", type: "number", placeholder: "ex: 100000 = R$1.000" },
  { value: "max_deal_value",            label: "Deal valor ≤ (cents)",         group: "Deals", type: "number" },
  { value: "journey",                   label: "Está/passou na jornada",       group: "Jornada" },
  { value: "passed_agent",              label: "Atendido pelo agente IA (ID)", group: "Jornada" },
  { value: "purchased_shop",            label: "Comprou na loja (shop ID)",    group: "Compras" },
  { value: "purchased_since_days",      label: "Comprou nos últimos N dias",   group: "Compras", type: "number", placeholder: "ex: 30" },
  { value: "purchased_min_total",       label: "Total de compras ≥ R$",        group: "Compras", type: "number", placeholder: "ex: 100" },
  { value: "never_purchased",           label: "Nunca comprou",                group: "Compras", type: "boolean" },
  { value: "signup_after",              label: "Cadastrou-se após",            group: "Tempo", type: "date" },
  { value: "signup_before",             label: "Cadastrou-se antes de",        group: "Tempo", type: "date" },
  { value: "inbox_assigned_to",         label: "Atendido pelo atendente (ID)", group: "Inbox" },
  { value: "inbox_department",          label: "Departamento (ID)",            group: "Inbox" },
  { value: "inbox_team",                label: "Equipe (ID)",                  group: "Inbox" },
  { value: "inbox_queue",               label: "Fila (ID)",                    group: "Inbox" },
  { value: "inbox_response_time_max",   label: "Tempo de resp. ≤ N segundos",  group: "Inbox", type: "number", placeholder: "ex: 300" },
  { value: "inbox_conversation_count_min", label: "Nº de conversas ≥",        group: "Inbox", type: "number", placeholder: "ex: 3" },
  { value: "inbox_last_contact_after",  label: "Último contato após",          group: "Inbox", type: "date" },
  { value: "inbox_first_contact_after", label: "Primeiro contato após",        group: "Inbox", type: "date" },
  { value: "participated_campaign",     label: "Participou da campanha (ID)",  group: "Campanhas" },
];

const FIELD_BY: Record<Field, FieldDef> = FIELDS.reduce((acc, f) => {
  acc[f.value] = f;
  return acc;
}, {} as Record<Field, FieldDef>);

const FIELD_GROUPS = Array.from(new Set(FIELDS.map((f) => f.group)));

function newCond(): Cond {
  return { id: crypto.randomUUID(), field: "funnel", value: "" };
}
function newGroup(): Group {
  return { id: crypto.randomUUID(), match: "all", conds: [newCond()] };
}

export default function CRMSegmentsPage() {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<FilterState>({
    groups_match: "all",
    groups: [newGroup()],
  });

  const setGroupsMatch = (v: GroupMatch) => setFilter((f) => ({ ...f, groups_match: v }));

  const addGroup = () => setFilter((f) => ({ ...f, groups: [...f.groups, newGroup()] }));
  const removeGroup = (gid: string) =>
    setFilter((f) => ({ ...f, groups: f.groups.filter((g) => g.id !== gid) }));
  const setGroupMatch = (gid: string, match: GroupMatch) =>
    setFilter((f) => ({
      ...f,
      groups: f.groups.map((g) => (g.id === gid ? { ...g, match } : g)),
    }));

  const addCond = (gid: string) =>
    setFilter((f) => ({
      ...f,
      groups: f.groups.map((g) =>
        g.id === gid ? { ...g, conds: [...g.conds, newCond()] } : g
      ),
    }));
  const removeCond = (gid: string, cid: string) =>
    setFilter((f) => ({
      ...f,
      groups: f.groups.map((g) =>
        g.id === gid ? { ...g, conds: g.conds.filter((c) => c.id !== cid) } : g
      ),
    }));
  const updateCond = (gid: string, cid: string, patch: Partial<Cond>) =>
    setFilter((f) => ({
      ...f,
      groups: f.groups.map((g) =>
        g.id === gid
          ? { ...g, conds: g.conds.map((c) => (c.id === cid ? { ...c, ...patch } : c)) }
          : g
      ),
    }));

  // Build the filter JSON sent to the backend
  const filterJson = useMemo(() => {
    const groups = filter.groups
      .map((g) => {
        const conditions = g.conds
          .filter((c) => c.value !== "" || FIELD_BY[c.field].type === "boolean")
          .map((c) => ({ field: c.field, value: c.field === "never_purchased" ? true : c.value }));
        return { match: g.match, conditions };
      })
      .filter((g) => g.conditions.length > 0);
    return { groups_match: filter.groups_match, groups };
  }, [filter]);

  const matchLabel = (m: GroupMatch) => (m === "all" ? "TODAS" : "QUALQUER");

  return (
    <div className="p-3 sm:p-4 space-y-3">
      <CrmHeader
        icon={<Filter className="w-4 h-4" style={{ color: "var(--green)" }} />}
        title="Segmentações"
        subtitle="Recortes de contatos por critérios cruzados — usados em campanhas, jornadas e relatórios."
      />

      {/* Builder */}
      <div className="rounded-2xl p-5 space-y-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>

        {/* Name */}
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Nome do segmento</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Compradores VIP — últimos 30 dias"
            className="input-field w-full max-w-md" />
        </div>

        {/* Global match (between groups) */}
        {filter.groups.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-3)" }}>Combinar grupos com:</span>
            <MatchToggle value={filter.groups_match} onChange={setGroupsMatch} />
          </div>
        )}

        {/* Groups */}
        <div className="space-y-3">
          {filter.groups.map((group, gi) => (
            <div key={group.id}>
              {gi > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <div className="h-px flex-1" style={{ background: "var(--surface-border)" }} />
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded"
                    style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
                    {filter.groups_match === "all" ? "E" : "OU"}
                  </span>
                  <div className="h-px flex-1" style={{ background: "var(--surface-border)" }} />
                </div>
              )}

              <div className="rounded-xl p-3 space-y-2"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>

                {/* Group header */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                    Grupo {gi + 1}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-3)" }}>—</span>
                  <span className="text-[11px]" style={{ color: "var(--text-3)" }}>satisfaz</span>
                  <MatchToggle value={group.match} onChange={(v) => setGroupMatch(group.id, v)} size="sm" />
                  <span className="text-[11px]" style={{ color: "var(--text-3)" }}>das condições:</span>
                  <div className="flex-1" />
                  {filter.groups.length > 1 && (
                    <button onClick={() => removeGroup(group.id)}
                      className="p-1 rounded" style={{ color: "var(--text-3)" }}
                      title="Remover grupo">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Conditions */}
                {group.conds.map((cond, ci) => (
                  <div key={cond.id} className="flex flex-wrap items-center gap-2">
                    {ci > 0 && (
                      <span className="text-[10px] font-medium uppercase px-2 py-0.5 rounded shrink-0"
                        style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                        {group.match === "all" ? "E" : "OU"}
                      </span>
                    )}

                    <select
                      value={cond.field}
                      onChange={(e) => updateCond(group.id, cond.id, { field: e.target.value as Field, value: "" })}
                      className="input-field text-xs flex-1 min-w-0 sm:flex-none sm:w-64">
                      {FIELD_GROUPS.map((g) => (
                        <optgroup key={g} label={g}>
                          {FIELDS.filter((f) => f.group === g).map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>

                    {/* Pickers especializados pra fields que aceitam UUID
                        (funnel/stage/company) — em vez de pedir UUID raw,
                        carrega lista do workspace e mostra nomes. Pra outros
                        types cai no input genérico. */}
                    {FIELD_BY[cond.field].type === "boolean" ? (
                      <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                        ativo
                      </span>
                    ) : cond.field === "funnel_id" ? (
                      <FunnelOptionPicker value={cond.value}
                        onChange={(v) => updateCond(group.id, cond.id, { value: v })} />
                    ) : cond.field === "stage_id" ? (
                      <StageOptionPicker
                        funnelId={
                          group.conds.find((c) => c.field === "funnel_id")?.value ?? ""
                        }
                        value={cond.value}
                        onChange={(v) => updateCond(group.id, cond.id, { value: v })} />
                    ) : cond.field === "company_id" ? (
                      <CompanyOptionPicker value={cond.value}
                        onChange={(v) => updateCond(group.id, cond.id, { value: v })} />
                    ) : cond.field === "deal_status" ? (
                      <select value={cond.value}
                        onChange={(e) => updateCond(group.id, cond.id, { value: e.target.value })}
                        className="input-field text-xs flex-1 min-w-0">
                        <option value="">Qualquer status</option>
                        <option value="open">Aberto</option>
                        <option value="won">Ganho</option>
                        <option value="lost">Perdido</option>
                      </select>
                    ) : (
                      <input
                        type={FIELD_BY[cond.field].type === "number" ? "number" : FIELD_BY[cond.field].type === "date" ? "date" : "text"}
                        value={cond.value}
                        onChange={(e) => updateCond(group.id, cond.id, { value: e.target.value })}
                        placeholder={FIELD_BY[cond.field].placeholder ?? "valor"}
                        className="input-field text-xs flex-1 min-w-0"
                      />
                    )}

                    <button onClick={() => removeCond(group.id, cond.id)}
                      disabled={group.conds.length === 1}
                      className="p-1.5 rounded-md disabled:opacity-30 shrink-0"
                      style={{ color: "#f87171" }}
                      title="Remover condição">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                <button onClick={() => addCond(group.id)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1"
                  style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                  <Plus className="w-3 h-3" /> Condição
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <button onClick={addGroup}
            className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
            style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px dashed var(--surface-border)" }}>
            <Plus className="w-3.5 h-3.5" /> Adicionar grupo
          </button>
          <SegmentActions name={name} filterJson={filterJson} />
        </div>
      </div>

      <SegmentList />

      {/* Debug JSON */}
      <details className="rounded-2xl"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <summary className="cursor-pointer px-5 py-3 text-xs font-medium flex items-center gap-2"
          style={{ color: "var(--text-2)" }}>
          <Layers className="w-3.5 h-3.5" /> JSON do filtro (use direto em campanhas)
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        </summary>
        <pre className="p-5 text-[11px] font-mono overflow-x-auto" style={{ color: "var(--text-2)" }}>
{JSON.stringify(filterJson, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─── MatchToggle ─────────────────────────────────────────────────────
function MatchToggle({ value, onChange, size = "md" }: {
  value: GroupMatch;
  onChange: (v: GroupMatch) => void;
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? "px-2 py-0.5" : "px-3 py-1.5";
  const txt = size === "sm" ? "text-[10px]" : "text-xs";
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ background: "var(--surface-3)" }}>
      {(["all", "any"] as GroupMatch[]).map((m) => (
        <button key={m} onClick={() => onChange(m)}
          className={`${px} ${txt} font-medium transition`}
          style={value === m
            ? { background: "var(--green-soft)", color: "var(--green)" }
            : { color: "var(--text-3)" }}>
          {m === "all" ? "TODAS" : "QUALQUER"}
        </button>
      ))}
    </div>
  );
}

// ─── SegmentActions ──────────────────────────────────────────────────
function SegmentActions({ name, filterJson }: { name: string; filterJson: any }) {
  const qc = useQueryClient();
  const [previewing, setPreviewing] = useState<{ total: number; sample: any[] } | null>(null);

  const previewMut = useMutation({
    mutationFn: () => segmentsApi.preview(filterJson).then((r) => r.data),
    onSuccess: (data: any) => setPreviewing({ total: data.total, sample: data.sample || [] }),
    onError: () => toast.error("Erro ao pré-visualizar"),
  });

  const saveMut = useMutation({
    mutationFn: () => segmentsApi.create({
      name: name.trim() || "Segmento sem nome",
      type: "dynamic",
      filter: filterJson,
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
  if (list.length === 0) return null;

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
