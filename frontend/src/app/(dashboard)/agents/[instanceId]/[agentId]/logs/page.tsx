"use client";

import { Loader2, AlertTriangle } from "lucide-react";
import { useAgentFormContext } from "../../../_shared/AgentFormContext";
import { AgentLogsTab } from "@/components/agents/AgentLogsTab";

export default function AgentLogsPage() {
  const { isLoading, error, instanceId, agentId } = useAgentFormContext();

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
          <p className="text-sm" style={{ color: "var(--text-1)" }}>
            Não foi possível carregar o agente.
          </p>
        </div>
      </div>
    );
  }

  const apiAgentId = agentId === "primary" ? "" : agentId;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-4xl mx-auto">
      <AgentLogsTab instanceId={instanceId} agentId={apiAgentId} />
    </div>
  );
}
