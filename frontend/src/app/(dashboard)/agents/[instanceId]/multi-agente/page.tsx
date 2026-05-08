"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { GitBranch, Construction } from "lucide-react";

// Multi-agente — timeline vertical de jornada (estilo bullet points
// com handoff inline entre agentes). Conteúdo real chega na Fase 6.
export default function MultiAgentTimelinePage() {
  const params = useParams<{ instanceId: string }>();

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4" style={{ color: "var(--green)" }} />
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
          Multi-agente
        </h2>
      </div>

      <div
        className="rounded-2xl p-6 flex items-start gap-4"
        style={{
          background: "linear-gradient(135deg, rgba(0,212,106,0.06), rgba(0,212,106,0.02))",
          border: "1px solid rgba(0,212,106,0.20)",
        }}
      >
        <div
          className="p-2.5 rounded-xl flex-shrink-0"
          style={{ background: "rgba(0,212,106,0.10)", border: "1px solid rgba(0,212,106,0.25)" }}
        >
          <Construction className="w-5 h-5" style={{ color: "var(--green)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            Multi-agente em construção (Fase 6)
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Esta tela vai mostrar a jornada de handoff entre agentes da instância como uma timeline
            vertical: cada agente vira um nó com a regra "se cliente disser X, passa pra outro agente".
            Você poderá editar cada agente clicando nele e adicionar novos diretamente da timeline.
          </p>
          <Link
            href={`/agents/${params.instanceId}/primary`}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg mt-4"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-2)",
            }}
          >
            Ir pro Studio do agente primário
          </Link>
        </div>
      </div>
    </div>
  );
}
