"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Sparkles, Construction, ArrowRight } from "lucide-react";

// Studio — página principal de configuração do comportamento do agente.
// Vai concentrar Personalidade, Voz, Conhecimento, Habilidades e o
// preview ao vivo de chat. Por enquanto é placeholder da Fase 1; o
// conteúdo real chega na Fase 2 (cards colapsáveis) e Fase 5 (preview
// ao vivo).
export default function AgentStudioPage() {
  const params = useParams<{ instanceId: string; agentId: string }>();

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4" style={{ color: "#a5b4fc" }} />
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
          Studio
        </h2>
      </div>

      <div
        className="rounded-2xl p-6 flex items-start gap-4"
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(124,58,237,0.04))",
          border: "1px solid rgba(99,102,241,0.20)",
        }}
      >
        <div
          className="p-2.5 rounded-xl flex-shrink-0"
          style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)" }}
        >
          <Construction className="w-5 h-5" style={{ color: "#a5b4fc" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            Studio em construção (Fase 1 · esqueleto)
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Esta tela vai unificar <b>Personalidade</b>, <b>Voz</b>, <b>Conhecimento</b>, <b>Habilidades</b> e
            <b> Multi-agente</b> em cards colapsáveis, com preview de chat ao vivo na lateral. Enquanto a
            migração não termina, use o editor antigo abaixo.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link
              href="/agents"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}
            >
              Editor antigo
              <ArrowRight className="w-3 h-3" />
            </Link>
            <Link
              href={`/agents/${params.instanceId}/${params.agentId}/settings`}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
                color: "var(--text-2)",
              }}
            >
              Ir pra Settings
            </Link>
          </div>
        </div>
      </div>

      {/* Roadmap das fases (transparência pro user beta) */}
      <div className="mt-6">
        <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-4)" }}>
          Roadmap
        </p>
        <ul className="space-y-1.5 text-xs" style={{ color: "var(--text-3)" }}>
          <li>
            <span style={{ color: "var(--green)" }}>✓</span> Fase 1 · roteamento /[instance]/[agent]
          </li>
          <li>· Fase 2 · Studio com cards (personalidade + voz + conhecimento)</li>
          <li>· Fase 3 · modal de habilidades + status card lateral</li>
          <li>· Fase 4 · Settings com seções renomeadas</li>
          <li>· Fase 5 · preview de chat ao vivo</li>
          <li>· Fase 6 · Multi-agente timeline</li>
          <li>· Fase 7 · Setup com IA com diff/regenerar</li>
        </ul>
      </div>
    </div>
  );
}
