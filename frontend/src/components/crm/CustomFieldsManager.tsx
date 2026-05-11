"use client";

// CustomFieldsManager — CRUD das DEFINIÇÕES de campos personalizados.
// Usado em /crm/properties (aba "Campos personalizados"). Exibe um
// painel por entidade (deal/contact/company) com listagem + criação +
// edição inline.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Layers, Briefcase, User, Building2 } from "lucide-react";
import { customFieldsApi, type CustomFieldDef, type CustomFieldEntity, type CustomFieldType } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Texto curto",
  textarea: "Texto longo",
  number: "Número",
  date: "Data",
  url: "URL",
  select: "Seleção única",
  multi: "Seleção múltipla",
  boolean: "Sim/Não",
};

const ENTITIES: Array<{ id: CustomFieldEntity; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; description: string }> = [
  { id: "deal",    label: "Deals",    icon: Briefcase,  description: "Atributos próprios de cada deal" },
  { id: "contact", label: "Contatos", icon: User,       description: "Campos extras nos contatos" },
  { id: "company", label: "Empresas", icon: Building2,  description: "Dados extras de empresas" },
];

export function CustomFieldsManager({ workspaceId }: { workspaceId?: string }) {
  if (!workspaceId) {
    return (
      <div className="text-sm py-6 text-center" style={{ color: "var(--text-3)" }}>
        Selecione um workspace pra gerenciar campos personalizados.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className="rounded-xl px-4 py-3 flex items-start gap-2 text-xs"
        style={{
          background: "rgba(0,212,106,0.06)",
          border: "1px solid rgba(0,212,106,0.18)",
          color: "var(--text-2)",
        }}
      >
        <Layers className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
        <div>
          <p className="font-medium" style={{ color: "var(--text-1)" }}>Atributos próprios da sua operação</p>
          <p className="mt-0.5">
            Crie campos como <span className="font-mono">linkedin</span>, <span className="font-mono">score</span>, <span className="font-mono">origem</span> etc.
            Eles aparecem nos formulários de criação e nas páginas de detalhe das entidades.
          </p>
        </div>
      </div>

      {ENTITIES.map((ent) => (
        <EntitySection key={ent.id} entity={ent.id} label={ent.label} description={ent.description} Icon={ent.icon} workspaceId={workspaceId} />
      ))}
    </div>
  );
}

function EntitySection({
  entity, label, description, Icon, workspaceId,
}: {
  entity: CustomFieldEntity;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  workspaceId: string;
}) {
  const qc = useQueryClient();
  const fieldsQ = useQuery({
    queryKey: ["custom-fields", workspaceId, entity],
    queryFn: () => customFieldsApi.list(workspaceId, entity).then((r) => r.data.items ?? []),
  });
  const [creating, setCreating] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (id: string) => customFieldsApi.delete(workspaceId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields", workspaceId, entity] });
      toast.success("Campo removido");
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao remover";
      toast.error(msg);
    },
  });

  const fields = fieldsQ.data ?? [];

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,212,106,0.10)", border: "1px solid rgba(0,212,106,0.20)" }}
          >
            <Icon className="w-4 h-4" style={{ color: "var(--green)" }} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
              {label} <span style={{ color: "var(--text-3)" }}>· {fields.length}</span>
            </h3>
            <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
          style={
            creating
              ? { background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-2)" }
              : { background: "var(--green-dim)", border: "1px solid var(--green-border)", color: "var(--green)" }
          }
        >
          {creating ? <><X className="w-3.5 h-3.5" /> Cancelar</> : <><Plus className="w-3.5 h-3.5" /> Novo campo</>}
        </button>
      </div>

      {creating && (
        <FieldForm
          entity={entity}
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
        />
      )}

      {fields.length === 0 && !creating ? (
        <p className="text-xs py-3 text-center" style={{ color: "var(--text-3)" }}>
          Nenhum campo personalizado ainda.
        </p>
      ) : (
        <div className="space-y-1.5">
          {fields
            .slice()
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
            .map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--input)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{f.name}</p>
                  <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                    <span className="font-mono">{f.key}</span> · {TYPE_LABELS[f.type]}
                    {f.required && " · obrigatório"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (await showConfirm(`Remover o campo "${f.name}"? Os valores existentes ficam órfãos e somem da UI.`, { title: "Remover campo", confirmLabel: "Remover" })) {
                      deleteMut.mutate(f.id);
                    }
                  }}
                  className="p-1.5 rounded-lg hover:bg-white/5"
                  style={{ color: "var(--text-3)" }}
                  aria-label={`Remover ${f.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function FieldForm({
  entity, workspaceId, onClose,
}: {
  entity: CustomFieldEntity;
  workspaceId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [required, setRequired] = useState(false);
  const [optionsRaw, setOptionsRaw] = useState("");

  const needsOptions = type === "select" || type === "multi";

  const options = useMemo(
    () => optionsRaw.split("\n").map((s) => s.trim()).filter(Boolean),
    [optionsRaw],
  );

  const createMut = useMutation({
    mutationFn: () =>
      customFieldsApi.create(workspaceId, {
        entity_type: entity,
        name: name.trim(),
        type,
        options: needsOptions ? options : undefined,
        required,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields", workspaceId, entity] });
      toast.success("Campo criado");
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar campo";
      toast.error(msg);
    },
  });

  const valid = name.trim().length > 0 && (!needsOptions || options.length > 0);

  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{ background: "var(--input)", border: "1px solid var(--border-default)" }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do campo (ex: LinkedIn, Score, Origem)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            color: "var(--text-1)",
          }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CustomFieldType)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            color: "var(--text-1)",
          }}
        >
          {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {needsOptions && (
        <div>
          <label className="text-[11px]" style={{ color: "var(--text-3)" }}>
            Opções (uma por linha)
          </label>
          <textarea
            value={optionsRaw}
            onChange={(e) => setOptionsRaw(e.target.value)}
            rows={3}
            placeholder={"Lead\nMQL\nSQL"}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-1)",
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-2)" }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Obrigatório
        </label>
        <button
          type="button"
          disabled={!valid || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ background: "var(--green)", color: "#03170a" }}
        >
          <Save className="w-3.5 h-3.5" /> Salvar campo
        </button>
      </div>
    </div>
  );
}
