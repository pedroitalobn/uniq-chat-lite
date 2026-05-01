"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { serversApi, proxiesApi } from "@/lib/api";
import type { Server, ServerStats } from "@/types";
import {
  Server as ServerIcon, Plus, X, Trash2, Pencil, Globe,
  Smartphone, Loader2, Copy, Check, ExternalLink,
  Play, Pause, RefreshCw, LogOut, Trash, Link2, RotateCw,
  Activity, Wifi, WifiOff, AlertCircle, Shield, ChevronRight,
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
  const [webhookUrl, setWebhookUrl] = useState(server?.webhook_url || "");
  const [applyWebhook, setApplyWebhook] = useState(false);
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

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
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto"
        style={{ background: "hsl(240 18% 6%)", boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 32px 80px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <ServerIcon className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <h2 className="text-base font-medium" style={{ color: "hsl(240 15% 93%)" }}>
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

              <p className="text-[11px] mt-1" style={{ color: "hsl(240 8% 40%)" }}>
                Proxy: use o botão <Shield className="w-3 h-3 inline" /> no card do server.
              </p>
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

// ─── Server Proxy Modal ──────────────────────────────────────────────────────
interface CatalogProxy {
  id: string;
  name: string;
  country?: string;
  type?: string;
  is_platform: boolean;
  is_active?: boolean;
  host?: string;
  port?: number;
  username?: string;
}

const COUNTRY_FLAGS: Record<string, string> = {
  br: "🇧🇷", us: "🇺🇸", gb: "🇬🇧", ar: "🇦🇷", co: "🇨🇴", mx: "🇲🇽",
  es: "🇪🇸", de: "🇩🇪", fr: "🇫🇷", it: "🇮🇹", jp: "🇯🇵", cn: "🇨🇳",
};

function CreateProxyInline({ onCreated, onCancel }: { onCreated: (proxyId: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: "", host: "", port: 0, username: "", password: "",
    proxy_type: "http" as "http" | "https" | "socks5",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; external_ip?: string; latency_ms?: number; error?: string } | null>(null);

  const submit = async (alsoLink: boolean) => {
    setSaving(true);
    try {
      const r = await proxiesApi.create({
        name: form.name.trim(),
        host: form.host.trim(),
        port: form.port,
        username: form.username,
        password: form.password,
        proxy_type: form.proxy_type,
      });
      toast.success("Proxy criado");
      if (alsoLink) onCreated(r.data.id);
      else onCancel();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar");
    } finally {
      setSaving(false);
    }
  };

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const t = await proxiesApi.testInline({
        proxy_type: form.proxy_type,
        host: form.host.trim(),
        port: form.port,
        username: form.username,
        password: form.password,
      });
      setTestResult(t.data);
      if (t.data.success) toast.success(`IP ${t.data.external_ip} · ${t.data.latency_ms}ms`);
      else toast.error(t.data.error || "Teste falhou");
    } catch (err: unknown) {
      setTestResult({ success: false, error: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro" });
    } finally {
      setTesting(false);
    }
  };

  const valid = form.name.trim() && form.host.trim() && form.port > 0;

  return (
    <div className="p-3 rounded-xl space-y-3" style={{ background: "hsl(240 12% 8%)", border: "1px solid hsl(240 12% 14%)" }}>
      <div className="text-xs font-medium" style={{ color: "hsl(240 15% 85%)" }}>Criar proxy novo</div>
      <input className="input-field w-full text-xs" placeholder="Nome (ex: Brightdata BR)"
        value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      <div className="grid grid-cols-3 gap-2">
        <select className="input-field text-xs col-span-1" value={form.proxy_type}
          onChange={e => setForm(f => ({ ...f, proxy_type: e.target.value as "http" | "https" | "socks5" }))}>
          <option value="http">http</option>
          <option value="https">https</option>
          <option value="socks5">socks5</option>
        </select>
        <input className="input-field text-xs col-span-2" placeholder="host"
          value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} />
      </div>
      <input type="number" className="input-field w-full text-xs" placeholder="porta"
        value={form.port || ""} onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 0 }))} />
      <div className="grid grid-cols-2 gap-2">
        <input className="input-field text-xs" placeholder="usuário"
          value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
        <input type="password" className="input-field text-xs" placeholder="senha"
          value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
      </div>
      {testResult && (
        <div className="text-[11px] p-2 rounded-lg" style={{
          background: testResult.success ? "rgba(0,212,106,0.08)" : "rgba(239,68,68,0.08)",
          color: testResult.success ? "var(--green)" : "#f87171",
        }}>
          {testResult.success
            ? `✓ OK · IP ${testResult.external_ip} · ${testResult.latency_ms}ms`
            : `✗ ${testResult.error}`}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={doTest} disabled={!valid || testing} className="btn-ghost flex-1 py-2 text-xs">
          {testing ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Testar"}
        </button>
        <button onClick={() => submit(true)} disabled={!valid || saving} className="flex-1 py-2 rounded-xl text-xs font-medium"
          style={{ background: "var(--green)", color: "white", opacity: saving ? 0.7 : 1 }}>
          {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Salvar e vincular"}
        </button>
      </div>
      <button onClick={onCancel} className="w-full text-[11px] opacity-60 hover:opacity-100">cancelar</button>
    </div>
  );
}

function ServerProxyModal({
  server, onClose, onSaved,
}: {
  server: Server; onClose: () => void; onSaved: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | "" | "none">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; external_ip?: string; latency_ms?: number; error?: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: catalog = [], refetch } = useQuery<CatalogProxy[]>({
    queryKey: ["proxies-available"],
    queryFn: () => proxiesApi.listAvailable().then(r => r.data),
  });

  useState(() => {
    serversApi.getProxy(server.id).then(r => {
      const d = r.data as { has_proxy?: boolean; proxy_id?: string };
      setSelectedId(d.has_proxy ? (d.proxy_id || "") : "none");
    }).catch(() => setSelectedId("none"))
      .finally(() => setLoading(false));
  });

  const save = async () => {
    setSaving(true);
    try {
      await serversApi.setProxy(server.id, selectedId === "none" || !selectedId ? null : selectedId);
      toast.success("Proxy do server atualizado");
      onSaved();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await serversApi.testProxy(server.id);
      setTestResult(r.data);
    } catch (err: unknown) {
      setTestResult({ success: false, error: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto"
        style={{ background: "hsl(240 18% 6%)", boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 32px 80px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <Shield className="w-4 h-4" style={{ color: "#818cf8" }} />
            </div>
            <div>
              <h2 className="text-base font-medium" style={{ color: "hsl(240 15% 93%)" }}>Proxy do Server</h2>
              <p className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>{server.name}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--green)" }} />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[11px]" style={{ color: "hsl(240 8% 50%)" }}>
              Todas as instâncias deste server compartilham o proxy selecionado.
            </p>

            {/* Sem proxy */}
            <label className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all"
              style={{
                background: selectedId === "none" ? "rgba(0,212,106,0.08)" : "hsl(240 12% 8%)",
                border: `1px solid ${selectedId === "none" ? "rgba(0,212,106,0.3)" : "hsl(240 12% 14%)"}`,
              }}>
              <input type="radio" className="mt-1" checked={selectedId === "none"} onChange={() => setSelectedId("none")} />
              <div>
                <div className="text-xs font-medium" style={{ color: "hsl(240 15% 85%)" }}>Sem proxy</div>
                <div className="text-[11px] opacity-60">Conexão direta do server</div>
              </div>
            </label>

            {/* Catálogo */}
            {catalog.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase font-semibold opacity-60">Proxies disponíveis</div>
                {catalog.map(p => (
                  <label key={p.id}
                    className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all"
                    style={{
                      background: selectedId === p.id ? "rgba(0,212,106,0.08)" : "hsl(240 12% 8%)",
                      border: `1px solid ${selectedId === p.id ? "rgba(0,212,106,0.3)" : "hsl(240 12% 14%)"}`,
                    }}>
                    <input type="radio" className="mt-1" checked={selectedId === p.id} onChange={() => setSelectedId(p.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium" style={{ color: "hsl(240 15% 85%)" }}>{p.name}</span>
                        {p.country && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(240 12% 14%)", color: "hsl(240 8% 65%)" }}>
                            {COUNTRY_FLAGS[p.country] || "🌐"} {p.country.toUpperCase()}
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            background: p.is_platform ? "rgba(167,139,250,0.12)" : "rgba(99,102,241,0.12)",
                            color: p.is_platform ? "#a78bfa" : "#818cf8",
                          }}>
                          {p.is_platform ? "Plataforma" : "Custom"}
                        </span>
                      </div>
                      {!p.is_platform && p.host && (
                        <div className="text-[10px] opacity-50 font-mono mt-0.5 truncate">
                          {p.type || "http"}://{p.host}:{p.port}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Criar novo */}
            {!showCreate ? (
              <button onClick={() => setShowCreate(true)}
                className="w-full py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
                style={{ background: "hsl(240 12% 8%)", color: "hsl(240 8% 70%)", border: "1px dashed hsl(240 12% 20%)" }}>
                <Plus className="w-3.5 h-3.5" /> Criar novo proxy
              </button>
            ) : (
              <CreateProxyInline
                onCreated={async (id) => {
                  setShowCreate(false);
                  await refetch();
                  setSelectedId(id);
                }}
                onCancel={() => setShowCreate(false)}
              />
            )}

            {testResult && (
              <div className="p-3 rounded-xl text-xs"
                style={{
                  background: testResult.success ? "rgba(0,212,106,0.08)" : "rgba(239,68,68,0.08)",
                  border: `1px solid ${testResult.success ? "rgba(0,212,106,0.2)" : "rgba(239,68,68,0.2)"}`,
                }}>
                {testResult.success ? (
                  <>
                    <p className="font-medium" style={{ color: "var(--green)" }}>✓ Proxy funcionando</p>
                    <p className="mt-1 opacity-80">IP externo: <code>{testResult.external_ip}</code></p>
                    <p className="opacity-60">Latência: {testResult.latency_ms}ms</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium" style={{ color: "#f87171" }}>✗ Teste falhou</p>
                    <p className="mt-1 opacity-80">{testResult.error}</p>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={test} disabled={testing}
                className="btn-ghost flex-1 py-2 text-xs flex items-center justify-center gap-1.5">
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                Testar
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                style={{ background: "var(--green)", color: "white", opacity: saving ? 0.7 : 1 }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Salvar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Server Card ──────────────────────────────────────────────────────────────
function ServerCard({ server, onEdit, onDelete, onAction }: {
  server: Server; onEdit: () => void; onDelete: () => void; onAction: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showProxyModal, setShowProxyModal] = useState(false);

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
            <p className="font-medium text-sm truncate" style={{ color: "hsl(240 15% 90%)" }}>{server.name}</p>
            {server.description && (
              <p className="text-xs truncate mt-0.5" style={{ color: "hsl(240 8% 44%)" }}>{server.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
          <ActionsMenu serverId={server.id} onAction={onAction} />
          <button onClick={() => setShowProxyModal(true)}
            title="Configurar proxy do server"
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#818cf8")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <Shield className="w-3.5 h-3.5" />
          </button>
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
        {server.proxy_id && server.proxy && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
            title={`Proxy ativo: ${server.proxy.name}${server.proxy.is_platform ? " (plataforma)" : " (custom)"}`}
            style={{
              background: server.proxy.is_active ? "rgba(0,212,106,0.1)" : "rgba(167,139,250,0.08)",
              border: `1px solid ${server.proxy.is_active ? "rgba(0,212,106,0.25)" : "rgba(167,139,250,0.25)"}`,
            }}
          >
            <Shield className="w-3 h-3" style={{ color: server.proxy.is_active ? "var(--green)" : "#a78bfa" }} />
            <span style={{ color: server.proxy.is_active ? "var(--green)" : "#a78bfa" }}>
              {server.proxy.country ? `${COUNTRY_FLAGS[server.proxy.country] || "🌐"} ` : ""}
              {server.proxy.name || "Proxy"}
            </span>
            {!server.proxy.is_active && (
              <span style={{ color: "hsl(240 8% 50%)" }}>· inativo</span>
            )}
          </div>
        )}
        {server.proxy_id && !server.proxy && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
            style={{ background: "rgba(167,139,250,0.08)" }}
          >
            <Shield className="w-3 h-3" style={{ color: "#a78bfa" }} />
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

      {showProxyModal && (
        <ServerProxyModal
          server={server}
          onClose={() => setShowProxyModal(false)}
          onSaved={() => {
            onAction();
            setShowProxyModal(false);
          }}
        />
      )}
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
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>Servers</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            Workspaces para organizar instâncias por empresa ou projeto
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} 
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
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
        <p className="text-xs font-medium mb-1" style={{ color: "#60a5fa" }}>Como funcionam os Servers</p>
        <p className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>
          Cada server tem um slug único que funciona como subdomínio. Agrupe instâncias WhatsApp por empresa, cliente ou projeto —
          ideal para agências e empresas com múltiplas operações.
        </p>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl p-5 flex flex-col gap-4"
              style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex-shrink-0" style={{ background: "var(--surface-2)" }} />
                  <div className="space-y-2">
                    <div className="h-3 rounded-full w-28" style={{ background: "var(--surface-2)" }} />
                    <div className="h-2 rounded-full w-20" style={{ background: "var(--surface-3)" }} />
                  </div>
                </div>
                <div className="flex gap-1">
                  <div className="w-6 h-6 rounded-lg" style={{ background: "var(--surface-2)" }} />
                  <div className="w-6 h-6 rounded-lg" style={{ background: "var(--surface-2)" }} />
                </div>
              </div>
              {/* Slug row */}
              <div className="h-8 rounded-xl" style={{ background: "var(--surface-2)" }} />
              {/* Status badges */}
              <div className="flex gap-2">
                <div className="h-6 rounded-lg w-12" style={{ background: "var(--surface-2)" }} />
                <div className="h-6 rounded-lg w-12" style={{ background: "var(--surface-2)" }} />
                <div className="h-6 rounded-lg w-20" style={{ background: "var(--surface-2)" }} />
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between">
                <div className="h-2 rounded-full w-24" style={{ background: "var(--surface-3)" }} />
                <div className="h-2 rounded-full w-20" style={{ background: "var(--surface-3)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-2xl p-16 text-center animate-fade-in-up"
          style={{ background: "hsl(240 18% 6%)", border: "1px dashed hsl(240 12% 16%)" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}>
            <ServerIcon className="w-5 h-5" style={{ color: "hsl(240 8% 30%)" }} />
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: "hsl(240 8% 52%)" }}>Nenhum server criado</p>
          <p className="text-xs mb-5" style={{ color: "hsl(240 8% 36%)" }}>
            Crie seu primeiro server para organizar instâncias por empresa
          </p>
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
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
