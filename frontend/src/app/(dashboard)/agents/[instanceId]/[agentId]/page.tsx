"use client";

import { Loader2, AlertTriangle } from "lucide-react";
import { useAgentFormContext } from "../../_shared/AgentFormContext";
import { PersonalityCard } from "./_components/PersonalityCard";
import { VoiceCard } from "./_components/VoiceCard";
import { KnowledgeCard } from "./_components/KnowledgeCard";
import { SkillsCard } from "./_components/SkillsCard";
import { StatusCard } from "./_components/StatusCard";

// Studio — página principal de configuração do agente.
// Layout: cards à esquerda (scroll vertical), status card sticky
// à direita em telas grandes; em mobile o status some até a Fase 5
// (vai virar bottom sheet com preview de chat ao vivo).
export default function AgentStudioPage() {
  const { form, updateForm, isLoading, error, instanceId } = useAgentFormContext();

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
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="space-y-3 min-w-0">
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
    </div>
  );
}
