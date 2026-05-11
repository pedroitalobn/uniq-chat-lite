"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, UserCheck, Eye, Send, Loader2, ChevronDown, ChevronUp,
  Sparkles, Save, MessageSquare, Wand2,
} from "lucide-react";
import { conversationsApi, instancesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface AgentOrchestratorProps {
  conversationId: string;
  instanceId?: string;
  convMode: "human" | "ai" | "observing";
  onModeChange: (mode: "human" | "ai" | "observing") => void;
}

type CommandMsg = {
  id: string;
  role: "operator" | "agent";
  text: string;
  tools?: Array<{ tool: string; ok: boolean; detail: string }>;
  createdAt: number;
};

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {children}
    </div>
  );
}

export default function AgentOrchestrator({
  conversationId,
  instanceId,
  convMode,
  onModeChange,
}: AgentOrchestratorProps) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [customContext, setCustomContext] = useState("");
  const [command, setCommand] = useState("");
  const [chatMessages, setChatMessages] = useState<CommandMsg[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load agent state
  const agentStateQ = useQuery({
    queryKey: ["agent-state", wsId, conversationId],
    queryFn: () =>
      conversationsApi.getAgentState(wsId, conversationId).then(
        (r) => r.data as {
          mode?: string;
          agent_id?: string | null;
          custom_context?: string;
          last_suggestion?: string;
        }
      ),
    enabled: !!wsId && !!conversationId,
  });

  // Load instance agents for dropdown
  const agentsQ = useQuery({
    queryKey: ["instance-agents", instanceId],
    queryFn: () =>
      instancesApi.listAgents(instanceId!).then(
        (r) => r.data as { items: Array<{ id: string; agent_name: string; role: string; is_primary: boolean }> }
      ),
    enabled: !!instanceId,
  });

  // Sync custom context from server
  useEffect(() => {
    if (agentStateQ.data?.custom_context !== undefined) {
      setCustomContext(agentStateQ.data.custom_context);
    }
  }, [agentStateQ.data?.custom_context]);

  // Save agent state (mode + agent + context)
  const saveStateMut = useMutation({
    mutationFn: (data: {
      mode: "active" | "observing" | "disabled";
      agent_id?: string;
      custom_context?: string;
    }) => conversationsApi.setAgentState(wsId, conversationId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-state", wsId, conversationId] });
      toast.success("Config do agente salva");
    },
    onError: () => toast.error("Falha ao salvar"),
  });

  // Send command to agent
  const commandMut = useMutation({
    mutationFn: (cmd: string) =>
      conversationsApi.sendAgentCommand(wsId, conversationId, { command: cmd }),
    onSuccess: (res) => {
      const data = res.data as {
        reply: string;
        tools?: Array<{ tool: string; ok: boolean; detail?: string }>;
      };
      setChatMessages((prev) => [
        ...prev,
        {
          id: `agent-${Date.now()}`,
          role: "agent",
          text: data.reply,
          tools: data.tools?.map((t) => ({
            tool: t.tool,
            ok: t.ok,
            detail: t.detail || "",
          })),
          createdAt: Date.now(),
        },
      ]);
    },
    onError: (err: any) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "agent",
          text: err?.response?.data?.error || "Erro ao processar comando.",
          createdAt: Date.now(),
        },
      ]);
    },
  });

  const sendCommand = () => {
    const cmd = command.trim();
    if (!cmd) return;
    setChatMessages((prev) => [
      ...prev,
      { id: `op-${Date.now()}`, role: "operator", text: cmd, createdAt: Date.now() },
    ]);
    setCommand("");
    commandMut.mutate(cmd);
  };

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const currentAgentId = agentStateQ.data?.agent_id || "";
  const agents = agentsQ.data?.items ?? [];

  const handleModeChange = (mode: "human" | "ai" | "observing") => {
    onModeChange(mode);
    const dbMode = mode === "ai" ? "active" : mode === "observing" ? "observing" : "disabled";
    saveStateMut.mutate({
      mode: dbMode,
      agent_id: currentAgentId || undefined,
      custom_context: customContext,
    });
  };

  const handleAgentChange = (agentId: string) => {
    const dbMode = convMode === "ai" ? "active" : convMode === "observing" ? "observing" : "disabled";
    saveStateMut.mutate({
      mode: dbMode,
      agent_id: agentId || undefined,
      custom_context: customContext,
    });
  };

  const handleSaveContext = () => {
    const dbMode = convMode === "ai" ? "active" : convMode === "observing" ? "observing" : "disabled";
    saveStateMut.mutate({
      mode: dbMode,
      agent_id: currentAgentId || undefined,
      custom_context: customContext,
    });
  };

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)" }}>
            <Bot className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-1)" }}>Agente</h3>
            <p className="text-[10px]" style={{ color: "var(--text-4)" }}>Orquestração e comandos</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Mode selector */}
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-4)" }}>Modo de atendimento</label>
                <div className="flex items-center rounded-lg overflow-hidden border"
                  style={{ border: "1px solid var(--border-default)", background: "rgba(255,255,255,0.03)" }}>
                  {([
                    { id: "human" as const, label: "Humano", icon: UserCheck },
                    { id: "ai" as const, label: "IA", icon: Bot },
                    { id: "observing" as const, label: "Obs", icon: Eye },
                  ]).map(({ id, label, icon: Icon }) => (
                    <button key={id}
                      onClick={() => handleModeChange(id)}
                      disabled={saveStateMut.isPending}
                      className="flex-1 px-2 py-1.5 text-[11px] font-medium flex items-center justify-center gap-1 transition-all"
                      style={{
                        background: convMode === id ? (id === "ai" ? "rgba(167,139,250,0.2)" : id === "human" ? "rgba(0,212,106,0.15)" : "rgba(255,255,255,0.08)") : "transparent",
                        color: convMode === id ? (id === "ai" ? "#c4b5fd" : id === "human" ? "#00d46a" : "hsl(240 15% 80%)") : "var(--text-3)",
                      }}>
                      <Icon className="h-3 w-3" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Agent selector */}
              {agents.length > 1 && (
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-4)" }}>Agente ativo</label>
                  <select
                    value={currentAgentId}
                    onChange={(e) => handleAgentChange(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.agent_name || "Agente"} {a.is_primary ? "(Primário)" : `· ${a.role}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom context */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Contexto personalizado</label>
                  <button
                    onClick={handleSaveContext}
                    disabled={saveStateMut.isPending}
                    className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md transition-all"
                    style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "#00d46a" }}
                  >
                    {saveStateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Salvar
                  </button>
                </div>
                <textarea
                  value={customContext}
                  onChange={(e) => setCustomContext(e.target.value)}
                  placeholder="Instruções extras para o agente nesta conversa..."
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
                />
                <p className="text-[9px] mt-1" style={{ color: "var(--text-4)" }}>
                  Este texto é injetado no system prompt do agente para esta conversa.
                </p>
              </div>

              {/* Chat with Agent */}
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-4)" }}>Chat com Agente</label>
                <div
                  className="rounded-xl p-3 space-y-3"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", maxHeight: 280, overflow: "auto" }}
                >
                  {chatMessages.length === 0 && (
                    <p className="text-[11px] text-center py-4" style={{ color: "var(--text-4)" }}>
                      Envie comandos pro agente executar ações no CRM, tags, deals...
                    </p>
                  )}
                  {chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === "operator" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[90%] rounded-xl px-3 py-2 text-xs"
                        style={{
                          background: msg.role === "operator" ? "rgba(0,212,106,0.10)" : "var(--surface-2)",
                          border: `1px solid ${msg.role === "operator" ? "rgba(0,212,106,0.20)" : "var(--surface-border)"}`,
                          color: "var(--text-1)",
                        }}
                      >
                        <p className="leading-relaxed">{msg.text}</p>
                        {msg.tools && msg.tools.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {msg.tools.map((t, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                <span className={`w-1.5 h-1.5 rounded-full ${t.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                                <span style={{ color: t.ok ? "#00d46a" : "#ef4444" }}>
                                  {t.tool}: {t.detail}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendCommand(); }}
                    placeholder="Comando pro agente..."
                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
                  />
                  <button
                    onClick={sendCommand}
                    disabled={commandMut.isPending || !command.trim()}
                    className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all"
                    style={{
                      background: commandMut.isPending || !command.trim() ? "var(--surface-2)" : "rgba(167,139,250,0.15)",
                      color: commandMut.isPending || !command.trim() ? "var(--text-4)" : "#a78bfa",
                      border: `1px solid ${commandMut.isPending || !command.trim() ? "var(--surface-border)" : "rgba(167,139,250,0.25)"}`,
                    }}
                  >
                    {commandMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
