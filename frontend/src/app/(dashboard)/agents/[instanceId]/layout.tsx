"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useParams, usePathname } from "next/navigation";
import { ArrowLeft, Bot, GitBranch, Loader2 } from "lucide-react";
import { instancesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// Layout do escopo "instância" — engloba Studio (/[agent]), Settings
// (/[agent]/settings) e Multi-agente (/multi-agente). Cabeçalho com
// nome da instância + breadcrumb "← Agentes" + atalho pra timeline
// multi-agente. As tabs Studio/Settings são responsabilidade do
// layout filho ([agentId]/layout.tsx) — aqui só envelopa.
export default function AgentInstanceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ instanceId: string }>();
  const pathname = usePathname();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const instancesQuery = useQuery({
    queryKey: ["instances", wsId],
    queryFn: async () => (await instancesApi.list(undefined, wsId)).data || [],
    enabled: !!wsId,
  });

  const instance = instancesQuery.data?.find((i: any) => i.id === params.instanceId);
  const isMultiAgent = pathname.endsWith("/multi-agente");

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header da instância */}
      <div
        className="flex items-center gap-3 px-4 sm:px-6 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--surface-border)" }}
      >
        <Link
          href="/agents"
          className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg transition-colors hover:bg-white/5"
          style={{ color: "var(--text-3)" }}
        >
          <ArrowLeft className="w-3 h-3" />
          Agentes
        </Link>
        <span style={{ color: "var(--text-4)" }}>/</span>
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-4 h-4 flex-shrink-0" style={{ color: "#a5b4fc" }} />
          {instance ? (
            <span className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
              {instance.name}
            </span>
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--text-3)" }} />
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/agents/${params.instanceId}/multi-agente`}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            style={
              isMultiAgent
                ? {
                    background: "rgba(0,212,106,0.12)",
                    border: "1px solid rgba(0,212,106,0.30)",
                    color: "var(--green)",
                  }
                : {
                    background: "var(--surface-2)",
                    border: "1px solid var(--surface-border)",
                    color: "var(--text-2)",
                  }
            }
          >
            <GitBranch className="w-3 h-3" />
            Multi-agente
          </Link>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
