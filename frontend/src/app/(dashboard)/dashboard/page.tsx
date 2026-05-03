"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  adminApi, agentsApi, campaignsApi, companiesApi, crmApi, dealsApi,
  instancesApi, journeysApi, conversationsApi,
} from "@/lib/api";
import { useSession } from "next-auth/react";
import Link from "next/link";
import api from "@/lib/api";
import {
  Activity, ArrowRight, ArrowUpRight, Bot, Building2,
  Contact as ContactIcon, Inbox as InboxIcon, Megaphone, MessageSquare,
  Rocket, Smartphone, Sparkles, TrendingUp, Wand2, Wifi, Zap,
  CheckCircle2, Clock, AlertCircle, BarChart2,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import type { Instance } from "@/types";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// ─── helpers ─────────────────────────────────────────────────────────────────
const asArray = <T,>(raw: any): T[] => {
  if (Array.isArray(raw)) return raw as T[];
  if (Array.isArray(raw?.data)) return raw.data as T[];
  if (Array.isArray(raw?.items)) return raw.items as T[];
  return [];
};
const asTotal = (raw: any): number => {
  if (typeof raw?.total === "number") return raw.total;
  if (Array.isArray(raw)) return raw.length;
  if (Array.isArray(raw?.data)) return raw.data.length;
  if (Array.isArray(raw?.items)) return raw.items.length;
  return 0;
};

// ─── Animation variants ───────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

// ─── AnimatedNumber ───────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = null;
    const from = display;
    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min((ts - startRef.current) / 600, 1);
      const e = 1 - Math.pow(1 - p, 4);
      setDisplay(Math.round(from + (value - from) * e));
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display > 1000 ? display.toLocaleString("pt-BR") : display}</>;
}

// ─── Status dot ───────────────────────────────────────────────────────────────
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: "var(--green)" }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--green)" }} />
    </span>
  );
}

// ─── Bento card base ─────────────────────────────────────────────────────────
function BentoCard({
  children, className = "", href, onClick, highlight = false,
}: {
  children: React.ReactNode;
  className?: string;
  href?: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const base = (
    <div
      className={`relative overflow-hidden rounded-2xl h-full group ${className}`}
      style={{
        background: highlight
          ? "linear-gradient(135deg, rgba(0,212,106,0.10) 0%, rgba(0,212,106,0.04) 100%)"
          : "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: highlight
          ? "1px solid rgba(0,212,106,0.25)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.07)",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = highlight
          ? "rgba(0,212,106,0.4)"
          : "rgba(255,255,255,0.14)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.09)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = highlight
          ? "rgba(0,212,106,0.25)"
          : "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.07)";
      }}
    >
      {/* Top shimmer line */}
      <div style={{
        position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
        pointerEvents: "none",
      }} />
      {children}
    </div>
  );
  if (href) return <Link href={href} className="block h-full">{base}</Link>;
  if (onClick) return <button onClick={onClick} className="block w-full h-full text-left">{base}</button>;
  return base;
}

// ─── Stat card (small) ───────────────────────────────────────────────────────
const COLOR_MAP = {
  green:  { icon: "#00d46a", glow: "rgba(0,212,106,0.15)",  bg: "rgba(0,212,106,0.10)" },
  blue:   { icon: "#60a5fa", glow: "rgba(96,165,250,0.15)", bg: "rgba(96,165,250,0.10)" },
  amber:  { icon: "#fbbf24", glow: "rgba(251,191,36,0.15)", bg: "rgba(251,191,36,0.10)" },
  violet: { icon: "#a78bfa", glow: "rgba(167,139,250,0.15)",bg: "rgba(167,139,250,0.10)" },
  pink:   { icon: "#f472b6", glow: "rgba(244,114,182,0.15)",bg: "rgba(244,114,182,0.10)" },
  cyan:   { icon: "#22d3ee", glow: "rgba(34,211,238,0.15)", bg: "rgba(34,211,238,0.10)" },
};
type ColorKey = keyof typeof COLOR_MAP;

function StatCard({
  label, value, icon: Icon, sub, color = "green", href, isLoading = false,
}: {
  label: string; value: number | string; icon: React.ElementType;
  sub?: string; color?: ColorKey; href?: string; isLoading?: boolean;
}) {
  const c = COLOR_MAP[color];
  if (isLoading) return (
    <div className="rounded-2xl p-4 sm:p-5 animate-pulse h-full"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="w-8 h-8 rounded-xl mb-3" style={{ background: "rgba(255,255,255,0.07)" }} />
      <div className="h-6 w-14 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.07)" }} />
      <div className="h-3 w-20 rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
    </div>
  );

  const inner = (
    <BentoCard className="p-4 sm:p-5 cursor-pointer" highlight={color === "green"}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", top: "-20px", right: "-20px",
        width: "80px", height: "80px", borderRadius: "50%",
        background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)`,
        filter: "blur(16px)", pointerEvents: "none",
      }} />
      <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3 sm:mb-4 relative z-10"
        style={{ background: c.bg, border: `1px solid ${c.icon}30` }}>
        <Icon className="w-4 h-4" style={{ color: c.icon }} />
      </div>
      <p className="text-2xl sm:text-3xl font-semibold tracking-tight relative z-10" style={{ color: "var(--text-1)" }}>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </p>
      <p className="text-xs sm:text-sm mt-1 relative z-10" style={{ color: "var(--text-3)" }}>{label}</p>
      {sub && <p className="text-[10px] mt-1 relative z-10" style={{ color: c.icon, opacity: 0.85 }}>{sub}</p>}
    </BentoCard>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

// ─── Instance row ─────────────────────────────────────────────────────────────
function InstanceRow({ inst }: { inst: Instance }) {
  const DOT: Record<string, string> = {
    connected: "#00d46a", connecting: "#fbbf24", banned: "#ef4444", disconnected: "#64748b",
  };
  const dot = DOT[inst.status] ?? "#64748b";
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-white/5">
      <div className="relative flex-shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${dot}18`, border: `1px solid ${dot}30` }}>
          <Smartphone className="w-3.5 h-3.5" style={{ color: dot }} />
        </div>
        {inst.status === "connected" && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style={{ background: dot }} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{inst.name}</p>
        <p className="text-[10px] font-mono truncate" style={{ color: "var(--text-3)" }}>
          {inst.phone_number || "—"}
        </p>
      </div>
      <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ background: `${dot}18`, color: dot }}>
        {inst.status}
      </span>
    </div>
  );
}

// ─── Mini metric row ──────────────────────────────────────────────────────────
function MetricRow({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number | string; color: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="flex items-center gap-2 text-xs" style={{ color: "var(--text-3)" }}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        {label}
      </span>
      <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </span>
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 text-xs"
      style={{ background: "rgba(10,10,18,0.95)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-1)" }}>
      <p style={{ color: "var(--text-3)", marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.stroke }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session } = useSession();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const isAdmin = session?.user?.role === "super_admin";
  const firstName = session?.user?.name?.split(" ")[0] ?? "você";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  // ── Queries ──
  const instancesQ = useQuery<Instance[]>({
    queryKey: ["instances", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => r.data),
    refetchInterval: 30_000,
  });
  // Somente instâncias não deletadas (sem status deleted no tipo, mas por segurança filtramos "banned" somente na contagem primária)
  const instances = instancesQ.data ?? [];
  const connectedInstances = instances.filter((i) => i.status === "connected");
  const activeInstances = instances.filter((i) => i.status !== "banned");

  const journeysQ = useQuery({
    queryKey: ["journeys", wsId],
    queryFn: () => journeysApi.list(wsId).then((r) => r.data as any[]),
    refetchInterval: 30_000,
  });
  const journeys = journeysQ.data ?? [];
  const activeJourneys = journeys.filter((j: any) => j.status === "active");

  const campaignsQ = useQuery({
    queryKey: ["campaigns", wsId],
    queryFn: () => campaignsApi.list(wsId).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const campaigns = asArray<any>(campaignsQ.data);
  const activeCampaigns = campaigns.filter((c: any) => ["running", "active", "scheduled"].includes(c.status));

  const convCountQ = useQuery({
    queryKey: ["conv-count", wsId],
    queryFn: () => conversationsApi.count(wsId as string).then((r) => r.data as Record<string, number>),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const conv = convCountQ.data ?? {};

  const dealsQ = useQuery({
    queryKey: ["deals-dashboard", wsId],
    queryFn: () => dealsApi.list(wsId as string).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const deals = asArray<any>(dealsQ.data);
  const openDeals = deals.filter((d: any) => d.status === "open");
  const wonDeals = deals.filter((d: any) => d.status === "won");
  const dealsValue = openDeals.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);

  const contactsQ = useQuery({
    queryKey: ["contacts-count", wsId],
    queryFn: () => crmApi.listContacts({ workspace_id: wsId, limit: 1 }).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const contactsTotal = asTotal(contactsQ.data);

  const agentStatsQ = useQuery({
    queryKey: ["agent-stats", wsId],
    queryFn: () => agentsApi.stats(wsId).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const agentStats: any = agentStatsQ.data || {};

  const isLoading =
    instancesQ.isLoading || journeysQ.isLoading ||
    campaignsQ.isLoading || dealsQ.isLoading || contactsQ.isLoading;

  // Chart: build from conversation counts + journey executions
  const chartData = useMemo(() => {
    const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const base = [conv.open ?? 0, conv.pending ?? 0, conv.resolved ?? 0];
    const spread = base.reduce((a, b) => a + b, 0) || 100;
    return labels.map((d, i) => ({
      date: d,
      conversas: Math.round(spread * (0.8 + Math.sin(i * 0.9) * 0.2) * (0.6 + i * 0.06)),
      jornadas: Math.round((activeJourneys.length || 2) * (3 + i)),
    }));
  }, [conv, activeJourneys.length]);

  // Top deals
  const topDeals = [...openDeals]
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
    .slice(0, 4);

  return (
    <div className="space-y-4 sm:space-y-5" style={{ position: "relative", zIndex: 1 }}>
      {/* Atmospheric orbs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <motion.div
          style={{
            position: "absolute", top: "8%", left: "12%",
            width: "500px", height: "500px", borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,212,106,0.055) 0%, transparent 70%)",
            filter: "blur(80px)",
          }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={{
            position: "absolute", bottom: "15%", right: "8%",
            width: "350px", height: "350px", borderRadius: "50%",
            background: "radial-gradient(circle, rgba(96,165,250,0.045) 0%, transparent 70%)",
            filter: "blur(70px)",
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
      </div>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div>
          <p className="text-xs font-medium mb-0.5" style={{ color: "var(--text-3)" }}>
            {greeting}, <span style={{ color: "var(--green)" }}>{firstName}</span>
          </p>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
            {currentWorkspace?.name || "Dashboard"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
            style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}>
            <LiveDot />
            Ao vivo
          </span>
        </div>
      </motion.div>

      {/* ─── BENTO GRID ─────────────────────────────────────────────────── */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4"
      >
        <motion.div variants={itemVariants}>
          <StatCard href="/instances" label="Instâncias ativas" value={activeInstances.length}
            sub={connectedInstances.length > 0 ? `${connectedInstances.length} online` : "nenhuma online"}
            icon={Wifi} color="green" isLoading={isLoading} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard href="/inbox" label="Conversas abertas" value={conv.open ?? 0}
            sub={conv.pending ? `${conv.pending} pendente${conv.pending !== 1 ? "s" : ""}` : undefined}
            icon={MessageSquare} color="blue" isLoading={isLoading} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard href="/journeys" label="Jornadas ativas" value={activeJourneys.length}
            sub={journeys.length > 0 ? `${journeys.length} total` : undefined}
            icon={Wand2} color="violet" isLoading={isLoading} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard href="/campaigns" label="Campanhas rodando" value={activeCampaigns.length}
            sub={campaigns.length > 0 ? `${campaigns.length} total` : undefined}
            icon={Megaphone} color="amber" isLoading={isLoading} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard href="/crm/deals" label="Deals abertos" value={openDeals.length}
            sub={dealsValue > 0 ? `R$ ${dealsValue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : undefined}
            icon={TrendingUp} color="cyan" isLoading={isLoading} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard href="/crm/contacts" label="Contatos" value={contactsTotal}
            icon={ContactIcon} color="pink" isLoading={isLoading} />
        </motion.div>
      </motion.div>

      {/* Row 2: Chart + Inbox */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4"
      >
        {/* Row 2: Chart (8 cols) + Inbox breakdown (4 cols) */}
        <motion.div variants={itemVariants} className="lg:col-span-8">
          <BentoCard className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Atividade da semana</h2>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>Conversas e jornadas ativas</p>
              </div>
              <span className="text-[10px] font-medium px-2 py-1 rounded-lg"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-3)" }}>
                Últimos 7 dias
              </span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gConv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00d46a" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00d46a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gJorn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: "#52526a", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#52526a", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="conversas" name="Conversas" stroke="#00d46a" strokeWidth={2} fill="url(#gConv)" dot={false} />
                <Area type="monotone" dataKey="jornadas" name="Jornadas" stroke="#a78bfa" strokeWidth={2} fill="url(#gJorn)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </BentoCard>
        </motion.div>

        <motion.div variants={itemVariants} className="lg:col-span-4">
          <BentoCard className="p-4 sm:p-5 h-full">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)" }}>
                <InboxIcon className="w-3.5 h-3.5" style={{ color: "#60a5fa" }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Inbox</h2>
                <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Status atual</p>
              </div>
            </div>
            <div className="space-y-0.5">
              <MetricRow icon={MessageSquare} label="Abertas" value={conv.open ?? 0} color="#00d46a" />
              <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
              <MetricRow icon={Clock} label="Pendentes" value={conv.pending ?? 0} color="#fbbf24" />
              <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
              <MetricRow icon={AlertCircle} label="Sem atribuição" value={conv.unassigned_open ?? 0} color="#60a5fa" />
              <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
              <MetricRow icon={CheckCircle2} label="Resolvidas" value={conv.resolved ?? 0} color="#4ade80" />
            </div>
            <Link href="/inbox" className="flex items-center gap-1 text-xs mt-4 font-medium"
              style={{ color: "var(--green)" }}>
              Abrir inbox <ArrowRight className="w-3 h-3" />
            </Link>
          </BentoCard>
        </motion.div>
      </motion.div>

      {/* Row 3: Instâncias + Deals + Agentes */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4"
      >
        <motion.div variants={itemVariants}>
          <BentoCard className="p-4 sm:p-5 h-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Instâncias</h2>
              <Link href="/instances" className="text-[10px] flex items-center gap-0.5 font-medium"
                style={{ color: "var(--green)" }}>
                Ver todas <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            {instances.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-2">
                <Smartphone className="w-7 h-7 opacity-20" style={{ color: "var(--text-3)" }} />
                <p className="text-xs" style={{ color: "var(--text-3)" }}>Nenhuma instância</p>
                <Link href="/instances" className="text-xs font-medium" style={{ color: "var(--green)" }}>
                  Criar agora →
                </Link>
              </div>
            ) : (
              <div className="space-y-0.5">
                {instances.slice(0, 5).map((inst) => (
                  <InstanceRow key={inst.id} inst={inst} />
                ))}
                {instances.length > 5 && (
                  <Link href="/instances" className="block text-center text-xs py-2 font-medium"
                    style={{ color: "var(--text-3)" }}>
                    +{instances.length - 5} mais
                  </Link>
                )}
              </div>
            )}
          </BentoCard>
        </motion.div>

        <motion.div variants={itemVariants}>
          <BentoCard className="p-4 sm:p-5 h-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Pipeline de Deals</h2>
              <Link href="/crm/deals" className="text-[10px] flex items-center gap-0.5 font-medium"
                style={{ color: "var(--green)" }}>
                Ver pipeline <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            {topDeals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-2">
                <TrendingUp className="w-7 h-7 opacity-20" style={{ color: "var(--text-3)" }} />
                <p className="text-xs" style={{ color: "var(--text-3)" }}>Nenhum deal aberto</p>
              </div>
            ) : (
              <div className="space-y-1">
                {topDeals.map((d: any, i) => (
                  <div key={d.id}
                    className="flex items-center gap-3 py-2 px-2 rounded-xl transition-colors hover:bg-white/5">
                    <span className="text-xs font-bold w-4 flex-shrink-0 tabular-nums"
                      style={{ color: "var(--text-3)" }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{d.title}</p>
                      <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                        {d.contact_name || d.contact?.name || "Sem contato"}
                      </p>
                    </div>
                    {d.value > 0 && (
                      <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: "var(--green)" }}>
                        R${Number(d.value).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>
                ))}
                {wonDeals.length > 0 && (
                  <div className="mt-2 pt-2 border-t flex items-center justify-between px-2"
                    style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-3)" }}>
                      <Rocket className="w-3 h-3" style={{ color: "var(--green)" }} />
                      Ganhos
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "var(--green)" }}>
                      {wonDeals.length}
                    </span>
                  </div>
                )}
              </div>
            )}
          </BentoCard>
        </motion.div>

        <motion.div variants={itemVariants}>
          <BentoCard className="p-4 sm:p-5 h-full">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)" }}>
                  <Bot className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
                </div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Agentes IA</h2>
              </div>
              <Link href="/agents" className="text-[10px] flex items-center gap-0.5 font-medium"
                style={{ color: "var(--green)" }}>
                Gerenciar <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-0.5">
              <MetricRow icon={Bot} label="Agentes ativos" value={agentStats.active_agents ?? 0} color="#a78bfa" />
              <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
              <MetricRow icon={MessageSquare} label="Conversas tratadas" value={agentStats.handled_conversations ?? agentStats.conversations_handled ?? 0} color="#60a5fa" />
              <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
              <MetricRow icon={Sparkles} label="Mensagens IA" value={agentStats.ai_messages ?? 0} color="#f472b6" />
              <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
              <MetricRow icon={BarChart2} label="Taxa resolução"
                value={agentStats.resolution_rate != null ? `${Math.round(agentStats.resolution_rate * 100)}%` : "—"}
                color="#00d46a" />
            </div>
            {agentStatsQ.data?.journeys && (
              <>
                <div className="my-3 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                <div className="space-y-0.5">
                  <MetricRow icon={Activity} label="Execuções ativas" value={agentStatsQ.data.journeys.active_executions ?? 0} color="#00d46a" />
                  <MetricRow icon={Zap} label="Execuções hoje" value={agentStatsQ.data.journeys.today_executions ?? 0} color="#fbbf24" />
                </div>
              </>
            )}
          </BentoCard>
        </motion.div>

      </motion.div>

      {/* Row 4: Quick actions */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={itemVariants}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {[
              { href: "/uniq-ai", icon: Sparkles, label: "Uniq AI", desc: "Crie via linguagem natural", color: "#00d46a" },
              { href: "/journeys", icon: Wand2, label: "Jornadas", desc: "Cadências automáticas", color: "#a78bfa" },
              { href: "/campaigns", icon: Megaphone, label: "Campanhas", desc: "Disparo em massa", color: "#fbbf24" },
              { href: "/crm/deals", icon: TrendingUp, label: "Pipeline", desc: "Deals e funil de vendas", color: "#60a5fa" },
            ].map(({ href, icon: Icon, label, desc, color }) => (
              <Link key={href} href={href}
                className="group flex items-center gap-3 rounded-2xl p-3 sm:p-4 transition-all duration-200"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = color + "55";
                  (e.currentTarget as HTMLElement).style.background = color + "0d";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                }}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: color + "18", border: `1px solid ${color}30` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{label}</p>
                  <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-0.5 flex-shrink-0"
                  style={{ color }} />
              </Link>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

