"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import {
  Search, Server, Smartphone, Shield, Users, Globe,
  RefreshCw, Power, PowerOff, Trash2, MoreVertical,
  Copy, Check, Loader2, ChevronDown, Info, X
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Instance, User } from "@/types";

type InspectTab = "servers" | "instances";

interface ServerExt {
  id: string;
  name: string;
  user_id: string;
  user?: User;
  address: string;
  port: number;
  status: string;
  created_at: string;
}

export default function AdminInspectPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const isSuperAdmin = session?.user?.role === "super_admin";
  
  const [tab, setTab] = useState<InspectTab>("servers");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // Servers list
  const { data: servers = [], isLoading: serversLoading } = useQuery<ServerExt[]>({
    queryKey: ["admin-inspect-servers"],
    queryFn: () => adminApi.listAllServers().then(r => r.data),
    enabled: isSuperAdmin && tab === "servers",
  });

  // Instances list - cast to any to handle expanded relations
  const { data: instances = [], isLoading: instancesLoading } = useQuery<any[]>({
    queryKey: ["admin-inspect-instances"],
    queryFn: () => adminApi.listAllInstances().then(r => r.data),
    enabled: isSuperAdmin && tab === "instances",
  });

  // Filter by search
  const filteredServers = servers.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.user?.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.address.includes(search)
  );

  const filteredInstances = instances.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.user?.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="w-10 h-10" style={{ color: "hsl(240 8% 46%)" }} />
        <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Acesso restrito a super administradores</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3" style={{ color: "hsl(240 15% 93%)" }}>
            <Search className="w-5 h-5" style={{ color: "hsl(240 8% 60%)" }} />
            <span className="hidden sm:inline">Inspect</span>
            <span className="sm:hidden">Suporte</span>
          </h1>
          <p className="text-sm mt-1 hidden sm:block" style={{ color: "hsl(240 8% 46%)" }}>
            Visualize e gerencie servidores e instâncias de todos os usuários.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "hsl(240 12% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <button onClick={() => setTab("servers")} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{ background: tab === "servers" ? "hsl(240 12% 13%)" : "transparent", color: tab === "servers" ? "hsl(240 15% 93%)" : "hsl(240 8% 46%)" }}>
          <Server className="w-4 h-4" />
          <span className="hidden sm:inline">Servidores</span>
          <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">{servers.length}</span>
        </button>
        <button onClick={() => setTab("instances")} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{ background: tab === "instances" ? "hsl(240 12% 13%)" : "transparent", color: tab === "instances" ? "hsl(240 15% 93%)" : "hsl(240 8% 46%)" }}>
          <Smartphone className="w-4 h-4" />
          <span className="hidden sm:inline">Instâncias</span>
          <span className="sm:hidden">Inst.</span>
          <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">{instances.length}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(240 8% 36%)" }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, email ou endereço..."
          className="input-field w-full pl-9" />
      </div>

      {/* List */}
      {tab === "servers" && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <div className="grid grid-cols-[1fr_1fr_100px_80px_60px] gap-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "hsl(240 8% 36%)", borderBottom: "1px solid hsl(240 12% 10%)" }}>
            <span>Servidor</span>
            <span>Usuário</span>
            <span className="text-center">Status</span>
            <span className="text-center">Porta</span>
            <span></span>
          </div>

          {serversLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}
            </div>
          ) : filteredServers.length === 0 ? (
            <div className="p-12 text-center">
              <Server className="w-8 h-8 mx-auto mb-3" style={{ color: "hsl(240 8% 28%)" }} />
              <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>
                {search ? "Nenhum servidor encontrado" : "Nenhum servidor cadastrado"}
              </p>
            </div>
          ) : (
            <div>
              {filteredServers.map((server, i) => (
                <ServerRow key={server.id} server={server} isLast={i === filteredServers.length - 1} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "instances" && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <div className="grid grid-cols-[1fr_1fr_100px_80px_80px] gap-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "hsl(240 8% 36%)", borderBottom: "1px solid hsl(240 12% 10%)" }}>
            <span>Instância</span>
            <span>Usuário/Workspace</span>
            <span className="text-center">Canal</span>
            <span className="text-center">Status</span>
            <span></span>
          </div>

          {instancesLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}
            </div>
          ) : filteredInstances.length === 0 ? (
            <div className="p-12 text-center">
              <Smartphone className="w-8 h-8 mx-auto mb-3" style={{ color: "hsl(240 8% 28%)" }} />
              <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>
                {search ? "Nenhuma instância encontrada" : "Nenhuma instância cadastrada"}
              </p>
            </div>
          ) : (
            <div>
              {filteredInstances.map((inst, i) => (
                <InstanceRow key={inst.id} instance={inst} isLast={i === filteredInstances.length - 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Server Row ───────────────────────────────────────────────────────────
function ServerRow({ server, isLast }: { server: ServerExt; isLast: boolean }) {
  const [copied, setCopied] = useState(false);
  const statusColor = server.status === "active" ? "var(--green)" : server.status === "inactive" ? "#fbbf24" : "#ef4444";
  
  const copyAddress = () => {
    navigator.clipboard.writeText(`${server.address}:${server.port}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_100px_80px_60px] gap-3 px-4 py-3 items-center transition-colors cursor-pointer"
      style={{ borderBottom: isLast ? undefined : "1px solid var(--border-default)" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "hsl(240 12% 10%)" }}>
          <Server className="w-4 h-4" style={{ color: "hsl(240 8% 50%)" }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 90%)" }}>{server.name}</p>
          <p className="text-xs font-mono truncate" style={{ color: "hsl(240 8% 46%)" }}>{server.address}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-xs truncate" style={{ color: "hsl(240 15% 90%)" }}>{server.user?.name || server.user_id}</p>
        <p className="text-[10px] truncate" style={{ color: "hsl(240 8% 46%)" }}>{server.user?.email}</p>
      </div>

      <div className="flex items-center justify-center">
        <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
      </div>

      <div className="text-center">
        <span className="text-xs font-mono" style={{ color: "hsl(240 8% 60%)" }}>{server.port}</span>
      </div>

      <div className="flex items-center justify-end gap-1">
        <button onClick={copyAddress} className="p-1.5 rounded-lg transition-colors" style={{ color: "hsl(240 8% 42%)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 80%)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 42%)"}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Instance Row ────────────────────────────────────────────────────
function InstanceRow({ instance, isLast }: { instance: Instance; isLast: boolean }) {
  const [copied, setCopied] = useState(false);
  
  const statusColors: Record<string, string> = {
    connected: "var(--green)",
    connecting: "#fbbf24",
    disconnected: "#94a3b8",
    error: "#ef4444",
  };
  const statusColor = statusColors[instance.status] || "#94a3b8";

  const channelColors: Record<string, string> = {
    whatsapp: "#25d366",
    instagram: "#e1306c",
    facebook: "#1877f2",
    telegram: "#229ed9",
    linkedin: "#0a66c2",
    tiktok: "#ff0050",
    kwai: "#ff6600",
  };
  const channelColor = channelColors[instance.channel] || "#94a3b8";

  return (
    <div className="grid grid-cols-[1fr_1fr_100px_80px_80px] gap-3 px-4 py-3 items-center transition-colors cursor-pointer"
      style={{ borderBottom: isLast ? undefined : "1px solid var(--border-default)" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${channelColor}15`, border: `1px solid ${channelColor}30` }}>
          <Smartphone className="w-4 h-4" style={{ color: channelColor }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 90%)" }}>{instance.name}</p>
          <p className="text-[10px] truncate" style={{ color: "hsl(240 8% 46%)" }}>{instance.id}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-xs truncate" style={{ color: "hsl(240 15% 90%)" }}>{(instance as any).user?.name || instance.user_id}</p>
        <p className="text-[10px] truncate" style={{ color: "hsl(240 8% 46%)" }}>{(instance as any).workspace?.name}</p>
      </div>

      <div className="flex items-center justify-center">
        <span className="text-xs font-medium uppercase" style={{ color: channelColor }}>{instance.channel}</span>
      </div>

      <div className="flex items-center justify-center">
        <span className="text-xs px-2 py-1 rounded-md" style={{ background: `${statusColor}15`, color: statusColor }}>
          {instance.status}
        </span>
      </div>

      <div className="flex items-center justify-end gap-1">
        <button className="p-1.5 rounded-lg transition-colors" style={{ color: "hsl(240 8% 42%)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 80%)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 42%)"}>
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}