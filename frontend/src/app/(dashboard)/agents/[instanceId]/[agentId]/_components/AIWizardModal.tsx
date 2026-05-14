"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  X,
  ArrowLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
  Check,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";
import type { AgentForm } from "../../../_shared/types";

const ROLES = [
  { value: "atendimento ao cliente", label: "Atendimento" },
  { value: "vendas", label: "Vendas" },
  { value: "suporte técnico", label: "Suporte" },
  { value: "agendamento", label: "Agendamento" },
  { value: "fechamento", label: "Fechamento" },
  { value: "pós-venda e relacionamento", label: "Pós-venda" },
];

const TONES = [
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
  { value: "técnico", label: "Técnico" },
  { value: "empático", label: "Empático" },
];

type QuizState = {
  agent_name: string;
  business_name: string;
  business_segment: string;
  business_usp: string;
  role: string;
  tone: string;
  objective: string;
  restrictions: string;
  escalation: string;
};

type GeneratedSections = {
  agent_name?: string;
  identity?: string;
  objective?: string;
  communication_guidelines?: string;
  service_instructions?: string;
  restrictions?: string;
};

type SectionKey = keyof GeneratedSections;

const SECTION_ORDER: Array<{ key: SectionKey; label: string; description: string }> = [
  { key: "agent_name",               label: "Nome",       description: "Como o agente se identifica" },
  { key: "identity",                 label: "Identidade", description: "Quem é o agente, contexto da empresa" },
  { key: "objective",                label: "Objetivo",   description: "O que cada conversa deve alcançar" },
  { key: "communication_guidelines", label: "Diretrizes", description: "Tom, formalidade, ritmo" },
  { key: "service_instructions",     label: "Instruções", description: "Passo a passo do atendimento" },
  { key: "restrictions",             label: "Restrições", description: "O que o agente NÃO pode fazer" },
];

// Wizard de Setup com IA — 7 perguntas → LLM gera 6 seções de
// personalidade. Diferente do QuickSetupWizard antigo, este NÃO
// aplica direto: mostra um diff (atual vs gerado) com toggles por
// seção e botão "Regenerar" pra rodar de novo sem perder o estado
// das respostas. Usuário escolhe o que aplicar.
export function AIWizardModal({
  instanceId,
  agentId,
  currentForm,
  onApply,
  onClose,
}: {
  instanceId: string;
  agentId: string;
  currentForm: AgentForm;
  onApply: (sections: GeneratedSections) => void;
  onClose: () => void;
}) {
  // Phase: "quiz" → 7 perguntas · "diff" → revisar e aplicar
  const [phase, setPhase] = useState<"quiz" | "diff">("quiz");
  const [step, setStep] = useState(0);
  const [q, setQ] = useState<QuizState>({
    agent_name: currentForm.agent_name || "",
    business_name: "",
    business_segment: "",
    business_usp: "",
    role: ROLES[0].value,
    tone: TONES[1].value,
    objective: currentForm.objective || "",
    restrictions: "",
    escalation: "",
  });
  const [generated, setGenerated] = useState<GeneratedSections | null>(null);
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
    agent_name: true,
    identity: true,
    objective: true,
    communication_guidelines: true,
    service_instructions: true,
    restrictions: true,
  });

  const realAgentId = agentId === "primary" ? undefined : agentId;

  const generateMut = useMutation({
    mutationFn: () =>
      integrationsApi.generateAgentFromQuiz(
        instanceId,
        {
          agent_name: q.agent_name,
          business_name: q.business_name,
          business_segment: q.business_segment,
          business_usp: q.business_usp,
          role: q.role,
          tone: q.tone,
          objective: q.objective,
          restrictions: q.restrictions
            .split(/[,\n;]/)
            .map((s) => s.trim())
            .filter(Boolean),
          escalation: q.escalation,
        },
        realAgentId,
      ),
    onSuccess: (r: any) => {
      setGenerated(r.data);
      // Default: aplicar todos os campos onde a IA gerou algo. Pra
      // cada seção, pré-marca como "aplicar" se gerou conteúdo novo;
      // mantém marcado independente de sobrescrever ou não — o user
      // decide vendo o diff.
      const next: Record<SectionKey, boolean> = { ...selected };
      for (const s of SECTION_ORDER) {
        next[s.key] = !!r.data?.[s.key];
      }
      setSelected(next);
      setPhase("diff");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Não foi possível gerar."),
  });

  const apply = () => {
    if (!generated) return;
    const out: GeneratedSections = {};
    for (const s of SECTION_ORDER) {
      if (selected[s.key] && generated[s.key]) {
        out[s.key] = generated[s.key];
      }
    }
    onApply(out);
    toast.success("Aplicado. Revise e salve quando quiser.");
    onClose();
  };

  // ─── Quiz steps ─────────────────────────────────────────────────────
  const steps = [
    {
      title: "Como o agente deve se chamar?",
      hint: "Pode ser um nome de pessoa (ex: Bia) ou descritivo.",
      field: (
        <input
          autoFocus
          value={q.agent_name}
          onChange={(e) => setQ({ ...q, agent_name: e.target.value })}
          placeholder="Ex: Bia, Carlos, Atendente Virtual…"
          style={inputStyle}
        />
      ),
      canNext: q.agent_name.trim().length > 0,
    },
    {
      title: "Sobre seu negócio",
      hint: "Nome, segmento e diferencial em 1 frase.",
      field: (
        <div className="space-y-2">
          <input
            autoFocus
            value={q.business_name}
            onChange={(e) => setQ({ ...q, business_name: e.target.value })}
            placeholder="Nome da empresa"
            style={inputStyle}
          />
          <input
            value={q.business_segment}
            onChange={(e) => setQ({ ...q, business_segment: e.target.value })}
            placeholder="Segmento (ex: clínica, e-commerce de moda…)"
            style={inputStyle}
          />
          <input
            value={q.business_usp}
            onChange={(e) => setQ({ ...q, business_usp: e.target.value })}
            placeholder="Diferencial em 1 frase (USP)"
            style={inputStyle}
          />
        </div>
      ),
      canNext: q.business_name.trim().length > 0,
    },
    {
      title: "Função principal do agente",
      hint: "Define como o LLM posiciona a conversa.",
      field: (
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setQ({ ...q, role: r.value })}
              className="text-left rounded-lg px-3 py-2 text-sm transition"
              style={{
                background: q.role === r.value ? "rgba(37, 99, 235,0.10)" : "var(--surface-2)",
                border: `1px solid ${q.role === r.value ? "rgba(37, 99, 235,0.30)" : "var(--surface-border)"}`,
                color: q.role === r.value ? "var(--green)" : "var(--text-1)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      ),
      canNext: true,
    },
    {
      title: "Tom de voz",
      hint: "Como o agente fala com o cliente.",
      field: (
        <div className="grid grid-cols-2 gap-2">
          {TONES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setQ({ ...q, tone: t.value })}
              className="text-left rounded-lg px-3 py-2 text-sm transition"
              style={{
                background: q.tone === t.value ? "rgba(99,102,241,0.10)" : "var(--surface-2)",
                border: `1px solid ${q.tone === t.value ? "rgba(99,102,241,0.30)" : "var(--surface-border)"}`,
                color: q.tone === t.value ? "#a5b4fc" : "var(--text-1)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      ),
      canNext: true,
    },
    {
      title: "Objetivo de cada conversa",
      hint: "Em 1 frase: o que o cliente sai fazendo após falar com o agente.",
      field: (
        <textarea
          autoFocus
          value={q.objective}
          onChange={(e) => setQ({ ...q, objective: e.target.value })}
          placeholder="Ex: agendar uma consulta de avaliação ou conectar com um humano."
          rows={3}
          style={{ ...inputStyle, resize: "none" }}
        />
      ),
      canNext: q.objective.trim().length > 0,
    },
    {
      title: "O que o agente NÃO pode fazer?",
      hint: "Restrições separadas por vírgula (opcional).",
      field: (
        <textarea
          value={q.restrictions}
          onChange={(e) => setQ({ ...q, restrictions: e.target.value })}
          placeholder="Ex: não prometer prazos, não falar de concorrentes."
          rows={3}
          style={{ ...inputStyle, resize: "none" }}
        />
      ),
      canNext: true,
    },
    {
      title: "Quando passar pra humano?",
      hint: "Situações em que o agente deve transferir.",
      field: (
        <textarea
          autoFocus
          value={q.escalation}
          onChange={(e) => setQ({ ...q, escalation: e.target.value })}
          placeholder="Ex: reclamações sérias, cancelamentos, quando o cliente pede."
          rows={3}
          style={{ ...inputStyle, resize: "none" }}
        />
      ),
      canNext: q.escalation.trim().length > 0,
    },
  ];

  const cur = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <Sparkles className="w-4 h-4" style={{ color: "#a5b4fc" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            Setup com IA
          </h2>
          {phase === "quiz" && (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
            >
              passo {step + 1}/{steps.length}
            </span>
          )}
          {phase === "diff" && (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(37, 99, 235,0.10)", color: "var(--green)" }}
            >
              revisar
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {phase === "quiz" && (
          <>
            {/* Progress bar */}
            <div className="px-5 pt-3 flex-shrink-0">
              <div className="flex gap-1">
                {steps.map((_, i) => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-full transition"
                    style={{ background: i <= step ? "var(--green)" : "var(--surface-3)" }}
                  />
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
              <div>
                <h4 className="text-base font-medium" style={{ color: "var(--text-1)" }}>
                  {cur.title}
                </h4>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                  {cur.hint}
                </p>
              </div>
              <div>{cur.field}</div>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderTop: "1px solid var(--surface-border)" }}
            >
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-30"
                style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
              >
                <ArrowLeft className="w-3 h-3" />
                Voltar
              </button>
              {isLast ? (
                <button
                  type="button"
                  onClick={() => generateMut.mutate()}
                  disabled={!cur.canNext || generateMut.isPending}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--green)", color: "var(--green-fg)" }}
                >
                  {generateMut.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Gerar com IA
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                  disabled={!cur.canNext}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
                  style={{ background: "var(--green)", color: "var(--green-fg)" }}
                >
                  Próximo
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </>
        )}

        {phase === "diff" && generated && (
          <DiffView
            currentForm={currentForm}
            generated={generated}
            selected={selected}
            onToggle={(key) => setSelected((s) => ({ ...s, [key]: !s[key] }))}
            onRegenerate={() => {
              setStep(steps.length - 1); // volta no último step pra ajustar
              setPhase("quiz");
            }}
            onApply={apply}
            isRegenerating={generateMut.isPending}
          />
        )}
      </div>
    </div>
  );
}

// ─── Diff view (phase 2) ─────────────────────────────────────────────────

function DiffView({
  currentForm,
  generated,
  selected,
  onToggle,
  onRegenerate,
  onApply,
  isRegenerating,
}: {
  currentForm: AgentForm;
  generated: GeneratedSections;
  selected: Record<SectionKey, boolean>;
  onToggle: (key: SectionKey) => void;
  onRegenerate: () => void;
  onApply: () => void;
  isRegenerating: boolean;
}) {
  const sectionsWithDiff = SECTION_ORDER.filter((s) => generated[s.key]);
  const selectedCount = sectionsWithDiff.filter((s) => selected[s.key]).length;

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <div
          className="rounded-lg px-3 py-2 flex items-start gap-2"
          style={{
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.20)",
          }}
        >
          <Pencil className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "#a5b4fc" }} />
          <p className="text-[11px]" style={{ color: "var(--text-2)" }}>
            A IA gerou as seções abaixo. Compare com o atual e escolha o que aplicar — você pode
            regenerar quantas vezes quiser sem perder as respostas.
          </p>
        </div>

        {sectionsWithDiff.length === 0 && (
          <p className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>
            A IA não retornou conteúdo. Clique em Regenerar pra tentar novamente.
          </p>
        )}

        {sectionsWithDiff.map((s) => {
          const currentValue = (currentForm[s.key as keyof AgentForm] as string) || "";
          const generatedValue = generated[s.key] || "";
          const isSelected = selected[s.key];
          const willOverwrite = !!currentValue.trim();

          return (
            <div
              key={s.key}
              className="rounded-xl overflow-hidden"
              style={{
                background: "var(--surface-1)",
                border: `1px solid ${isSelected ? "rgba(37, 99, 235,0.30)" : "var(--surface-border)"}`,
              }}
            >
              {/* Header da seção */}
              <button
                type="button"
                onClick={() => onToggle(s.key)}
                className="w-full flex items-center gap-2 px-3 py-2 transition-colors"
                style={{
                  background: isSelected ? "rgba(37, 99, 235,0.04)" : "transparent",
                }}
              >
                <span
                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isSelected ? "var(--green)" : "var(--surface-3)",
                    border: `1px solid ${isSelected ? "rgba(37, 99, 235,0.40)" : "var(--surface-border)"}`,
                  }}
                >
                  {isSelected && <Check className="w-2.5 h-2.5" style={{ color: "var(--green-fg)" }} />}
                </span>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                    {s.label}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-4)" }}>
                    {s.description}
                  </p>
                </div>
                {willOverwrite && isSelected && (
                  <span
                    className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{
                      background: "rgba(245,158,11,0.10)",
                      color: "#f59e0b",
                      border: "1px solid rgba(245,158,11,0.20)",
                    }}
                  >
                    sobrescreve
                  </span>
                )}
              </button>

              {/* Diff: atual | gerado */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2"
                style={{ borderTop: "1px solid var(--surface-border)" }}
              >
                <DiffPane label="Atual" value={currentValue} dim />
                <DiffPane
                  label="Gerado"
                  value={generatedValue}
                  highlight={isSelected}
                  noBorderLeft={false}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="flex items-center gap-2 flex-wrap px-5 py-3 flex-shrink-0"
        style={{ borderTop: "1px solid var(--surface-border)", background: "var(--surface-2)" }}
      >
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
          style={{
            background: "var(--surface-3)",
            border: "1px solid var(--surface-border)",
            color: "var(--text-2)",
          }}
        >
          {isRegenerating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Regenerar
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={selectedCount === 0}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 ml-auto"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}
        >
          <Check className="w-3 h-3" />
          Aplicar {selectedCount > 0 ? `(${selectedCount})` : ""}
        </button>
      </div>
    </>
  );
}

function DiffPane({
  label,
  value,
  dim,
  highlight,
}: {
  label: string;
  value: string;
  dim?: boolean;
  highlight?: boolean;
  noBorderLeft?: boolean;
}) {
  return (
    <div
      className="px-3 py-2 sm:[&:nth-child(2)]:border-l border-t sm:border-t-0"
      style={{
        borderColor: "var(--surface-border)",
        background: highlight ? "rgba(37, 99, 235,0.04)" : "transparent",
      }}
    >
      <p
        className="text-[9px] uppercase tracking-wider mb-1"
        style={{ color: "var(--text-4)" }}
      >
        {label}
      </p>
      <p
        className="text-[11px] whitespace-pre-wrap break-words"
        style={{ color: dim ? "var(--text-4)" : "var(--text-2)" }}
      >
        {value || (
          <span style={{ color: "var(--text-4)", fontStyle: "italic" }}>(vazio)</span>
        )}
      </p>
    </div>
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
