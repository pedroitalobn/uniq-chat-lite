"use client";

// Painel de atividade em tempo real das execuções de jornadas.
// Antes vivia em /agents/page.tsx::ActivitySection.

import { useQuery } from "@tanstack/react-query";
import {
  Activity, Clock, MessageSquare, Send, Server, TrendingUp, User, Users, Zap,
} from "lucide-react";
import { agentsApi } from "@/lib/api";

export function ActivityPanel() {
  const { data: activityData, isLoading } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: async () => (await agentsApi.activity(50)).data,
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ["agent-stats"],
    queryFn: async () => (await agentsApi.stats()).data,
    refetchInterval: 30000,
  });

  const items = activityData?.items || [];

  const getActivityIcon = (item: any) => {
    if (item.last_message_type === "inbound") return <MessageSquare className="w-4 h-4" style={{ color: "#60a5fa" }} />;
    if (item.last_message_type === "outbound") return <Send className="w-4 h-4" style={{ color: "#00d46a" }} />;
    if (item.last_message_type === "wait") return <Clock className="w-4 h-4" style={{ color: "#f59e0b" }} />;
    return <Zap className="w-4 h-4" style={{ color: "#8b5cf6" }} />;
  };

  const getActivityMessage = (item: any) => {
    if (item.last_message_type === "inbound") {
      return `Recebeu "${item.last_message?.slice(0, 30) || "mensagem"}..." de ${item.contact_name || item.contact_jid?.split("@")[0]}`;
    }
    if (item.last_message_type === "outbound") {
      const mode = item.response_mode === "private" ? "no privado" : "no grupo";
      return `Enviou mensagem ${mode}: "${item.last_message?.slice(0, 40) || "..."}..."`;
    }
    if (item.status === "completed") return "Jornada concluída com sucesso!";
    if (item.status === "failed") return `Falhou: ${item.error_message || "erro desconhecido"}`;
    return item.last_message || `Executando passo ${(item.step_index || 0) + 1}/${item.total_steps || "?"}`;
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "active": return { color: "#10b981", bg: "rgba(16,185,129,0.1)", label: "Executando" };
      case "completed": return { color: "#3b82f6", bg: "rgba(59,130,246,0.1)", label: "Concluída" };
      case "failed": return { color: "#ef4444", bg: "rgba(239,68,68,0.1)", label: "Falhou" };
      case "pending": return { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", label: "Pendente" };
      default: return { color: "#6b7280", bg: "rgba(107,114,128,0.1)", label: status };
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 border-b flex-shrink-0 flex-wrap" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4" style={{ color: "#10b981" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Atividade</h2>
        </div>
        <div className="flex-1" />
        {stats && (
          <div className="flex items-center gap-2 sm:gap-3 text-xs flex-wrap" style={{ color: "var(--text-3)" }}>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(0,212,106,0.1)" }}>
              <Activity className="w-3 h-3" style={{ color: "var(--green)" }} />
              {stats.journeys.active_executions} ativa{stats.journeys.active_executions !== 1 ? "s" : ""}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.1)" }}>
              <TrendingUp className="w-3 h-3" style={{ color: "#3b82f6" }} />
              {stats.journeys.today_executions} hoje
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(139,92,246,0.1)" }}>
              <Server className="w-3 h-3" style={{ color: "#8b5cf6" }} />
              {stats.instances_active} instância{stats.instances_active !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {isLoading ? (
          <div className="p-3 sm:p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--surface-3)" }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 opacity-40 text-center">
            <Activity className="w-12 h-12 mb-3" style={{ color: "var(--text-3)" }} />
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhuma atividade ainda</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>As execuções aparecerão aqui em tempo real</p>
          </div>
        ) : (
          <div className="space-y-2 p-3 sm:p-4">
            {items.map((item: any, i: number) => {
              const statusConfig = getStatusConfig(item.status);
              const stepPct = item.total_steps > 0
                ? Math.round(((item.step_index || 0) / item.total_steps) * 100)
                : 0;
              const isActive = item.status === "active";
              return (
                <div key={i} className="rounded-xl p-3 sm:p-4 transition-all hover:scale-[1.005]"
                  style={{
                    background: "var(--surface-3)",
                    border: `1px solid ${isActive ? "rgba(0,212,106,0.18)" : "var(--surface-border)"}`,
                    borderLeft: `3px solid ${statusConfig.color}60`,
                  }}>
                  <div className="flex items-start gap-3">
                    <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: statusConfig.bg }}>
                      {getActivityIcon(item)}
                      {isActive && (
                        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                          style={{ background: statusConfig.color, borderColor: "var(--surface-3)" }}>
                          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: statusConfig.color, opacity: 0.4 }} />
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                          {item.journey_name || "Jornada"}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                          style={{ background: statusConfig.bg, color: statusConfig.color }}>
                          {statusConfig.label}
                        </span>
                      </div>

                      <p className="text-sm mb-2 break-words"
                        style={{ color: item.last_message_type === "outbound" ? "#00d46a" : "var(--text-2)" }}>
                        {getActivityMessage(item)}
                      </p>

                      {/* Step progress bar */}
                      {item.total_steps > 0 && (
                        <div className="mb-2">
                          <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: "var(--text-3)" }}>
                            <span>Passo {(item.step_index || 0) + 1} de {item.total_steps}</span>
                            <span>{stepPct}%</span>
                          </div>
                          <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border-subtle)" }}>
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${stepPct}%`,
                                background: statusConfig.color,
                                boxShadow: isActive ? `0 0 6px ${statusConfig.color}60` : "none",
                              }} />
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 sm:gap-3 text-[11px] flex-wrap" style={{ color: "var(--text-3)" }}>
                        {item.contact_name && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {item.contact_name}
                          </span>
                        )}
                        {item.instance_name && (
                          <span className="flex items-center gap-1">
                            <Server className="w-3 h-3" />
                            {item.instance_name}
                          </span>
                        )}
                        {item.group_name && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {item.group_name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      {item.started_at && (
                        <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                          {new Date(item.started_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
