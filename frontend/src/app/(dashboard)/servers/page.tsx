"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { serversApi, proxyPoolsApi } from "@/lib/api";
import type { Server, ServerStats, ProxyPool } from "@/types";
import {
  Server as ServerIcon, Plus, X, Trash2, Pencil, Globe,
  Smartphone, Loader2, Copy, Check, ExternalLink,
  Play, Pause, RefreshCw, LogOut, Trash, Link2, RotateCw,
  Activity, Wifi, WifiOff, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// ─── Actions Dropdown ──────────────────────────────────────────────────────
function ActionsMenu({ serverId, onAction }: { serverId: string; onAction: () => void }) {
  const [open, setOpen] = useState(false);
  
  const handleAction = async (action: string) => {
    setOpen(false);
    try {
      const res = await serversApi.action(serverId, action);
      toast.success(res.data.message || "Ação executada");
      onAction();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao executar ação");
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg transition-colors"
        style={{ color: "hsl(240 8% 38%)" }}
        onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 75%)")}
        onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
        <Activity className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl py-1 animate-fade-in-up"
            style={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 14%)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <button onClick={() => handleAction("pause")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "hsl(240 8% 65%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(240 12% 12%)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <Pause className="w-3.5 h-3.5" /> Pausar todas
            </button>
            <button onClick={() => handleAction("resume")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "hsl(240 8% 65%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(240 12% 12%)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <Play className="w-3.5 h-3.5" /> Retomar todas
            </button>
            <button onClick={() => handleAction("reconnect")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "hsl(240 8% 65%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(240 12% 12%)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <RefreshCw className="w-3.5 h-3.5" /> Reconectar todas
            </button>
            <button onClick={() => handleAction("disconnect")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "hsl(240 8% 65%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(240 12% 12%)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <LogOut className="w-3.5 h-3.5" /> Desconectar todas
            </button>
            <div className="my-1" style={{ borderTop: "1px solid hsl(240 12% 12%)" }} />
            <button onClick={() => handleAction("apply_proxy")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "hsl(240 8% 65%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(240 12% 12%)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <Link2 className="w-3.5 h-3.5" /> Aplicar proxy
            </button>
            <button onClick={() => handleAction("rotate_proxy")} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "hsl(240 8% 65%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(240 12% 12%)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <RotateCw className="w-3.5 h-3.5" /> Rotacionar proxy
            </button>
            <div className="my-1" style={{ borderTop: "1px solid hsl(240 12% 12%)" }} />
            <button onClick={async () => {
              if (await showConfirm("Todas as instâncias deste server serão excluídas permanentemente.", { title: "Confirmar exclusão", confirmLabel: "Excluir", danger: true })) {
                handleAction("delete");
              }
            }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              style={{ color: "#f87171" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <Trash className="w-3.5 h-3.5" /> Excluir todas instâncias
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────
function ServerModal({
  server, onClose, onSaved, workspaceId,
}: {
  server?: Server; onClose: () => void; onSaved: () => void; workspaceId?: string;
}) {
  const isEdit = !!server;
  const [name, setName]         = useState(server?.name || "");
  const [slug, setSlug]         = useState(server?.slug || "");
  const [description, setDesc]  = useState(server?.description || "");
  const [proxyPoolId, setProxyPoolId] = useState(server?.proxy_pool_id || "");
  const [webhookUrl, setWebhookUrl] = useState(server?.webhook_url || "");
  const [applyWebhook, setApplyWebhook] = useState(false);
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const { data: proxyPools = [] } = useQuery<ProxyPool[]>({
    queryKey: ["proxy-pools"],
    queryFn: () => proxyPoolsApi.list().then(r => r.data),
    enabled: isEdit,
  });

  const autoSlug = (v: string) =>
    v.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/--+/g, "-").replace(/^-|-$/g, "");

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(autoSlug(v));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Nome é obrigatório"); return; }
    setLoading(true);
    setError("");
    try {
      if (isEdit) {
        await serversApi.update(server.id, { 
          name: name.trim(), 
          description,
          proxy_pool_id: proxyPoolId || undefined,
          webhook_url: webhookUrl || undefined,
          apply_webhook: applyWebhook,
        });
      } else {
        await serversApi.create({ name: name.trim(), slug: slug || undefined, description, workspace_id: workspaceId });
      }
      toast.success(isEdit ? "Server atualizado!" : "Server criado!");
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto"
        style={{ background: "hsl(240 18% 6%)", boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 32px 80px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <ServerIcon className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
              {isEdit ? "Editar server" : "Novo server"}
            </h2>
          </div>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 text-xs text-red-400 rounded-xl px-3.5 py-2.5"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)" }}>
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
              Nome do server *
            </label>
            <input value={name} onChange={e => handleNameChange(e.target.value)}
              placeholder="Acme Corp" className="input-field w-full" autoFocus />
          </div>

          {!isEdit && (
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                Slug (subdomínio único)
              </label>
              <div className="flex items-center gap-0 rounded-xl overflow-hidden"
                style={{ border: "1px solid hsl(240 12% 14%)", background: "hsl(240 12% 8%)" }}>
                <span className="px-3 py-2.5 text-sm font-mono flex-shrink-0"
                  style={{ color: "hsl(240 8% 38%)", borderRight: "1px solid hsl(240 12% 14%)" }}>
                  uniq.chat/
                </span>
                <input value={slug} onFocus={() => setSlugTouched(true)}
                  onChange={e => setSlug(autoSlug(e.target.value))}
                  placeholder="acme-corp" className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none font-mono"
                  style={{ color: "hsl(240 15% 85%)" }} />
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: "hsl(240 8% 34%)" }}>
                Gerado automaticamente · único em todo o sistema
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
              Descrição (opcional)
            </label>
            <textarea value={description} onChange={e => setDesc(e.target.value)}
              placeholder="Workspace para clientes da Acme Corp..."
              rows={2} className="input-field w-full resize-none" />
          </div>

          {isEdit && (
            <>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                  Proxy Pool
                </label>
                <select value={proxyPoolId} onChange={e => setProxyPoolId(e.target.value)}
                  className="input-field w-full">
                  <option value="">Nenhum</option>
                  {proxyPools.map(pool => (
                    <option key={pool.id} value={pool.id}>{pool.name} ({pool.provider})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                  Webhook Padrão
                </label>
                <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://seu-webhook.com.br/webhook" className="input-field w-full" />
              </div>

              <label className="flex items-center gap-2 text-xs" style={{ color: "hsl(240 8% 55%)" }}>
                <input type="checkbox" checked={applyWebhook} onChange={e => setApplyWebhook(e.target.checked)}
                  className="rounded" />
                Aplicar webhook a todas as instâncias
              </label>
            </>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">Cancelar</button>
            <button type="submit" disabled={loading || !name.trim()}
              className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-40">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : isEdit ? "Salvar" : "Criar server"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Server Card ──────────────────────────────────────────────────────────────
function ServerCard({ server, onEdit, onDelete, onAction }: {
  server: Server; onEdit: () => void; onDelete: () => void; onAction: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copySlug = () => {
    navigator.clipboard.writeText(server.slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { data: instances = [] } = useQuery({
    queryKey: ["server-instances", server.id],
    queryFn: () => serversApi.instances(server.id).then(r => r.data),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const { data: stats } = useQuery<ServerStats>({
    queryKey: ["server-stats", server.id],
    queryFn: () => serversApi.stats(server.id).then(r => r.data),
    refetchInterval: 30000,
  });

  const connectedCount = stats?.connected || 0;
  const totalCount = stats?.total_instances || instances.length;

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4 transition-all group"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = "hsl(240 12% 18%)")}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = "hsl(240 12% 13%)")}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)" }}>
            <ServerIcon className="w-4.5 h-4.5" style={{ color: "var(--green)" }} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: "hsl(240 15% 90%)" }}>{server.name}</p>
            {server.description && (
              <p className="text-xs truncate mt-0.5" style={{ color: "hsl(240 8% 44%)" }}>{server.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
          <ActionsMenu serverId={server.id} onAction={onAction} />
          <button onClick={onEdit}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 75%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Slug row */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ background: "hsl(240 20% 4%)", border: "1px solid hsl(240 12% 10%)" }}>
        <Globe className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 36%)" }} />
        <code className="text-xs font-mono flex-1 truncate" style={{ color: "hsl(240 8% 55%)" }}>
          uniq.chat/<span style={{ color: "hsl(240 15% 75%)" }}>{server.slug}</span>
        </code>
        <button onClick={copySlug} className="transition-colors flex-shrink-0"
          style={{ color: "hsl(240 8% 36%)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 60%)")}
          onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 36%)")}>
          {copied ? <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs" style={{ background: "hsl(240 12% 8%)" }}>
          <Smartphone className="w-3 h-3" style={{ color: "hsl(240 8% 46%)" }} />
          <span style={{ color: "hsl(240 8% 65%)" }}>{totalCount}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs" style={{ background: "hsl(240 12% 8%)" }}>
          {connectedCount > 0 ? (
            <><Wifi className="w-3 h-3" style={{ color: "var(--green)" }} /><span style={{ color: "var(--green)" }}>{connectedCount}</span></>
          ) : (
            <><WifiOff className="w-3 h-3" style={{ color: "hsl(240 8% 36%)" }} /><span style={{ color: "hsl(240 8% 36%)" }}>0</span></>
          )}
        </div>
        {server.proxy_pool_id && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs" style={{ background: "rgba(167,139,250,0.08)" }}>
            <Link2 className="w-3 h-3" style={{ color: "#a78bfa" }} />
            <span style={{ color: "#a78bfa" }}>Proxy</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(240 8% 46%)" }}>
          <span>{instances.length} instância{instances.length !== 1 ? "s" : ""}</span>
        </div>
        <a href={`/instances?server=${server.id}`}
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: "hsl(240 8% 38%)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--green)")}
          onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
          Ver instâncias <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ServersPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editServer, setEditServer]   = useState<Server | null>(null);
  const { currentWorkspace } = useWorkspace();

  const { data: servers = [], isLoading } = useQuery<Server[]>({
    queryKey: ["servers", currentWorkspace?.id],
    queryFn: () => serversApi.list(currentWorkspace?.id).then(r => r.data),
    staleTime: 30 * 1000, // 30 seconds
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serversApi.delete(id),
    onSuccess: () => {
      toast.success("Server removido");
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
    onError: () => toast.error("Erro ao remover server"),
  });

  const handleDelete = async (server: Server) => {
    if (!await showConfirm(`As instâncias vinculadas ao "${server.name}" serão desassociadas.`, { title: `Remover server "${server.name}"?`, confirmLabel: "Remover" })) return;
    deleteMutation.mutate(server.id);
  };

  const onSaved = () => queryClient.invalidateQueries({ queryKey: ["servers"] });

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>Servers</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            Workspaces para organizar instâncias por empresa ou projeto
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} 
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ 
            background: "rgba(0, 212, 106, 0.12)", 
            border: "1px solid rgba(0, 212, 106, 0.3)", 
            color: "var(--green)", 
            backdropFilter: "blur(8px)" 
          }}>
          <Plus className="w-4 h-4" />
          Novo server
        </button>
      </div>

      {/* Info box */}
      <div className="rounded-2xl p-4"
        style={{ background: "rgba(96,165,250,0.04)", border: "1px solid rgba(96,165,250,0.12)" }}>
        <p className="text-xs font-semibold mb-1" style={{ color: "#60a5fa" }}>Como funcionam os Servers</p>
        <p className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>
          Cada server tem um slug único que funciona como subdomínio. Agrupe instâncias WhatsApp por empresa, cliente ou projeto —
          ideal para agências e empresas com múltiplas operações.
        </p>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="skeleton h-44 rounded-2xl" />)}
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-2xl p-16 text-center animate-fade-in-up"
          style={{ background: "hsl(240 18% 6%)", border: "1px dashed hsl(240 12% 16%)" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <ServerIcon className="w-5 h-5" style={{ color: "hsl(240 8% 30%)" }} />
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: "hsl(240 8% 52%)" }}>Nenhum server criado</p>
          <p className="text-xs mb-5" style={{ color: "hsl(240 8% 36%)" }}>
            Crie seu primeiro server para organizar instâncias por empresa
          </p>
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,106,0.16)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,212,106,0.1)")}>
            <Plus className="w-4 h-4" /> Criar server
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in-up">
          {servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              onEdit={() => setEditServer(server)}
              onDelete={() => handleDelete(server)}
              onAction={() => {
                queryClient.invalidateQueries({ queryKey: ["server-instances", server.id] });
                queryClient.invalidateQueries({ queryKey: ["server-stats", server.id] });
              }}
            />
          ))}
          {/* Add new card */}
          <button onClick={() => setShowCreate(true)}
            className={cn(
              "rounded-2xl p-5 border-2 border-dashed flex flex-col items-center justify-center gap-3",
              "transition-all min-h-[160px]",
            )}
            style={{ borderColor: "hsl(240 12% 14%)", color: "hsl(240 8% 32%)" }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "rgba(0,212,106,0.25)";
              e.currentTarget.style.color = "var(--green)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "hsl(240 12% 14%)";
              e.currentTarget.style.color = "hsl(240 8% 32%)";
            }}>
            <Plus className="w-6 h-6" />
            <span className="text-sm font-medium">Novo server</span>
          </button>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <ServerModal onClose={() => setShowCreate(false)} onSaved={onSaved} workspaceId={currentWorkspace?.id} />
      )}
      {editServer && (
        <ServerModal server={editServer} onClose={() => setEditServer(null)} onSaved={onSaved} workspaceId={currentWorkspace?.id} />
      )}
    </div>
  );
}
