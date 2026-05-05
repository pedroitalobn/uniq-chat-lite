"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  CheckCircle2, Clock, AlertCircle, BarChart2, ChevronRight, Eye,
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
  show: { transition: { staggerChildren: 0.06 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
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

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, height = 28, width = 80 }: {
  data: number[]; color: string; height?: number; width?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  const lastX = width;
  const lastY = height - ((data[data.length - 1] - min) / range) * height;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={points} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// ─── LiveDot ─────────────────────────────────────────────────────────────────
function LiveDot({ color = "var(--green)" }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: color }} />
    </span>
  );
}

// ─── Bento card ───────────────────────────────────────────────────────────────
function BentoCard({
  children, className = "", href, onClick, highlight = false, accentColor,
}: {
  children: React.ReactNode; className?: string; href?: string;
  onClick?: () => void; highlight?: boolean; accentColor?: string;
}) {
  const color = accentColor ?? (highlight ? "rgba(0,212,106" : "rgba(255,255,255");
  const base = (
    <div
      className={`relative overflow-hidden rounded-2xl h-full group ${className}`}
      style={{
        background: highlight
          ? `linear-gradient(135deg, ${accentColor ?? "rgba(0,212,106,0.10)"} 0%, rgba(0,0,0,0) 100%)`
          : "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: highlight
          ? `1px solid ${accentColor ? accentColor.replace("0.10", "0.3").replace("0.08", "0.3") : "rgba(0,212,106,0.25)"}`
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.07)",
        transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = highlight ? "rgba(0,212,106,0.4)" : "rgba(255,255,255,0.14)";
        el.style.boxShadow = "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.09)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = highlight ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.08)";
        el.style.boxShadow = "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.07)";
      }}
    >
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

// ─── Color map ────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  green:  { icon: "#00d46a", glow: "rgba(0,212,106,0.15)",   bg: "rgba(0,212,106,0.10)",   text: "#00d46a" },
  blue:   { icon: "#60a5fa", glow: "rgba(96,165,250,0.15)",  bg: "rgba(96,165,250,0.10)",  text: "#60a5fa" },
  amber:  { icon: "#fbbf24", glow: "rgba(251,191,36,0.15)",  bg: "rgba(251,191,36,0.10)",  text: "#fbbf24" },
  violet: { icon: "#a78bfa", glow: "rgba(167,139,250,0.15)", bg: "rgba(167,139,250,0.10)", text: "#a78bfa" },
  pink:   { icon: "#f472b6", glow: "rgba(244,114,182,0.15)", bg: "rgba(244,114,182,0.10)", text: "#f472b6" },
  cyan:   { icon: "#22d3ee", glow: "rgba(34,211,238,0.15)",  bg: "rgba(34,211,238,0.10)",  text: "#22d3ee" },
};
type ColorKey = keyof typeof COLOR_MAP;

// ─── Stat card with sparkline ─────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, sub, color = "green", href, isLoading = false, trend,
}: {
  label: string; value: number | string; icon: React.ElementType;
  sub?: string; color?: ColorKey; href?: string; isLoading?: boolean;
  trend?: number[];
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
      <div style={{
        position: "absolute", top: "-20px", right: "-20px",
        width: "80px", height: "80px", borderRadius: "50%",
        background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)`,
        filter: "blur(16px)", pointerEvents: "none",
      }} />
      {/* Sparkline top-right */}
      {trend && (
        <div style={{ position: "absolute", top: 14, right: 14, opacity: 0.6 }}>
          <Sparkline data={trend} color={c.icon} height={24} width={64} />
        </div>
      )}
      <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3 sm:mb-4 relative z-10"
        style={{ background: c.bg, border: `1px solid ${c.icon}30` }}>
        <Icon className="w-4 h-4" style={{ color: c.icon }} />
      </div>
      <p className="text-2xl sm:text-3xl font-semibold tracking-tight relative z-10" style={{ color: "var(--text-1)" }}>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </p>
      <p className="text-xs sm:text-sm mt-1 relative z-10" style={{ color: "var(--text-3)" }}>{label}</p>
      {sub && <p className="text-[10px] mt-0.5 relative z-10" style={{ color: c.icon, opacity: 0.85 }}>{sub}</p>}
    </BentoCard>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

// ─── War Room Pulse Bar ───────────────────────────────────────────────────────
function PulseBar({ systems }: {
  systems: Array<{ label: string; status: "ok" | "warn" | "error" | "idle"; value?: string }>
}) {
  const colors = { ok: "#00d46a", warn: "#fbbf24", error: "#ef4444", idle: "#52526a" };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {systems.map((sys, i) => (
        <motion.div
          key={sys.label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <span className="relative flex h-1.5 w-1.5">
            {sys.status === "ok" && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                style={{ background: colors[sys.status], animationDuration: "2.5s" }} />
            )}
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: colors[sys.status] }} />
          </span>
          <span className="text-[10px] font-medium" style={{ color: "var(--text-3)" }}>{sys.label}</span>
          {sys.value && <span className="text-[10px] font-semibold" style={{ color: colors[sys.status] }}>{sys.value}</span>}
        </motion.div>
      ))}
    </div>
  );
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
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: dot }} />
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

// ─── Metric row ───────────────────────────────────────────────────────────────
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

// ─── Chart tooltip ────────────────────────────────────────────────────────────
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

// ─── Live Activity Timeline ───────────────────────────────────────────────────
function TimelineEntry({ item, index }: { item: any; index: number }) {
  const statusColors: Record<string, string> = {
    running: "#00d46a", completed: "#60a5fa", error: "#ef4444", sent: "#a78bfa",
  };
  const color = statusColors[item.status as string] ?? "#60a5fa";
  const time = new Date(item.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="flex items-start gap-3 py-2"
    >
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center flex-shrink-0 mt-1">
        <div className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            background: color,
            boxShadow: item.status === "running" ? `0 0 6px ${color}` : "none",
          }} />
        <div className="w-px flex-1 mt-1" style={{ background: "rgba(255,255,255,0.06)", minHeight: 16 }} />
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <p className="text-xs font-medium leading-tight" style={{ color: "var(--text-1)" }}>
          {item.description || item.type || "Evento do agente"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
            {item.agent_name || "Agente"}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: "var(--text-3)", opacity: 0.6 }}>{time}</span>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: `${color}18`, color }}>
            {item.status === "running" ? "ativo" : item.status === "completed" ? "ok" : item.status}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Contextual Tip (time-based) ──────────────────────────────────────────────
function ContextualTip({ hour, conv, queues }: { hour: number; conv: Record<string, number>; queues: any[] }) {
  const tips = useMemo(() => {
    if (hour < 10) return {
      icon: "☀️",
      title: "Bom dia! Resumo de ontem",
      text: `${conv.resolved ?? 0} conversas resolvidas ontem. ${conv.open ?? 0} abertas aguardando hoje.`,
      cta: "Ver inbox",
      href: "/inbox",
    };
    if (hour < 14) return {
      icon: "⚡",
      title: "Pico de atendimento",
      text: `${conv.open ?? 0} conversas abertas agora. ${conv.unassigned_open ?? 0} sem atribuição.`,
      cta: "Atender agora",
      href: "/inbox?status=unassigned",
    };
    if (hour < 18) return {
      icon: "📊",
      title: "Hora de analisar",
      text: queues.length > 0
        ? `${queues.length} fila${queues.length > 1 ? "s" : ""} ativa${queues.length > 1 ? "s" : ""}. Verifique SLAs.`
        : "Configure filas de atendimento para organizar o time.",
      cta: queues.length > 0 ? "Ver filas" : "Configurar",
      href: "/settings/queues",
    };
    return {
      icon: "🌙",
      title: "Fechando o dia",
      text: `${conv.resolved ?? 0} resolvidas hoje. Ative o modo fora de horário nas instâncias.`,
      cta: "Ver instâncias",
      href: "/instances",
    };
  }, [hour, conv, queues]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <span className="text-lg flex-shrink-0">{tips.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>{tips.title}</p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>{tips.text}</p>
      </div>
      <Link href={tips.href}
        className="flex items-center gap-1 text-xs font-medium flex-shrink-0 px-3 py-1.5 rounded-lg transition-colors"
        style={{ background: "rgba(0,212,106,0.1)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.2)" }}>
        {tips.cta} <ChevronRight className="w-3 h-3" />
      </Link>
    </motion.div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session } = useSession();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const firstName = session?.user?.name?.split(" ")[0] ?? "você";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  // ── Queries ──
  const instancesQ = useQuery<Instance[]>({
    queryKey: ["instances", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => r.data),
    refetchInterval: 30_000,
  });
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
    refetchInterval: 15_000,
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
    refetchInterval: 20_000,
  });
  const agentStats: any = agentStatsQ.data || {};

  const activityQ = useQuery({
    queryKey: ["agent-activity", wsId],
    queryFn: () => agentsApi.activity(10, wsId).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 12_000,
  });
  const activities = asArray<any>(activityQ.data);

  const isLoading =
    instancesQ.isLoading || journeysQ.isLoading ||
    campaignsQ.isLoading || dealsQ.isLoading || contactsQ.isLoading;

  // Chart data
  const chartData = useMemo(() => {
    const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const spread = (conv.open ?? 0) + (conv.pending ?? 0) + (conv.resolved ?? 0) || 100;
    return labels.map((d, i) => ({
      date: d,
      conversas: Math.round(spread * (0.8 + Math.sin(i * 0.9) * 0.2) * (0.6 + i * 0.06)),
      jornadas: Math.round((activeJourneys.length || 2) * (3 + i)),
    }));
  }, [conv, activeJourneys.length]);

  // Trend data for sparklines (simulated 7-day)
  const trends = useMemo(() => {
    const seed = (base: number) =>
      Array.from({ length: 7 }, (_, i) => Math.max(0, Math.round(base * (0.7 + Math.sin(i * 1.1 + base * 0.01) * 0.3))));
    return {
      instances: seed(activeInstances.length),
      conversations: seed(conv.open ?? 0),
      journeys: seed(activeJourneys.length),
      campaigns: seed(activeCampaigns.length),
      deals: seed(openDeals.length),
      contacts: seed(contactsTotal),
    };
  }, [activeInstances.length, conv.open, activeJourneys.length, activeCampaigns.length, openDeals.length, contactsTotal]);

  const topDeals = [...openDeals].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).slice(0, 4);

  // War Room systems status
  const systems = useMemo(() => [
    {
      label: "Instâncias",
      status: connectedInstances.length > 0 ? "ok" : activeInstances.length > 0 ? "warn" : "idle",
      value: `${connectedInstances.length}/${activeInstances.length}`,
    } as const,
    {
      label: "Agentes IA",
      status: (agentStats.active_agents ?? 0) > 0 ? "ok" : "idle",
      value: agentStats.active_agents ? `${agentStats.active_agents} ativos` : "idle",
    } as const,
    {
      label: "Inbox",
      status: (conv.open ?? 0) > 20 ? "warn" : "ok",
      value: `${conv.open ?? 0} abertas`,
    } as const,
    {
      label: "Jornadas",
      status: activeJourneys.length > 0 ? "ok" : "idle",
      value: activeJourneys.length > 0 ? `${activeJourneys.length} rodando` : "nenhuma",
    } as const,
    {
      label: "Campanhas",
      status: activeCampaigns.length > 0 ? "ok" : "idle",
      value: activeCampaigns.length > 0 ? `${activeCampaigns.length} ativas` : "idle",
    } as const,
  ], [connectedInstances.length, activeInstances.length, agentStats, conv.open, activeJourneys.length, activeCampaigns.length]);

  return (
    <div className="flex flex-col gap-4" style={{ position: "relative", zIndex: 1 }}>
      {/* Atmospheric orbs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <motion.div style={{
          position: "absolute", top: "5%", left: "8%", width: "680px", height: "680px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,212,106,0.07) 0%, transparent 70%)", filter: "blur(90px)",
        }} animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div style={{
          position: "absolute", bottom: "12%", right: "5%", width: "520px", height: "520px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(96,165,250,0.05) 0%, transparent 70%)", filter: "blur(80px)",
        }} animate={{ scale: [1, 1.18, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }} />
        <motion.div style={{
          position: "absolute", bottom: "5%", right: "30%", width: "400px", height: "400px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.05) 0%, transparent 70%)", filter: "blur(75px)",
        }} animate={{ scale: [1, 1.14, 1], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 4 }} />
      </div>

      {/* ── AI Command Center ────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <div className="rounded-2xl overflow-hidden" style={{
          background: "linear-gradient(135deg, rgba(0,212,106,0.07) 0%, rgba(255,255,255,0.02) 100%)",
          border: "1px solid rgba(0,212,106,0.14)",
          backdropFilter: "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
          boxShadow: "0 4px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}>
          {/* Top row: greeting + live status + quick jumps */}
          <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            {/* Left */}
            <div>
              <p className="text-xs font-medium mb-0.5" style={{ color: "var(--text-3)" }}>
                {greeting}, <span style={{ color: "var(--green)" }}>{firstName}</span>
              </p>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
                {currentWorkspace?.name || "Dashboard"}
              </h1>
            </div>

            {/* Center: war-room pulse */}
            <div className="hidden sm:block flex-1 min-w-0 max-w-sm">
              <PulseBar systems={systems} />
            </div>

            {/* Right: one-click jumps */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {[
                { href: "/uniq-ai", icon: Sparkles, label: "Uniq AI", color: "#00d46a", pulse: true },
                { href: "/inbox", icon: InboxIcon, label: "Inbox", color: "#60a5fa", pulse: false },
                { href: "/journeys", icon: Wand2, label: "Jornadas", color: "#a78bfa", pulse: false },
                { href: "/campaigns", icon: Megaphone, label: "Campanhas", color: "#fbbf24", pulse: false },
              ].map(({ href, icon: Icon, label, color, pulse }) => (
                <Link key={href} href={href}>
                  <motion.div whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.96 }}
                    className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                    style={{
                      background: `${color}12`,
                      border: `1px solid ${color}30`,
                      color,
                      backdropFilter: "blur(16px)",
                    }}>
                    {pulse && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full animate-ping"
                        style={{ background: color, opacity: 0.7 }} />
                    )}
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>

          {/* Bottom row: war room on mobile + contextual tip */}
          <div className="px-5 pb-4 sm:hidden">
            <PulseBar systems={systems} />
          </div>
          <div className="px-4 pb-4 border-t" style={{ borderColor: "rgba(0,212,106,0.08)" }}>
            <ContextualTip hour={hour} conv={conv} queues={[]} />
          </div>
        </div>
      </motion.div>

      {/* ── Stat pill strip ──────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.4 }}>
        <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {([
            { href: "/instances", label: "Instâncias", value: activeInstances.length, sub: `${connectedInstances.length} online`, icon: Wifi, color: "#00d46a", trend: trends.instances },
            { href: "/inbox", label: "Conversas", value: conv.open ?? 0, sub: conv.pending ? `${conv.pending} pend.` : "0 pend.", icon: MessageSquare, color: "#60a5fa", trend: trends.conversations },
            { href: "/journeys", label: "Jornadas", value: activeJourneys.length, sub: `${journeys.length} total`, icon: Wand2, color: "#a78bfa", trend: trends.journeys },
            { href: "/campaigns", label: "Campanhas", value: activeCampaigns.length, sub: `${campaigns.length} total`, icon: Megaphone, color: "#fbbf24", trend: trends.campaigns },
            { href: "/crm/deals", label: "Deals", value: openDeals.length, sub: dealsValue > 0 ? `R$${dealsValue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "R$ —", icon: TrendingUp, color: "#22d3ee", trend: trends.deals },
            { href: "/crm/contacts", label: "Contatos", value: contactsTotal, sub: "cadastrados", icon: ContactIcon, color: "#f472b6", trend: trends.contacts },
          ] as Array<{ href: string; label: string; value: number; sub: string; icon: React.ElementType; color: string; trend: number[] }>).map(({ href, label, value, sub, icon: Icon, color, trend }) => (
            <Link key={href} href={href} className="flex-shrink-0">
              <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.97 }}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
                style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  boxShadow: "0 2px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
                  minWidth: 168,
                }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}18`, border: `1px solid ${color}28` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--text-1)" }}>
                    {isLoading ? "—" : <AnimatedNumber value={value} />}
                  </p>
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-3)" }}>{label}</p>
                  <p className="text-[9px] mt-0.5 truncate font-medium" style={{ color, opacity: 0.85 }}>{sub}</p>
                </div>
                <div className="ml-auto pl-1" style={{ opacity: 0.55 }}>
                  <Sparkline data={trend} color={color} height={22} width={44} />
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      </motion.div>

      {/* ── Main float row: Timeline (dominant) + right cluster (offset) ─ */}
      <motion.div variants={containerVariants} initial="hidden" animate="show">
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* Live Activity Timeline — dominant left column */}
          <motion.div variants={itemVariants} className="w-full lg:w-[57%] flex-shrink-0">
            <BentoCard className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <LiveDot />
                    <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Linha do Tempo</h2>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(0,212,106,0.1)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.2)" }}>
                    Ao vivo
                  </span>
                </div>
                <Link href="/agents" className="text-[10px] flex items-center gap-0.5 font-medium"
                  style={{ color: "var(--text-3)" }}>
                  Ver tudo <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
              {activities.length > 0 ? (
                <div className="overflow-hidden" style={{ maxHeight: 300 }}>
                  <AnimatePresence initial={false}>
                    {activities.slice(0, 7).map((item: any, i: number) => (
                      <TimelineEntry key={item.id ?? i} item={item} index={i} />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)" }}>
                    <Activity className="w-5 h-5" style={{ color: "#a78bfa" }} />
                  </div>
                  <p className="text-xs text-center" style={{ color: "var(--text-3)" }}>
                    Nenhuma atividade recente.<br />Ative um agente para ver o feed ao vivo.
                  </p>
                  <Link href="/agents" className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                    Configurar agentes →
                  </Link>
                </div>
              )}
            </BentoCard>
          </motion.div>

          {/* Right cluster — floated up, stacked chart + inbox */}
          <div className="w-full lg:flex-1 flex flex-col gap-3 lg:-mt-5">
            {/* Chart */}
            <motion.div variants={itemVariants}>
              <BentoCard className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Semana</h2>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>Conversas × Jornadas</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={130}>
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
                    <XAxis dataKey="date" tick={{ fill: "#52526a", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#52526a", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="conversas" name="Conversas" stroke="#00d46a" strokeWidth={1.5} fill="url(#gConv)" dot={false} />
                    <Area type="monotone" dataKey="jornadas" name="Jornadas" stroke="#a78bfa" strokeWidth={1.5} fill="url(#gJorn)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </BentoCard>
            </motion.div>

            {/* Inbox breakdown — shifted down slightly for layered feel */}
            <motion.div variants={itemVariants} className="lg:mt-2">
              <BentoCard className="p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)" }}>
                    <InboxIcon className="w-3.5 h-3.5" style={{ color: "#60a5fa" }} />
                  </div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Inbox</h2>
                  <Link href="/inbox" className="ml-auto flex items-center gap-0.5 text-[10px] font-medium"
                    style={{ color: "var(--green)" }}>
                    Abrir <ArrowRight className="w-3 h-3" />
                  </Link>
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
              </BentoCard>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* ── Bottom float cluster: Instances + Pipeline + Agents ─────────── */}
      <motion.div variants={containerVariants} initial="hidden" animate="show">
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* Instâncias — 32% */}
          <motion.div variants={itemVariants} className="w-full lg:w-[32%] flex-shrink-0">
            <BentoCard className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Instâncias</h2>
                <Link href="/instances" className="text-[10px] flex items-center gap-0.5 font-medium"
                  style={{ color: "var(--green)" }}>Ver todas <ArrowUpRight className="w-3 h-3" /></Link>
              </div>
              {instances.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <Smartphone className="w-7 h-7 opacity-20" style={{ color: "var(--text-3)" }} />
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>Nenhuma instância</p>
                  <Link href="/instances" className="text-xs font-medium" style={{ color: "var(--green)" }}>Criar agora →</Link>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {instances.slice(0, 5).map((inst) => <InstanceRow key={inst.id} inst={inst} />)}
                  {instances.length > 5 && (
                    <Link href="/instances" className="block text-center text-xs py-2 font-medium"
                      style={{ color: "var(--text-3)" }}>+{instances.length - 5} mais</Link>
                  )}
                </div>
              )}
            </BentoCard>
          </motion.div>

          {/* Pipeline — 38% */}
          <motion.div variants={itemVariants} className="w-full lg:w-[38%] flex-shrink-0">
            <BentoCard className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Pipeline de Deals</h2>
                <Link href="/crm/deals" className="text-[10px] flex items-center gap-0.5 font-medium"
                  style={{ color: "var(--green)" }}>Ver pipeline <ArrowUpRight className="w-3 h-3" /></Link>
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
                      <span className="text-xs font-bold w-4 flex-shrink-0 tabular-nums" style={{ color: "var(--text-3)" }}>{i + 1}</span>
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
                        <Rocket className="w-3 h-3" style={{ color: "var(--green)" }} />Ganhos
                      </span>
                      <span className="text-xs font-semibold" style={{ color: "var(--green)" }}>{wonDeals.length}</span>
                    </div>
                  )}
                </div>
              )}
            </BentoCard>
          </motion.div>

          {/* Agentes — rest of width, floated up for depth */}
          <motion.div variants={itemVariants} className="w-full lg:flex-1 lg:-mt-7">
            <BentoCard className="p-4 sm:p-5" highlight accentColor="rgba(167,139,250,0.08)">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)" }}>
                    <Bot className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
                  </div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Agentes IA</h2>
                </div>
                <Link href="/agents" className="text-[10px] flex items-center gap-0.5 font-medium"
                  style={{ color: "var(--green)" }}>Gerenciar <ArrowUpRight className="w-3 h-3" /></Link>
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
              {activeJourneys.length > 0 && (
                <>
                  <div className="my-3 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                  <div className="rounded-xl px-3 py-2.5"
                    style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.15)" }}>
                    <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#a78bfa" }}>
                      Em execução
                    </p>
                    <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                      {activeJourneys[0]?.name || "Jornada ativa"}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                      {activeJourneys.length > 1 ? `+${activeJourneys.length - 1} outras` : "Em execução contínua"}
                    </p>
                  </div>
                </>
              )}
            </BentoCard>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
