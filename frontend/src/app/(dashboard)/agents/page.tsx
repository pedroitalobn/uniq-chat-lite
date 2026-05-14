"use client";

// /agents — lista limpa de instâncias com link direto pro novo editor.
// O editor antigo monolítico (2200 linhas) saiu daqui na fase 7+
// porque o novo editor (Studio + Settings + Multi-agente) cobre todos
// os fluxos com UX muito melhor. Histórico do editor antigo segue
// disponível no git (commits anteriores a este).

import Link from "next/link";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  Bot,
  Crown,
  GitBranch,
  Plus,
  Power,
  PowerOff,
  Settings2,
  Sparkles,
  Smartphone,
} from "lucide-react";
import { instancesApi, integrationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type InstanceRow = {
  id: string;
  name: string;
  phone?: string;
  channel?: string;
  // status: connected | connecting | disconnected | banned. O model
  // backend não tem is_active, então antes o pill aqui virava sempre
  // "off" porque is_active vinha undefined.
  status?: "connected" | "connecting" | "disconnected" | "banned";
  is_paused?: boolean;
};

export default function AgentsListPage() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const instancesQuery = useQuery({
    queryKey: ["instances", wsId],
    queryFn: async () =>
      ((await instancesApi.list(undefined, wsId)).data || []) as InstanceRow[],
    enabled: !!wsId,
  });

  const instances = instancesQuery.data ?? [];

  // Batch-fetch dos agentes primários — pra mostrar nome/status no card.
  // Reusa a mesma queryKey do editor (["instance-agent", id]) — sem
  // duplo fetch quando navega pro Studio.
  const agentQueries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: ["instance-agent", inst.id, ""],
      queryFn: async () => (await integrationsApi.getAgent(inst.id)).data,
      enabled: !!inst.id,
    })),
  });

  // Lista de agentes (multi-agente) por instância — pra mostrar contagem.
  const agentsListQueries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: ["instance-agents", inst.id],
      queryFn: async () => (await integrationsApi.listAgents(inst.id)).data,
      enabled: !!inst.id,
    })),
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-6xl mx-auto">
      <div className="flex items-start gap-3 mb-5 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4" style={{ color: "#a5b4fc" }} />
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
              Agentes IA
            </h1>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            Selecione uma instância pra editar o agente. Cada instância tem 1 agente primário e
            pode ter secundários (jornada multi-agente).
          </p>
        </div>
      </div>

      {instancesQuery.isLoading ? (
        <SkeletonGrid />
      ) : instances.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {instances.map((inst, i) => {
            const agent = agentQueries[i]?.data as any;
            const list = (agentsListQueries[i]?.data as any)?.agents ?? [];
            return (
              <InstanceCard
                key={inst.id}
                instance={inst}
                agentName={agent?.agent_name}
                agentActive={agent?.is_active}
                hasAgent={!!agent?.id}
                multiCount={list.length}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function InstanceCard({
  instance,
  agentName,
  agentActive,
  hasAgent,
  multiCount,
}: {
  instance: InstanceRow;
  agentName?: string;
  agentActive?: boolean;
  hasAgent: boolean;
  multiCount: number;
}) {
  return (
    <div
      className="rounded-2xl flex flex-col overflow-hidden transition-all"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--surface-border)",
      }}
    >
      {/* Header — instância */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-2">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235,0.15), rgba(37, 99, 235,0.05))",
              border: "1px solid rgba(37, 99, 235,0.20)",
              color: "var(--green)",
            }}
          >
            <Smartphone className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
              {instance.name}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-4)" }}>
              {instance.phone || instance.channel || "instância"}
            </p>
          </div>
          {(() => {
            const paused = !!instance.is_paused;
            const status = instance.status || "disconnected";
            // Pausa por segurança tem prioridade visual — bloqueia o agente
            // mesmo com o socket conectado.
            if (paused) {
              return (
                <span
                  className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-mono"
                  style={{
                    background: "rgba(245,158,11,0.10)",
                    color: "#fbbf24",
                    border: "1px solid rgba(245,158,11,0.25)",
                  }}
                  title="Instância pausada por segurança anti-ban — agente não dispara"
                >
                  pausado
                </span>
              );
            }
            if (status === "connected") {
              return (
                <span
                  className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-mono"
                  style={{
                    background: "rgba(37, 99, 235,0.10)",
                    color: "var(--green)",
                    border: "1px solid rgba(37, 99, 235,0.20)",
                  }}
                >
                  online
                </span>
              );
            }
            return (
              <span
                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-mono"
                style={{ background: "var(--surface-2)", color: "var(--text-4)" }}
                title={status === "banned" ? "Conta banida" : status === "connecting" ? "Reconectando" : "Desconectada — agente não recebe mensagens"}
              >
                {status === "banned" ? "banido" : status === "connecting" ? "conectando" : "off"}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Agent summary */}
      <div
        className="px-4 py-3 flex items-center gap-2"
        style={{
          borderTop: "1px solid var(--surface-border)",
          borderBottom: "1px solid var(--surface-border)",
        }}
      >
        <Bot className="w-3.5 h-3.5 flex-shrink-0" style={{ color: hasAgent ? "#a5b4fc" : "var(--text-4)" }} />
        <div className="flex-1 min-w-0">
          {hasAgent ? (
            <>
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                {agentName || "Sem nome"}
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-4)" }}>
                {multiCount > 1 ? `${multiCount} agentes na jornada` : "agente primário"}
              </p>
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              Sem agente configurado
            </p>
          )}
        </div>
        {agentActive ? (
          <Power className="w-3 h-3" style={{ color: "var(--green)" }} />
        ) : (
          <PowerOff className="w-3 h-3" style={{ color: "var(--text-4)" }} />
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 flex items-center gap-2">
        <Link
          href={`/agents/${instance.id}/primary`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-opacity hover:opacity-90"
          style={{
            background: hasAgent ? "var(--green)" : "rgba(37, 99, 235,0.08)",
            color: hasAgent ? "var(--green-fg)" : "var(--green)",
            border: hasAgent ? "none" : "1px solid rgba(37, 99, 235,0.20)",
          }}
        >
          {hasAgent ? <Settings2 className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {hasAgent ? "Editar" : "Configurar"}
        </Link>
        <Link
          href={`/agents/${instance.id}/multi-agente`}
          title="Jornada multi-agente"
          className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2.5 py-2 rounded-xl"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            color: "var(--text-2)",
          }}
        >
          <GitBranch className="w-3 h-3" />
          {multiCount > 1 && (
            <span className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>
              {multiCount}
            </span>
          )}
        </Link>
      </div>

      {multiCount > 1 && (
        <div
          className="px-4 py-2 flex items-center gap-1.5"
          style={{ background: "var(--surface-2)" }}
        >
          <Crown className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "#fbbf24" }} />
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
            jornada com {multiCount} agentes
          </span>
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl animate-pulse"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-border)",
            height: 180,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-2xl p-8 text-center space-y-3"
      style={{ background: "var(--surface-1)", border: "1px dashed var(--surface-border)" }}
    >
      <Smartphone className="w-7 h-7 mx-auto" style={{ color: "var(--text-3)" }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          Nenhuma instância encontrada
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
          Crie uma instância de WhatsApp/Instagram primeiro pra configurar agentes nela.
        </p>
      </div>
      <Link
        href="/instances"
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
        style={{ background: "var(--green)", color: "var(--green-fg)" }}
      >
        <Plus className="w-3 h-3" />
        Criar instância
      </Link>
    </div>
  );
}
