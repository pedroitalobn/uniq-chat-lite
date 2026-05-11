"use client";

// CustomFieldsRenderer — renderiza dinamicamente um conjunto de campos
// personalizados a partir de definições + valores atuais. Usado nos
// formulários de Deal/Contact/Company pra preencher atributos extras
// definidos via /crm/properties.
//
// Suporta os 8 tipos: text, textarea, number, date, url, select, multi,
// boolean. Não faz fetch — recebe defs e value como props pra ser
// agnostico ao caller (alguns formulários carregam defs de outras
// queries pra dedup).

import type { CustomFieldDef } from "@/lib/api";

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

export type CustomFieldsValue = Record<string, unknown>;

export function CustomFieldsRenderer({
  defs,
  value,
  onChange,
  compact,
}: {
  defs: CustomFieldDef[];
  value: CustomFieldsValue;
  onChange: (next: CustomFieldsValue) => void;
  compact?: boolean;
}) {
  if (!defs || defs.length === 0) return null;

  const update = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {defs
        .slice()
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((d) => (
          <Field key={d.id} def={d} value={value[d.key]} onChange={(v) => update(d.key, v)} />
        ))}
    </div>
  );
}

function Field({ def, value, onChange }: { def: CustomFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = (
    <span className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>
      {def.name}{def.required && " *"}
    </span>
  );

  if (def.type === "boolean") {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm" style={{ color: "var(--text-2)" }}>{def.name}</span>
      </label>
    );
  }

  if (def.type === "textarea") {
    return (
      <div>
        {label}
        <textarea
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "none" }}
        />
      </div>
    );
  }

  if (def.type === "number") {
    return (
      <div>
        {label}
        <input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          style={inputStyle}
        />
      </div>
    );
  }

  if (def.type === "date") {
    return (
      <div>
        {label}
        <input
          type="date"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          style={inputStyle}
        />
      </div>
    );
  }

  if (def.type === "url") {
    return (
      <div>
        {label}
        <input
          type="url"
          placeholder="https://…"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      </div>
    );
  }

  if (def.type === "select") {
    const opts = parseOptions(def.options);
    return (
      <div>
        {label}
        <select
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          style={inputStyle}
        >
          <option value="">— escolha —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (def.type === "multi") {
    const opts = parseOptions(def.options);
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (o: string) => {
      const next = selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o];
      onChange(next);
    };
    return (
      <div>
        {label}
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                type="button"
                key={o}
                onClick={() => toggle(o)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: on ? "var(--green-dim)" : "var(--input)",
                  color: on ? "var(--green)" : "var(--text-2)",
                  border: `1px solid ${on ? "var(--green-border)" : "var(--border-default)"}`,
                }}
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // default: text
  return (
    <div>
      {label}
      <input
        type="text"
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function parseOptions(raw?: string): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
