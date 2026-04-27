"use client";

// Dashboard executivo — visão consolidada da operação. Agrega contadores
// de campanhas, jornadas, CRM (deals/contatos/empresas) e instâncias,
// mais a atividade recente. Layout responsivo (mobile-first).

import { useQuery } from "@tanstack/react-query";
import {
  adminApi, agentsApi, campaignsApi, companiesApi, crmApi, dealsApi,
  instancesApi, journeysApi,
} from "@/lib/api";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Activity, ArrowRight, Building2, Contact as ContactIcon, Megaphone,
  MessageSquare, Rocket, Smartphone, Sparkles, TrendingUp, Wand2, Wifi,
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

function StatCard({
  href, label, value, icon: Icon, sub, color = "green",
}: {
  href?: string;
  label: string;
  value: number | string;
  icon: React.ElementType;
  sub?: string;
  color?: StatColor;
}) {
  const s = statStyles[color];
  const inner = (
    <div className="rounded-2xl p-4 sm:p-5 transition-all hover:scale-[1.01] animate-fade-in-up h-full" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 sm:mb-4" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
        <Icon className="w-4 h-4" style={{ color: s.icon }} />
      </div>
      <p className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>{value}</p>
      <p className="text-xs sm:text-sm mt-1" style={{ color: "hsl(240 8% 52%)" }}>{label}</p>
      {sub && <p className="text-[10px] sm:text-xs mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
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
      <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{title}</h2>
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
  });

  const instancesQ = useQuery<Instance[]>({
    queryKey: ["instances", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => r.data),
  });
  const instances = instancesQ.data ?? [];
  const connected = instances.filter((i) => i.status === "connected").length;

  const journeysQ = useQuery({
    queryKey: ["journeys"],
    queryFn: () => journeysApi.list().then((r) => r.data as any[]),
  });
  const journeys = journeysQ.data ?? [];
  const activeJourneys = journeys.filter((j) => j.status === "active").length;

  const journeyStatsQ = useQuery({
    queryKey: ["agent-stats"],
    queryFn: () => agentsApi.stats().then((r) => r.data),
    refetchInterval: 60_000,
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
  });
  const campaigns = asArray<any>(campaignsQ.data);
  const activeCampaigns = campaigns.filter((c: any) => ["running", "active", "scheduled"].includes(c.status)).length;

  const dealsQ = useQuery({
    queryKey: ["deals-dashboard", wsId],
    queryFn: () => dealsApi.list(wsId as string).then((r) => r.data),
    enabled: !!wsId,
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
  });
  const contactsTotal = asTotal(contactsQ.data);

  const companiesQ = useQuery({
    queryKey: ["companies-count", wsId],
    queryFn: () => companiesApi.list(wsId as string, { limit: 1 }).then((r) => r.data),
    enabled: !!wsId,
  });
  const companiesTotal = asTotal(companiesQ.data);

  // Top 5 deals abertos
  const topOpenDeals = deals
    .filter((d: any) => d.status === "open")
    .sort((a: any, b: any) => (Number(b.value) || 0) - (Number(a.value) || 0))
    .slice(0, 5);

  // Top campanhas
  const recentCampaigns = [...campaigns]
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-5 sm:space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>Dashboard</h1>
        <p className="text-xs sm:text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
          Bem-vindo{currentWorkspace ? ` ao workspace ${currentWorkspace.name}` : ""},{" "}
          <span style={{ color: "hsl(240 8% 70%)" }}>{session?.user?.name}</span>
        </p>
      </div>

      {/* Stats grid — 2 cols mobile, 3 tablet, 6 desktop */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatCard
          href="/instances"
          label="Instâncias"
          value={isAdmin ? adminStatsQ.data?.instances?.total ?? instances.length : instances.length}
          icon={Smartphone}
          sub={connected > 0 ? `${connected} conectada${connected !== 1 ? "s" : ""}` : undefined}
          color="green"
        />
        <StatCard
          href="/journeys"
          label="Jornadas"
          value={journeys.length}
          icon={Wand2}
          sub={activeJourneys > 0 ? `${activeJourneys} ativa${activeJourneys !== 1 ? "s" : ""}` : undefined}
          color="violet"
        />
        <StatCard
          href="/campaigns"
          label="Campanhas"
          value={campaigns.length}
          icon={Megaphone}
          sub={activeCampaigns > 0 ? `${activeCampaigns} em andamento` : undefined}
          color="amber"
        />
        <StatCard
          href="/crm/deals"
          label="Deals abertos"
          value={openDeals}
          icon={TrendingUp}
          sub={dealsValue ? `R$ ${dealsValue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : undefined}
          color="blue"
        />
        <StatCard
          href="/crm/contacts"
          label="Contatos"
          value={contactsTotal}
          icon={ContactIcon}
          color="pink"
        />
        <StatCard
          href="/crm/companies"
          label="Empresas"
          value={companiesTotal}
          icon={Building2}
          color="violet"
        />
      </div>

      {/* Chart + Journey activity side-by-side em desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="lg:col-span-2 rounded-2xl p-4 sm:p-5 animate-fade-in-up" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Atividade de mensagens</h2>
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
                <span className="font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
                  {journeyStatsQ.data.journeys.active_executions}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                  Hoje
                </span>
                <span className="font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
                  {journeyStatsQ.data.journeys.today_executions}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                  <Wand2 className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
                  Total
                </span>
                <span className="font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
                  {journeyStatsQ.data.journeys.total_executions}
                </span>
              </div>
              {wonDeals > 0 && (
                <div className="pt-3 mt-3 border-t flex items-center justify-between text-sm" style={{ borderColor: "hsl(240 12% 14%)" }}>
                  <span className="flex items-center gap-2" style={{ color: "hsl(240 8% 60%)" }}>
                    <Rocket className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                    Deals ganhos
                  </span>
                  <span className="font-semibold" style={{ color: "var(--green)" }}>
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
                    <span className="text-xs font-semibold ml-3 flex-shrink-0" style={{ color: "var(--green)" }}>
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
    </div>
  );
}
