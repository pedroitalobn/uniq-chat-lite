"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Settings, Construction } from "lucide-react";

// Settings — configurações operacionais do agente: LLM (provedor +
// modelo), janela de ativação, trigger, ritmo humano, acesso da equipe
// (quem pode editar), webhook/MCP avançado e link pra logs. Conteúdo
// real chega na Fase 4.
export default function AgentSettingsPage() {
  const params = useParams<{ instanceId: string; agentId: string }>();

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4" style={{ color: "var(--text-3)" }} />
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
          Settings
        </h2>
      </div>

      <div
        className="rounded-2xl p-6 flex items-start gap-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
      >
        <div
          className="p-2.5 rounded-xl flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Construction className="w-5 h-5" style={{ color: "var(--text-3)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            Settings em construção (Fase 4)
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Vai concentrar: <b>Inteligência</b> (LLM/modelo), <b>Quando responder</b> (janela + trigger),
            <b> Ritmo humano</b>, <b>Acesso da equipe</b> (quem edita) e <b>Integrações avançadas</b>
            (webhook/MCP). Por ora, edite essas configs no editor antigo.
          </p>
          <Link
            href={`/agents/${params.instanceId}/${params.agentId}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg mt-4"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-2)",
            }}
          >
            Voltar pro Studio
          </Link>
        </div>
      </div>
    </div>
  );
}
