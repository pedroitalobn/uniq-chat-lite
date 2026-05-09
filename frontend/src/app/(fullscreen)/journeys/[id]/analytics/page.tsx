"use client";

// Analytics dashboard de Jornadas (Fase 5).
//
// 3 blocos:
//   1. Totals — cards com ativos / completados / pausados / erros
//   2. Funnel — barras horizontais por step com entered/completed/
//      drop-off. Visualização estilo Customer.io / Iterable: você vê
//      onde os contatos param.
//   3. Holdout lift — quando journey.holdout_percent > 0, compara
//      conversão treatment vs control e mostra lift % com sample size.
//
// Sem libs de chart pesadas — barras feitas com div estilizada.
// Performance importa porque user reabre o dashboard direto.

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  Target,
  Wand2,
  Users,
  Activity,
  ArrowDown,
} from "lucide-react";
import { journeysApi } from "@/lib/api";

export default function JourneyAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const q = useQuery({
    queryKey: ["journey-analytics", params.id],
    queryFn: () => journeysApi.analytics(params.id).then((r) => r.data),
    enabled: !!params.id,
    refetchInterval: 30_000, // refresh em tempo real
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-3)" }} />
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <AlertTriangle className="w-7 h-7" style={{ color: "#ef4444" }} />
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          Não foi possível carregar analytics.
        </p>
        <button
          onClick={() => router.push(`/journeys/${params.id}`)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
        >
          Voltar
        </button>
      </div>
    );
  }

  const data = q.data;
  return (
    <div className="flex flex-col h-screen overflow-y-auto" style={{ background: "var(--surface-base)" }}>
      {/* Header */}
      <header
        className="flex items-center gap-3 px-4 sm:px-6 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--surface-border)" }}
      >
        <button
          onClick={() => router.push(`/journeys/${params.id}`)}
          className="p-1.5 rounded-lg hover:bg-white/5 flex-shrink-0"
          style={{ color: "var(--text-3)" }}
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.05))",
            border: "1px solid rgba(0,212,106,0.30)",
            color: "var(--green)",
          }}
        >
          <Wand2 className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
            {data.name || "Jornada sem nome"}
          </p>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            Analytics · refresh automático 30s
          </p>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-5 max-w-5xl w-full mx-auto space-y-6">
        <TotalsBlock totals={data.totals} />
        {data.holdout && (data.holdout.holdout_percent > 0 || data.holdout.control_count > 0) && (
          <HoldoutBlock holdout={data.holdout} />
        )}
        <FunnelBlock funnel={data.funnel} totals={data.totals} />
      </main>
    </div>
  );
}

// ─── Totals ────────────────────────────────────────────────────────────

function TotalsBlock({ totals }: { totals: any }) {
  const cards = [
    { label: "Total",      icon: Users,        color: "#a5b4fc", value: totals.all },
    { label: "Ativas",     icon: PlayCircle,   color: "#fbbf24", value: totals.active },
    { label: "Aguardando", icon: Clock,        color: "#a78bfa", value: (totals.waiting || 0) + (totals.waiting_input || 0) },
    { label: "Completas",  icon: CheckCircle2, color: "#00d46a", value: totals.completed },
    { label: "Falharam",   icon: XCircle,      color: "#ef4444", value: totals.failed },
  ];
  return (
    <section>
      <h2
        className="text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5"
        style={{ color: "var(--text-4)" }}
      >
        <Activity className="w-3 h-3" />
        Visão geral
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="rounded-xl p-3"
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--surface-border)",
              }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <Icon className="w-3.5 h-3.5" style={{ color: c.color }} />
                <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-4)" }}>
                  {c.label}
                </span>
              </div>
              <p className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>
                {c.value.toLocaleString("pt-BR")}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Funnel ────────────────────────────────────────────────────────────

function FunnelBlock({ funnel, totals }: { funnel: any[]; totals: any }) {
  const max = useMemo(() => {
    if (!funnel.length) return 1;
    return Math.max(...funnel.map((s) => Number(s.entered) || 0), 1);
  }, [funnel]);

  if (!funnel.length) {
    return (
      <section>
        <h2
          className="text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5"
          style={{ color: "var(--text-4)" }}
        >
          <Target className="w-3 h-3" />
          Funnel por step
        </h2>
        <div
          className="rounded-2xl p-6 text-center text-xs"
          style={{
            background: "var(--surface-1)",
            border: "1px dashed var(--surface-border)",
            color: "var(--text-3)",
          }}
        >
          Sem dados ainda. Quando o journey rodar, os contadores
          aparecem aqui em tempo real (refresh 30s).
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2
        className="text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5"
        style={{ color: "var(--text-4)" }}
      >
        <Target className="w-3 h-3" />
        Funnel por step
      </h2>
      <div
        className="rounded-2xl p-3 sm:p-4 space-y-2"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--surface-border)",
        }}
      >
        {funnel.map((s, i) => {
          const entered = Number(s.entered) || 0;
          const completed = Number(s.completed) || 0;
          const errored = Number(s.errored) || 0;
          const widthPct = (entered / max) * 100;
          const dropPct = entered > 0 ? Math.max(0, ((entered - completed) / entered) * 100) : 0;
          const prev = i > 0 ? Number(funnel[i - 1].completed) || 0 : null;
          const lostFromPrev = prev != null ? Math.max(0, prev - entered) : null;
          return (
            <div key={s.step_id} className="space-y-1">
              {lostFromPrev != null && lostFromPrev > 0 && (
                <div className="flex items-center gap-1.5 pl-2 text-[10px]" style={{ color: "var(--text-4)" }}>
                  <ArrowDown className="w-2.5 h-2.5" style={{ color: "#ef4444" }} />
                  <span>{lostFromPrev.toLocaleString("pt-BR")} pararam aqui</span>
                </div>
              )}
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
                  {s.step_label || s.step_id}
                </p>
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-1 rounded"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-3)",
                  }}
                >
                  {s.step_type}
                </span>
                <span className="ml-auto text-[10px] font-mono tabular-nums" style={{ color: "var(--text-3)" }}>
                  {entered.toLocaleString("pt-BR")} entered · {completed.toLocaleString("pt-BR")} ok
                  {errored > 0 ? ` · ${errored.toLocaleString("pt-BR")} err` : ""}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${widthPct}%`,
                    background: "linear-gradient(90deg, var(--green) 0%, rgba(0,212,106,0.3) 100%)",
                  }}
                />
              </div>
              {dropPct > 0 && (
                <p className="text-[10px] tabular-nums" style={{ color: "var(--text-4)" }}>
                  {dropPct.toFixed(1)}% drop dentro do step
                </p>
              )}
              {s.last_error_message && (
                <p className="text-[10px] line-clamp-2" style={{ color: "#f87171" }}>
                  ⚠ {s.last_error_message}
                </p>
              )}
            </div>
          );
        })}
        <p className="text-[10px] pt-2" style={{ color: "var(--text-4)" }}>
          Drop = (entered − completed) ÷ entered. Drop entre steps mostra contatos que pararam
          antes do próximo. Total da jornada: {totals.all.toLocaleString("pt-BR")} execuções.
        </p>
      </div>
    </section>
  );
}

// ─── Holdout / Lift ────────────────────────────────────────────────────

function HoldoutBlock({ holdout }: { holdout: any }) {
  const treatmentRate = holdout.treatment_count > 0
    ? (holdout.treatment_completed / holdout.treatment_count) * 100
    : 0;
  const controlRate = holdout.control_count > 0
    ? (holdout.control_completed / holdout.control_count) * 100
    : 0;
  const lift = holdout.lift_pct;
  const significant = holdout.control_count > 100 && holdout.treatment_count > 100;

  return (
    <section>
      <h2
        className="text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5"
        style={{ color: "var(--text-4)" }}
      >
        <TrendingUp className="w-3 h-3" />
        Holdout / Lift {holdout.holdout_percent > 0 ? `(${holdout.holdout_percent}% controle)` : ""}
      </h2>
      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--surface-border)",
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-4)" }}>
              Tratamento (recebeu)
            </p>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>
              {treatmentRate.toFixed(1)}%
            </p>
            <p className="text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
              {holdout.treatment_completed.toLocaleString("pt-BR")} de {holdout.treatment_count.toLocaleString("pt-BR")} completaram
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-4)" }}>
              Controle (não recebeu)
            </p>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>
              {controlRate.toFixed(1)}%
            </p>
            <p className="text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
              {holdout.control_completed.toLocaleString("pt-BR")} de {holdout.control_count.toLocaleString("pt-BR")} completaram
            </p>
          </div>
          <div
            className="rounded-lg p-3"
            style={{
              background: lift != null && lift > 0
                ? "rgba(0,212,106,0.06)"
                : lift != null && lift < 0
                ? "rgba(239,68,68,0.06)"
                : "var(--surface-2)",
              border: `1px solid ${
                lift != null && lift > 0
                  ? "rgba(0,212,106,0.20)"
                  : lift != null && lift < 0
                  ? "rgba(239,68,68,0.20)"
                  : "var(--surface-border)"
              }`,
            }}
          >
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-4)" }}>
              Lift
            </p>
            {lift == null ? (
              <p className="text-xs" style={{ color: "var(--text-3)" }}>
                Amostra insuficiente. Precisa de pelo menos 10 contatos no controle e 10 no
                tratamento com conversão maior que zero.
              </p>
            ) : (
              <>
                <p
                  className="text-2xl font-semibold tabular-nums"
                  style={{
                    color: lift > 0 ? "var(--green)" : lift < 0 ? "#ef4444" : "var(--text-2)",
                  }}
                >
                  {lift > 0 ? "+" : ""}
                  {lift.toFixed(1)}%
                </p>
                <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                  {lift > 0
                    ? "Tratamento converte mais que controle"
                    : lift < 0
                    ? "Tratamento está pior que controle (revisar copy)"
                    : "Sem diferença observável"}
                </p>
                {!significant && (
                  <p className="text-[9px] mt-1" style={{ color: "#fbbf24" }}>
                    ⚠ baixa significância — &lt; 100 amostras
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {holdout.goal_event && (
          <p className="text-[10px] mt-3 pt-2" style={{ color: "var(--text-4)", borderTop: "1px solid var(--surface-border)" }}>
            Meta: <code style={{ color: "var(--text-3)" }}>{holdout.goal_event}</code> ·
            {" "}{(holdout.goal_count ?? 0).toLocaleString("pt-BR")} conversões totais
          </p>
        )}
      </div>
    </section>
  );
}
