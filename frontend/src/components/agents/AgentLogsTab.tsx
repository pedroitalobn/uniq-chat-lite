"use client";

// AgentLogsTab — aba "Logs" no editor de agente. Mostra histórico das
// últimas execuções (sucesso, pulada, falhou) com input/reply preview e
// duração. Sem isso o user não sabia se o agente estava agindo —
// ficava chutando se a config tava certa.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { integrationsApi } from "@/lib/api";
import { AlertCircle, Bot, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, SkipForward, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";

type LogItem = {
  id: string;
  agent_id: string;
  trigger: "inbound" | "webhook";
  status: "success" | "skipped" | "failed";
  skip_reason?: string;
  error_message?: string;
  input_preview?: string;
  reply_preview?: string;
  duration_ms: number;
  created_at: string;
};

const SKIP_REASON_LABELS: Record<string, string> = {
  no_llm:                 "Sem LLM disponível",
  instance_disconnected:  "Instância desconectada",
  trigger_no_match:       "Mensagem não bateu com palavras-chave",
  trigger_webhook_only:   "Modo webhook — não responde inbound",
  outside_window:         "Fora da janela de ativação",
};

export function AgentLogsTab({
  instanceId,
  agentId,
}: {
  instanceId: string;
  /** "" = primário */
  agentId: string;
}) {
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "skipped" | "failed">("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<{ items: LogItem[]; agent_name?: string }>({
    queryKey: ["agent-logs", instanceId, agentId, statusFilter],
    queryFn: () => integrationsApi.agentLogs(instanceId, {
      agent_id: agentId || undefined,
      status: statusFilter || undefined,
      limit: 100,
    }).then((r) => r.data),
    enabled: !!instanceId,
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];
  const summary = useMemo(() => {
    const total = items.length;
    const ok = items.filter((i) => i.status === "success").length;
    const skipped = items.filter((i) => i.status === "skipped").length;
    const failed = items.filter((i) => i.status === "failed").length;
    return { total, ok, skipped, failed };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
            Logs de execução
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
            Últimas {items.length} execuções deste agente. Atualiza a cada 15s.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: "var(--surface-2)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
        >
          <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryPill label="Total"     value={summary.total}   color="var(--text-3)" bg="var(--surface-2)" />
        <SummaryPill label="Sucesso"   value={summary.ok}      color="var(--green)"  bg="rgba(0,212,106,0.08)" />
        <SummaryPill label="Pulado"    value={summary.skipped} color="#a5b4fc"       bg="rgba(99,102,241,0.08)" />
        <SummaryPill label="Falhou"    value={summary.failed}  color="#f87171"       bg="rgba(239,68,68,0.08)" />
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[
          { id: "", label: "Tudo" },
          { id: "success", label: "Sucesso" },
          { id: "skipped", label: "Pulado" },
          { id: "failed", label: "Falhou" },
        ].map((f) => {
          const active = statusFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id as any)}
              className="text-xs px-2.5 py-1 rounded-lg transition"
              style={{
                background: active ? "rgba(0,212,106,0.1)" : "var(--surface-2)",
                color: active ? "var(--green)" : "var(--text-2)",
                border: `1px solid ${active ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>Carregando…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl p-8 text-center"
          style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
          <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" style={{ color: "var(--text-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>
            Nenhuma execução registrada ainda
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Mensagens recebidas neste agente vão aparecer aqui em segundos.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden divide-y"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", borderColor: "var(--surface-border)" }}>
          {items.map((it) => (
            <LogRow
              key={it.id}
              item={it}
              isOpen={openId === it.id}
              onToggle={() => setOpenId(openId === it.id ? null : it.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5"
      style={{ background: bg, border: "1px solid var(--surface-border)" }}>
      <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-base font-semibold" style={{ color }}>{value}</p>
    </div>
  );
}

function LogRow({ item, isOpen, onToggle }: { item: LogItem; isOpen: boolean; onToggle: () => void }) {
  const dt = new Date(item.created_at);
  const dtLabel = dt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
  const StatusIcon =
    item.status === "success" ? CheckCircle2 :
    item.status === "skipped" ? SkipForward :
    AlertCircle;
  const statusColor =
    item.status === "success" ? "var(--green)" :
    item.status === "skipped" ? "#a5b4fc" :
    "#f87171";
  const TriggerIcon = item.trigger === "webhook" ? Webhook : Bot;

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-white/[0.02] transition flex items-center gap-3"
      >
        <span className="flex-shrink-0">
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
                  : <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />}
        </span>
        <StatusIcon className="w-4 h-4 flex-shrink-0" style={{ color: statusColor }} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <TriggerIcon className="w-3 h-3" style={{ color: "var(--text-3)" }} />
            <span className="text-xs" style={{ color: "var(--text-3)" }}>{item.trigger}</span>
            <span className="text-[10px] uppercase font-medium" style={{ color: statusColor }}>
              {item.status === "success" ? "ok" : item.status === "skipped" ? "pulado" : "falhou"}
            </span>
            {item.skip_reason && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "rgba(99,102,241,0.1)", color: "#a5b4fc" }}>
                {SKIP_REASON_LABELS[item.skip_reason] || item.skip_reason}
              </span>
            )}
          </span>
          <span className="block text-xs truncate mt-0.5" style={{ color: "var(--text-2)" }}>
            {item.input_preview || "(sem input)"}
          </span>
        </span>
        <span className="text-[10px] flex-shrink-0 text-right" style={{ color: "var(--text-3)" }}>
          <span className="block">{dtLabel}</span>
          <span>{item.duration_ms}ms</span>
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 space-y-2 text-xs">
          {item.input_preview && (
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider mb-1"
                style={{ color: "var(--text-3)" }}>Input</p>
              <pre className="whitespace-pre-wrap rounded-lg p-2.5 text-[11px] font-mono"
                style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
{item.input_preview}
              </pre>
            </div>
          )}
          {item.reply_preview && (
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider mb-1"
                style={{ color: "var(--text-3)" }}>Resposta</p>
              <pre className="whitespace-pre-wrap rounded-lg p-2.5 text-[11px] font-mono"
                style={{ background: "rgba(0,212,106,0.04)", color: "var(--text-1)", border: "1px solid rgba(0,212,106,0.2)" }}>
{item.reply_preview}
              </pre>
            </div>
          )}
          {item.error_message && (
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider mb-1"
                style={{ color: "#f87171" }}>Erro</p>
              <pre className="whitespace-pre-wrap rounded-lg p-2.5 text-[11px] font-mono"
                style={{ background: "rgba(239,68,68,0.05)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}>
{item.error_message}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
