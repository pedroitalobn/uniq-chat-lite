"use client";

// QuickSetupWizard — substitui o "encarar 5 abas em branco" por um quiz
// guiado de 7 perguntas curtas. No fim, chama o backend que usa a LLM
// ativa pra gerar identity/objective/communication_guidelines/service_
// instructions/restrictions já redigidos. User revisa nas abas avançadas
// se quiser, mas pode salvar direto.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";

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

const TONES = [
  { value: "formal e profissional", label: "Formal" },
  { value: "casual e próximo", label: "Casual" },
  { value: "técnico e direto", label: "Técnico" },
  { value: "caloroso e empático", label: "Empático" },
];

const ROLES = [
  { value: "atendimento ao cliente", label: "Atendimento" },
  { value: "vendas e qualificação", label: "Vendas / Qualificação" },
  { value: "suporte técnico", label: "Suporte técnico" },
  { value: "agendamento e reservas", label: "Agendamento" },
  { value: "fechamento de negócios", label: "Fechamento" },
  { value: "pós-venda e relacionamento", label: "Pós-venda" },
];

export function QuickSetupWizard({
  instanceId,
  agentId,
  initialName,
  onClose,
  onApply,
}: {
  instanceId: string;
  agentId?: string;
  initialName?: string;
  onClose: () => void;
  onApply: (sections: {
    agent_name: string;
    identity: string;
    objective: string;
    communication_guidelines: string;
    service_instructions: string;
    restrictions: string;
  }) => void;
}) {
  const [step, setStep] = useState(0);
  const [q, setQ] = useState<QuizState>({
    agent_name: initialName || "",
    business_name: "",
    business_segment: "",
    business_usp: "",
    role: ROLES[0].value,
    tone: TONES[1].value,
    objective: "",
    restrictions: "",
    escalation: "",
  });

  const generateMut = useMutation({
    mutationFn: () => integrationsApi.generateAgentFromQuiz(instanceId, {
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
    }, agentId),
    onSuccess: (r: any) => {
      toast.success("Agente gerado — revise e salve");
      onApply(r.data);
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao gerar"),
  });

  const steps = [
    {
      title: "Como o agente deve se chamar?",
      hint: "Pode ser um nome de pessoa (ex: Bia) ou descritivo (ex: Atendente Virtual).",
      field: (
        <input
          autoFocus
          value={q.agent_name}
          onChange={(e) => setQ({ ...q, agent_name: e.target.value })}
          placeholder="Ex: Bia, Carlos, Atendente Virtual…"
          className="input-field w-full"
        />
      ),
      canNext: q.agent_name.trim().length > 0,
    },
    {
      title: "Sobre seu negócio",
      hint: "Nome, segmento e o diferencial em uma frase. O agente vai mencionar isso de forma natural.",
      field: (
        <div className="space-y-2">
          <input
            autoFocus
            value={q.business_name}
            onChange={(e) => setQ({ ...q, business_name: e.target.value })}
            placeholder="Nome da empresa"
            className="input-field w-full"
          />
          <input
            value={q.business_segment}
            onChange={(e) => setQ({ ...q, business_segment: e.target.value })}
            placeholder="Segmento (ex: clínica odontológica, e-commerce de moda…)"
            className="input-field w-full"
          />
          <input
            value={q.business_usp}
            onChange={(e) => setQ({ ...q, business_usp: e.target.value })}
            placeholder="Diferencial em 1 frase (USP)"
            className="input-field w-full"
          />
        </div>
      ),
      canNext: q.business_name.trim().length > 0,
    },
    {
      title: "Qual a função principal do agente?",
      hint: "Define como o LLM vai posicionar a conversa.",
      field: (
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setQ({ ...q, role: r.value })}
              className="text-left rounded-xl px-3 py-2 text-sm transition"
              style={{
                background: q.role === r.value ? "rgba(0,212,106,0.08)" : "var(--surface-2)",
                border: `1px solid ${q.role === r.value ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
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
              className="text-left rounded-xl px-3 py-2 text-sm transition"
              style={{
                background: q.tone === t.value ? "rgba(99,102,241,0.1)" : "var(--surface-2)",
                border: `1px solid ${q.tone === t.value ? "rgba(99,102,241,0.3)" : "var(--surface-border)"}`,
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
      title: "Qual o objetivo de cada conversa?",
      hint: "Em 1 frase: o que o cliente deveria sair fazendo após falar com o agente.",
      field: (
        <textarea
          autoFocus
          value={q.objective}
          onChange={(e) => setQ({ ...q, objective: e.target.value })}
          placeholder="Ex: agendar uma consulta de avaliação ou conectar com um humano da equipe."
          rows={3}
          className="input-field w-full resize-none"
        />
      ),
      canNext: q.objective.trim().length > 0,
    },
    {
      title: "O que o agente NÃO pode fazer?",
      hint: "Lista de restrições, separadas por vírgula. Pode deixar vazio.",
      field: (
        <textarea
          value={q.restrictions}
          onChange={(e) => setQ({ ...q, restrictions: e.target.value })}
          placeholder="Ex: nunca prometer prazo de entrega, não falar de concorrentes, não dar diagnóstico médico."
          rows={3}
          className="input-field w-full resize-none"
        />
      ),
      canNext: true,
    },
    {
      title: "Quando passar pra humano?",
      hint: "Situações em que o agente deve transferir a conversa.",
      field: (
        <textarea
          autoFocus
          value={q.escalation}
          onChange={(e) => setQ({ ...q, escalation: e.target.value })}
          placeholder="Ex: reclamações sérias, pedidos de cancelamento, quando o cliente pede explicitamente."
          rows={3}
          className="input-field w-full resize-none"
        />
      ),
      canNext: q.escalation.trim().length > 0,
    },
  ];

  const cur = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl p-5 space-y-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "#a5b4fc" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Setup rápido — {step + 1}/{steps.length}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition"
              style={{ background: i <= step ? "var(--green)" : "var(--surface-3)" }}
            />
          ))}
        </div>

        <div className="space-y-2">
          <h4 className="text-base font-medium" style={{ color: "var(--text-1)" }}>{cur.title}</h4>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>{cur.hint}</p>
        </div>

        <div className="pt-1">{cur.field}</div>

        <div className="flex items-center justify-between pt-2">
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
              Gerar agente
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

        <p className="text-[10px] text-center" style={{ color: "var(--text-3)" }}>
          Vai usar a LLM ativa da sua conta. Você pode revisar tudo nas abas antes de salvar.
        </p>
      </div>
    </div>
  );
}
