"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useParams, usePathname } from "next/navigation";
import { Settings, Sparkles, Loader2 } from "lucide-react";
import { integrationsApi } from "@/lib/api";

// Layout do escopo "agente" — engloba Studio (/) e Settings (/settings).
// Mostra nome do agente + tabs. AgentId="primary" busca o agente primário
// da instância (omite param no GET). Outros valores são UUIDs de agentes
// secundários da mesma instância.
export default function AgentEditorLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ instanceId: string; agentId: string }>();
  const pathname = usePathname();
  const isPrimary = params.agentId === "primary";

  const agentQuery = useQuery({
    queryKey: ["instance-agent", params.instanceId, isPrimary ? "" : params.agentId],
    queryFn: async () =>
      (await integrationsApi.getAgent(params.instanceId, isPrimary ? undefined : params.agentId)).data,
    enabled: !!params.instanceId,
  });

  const agentName = (agentQuery.data as any)?.agent_name || (isPrimary ? "Agente primário" : "Agente");
  const isSettings = pathname.endsWith("/settings");

  return (
    <div className="flex flex-col h-full">
      {/* Header do agente — nome + tabs Studio/Settings */}
      <div
        className="flex items-center gap-3 px-4 sm:px-6 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {agentQuery.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-3)" }} />
          ) : (
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.30), rgba(99,102,241,0.20))",
                color: "#a5b4fc",
                border: "1px solid rgba(124,58,237,0.40)",
              }}
            >
              {agentName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
            {agentName}
          </span>
          {isPrimary && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.10)", color: "#fbbf24" }}
            >
              primário
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <TabLink
            href={`/agents/${params.instanceId}/${params.agentId}`}
            active={!isSettings}
            icon={Sparkles}
            label="Studio"
          />
          <TabLink
            href={`/agents/${params.instanceId}/${params.agentId}/settings`}
            active={isSettings}
            icon={Settings}
            label="Settings"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: typeof Sparkles;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
      style={
        active
          ? {
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.35)",
              color: "#a5b4fc",
            }
          : {
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-2)",
            }
      }
    >
      <Icon className="w-3 h-3" />
      {label}
    </Link>
  );
}
