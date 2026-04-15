"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Activity, Globe, Loader2, Save, Server, Shield, Users } from "lucide-react";
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

export default function AdminProxyPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const isSuperAdmin = session?.user?.role === "super_admin";

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="w-10 h-10" style={{ color: "hsl(240 8% 46%)" }} />
        <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Acesso restrito a super administradores</p>
      </div>
    );
  }

  const [form, setForm] = useState<any>({
    id: "",
    name: "",
    enabled: false,
    is_default: false,
    provider: "manual",
    proxy_type: "http",
    host: "",
    port: 33335,
    username: "",
    use_env: true,
    is_active: true,
    country: "br",
  });

  const { data: config, isLoading } = useQuery<ProxyConfig[] | ProxyConfig>({
    queryKey: ["admin-proxy-config"],
    queryFn: () => adminApi.getProxyConfig().then((r) => r.data),
  });

  const { data: stats } = useQuery<ProxyStats>({
    queryKey: ["admin-proxy-stats"],
    queryFn: () => adminApi.getProxyStats().then((r) => r.data),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!config) return;
    // Handle array - get first item
    const cfg = Array.isArray(config) ? config[0] : config;
    setForm({
      id: cfg.id || "",
      name: cfg.name || "",
      enabled: cfg.enabled ?? false,
      is_default: cfg.is_default ?? false,
      provider: cfg.provider || "manual",
      proxy_type: cfg.proxy_type || "http",
      host: cfg.host || "",
      port: cfg.port || 33335,
      username: cfg.username || "",
      use_env: cfg.use_env ?? false,
      is_active: cfg.is_active ?? true,
      country: cfg.country || "br",
    });
  }, [config]);

  const updateMutation = useMutation({
    mutationFn: () => adminApi.updateProxyConfig({ ...form, password: password || undefined }),
    onSuccess: () => {
      toast.success("Configuração de proxy global salva");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
      qc.invalidateQueries({ queryKey: ["admin-proxy-stats"] });
    },
    onError: () => toast.error("Erro ao salvar configuração de proxy"),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      // Save first, then test with the saved config
      await adminApi.updateProxyConfig({ ...form, password: password || undefined });
      // Test using the global proxy config endpoint
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/admin/proxy-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Teste falhou");
      return res.json();
    },
    onSuccess: () => toast.success("Proxy funcionou!"),
    onError: () => toast.error("Proxy falhou ou nãoConfigured"),
  });

  const cards = useMemo(() => {
    const s = stats?.summary;
    if (!s) return [];
    return [
      { label: "Usuários totais", value: s.total_users, icon: Users },
      { label: "Instâncias totais", value: s.total_instances, icon: Server },
      { label: "Instâncias no proxy global", value: s.global_proxy_instances, icon: Globe },
      { label: "Usuários elegíveis por plano", value: s.eligible_users_by_plan, icon: Shield },
      { label: "Conexões OK", value: s.connected_proxy_samples, icon: Activity },
    ];
  }, [stats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  // Handle array response (multiple proxies)
  const configs: ProxyConfig[] = Array.isArray(config) ? config : config ? [config] : [];
  const currentConfig: ProxyConfig = configs.find((c) => c.id === form?.id) || configs[0] || { id: "", enabled: false, provider: "manual", proxy_type: "http", host: "", port: 33335, username: "", use_env: false, is_active: true, has_password: false };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "hsl(240 15% 93%)" }}>Proxy Global</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
          Configure proxies residenciais para reduzir banimento de contas.
        </p>
      </div>

      {/* Proxy List */}
      <div className="rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 92%)" }}>Proxies Configurados</h2>
          <button onClick={() => { setForm({}); setPassword(""); }}
            className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--green)", color: "#000" }}>
            + Novo Proxy
          </button>
        </div>
        <div className="space-y-2">
          {configs.map((c: any) => (
            <div key={c.id} className="rounded-lg p-3 flex items-center justify-between cursor-pointer"
              style={{ background: c.id === form?.id ? "rgba(0,212,106,0.1)" : "rgba(255,255,255,0.03)", border: "1px solid" + (c.id === form?.id ? "var(--green)" : "rgba(255,255,255,0.06)") }}
              onClick={() => setForm(c)}>
              <div>
                <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>{c.name || "Proxy"} <span style={{ color: c.enabled ? "var(--green)" : "hsl(240 8% 46%)" }}>{c.enabled ? " (ativo)" : " (inativo)"}</span></p>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>{c.host}:{c.port} • {c.country}</p>
              </div>
              <div className="text-xs" style={{ color: "hsl(240 8% 62%)" }}>
                {c.provider}
              </div>
            </div>
          ))}
          {configs.length === 0 && (
            <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Nenhum proxy configurado. Clique em "+ Novo Proxy" para adicionar.</p>
          )}
        </div>
      </div>

      {/* Proxy Form */}
      <div className="rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "hsl(240 15% 92%)" }}>
          {form?.id ? "Editar Proxy" : "Novo Proxy"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between text-sm" style={{ color: "hsl(240 15% 88%)" }}>
            Proxy global habilitado
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
          </label>
          <label className="flex items-center justify-between text-sm" style={{ color: "hsl(240 15% 88%)" }}>
            Proxy padrão do país
            <input type="checkbox" checked={form.is_default || false} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
          </label>
          <label className="flex items-center justify-between text-sm" style={{ color: "hsl(240 15% 88%)" }}>
            Usar credenciais do ambiente
            <input type="checkbox" checked={form.use_env} onChange={(e) => setForm((p) => ({ ...p, use_env: e.target.checked }))} />
          </label>
          <input value={form.country || ""} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="País (br, us, uk...)" />
          <input value={form.provider} onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="Provider (manual/brightdata)" />
          <input value={form.proxy_type} onChange={(e) => setForm((p) => ({ ...p, proxy_type: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="Tipo (http/https/socks5)" />
          <input value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="Host" />
          <input type="number" value={form.port} onChange={(e) => setForm((p) => ({ ...p, port: Number(e.target.value || 0) }))}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="Porta" />
          <input value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder="Username" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }} placeholder={currentConfig?.has_password ? "Nova senha (opcional)" : "Senha"} />
        </div>
        <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: "var(--green)", color: "#04200f", opacity: updateMutation.isPending ? 0.7 : 1 }}>
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configuração
        </button>
        {form?.enabled && (
          <button onClick={() => testMutation.mutate()} disabled={testMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold ml-2"
            style={{ background: "hsl(240 12% 20%)", color: "hsl(240 15% 90%)", border: "1px solid hsl(240 12% 25%)" }}>
            {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Testar"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl p-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
            <div className="flex items-center gap-2 mb-2"><c.icon className="w-4 h-4" style={{ color: "hsl(240 8% 60%)" }} /><span className="text-[11px]" style={{ color: "hsl(240 8% 48%)" }}>{c.label}</span></div>
            <div className="text-xl font-bold" style={{ color: "hsl(240 15% 92%)" }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: "hsl(240 15% 92%)" }}>Usuários usando proxy global</h2>
        <div className="space-y-2">
          {(stats?.users || []).map((u) => (
            <div key={u.user_id} className="rounded-lg p-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>{u.name} <span style={{ color: "hsl(240 8% 46%)" }}>({u.plan_name})</span></p>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>{u.email}</p>
              </div>
              <div className="text-xs" style={{ color: "hsl(240 8% 62%)" }}>
                Instâncias: {u.instances} | Conectadas: {u.connected}
              </div>
            </div>
          ))}
          {(stats?.users || []).length === 0 && (
            <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Nenhum usuário usando proxy global no momento.</p>
          )}
        </div>
      </div>
    </div>
  );
}
