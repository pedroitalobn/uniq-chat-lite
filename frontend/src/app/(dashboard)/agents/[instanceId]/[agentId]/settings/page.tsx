"use client";

import Link from "next/link";
import { Loader2, AlertTriangle, ScrollText, ArrowRight, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { conversationsApi } from "@/lib/api";
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
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;

  const [showDangerZone, setShowDangerZone] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState("");

  const resetAllAgentMemory = useMutation({
    mutationFn: () => conversationsApi.resetAllAgentMemory(wsId as string, "RESETAR TUDO"),
    onSuccess: () => {
      toast.success("Memória do agente resetada em todas as conversas");
      setShowDangerZone(false);
      setDangerConfirm("");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Falha ao resetar memória");
    },
  });

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

          {/* Danger Zone — resetar memória do agente em todas as conversas */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: "rgba(239,68,68,0.04)",
              border: "1px solid rgba(239,68,68,0.18)",
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.22)" }}
              >
                <Trash2 className="w-4 h-4" style={{ color: "#ef4444" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Danger Zone</p>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  Resetar memória do agente em todas as conversas deste workspace.
                </p>
              </div>
              <button
                onClick={() => setShowDangerZone(true)}
                className="text-xs font-medium rounded-lg px-3 py-1.5 flex-shrink-0"
                style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}
              >
                Resetar tudo
              </button>
            </div>
          </div>

          {showDangerZone && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
              <div className="w-full max-w-md rounded-xl border p-5" style={{ background: "hsl(240 12% 8%)", borderColor: "rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Danger Zone</h3>
                  <button onClick={() => setShowDangerZone(false)} className="p-1 rounded-lg hover:bg-white/5">
                    <X className="w-4 h-4" style={{ color: "var(--text-3)" }} />
                  </button>
                </div>
                <div className="space-y-3">
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>
                    Isso vai apagar a memória do agente em <strong style={{ color: "#f87171" }}>TODAS</strong> as conversas deste workspace.
                    O agente vai "esquecer" tudo que aprendeu sobre todos os contatos.
                    Esta ação é <strong>irreversível</strong>.
                  </p>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--text-3)" }}>
                      Digite <strong>RESETAR TUDO</strong> para confirmar
                    </label>
                    <input
                      value={dangerConfirm}
                      onChange={(e) => setDangerConfirm(e.target.value)}
                      placeholder="RESETAR TUDO"
                      className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "hsl(240 15% 90%)" }}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setShowDangerZone(false)}
                      className="rounded-lg px-3 py-2 text-xs font-medium"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-2)" }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => resetAllAgentMemory.mutate()}
                      disabled={dangerConfirm !== "RESETAR TUDO" || resetAllAgentMemory.isPending}
                      className="rounded-lg px-3 py-2 text-xs font-medium"
                      style={{
                        background: "rgba(248,113,113,0.18)",
                        border: "1px solid rgba(248,113,113,0.30)",
                        color: "#fca5a5",
                        opacity: dangerConfirm !== "RESETAR TUDO" || resetAllAgentMemory.isPending ? 0.5 : 1,
                      }}
                    >
                      {resetAllAgentMemory.isPending ? "Resetando…" : "Resetar tudo"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

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
