"use client";

import { useQuery } from "@tanstack/react-query";
import { Cpu, Sparkles } from "lucide-react";
import { integrationsApi } from "@/lib/api";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

// Inteligência — escolha do provedor LLM e modelo. Quando vazio, cai
// na Uniq AI (provider default da plataforma) e o modelo é auto-
// resolvido pelo backend. Provider custom exige modelo explícito.
export function IntelligenceCard({ form, update }: Props) {
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await integrationsApi.list()).data || [],
  });

  const integrations = (integrationsQuery.data || []).filter(
    (i: any) => i.type === "ai" || i.kind === "ai" || i.category === "ai" || !i.type,
  );
  const usingUniqAI = !form.integration_id;
  const selected = integrations.find((i: any) => i.id === form.integration_id);

  return (
    <CollapsibleCard
      title="Inteligência"
      icon={Cpu}
      accentColor="#a5b4fc"
      meta={
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(99,102,241,0.10)",
            color: "#a5b4fc",
            border: "1px solid rgba(99,102,241,0.20)",
          }}
        >
          {usingUniqAI ? "Uniq AI" : selected?.name || "Custom"}
        </span>
      }
    >
      <div className="space-y-3 pt-3">
        {/* Uniq AI default */}
        <button
          type="button"
          onClick={() => update((p) => ({ ...p, integration_id: "", model: "" }))}
          className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all"
          style={{
            background: usingUniqAI ? "rgba(0,212,106,0.06)" : "var(--surface-2)",
            border: `1px solid ${usingUniqAI ? "rgba(0,212,106,0.30)" : "var(--surface-border)"}`,
          }}
        >
          <span
            className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
            style={{
              background: usingUniqAI ? "rgba(0,212,106,0.12)" : "var(--input)",
              border: `1px solid ${usingUniqAI ? "rgba(0,212,106,0.25)" : "var(--border-subtle)"}`,
              color: usingUniqAI ? "var(--green)" : "var(--text-3)",
            }}
          >
            <Sparkles className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                Uniq AI
              </span>
              <span
                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(0,212,106,0.10)", color: "var(--green)" }}
              >
                recomendado
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              Modelo gerenciado pela plataforma — sem chave própria, custos no plano.
            </p>
          </div>
        </button>

        {/* Provider custom */}
        <div>
          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-4)" }}>
            ou usar provedor próprio
          </p>
          <select
            value={form.integration_id}
            onChange={(e) => update((p) => ({ ...p, integration_id: e.target.value }))}
            style={selectStyle}
          >
            <option value="">— Sem provedor custom (usa Uniq AI) —</option>
            {integrations.map((i: any) => (
              <option key={i.id} value={i.id}>
                {i.name || i.provider || i.id}
              </option>
            ))}
          </select>
          {!usingUniqAI && (
            <div className="mt-2">
              <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
                Modelo
              </label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => update((p) => ({ ...p, model: e.target.value }))}
                placeholder="Ex: gpt-4o, claude-sonnet-4, gemini-2.0-flash..."
                style={inputStyle}
              />
              <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
                Provider custom exige modelo explícito.
              </p>
            </div>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface-2)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};

const selectStyle: React.CSSProperties = { ...inputStyle };
