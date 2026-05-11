"use client";

// AgentSwitcher — chips horizontais com os agentes da instância. Permite
// alternar entre eles, criar um novo (modal simples), promover a primário
// e excluir secundários. Antes a UI assumia 1 agente por instância e o
// schema mudou pra suportar múltiplos (atendimento, fechamento, etc).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";

type AgentRow = {
  id: string;
  agent_name?: string;
  role?: string;
  is_primary?: boolean;
  is_active?: boolean;
  priority?: number;
};

export function AgentSwitcher({
  instanceId,
  selectedAgentId,
  onSelect,
}: {
  instanceId: string;
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
}) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery<{ agents: AgentRow[] }>({
    queryKey: ["instance-agents", instanceId],
    queryFn: () => integrationsApi.listAgents(instanceId).then((r) => r.data),
    enabled: !!instanceId,
  });

  const promoteMut = useMutation({
    mutationFn: (agentId: string) => integrationsApi.setPrimaryAgent(instanceId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance-agents", instanceId] });
      qc.invalidateQueries({ queryKey: ["instance-agent", instanceId] });
      toast.success("Agente promovido a primário");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao promover"),
  });

  const deleteMut = useMutation({
    mutationFn: (agentId: string) => integrationsApi.deleteAgent(instanceId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance-agents", instanceId] });
      onSelect("");
      toast.success("Agente removido");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Não foi possível remover"),
  });

  const agents = data?.agents || [];
  // Quando ainda não pinou nenhum, o "selecionado" implícito é o primário.
  const activeId = selectedAgentId || agents.find((a) => a.is_primary)?.id || agents[0]?.id || "";

  if (isLoading) {
    return <div className="text-xs" style={{ color: "var(--text-3)" }}>Carregando agentes…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: "var(--text-3)" }}>
          Agentes desta instância
        </span>
        {agents.map((a) => {
          const isActive = a.id === activeId;
          return (
            <div key={a.id} className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition"
                style={{
                  background: isActive ? "rgba(0,212,106,0.12)" : "var(--surface-3)",
                  border: `1px solid ${isActive ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
                  color: isActive ? "var(--green)" : "var(--text-2)",
                }}
              >
                {a.is_primary ? (
                  <Crown className="w-3 h-3" style={{ color: "#fbbf24" }} />
                ) : null}
                <span className="truncate max-w-[140px]">{a.agent_name || "(sem nome)"}</span>
                {a.role ? (
                  <span className="text-[10px]" style={{ color: "var(--text-3)" }}>· {a.role}</span>
                ) : null}
                {!a.is_active ? (
                  <span className="text-[10px]" style={{ color: "#f87171" }}>off</span>
                ) : null}
              </button>
              {isActive && !a.is_primary && (
                <button
                  type="button"
                  onClick={() => promoteMut.mutate(a.id)}
                  disabled={promoteMut.isPending}
                  className="p-1 rounded-md"
                  style={{ color: "#fbbf24" }}
                  title="Tornar primário"
                >
                  <Star className="w-3 h-3" />
                </button>
              )}
              {isActive && !a.is_primary && agents.length > 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await showConfirm(`Remover agente "${a.agent_name || "sem nome"}"?`, { title: "Remover agente", confirmLabel: "Remover" })) deleteMut.mutate(a.id);
                  }}
                  disabled={deleteMut.isPending}
                  className="p-1 rounded-md"
                  style={{ color: "#f87171" }}
                  title="Remover agente"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
          style={{ background: "rgba(99,102,241,0.1)", color: "#a5b4fc", border: "1px dashed rgba(99,102,241,0.25)" }}
        >
          <Plus className="w-3 h-3" />
          Adicionar agente
        </button>
      </div>

      <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
        Cada instância pode ter múltiplos agentes (atendimento, fechamento, pós-venda…). O agente primário é o fallback.
        Para transferir entre eles, defina <code className="text-[10px]" style={{ color: "#a5b4fc" }}>handoff_skills</code> e
        instrua o LLM a emitir <code className="text-[10px]" style={{ color: "#a5b4fc" }}>{"[[handoff:role]]"}</code> quando apropriado.
      </p>

      {showCreate && (
        <CreateAgentModal
          instanceId={instanceId}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["instance-agents", instanceId] });
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function CreateAgentModal({
  instanceId,
  onClose,
  onCreated,
}: {
  instanceId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("support");
  const [skillsText, setSkillsText] = useState("");

  const createMut = useMutation({
    mutationFn: () => integrationsApi.createAgent(instanceId, {
      agent_name: name.trim(),
      role: role.trim().toLowerCase(),
      handoff_skills: skillsText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    }),
    onSuccess: (r: any) => {
      toast.success("Agente criado");
      onCreated(r?.data?.id || "");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao criar"),
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-5 space-y-3"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Novo agente</h3>
          <button onClick={onClose} className="p-1 rounded" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Closer de vendas"
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Função / role</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="closing | support | followup …"
            className="input-field w-full"
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
            Identificador curto. Outros agentes usam isso em <code>[[handoff:role]]</code>.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Skills (opcional)</label>
          <input
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="ex: vendas, fechamento, proposta"
            className="input-field w-full"
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
            Separadas por vírgula. Roteia handoff de outros agentes para este.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || createMut.isPending}
            className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            {createMut.isPending ? "Criando…" : "Criar agente"}
          </button>
        </div>
      </div>
    </div>
  );
}
