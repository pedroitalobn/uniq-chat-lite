"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, RefreshCw, RotateCw, Loader2, Filter, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { webhooksApi, globalWebhooksApi } from "@/lib/api";

interface Delivery {
  id: string;
  webhook_id?: string;
  global_webhook_id?: string;
  event: string;
  url: string;
  payload: string;
  status: "success" | "failed" | "pending" | "skipped";
  status_code: number;
  latency_ms: number;
  response_body: string;
  error?: string;
  retry_count: number;
  created_at: string;
}

type Scope = { kind: "global"; webhookId: string }
            | { kind: "instance"; instanceId: string; webhookId: string };

interface Props {
  scope: Scope;
  webhookName: string;
  onClose: () => void;
}

/**
 * Dialog modal que mostra os logs de delivery de um webhook.
 * Suporta ambos: webhook global (workspace) e webhook de instância.
 *
 * Features:
 *  - Lista paginada com status (success/failed) + filtros (status, event)
 *  - Cada item expansível com payload + response body
 *  - Botão de retry inline (chama endpoint /retry)
 *  - Auto-refresh com refetchInterval pra acompanhar disparos novos
 */
export function WebhookDeliveriesDialog({ scope, webhookName, onClose }: Props) {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterEvent, setFilterEvent] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryKey = useMemo(() => {
    if (scope.kind === "instance") {
      return ["webhook-deliveries", "instance", scope.instanceId, scope.webhookId, filterStatus, filterEvent];
    }
    return ["webhook-deliveries", "global", scope.webhookId, filterStatus, filterEvent];
  }, [scope, filterStatus, filterEvent]);

  const { data, isLoading, refetch, isRefetching } = useQuery<{ data: Delivery[]; total: number }>({
    queryKey,
    queryFn: () => {
      const params = {
        status: filterStatus || undefined,
        event: filterEvent || undefined,
        limit: 100,
      };
      if (scope.kind === "instance") {
        return webhooksApi.deliveries(scope.instanceId, scope.webhookId, params).then(r => r.data);
      }
      return globalWebhooksApi.deliveries(scope.webhookId, params).then(r => r.data);
    },
    refetchInterval: 5000,
  });

  const retryMut = useMutation({
    mutationFn: (deliveryId: string) => {
      if (scope.kind === "instance") {
        return webhooksApi.retry(scope.instanceId, scope.webhookId, deliveryId);
      }
      return globalWebhooksApi.retry(scope.webhookId, deliveryId);
    },
    onSuccess: (res) => {
      const d = res.data as { success: boolean; status: number; latency_ms: number; error?: string };
      if (d.success) {
        toast.success(`Retry OK · ${d.status} · ${d.latency_ms}ms`);
      } else {
        toast.error(`Retry falhou · ${d.status || "—"} · ${d.error || "erro"}`);
      }
      qc.invalidateQueries({ queryKey });
    },
    onError: () => toast.error("Erro ao reenviar"),
  });

  const deliveries = data?.data ?? [];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "var(--surface-overlay)" }} onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-2xl flex flex-col max-h-[92vh]"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--surface-border)" }}>
          <div>
            <h3 className="text-base font-medium" style={{ color: "var(--text-1)" }}>Logs de entrega</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {webhookName} · {data?.total ?? 0} entrega(s)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="p-2 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: "var(--text-2)" }}
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--text-3)" }}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-6 py-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
          <Filter className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-md outline-none"
            style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
          >
            <option value="">Todos status</option>
            <option value="success">Sucesso (2xx)</option>
            <option value="failed">Falhou</option>
            <option value="pending">Pendente</option>
            <option value="skipped">Ignorado</option>
          </select>
          <input
            value={filterEvent}
            onChange={e => setFilterEvent(e.target.value)}
            placeholder="Filtrar por evento (ex: message.received)"
            className="flex-1 text-xs px-2.5 py-1.5 rounded-md outline-none font-mono"
            style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
          />
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="py-12 text-center flex items-center justify-center gap-2" style={{ color: "var(--text-3)" }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
            </div>
          ) : deliveries.length === 0 ? (
            <div className="py-12 text-center text-sm" style={{ color: "var(--text-3)" }}>
              Nenhuma entrega registrada {filterStatus || filterEvent ? "com esses filtros" : "ainda"}.
            </div>
          ) : (
            <div className="space-y-1.5">
              {deliveries.map(d => (
                <DeliveryRow
                  key={d.id}
                  delivery={d}
                  expanded={expandedId === d.id}
                  onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  onRetry={() => retryMut.mutate(d.id)}
                  retrying={retryMut.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeliveryRow({
  delivery: d,
  expanded,
  onToggle,
  onRetry,
  retrying,
}: {
  delivery: Delivery;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const isSuccess = d.status === "success";
  const isFailed = d.status === "failed";
  const statusColor = isSuccess ? "#22c55e" : isFailed ? "#ef4444" : "#f59e0b";
  const Icon = isSuccess ? CheckCircle2 : isFailed ? XCircle : Clock;

  const time = new Date(d.created_at).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/5"
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: statusColor }} />
        <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: statusColor, minWidth: "40px" }}>
          {d.status_code || "—"}
        </span>
        <code className="text-xs font-mono flex-1 truncate" style={{ color: "var(--text-1)" }}>
          {d.event}
        </code>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: "var(--text-3)" }}>
          {d.latency_ms}ms
        </span>
        {d.retry_count > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: "rgba(139,92,246,0.15)", color: "#8b5cf6" }}>
            R{d.retry_count}
          </span>
        )}
        <span className="text-[10px] tabular-nums shrink-0 hidden sm:inline" style={{ color: "var(--text-3)" }}>
          {time}
        </span>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-3)" }} />
          : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-3)" }} />}
      </button>

      {expanded && (
        <div className="border-t px-3 py-3 space-y-3" style={{ borderColor: "var(--surface-border)", background: "var(--surface-1)" }}>
          {d.error && (
            <div>
              <p className="text-[10px] uppercase font-medium mb-1" style={{ color: "var(--text-3)" }}>Erro de transporte</p>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all p-2 rounded" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
                {d.error}
              </pre>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase font-medium mb-1" style={{ color: "var(--text-3)" }}>Payload enviado</p>
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all p-2 rounded max-h-48 overflow-auto" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              {prettifyJSON(d.payload)}
            </pre>
          </div>

          {d.response_body && (
            <div>
              <p className="text-[10px] uppercase font-medium mb-1" style={{ color: "var(--text-3)" }}>Response body</p>
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-all p-2 rounded max-h-48 overflow-auto" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                {d.response_body}
              </pre>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
              ID: <code>{d.id}</code>
            </span>
            <button
              onClick={onRetry}
              disabled={retrying}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors disabled:opacity-40"
              style={{ background: "rgba(139,92,246,0.15)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,0.3)" }}
            >
              {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
              Reenviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function prettifyJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
