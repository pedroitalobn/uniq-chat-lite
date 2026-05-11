"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bot, BotOff, CheckCircle2, Clock3, Eye, Loader2, MessageSquare,
  Phone, Send, Sparkles, Tag as TagIcon, UserCheck, UserX, Zap,
  Briefcase, Route, TrendingUp, Calendar, Megaphone, Hash, Mail,
  ArrowRightLeft, Pin, Bell, BellOff, RotateCcw, Star, Check,
  ChevronDown, ChevronUp, User, BarChart3, Globe, Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { crmApi, dealsApi, conversationsApi, queuesApi, workspacesApi } from "@/lib/api";
import AgentOrchestrator from "@/components/inbox/AgentOrchestrator";
import CRMQuickActions from "@/components/inbox/CRMQuickActions";
import CampaignJourneyPanel from "@/components/inbox/CampaignJourneyPanel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { relativeTime } from "@/components/atendimento/ConversationList";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  workspace_id: string;
  instance_id: string;
  instance?: { id: string; name: string; channel?: string; phone_number?: string } | null;
  contact_id?: string | null;
  channel_type: string;
  channel_key: string;
  status: string;
  priority: string;
  subject?: string;
  push_name?: string;
  avatar_url?: string;
  queue_id?: string | null;
  assigned_user_id?: string | null;
  assigned_user?: { id: string; name: string; email: string } | null;
  contact?: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    avatar_url?: string;
  } | null;
  last_message_at?: string;
  unread_count: number;
  is_bot_active: boolean;
  is_pinned?: boolean;
  is_muted?: boolean;
  reopen_count: number;
  first_response_at?: string | null;
  created_at: string;
}

interface Presence {
  online?: boolean;
  lastSeen?: string;
  typing?: boolean;
}

interface Queue { id: string; name: string; }

interface DealRow {
  id: string;
  title: string;
  stage_id: string;
  status: string;
  value: number;
  currency: string;
}

interface ContactCRM {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  funnel?: string;
  stage?: string;
  journey?: string;
  tags?: Array<{ id: string; name: string; color: string }>;
}

interface TimelineItem {
  kind: "message" | "note" | "event";
  at: string;
  id: string;
  payload: any;
}

interface WorkspaceMember {
  user_id: string;
  is_owner: boolean;
  user?: { id: string; name: string; email: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `R$ ${value.toFixed(2)}`;
  }
}

function channelColor(channel: string): string {
  switch ((channel || "").toLowerCase()) {
    case "whatsapp": return "#25d366";
    case "waba": return "#0088ff";
    case "instagram": return "#e1306c";
    case "facebook": return "#1877f2";
    case "telegram": return "#229ed9";
    case "linkedin": return "#0a66c2";
    case "tiktok": return "#ff0050";
    case "kwai": return "#ff6600";
    default: return "#94a3b8";
  }
}

function channelLabel(channel: string): string {
  switch ((channel || "").toLowerCase()) {
    case "whatsapp": return "WhatsApp";
    case "waba": return "WhatsApp API";
    case "instagram": return "Instagram";
    case "facebook": return "Facebook";
    case "telegram": return "Telegram";
    case "linkedin": return "LinkedIn";
    case "tiktok": return "TikTok";
    case "kwai": return "Kwai";
    default: return channel || "Canal";
  }
}

function channelIcon(channel: string): string {
  switch ((channel || "").toLowerCase()) {
    case "whatsapp": case "waba": return "💬";
    case "instagram": return "📸";
    case "facebook": return "👍";
    case "telegram": return "✈️";
    case "linkedin": return "💼";
    case "tiktok": return "🎵";
    case "kwai": return "🎬";
    default: return "💬";
  }
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Aberto", color: "#00d46a", bg: "rgba(0,212,106,0.10)" },
  pending: { label: "Pendente", color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  snoozed: { label: "Soneca", color: "#94a3b8", bg: "rgba(148,163,184,0.10)" },
  resolved: { label: "Resolvido", color: "#38bdf8", bg: "rgba(56,189,248,0.10)" },
  closed: { label: "Encerrado", color: "#64748b", bg: "rgba(100,116,139,0.10)" },
};

// ─── Mini Sparkline ──────────────────────────────────────────────────────────

function MiniSparkline({ data, color = "#00d46a", width = 80, height = 24 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data.length) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Glass Card ──────────────────────────────────────────────────────────────

function GlassCard({ children, className = "", style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Section Title ───────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)" }}>
        <Icon className="w-3.5 h-3.5" style={{ color: "#00d46a" }} />
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-1)" }}>{title}</h3>
        {subtitle && <p className="text-[10px]" style={{ color: "var(--text-4)" }}>{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Avatar Helper ───────────────────────────────────────────────────────────

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function initialsOf(name?: string): string {
  const source = (name || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return "?";
}

function DashboardAvatar({ src, name, size = 48 }: { src?: string | null; name?: string; size?: number }) {
  const [err, setErr] = useState(false);
  const hue = useMemo(() => hashHue(name || "?"), [name]);
  if (src && !err) {
    return (
      <img
        src={src}
        alt={name || ""}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, background: "var(--surface-2)" }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold flex-shrink-0"
      style={{
        width: size, height: size,
        background: `hsl(${hue} 50% 22%)`,
        color: `hsl(${hue} 70% 75%)`,
        fontSize: size * 0.38,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

// ─── Contact Hero Card ───────────────────────────────────────────────────────

function ContactHeroCard({
  conv, presence, convMode, onModeChange,
  canAssign, canClose, canReopen, canSnooze, canUpdate,
  onClaim, onUnassign, onResolve, onClose, onReopen, onSnooze, onPin, onMute,
}: {
  conv: Conversation | undefined; presence: Presence;
  convMode: "human" | "ai" | "observing";
  onModeChange: (mode: "human" | "ai" | "observing") => void;
  canAssign: boolean; canClose: boolean; canReopen: boolean; canSnooze: boolean; canUpdate: boolean;
  onClaim: () => void; onUnassign: () => void; onResolve: () => void; onClose: () => void;
  onReopen: () => void; onSnooze: () => void; onPin: () => void; onMute: () => void;
}) {
  if (!conv) return null;
  const name = conv.contact?.name || conv.push_name || conv.subject || "Atendimento";
  const avatarUrl = conv.contact?.avatar_url || conv.avatar_url;

  const actions = [
    !conv.assigned_user_id && canAssign && { icon: UserCheck, label: "Atender", onClick: onClaim, color: "#00d46a" },
    conv.assigned_user_id && canAssign && { icon: UserX, label: "Remover", onClick: onUnassign, color: "#f59e0b" },
    conv.status !== "resolved" && conv.status !== "closed" && canClose && { icon: CheckCircle2, label: "Resolver", onClick: onResolve, color: "#38bdf8" },
    conv.status === "resolved" && canClose && { icon: CheckCircle2, label: "Encerrar", onClick: onClose, color: "#64748b" },
    (conv.status === "resolved" || conv.status === "closed") && canReopen && { icon: RotateCcw, label: "Reabrir", onClick: onReopen, color: "#f59e0b" },
    conv.status === "open" && canSnooze && { icon: Clock3, label: "Soneca", onClick: onSnooze, color: "#94a3b8" },
    canUpdate && { icon: Pin, label: conv.is_pinned ? "Desfixar" : "Fixar", onClick: onPin, color: conv.is_pinned ? "#00d46a" : "var(--text-3)" },
    canUpdate && { icon: conv.is_muted ? BellOff : Bell, label: conv.is_muted ? "Reativar" : "Silenciar", onClick: onMute, color: "var(--text-3)" },
  ].filter(Boolean) as Array<{ icon: React.ElementType; label: string; onClick: () => void; color: string }>;

  return (
    <div className="space-y-3">
      {/* Row: avatar + name/status + mode + actions */}
      <div className="flex items-center gap-3">
        <DashboardAvatar src={avatarUrl} name={name} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>{name}</h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${presence.online ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"}`} />
            <span className="text-[10px]" style={{ color: "var(--text-4)" }}>
              {presence.online ? "Online" : presence.lastSeen ? `Visto ${relativeTime(presence.lastSeen)}` : "Offline"}
            </span>
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex-shrink-0">
          <div className="flex items-center rounded-lg overflow-hidden border"
            style={{ border: "1px solid var(--border-default)", background: "rgba(255,255,255,0.03)" }}>
            {([
              { id: "human" as const, label: "Humano", icon: UserCheck },
              { id: "ai" as const, label: "IA", icon: Bot },
              { id: "observing" as const, label: "Obs", icon: Eye },
            ]).map(({ id, label, icon: Icon }) => (
              <button key={id}
                onClick={() => onModeChange(id)}
                className="px-2 py-1.5 text-[10px] font-medium flex items-center gap-1 transition-all"
                style={{
                  background: convMode === id ? (id === "ai" ? "rgba(167,139,250,0.2)" : id === "human" ? "rgba(0,212,106,0.15)" : "rgba(255,255,255,0.08)") : "transparent",
                  color: convMode === id ? (id === "ai" ? "#c4b5fd" : id === "human" ? "#00d46a" : "hsl(240 15% 80%)") : "var(--text-3)",
                }}>
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions row */}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
            style={{ background: `${action.color}10`, border: `1px solid ${action.color}25`, color: action.color }}
          >
            <action.icon className="w-3 h-3" />
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Channel Journey ─────────────────────────────────────────────────────────

function ChannelJourneyCards({ conv }: { conv: Conversation | undefined }) {
  if (!conv) return null;

  // For now, show the active channel as the primary one
  const activeChannel = conv.channel_type;
  const channels = ["whatsapp", "instagram", "facebook", "telegram", "linkedin", "tiktok", "kwai"];

  return (
    <GlassCard className="p-4">
      <SectionTitle icon={Globe} title="Jornada de Canais" subtitle="Canais por onde o contato passou" />
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {channels.map((ch) => {
          const isActive = ch === activeChannel.toLowerCase();
          const color = channelColor(ch);
          return (
            <motion.div
              key={ch}
              className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl cursor-default transition-all"
              style={{
                background: isActive ? `${color}10` : "rgba(255,255,255,0.02)",
                border: `1px solid ${isActive ? `${color}40` : "rgba(255,255,255,0.04)"}`,
              }}
              whileHover={{ scale: 1.04 }}
            >
              <span className="text-xl">{channelIcon(ch)}</span>
              <span className="text-[9px] font-medium text-center leading-tight" style={{ color: isActive ? color : "var(--text-4)" }}>
                {channelLabel(ch)}
              </span>
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              )}
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─── CRM Insight Cards ───────────────────────────────────────────────────────

function CRMInsightCards({ workspaceId, contactId }: { workspaceId: string; contactId?: string }) {
  const contactQ = useQuery({
    queryKey: ["inbox-contact-crm", contactId],
    queryFn: () => crmApi.getContact(contactId!).then((r) => r.data as ContactCRM),
    enabled: !!contactId,
    staleTime: 15_000,
  });

  const dealsQ = useQuery({
    queryKey: ["inbox-contact-deals", workspaceId, contactId],
    queryFn: () =>
      dealsApi.list(workspaceId, { contact_id: contactId, status: "open,won,lost", limit: 10 }).then((r) => {
        const raw = r.data as { items?: DealRow[]; data?: DealRow[] };
        return (raw.items ?? raw.data ?? []) as DealRow[];
      }),
    enabled: !!workspaceId && !!contactId,
    staleTime: 15_000,
  });

  const contact = contactQ.data;
  const deals = dealsQ.data ?? [];
  const openDeals = deals.filter((d) => d.status === "open");
  const totalValue = openDeals.reduce((sum, d) => sum + d.value, 0);

  const cards = [
    {
      icon: TrendingUp,
      label: "Funil",
      value: contact?.funnel || "—",
      sub: contact?.stage || "",
      color: "#38bdf8",
    },
    {
      icon: Briefcase,
      label: "Deals",
      value: openDeals.length.toString(),
      sub: totalValue > 0 ? formatCurrency(totalValue, "BRL") : "",
      color: "#a78bfa",
    },
    {
      icon: Route,
      label: "Jornada",
      value: contact?.journey || "—",
      sub: "",
      color: "#f59e0b",
    },
    {
      icon: TagIcon,
      label: "Tags",
      value: contact?.tags?.length ? `${contact.tags.length}` : "0",
      sub: contact?.tags?.slice(0, 2).map((t) => t.name).join(", ") || "",
      color: "#00d46a",
    },
  ];

  return (
    <GlassCard className="p-4">
      <SectionTitle icon={BarChart3} title="CRM Insights" subtitle="Dados do contato no funil" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl p-3 transition-all hover:brightness-110"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <card.icon className="w-3.5 h-3.5" style={{ color: card.color }} />
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>{card.label}</span>
            </div>
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>{card.value}</p>
            {card.sub && <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-3)" }}>{card.sub}</p>}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Interaction Sight Timeline ──────────────────────────────────────────────

function InteractionSightTimeline({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const timelineQ = useQuery({
    queryKey: ["conversation-timeline", workspaceId, conversationId],
    queryFn: async () => {
      const r = await conversationsApi.timeline(workspaceId, conversationId, { limit: 50 });
      return r.data as { items: TimelineItem[] };
    },
    enabled: !!workspaceId && !!conversationId,
  });

  const items = timelineQ.data?.items ?? [];

  const events = useMemo(() => {
    return items.map((item) => {
      const date = new Date(item.at);
      let title = "";
      let desc = "";
      let icon = "💬";
      let color = "#00d46a";

      if (item.kind === "message") {
        const p = item.payload as any;
        title = p.direction === "in" ? "Mensagem recebida" : "Mensagem enviada";
        desc = p.content?.slice(0, 60) || "Mídia";
        icon = p.direction === "in" ? "📥" : "📤";
        color = p.direction === "in" ? "#38bdf8" : "#00d46a";
      } else if (item.kind === "note") {
        title = "Nota interna";
        desc = (item.payload as any).body?.slice(0, 60) || "";
        icon = "📝";
        color = "#f59e0b";
      } else if (item.kind === "event") {
        const p = item.payload as any;
        title = p.event_type || "Evento";
        desc = p.payload || "";
        icon = "⚡";
        color = "#a78bfa";
      }

      return { id: item.id, title, desc, icon, color, date };
    }).slice(0, 20);
  }, [items]);

  return (
    <GlassCard className="p-4">
      <SectionTitle icon={Layers} title="Sight" subtitle="Timeline de interações com o contato" />
      <div className="relative pl-4">
        {/* Vertical line */}
        <div className="absolute left-[19px] top-2 bottom-2 w-px" style={{ background: "linear-gradient(to bottom, rgba(0,212,106,0.3), transparent)" }} />
        <div className="space-y-3">
          {events.map((evt, i) => (
            <motion.div
              key={evt.id + i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="relative flex items-start gap-3"
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 z-10"
                style={{ background: `${evt.color}20`, border: `1px solid ${evt.color}40`, color: evt.color }}
              >
                {evt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium" style={{ color: "var(--text-1)" }}>{evt.title}</p>
                {evt.desc && <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{evt.desc}</p>}
                <p className="text-[9px] mt-0.5" style={{ color: "var(--text-4)" }}>
                  {evt.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · {evt.date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </motion.div>
          ))}
          {events.length === 0 && (
            <p className="text-[11px] text-center py-4" style={{ color: "var(--text-4)" }}>Nenhuma interação registrada.</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Agent Query Panel ───────────────────────────────────────────────────────

function AgentQueryPanel({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      // Use suggestAgentReply as fallback — generates a response suggestion based on conversation context
      const res = await conversationsApi.suggestAgentReply(workspaceId, conversationId);
      const data = res.data as { suggestion?: string; agent_name?: string };
      setAnswer(data.suggestion || "Não foi possível gerar uma sugestão no momento.");
    } catch {
      setAnswer("Erro ao consultar o agente. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)" }}>
            <Sparkles className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-1)" }}>Assistente AI</h3>
            <p className="text-[10px]" style={{ color: "var(--text-4)" }}>Pergunte sobre este contato</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                  placeholder="Ex: Qual o histórico de compras?"
                  className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
                />
                <button
                  onClick={ask}
                  disabled={loading || !question.trim()}
                  className="px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all"
                  style={{
                    background: loading || !question.trim() ? "var(--surface-2)" : "rgba(167,139,250,0.15)",
                    color: loading || !question.trim() ? "var(--text-4)" : "#a78bfa",
                    border: `1px solid ${loading || !question.trim() ? "var(--surface-border)" : "rgba(167,139,250,0.25)"}`,
                  }}
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Perguntar
                </button>
              </div>
              {answer && (
                <div className="rounded-xl p-3 text-xs leading-relaxed" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.12)", color: "var(--text-2)" }}>
                  {answer}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

// ─── Conversation Metrics ────────────────────────────────────────────────────

function ConversationMetrics({ conv }: { conv: Conversation | undefined }) {
  if (!conv) return null;

  const metrics = [
    { label: "Aberto em", value: conv.created_at ? relativeTime(conv.created_at) : "—" },
    { label: "Última msg", value: conv.last_message_at ? relativeTime(conv.last_message_at) : "—" },
    { label: "Prioridade", value: conv.priority || "—" },
    { label: "Reaberturas", value: conv.reopen_count ? `${conv.reopen_count}×` : "—" },
  ];

  return (
    <GlassCard className="p-4">
      <SectionTitle icon={BarChart3} title="Métricas" />
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>{m.label}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "var(--text-1)" }}>{m.value}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

interface ContactIntelligenceDashboardProps {
  conversation: Conversation | undefined;
  presence: Presence;
  canAssign: boolean;
  canClose: boolean;
  canReopen: boolean;
  canSnooze: boolean;
  canUpdate: boolean;
  onClaim: () => void;
  onUnassign: () => void;
  onResolve: () => void;
  onClose: () => void;
  onReopen: () => void;
  onSnooze: () => void;
  onPin: () => void;
  onMute: () => void;
  onAvatarClick: (url: string, name: string) => void;
  convMode?: "human" | "ai" | "observing";
  onModeChange?: (mode: "human" | "ai" | "observing") => void;
}

export function ContactIntelligenceDashboard({
  conversation,
  presence,
  canAssign,
  canClose,
  canReopen,
  canSnooze,
  canUpdate,
  onClaim,
  onUnassign,
  onResolve,
  onClose,
  onReopen,
  onSnooze,
  onPin,
  onMute,
  onAvatarClick,
  convMode = "human",
  onModeChange,
}: ContactIntelligenceDashboardProps) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const contactId = conversation?.contact?.id;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable dashboard content */}
      <div className="flex-1 overflow-auto p-4 space-y-3 custom-scrollbar">
        {/* Header: avatar + nome + modo + ações rápidas */}
        <ContactHeroCard
          conv={conversation}
          presence={presence}
          convMode={convMode}
          onModeChange={onModeChange || (() => {})}
          canAssign={canAssign}
          canClose={canClose}
          canReopen={canReopen}
          canSnooze={canSnooze}
          canUpdate={canUpdate}
          onClaim={onClaim}
          onUnassign={onUnassign}
          onResolve={onResolve}
          onClose={onClose}
          onReopen={onReopen}
          onSnooze={onSnooze}
          onPin={onPin}
          onMute={onMute}
        />

        <ChannelJourneyCards conv={conversation} />

        {/* Agent Orchestrator */}
        {conversation?.id && (
          <AgentOrchestrator
            conversationId={conversation.id}
            instanceId={conversation.instance_id}
            convMode={convMode}
            onModeChange={onModeChange || (() => {})}
          />
        )}

        {/* CRM Quick Actions */}
        {conversation?.id && (
          <CRMQuickActions
            conversationId={conversation.id}
            contactId={contactId}
          />
        )}

        {/* Campaigns & Journeys */}
        <CampaignJourneyPanel contactId={contactId} />

        <ConversationMetrics conv={conversation} />

        {wsId && conversation?.id && (
          <InteractionSightTimeline workspaceId={wsId} conversationId={conversation.id} />
        )}

        {wsId && conversation?.id && (
          <AgentQueryPanel workspaceId={wsId} conversationId={conversation.id} />
        )}
      </div>
    </div>
  );
}
