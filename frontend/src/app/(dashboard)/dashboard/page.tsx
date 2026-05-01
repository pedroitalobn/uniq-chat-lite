"use client";

// Dashboard executivo unificado — pills no topo selecionam visão:
//   Geral · Campanhas · Inbox/SLA · Shop · Agentes
// Cada visão consome endpoints já existentes; a rota /reports antiga
// é mantida via tab Inbox/SLA (deeplink ?tab=inbox).

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminApi, agentsApi, campaignsApi, companiesApi, crmApi, dealsApi,
  instancesApi, journeysApi, conversationsApi,
} from "@/lib/api";
import { useSession } from "next-auth/react";
import Link from "next/link";
import api from "@/lib/api";
import {
  Activity, ArrowRight, Building2, Contact as ContactIcon, Megaphone,
  MessageSquare, Rocket, Smartphone, Sparkles, TrendingUp, Wand2, Wifi,
  LayoutDashboard, ShoppingBag, Bot, Inbox as InboxIcon,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { Instance } from "@/types";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const MOCK_MSGS  = [120, 340, 210, 480, 90, 310, 175];
const WEEKDAYS   = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

const statStyles = {
  green:  { icon: "#00d46a", bg: "rgba(0,212,106,0.08)",  border: "rgba(0,212,106,0.15)" },
  blue:   { icon: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.15)" },
  amber:  { icon: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.15)" },
  violet: { icon: "#a78bfa", bg: "rgba(167,139,250,0.08)",border: "rgba(167,139,250,0.15)" },
  pink:   { icon: "#f472b6", bg: "rgba(244,114,182,0.08)",border: "rgba(244,114,182,0.15)" },
  red:    { icon: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.15)" },
};
type StatColor = keyof typeof statStyles;

// ─── AnimatedNumber ───────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const duration = 600;

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    startRef.current = null;

    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutExpo
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(Math.round(eased * value));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return <>{display > 1000 ? display.toLocaleString("pt-BR") : display}</>;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
const SPARKLINE_PLACEHOLDER = [65, 72, 68, 80, 75, 88, 92];

function Sparkline({ data = SPARKLINE_PLACEHOLDER, positive = true }: { data?: number[]; positive?: boolean }) {
  const w = 80;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * stepX},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" ");
  const color = positive ? "var(--green)" : "#ef4444";
  return (
    <svg
      width={w}
      height={h}
      style={{ opacity: 0.5, display: "block" }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── StatCard skeleton ────────────────────────────────────────────────────────
function StatCardSkeleton() {
  return (
    <div
      className="rounded-2xl p-4 sm:p-5 animate-pulse h-full"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="w-9 h-9 rounded-xl mb-3 sm:mb-4" style={{ background: "var(--surface-3)" }} />
      <div className="h-7 w-16 rounded-lg mb-2" style={{ background: "var(--surface-3)" }} />
      <div className="h-3 w-24 rounded-md" style={{ background: "var(--surface-3)" }} />
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({
  href, label, value, icon: Icon, sub, color = "green", isLoading = false, sparkline,
}: {
  href?: string;
  label: string;
  value: number | string;
  icon: React.ElementType;
  sub?: string;
  color?: StatColor;
  isLoading?: boolean;
  sparkline?: number[];
}) {
  if (isLoading) return <StatCardSkeleton />;

  const s = statStyles[color];
  const numValue = typeof value === "number" ? value : undefined;

  const inner = (
    <div
      className="rounded-2xl p-4 sm:p-5 transition-all hover:scale-[1.01] animate-fade-in-up h-full relative overflow-hidden"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 sm:mb-4"
        style={{ background: s.bg, border: `1px solid ${s.border}` }}
      >
        <Icon className="w-4 h-4" style={{ color: s.icon }} />
      </div>
      <p className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
        {numValue !== undefined ? <AnimatedNumber value={numValue} /> : value}
      </p>
      <p className="text-xs sm:text-sm mt-1" style={{ color: "hsl(240 8% 52%)" }}>{label}</p>
      {sub && <p className="text-[10px] sm:text-xs mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{sub}</p>}
      {/* Sparkline — bottom-right */}
      <div style={{ position: "absolute", bottom: 12, right: 12 }}>
        <Sparkline data={sparkline} positive={color !== "red"} />
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

// ─── LiveIndicator ────────────────────────────────────────────────────────────
function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--green)" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--green)",
          display: "inline-block",
          animation: "live-dot-pulse 2s infinite",
        }}
      />
      Ao vivo
    </span>
  );
}

function ShortcutCard({ href, icon: Icon, label, description, color }: {
  href: string; icon: React.ElementType; label: string; description: string; color: string;
}) {
  return (
    <Link href={href} className="group rounded-2xl p-3 sm:p-4 transition-all duration-200 animate-fade-in-up"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = color; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(240 12% 13%)"; }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "hsl(240 15% 88%)" }}>{label}</p>
          <p className="text-xs truncate" style={{ color: "hsl(240 8% 42%)" }}>{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1 flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }} />
      </div>
    </Link>
  );
}

function SectionHeader({ title, href, linkText = "Ver todas →" }: { title: string; href?: string; linkText?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-medium" style={{ color: "hsl(240 15% 88%)" }}>{title}</h2>
      {href && (
        <Link href={href} className="text-xs transition-colors" style={{ color: "var(--green)" }}>
          {linkText}
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const isAdmin = session?.user?.role === "super_admin";

  const chartData = MOCK_MSGS.map((mensagens, i) => ({ date: WEEKDAYS[i], mensagens }));

  const adminStatsQ = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminApi.getStats().then((r) => r.data),
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const instancesQ = useQuery<Instance[]>({
    queryKey: ["instances", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const instances = instancesQ.data ?? [];
  const connected = instances.filter((i) => i.status === "connected").length;

  const journeysQ = useQuery({
    queryKey: ["journeys"],
    queryFn: () => journeysApi.list(wsId).then((r) => r.data as any[]),
    refetchInterval: 30_000,
  });
  const journeys = journeysQ.data ?? [];
  const activeJourneys = journeys.filter((j) => j.status === "active").length;

  const journeyStatsQ = useQuery({
    queryKey: ["agent-stats"],
    queryFn: () => agentsApi.stats(wsId).then((r) => r.data),
    refetchInterval: 30_000,
  });

  // Helper: vários endpoints do backend retornam shapes diferentes
  // (`{data,total}`, `{items,total}`, ou array puro). Esse normalize cobre
  // todos os casos sem quebrar o dashboard quando o formato muda.
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

  const campaignsQ = useQuery({
    queryKey: ["campaigns", wsId],
    queryFn: () => campaignsApi.list(wsId).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const campaigns = asArray<any>(campaignsQ.data);
  const activeCampaigns = campaigns.filter((c: any) => ["running", "active", "scheduled"].includes(c.status)).length;

  const dealsQ = useQuery({
    queryKey: ["deals-dashboard", wsId],
    queryFn: () => dealsApi.list(wsId as string).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const deals = asArray<any>(dealsQ.data);
  const openDeals = deals.filter((d: any) => d.status === "open").length;
  const wonDeals = deals.filter((d: any) => d.status === "won").length;
  const dealsValue = deals
    .filter((d: any) => d.status === "open")
    .reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);

  const contactsQ = useQuery({
    queryKey: ["contacts-count", wsId],
    queryFn: () => crmApi.listContacts({ workspace_id: wsId, limit: 1 }).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const contactsTotal = asTotal(contactsQ.data);

  const companiesQ = useQuery({
    queryKey: ["companies-count", wsId],
    queryFn: () => companiesApi.list(wsId as string, { limit: 1 }).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const companiesTotal = asTotal(companiesQ.data);

  // Loading state: true enquanto qualquer query principal ainda carrega pela primeira vez
  const isLoadingStats =
    instancesQ.isLoading ||
    journeysQ.isLoading ||
    campaignsQ.isLoading ||
    dealsQ.isLoading ||
    contactsQ.isLoading ||
    companiesQ.isLoading;

  // Top 5 deals abertos
  const topOpenDeals = deals
    .filter((d: any) => d.status === "open")
    .sort((a: any, b: any) => (Number(b.value) || 0) - (Number(a.value) || 0))
    .slice(0, 5);

  // Top campanhas
  const recentCampaigns = [...campaigns]
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  type Tab = "geral" | "campaigns" | "inbox" | "shop" | "agents";
  const [tab, setTab] = useState<Tab>("geral");

  return (
    <div className="space-y-5 sm:space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-medium tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>Dashboard</h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            Bem-vindo{currentWorkspace ? ` ao workspace ${currentWorkspace.name}` : ""},{" "}
            <span style={{ color: "hsl(240 8% 70%)" }}>{session?.user?.name}</span>
          </p>
        </div>
        <div className="mt-1">
          <LiveIndicator />
        </div>
      </div>

      {/* Pills de tabs — mesmo padrão dos outros menus pill (CRMTabs, etc) */}
      <div className="flex items-center gap-0.5 rounded-2xl p-1 self-start overflow-x-auto"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <DashTab id="geral"     label="Geral"      icon={LayoutDashboard} tab={tab} setTab={setTab} />
        <DashTab id="campaigns" label="Campanhas"  icon={Megaphone}        tab={tab} setTab={setTab} />
        <DashTab id="inbox"     label="Inbox / SLA" icon={InboxIcon}       tab={tab} setTab={setTab} />
        <DashTab id="shop"      label="Shop"       icon={ShoppingBag}      tab={tab} setTab={setTab} />
        <DashTab id="agents"    label="Agentes"    icon={Bot}              tab={tab} setTab={setTab} />
      </div>

      {tab === "campaigns" && <CampaignsView wsId={wsId} />}
      {tab === "inbox" && <InboxStatsView wsId={wsId} />}
      {tab === "shop" && <ShopStatsView wsId={wsId} />}
      {tab === "agents" && <AgentsStatsView />}
      {tab === "geral" && (
      <>
      {/* Stats grid — 2 cols mobile, 3 tablet, 6 desktop */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatCard
          href="/instances"
          label="Instâncias"
          value={isAdmin ? adminStatsQ.data?.instances?.total ?? instances.length : instances.length}
          icon={Smartphone}
          sub={connected > 0 ? `${connected} conectada${connected !== 1 ? "s" : ""}` : undefined}
          color="green"
          isLoading={isLoadingStats}
        />
        <StatCard
          href="/journeys"
          label="Jornadas"
          value={journeys.length}
          icon={Wand2}
          sub={activeJourneys > 0 ? `${activeJourneys} ativa${activeJourneys !== 1 ? "s" : ""}` : undefined}
          color="violet"
          isLoading={isLoadingStats}
        />
        <StatCard
          href="/campaigns"
          label="Campanhas"
          value={campaigns.length}
          icon={Megaphone}
          sub={activeCampaigns > 0 ? `${activeCampaigns} em andamento` : undefined}
          color="amber"
          isLoading={isLoadingStats}
        />
        <StatCard
          href="/crm/deals"
          label="Deals abertos"
          value={openDeals}
          icon={TrendingUp}
          sub={dealsValue ? `R$ ${dealsValue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : undefined}
          color="blue"
          isLoading={isLoadingStats}
        />
        <StatCard
          href="/crm/contacts"
          label="Contatos"
          value={contactsTotal}
          icon={ContactIcon}
          color="pink"
          isLoading={isLoadingStats}
        />
        <StatCard
          href="/crm/companies"
          label="Empresas"
          value={companiesTotal}
          icon={Building2}
          color="violet"
          isLoading={isLoadingStats}
        />
      </div>

      {/* Chart + Journey activity side-by-side em desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="lg:col-span-2 rounded-2xl p-4 sm:p-5 animate-fade-in-up" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-sm font-medium" style={{ color: "hsl(240 15% 88%)" }}>Atividade de mensagens</h2>
            <span className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>últimos 7 dias</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00d46a" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#00d46a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-2)" />
              <XAxis dataKey="date" tick={{ fill: "#52526a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#52526a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 16%)", borderRadius: 10, fontSize: 12, color: "hsl(240 15% 80%)" }} />
              <Area type="monotone" dataKey="mensagens" stroke="#00d46a" strokeWidth={1.5} fill="url(#colorMsg)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Journey runtime */}
        <div className="rounded-2xl p-4 sm:p-5 animate-fade-in-up" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <SectionHeader title="Execuções de jornadas" href="/journeys" linkText="Ver atividade →" />
          {journeyStatsQ.data?.journeys ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                  <Activity className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                  Em execução
                </span>
                <span className="font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                  {journeyStatsQ.data.journeys.active_executions}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                  Hoje
                </span>
                <span className="font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                  {journeyStatsQ.data.journeys.today_executions}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                  <Wand2 className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
                  Total
                </span>
                <span className="font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                  {journeyStatsQ.data.journeys.total_executions}
                </span>
              </div>
              {wonDeals > 0 && (
                <div className="pt-3 mt-3 border-t flex items-center justify-between text-sm" style={{ borderColor: "hsl(240 12% 14%)" }}>
                  <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                    <Rocket className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                    Deals ganhos
                  </span>
                  <span className="font-medium" style={{ color: "var(--green)" }}>
                    {wonDeals}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs" style={{ color: "hsl(240 8% 38%)" }}>Sem dados ainda.</p>
          )}
        </div>
      </div>

      {/* Quick shortcuts */}
      <div>
        <SectionHeader title="Acesso rápido" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ShortcutCard href="/uniq-ai" icon={Sparkles} label="Uniq AI" description="Crie via linguagem natural" color="#00d46a" />
          <ShortcutCard href="/journeys" icon={Wand2} label="Jornadas" description="Cadências automáticas" color="#a78bfa" />
          <ShortcutCard href="/campaigns" icon={Megaphone} label="Campanhas" description="Disparo em massa" color="#fbbf24" />
          <ShortcutCard href="/crm/deals" icon={TrendingUp} label="Pipeline" description="Deals e funil" color="#60a5fa" />
        </div>
      </div>

      {/* Lists side-by-side: top deals + recent campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-2xl p-4 sm:p-5 animate-fade-in-up" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <SectionHeader title="Maiores deals abertos" href="/crm/deals" linkText="Ver pipeline →" />
          {topOpenDeals.length === 0 ? (
            <p className="text-xs py-6 text-center" style={{ color: "hsl(240 8% 38%)" }}>Nenhum deal aberto</p>
          ) : (
            <div className="space-y-1">
              {topOpenDeals.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 88%)" }}>{d.title}</p>
                    <p className="text-xs truncate" style={{ color: "hsl(240 8% 42%)" }}>{d.contact_name || d.contact?.name || "Sem contato"}</p>
                  </div>
                  {d.value > 0 && (
                    <span className="text-xs font-medium ml-3 flex-shrink-0" style={{ color: "var(--green)" }}>
                      R$ {Number(d.value).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl p-4 sm:p-5 animate-fade-in-up" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <SectionHeader title="Campanhas recentes" href="/campaigns" linkText="Ver todas →" />
          {recentCampaigns.length === 0 ? (
            <p className="text-xs py-6 text-center" style={{ color: "hsl(240 8% 38%)" }}>Nenhuma campanha ainda</p>
          ) : (
            <div className="space-y-1">
              {recentCampaigns.map((c: any) => {
                const statusColor =
                  c.status === "running" ? "#00d46a" :
                  c.status === "completed" ? "#3b82f6" :
                  c.status === "paused" ? "#fbbf24" :
                  c.status === "cancelled" || c.status === "failed" ? "#f87171" :
                  "#6b7280";
                return (
                  <div key={c.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 88%)" }}>{c.name}</p>
                      <p className="text-xs truncate" style={{ color: "hsl(240 8% 42%)" }}>
                        {c.times_total ? `${c.times_total} envios` : "—"}
                      </p>
                    </div>
                    <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full ml-3 flex-shrink-0"
                      style={{ background: `${statusColor}1a`, color: statusColor }}>
                      {c.status || "draft"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Instances list */}
      <div className="rounded-2xl p-4 sm:p-5 animate-fade-in-up" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <SectionHeader title="Instâncias" href="/instances" />
        {instances.length === 0 ? (
          <div className="text-center py-8">
            <Smartphone className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(240 8% 28%)" }} />
            <p className="text-sm" style={{ color: "hsl(240 8% 38%)" }}>Nenhuma instância</p>
            <Link href="/instances" className="text-xs mt-2 inline-block" style={{ color: "var(--green)" }}>Criar primeira instância →</Link>
          </div>
        ) : (
          <div className="space-y-1">
            {instances.slice(0, 6).map((inst) => {
              const dot =
                inst.status === "connected" ? "#00d46a" :
                inst.status === "connecting" ? "#fbbf24" :
                inst.status === "banned" ? "#ef4444" : "#64748b";
              const labelColor = dot;
              return (
                <div key={inst.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "hsl(240 8% 80%)" }}>{inst.name}</p>
                      <p className="text-xs font-mono truncate" style={{ color: "hsl(240 8% 38%)" }}>{inst.phone_number || "—"}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${labelColor}1a`, color: labelColor }}>{inst.status}</span>
                </div>
              );
            })}
            {instances.length > 6 && (
              <Link href="/instances" className="block text-center text-xs py-2" style={{ color: "var(--green)" }}>
                Ver todas as {instances.length} instâncias →
              </Link>
            )}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

// ─── Tab pill ────────────────────────────────────────────────────────────────
function DashTab({ id, label, icon: Icon, tab, setTab }: {
  id: "geral" | "campaigns" | "inbox" | "shop" | "agents";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tab: string;
  setTab: (t: any) => void;
}) {
  const active = tab === id;
  return (
    <button
      onClick={() => setTab(id)}
      className="flex items-center gap-2 rounded-xl px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium transition-all duration-150 whitespace-nowrap"
      style={active
        ? { background: "rgba(0,212,106,0.12)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.25)" }
        : { background: "transparent", color: "hsl(240 8% 55%)", border: "1px solid transparent" }}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden xs:inline sm:inline">{label}</span>
    </button>
  );
}

// ─── Tab views ───────────────────────────────────────────────────────────────
function StatBlock({ label, value, sub, color = "var(--green)" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <p className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-2xl font-medium mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>{sub}</p>}
    </div>
  );
}

function CampaignsView({ wsId }: { wsId?: string }) {
  const q = useQuery({
    queryKey: ["dash-campaigns", wsId],
    queryFn: () => campaignsApi.list(wsId).then((r) => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const list: any[] = Array.isArray(q.data) ? q.data : (q.data as any)?.data || [];
  const totals = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let totalSent = 0, totalFailed = 0;
    for (const c of list) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      totalSent += Number(c.sent_count || 0);
      totalFailed += Number(c.failed_count || 0);
    }
    return { byStatus, totalSent, totalFailed };
  }, [list]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBlock label="Total" value={list.length} />
        <StatBlock label="Rodando" value={totals.byStatus.running || 0} color="#60a5fa" />
        <StatBlock label="Enviadas" value={totals.totalSent.toLocaleString("pt-BR")} />
        <StatBlock label="Falhas" value={totals.totalFailed.toLocaleString("pt-BR")} color="#f87171" />
      </div>
      <Link href="/campaigns" className="text-xs underline" style={{ color: "var(--green)" }}>
        Gerenciar campanhas →
      </Link>
    </div>
  );
}

function InboxStatsView({ wsId }: { wsId?: string }) {
  const counts = useQuery({
    queryKey: ["dash-conv-count", wsId],
    queryFn: () => conversationsApi.count(wsId as string).then(r => r.data as Record<string, number>),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const c = counts.data ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBlock label="Abertos" value={c.open ?? 0} />
        <StatBlock label="Pendentes" value={c.pending ?? 0} color="#fbbf24" />
        <StatBlock label="Sem atribuição" value={c.unassigned_open ?? 0} color="#60a5fa" />
        <StatBlock label="Resolvidos" value={c.resolved ?? 0} color="var(--text-3)" />
      </div>
      <Link href="/inbox" className="text-xs underline" style={{ color: "var(--green)" }}>
        Ver inbox →
      </Link>
    </div>
  );
}

function ShopStatsView({ wsId }: { wsId?: string }) {
  const headers = wsId ? { "X-Workspace-ID": wsId } : undefined;
  const shopsQ = useQuery({
    queryKey: ["dash-shops", wsId],
    queryFn: () => api.get("/v1/shops", { headers }).then(r => r.data),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
  const shops: any[] = (shopsQ.data as any)?.data ?? [];
  const productsQ = useQuery({
    queryKey: ["dash-products-count", wsId, shops.map((s: any) => s.id).join(",")],
    queryFn: async () => {
      let total = 0;
      await Promise.all(shops.map(async (s: any) => {
        try {
          const r = await api.get(`/v1/shops/${s.id}/products`, { headers, params: { limit: 1 } });
          total += (r.data?.total ?? (r.data?.data?.length ?? 0));
        } catch {}
      }));
      return total;
    },
    enabled: shops.length > 0,
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatBlock label="Lojas" value={shops.length} />
        <StatBlock label="Produtos" value={productsQ.data ?? 0} />
        <StatBlock label="Lojas ativas" value={shops.filter((s: any) => s.is_active).length} color="var(--green)" />
      </div>
      <Link href="/shops" className="text-xs underline" style={{ color: "var(--green)" }}>
        Gerenciar lojas →
      </Link>
    </div>
  );
}

function AgentsStatsView() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const q = useQuery({
    queryKey: ["dash-agent-stats", wsId],
    queryFn: () => agentsApi.stats(wsId).then(r => r.data),
    refetchInterval: 30_000,
  });
  const s: any = q.data || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBlock label="Agentes ativos" value={s.active_agents ?? 0} />
        <StatBlock label="Conversas tratadas" value={s.handled_conversations ?? s.conversations_handled ?? 0} />
        <StatBlock label="Mensagens IA" value={s.ai_messages ?? 0} />
        <StatBlock label="Taxa resolução" value={s.resolution_rate != null ? `${Math.round(s.resolution_rate * 100)}%` : "—"} />
      </div>
      <Link href="/agents" className="text-xs underline" style={{ color: "var(--green)" }}>
        Gerenciar agentes →
      </Link>
    </div>
  );
}
