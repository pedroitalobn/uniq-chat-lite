"use client";

import Link from "next/link";
import { Loader2, AlertTriangle, ScrollText, ArrowRight } from "lucide-react";
import { useAgentFormContext } from "../../../_shared/AgentFormContext";
import { IntelligenceCard } from "../_components/IntelligenceCard";
import { WhenRespondsCard } from "../_components/WhenRespondsCard";
import { TeamAccessCard } from "../_components/TeamAccessCard";
import { AdvancedCard } from "../_components/AdvancedCard";
import { StatusCard } from "../_components/StatusCard";
import { MobileStatusBar } from "../_components/MobileStatusBar";

// Settings — configurações operacionais do agente. Cards: Inteligência
// (LLM), Quando e como responde (modo + schedule + trigger + ritmo),
// Acesso da equipe (placeholder), Integrações avançadas (webhook + MCP)
// e link pros logs. Usa o mesmo AgentFormContext do Studio, então o
// botão Save no header serve as duas páginas.
export default function AgentSettingsPage() {
  const { form, updateForm, isLoading, error, instanceId, agentId } = useAgentFormContext();

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

  // Em primary, o id do agente é "primary" — pra logs, usamos undefined.
  const realAgentId = agentId === "primary" ? undefined : agentId;
  const logsHref = `/agents?inst=${instanceId}${realAgentId ? `&agent=${realAgentId}` : ""}#logs`;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="space-y-3 min-w-0">
          <MobileStatusBar form={form} />
          <IntelligenceCard form={form} update={updateForm} />
          <WhenRespondsCard form={form} update={updateForm} />
          <TeamAccessCard form={form} update={updateForm} />
          <AdvancedCard form={form} update={updateForm} />

          {/* Logs — link, não card grande */}
          <Link
            href={logsHref}
            className="group rounded-2xl px-4 py-3 flex items-center gap-3 transition-all"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-border)",
            }}
          >
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: "rgba(156,163,175,0.10)",
                border: "1px solid rgba(156,163,175,0.20)",
                color: "var(--text-3)",
              }}
            >
              <ScrollText className="w-3.5 h-3.5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                Logs de execução
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
                Histórico de respostas, ações executadas e erros
              </p>
            </div>
            <ArrowRight
              className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5"
              style={{ color: "var(--text-3)" }}
            />
          </Link>
        </div>

        {/* Status sticky — mesmo do Studio */}
        <div className="hidden lg:block">
          <StatusCard form={form} />
        </div>
      </div>
    </div>
  );
}
