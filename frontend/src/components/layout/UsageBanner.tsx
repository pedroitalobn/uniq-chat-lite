"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Zap, ArrowUpRight } from "lucide-react";
import { usageApi, type UsageView } from "@/lib/api";
import { cn } from "@/lib/utils";

// Banner clicável da sidebar — mostra um resumo da quota do ciclo: barra
// de progresso única (categoria mais crítica) + 3 mini-barras por
// categoria (AI / Voice / Mensagens). Clicar leva pra /usage.
//
// Cor da barra principal acompanha o nível: <60% verde, 60-80% laranja,
// >=80% vermelho. Quando a sidebar está collapsed, vira só um ícone
// com a porcentagem do top embaixo.

const CAT_COLOR: Record<string, string> = {
  ai: "#a78bfa",
  voice: "#f59e0b",
  message: "#00d46a",
};

const CAT_LABEL_SHORT: Record<string, string> = {
  ai: "AI",
  voice: "Voz",
  message: "Msg",
};

function levelColor(pct: number) {
  if (pct >= 100) return "#ef4444";
  if (pct >= 80) return "#f59e0b";
  if (pct >= 60) return "#fbbf24";
  return "#00d46a";
}

export function UsageBanner({ collapsed }: { collapsed: boolean }) {
  const { data, isLoading } = useQuery<UsageView>({
    queryKey: ["usage", "me", "banner"],
    queryFn: () => usageApi.me().then(r => r.data),
    refetchInterval: 60_000,
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
  const top = [...cats].sort((a, b) => b.data.percent - a.data.percent)[0];
  const topPct = Math.min(999, top.data.percent);
  const barColor = levelColor(topPct);
  const isOver = top.data.percent >= 100;

  // ─── Collapsed: ícone + % minúscula ───────────────────────────────
  if (collapsed) {
    return (
      <Link
        href="/usage"
        title={`Consumo · ${topPct}% (${CAT_LABEL_SHORT[top.key]})`}
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
          {topPct}%
        </span>
      </Link>
    );
  }

  // ─── Expanded: banner completo ────────────────────────────────────
  const planName = data.plan?.name || "";
  return (
    <Link
      href="/usage"
      className={cn(
        "group mx-2 mb-2 block rounded-xl px-3 py-2.5",
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
      {/* Header */}
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
        <span className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-2)" }}>
          Consumo
        </span>
        <span className="ml-auto text-[11px] font-bold tabular-nums" style={{ color: barColor }}>
          {topPct}%
        </span>
        <ArrowUpRight
          className="w-3 h-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          style={{ color: "var(--text-4)" }}
        />
      </div>

      {/* Barra principal — categoria mais crítica */}
      <div className="h-1.5 rounded-full overflow-hidden mb-2"
        style={{ background: "var(--border-subtle)" }}>
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.min(100, topPct)}%`,
            background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`,
            boxShadow: `0 0 8px ${barColor}88`,
          }}
        />
      </div>

      {/* Mini barras por categoria */}
      <div className="grid grid-cols-3 gap-1.5">
        {cats.map(({ key, data: c }) => {
          const pct = Math.min(100, c.percent);
          const color = CAT_COLOR[key];
          const over = c.percent >= 100;
          return (
            <div key={key} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[9px] font-medium" style={{ color: "var(--text-3)" }}>
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

      {/* Footer — plano */}
      {planName && (
        <p className="text-[9px] mt-2 truncate" style={{ color: "var(--text-4)" }}>
          Plano <span style={{ color: "var(--text-3)" }}>{planName}</span>
          {data.plan.is_payg && " · pague conforme usa"}
        </p>
      )}
    </Link>
  );
}
