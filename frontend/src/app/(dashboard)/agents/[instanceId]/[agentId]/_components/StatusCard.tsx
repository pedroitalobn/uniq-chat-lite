"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Sparkles, Mic2, Brain, Wand2, Cpu, Power } from "lucide-react";
import { voicesApi, integrationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { computeReadiness, type AgentForm } from "../../../_shared/types";
import { ALL_ACTIONS } from "../../../_shared/actionsCatalog";

// Status card lateral — sempre visível enquanto o user edita o agente.
// Mostra readiness + resumo do que tá configurado (voz, KB, ações,
// modelo, ativação). É o "espelho" do que o agente vai fazer em prod.
export function StatusCard({ form }: { form: AgentForm }) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const voicesQuery = useQuery({
    queryKey: ["voices", wsId],
    queryFn: () =>
      voicesApi
        .listVoices(wsId)
        .then((r) => r.data as Array<{ id: string; name: string }>),
    enabled: !!wsId,
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await integrationsApi.list()).data || [],
  });

  const readiness = computeReadiness(form);
  const readyCount = Object.values(readiness).filter(Boolean).length;
  const readyTotal = Object.keys(readiness).length;

  const voiceName =
    voicesQuery.data?.find((v) => v.id === form.voice.workspace_voice_id)?.name || null;
  const knowledgeAssets = form.assets.filter((a) => a.category === "knowledge").length;
  const enabledActions = form.app_access.filter(
    (a) => a.type === "action" && a.enabled && ALL_ACTIONS.some((x) => x.id === a.name),
  ).length;
  const integrationName = form.integration_id
    ? (integrationsQuery.data?.find((i: any) => i.id === form.integration_id)?.name || "Custom")
    : "Uniq AI";
  const modelLabel = form.integration_id
    ? form.model || "(sem modelo)"
    : "auto-resolvido";

  return (
    <aside
      className="rounded-2xl p-4 space-y-3 lg:sticky lg:top-3"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--surface-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" style={{ color: "var(--green)" }} />
        <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
          Status
        </h4>
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-mono"
          style={{
            background: form.is_active ? "rgba(0,212,106,0.10)" : "var(--surface-2)",
            color: form.is_active ? "var(--green)" : "var(--text-4)",
            border: `1px solid ${form.is_active ? "rgba(0,212,106,0.20)" : "var(--surface-border)"}`,
          }}
        >
          {form.is_active ? "ativo" : "inativo"}
        </span>
      </div>

      {/* Readiness */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
            Pronto pra ativar
          </span>
          <span
            className="text-[11px] font-mono tabular-nums"
            style={{ color: readyCount === readyTotal ? "var(--green)" : "var(--text-3)" }}
          >
            {readyCount}/{readyTotal}
          </span>
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--input)" }}>
          <div
            className="h-full transition-[width] duration-700"
            style={{
              width: `${(readyCount / readyTotal) * 100}%`,
              background: readyCount === readyTotal ? "var(--green)" : "#fbbf24",
            }}
          />
        </div>
        <div className="mt-2 space-y-1 text-[11px]">
          <ReadyRow ok={readiness.hasIdentity} label="Identidade" />
          <ReadyRow ok={readiness.hasInstructions} label="Instruções" />
          <ReadyRow ok={readiness.hasLLM} label="LLM" />
          <ReadyRow ok={readiness.hasModel} label="Modelo" />
        </div>
      </div>

      <div className="border-t" style={{ borderColor: "var(--surface-border)" }} />

      {/* Resumo */}
      <div className="space-y-1.5 text-[11px]">
        <SummaryRow
          icon={Cpu}
          color="#a5b4fc"
          label="Inteligência"
          value={`${integrationName} · ${modelLabel}`}
        />
        <SummaryRow
          icon={Mic2}
          color="#f59e0b"
          label="Voz"
          value={
            form.voice.audio_enabled
              ? voiceName || "ligado (sem voz selecionada)"
              : "desligado"
          }
          dim={!form.voice.audio_enabled}
        />
        <SummaryRow
          icon={Brain}
          color="#60a5fa"
          label="Conhecimento"
          value={`${form.faq.length} FAQ · ${knowledgeAssets} doc · ${form.knowledge_base.length > 0 ? "texto" : "sem texto"}`}
          dim={form.faq.length === 0 && knowledgeAssets === 0 && !form.knowledge_base}
        />
        <SummaryRow
          icon={Wand2}
          color="#00d46a"
          label="Habilidades"
          value={`${enabledActions}/${ALL_ACTIONS.length} ativas`}
          dim={enabledActions === 0}
        />
        <SummaryRow
          icon={Power}
          color={form.activation_mode === "always" ? "var(--green)" : "#fbbf24"}
          label="Quando responde"
          value={ACTIVATION_LABELS[form.activation_mode] || form.activation_mode}
        />
      </div>
    </aside>
  );
}

function ReadyRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? (
        <CheckCircle2 className="w-3 h-3" style={{ color: "var(--green)" }} />
      ) : (
        <Circle className="w-3 h-3" style={{ color: "var(--text-4)" }} />
      )}
      <span style={{ color: ok ? "var(--text-2)" : "var(--text-4)" }}>{label}</span>
    </div>
  );
}

function SummaryRow({
  icon: Icon,
  color,
  label,
  value,
  dim,
}: {
  icon: typeof Sparkles;
  color: string;
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: dim ? "var(--text-4)" : color }} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-4)" }}>
          {label}
        </p>
        <p
          className="font-medium truncate"
          style={{ color: dim ? "var(--text-3)" : "var(--text-1)" }}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

const ACTIVATION_LABELS: Record<string, string> = {
  always: "Sempre",
  business_hours: "Horário comercial",
  off_hours: "Fora do horário",
  new_contact_only: "1º contato",
  custom: "Customizado",
};
