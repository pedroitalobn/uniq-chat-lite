"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * UsageBanner — banner discreto no topo do dashboard quando o user
 * atinge 80%/100% do MaxMessagesPerDay. Lê via WS event "usage.threshold"
 * disparado pelo backend quando o counter cruza o limite.
 *
 * Persistência: dismiss volta a aparecer no dia seguinte (localStorage
 * por dia). Em 100% (block) não pode dismissar — só upgrade libera.
 */
export function UsageBanner() {
  const [warning, setWarning] = useState<{ percent: number; current: number; limit: number; type: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Subscribe ao WS event usage.threshold (via /ws/events — caminho
  // sem /v1/ pra bater com o que o backend registra em router.go).
  useEffect(() => {
    const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || "wss://api.uniq.chat") + "/ws/events";
    let ws: WebSocket | null = null;
    let mounted = true;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "usage.threshold" && mounted) {
            setWarning({
              percent: msg.payload.percent,
              current: msg.payload.current,
              limit: msg.payload.limit,
              type: msg.payload.type,
            });
            setDismissed(false);
          }
        } catch {
          // ignore parse errors
        }
      };
    } catch {
      // WS não conectou — fallback usa só auth/me. Não crítico.
    }
    return () => {
      mounted = false;
      ws?.close();
    };
  }, []);

  // Reset diário do dismiss
  useEffect(() => {
    const todayKey = "uniq:usage-banner-dismissed:" + new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(todayKey) === "1") setDismissed(true);
  }, []);

  if (!warning || dismissed) return null;

  const isBlocked = warning.percent >= 100;
  const bg = isBlocked ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.10)";
  const border = isBlocked ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.35)";
  const fg = isBlocked ? "#ef4444" : "#f59e0b";

  const handleDismiss = () => {
    if (isBlocked) return; // não pode dismissar quando bloqueado
    setDismissed(true);
    const todayKey = "uniq:usage-banner-dismissed:" + new Date().toISOString().slice(0, 10);
    localStorage.setItem(todayKey, "1");
  };

  const label = warning.type === "messages_sent" ? "mensagens" : warning.type;

  return (
    <div
      className="px-4 py-2 flex items-center gap-3 border-b"
      style={{ background: bg, borderColor: border }}
    >
      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: fg }} />
      <div className="flex-1 text-xs sm:text-sm" style={{ color: fg }}>
        {isBlocked ? (
          <>
            <strong>Limite diário atingido:</strong>{" "}
            {warning.current.toLocaleString("pt-BR")}/{warning.limit.toLocaleString("pt-BR")} {label}.
            Envios bloqueados até amanhã ou faça upgrade.
          </>
        ) : (
          <>
            <strong>{warning.percent}% do limite usado:</strong>{" "}
            {warning.current.toLocaleString("pt-BR")}/{warning.limit.toLocaleString("pt-BR")} {label} hoje.
            Faça upgrade pra evitar interrupção.
          </>
        )}
      </div>
      <Link
        href="/settings?section=billing"
        className="hidden sm:flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full transition-opacity hover:opacity-80"
        style={{ background: fg, color: "#fff" }}
      >
        Ver planos <ArrowRight className="w-3 h-3" />
      </Link>
      {!isBlocked && (
        <button
          onClick={handleDismiss}
          className="p-1 rounded transition-opacity hover:opacity-70"
          style={{ color: fg }}
          aria-label="Dispensar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
