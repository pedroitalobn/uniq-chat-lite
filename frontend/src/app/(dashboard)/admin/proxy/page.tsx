"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Activity, Globe, Loader2, Plus, Save, Shield, Trash2, Edit2, X, Check } from "lucide-react";
import { toast } from "sonner";

type ProxyConfig = {
  id: string;
  enabled: boolean;
  provider: string;
  proxy_type: string;
  host: string;
  port: number;
  username: string;
  use_env: boolean;
  is_active: boolean;
  has_password: boolean;
  name?: string;
  country?: string;
  is_default?: boolean;
};

type ProxyStats = {
  summary: {
    total_users: number;
    total_instances: number;
    global_proxy_instances: number;
    eligible_users_by_plan: number;
    connected_proxy_samples: number;
  };
  users: Array<{
    user_id: string;
    name: string;
    email: string;
    plan_name: string;
    instances: number;
    connected: number;
    last_updated_at: string;
  }>;
};

const COUNTRIES: Record<string, string> = {
  br: "🇧🇷 Brasil",
  us: "🇺🇸 Estados Unidos",
  uk: "🇬🇧 Reino Unido",
  es: "🇪🇸 Espanha",
  pt: "🇵🇹 Portugal",
  ar: "🇦🇷 Argentina",
  co: "🇨🇴 Colombia",
  mx: "🇲🇽 México",
  cl: "🇨🇱 Chile",
  pe: "🇵🇪 Peru",
};

export default function AdminProxyPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const isSuperAdmin = session?.user?.role === "super_admin";

  const [form, setForm] = useState({
    id: "",
    name: "",
    enabled: false,
    is_default: false,
    provider: "manual",
    proxy_type: "http",
    host: "",
    port: 33335,
    username: "",
    use_env: false,
    is_active: true,
    country: "br",
  });

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="w-10 h-10" style={{ color: "hsl(240 8% 46%)" }} />
        <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Acesso restrito a super administradores</p>
      </div>
    );
  }

  const { data: config, isLoading } = useQuery<ProxyConfig[] | ProxyConfig>({
    queryKey: ["admin-proxy-config"],
    queryFn: () => adminApi.getProxyConfig().then((r) => r.data),
  });

  const { data: stats } = useQuery<ProxyStats>({
    queryKey: ["admin-proxy-stats"],
    queryFn: () => adminApi.getProxyStats().then((r) => r.data),
    refetchInterval: 15000,
  });

  const configs: ProxyConfig[] = Array.isArray(config) ? config : config ? [config] : [];

  const updateMutation = useMutation({
    mutationFn: () => adminApi.updateProxyConfig({ ...form, password: password || undefined }),
    onSuccess: () => {
      toast.success(form.id ? "Proxy atualizado" : "Proxy criado");
      setPassword("");
      setShowModal(false);
      setEditingId(null);
      setForm({ id: "", name: "", enabled: false, is_default: false, provider: "manual", proxy_type: "http", host: "", port: 33335, username: "", use_env: false, is_active: true, country: "br" });
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
      qc.invalidateQueries({ queryKey: ["admin-proxy-stats"] });
    },
    onError: () => toast.error("Erro ao salvar proxy"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await adminApi.deleteProxyConfig(id);
    },
    onSuccess: () => {
      toast.success("Proxy removido");
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
    },
    onError: () => toast.error("Erro ao remover proxy"),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ id: "", name: "", enabled: true, is_default: false, provider: "manual", proxy_type: "http", host: "", port: 33335, username: "", use_env: false, is_active: true, country: "br" });
    setPassword("");
    setShowModal(true);
  };

  const openEdit = (proxy: ProxyConfig) => {
    setEditingId(proxy.id);
    setForm({ ...proxy });
    setPassword("");
    setShowModal(true);
  };

  const handleSetDefault = async (proxy: ProxyConfig) => {
    try {
      await adminApi.updateProxyConfig({ ...proxy, is_default: true });
      toast.success(`${COUNTRIES[proxy.country] || proxy.country} definido como padrão`);
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
    } catch {
      toast.error("Erro ao definir proxy padrão");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  // Group proxies by country
  const proxiesByCountry = configs.reduce((acc, p) => {
    const c = p.country || "br";
    if (!acc[c]) acc[c] = [];
    acc[c].push(p);
    return acc;
  }, {} as Record<string, ProxyConfig[]>);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(240 15% 93%)" }}>Proxy Global</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            Configure proxies residenciais por país. Apenas um proxy padrão por país.
          </p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "var(--green)", color: "#000" }}>
          <Plus className="w-4 h-4" /> Novo Proxy
        </button>
      </div>

      {/* Proxies by Country */}
      {Object.entries(proxiesByCountry).map(([country, proxies]) => (
        <div key={country} className="rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
              {COUNTRIES[country] || country}
            </h2>
            <span className="text-xs px-2 py-1 rounded-full" style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 60%)" }}>
              {proxies.length} proxy{proxies.length !== 1 && "s"}
            </span>
          </div>
          
          <div className="space-y-3">
            {proxies.map((proxy) => (
              <div key={proxy.id} className="flex items-center justify-between p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                      {proxy.name || "Proxy " + (COUNTRIES[proxy.country] || proxy.country)}
                    </p>
                    {proxy.is_default && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--green)", color: "#000" }}>Padrão</span>
                    )}
                    {!proxy.is_active && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>Inativo</span>
                    )}
                  </div>
                  <p className="text-xs mt-1" style={{ color: "hsl(240 8% 46%)" }}>
                    {proxy.host}:{proxy.port} • {proxy.provider} • {proxy.proxy_type}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!proxy.is_default && proxy.is_active && (
                    <button onClick={() => handleSetDefault(proxy)} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 60%)" }}>
                      Definir Padrão
                    </button>
                  )}
                  <button onClick={() => openEdit(proxy)} className="p-2 rounded-lg" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 60%)" }}>
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (confirm("Remover este proxy?")) deleteMutation.mutate(proxy.id) }} className="p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {Object.keys(proxiesByCountry).length === 0 && (
        <div className="text-center py-12" style={{ color: "hsl(240 8% 46%)" }}>
          <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhum proxy configurado</p>
          <button onClick={openCreate} className="mt-4 text-sm px-4 py-2 rounded-lg" style={{ background: "var(--green)", color: "#000" }}>
            Criar primeiro proxy
          </button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-lg rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold" style={{ color: "hsl(240 15% 93%)" }}>
                {editingId ? "Editar Proxy" : "Novo Proxy"}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg" style={{ background: "hsl(240 12% 10%)" }}>
                <X className="w-5 h-5" style={{ color: "hsl(240 8% 60%)" }} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Nome</label>
                  <input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="My Proxy" />
                </div>
                <div>
                  <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>País</label>
                  <select value={form.country} onChange={(e) => setForm(p => ({ ...p, country: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}>
                    {Object.entries(COUNTRIES).map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Host</label>
                  <input value={form.host} onChange={(e) => setForm(p => ({ ...p, host: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="srv.proxy.com" />
                </div>
                <div>
                  <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Porta</label>
                  <input type="number" value={form.port} onChange={(e) => setForm(p => ({ ...p, port: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="33335" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Provider</label>
                  <input value={form.provider} onChange={(e) => setForm(p => ({ ...p, provider: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="manual" />
                </div>
                <div>
                  <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Tipo</label>
                  <select value={form.proxy_type} onChange={(e) => setForm(p => ({ ...p, proxy_type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Username</label>
                <input value={form.username} onChange={(e) => setForm(p => ({ ...p, username: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="user" />
              </div>

              <div>
                <label className="block text-xs mb-2" style={{ color: "hsl(240 8% 60%)" }}>Senha {editingId && "(deixe vazio para manter)"</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="••••••••" />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm" style={{ color: "hsl(240 15% 88%)" }}>
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm(p => ({ ...p, enabled: e.target.checked }))} />
                  Ativo
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "hsl(240 15% 88%)" }}>
                  <input type="checkbox" checked={form.use_env} onChange={(e) => setForm(p => ({ ...p, use_env: e.target.checked }))} />
                  Usar do ambiente
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "hsl(240 15% 88%)" }}>
                  <input type="checkbox" checked={form.is_default} onChange={(e) => setForm(p => ({ ...p, is_default: e.target.checked }))} />
                  Padrão do país
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl text-sm" style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 60%)" }}>
                Cancelar
              </button>
              <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "var(--green)", color: "#000" }}>
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}