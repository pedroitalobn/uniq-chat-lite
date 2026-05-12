"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X, ArrowRight, Zap, Sparkles, Mic2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { usageApi, type UsageView } from "@/lib/api";

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
  const { data } = useQuery<UsageView>({
    queryKey: ["usage", "me", "pill"],
    queryFn: () => usageApi.me().then((r) => r.data),
    refetchInterval: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

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

  const pill = <UsagePill data={data} />;

  if (!warning || dismissed) {
    return pill;
  }

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
    <>
      {pill}
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
          style={{ background: fg, color: "var(--text-1)" }}
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
    </>
  );
}

function UsagePill({ data }: { data?: UsageView }) {
  const cats = data
    ? [
        { key: "ai", label: "AI", icon: Sparkles, color: "#a78bfa", percent: data.ai.percent },
        { key: "voice", label: "Voz", icon: Mic2, color: "#f59e0b", percent: data.voice.percent },
        { key: "message", label: "Msg", icon: MessageSquare, color: "#00d46a", percent: data.message.percent },
      ]
    : [];
  const top = cats.length > 0 ? [...cats].sort((a, b) => b.percent - a.percent)[0] : null;
  const pct = Math.min(999, top?.percent ?? 0);
  const tone = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#00d46a";

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[90] block sm:right-4">
      <Link
        href="/usage"
        title="Ver consumo"
        className="pointer-events-auto group inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-all hover:-translate-y-0.5"
        style={{
          background: "color-mix(in srgb, var(--surface-1) 88%, transparent)",
          border: `1px solid ${tone}55`,
          color: "var(--text-1)",
          boxShadow: `0 10px 30px rgba(0,0,0,0.28), 0 0 22px ${tone}22, inset 0 1px 0 var(--border-default)`,
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
        }}
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: `${tone}22`, color: tone, border: `1px solid ${tone}44` }}
        >
          <Zap className="h-3.5 w-3.5" />
        </span>
        <span className="whitespace-nowrap">Consumo</span>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: tone }}>
          {data ? `${pct}%` : "..."}
        </span>
        <span className="hidden items-center gap-1 md:flex">
          {cats.map((cat) => {
            const Icon = cat.icon;
            return (
              <span
                key={cat.key}
                className="flex h-5 items-center gap-1 rounded-full px-1.5"
                style={{ background: `${cat.color}14`, color: cat.color }}
              >
                <Icon className="h-3 w-3" />
                <span className="font-mono text-[9px] tabular-nums">{Math.min(999, cat.percent)}%</span>
              </span>
            );
          })}
        </span>
        <ArrowRight className="h-3.5 w-3.5 opacity-50 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
