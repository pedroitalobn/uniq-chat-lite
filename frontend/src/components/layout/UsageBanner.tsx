"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Zap, ArrowUpRight, Sparkles, Mic2, MessageSquare } from "lucide-react";
import { usageApi, type UsageView } from "@/lib/api";
import { cn } from "@/lib/utils";

// Preview clicável da sidebar — mostra a média dos consumos do ciclo
// (AI, Voz e Mensagens) com uma barra agregada que acompanha o refetch.

const CAT_COLOR: Record<string, string> = {
  ai: "#a78bfa",
  voice: "#f59e0b",
  message: "#2563EB",
};

const CAT_LABEL_SHORT: Record<string, string> = {
  ai: "AI",
  voice: "Voz",
  message: "Msg",
};

const CAT_ICON = {
  ai: Sparkles,
  voice: Mic2,
  message: MessageSquare,
};

function levelColor(pct: number) {
  if (pct >= 100) return "#ef4444";
  if (pct >= 80) return "#f59e0b";
  if (pct >= 60) return "#fbbf24";
  return "#2563EB";
}

export function UsageBanner({ collapsed }: { collapsed: boolean }) {
  const { data, isLoading } = useQuery<UsageView>({
    queryKey: ["usage", "me", "banner"],
    queryFn: () => usageApi.me().then(r => r.data),
    refetchInterval: 10_000,
    retry: 1,
    // Endpoint pode 401/403 em sessões antigas — silenciar erro pra não
    // quebrar a sidebar; quando não houver dados o banner some.
    refetchOnWindowFocus: false,
  });

  if (isLoading || !data) {
    return collapsed ? (
      <Link
        href="/usage"
        title="Consumo"
        className="mx-1.5 mb-2 flex items-center justify-center p-2 rounded-xl"
        style={{
          background: "var(--input)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-3)",
        }}
      >
        <Zap className="w-3.5 h-3.5" />
      </Link>
    ) : (
      <div className="mx-2 mb-2 rounded-xl px-3 py-2.5 animate-pulse"
        style={{
          background: "var(--input)",
          border: "1px solid var(--input)",
        }}>
        <div className="h-3 w-16 rounded mb-2" style={{ background: "var(--border-subtle)" }} />
        <div className="h-1.5 w-full rounded" style={{ background: "var(--input)" }} />
      </div>
    );
  }

  const cats = [
    { key: "ai" as const, data: data.ai },
    { key: "voice" as const, data: data.voice },
    { key: "message" as const, data: data.message },
  ];
  const averagePct = Math.min(999, Math.round(
    cats.reduce((sum, cat) => sum + cat.data.percent, 0) / cats.length
  ));
  const barColor = levelColor(averagePct);
  const isOver = averagePct >= 100;

  // ─── Collapsed: ícone + % minúscula ───────────────────────────────
  if (collapsed) {
    return (
      <Link
        href="/usage"
        title={`Consumo médio · ${averagePct}%`}
        className="mx-1.5 mb-2 flex flex-col items-center justify-center py-1.5 rounded-xl transition-all"
        style={{
          background: `linear-gradient(135deg, ${barColor}1f, ${barColor}08)`,
          border: `1px solid ${barColor}33`,
          color: barColor,
          boxShadow: isOver ? `0 0 12px ${barColor}55` : undefined,
        }}
      >
        <Zap className="w-3.5 h-3.5" />
        <span className="text-[9px] font-semibold tabular-nums mt-0.5" style={{ color: barColor }}>
          {averagePct}%
        </span>
      </Link>
    );
  }

  // ─── Expanded: preview completo ────────────────────────────────────
  const planName = data.plan?.name || "";
  return (
    <Link
      href="/usage"
      className={cn(
        "group mx-0 mt-2 block rounded-xl px-3 py-2.5",
        "transition-all duration-200"
      )}
      style={{
        background: `linear-gradient(135deg, ${barColor}14 0%, ${barColor}05 60%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid ${barColor}33`,
        boxShadow: isOver
          ? `0 4px 16px ${barColor}33, inset 0 1px 0 var(--border-default)`
          : `0 2px 10px rgba(0,0,0,0.20), inset 0 1px 0 var(--input)`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
          style={{
            background: `${barColor}22`,
            border: `1px solid ${barColor}55`,
            color: barColor,
            boxShadow: `0 0 10px ${barColor}33`,
          }}
        >
          <Zap className="w-3 h-3" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-2)" }}>
            Consumo
          </span>
          <span className="block text-[9px] leading-tight" style={{ color: "var(--text-4)" }}>
            Média em tempo real
          </span>
        </div>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: barColor }}>
          {averagePct}%
        </span>
        <ArrowUpRight
          className="w-3 h-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          style={{ color: "var(--text-4)" }}
        />
      </div>

      <div className="h-1.5 rounded-full overflow-hidden mb-2"
        style={{ background: "var(--border-subtle)" }}>
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.min(100, averagePct)}%`,
            background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`,
            boxShadow: `0 0 8px ${barColor}88`,
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {cats.map(({ key, data: c }) => {
          const pct = Math.min(100, c.percent);
          const color = CAT_COLOR[key];
          const over = c.percent >= 100;
          const Icon = CAT_ICON[key];
          return (
            <div key={key} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[9px] font-medium" style={{ color: "var(--text-3)" }}>
                  <Icon className="h-2.5 w-2.5" style={{ color }} />
                  {CAT_LABEL_SHORT[key]}
                </span>
                <span className="text-[9px] font-mono tabular-nums"
                  style={{ color: over ? "#ef4444" : "var(--text-2)" }}>
                  {c.percent}%
                </span>
              </div>
              <div className="h-1 rounded-full overflow-hidden"
                style={{ background: "var(--input)" }}>
                <div
                  className="h-full transition-[width] duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: over ? "#ef4444" : color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {planName && (
        <p className="text-[9px] mt-2 truncate" style={{ color: "var(--text-4)" }}>
          Plano <span style={{ color: "var(--text-3)" }}>{planName}</span>
          {data.plan.is_payg && " · pague conforme usa"}
        </p>
      )}
    </Link>
  );
}
