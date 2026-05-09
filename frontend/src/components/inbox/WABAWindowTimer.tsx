"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";

// WABAWindowTimer — chip de countdown da janela de 24h da Cloud API
// da Meta. Aparece SÓ pra conversas WABA (e Instagram, que tem a
// mesma regra) com last_customer_msg_at conhecido.
//
// Estados visuais (calculado do tempo restante):
//
//   • >= 6h  → cinza neutro, só informativo
//   • 1h-6h  → amarelo (atenção, prepare resposta)
//   • <  1h  → vermelho + PISCA (urgente, vai virar template-only)
//   • <= 0   → "fechada" estática (sem countdown)
//
// Atualiza a cada segundo via setInterval. Em janelas longas (>1h)
// baixa pra 30s pra reduzir re-render.

export function WABAWindowTimer({
  expiresAt,
  windowOpen,
  channel,
}: {
  expiresAt?: string;
  windowOpen: boolean;
  channel?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Tick adaptativo: 1s quando próximo do fim (granularidade pra
  // user perceber); 30s quando longe (só pra atualizar minutos).
  useEffect(() => {
    const remaining = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0;
    const interval = remaining > 60 * 60 * 1000 ? 30_000 : 1_000;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [expiresAt]);

  const state = useMemo(() => {
    if (!expiresAt) return null;
    const expiry = new Date(expiresAt).getTime();
    if (isNaN(expiry)) return null;
    const remaining = expiry - now;
    return {
      remaining,
      expired: remaining <= 0,
      urgent: remaining > 0 && remaining < 60 * 60 * 1000, // < 1h
      warn: remaining >= 60 * 60 * 1000 && remaining < 6 * 60 * 60 * 1000, // 1-6h
    };
  }, [expiresAt, now]);

  // Só exibe pra canais que têm janela 24h. WABA + Instagram.
  const showsWindow = channel === "waba" || channel === "instagram";
  if (!showsWindow) return null;

  // Sem expiry mas window_open=true (caso raro: contato nunca mandou
  // mensagem, journey iniciou com template ou enrollment) → não
  // mostra timer, comportamento conservador.
  if (!expiresAt) {
    if (!windowOpen) {
      return <ClosedChip />;
    }
    return null;
  }

  if (!state) return null;
  if (state.expired) return <ClosedChip />;

  const formatted = formatRemaining(state.remaining);
  const color = state.urgent ? "#ef4444" : state.warn ? "#fbbf24" : "var(--text-3)";
  const bg = state.urgent
    ? "rgba(239,68,68,0.12)"
    : state.warn
    ? "rgba(251,191,36,0.10)"
    : "var(--surface-2)";
  const border = state.urgent
    ? "rgba(239,68,68,0.30)"
    : state.warn
    ? "rgba(251,191,36,0.25)"
    : "var(--surface-border)";

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
        state.urgent ? "uniq-blink" : ""
      }`}
      style={{ background: bg, color, border: `1px solid ${border}` }}
      title={`Janela 24h da Meta fecha em ${formatted}. Depois disso só template aprovado.`}
    >
      <Clock className="w-2.5 h-2.5" />
      {formatted}
    </span>
  );
}

function ClosedChip() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full"
      style={{
        background: "rgba(239,68,68,0.08)",
        color: "#f87171",
        border: "1px solid rgba(239,68,68,0.25)",
      }}
      title="Janela 24h da Meta fechada. Use template HSM aprovado pra reabrir."
    >
      <AlertTriangle className="w-2.5 h-2.5" />
      janela fechada
    </span>
  );
}

// formatRemaining — devolve formato compacto:
//   23h 45m  → mais de 1h
//   45m 23s  → menos de 1h
//   3s       → últimos segundos
function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
