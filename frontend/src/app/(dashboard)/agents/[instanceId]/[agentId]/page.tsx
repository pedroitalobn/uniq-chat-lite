"use client";

import { Loader2, AlertTriangle, Construction } from "lucide-react";
import { useAgentFormContext } from "../../_shared/AgentFormContext";
import { PersonalityCard } from "./_components/PersonalityCard";
import { VoiceCard } from "./_components/VoiceCard";
import { KnowledgeCard } from "./_components/KnowledgeCard";

// Studio — página principal de configuração do agente. Cards
// colapsáveis: Personalidade, Voz, Conhecimento.
//
// Fase 3 vai trazer: card de Habilidades + status lateral.
// Fase 5 vai trazer: split-view com preview de chat ao vivo.
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
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto space-y-3">
      {/* Cards do Studio */}
      <PersonalityCard form={form} update={updateForm} />
      <VoiceCard form={form} update={updateForm} />
      <KnowledgeCard form={form} update={updateForm} instanceId={instanceId} />

      {/* Placeholder das próximas fases */}
      <div
        className="rounded-2xl p-4 flex items-center gap-3"
        style={{
          background: "var(--surface-2)",
          border: "1px dashed var(--surface-border)",
        }}
      >
        <Construction className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Habilidades, status lateral e preview de chat ao vivo chegam nas próximas fases (3 e 5).
        </p>
      </div>
    </div>
  );
}
