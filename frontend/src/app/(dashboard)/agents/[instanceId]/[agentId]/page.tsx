"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, Sparkles, Wand2 } from "lucide-react";
import { useAgentFormContext } from "../../_shared/AgentFormContext";
import { PersonalityCard } from "./_components/PersonalityCard";
import { VoiceCard } from "./_components/VoiceCard";
import { KnowledgeCard } from "./_components/KnowledgeCard";
import { SkillsCard } from "./_components/SkillsCard";
import { StatusCard } from "./_components/StatusCard";
import { MobileStatusBar } from "./_components/MobileStatusBar";
import { AIWizardModal } from "./_components/AIWizardModal";

// Studio — página principal de configuração do agente.
// Layout: cards à esquerda (scroll vertical), status card sticky
// à direita em telas grandes; em mobile o status some até a Fase 5
// (vai virar bottom sheet com preview de chat ao vivo).
export default function AgentStudioPage() {
  const { form, updateForm, isLoading, error, instanceId, agentId } = useAgentFormContext();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Heurística "agente vazio" — abre banner sugerindo Setup com IA. Se
  // já tem identidade ou objetivo preenchidos, banner some (mas o
  // botão Wand2 fica disponível pra rodar de novo no card de Personalidade).
  const isEmpty = !form.identity.trim() && !form.objective.trim() && !form.service_instructions.trim();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
        <div
          className="rounded-2xl p-6 flex items-start gap-4"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "#ef4444" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Não foi possível carregar o agente
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
              {(error as any)?.response?.data?.error ||
                (error as any)?.message ||
                "Erro desconhecido."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="space-y-3 min-w-0">
          <MobileStatusBar form={form} />

          {/* Banner Setup com IA — só pra agentes vazios. Após
             aplicar/preencher, some sozinho. Botão pra rodar de novo
             fica embutido no card Personalidade (Wand2). */}
          {isEmpty && (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(99,102,241,0.06))",
                border: "1px solid rgba(124,58,237,0.30)",
              }}
            >
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, rgba(124,58,237,0.30), rgba(99,102,241,0.20))",
                  border: "1px solid rgba(124,58,237,0.40)",
                  color: "#a5b4fc",
                }}
              >
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                  Setup com IA
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
                  7 perguntas curtas e a IA gera personalidade, objetivo, instruções e restrições.
                  Você revisa antes de aplicar.
                </p>
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md flex-shrink-0"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}
              >
                Começar
              </span>
            </button>
          )}

          {/* Botão sutil pra reabrir o wizard quando agente já tem
             conteúdo — fica entre o status e os cards. */}
          {!isEmpty && (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-colors"
              style={{
                background: "var(--surface-1)",
                border: "1px dashed var(--surface-border)",
              }}
            >
              <Wand2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#a5b4fc" }} />
              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                Regenerar com IA — você escolhe quais seções aplicar
              </span>
              <span className="ml-auto text-[10px]" style={{ color: "var(--text-4)" }}>
                Setup com IA →
              </span>
            </button>
          )}

          <PersonalityCard form={form} update={updateForm} />
          <VoiceCard form={form} update={updateForm} />
          <KnowledgeCard form={form} update={updateForm} instanceId={instanceId} />
          <SkillsCard form={form} update={updateForm} />
        </div>

        {/* Status card lateral — em mobile aparece em cima dos cards
            também, mas com layout simplificado. Em lg fica sticky. */}
        <div className="hidden lg:block">
          <StatusCard form={form} />
        </div>
      </div>

      {wizardOpen && (
        <AIWizardModal
          instanceId={instanceId}
          agentId={agentId}
          currentForm={form}
          onApply={(sections) => {
            // Aplica só os campos selecionados ao form local — Save
            // continua sendo manual (header) pra dar oportunidade de
            // testar no preview antes de persistir.
            updateForm((p) => ({
              ...p,
              ...(sections.agent_name !== undefined ? { agent_name: sections.agent_name } : {}),
              ...(sections.identity !== undefined ? { identity: sections.identity } : {}),
              ...(sections.objective !== undefined ? { objective: sections.objective } : {}),
              ...(sections.communication_guidelines !== undefined
                ? { communication_guidelines: sections.communication_guidelines }
                : {}),
              ...(sections.service_instructions !== undefined
                ? { service_instructions: sections.service_instructions }
                : {}),
              ...(sections.restrictions !== undefined ? { restrictions: sections.restrictions } : {}),
            }));
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
