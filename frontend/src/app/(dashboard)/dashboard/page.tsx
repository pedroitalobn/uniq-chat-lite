"use client";

import { useQuery } from "@tanstack/react-query";
import { adminApi, instancesApi } from "@/lib/api";
import { useSession } from "next-auth/react";
import {
  Smartphone,
  MessageSquare,
  Activity,
  Wifi,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Instance } from "@/types";
import { cn } from "@/lib/utils";

// Mock chart data - in production pull from a /stats/daily endpoint
// Values are fixed to avoid SSR/client hydration mismatch (no Math.random at module scope)
const MOCK_MSGS   = [120, 340, 210, 480, 90, 310, 175];
const MOCK_INSTS  = [1, 2, 1, 3, 1, 2, 2];
const WEEKDAYS    = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

type StatColor = "green" | "blue" | "amber" | "violet";

const statStyles: Record<StatColor, { icon: string; bg: string; border: string }> = {
  green:  { icon: "#00d46a", bg: "rgba(0,212,106,0.08)",  border: "rgba(0,212,106,0.15)" },
  blue:   { icon: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.15)" },
  amber:  { icon: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.15)" },
  violet: { icon: "#a78bfa", bg: "rgba(167,139,250,0.08)",border: "rgba(167,139,250,0.15)" },
};

function StatCard({ label, value, icon: Icon, sub, color = "green" }: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  sub?: string;
  color?: StatColor;
}) {
  const s = statStyles[color];
  return (
    <div
      className="rounded-2xl p-5 animate-fade-in-up"
      style={{
        background: "hsl(240 18% 6%)",
        border: "1px solid hsl(240 12% 13%)",
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
        style={{ background: s.bg, border: `1px solid ${s.border}` }}
      >
        <Icon className="w-4 h-4" style={{ color: s.icon }} />
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
        {value}
      </p>
      <p className="text-sm mt-1" style={{ color: "hsl(240 8% 52%)" }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{sub}</p>}
    </div>
  );
}

const instanceStatusStyles: Record<string, { dot: string; label: string; labelColor: string; bg: string }> = {
  connected:    { dot: "#00d46a", label: "conectado",    labelColor: "#00d46a",  bg: "rgba(0,212,106,0.08)" },
  connecting:   { dot: "#fbbf24", label: "conectando",   labelColor: "#fbbf24",  bg: "rgba(251,191,36,0.08)" },
  disconnected: { dot: "#64748b", label: "desconectado", labelColor: "#64748b",  bg: "rgba(100,116,139,0.08)" },
  banned:       { dot: "#ef4444", label: "banido",       labelColor: "#ef4444",  bg: "rgba(239,68,68,0.08)" },
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  // Fixed labels — no Date/random so SSR and client always match
  const chartData = MOCK_MSGS.map((mensagens, i) => ({
    date: WEEKDAYS[i],
    mensagens,
    instâncias: MOCK_INSTS[i],
  }));

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.getStats().then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ["instances"],
    queryFn: () => instancesApi.list().then((r) => r.data),
  });

  const connected = instances.filter((i) => i.status === "connected").length;
  const total = instances.length;

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
          Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
          Bem-vindo de volta,{" "}
          <span style={{ color: "hsl(240 8% 70%)" }}>{session?.user?.name}</span>
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Instâncias totais"
          value={isAdmin ? stats?.instances?.total ?? total : total}
          icon={Smartphone}
          sub={connected > 0 ? `${connected} ativa${connected !== 1 ? "s" : ""}` : undefined}
          color="green"
        />
        <StatCard
          label="Conectadas agora"
          value={isAdmin ? stats?.instances?.connected ?? connected : connected}
          icon={Wifi}
          color="blue"
        />
        <StatCard
          label="Mensagens hoje"
          value={isAdmin ? stats?.messages?.today ?? 0 : "—"}
          icon={MessageSquare}
          color="amber"
        />
        <StatCard
          label="Usuários ativos"
          value={isAdmin ? stats?.users?.active ?? 1 : 1}
          icon={Activity}
          color="violet"
        />
      </div>

      {/* Chart */}
      <div
        className="rounded-2xl p-5 animate-fade-in-up delay-100"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>
            Atividade de mensagens
          </h2>
          <span className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>últimos 7 dias</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00d46a" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#00d46a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#52526a", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#52526a", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: "hsl(240 18% 8%)",
                border: "1px solid hsl(240 12% 16%)",
                borderRadius: 10,
                fontSize: 12,
                color: "hsl(240 15% 80%)",
              }}
            />
            <Area type="monotone" dataKey="mensagens" stroke="#00d46a" strokeWidth={1.5} fill="url(#colorMsg)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent instances */}
      <div
        className="rounded-2xl p-5 animate-fade-in-up delay-200"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>
            Instâncias recentes
          </h2>
          <a href="/instances" className="text-xs transition-colors"
            style={{ color: "var(--green)" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            Ver todas →
          </a>
        </div>

        {instances.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "hsl(240 8% 38%)" }}>
            Nenhuma instância criada ainda.
          </p>
        ) : (
          <div className="space-y-1">
            {instances.slice(0, 5).map((inst) => {
              const s = instanceStatusStyles[inst.status] ?? instanceStatusStyles.disconnected;
              return (
                <div
                  key={inst.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl transition-colors"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: "hsl(240 8% 80%)" }}>{inst.name}</p>
                      <p className="text-xs font-mono" style={{ color: "hsl(240 8% 38%)" }}>
                        {inst.phone_number || "—"}
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: s.bg, color: s.labelColor }}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
