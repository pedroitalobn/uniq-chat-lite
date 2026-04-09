"use client";

import { useState, Suspense, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { instancesApi, serversApi } from "@/lib/api";
import { Plus, Globe, AlertTriangle, Smartphone, Trash2, QrCode, RefreshCw, Server as ServerIcon, X, MessageSquare, Hash, Shield, Wifi, Copy, Check } from "lucide-react";
import { showConfirm } from "@/lib/confirm";
import { usePreferences } from "@/lib/preferences";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Instance, Server, ChannelType } from "@/types";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const CHANNEL_META: Record<ChannelType, { label: string; color: string }> = {
  whatsapp:  { label: "WhatsApp",  color: "#25d366" },
  instagram: { label: "Instagram", color: "#e1306c" },
  facebook:  { label: "Facebook",  color: "#1877f2" },
  telegram:  { label: "Telegram",  color: "#229ed9" },
  linkedin:  { label: "LinkedIn",  color: "#0a66c2" },
  tiktok:    { label: "TikTok",    color: "#ff0050" },
  kwai:      { label: "Kwai",      color: "#ff6600" },
};
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { QRCodeModal } from "@/components/instances/QRCodeModal";
import { CreateInstanceModal } from "@/components/instances/CreateInstanceModal";
import { useInstanceStatus } from "@/contexts/WebSocketContext";

const STATUS_MAP: Record<string, { label: string; cls: string; dotColor: string }> = {
  connected:    { label: "Conectado",    cls: "status-connected",    dotColor: "var(--green)" },
  connecting:   { label: "Conectando",   cls: "status-connecting",   dotColor: "#f59e0b" },
  disconnected: { label: "Desconectado", cls: "status-disconnected", dotColor: "#64748b" },
  banned:       { label: "Banido",       cls: "status-banned",       dotColor: "#ef4444" },
};

interface InstanceProfile { profile_pic_url?: string; conversations?: number; phone_number?: string }

function InstanceCard({
  instance, onQR, onDeleted, index, serverName,
}: {
  instance: Instance; onQR: (id: string) => void; onDeleted: () => void;
  index: number; serverName?: string;
}) {
  const { instanceStatuses } = useInstanceStatus();
  // Use real-time status from WebSocket, fall back to instance.status
  const realTimeStatus = instanceStatuses[instance.id];
  const currentStatus = realTimeStatus || instance.status;
  const s = STATUS_MAP[currentStatus] ?? STATUS_MAP.disconnected;
  const isConnected = currentStatus === "connected";

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

  return (
    <div className="group relative flex flex-col rounded-2xl overflow-hidden transition-all duration-200 animate-fade-in-up"
      style={{
        background: "hsl(240 18% 6%)",
        border: isConnected ? "1px solid rgba(0,212,106,0.15)" : "1px solid hsl(240 12% 13%)",
        boxShadow: isConnected
          ? "0 0 0 1px rgba(0,212,106,0.06), 0 4px 24px rgba(0,0,0,0.3)"
          : "0 4px 24px rgba(0,0,0,0.25)",
        animationDelay: `${index * 60}ms`,
        animationFillMode: "both",
      }}
    >
      {isConnected && (
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(0,212,106,0.4), transparent)" }} />
      )}

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Profile avatar or icon */}
            <div className="relative w-10 h-10 flex-shrink-0">
              {profile?.profile_pic_url ? (
                <img src={profile.profile_pic_url} alt="" className="w-10 h-10 rounded-xl object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-10 h-10 rounded-xl flex items-center justify-center relative"
                  style={{
                    background: isConnected ? "rgba(0,212,106,0.1)" : "rgba(255,255,255,0.04)",
                    border: isConnected ? "1px solid rgba(0,212,106,0.2)" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                  <Smartphone className="w-4 h-4" style={{ color: isConnected ? "var(--green)" : "#64748b" }} />
                  {instance.proxy_mode === "residencial" && instance.proxy_status === "ok" && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px]"
                      style={{ background: "#a855f7", color: "white" }}>
                      <Shield className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
              )}
              {isConnected && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[hsl(240_18%_6%)]"
                  style={{ background: "var(--green)" }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base leading-tight" style={{ color: "hsl(240 15% 95%)" }}>
                {instance.name}
              </h3>
              {profile?.phone_number && profile.phone_number !== instance.name && (
                <p className="text-xs mt-0.5 font-medium" style={{ color: "var(--green)" }}>
                  {profile.phone_number}
                </p>
              )}
              {/* Instance ID - destacado */}
              <button
                onClick={copyId}
                className="flex items-center gap-1 mt-1 group/id"
                title="Clique para copiar o ID"
              >
                <code className="text-[10px] font-mono px-1.5 py-0.5 rounded-md truncate max-w-[180px]"
                  style={{ background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 50%)" }}>
                  {instance.id}
                </code>
                {idCopied ? (
                  <Check className="w-3 h-3 flex-shrink-0" style={{ color: "var(--green)" }} />
                ) : (
                  <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/id:opacity-100 transition-opacity" style={{ color: "hsl(240 8% 40%)" }} />
                )}
              </button>
              {profile?.conversations != null && profile.conversations > 0 && (
                <p className="flex items-center gap-1 text-[10px] mt-1" style={{ color: "hsl(240 8% 38)" }}>
                  <MessageSquare className="w-2.5 h-2.5" />
                  {profile.conversations} conversa{profile.conversations !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>

          {/* Status dot */}
          <div className="relative flex-shrink-0 mt-0.5">
            <div className={cn("w-2.5 h-2.5 rounded-full", isConnected && "ring-pulse")}
              style={{ background: s.dotColor }} />
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {/* Channel badge */}
          {(() => {
            const ch = CHANNEL_META[instance.channel] ?? CHANNEL_META.whatsapp;
            return (
              <span className="status-badge" style={{
                background: `${ch.color}12`,
                color: ch.color,
                borderColor: `${ch.color}30`,
              }}>
                <Hash className="w-3 h-3" />
                {ch.label}
              </span>
            );
          })()}
          <span className={cn("status-badge", s.cls)}>
            {currentStatus === "connecting"
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dotColor }} />
            }
            {s.label}
          </span>
          {serverName && (
            <span className="status-badge" style={{
              background: "rgba(167,139,250,0.08)",
              color: "#a78bfa",
              borderColor: "rgba(167,139,250,0.18)",
            }}>
              <ServerIcon className="w-3 h-3" />
              {serverName}
            </span>
          )}
          {instance.proxy_enabled && instance.proxy_status === "ok" && (
            instance.proxy_mode === "residencial" ? (
              <span className="status-badge" style={{
                background: "rgba(168,85,247,0.08)",
                color: "#a855f7",
                borderColor: "rgba(168,85,247,0.18)",
              }}>
                <Shield className="w-3 h-3" />
                Residencial
                {(() => {
                  // Extract country from proxy_host or proxy_username
                  const username = instance.proxy_username || "";
                  const countryMatch = username.match(/country-([a-z]{2})/i);
                  const country = countryMatch ? countryMatch[1].toUpperCase() : "BR";
                  const flags: Record<string, string> = {
                    BR: "🇧🇷", US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷",
                    CA: "🇨🇦", AU: "🇦🇺", JP: "🇯🇵", IN: "🇮🇳", MX: "🇲🇽",
                    AR: "🇦🇷", CL: "🇨🇱", CO: "🇨🇴", PT: "🇵🇹", ES: "🇪🇸",
                  };
                  return (
                    <span className="ml-1 text-[10px]">{flags[country] || "🌍"} {country}</span>
                  );
                })()}
              </span>
            ) : (
              <span className="status-badge" style={{
                background: "rgba(59,130,246,0.08)",
                color: "#60a5fa",
                borderColor: "rgba(59,130,246,0.18)",
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
            }}>
              <AlertTriangle className="w-3 h-3" />
              Proxy erro
            </span>
          )}
          {instance.proxy_enabled && instance.proxy_status === "untested" && (
            <span className="status-badge" style={{
              background: "rgba(234,179,8,0.08)",
              color: "#fbbf24",
              borderColor: "rgba(234,179,8,0.18)",
            }}>
              <Wifi className="w-3 h-3" />
              Proxy teste
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-auto pt-1">
          <Link
            href={`/instances/${instance.id}`}
            className="flex-1 text-center text-xs font-medium py-2 px-3 rounded-xl transition-all duration-150"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "hsl(240 8% 62%)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 93%)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 62%)";
            }}
          >
            Gerenciar
          </Link>

          {!isConnected && (
            <button
              onClick={() => onQR(instance.id)}
              className="flex items-center gap-1.5 text-xs font-medium py-2 px-3 rounded-xl transition-all duration-150"
              style={{
                background: "rgba(0,212,106,0.08)",
                border: "1px solid rgba(0,212,106,0.15)",
                color: "var(--green)",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,106,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,212,106,0.08)")}
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
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
              color: "#64748b",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
              (e.currentTarget as HTMLElement).style.color = "#ef4444";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.15)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
              (e.currentTarget as HTMLElement).style.color = "#64748b";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
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
    onSuccess: () => {
      // Refresh list after a delay to let WhatsApp connection settle
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["instances"] });
      }, 3000);
    },
  });

  // Auto-reconnect disconnected instances ONCE on page load
  const hasAutoReconnected = useRef(false);
  useEffect(() => {
    if (hasAutoReconnected.current) return;
    if (isLoading || instances.length === 0) return;

    hasAutoReconnected.current = true;

    const toReconnect = instances.filter((i) => i.status === "disconnected");
    if (toReconnect.length === 0) return;

    console.log("[Instances] Auto-reconnecting", toReconnect.length, "disconnected instances");

    // Fire reconnects with a small stagger to avoid hammering the backend
    toReconnect.forEach((inst, idx) => {
      setTimeout(() => {
        reconnectMutation.mutate(inst.id);
      }, idx * 500);
    });

    // Final refresh after all reconnects had time to settle
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["instances"] });
    }, toReconnect.length * 500 + 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, instances]);

  const serverMap = Object.fromEntries(servers.map((s) => [s.id, s]));
  const activeServer = serverFilter ? serverMap[serverFilter] : null;

  // Active channels present in this user's instances
  const activeChannels = [...new Set(instances.map((i) => i.channel ?? "whatsapp"))] as ChannelType[];

  const filtered = instances
    .filter((i) => !serverFilter || i.server_id === serverFilter)
    .filter((i) => channelFilter === "all" || (i.channel ?? "whatsapp") === channelFilter);

  const connected = filtered.filter((i) => i.status === "connected").length;

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
            Instâncias
          </h1>
          <p className="text-sm mt-1.5" style={{ color: "hsl(240 8% 46%)" }}>
            {filtered.length} instância{filtered.length !== 1 ? "s" : ""} no total
            {connected > 0 && (
              <span>
                {" · "}
                <span style={{ color: "var(--green)" }}>{connected} conectada{connected !== 1 ? "s" : ""}</span>
              </span>
            )}
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
            className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-150 active:scale-[0.97] whitespace-nowrap flex-1 sm:flex-none"
            style={{
              background: "rgba(0,212,106,0.12)",
              border: "1px solid rgba(0,212,106,0.3)",
              color: "var(--green)",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,106,0.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,212,106,0.12)"; }}
          >
            <Plus className="w-4 h-4" />
            {t("instances_new")}
          </button>
        </div>
      </div>

      {/* Channel filter tabs — only shown if user has 2+ channels */}
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
                  background: meta ? `${meta.color}15` : "rgba(255,255,255,0.08)",
                  color: meta ? meta.color : "hsl(240 15% 93%)",
                  border: `1px solid ${meta ? `${meta.color}35` : "rgba(255,255,255,0.12)"}`,
                } : {
                  background: "rgba(255,255,255,0.03)",
                  color: "hsl(240 8% 50%)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {ch === "all" ? "Todos" : meta?.label}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: "rgba(255,255,255,0.06)" }}>
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
          <span
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg"
            style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}
          >
            <ServerIcon className="w-3 h-3" />
            {activeServer.name}
            <button
              onClick={() => router.push("/instances")}
              className="ml-0.5 transition-opacity hover:opacity-70"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-44 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl p-14 text-center animate-fade-in-up"
          style={{
            background: "hsl(240 18% 6%)",
            border: "1px dashed hsl(240 12% 16%)",
          }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <Smartphone className="w-6 h-6" style={{ color: "hsl(240 8% 35%)" }} />
          </div>
          <p className="font-semibold text-sm" style={{ color: "hsl(240 8% 70%)" }}>
            {activeServer ? `Nenhuma instância em "${activeServer.name}"` : "Nenhuma instância ainda"}
          </p>
          <p className="text-sm mt-1.5 mb-6" style={{ color: "hsl(240 8% 42%)" }}>
            Crie sua primeira instância para começar a usar o WhatsApp API
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all active:scale-[0.97]"
            style={{
              background: "rgba(0,212,106,0.12)",
              border: "1px solid rgba(0,212,106,0.3)",
              color: "var(--green)",
              backdropFilter: "blur(8px)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,106,0.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,212,106,0.12)"; }}
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
