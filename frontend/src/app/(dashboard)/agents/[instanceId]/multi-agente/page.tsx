"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown,
  Plus,
  Star,
  Trash2,
  GitBranch,
  ArrowRight,
  Loader2,
  Sparkles,
  Power,
  PowerOff,
  Hash,
  CornerDownRight,
} from "lucide-react";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { NewAgentModal } from "./_components/NewAgentModal";

type AgentRow = {
  id: string;
  agent_name?: string;
  role?: string;
  is_primary?: boolean;
  is_active?: boolean;
  priority?: number;
  handoff_skills?: string[] | string;
  action_confirmation?: "client" | "auto" | "human";
};

// Multi-agente — timeline vertical da jornada de atendimento. O agente
// primário fica no topo (recebe TODA mensagem nova). Os secundários
// ficam embaixo, cada um com a regra de ativação (handoff_skills) que
// deve disparar a transferência. Cada nó é clicável e leva pro Studio
// daquele agente.
export default function MultiAgentTimelinePage() {
  const params = useParams<{ instanceId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<{ agents: AgentRow[] }>({
    queryKey: ["instance-agents", params.instanceId],
    queryFn: () => integrationsApi.listAgents(params.instanceId).then((r) => r.data),
    enabled: !!params.instanceId,
  });

  const promoteMut = useMutation({
    mutationFn: (agentId: string) => integrationsApi.setPrimaryAgent(params.instanceId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance-agents", params.instanceId] });
      qc.invalidateQueries({ queryKey: ["instance-agent", params.instanceId] });
      toast.success("Agente promovido a primário.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao promover."),
  });

  const deleteMut = useMutation({
    mutationFn: (agentId: string) => integrationsApi.deleteAgent(params.instanceId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance-agents", params.instanceId] });
      toast.success("Agente removido.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Não foi possível remover."),
  });

  const agents = data?.agents || [];
  // Garante: primário primeiro, secundários depois (pela ordem de criação/priority).
  const sorted = [...agents].sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1;
    if (!a.is_primary && b.is_primary) return 1;
    return (a.priority ?? 0) - (b.priority ?? 0);
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-4 h-4" style={{ color: "var(--green)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
              Jornada de atendimento
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            Como o cliente é roteado entre os agentes desta instância. O primário recebe toda
            mensagem nova; os demais entram quando palavras-chave da rota disparam.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}
        >
          <Plus className="w-3 h-3" />
          Novo agente
        </button>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="relative">
          {/* Linha vertical de fundo conectando os nós */}
          <div
            className="absolute left-4 top-6 bottom-6 w-px"
            style={{ background: "linear-gradient(180deg, transparent, var(--surface-border) 8%, var(--surface-border) 92%, transparent)" }}
          />

          {/* Marcador "INÍCIO" */}
          <TimelineMarker label="Início da conversa" />

          <div className="space-y-3">
            {sorted.map((agent, idx) => (
              <TimelineNode
                key={agent.id}
                instanceId={params.instanceId}
                agent={agent}
                position={idx === 0 ? "primary" : "secondary"}
                canDelete={!agent.is_primary && agents.length > 1}
                canPromote={!agent.is_primary}
                onPromote={() => promoteMut.mutate(agent.id)}
                onDelete={async () => {
                  const ok = await showConfirm(
                    `Remover agente "${agent.agent_name || "sem nome"}"? Esta ação não pode ser desfeita.`,
                    { title: "Remover agente", confirmLabel: "Remover", danger: true },
                  );
                  if (ok) deleteMut.mutate(agent.id);
                }}
                onEdit={() => router.push(`/agents/${params.instanceId}/${agent.id}`)}
                isPromoting={promoteMut.isPending}
                isDeleting={deleteMut.isPending}
              />
            ))}
          </div>

          {/* Marcador "FIM" */}
          <TimelineMarker label="Adicionar novo agente" cta onClick={() => setCreateOpen(true)} />
        </div>
      )}

      {createOpen && (
        <NewAgentModal
          instanceId={params.instanceId}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => id && router.push(`/agents/${params.instanceId}/${id}`)}
        />
      )}
    </div>
  );
}

// ─── Timeline node ────────────────────────────────────────────────────────

function TimelineNode({
  instanceId,
  agent,
  position,
  canDelete,
  canPromote,
  onPromote,
  onDelete,
  onEdit,
  isPromoting,
  isDeleting,
}: {
  instanceId: string;
  agent: AgentRow;
  position: "primary" | "secondary";
  canDelete: boolean;
  canPromote: boolean;
  onPromote: () => void;
  onDelete: () => void;
  onEdit: () => void;
  isPromoting: boolean;
  isDeleting: boolean;
}) {
  const isPrimary = !!agent.is_primary;
  const isActive = agent.is_active !== false;
  const skills = parseSkills(agent.handoff_skills);
  const accentColor = isPrimary ? "#fbbf24" : "#a5b4fc";

  return (
    <div className="relative pl-10">
      {/* Bolinha do timeline */}
      <span
        className="absolute left-0 top-4 w-8 h-8 rounded-full flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${accentColor}33, ${accentColor}10)`,
          border: `2px solid ${accentColor}`,
          boxShadow: `0 0 12px ${accentColor}55`,
        }}
      >
        {isPrimary ? (
          <Crown className="w-3.5 h-3.5" style={{ color: accentColor }} />
        ) : (
          <Sparkles className="w-3.5 h-3.5" style={{ color: accentColor }} />
        )}
      </span>

      {/* Card do agente */}
      <div
        className="rounded-2xl p-4 transition-all"
        style={{
          background: isPrimary
            ? "linear-gradient(135deg, rgba(251,191,36,0.06), rgba(251,191,36,0.02))"
            : "var(--surface-1)",
          border: `1px solid ${isPrimary ? "rgba(251,191,36,0.30)" : "var(--surface-border)"}`,
        }}
      >
        {/* Top — nome + badges */}
        <div className="flex items-start gap-2 mb-2 flex-wrap">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            {agent.agent_name || "(sem nome)"}
          </h3>
          {isPrimary && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.30)" }}
            >
              primário
            </span>
          )}
          {agent.role && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
            >
              <Hash className="w-2.5 h-2.5" />
              {agent.role}
            </span>
          )}
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={
              isActive
                ? { background: "rgba(37, 99, 235,0.10)", color: "var(--green)", border: "1px solid rgba(37, 99, 235,0.20)" }
                : { background: "var(--surface-2)", color: "var(--text-4)", border: "1px solid var(--surface-border)" }
            }
          >
            {isActive ? <Power className="w-2.5 h-2.5" /> : <PowerOff className="w-2.5 h-2.5" />}
            {isActive ? "ativo" : "inativo"}
          </span>
        </div>

        {/* Trigger / handoff_skills — só pra secundários */}
        {!isPrimary && (
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-4)" }}>
              <CornerDownRight className="w-2.5 h-2.5 inline mr-1" />
              Ativa quando o cliente mencionar
            </p>
            {skills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {skills.map((s, i) => (
                  <span
                    key={`${i}-${s}`}
                    className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-mono"
                    style={{
                      background: "rgba(99,102,241,0.10)",
                      color: "#a5b4fc",
                      border: "1px solid rgba(99,102,241,0.20)",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px]" style={{ color: "var(--text-4)" }}>
                Sem palavras-chave configuradas — agente não recebe tráfego automático.
              </p>
            )}
          </div>
        )}

        {isPrimary && (
          <p className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
            Recebe toda mensagem nova de clientes. É o ponto de partida da jornada.
          </p>
        )}

        {/* Confirmação */}
        {agent.action_confirmation && (
          <p className="text-[10px] mb-3" style={{ color: "var(--text-4)" }}>
            Confirmação:{" "}
            <span style={{ color: "var(--text-3)" }}>
              {agent.action_confirmation === "client" && "perguntar ao cliente"}
              {agent.action_confirmation === "auto" && "auto-executar"}
              {agent.action_confirmation === "human" && "aprovação humana"}
            </span>
          </p>
        )}

        {/* Ações */}
        <div className="flex items-center gap-2 flex-wrap pt-2" style={{ borderTop: "1px solid var(--surface-border)" }}>
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            Editar agente
            <ArrowRight className="w-3 h-3" />
          </button>
          {canPromote && (
            <button
              onClick={onPromote}
              disabled={isPromoting}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg disabled:opacity-50"
              style={{
                background: "rgba(251,191,36,0.10)",
                color: "#fbbf24",
                border: "1px solid rgba(251,191,36,0.20)",
              }}
              title="Tornar primário"
            >
              <Star className="w-3 h-3" />
              Tornar primário
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg ml-auto disabled:opacity-50"
              style={{ background: "rgba(239,68,68,0.08)", color: "#f87171" }}
              title="Remover agente"
            >
              <Trash2 className="w-3 h-3" />
              Remover
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineMarker({
  label,
  cta,
  onClick,
}: {
  label: string;
  cta?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="relative pl-10 py-3">
      <span
        className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full"
        style={{
          background: "var(--surface-1)",
          border: "2px solid var(--surface-border)",
        }}
      />
      {cta && onClick ? (
        <button
          onClick={onClick}
          className="text-[11px] font-medium px-3 py-1.5 rounded-full inline-flex items-center gap-1.5"
          style={{
            background: "rgba(99,102,241,0.06)",
            border: "1px dashed rgba(99,102,241,0.25)",
            color: "#a5b4fc",
          }}
        >
          <Plus className="w-3 h-3" />
          {label}
        </button>
      ) : (
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-4)" }}>
          {label}
        </p>
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="rounded-2xl p-8 text-center space-y-3"
      style={{ background: "var(--surface-1)", border: "1px dashed var(--surface-border)" }}
    >
      <GitBranch className="w-6 h-6 mx-auto" style={{ color: "var(--text-3)" }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          Nenhum agente configurado nesta instância
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
          Crie o primeiro agente — ele já vira o primário e recebe toda mensagem nova.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
        style={{ background: "var(--green)", color: "var(--green-fg)" }}
      >
        <Plus className="w-3 h-3" />
        Criar agente primário
      </button>
    </div>
  );
}

function parseSkills(raw: AgentRow["handoff_skills"]): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      // pode vir como CSV
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}
