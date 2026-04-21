"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Activity, Globe, Loader2, Save, Server, Shield, Users, X, Edit2, Trash2, Star, Check, TestTube2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ProxyConfig = {
  id: string;
  name: string;
  enabled: boolean;
  provider: string;
  proxy_type: string;
  host: string;
  port: number;
  username: string;
  is_active: boolean;
  is_default: boolean;
  country: string;
  has_password?: boolean;
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

const COUNTRIES = [
  { code: "br", label: "Brasil", flag: "🇧🇷" },
  { code: "us", label: "EUA", flag: "🇺🇸" },
  { code: "uk", label: "Reino Unido", flag: "🇬🇧" },
  { code: "de", label: "Alemanha", flag: "🇩🇪" },
  { code: "fr", label: "França", flag: "🇫🇷" },
  { code: "es", label: "Espanha", flag: "🇪🇸" },
  { code: "mx", label: "México", flag: "🇲🇽" },
  { code: "ar", label: "Argentina", flag: "🇦🇷" },
  { code: "co", label: "Colômbia", flag: "🇨🇴" },
  { code: "cl", label: "Chile", flag: "🇨🇱" },
  { code: "pt", label: "Portugal", flag: "🇵🇹" },
];

const PROXY_TYPES = [
  { code: "http", label: "HTTP" },
  { code: "https", label: "HTTPS" },
  { code: "socks5", label: "SOCKS5" },
];

function getCountryInfo(code: string) {
  return COUNTRIES.find(c => c.code === code) || { code, label: code.toUpperCase(), flag: "🌍" };
}

// ─── Proxy Modal Form ─────────────────────────────────────────────────────────
function ProxyModal({
  proxy,
  isOpen,
  onClose,
  onSave,
}: {
  proxy: ProxyConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<ProxyConfig> & { password?: string }) => void;
}) {
  const [form, setForm] = useState<Partial<ProxyConfig>>({
    name: "",
    enabled: true,
    provider: "manual",
    proxy_type: "http",
    host: "",
    port: 33335,
    username: "",
    is_active: true,
    is_default: false,
    country: "br",
  });
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; external_ip?: string; latency_ms?: number; error?: string; country?: string } | null>(null);

  // Reset form when proxy changes
  useEffect(() => {
    if (proxy) {
      setForm({
        id: proxy.id,
        name: proxy.name,
        enabled: proxy.enabled,
        provider: proxy.provider,
        proxy_type: proxy.proxy_type,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        is_active: proxy.is_active,
        is_default: proxy.is_default,
        country: proxy.country,
      });
      setHasExistingPassword(!!proxy.has_password);
      setPassword("");
    } else {
      // Reset for new proxy
      setForm({
        name: "",
        enabled: true,
        provider: "manual",
        proxy_type: "http",
        host: "",
        port: 33335,
        username: "",
        is_active: true,
        is_default: false,
        country: "br",
      });
      setHasExistingPassword(false);
      setPassword("");
    }
  }, [proxy]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, password: password || undefined });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Testa credenciais antes de salvar, sem criar nada no banco. O backend
  // recebe host/port/user/pass diretamente, testa a conexão e devolve
  // external_ip + country (detectado server-side). Nada fica persistido.
  const handleTest = async () => {
    if (!form.host || !form.port) {
      toast.error("Host e porta são obrigatórios pra testar");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const tested = await adminApi.testGlobalProxyInline({
        proxy_type: form.proxy_type,
        host: form.host,
        port: form.port,
        username: form.username,
        password: password || undefined,
      }).then((r) => r.data);
      if (!tested.success) {
        setTestResult({ success: false, error: tested.error });
        toast.error(tested.error || "Teste falhou");
        return;
      }
      const detectedCountry: string | undefined = tested.country ? String(tested.country).toLowerCase() : undefined;
      if (detectedCountry) setForm(p => ({ ...p, country: detectedCountry }));
      setTestResult({
        success: true,
        external_ip: tested.external_ip,
        latency_ms: tested.latency_ms,
        country: detectedCountry,
      });
      toast.success(`Proxy OK · IP ${tested.external_ip}${detectedCountry ? ` · ${detectedCountry.toUpperCase()}` : ""}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || "Erro no teste";
      setTestResult({ success: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl p-6 space-y-4 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6.5%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
            {proxy?.id ? "Editar Proxy" : "Novo Proxy"}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" style={{ color: "hsl(240 8% 46%)" }} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-[11px] font-medium block mb-1.5" style={{ color: "hsl(240 8% 58%)" }}>Nome</label>
            <input value={form.name || ""} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
              className="input-field w-full text-sm" placeholder="Meu Proxy BR" />
          </div>

          <div className="col-span-2">
            <label className="text-[11px] font-medium block mb-1.5" style={{ color: "hsl(240 8% 58%)" }}>Tipo</label>
            <select value={form.proxy_type || "http"} onChange={(e) => setForm(p => ({ ...p, proxy_type: e.target.value }))}
              className="input-field w-full text-sm">
              {PROXY_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="text-[11px] font-medium block mb-1.5" style={{ color: "hsl(240 8% 58%)" }}>Host</label>
            <input value={form.host || ""} onChange={(e) => setForm(p => ({ ...p, host: e.target.value }))}
              className="input-field w-full text-sm" placeholder="31.59.20.176" />
          </div>

          <div>
            <label className="text-[11px] font-medium block mb-1.5" style={{ color: "hsl(240 8% 58%)" }}>Porta</label>
            <input type="number" value={form.port || ""} onChange={(e) => setForm(p => ({ ...p, port: Number(e.target.value) }))}
              className="input-field w-full text-sm" placeholder="33335" />
          </div>

          <div>
            <label className="text-[11px] font-medium block mb-1.5" style={{ color: "hsl(240 8% 58%)" }}>Username</label>
            <input value={form.username || ""} onChange={(e) => setForm(p => ({ ...p, username: e.target.value }))}
              className="input-field w-full text-sm" placeholder="usuário" />
          </div>

          <div className="col-span-2">
            <label className="text-[11px] font-medium block mb-1.5" style={{ color: "hsl(240 8% 58%)" }}>Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="input-field w-full text-sm" placeholder={hasExistingPassword ? "•••••••• (alterar senha)" : "Senha do proxy"} />
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled ?? false} onChange={(e) => setForm(p => ({ ...p, enabled: e.target.checked }))}
              className="w-4 h-4 rounded" />
            <span className="text-xs" style={{ color: "hsl(240 8% 58%)" }}>Ativo</span>
          </label>
        </div>

        {testResult && (
          <div className="p-3 rounded-xl text-xs"
            style={{
              background: testResult.success ? "rgba(0,212,106,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${testResult.success ? "rgba(0,212,106,0.2)" : "rgba(239,68,68,0.2)"}`,
              color: testResult.success ? "var(--green)" : "#f87171",
            }}>
            {testResult.success ? (
              <>
                ✓ IP externo <code>{testResult.external_ip}</code> · {testResult.latency_ms}ms
                {testResult.country && (
                  <> · país detectado: <strong>{getCountryInfo(testResult.country).flag} {getCountryInfo(testResult.country).label}</strong></>
                )}
              </>
            ) : (
              <>✗ {testResult.error}</>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={handleTest} disabled={testing || !form.host || !form.port}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "hsl(240 12% 12%)", color: "hsl(240 15% 85%)", opacity: (testing || !form.host || !form.port) ? 0.5 : 1 }}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
            Testar
          </button>
          <button onClick={handleSubmit} disabled={saving || (testResult && !testResult.success) || false}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--green)", color: "#04200f", opacity: saving ? 0.7 : 1 }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {proxy?.id ? "Salvar" : "Criar Proxy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Set Default Modal ─────────────────────────────────────────────────────────
function SetDefaultModal({
  isOpen,
  currentCountry,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  currentCountry: string;
  onClose: () => void;
  onConfirm: (country: string) => void;
}) {
  const [selectedCountry, setSelectedCountry] = useState(currentCountry);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6.5%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h3 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
          Definir Proxy Padrão
        </h3>
        <p className="text-sm" style={{ color: "hsl(240 8% 58%)" }}>
          Selecione o país que terá este proxy como padrão:
        </p>

        <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)}
          className="input-field w-full text-sm">
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
          ))}
        </select>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 70%)" }}>
            Cancelar
          </button>
          <button onClick={() => onConfirm(selectedCountry)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--green)", color: "#04200f" }}>
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────────
function DeleteModal({
  isOpen,
  proxyName,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  proxyName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6.5%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h3 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
          Excluir Proxy
        </h3>
        <p className="text-sm" style={{ color: "hsl(240 8% 58%)" }}>
          Tem certeza que deseja excluir <strong>{proxyName}</strong>? Esta ação não pode ser desfeita.
        </p>

        <label className="flex items-center gap-2 text-sm" style={{ color: "hsl(240 8% 58%)" }}>
          <input type="checkbox" checked={confirming} onChange={(e) => setConfirming(e.target.checked)} className="w-4 h-4 rounded" />
          Sim, desejo excluir permanentemente
        </label>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 70%)" }}>
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={!confirming} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "#ef4444", color: "#fff", opacity: confirming ? 1 : 0.5 }}>
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function AdminProxyPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const isSuperAdmin = session?.user?.role === "super_admin";

  // Modals state
  const [proxyModal, setProxyModal] = useState<{ open: boolean; proxy: ProxyConfig | null }>({ open: false, proxy: null });
  const [defaultModal, setDefaultModal] = useState<{ open: boolean; proxy: ProxyConfig | null }>({ open: false, proxy: null });
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; proxy: ProxyConfig | null }>({ open: false, proxy: null });

  const { data: configs = [], isLoading } = useQuery<ProxyConfig[]>({
    queryKey: ["admin-proxy-config"],
    queryFn: () => adminApi.getProxyConfig().then((r) => r.data as any),
  });

  const { data: stats } = useQuery<ProxyStats>({
    queryKey: ["admin-proxy-stats"],
    queryFn: () => adminApi.getProxyStats().then((r) => r.data as any),
    refetchInterval: 15000,
  });

  // Mutations
  const createUpdateMutation = useMutation({
    mutationFn: async (data: Partial<ProxyConfig> & { password?: string }) => {
      await adminApi.updateProxyConfig(data);
    },
    onSuccess: () => {
      toast.success(proxyModal.proxy?.id ? "Proxy atualizado" : "Proxy criado");
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
      qc.invalidateQueries({ queryKey: ["admin-proxy-stats"] });
    },
    onError: () => toast.error("Erro ao salvar proxy"),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async ({ id, country }: { id: string; country: string }) => {
      const proxyToUpdate = configs.find((c) => c.id === id);
      if (!proxyToUpdate) throw new Error("Proxy não encontrado");
      
      // Update existing proxy to be default (just set is_default and country)
      await adminApi.updateProxyConfig({
        id: id,
        name: proxyToUpdate.name,
        enabled: proxyToUpdate.enabled,
        provider: proxyToUpdate.provider,
        proxy_type: proxyToUpdate.proxy_type,
        host: proxyToUpdate.host,
        port: proxyToUpdate.port,
        username: proxyToUpdate.username,
        is_active: proxyToUpdate.is_active,
        is_default: true,
        country: country,
      });
    },
    onSuccess: () => {
      toast.success("Proxy definido como padrão");
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
      setDefaultModal({ open: false, proxy: null });
    },
    onError: () => toast.error("Erro ao definir padrão"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await adminApi.deleteProxyConfig(id);
    },
    onSuccess: () => {
      toast.success("Proxy excluído");
      qc.invalidateQueries({ queryKey: ["admin-proxy-config"] });
      qc.invalidateQueries({ queryKey: ["admin-proxy-stats"] });
      setDeleteModal({ open: false, proxy: null });
    },
    onError: () => toast.error("Erro ao excluir proxy"),
  });

  const cards = [
    { label: "Usuários totais", value: stats?.summary?.total_users ?? 0, icon: Users },
    { label: "Instâncias totais", value: stats?.summary?.total_instances ?? 0, icon: Server },
    { label: "No proxy global", value: stats?.summary?.global_proxy_instances ?? 0, icon: Globe },
    { label: "Elegíveis por plano", value: stats?.summary?.eligible_users_by_plan ?? 0, icon: Shield },
    { label: "Conexões OK", value: stats?.summary?.connected_proxy_samples ?? 0, icon: Activity },
  ];

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="w-10 h-10" style={{ color: "hsl(240 8% 46%)" }} />
        <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Acesso restrito a super administradores</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: "hsl(240 15% 93%)" }}>Proxy Global</h1>
          <p className="text-sm mt-1 hidden sm:block" style={{ color: "hsl(240 8% 46%)" }}>
            Configure proxies residenciais por país para reduzir banimento.
          </p>
        </div>
        <button
          onClick={() => setProxyModal({ open: true, proxy: null })}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ background: "var(--green)", color: "#000" }}
        >
          + <span className="hidden sm:inline">Novo Proxy</span>
          <span className="sm:hidden">Novo</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl p-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
            <div className="flex items-center gap-2 mb-2">
              <c.icon className="w-4 h-4" style={{ color: "hsl(240 8% 60%)" }} />
              <span className="text-[11px]" style={{ color: "hsl(240 8% 48%)" }}>{c.label}</span>
            </div>
            <div className="text-xl font-bold" style={{ color: "hsl(240 15% 92%)" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Proxy List */}
      <div className="rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
            Proxies Configurados
          </h2>
          <span className="text-xs px-2 py-1 rounded-lg" style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 60%)" }}>
            {configs.length} proxy{configs.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="space-y-2">
          {configs.map((proxy) => {
            const country = getCountryInfo(proxy.country || "br");
            return (
              <div key={proxy.id} className="rounded-xl p-4 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: proxy.enabled ? "rgba(0,212,106,0.1)" : "rgba(255,255,255,0.04)" }}>
                    <Globe className="w-5 h-5" style={{ color: proxy.enabled ? "var(--green)" : "hsl(240 8% 40%)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                      {proxy.name || "Proxy"}
                      {proxy.is_default && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--green)", color: "#04200f" }}>
                        Padrão
                        </span>
                      )}
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]" style={{ background: "hsl(240 12% 15%)", color: "hsl(240 8% 60%)" }}>
                        {country.flag} {country.label}
                      </span>
                    </p>
                    <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
                      {proxy.host}:{proxy.port} • {proxy.provider} • {proxy.proxy_type}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!proxy.is_default && (
                    <button
                      onClick={() => setDefaultModal({ open: true, proxy })}
                      className="p-2 rounded-lg hover:bg-white/5"
                      title="Definir como padrão"
                    >
                      <Star className="w-4 h-4" style={{ color: "hsl(240 8% 46%)" }} />
                    </button>
                  )}
                  <button
                    onClick={() => setProxyModal({ open: true, proxy })}
                    className="p-2 rounded-lg hover:bg-white/5"
                    title="Editar"
                  >
                    <Edit2 className="w-4 h-4" style={{ color: "hsl(240 8% 46%)" }} />
                  </button>
                  <button
                    onClick={() => setDeleteModal({ open: true, proxy })}
                    className="p-2 rounded-lg hover:bg-white/5"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" style={{ color: "#ef4444" }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {configs.length === 0 && (
          <div className="text-center py-8">
            <Globe className="w-12 h-12 mx-auto mb-3" style={{ color: "hsl(240 8% 30%)" }} />
            <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Nenhum proxy configurado.</p>
            <button
              onClick={() => setProxyModal({ open: true, proxy: null })}
              className="mt-3 px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: "var(--green)", color: "#000" }}
            >
              + Novo Proxy
            </button>
          </div>
        )}
      </div>

      {/* Users Using Global Proxy */}
      {stats?.users?.length > 0 && (
        <div className="rounded-2xl p-6" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: "hsl(240 15% 92%)" }}>Usuários usando proxy global</h2>
          <div className="space-y-2">
            {stats.users.map((u) => (
              <div key={u.user_id} className="rounded-lg p-3 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>
                    {u.name} <span style={{ color: "hsl(240 8% 46%)" }}>({u.plan_name})</span>
                  </p>
                  <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>{u.email}</p>
                </div>
                <div className="text-xs" style={{ color: "hsl(240 8% 62%)" }}>
                  Instâncias: {u.instances} | Conectadas: {u.connected}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      <ProxyModal
        proxy={proxyModal.proxy}
        isOpen={proxyModal.open}
        onClose={() => setProxyModal({ open: false, proxy: null })}
        onSave={(data) => createUpdateMutation.mutate(data as any)}
      />

      <SetDefaultModal
        isOpen={defaultModal.open}
        currentCountry={defaultModal.proxy?.country || "br"}
        onClose={() => setDefaultModal({ open: false, proxy: null })}
        onConfirm={(country) => {
          if (defaultModal.proxy) {
            setDefaultMutation.mutate({ id: defaultModal.proxy.id, country });
          }
        }}
      />

      <DeleteModal
        isOpen={deleteModal.open}
        proxyName={deleteModal.proxy?.name || "este proxy"}
        onClose={() => setDeleteModal({ open: false, proxy: null })}
        onConfirm={() => {
          if (deleteModal.proxy) {
            deleteMutation.mutate(deleteModal.proxy.id);
          }
        }}
      />
    </div>
  );
}