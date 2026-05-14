"use client";

import { useState, Suspense, useEffect, useRef, useMemo } from "react";
import { useTilt } from "@/hooks/useTilt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { instancesApi, serversApi } from "@/lib/api";
import { Plus, Globe, AlertTriangle, Smartphone, Trash2, QrCode, RefreshCw, Server as ServerIcon, X, MessageSquare, Hash, Shield, Wifi, Copy, Check, Activity, Zap } from "lucide-react";
import { showConfirm } from "@/lib/confirm";
import { usePreferences } from "@/lib/preferences";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Instance, Server, ChannelType } from "@/types";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const CHANNEL_META: Record<ChannelType, { label: string; color: string }> = {
  whatsapp:      { label: "WhatsApp Business",  color: "#25d366" },
  waba:          { label: "WhatsApp API",       color: "#0088ff" },
  instagram:     { label: "Instagram Profile",  color: "#e1306c" },
  instagram_api: { label: "Instagram API",      color: "#cc2366" },
  facebook:      { label: "Facebook",           color: "#1877f2" },
  telegram:      { label: "Telegram",           color: "#229ed9" },
  linkedin:      { label: "LinkedIn",           color: "#0a66c2" },
  tiktok:        { label: "TikTok",             color: "#ff0050" },
  kwai:          { label: "Kwai",               color: "#ff6600" },
};
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { QRCodeModal } from "@/components/instances/QRCodeModal";
import { CreateInstanceModal } from "@/components/instances/CreateInstanceModal";
import { useInstanceStatus } from "@/contexts/WebSocketContext";

const STATUS_MAP: Record<string, { label: string; cls: string; dotColor: string }> = {
  connected:    { label: "Conectado",    cls: "status-connected",    dotColor: "#2563EB" },
  connecting:   { label: "Conectando",   cls: "status-connecting",   dotColor: "#f59e0b" },
  disconnected: { label: "Desconectado", cls: "status-disconnected", dotColor: "#64748b" },
  banned:       { label: "Banido",       cls: "status-banned",       dotColor: "#ef4444" },
};

// Seeded pseudo-random for deterministic sparklines per instance
function seededRand(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297 + 233) * 134775813;
  return x - Math.floor(x);
}

function MiniSparkline({ base, color, instanceId }: { base: number; color: string; instanceId: string }) {
  const seed = instanceId.charCodeAt(0) + instanceId.charCodeAt(1) * 7;
  const data = Array.from({ length: 8 }, (_, i) =>
    Math.max(0, Math.round(base * (0.5 + seededRand(seed, i) * 0.8)))
  );
  const w = 72, h = 20;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 6);
    return `${x},${y}`;
  });
  const polyPts = pts.join(" ");
  const fillPts = `0,${h} ${polyPts} ${w},${h}`;
  const gradId = `spk-${instanceId.slice(0, 8)}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#${gradId})`} />
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]}
        r="2.5" fill={color} />
    </svg>
  );
}

function SignalBars({ status }: { status: string }) {
  const strength = status === "connected" ? 3 : status === "connecting" ? 1 : 0;
  const color = status === "connected" ? "#2563EB" : status === "connecting" ? "#f59e0b" : "#475569";
  const bars = [
    { height: 6, delay: "0ms" },
    { height: 10, delay: "150ms" },
    { height: 14, delay: "300ms" },
  ];
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 16 }}>
      {bars.map((bar, i) => (
        <div
          key={i}
          className="w-[4px] rounded-sm transition-all duration-700"
          style={{
            height: bar.height,
            background: i < strength ? color : "var(--border-default)",
            opacity: i < strength ? 1 : 0.4,
            boxShadow: i < strength && status === "connected" ? `0 0 4px ${color}80` : "none",
            transitionDelay: bar.delay,
          }}
        />
      ))}
    </div>
  );
}

function StatusRing({ status, children }: { status: string; children: React.ReactNode }) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const isBanned = status === "banned";
  const color = isConnected ? "#2563EB" : isConnecting ? "#f59e0b" : isBanned ? "#ef4444" : "#334155";
  const size = 52;
  const r = 23;
  const circ = 2 * Math.PI * r;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg
        className="absolute inset-0"
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--border-subtle)" strokeWidth="2" />

        {/* Connected: slow orbit arc */}
        {isConnected && (
          <circle cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth="2"
            strokeOpacity="0.55"
            strokeDasharray={`${circ * 0.25} ${circ * 0.75}`}
            strokeLinecap="round">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${size / 2} ${size / 2}`}
              to={`360 ${size / 2} ${size / 2}`}
              dur="3.5s"
              repeatCount="indefinite"
            />
          </circle>
        )}

        {/* Connecting: fast spinning arc */}
        {isConnecting && (
          <circle cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth="2"
            strokeDasharray={`${circ * 0.45} ${circ * 0.55}`}
            strokeLinecap="round">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${size / 2} ${size / 2}`}
              to={`360 ${size / 2} ${size / 2}`}
              dur="0.9s"
              repeatCount="indefinite"
            />
          </circle>
        )}

        {/* Banned / disconnected: static partial arc */}
        {(isBanned || (!isConnected && !isConnecting)) && (
          <circle cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth="1.5"
            strokeOpacity="0.25"
            strokeDasharray={`${circ * 0.6} ${circ * 0.4}`}
          />
        )}
      </svg>
      {/* Inner content */}
      <div className="absolute inset-2 rounded-full flex items-center justify-center"
        style={{
          background: isConnected ? "rgba(37, 99, 235,0.10)" : "var(--surface-2)",
          border: `1px solid ${isConnected ? "rgba(37, 99, 235,0.20)" : "var(--border-default)"}`,
        }}>
        {children}
      </div>
    </div>
  );
}

interface InstanceProfile { profile_pic_url?: string; conversations?: number; phone_number?: string; identifier?: string; channel?: string }

function InstanceCard({
  instance, onQR, onDeleted, index, serverName, isReconnecting,
}: {
  instance: Instance; onQR: (id: string) => void; onDeleted: () => void;
  index: number; serverName?: string; isReconnecting?: boolean;
}) {
  const { instanceStatuses } = useInstanceStatus();
  const wsStatus = instanceStatuses[instance.id];
  let currentStatus = instance.status;
  if (wsStatus) {
    if (wsStatus === "connected") {
      currentStatus = "connected";
    } else if (instance.status !== "connected") {
      currentStatus = wsStatus as typeof currentStatus;
    }
  }
  const s = STATUS_MAP[currentStatus] ?? STATUS_MAP.disconnected;
  const isConnected = currentStatus === "connected";
  const isConnecting = currentStatus === "connecting";

  const { data: profile } = useQuery<InstanceProfile>({
    queryKey: ["instance-profile", instance.id],
    queryFn: () => instancesApi.profile(instance.id).then((r) => r.data),
    enabled: isConnected,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => instancesApi.delete(instance.id),
    onSuccess: () => { toast.success("Instância removida"); onDeleted(); },
    onError: () => toast.error("Erro ao remover instância"),
  });

  const [idCopied, setIdCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tilt = useTilt(4);

  const copyId = () => {
    navigator.clipboard.writeText(instance.id);
    setIdCopied(true);
    toast.success("ID copiado!");
    setTimeout(() => setIdCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!await showConfirm(`Remover a instância "${instance.name}"? Esta ação é irreversível.`, { title: "Remover instância", confirmLabel: "Remover" })) return;
    deleteMutation.mutate();
  };

  const connectedSince = instance.connected_at;
  const tokenPrefix = instance.token ? instance.token.slice(0, 8) + "…" : null;
  const convBase = profile?.conversations ?? Math.abs(instance.id.charCodeAt(3) % 40 + 5);
  const statusColor = s.dotColor;

  // Uptime string
  const uptime = useMemo(() => {
    if (!connectedSince || !isConnected) return null;
    const ms = Date.now() - new Date(connectedSince).getTime();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, [connectedSince, isConnected]);

  return (
    <div
      ref={tilt.ref as React.RefObject<HTMLDivElement>}
      className="group relative flex flex-col rounded-2xl overflow-hidden animate-fade-in-up"
      style={{
        background: isReconnecting
          ? "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(255,255,255,0.02) 100%)"
          : "linear-gradient(135deg, var(--border-default) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: isConnected
          ? "1px solid rgba(37, 99, 235,0.22)"
          : isReconnecting
            ? "1px solid rgba(245,158,11,0.22)"
            : "1px solid var(--border-default)",
        borderRadius: "20px",
        boxShadow: hovered
          ? isConnected
            ? "0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(37, 99, 235,0.12), inset 0 1px 0 var(--border-strong)"
            : "0 16px 40px rgba(0,0,0,0.45), inset 0 1px 0 var(--border-strong)"
          : isConnected
            ? "0 0 0 1px rgba(37, 99, 235,0.06), 0 8px 24px rgba(0,0,0,0.30), inset 0 1px 0 var(--border-default)"
            : "0 8px 24px rgba(0,0,0,0.30), inset 0 1px 0 var(--border-default)",
        animationDelay: `${index * 60}ms`,
        animationFillMode: "both",
        transformStyle: "preserve-3d",
        transition: "border-color 0.4s ease, box-shadow 0.3s ease",
      }}
      onMouseMove={e => { setHovered(true); tilt.onMouseMove(e as React.MouseEvent<HTMLElement>); }}
      onMouseLeave={() => { setHovered(false); tilt.onMouseLeave(); }}
    >
      {/* Top shimmer line */}
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background: isConnected
            ? "linear-gradient(90deg, transparent, rgba(37, 99, 235,0.45), transparent)"
            : isReconnecting
              ? "linear-gradient(90deg, transparent, rgba(245,158,11,0.35), transparent)"
              : "linear-gradient(90deg, transparent, var(--border-default), transparent)"
        }} />

      {/* Reconnecting shimmer overlay */}
      {isReconnecting && (
        <div className="absolute inset-0 pointer-events-none rounded-2xl overflow-hidden">
          <div style={{
            position: "absolute", top: 0, left: "-100%", width: "100%", height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.06), transparent)",
            animation: "shimmer 1.8s ease-in-out infinite",
          }} />
        </div>
      )}

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Status ring + avatar */}
            <StatusRing status={currentStatus}>
              {profile?.profile_pic_url ? (
                <img src={profile.profile_pic_url} alt=""
                  className="w-full h-full rounded-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <>
                  <Smartphone className="w-4 h-4" style={{ color: isConnected ? "#2563EB" : "#64748b" }} />
                  {instance.proxy_mode === "residencial" && instance.proxy_status === "ok" && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: "#a855f7" }}>
                      <Shield className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                </>
              )}
            </StatusRing>

            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base leading-tight truncate max-w-[160px]"
                style={{ color: "hsl(240 15% 95%)" }}>
                {instance.name}
              </h3>
              {(profile?.phone_number || profile?.identifier) && (
                <p className="text-xs mt-0.5 font-medium" style={{ color: "#2563EB" }}>
                  {profile.identifier ? `@${profile.identifier}` : profile.phone_number}
                </p>
              )}
              <button onClick={copyId} className="flex items-center gap-1 mt-1 group/id" title="Clique para copiar o ID">
                <code className="text-[10px] font-mono px-1.5 py-0.5 rounded-md truncate max-w-[160px]"
                  style={{ background: "var(--surface-2)", color: "hsl(240 8% 48%)" }}>
                  {instance.id}
                </code>
                {idCopied
                  ? <Check className="w-3 h-3 flex-shrink-0" style={{ color: "#2563EB" }} />
                  : <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/id:opacity-100 transition-opacity" style={{ color: "var(--text-4)" }} />
                }
              </button>
            </div>
          </div>

          {/* Signal bars + status label */}
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0 mt-0.5">
            <SignalBars status={currentStatus} />
            <span className="text-[10px] font-medium" style={{ color: s.dotColor }}>
              {isConnecting ? (
                <span className="flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  {s.label}
                </span>
              ) : s.label}
            </span>
          </div>
        </div>

        {/* Uptime bar for connected */}
        {isConnected && uptime && (
          <div className="flex items-center gap-2 -mt-1">
            <div className="flex items-center gap-1.5">
              <Zap className="w-2.5 h-2.5" style={{ color: "#2563EB", opacity: 0.7 }} />
              <span className="text-[10px] font-mono" style={{ color: "hsl(240 8% 42%)" }}>
                uptime {uptime}
              </span>
            </div>
            {profile?.conversations != null && (
              <span className="text-[10px]" style={{ color: "var(--text-4)" }}>
                · {profile.conversations} convs
              </span>
            )}
          </div>
        )}

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {(() => {
            const ch = CHANNEL_META[instance.channel] ?? CHANNEL_META.whatsapp;
            return (
              <span className="status-badge" style={{
                background: `${ch.color}14`,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                color: ch.color,
                borderColor: `${ch.color}35`,
                borderRadius: "10px",
              }}>
                <Hash className="w-3 h-3" />
                {ch.label}
              </span>
            );
          })()}
          {serverName && (
            <span className="status-badge" style={{
              background: "rgba(167,139,250,0.08)",
              color: "#a78bfa",
              borderColor: "rgba(167,139,250,0.18)",
              borderRadius: "10px",
            }}>
              <ServerIcon className="w-3 h-3" />
              {serverName}
            </span>
          )}
          {instance.use_global_proxy && instance.proxy_status === "ok" && (
            <span className="status-badge" style={{
              background: "rgba(37, 99, 235,0.08)",
              color: "#2563EB",
              borderColor: "rgba(37, 99, 235,0.18)",
              borderRadius: "10px",
            }}>
              <Globe className="w-3 h-3" />
              Global {instance.global_proxy?.name || ""}
            </span>
          )}
          {instance.proxy_enabled && instance.proxy_status === "ok" && (
            instance.proxy_mode === "residencial" ? (
              <span className="status-badge" style={{
                background: "rgba(168,85,247,0.08)",
                color: "#a855f7",
                borderColor: "rgba(168,85,247,0.18)",
                borderRadius: "10px",
              }}>
                <Shield className="w-3 h-3" />
                Residencial
                {(() => {
                  const username = instance.proxy_username || "";
                  const countryMatch = username.match(/country-([a-z]{2})/i);
                  const country = countryMatch ? countryMatch[1].toUpperCase() : "BR";
                  const flags: Record<string, string> = {
                    BR: "🇧🇷", US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷",
                    CA: "🇨🇦", AU: "🇦🇺", JP: "🇯🇵", IN: "🇮🇳", MX: "🇲🇽",
                    AR: "🇦🇷", CL: "🇨🇱", CO: "🇨🇴", PT: "🇵🇹", ES: "🇪🇸",
                  };
                  return <span className="ml-1 text-[10px]">{flags[country] || "🌍"} {country}</span>;
                })()}
              </span>
            ) : (
              <span className="status-badge" style={{
                background: "rgba(59,130,246,0.08)",
                color: "#60a5fa",
                borderColor: "rgba(59,130,246,0.18)",
                borderRadius: "10px",
              }}>
                <Globe className="w-3 h-3" />
                Proxy manual
              </span>
            )
          )}
          {instance.proxy_enabled && instance.proxy_status === "failed" && (
            <span className="status-badge" style={{
              background: "rgba(249,115,22,0.08)",
              color: "#fb923c",
              borderColor: "rgba(249,115,22,0.18)",
              borderRadius: "10px",
            }}>
              <AlertTriangle className="w-3 h-3" />
              Proxy erro
            </span>
          )}
        </div>

        {/* Throughput sparkline */}
        <div className="flex items-end justify-between gap-2 px-0.5"
          style={{ borderTop: "1px solid var(--input)", paddingTop: 10 }}>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider font-medium"
              style={{ color: "hsl(240 8% 36%)" }}>
              <Activity className="w-2.5 h-2.5 inline-block mr-1" style={{ verticalAlign: "middle" }} />
              Atividade 7d
            </span>
            <span className="text-xs font-semibold" style={{ color: statusColor }}>
              {convBase} msgs
            </span>
          </div>
          <MiniSparkline
            base={convBase}
            color={statusColor}
            instanceId={instance.id}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Link
            href={`/instances/${instance.id}`}
            className="flex-1 text-center text-xs font-medium py-2 px-3 rounded-xl transition-all duration-150"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
              color: "hsl(240 8% 62%)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--surface-3)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 93%)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 62%)";
            }}
          >
            Gerenciar
          </Link>

          {instance.status !== "connected" && instance.channel === "whatsapp" && (
            <button
              onClick={() => onQR(instance.id)}
              className="flex items-center gap-1.5 text-xs font-medium py-2 px-3 rounded-xl transition-all duration-150"
              style={{
                background: "rgba(37, 99, 235,0.08)",
                border: "1px solid rgba(37, 99, 235,0.15)",
                color: "#2563EB",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(37, 99, 235,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(37, 99, 235,0.08)")}
            >
              <QrCode className="w-3.5 h-3.5" />
              QR
            </button>
          )}

          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="p-2 rounded-xl transition-all duration-150 disabled:opacity-40"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
              color: "#64748b",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
              (e.currentTarget as HTMLElement).style.color = "#ef4444";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.15)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
              (e.currentTarget as HTMLElement).style.color = "#64748b";
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Fleet health bar shown at the top when there are instances
function FleetHealthBar({ instances, reconnectingIds }: {
  instances: Instance[];
  reconnectingIds: Set<string>;
}) {
  const connected = instances.filter(i => i.status === "connected").length;
  const connecting = instances.filter(i => i.status === "connecting").length;
  const disconnected = instances.filter(i => i.status === "disconnected").length;
  const banned = instances.filter(i => i.status === "banned").length;
  const total = instances.length;
  if (total === 0) return null;

  const pct = Math.round((connected / total) * 100);
  const healthColor = pct === 100 ? "#2563EB" : pct >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
      style={{
        background: "linear-gradient(135deg, var(--input) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid var(--border-default)",
        backdropFilter: "blur(16px)",
      }}>
      {/* Left: Health score */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="relative w-12 h-12">
          <svg className="absolute inset-0 -rotate-90" width={48} height={48} viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-subtle)" strokeWidth="4" />
            <circle cx="24" cy="24" r="20" fill="none"
              stroke={healthColor} strokeWidth="4"
              strokeDasharray={`${(pct / 100) * 2 * Math.PI * 20} ${2 * Math.PI * 20}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] font-bold" style={{ color: healthColor }}>{pct}%</span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Fleet Health</p>
          <p className="text-[11px] mt-0.5" style={{ color: "hsl(240 8% 46%)" }}>
            {connected} online de {total}
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="hidden sm:block w-px self-stretch" style={{ background: "var(--border-default)" }} />

      {/* Stats */}
      <div className="flex items-center gap-6 flex-wrap">
        {[
          { count: connected, label: "Online", color: "#2563EB" },
          { count: connecting + reconnectingIds.size, label: "Conectando", color: "#f59e0b" },
          { count: disconnected, label: "Offline", color: "#64748b" },
          { count: banned, label: "Banido", color: "#ef4444" },
        ].map(({ count, label, color }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: color, opacity: count > 0 ? 1 : 0.3 }} />
            <span className="text-sm font-semibold" style={{ color: count > 0 ? "var(--text-1)" : "hsl(240 8% 36%)" }}>
              {count}
            </span>
            <span className="text-[11px]" style={{ color: "hsl(240 8% 42%)" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Health bar full width at bottom */}
      <div className="sm:ml-auto flex-shrink-0 hidden sm:flex items-center gap-2">
        <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-default)" }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${healthColor}99, ${healthColor})`,
              boxShadow: `0 0 8px ${healthColor}60`,
            }} />
        </div>
      </div>
    </div>
  );
}

function InstancesContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = usePreferences();
  const serverFilter = searchParams.get("server");

  const [createOpen, setCreateOpen] = useState(false);
  const [qrInstanceId, setQrInstanceId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelType | "all">("all");
  const [reconnectingIds, setReconnectingIds] = useState<Set<string>>(new Set());
  const { currentWorkspace } = useWorkspace();

  const { data: instances = [], isLoading } = useQuery<Instance[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then((r) => r.data),
  });

  const { data: servers = [] } = useQuery<Server[]>({
    queryKey: ["servers", currentWorkspace?.id],
    queryFn: () => serversApi.list(currentWorkspace?.id).then((r) => r.data),
  });

  const reconnectMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      await instancesApi.reconnect(instanceId);
      return instanceId;
    },
    onSuccess: (instanceId) => {
      setTimeout(() => {
        setReconnectingIds(prev => { const next = new Set(prev); next.delete(instanceId); return next; });
        queryClient.invalidateQueries({ queryKey: ["instances"] });
      }, 3000);
    },
    onError: (_, instanceId) => {
      setReconnectingIds(prev => { const next = new Set(prev); next.delete(instanceId); return next; });
    },
  });

  const hasAutoReconnected = useRef(false);
  useEffect(() => {
    if (hasAutoReconnected.current) return;
    if (isLoading || instances.length === 0) return;
    hasAutoReconnected.current = true;

    const toReconnect = instances.filter((i) => (i.channel === "whatsapp" || !i.channel) && i.status === "disconnected");
    if (toReconnect.length === 0) return;

    setReconnectingIds(new Set(toReconnect.map(i => i.id)));
    toReconnect.forEach((inst, idx) => {
      setTimeout(() => { reconnectMutation.mutate(inst.id); }, idx * 500);
    });

    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["instances"] });
    }, toReconnect.length * 500 + 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, instances]);

  const serverMap = Object.fromEntries(servers.map((s) => [s.id, s]));
  const activeServer = serverFilter ? serverMap[serverFilter] : null;
  const activeChannels = [...new Set(instances.map((i) => i.channel ?? "whatsapp"))] as ChannelType[];

  const filtered = instances
    .filter((i) => !serverFilter || i.server_id === serverFilter)
    .filter((i) => channelFilter === "all" || (i.channel ?? "whatsapp") === channelFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
        <div>
          {/* Título "Instâncias" agora no ModuleHeader (layout). */}
          <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>
            Gerencie suas conexões de canal
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {servers.length > 0 && (
            <select
              value={serverFilter || ""}
              onChange={(e) => {
                if (e.target.value) router.push(`/instances?server=${e.target.value}`);
                else router.push("/instances");
              }}
              className="input-field text-sm py-2 pr-8 flex-1 sm:flex-none"
              style={{ minWidth: 140 }}
            >
              <option value="">Todos os servers</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-all duration-150 active:scale-[0.97] whitespace-nowrap flex-1 sm:flex-none"
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235,0.20), rgba(37, 99, 235,0.08))",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(37, 99, 235,0.30)",
              boxShadow: "0 4px 16px rgba(37, 99, 235,0.18), inset 0 1px 0 var(--border-strong)",
              color: "#2563EB",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(37, 99, 235,0.28), rgba(37, 99, 235,0.12))"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(37, 99, 235,0.20), rgba(37, 99, 235,0.08))"; }}
          >
            <Plus className="w-4 h-4" />
            {t("instances_new")}
          </button>
        </div>
      </div>

      {/* Fleet health */}
      {!isLoading && instances.length > 0 && (
        <FleetHealthBar instances={filtered} reconnectingIds={reconnectingIds} />
      )}

      {/* Channel filter tabs */}
      {activeChannels.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", ...activeChannels] as (ChannelType | "all")[]).map((ch) => {
            const meta = ch === "all" ? null : CHANNEL_META[ch];
            const isActive = channelFilter === ch;
            return (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all duration-150"
                style={isActive ? {
                  background: meta ? `${meta.color}15` : "var(--border-default)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  color: meta ? meta.color : "hsl(240 15% 93%)",
                  border: `1px solid ${meta ? `${meta.color}35` : "var(--border-strong)"}`,
                  borderRadius: "10px",
                } : {
                  background: "var(--input)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  color: "var(--text-3)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "10px",
                }}
              >
                {ch === "all" ? "Todos" : meta?.label}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "var(--surface-2)" }}>
                  {ch === "all"
                    ? instances.length
                    : instances.filter((i) => (i.channel ?? "whatsapp") === ch).length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Server filter badge */}
      {activeServer && (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Filtrando por server:</span>
          <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg"
            style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
            <ServerIcon className="w-3 h-3" />
            {activeServer.name}
            <button onClick={() => router.push("/instances")} className="ml-0.5 transition-opacity hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl p-5 flex flex-col gap-4"
              style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-[52px] h-[52px] rounded-full flex-shrink-0" style={{ background: "var(--surface-2)" }} />
                  <div className="space-y-2">
                    <div className="h-3 rounded-full w-28" style={{ background: "var(--surface-2)" }} />
                    <div className="h-2 rounded-full w-20" style={{ background: "var(--surface-3)" }} />
                    <div className="h-2 rounded-full w-32" style={{ background: "var(--surface-3)" }} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-end gap-[3px] h-4">
                    {[6, 10, 14].map(h => <div key={h} className="w-[4px] rounded-sm" style={{ height: h, background: "var(--surface-2)" }} />)}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <div className="h-5 rounded-full w-24" style={{ background: "var(--surface-2)" }} />
                <div className="h-5 rounded-full w-20" style={{ background: "var(--surface-2)" }} />
              </div>
              <div className="h-6 rounded-lg w-full" style={{ background: "var(--surface-2)", marginTop: 4 }} />
              <div className="flex gap-2 mt-auto">
                <div className="flex-1 h-8 rounded-xl" style={{ background: "var(--surface-2)" }} />
                <div className="w-8 h-8 rounded-xl" style={{ background: "var(--surface-2)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-14 text-center animate-fade-in-up"
          style={{ background: "var(--surface-solid)", border: "1px dashed var(--border-default)" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}>
            <Smartphone className="w-6 h-6" style={{ color: "hsl(240 8% 35%)" }} />
          </div>
          <p className="font-medium text-sm" style={{ color: "hsl(240 8% 70%)" }}>
            {activeServer ? `Nenhuma instância em "${activeServer.name}"` : "Nenhuma instância ainda"}
          </p>
          <p className="text-sm mt-1.5 mb-6" style={{ color: "hsl(240 8% 42%)" }}>
            Crie sua primeira instância para começar a usar o WhatsApp API
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-all active:scale-[0.97]"
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235,0.20), rgba(37, 99, 235,0.08))",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(37, 99, 235,0.30)",
              boxShadow: "0 4px 16px rgba(37, 99, 235,0.18), inset 0 1px 0 var(--border-strong)",
              color: "#2563EB",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(37, 99, 235,0.28), rgba(37, 99, 235,0.12))"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(37, 99, 235,0.20), rgba(37, 99, 235,0.08))"; }}
          >
            <Plus className="w-4 h-4" />
            Criar primeira instância
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((inst, i) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              index={i}
              serverName={inst.server_id && !activeServer ? (inst.server?.name ?? serverMap[inst.server_id]?.name) : undefined}
              onQR={(id) => setQrInstanceId(id)}
              onDeleted={() => queryClient.invalidateQueries({ queryKey: ["instances"] })}
              isReconnecting={reconnectingIds.has(inst.id)}
            />
          ))}
        </div>
      )}

      <CreateInstanceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["instances"] })}
        workspaceId={currentWorkspace?.id}
      />
      {qrInstanceId && (
        <QRCodeModal instanceId={qrInstanceId} onClose={() => setQrInstanceId(null)} />
      )}
    </div>
  );
}

export default function InstancesPage() {
  return (
    <Suspense>
      <InstancesContent />
    </Suspense>
  );
}
