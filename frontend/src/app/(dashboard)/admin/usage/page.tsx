"use client";

// /admin/usage — dashboard global de consumo (super admin).
//
// Mostra:
//   • Totais agregados últimos N dias: créditos cobrados (revenue),
//     custo bruto  Qchat (USD micros), margem efetiva, qtd de events,
//     créditos em overage.
//   • Breakdown por categoria (AI/Voice/Mensagens/Proxy).
//   • Por provider — quanto a  Qchat paga a cada um (OpenAI, Anthropic,
//     ElevenLabs, etc.) — pra acompanhar custo total e renegociar.
//   • Top 25 users por consumo.
//   • Timeseries de créditos × cost_usd_micro pra ver evolução.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, DollarSign, TrendingUp, Users, Zap, AlertTriangle } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useSession } from "next-auth/react";
import { adminUsageApi, type GlobalUsageData } from "@/lib/api";
import { ModuleHeader } from "@/components/layout/ModuleHeader";

const CATEGORY_LABEL: Record<string, string> = {
  ai: "QChat AI",
  voice: "Qchat Voice",
  message: "Mensagens",
  proxy: "Proxy",
  other: "Outros",
};

export default function AdminUsagePage() {
  const { data: session } = useSession();
  const [days, setDays] = useState(30);
  const isSuperAdmin = (session?.user as { role?: string })?.role === "super_admin";

  const { data, isLoading } = useQuery<GlobalUsageData>({
    queryKey: ["admin", "usage-global", days],
    queryFn: () => adminUsageApi.global(days).then(r => r.data),
    enabled: isSuperAdmin,
    refetchInterval: 60_000,
  });

  if (!isSuperAdmin) {
    return (
      <div className="px-6 py-12 text-center" style={{ color: "var(--text-3)" }}>
        Restrito a super admins.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="px-6 py-12 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-3)" }} />
      </div>
    );
  }

  const totalRevenueR$ = (data.totals.total_credits / 1000).toFixed(2);
  const totalCostUSD = (data.totals.total_cost_usd_micro / 1_000_000).toFixed(4);
  const marginUSD = (data.totals.total_credits / 1000 - data.totals.total_cost_usd_micro / 1_000_000).toFixed(2);

  const tsData = data.timeseries.map(t => ({
    date: new Date(t.day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    Créditos: t.credits,
    "Custo USD": Math.round(t.cost_usd_micro / 1000) / 1000, // em USD com 3 casas
  }));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto space-y-6">
      <ModuleHeader title="Consumo Global" subtitle="Dashboard administrativo · Qchat Credits" icon={Zap} />

      {/* Period filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: "var(--text-3)" }}>Período:</span>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
            style={days === d
              ? { background: "rgba(37, 99, 235,0.18)", color: "var(--green)", border: "1px solid rgba(37, 99, 235,0.35)" }
              : { background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }
            }
          >Últimos {d}d</button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Créditos cobrados" value={data.totals.total_credits.toLocaleString("pt-BR")} icon={Zap} color="var(--green)" />
        <KPI label="Custo bruto  Qchat (USD)" value={`$${totalCostUSD}`} icon={DollarSign} color="#60a5fa" />
        <KPI label="Receita estimada" value={`R$ ${totalRevenueR$}`} icon={TrendingUp} color="#a78bfa"
          hint="1k créditos = R$ 5,00 (config padrão)" />
        <KPI label="Margem (USD)" value={`$${marginUSD}`} icon={TrendingUp} color="#f59e0b" />
      </div>

      {data.totals.overage_credits > 0 && (
        <div
          className="rounded-2xl p-3 flex items-start gap-2"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.30)" }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
          <div className="text-xs">
            <p className="font-medium" style={{ color: "#f59e0b" }}>Overage no período</p>
            <p style={{ color: "var(--text-2)" }}>
              {data.totals.overage_credits.toLocaleString("pt-BR")} créditos consumidos em overage —
              serão faturados aos users nos próximos invoices (Phase 4).
            </p>
          </div>
        </div>
      )}

      {/* Timeseries */}
      <div className="rounded-2xl p-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>
          Consumo agregado · {days} dias
        </h3>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tsData}>
              <defs>
                <linearGradient id="g-credits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--input)" vertical={false} />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "hsl(240 18% 6.5%)", border: "1px solid var(--surface-border)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "var(--text-2)" }}
              />
              <Area type="monotone" dataKey="Créditos" stroke="#2563EB" strokeWidth={2} fill="url(#g-credits)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By category */}
      <div className="rounded-2xl p-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>Por categoria</h3>
        <div className="space-y-2">
          {data.by_category.length === 0 ? (
            <p className="text-xs py-4 text-center" style={{ color: "var(--text-3)" }}>
              Sem consumo no período.
            </p>
          ) : data.by_category.map(c => (
            <div key={c.category} className="flex items-center gap-3 py-2">
              <span className="text-xs font-medium w-32 flex-shrink-0" style={{ color: "var(--text-1)" }}>
                {CATEGORY_LABEL[c.category] ?? c.category}
              </span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--input)" }}>
                <div className="h-full"
                  style={{
                    width: `${Math.min(100, (c.credits / Math.max(1, data.totals.total_credits)) * 100)}%`,
                    background: "var(--green)",
                  }}
                />
              </div>
              <span className="text-xs font-mono tabular-nums w-24 text-right" style={{ color: "var(--text-1)" }}>
                {c.credits.toLocaleString("pt-BR")}
              </span>
              <span className="text-[10px] font-mono w-20 text-right" style={{ color: "var(--text-3)" }}>
                ${(c.cost_usd_micro / 1_000_000).toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* By provider */}
      <div className="rounded-2xl p-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>
          Custo  Qchat por provider
        </h3>
        {data.by_provider.length === 0 ? (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-3)" }}>
            Sem consumo no período.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {data.by_provider.slice(0, 12).map((p, i) => (
              <div key={`${p.provider}-${p.category}-${i}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{p.provider}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                  {CATEGORY_LABEL[p.category] ?? p.category}
                </span>
                <span className="ml-auto text-xs font-mono tabular-nums" style={{ color: "var(--text-1)" }}>
                  ${(p.cost_usd_micro / 1_000_000).toFixed(3)}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>
                  ({p.event_count})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top users */}
      <div className="rounded-2xl p-4"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4" style={{ color: "var(--text-2)" }} />
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Top users por consumo</h3>
        </div>
        {data.top_users.length === 0 ? (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-3)" }}>
            Sem usuários consumindo.
          </p>
        ) : (
          <div className="rounded-lg overflow-hidden"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            {data.top_users.map((u, i) => (
              <div key={u.user_id}
                className="flex items-center gap-3 px-3 py-2"
                style={i > 0 ? { borderTop: "1px solid var(--surface-border)" } : undefined}>
                <span className="text-[10px] font-mono w-6 tabular-nums" style={{ color: "var(--text-3)" }}>
                  #{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                    {u.user_name || "—"}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                    {u.user_email}
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums" style={{ color: "var(--text-1)" }}>
                  {u.credits.toLocaleString("pt-BR")} cr
                </span>
                <span className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>
                  ${(u.cost_usd_micro / 1_000_000).toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, icon: Icon, color, hint }: {
  label: string;
  value: string;
  icon: any;
  color: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl p-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--text-3)" }}>
          {label}
        </span>
      </div>
      <p className="text-lg font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>{value}</p>
      {hint && <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>{hint}</p>}
    </div>
  );
}
