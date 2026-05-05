"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, BotOff, Eye, Loader2, Send, Sparkles, UserCheck, Zap } from "lucide-react";
import { conversationsApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AgentMode = "active" | "observing" | "disabled";

interface AgentState {
  conversation_id: string;
  mode: AgentMode;
  agent_id: string | null;
  agent: { agent_name: string; model: string } | null;
  last_suggestion: string;
  suggestion_at: string | null;
  handoff_reason: string;
}

interface SuggestionResult {
  suggestion: string;
  suggestion_at: string;
  agent_name: string;
  model: string;
}

const MODE_CONFIG: Record<AgentMode, { label: string; color: string; bg: string; border: string; icon: React.ElementType; description: string }> = {
  active: {
    label: "IA Ativa",
    color: "#00d46a",
    bg: "rgba(0,212,106,0.08)",
    border: "rgba(0,212,106,0.2)",
    icon: Bot,
    description: "Agente responde automaticamente",
  },
  observing: {
    label: "Observando",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    icon: Eye,
    description: "IA sugere, humano decide enviar",
  },
  disabled: {
    label: "Humano",
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.06)",
    border: "rgba(148,163,184,0.15)",
    icon: UserCheck,
    description: "Agente silenciado nesta conversa",
  },
};

interface Props {
  workspaceId: string;
  conversationId: string;
  onSendSuggestion?: (text: string) => void;
}

export function AgentPanel({ workspaceId, conversationId, onSendSuggestion }: Props) {
  const qc = useQueryClient();
  const [localSuggestion, setLocalSuggestion] = useState<string>("");

  const { data: state, isLoading } = useQuery<AgentState>({
    queryKey: ["agent-state", workspaceId, conversationId],
    queryFn: () => conversationsApi.getAgentState(workspaceId, conversationId).then((r) => r.data),
    refetchInterval: 8000,
  });

  const setMode = useMutation({
    mutationFn: (mode: AgentMode) =>
      conversationsApi.setAgentState(workspaceId, conversationId, { mode }),
    onSuccess: (r) => {
      qc.setQueryData(["agent-state", workspaceId, conversationId], r.data);
      qc.invalidateQueries({ queryKey: ["conversation", workspaceId, conversationId] });
    },
    onError: () => toast.error("Falha ao atualizar modo do agente"),
  });

  const suggest = useMutation({
    mutationFn: () => conversationsApi.suggestAgentReply(workspaceId, conversationId),
    onSuccess: (r) => {
      const data: SuggestionResult = r.data;
      setLocalSuggestion(data.suggestion);
      qc.invalidateQueries({ queryKey: ["agent-state", workspaceId, conversationId] });
      toast.success(`Sugestão gerada por ${data.agent_name || "agente"}`);
    },
    onError: () => toast.error("Falha ao gerar sugestão"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 px-1 text-xs" style={{ color: "var(--text-3)" }}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando agente…
      </div>
    );
  }

  const mode = (state?.mode ?? "disabled") as AgentMode;
  const cfg = MODE_CONFIG[mode];
  const Icon = cfg.icon;
  const agentName = state?.agent?.agent_name || "Agente";
  const suggestion = localSuggestion || state?.last_suggestion || "";

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
          Agente IA
        </span>
      </div>

      {/* Mode card */}
      <div className="rounded-xl p-3 space-y-2.5" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 flex-shrink-0" style={{ color: cfg.color }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold leading-none" style={{ color: cfg.color }}>{cfg.label}</p>
            {state?.agent?.agent_name && (
              <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-3)" }}>{agentName}</p>
            )}
          </div>
        </div>
        <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{cfg.description}</p>

        {/* Mode buttons */}
        <div className="flex gap-1">
          {(["active", "observing", "disabled"] as AgentMode[]).map((m) => {
            const c = MODE_CONFIG[m];
            const MIcon = c.icon;
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => !isActive && setMode.mutate(m)}
                disabled={setMode.isPending && !isActive}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-all",
                  isActive ? "ring-1" : "opacity-60 hover:opacity-100"
                )}
                style={{
                  background: isActive ? c.bg : "var(--surface-3)",
                  color: isActive ? c.color : "var(--text-3)",
                  border: `1px solid ${isActive ? c.border : "var(--surface-border)"}`,
                  outline: isActive ? `1px solid ${c.color}` : "none",
                }}
                title={c.label}
              >
                <MIcon className="w-3 h-3" />
                <span className="hidden sm:inline">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recommendations panel — inspired by AI assistant UX */}
      <div className="rounded-xl overflow-hidden"
        style={{
          background: suggestion
            ? "linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(255,255,255,0.02) 100%)"
            : "var(--surface-2)",
          border: `1px solid ${suggestion ? "rgba(245,158,11,0.18)" : "var(--surface-border)"}`,
          transition: "all 0.3s ease",
        }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: suggestion ? "rgba(245,158,11,0.12)" : "var(--surface-border)" }}>
          <Sparkles className="w-3 h-3" style={{ color: "#f59e0b" }} />
          <span className="text-[10px] font-semibold" style={{ color: "var(--text-2)" }}>
            Recomendações
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
            IA Gerado
          </span>
          <button
            onClick={() => { setLocalSuggestion(""); suggest.mutate(); }}
            disabled={suggest.isPending}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all"
            style={{
              background: suggest.isPending ? "rgba(245,158,11,0.06)" : "rgba(245,158,11,0.10)",
              color: "#f59e0b",
              border: "1px solid rgba(245,158,11,0.20)",
            }}
          >
            {suggest.isPending ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Zap className="w-2.5 h-2.5" />
            )}
            Gerar
          </button>
        </div>

        {suggestion ? (
          <div className="p-3 space-y-2.5">
            {/* Suggestion badge */}
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.25)" }}>
                <Sparkles className="w-2 h-2" style={{ color: "#f59e0b" }} />
              </div>
              <p className="text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                Resposta gerada por{" "}
                <span style={{ color: "var(--text-2)" }}>{agentName}</span>
              </p>
            </div>

            {/* Response text */}
            <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
                {suggestion}
              </p>
            </div>

            {onSendSuggestion && (
              <button
                onClick={() => { onSendSuggestion(suggestion); setLocalSuggestion(""); }}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg w-full justify-center transition-all hover:scale-[1.01]"
                style={{
                  background: "linear-gradient(135deg, rgba(0,212,106,0.18), rgba(0,212,106,0.08))",
                  color: "var(--green)",
                  border: "1px solid rgba(0,212,106,0.25)",
                  boxShadow: "0 2px 12px rgba(0,212,106,0.12)",
                }}
              >
                <Send className="w-3 h-3" />
                Usar Resposta
              </button>
            )}
          </div>
        ) : (
          <div className="px-3 py-5 flex flex-col items-center gap-2 text-center">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.12)" }}>
              <Bot className="w-4 h-4" style={{ color: "#f59e0b", opacity: 0.6 }} />
            </div>
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
              {mode === "disabled" ? "Ative a IA para gerar recomendações" : "Clique em Gerar para ver sugestões"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
