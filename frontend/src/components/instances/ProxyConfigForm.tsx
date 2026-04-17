"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { proxyApi, proxyPoolsApi, adminApi } from "@/lib/api";
import { Globe, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Trash2, TriangleAlert, Save, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { showConfirm } from "@/lib/confirm";

const COUNTRY_FLAGS: Record<string, string> = {
  br: "🇧🇷", us: "🇺🇸", gb: "🇬🇧", ar: "🇦🇷", co: "🇨🇴", mx: "🇲🇽", 
  es: "🇪🇸", de: "🇩🇪", fr: "🇫🇷", it: "🇮🇹", jp: "🇯🇵", cn: "🇨🇳",
  global: "🌍"
};

interface Props {
  instanceId: string;
}

interface TestResult {
  success: boolean;
  external_ip?: string;
  latency_ms?: number;
  country?: string;
  error?: string;
}

interface ProxyProviderConfig {
  id: string;
  name: string;
  provider: string;
  proxy_type?: string;
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  country?: string;
}

interface GlobalProxyConfig {
  id: string;
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  proxy_type: string;
  username: string;
  country: string;
}

export function ProxyConfigForm({ instanceId }: Props) {
  const { data: session } = useSession();
  const plan = session?.user?.plan as Record<string, unknown> | undefined;
  const allowProxy = plan?.allow_proxy as boolean | undefined;

  const { data: proxy, refetch } = useQuery({
    queryKey: ["proxy", instanceId],
    queryFn: () => proxyApi.get(instanceId).then((r) => r.data),
    enabled: !!allowProxy,
  });

  const { data: proxyProviders } = useQuery<ProxyProviderConfig[]>({
    queryKey: ["proxy-providers"],
    queryFn: () => proxyPoolsApi.listProviders().then((r) => r.data),
    enabled: !!allowProxy,
  });

  const { data: globalProxy } = useQuery<GlobalProxyConfig[]>({
    queryKey: ["global-proxies"],
    queryFn: () => proxyPoolsApi.getGlobalProxies().then((r) => r.data),
    enabled: !!allowProxy,
  });

  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [form, setForm] = useState({
    enabled: false,
    type: "socks5" as "http" | "https" | "socks5",
    host: "",
    port: 1080,
    username: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (proxy) {
      setForm({
        enabled: proxy.enabled ?? false,
        type: proxy.type || "socks5",
        host: proxy.host || "",
        port: proxy.port || 1080,
        username: proxy.username || "",
        password: "",
      });
    }
  }, [proxy]);

const handleSelectProvider = (providerId: string) => {
    setShowProviderDropdown(false);

    if (providerId.startsWith("global:")) {
      const proxyId = providerId.replace("global:", "");
      const gp = globalProxy?.find(p => p.id === proxyId);
      if (gp && gp.enabled && gp.host) {
        setSelectedProvider(providerId);
        setForm({
          enabled: true,
          type: "http",
          host: "",
          port: 0,
          username: "",
          password: "",
        });
        toast.info(`Usando ${gp.name || "Proxy Global"} (${gp.country ? COUNTRY_FLAGS[gp.country.toLowerCase()] || "" : ""})`);
      } else {
        toast.error("Proxy global não configurado");
        setSelectedProvider("");
      }
    } else if (providerId === "none") {
      setSelectedProvider(providerId);
      setForm({
        enabled: false,
        type: "socks5",
        host: "",
        port: 1080,
        username: "",
        password: "",
      });
    } else {
      const provider = proxyProviders?.find(p => p.id === providerId);
      if (provider && provider.proxy_host) {
        setSelectedProvider(providerId);
        setForm({
          enabled: true,
          type: (provider.proxy_type as "http" | "https" | "socks5") || "socks5",
          host: provider.proxy_host,
          port: provider.proxy_port || 1080,
          username: provider.proxy_username || "",
          password: "",
        });
      }
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // If selecting global proxy
      if (selectedProvider.startsWith("global:")) {
        const proxyId = selectedProvider.replace("global:", "");
        return proxyApi.setMode(instanceId, { mode: "global", global_proxy_id: proxyId });
      }
      // If selecting custom provider
      if (selectedProvider && !selectedProvider.startsWith("global:") && selectedProvider !== "none") {
        return proxyApi.setMode(instanceId, { mode: "manual", provider_id: selectedProvider });
      }
      // If none selected
      if (selectedProvider === "none") {
        return proxyApi.setMode(instanceId, { mode: "none" });
      }
      // Otherwise use manual form
      return proxyApi.set(instanceId, { ...form });
    },
    onSuccess: () => {
      toast.success("Proxy salvo!");
      setTimeout(() => refetch(), 2000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao salvar proxy";
      toast.error(msg);
    },
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = form.host ? form : undefined;
      const res = await proxyApi.test(instanceId, payload);
      setTestResult(res.data);
    } catch {
      setTestResult({ success: false, error: "Erro ao testar proxy" });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!await showConfirm("Remover configuração de proxy? A instância voltará a usar conexão direta.", { title: "Remover proxy", confirmLabel: "Remover" })) return;
    setDeleting(true);
    try {
      await proxyApi.delete(instanceId);
      toast.success("Proxy removido. Usando conexão direta.");
      refetch();
    } catch {
      toast.error("Erro ao remover proxy");
    } finally {
      setDeleting(false);
    }
  };

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  if (!allowProxy) {
  const router = useRouter();
  return (
    <div className="rounded-2xl p-10 text-center animate-fade-in-up" style={cardStyle}>
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.18)" }}
      >
        <TriangleAlert className="w-5 h-5" style={{ color: "#fbbf24" }} />
      </div>
      <p className="font-semibold text-sm mb-2" style={{ color: "hsl(240 15% 88%)" }}>
        Proxy indisponível no seu plano
      </p>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: "hsl(240 8% 46%)" }}>
        Proxy dedicado está disponível nos planos Pro e Business.<br />
        Faça upgrade para desbloquear.
      </p>
      <button 
        onClick={() => router.push("/plans")}
        className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
      >
        Fazer upgrade
      </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      <EffectiveProxyPanel instanceId={instanceId} />
      <div className="rounded-2xl p-6 space-y-5" style={cardStyle}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)" }}
            >
              <Globe className="w-4 h-4" style={{ color: "#60a5fa" }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
                Configuração de Proxy
              </h3>
              {proxy?.status === "ok" && (
                <p className="text-xs font-mono mt-0.5" style={{ color: "var(--green)" }}>
                  IP externo: {proxy.external_ip}
                </p>
              )}
              {proxy?.status === "failed" && (
                <p className="text-xs mt-0.5" style={{ color: "#f87171" }}>{proxy.error}</p>
              )}
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <div className="w-11 h-6 rounded-full transition-colors peer-checked:[background:var(--green)] [background:hsl(240_12%_18%)] relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {form.enabled && (
          <div className="space-y-4 pt-1">
            {/* Proxy Selector Dropdown */}
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Selecionar Proxy</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowProviderDropdown(!showProviderDropdown)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}
                >
                  <span>
                    {selectedProvider.startsWith("global:") 
                      ? "🌐 Proxy Global Uniq" 
                      : selectedProvider === "none"
                      ? "❌ Sem proxy"
                      : proxyProviders?.find(p => p.id === selectedProvider)?.name || "Selecione um proxy..."}
                  </span>
                  <ChevronDown className="w-4 h-4" style={{ color: "hsl(240 8% 48%)" }} />
                </button>
                
                {showProviderDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-10" style={{ background: "hsl(240 18% 8%)", borderColor: "hsl(240 12% 16%)" }}>
                    {globalProxy?.filter(p => p.enabled && p.host).map(gp => (
                      <button
                        key={gp.id}
                        type="button"
                        onClick={() => handleSelectProvider(`global:${gp.id}`)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5"
                        style={{ color: "hsl(240 15% 90%)" }}
                      >
                        🌐 {gp.name || "Proxy Global"} {gp.country ? `(${COUNTRY_FLAGS[gp.country.toLowerCase()] || gp.country})` : ""}
                      </button>
                    ))}
                    {proxyProviders?.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectProvider(p.id)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5"
                        style={{ color: "hsl(240 15% 90%)" }}
                      >
                        📌 {p.name} ({p.provider === "manual" ? p.proxy_host : p.provider})
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setShowProviderDropdown(false);
                        window.location.href = "/integrations?section=proxy";
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5 border-t"
                      style={{ color: "var(--green)" }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      + Adicionar novo proxy
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectProvider("none")}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-white/5"
                      style={{ color: "hsl(240 8% 58%)" }}
                    >
                      ❌ Remover proxy
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Type selector */}
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Tipo</label>
              <div className="flex gap-2">
                {(["socks5", "http", "https"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    className="flex-1 py-2 text-xs font-semibold rounded-xl border transition-all"
                    style={form.type === t ? {
                      background: "rgba(96,165,250,0.08)",
                      borderColor: "rgba(96,165,250,0.2)",
                      color: "#60a5fa",
                    } : {
                      background: "rgba(255,255,255,0.03)",
                      borderColor: "rgba(255,255,255,0.06)",
                      color: "hsl(240 8% 42%)",
                    }}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Host + Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Host</label>
                <input
                  type="text"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="proxy.exemplo.com"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Porta</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 1080 })}
                  min={1}
                  max={65535}
                  className="input-field w-full"
                />
              </div>
            </div>

            {/* Username + Password */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>
                  Usuário <span style={{ color: "hsl(240 8% 32%)" }}>(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="username"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>
                  Senha <span style={{ color: "hsl(240 8% 32%)" }}>(opcional)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={proxy?.password ? "••••••••" : "senha"}
                    className="input-field w-full pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "hsl(240 8% 38%)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                    onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div
            className="rounded-xl p-3 text-sm flex items-start gap-2"
            style={testResult.success ? {
              background: "rgba(0,212,106,0.06)",
              border: "1px solid rgba(0,212,106,0.15)",
            } : {
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.15)",
            }}
          >
            {testResult.success ? (
              <>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
                <span style={{ color: "#86efac" }}>
                  IP: <strong>{testResult.external_ip}</strong> 
                  {testResult.country && ` (${testResult.country})`}
                  {" "}— Latência: {testResult.latency_ms}ms
                </span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#f87171" }} />
                <span style={{ color: "#fca5a5" }}>{testResult.error}</span>
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !form.host}
            className="btn-ghost flex items-center gap-2 text-sm font-medium px-4 py-2.5 disabled:opacity-40"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Testar
          </button>

          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all disabled:opacity-40"
            style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", color: "#60a5fa" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(96,165,250,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(96,165,250,0.08)")}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Salvar Proxy
          </button>

          {proxy?.enabled && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="p-2.5 rounded-xl transition-all disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", color: "hsl(240 8% 38%)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
                (e.currentTarget as HTMLElement).style.color = "#ef4444";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.15)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 38%)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
              }}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Effective Proxy Panel (exibe a cadeia de herança resolvida pelo backend) ─
interface ResolutionStep {
  level: string;   // instance | server | default_global
  mode: string;    // none | manual | residencial | global | inherit
  source?: string; // instance_manual | server_manual | global_db | global_env | ...
  applied: boolean;
  reason?: string;
}

interface EffectiveResponse {
  instance_id: string;
  proxy_mode: string;
  proxy_enabled: boolean;
  use_global_proxy: boolean;
  global_proxy_id: string | null;
  pool_id: string | null;
  server_id: string | null;
  running: boolean;
  source: string;
  level: string;
  chain: ResolutionStep[];
  effective: null | {
    enabled: boolean;
    type: string;
    host: string;
    port: number;
    username: string;
    password: string;
    url: string;
  };
  note?: string;
}

const LEVEL_LABEL: Record<string, string> = {
  instance: "Instância",
  server: "Server",
  default_global: "Proxy Global padrão",
};

const LEVEL_COLOR: Record<string, string> = {
  instance: "#60a5fa",
  server: "#818cf8",
  default_global: "#34d399",
};

function EffectiveProxyPanel({ instanceId }: { instanceId: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery<EffectiveResponse>({
    queryKey: ["proxy-effective", instanceId],
    queryFn: async () => (await proxyApi.effective(instanceId)).data,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl p-4 flex items-center gap-2" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(240 8% 48%)" }} />
        <span className="text-xs" style={{ color: "hsl(240 8% 55%)" }}>Calculando proxy efetivo...</span>
      </div>
    );
  }
  if (!data) return null;

  const eff = data.effective;
  const headerColor = eff ? "var(--green)" : "#f87171";
  const headerLabel = eff ? "Proxy ativo" : "Sem proxy";

  return (
    <div className="rounded-2xl p-5 space-y-4"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: headerColor }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: headerColor }}>
            {headerLabel}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-md" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 60%)" }}>
            origem: {data.source}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-md" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 60%)" }}>
            nível: {LEVEL_LABEL[data.level] || data.level}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[10px] px-2 py-1 rounded-md transition-colors"
          style={{ color: "hsl(240 8% 48%)", background: "hsl(240 12% 10%)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--green)")}
          onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 48%)")}
        >
          {isFetching ? "..." : "recalcular"}
        </button>
      </div>

      {/* Effective config */}
      {eff ? (
        <div className="rounded-xl p-3" style={{ background: "rgba(0,212,106,0.05)", border: "1px solid rgba(0,212,106,0.15)" }}>
          <p className="text-[10px] uppercase font-bold mb-1.5" style={{ color: "var(--green)" }}>Configuração que o whatsmeow está usando</p>
          <p className="text-xs font-mono break-all" style={{ color: "hsl(240 15% 85%)" }}>{eff.url}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]" style={{ color: "hsl(240 8% 52%)" }}>
            <div><span className="opacity-60">tipo:</span> {eff.type}</div>
            <div><span className="opacity-60">host:</span> <span className="font-mono">{eff.host}</span></div>
            <div><span className="opacity-60">porta:</span> <span className="font-mono">{eff.port}</span></div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
          <p className="text-xs" style={{ color: "#f87171" }}>{data.note || "Conexão direta sem proxy."}</p>
        </div>
      )}

      {/* Inheritance chain */}
      {data.chain && data.chain.length > 0 && (
        <div>
          <p className="text-[10px] uppercase font-bold mb-2" style={{ color: "hsl(240 8% 55%)" }}>
            Cadeia de resolução
          </p>
          <div className="space-y-1.5">
            {data.chain.map((step, i) => {
              const color = LEVEL_COLOR[step.level] || "hsl(240 8% 50%)";
              return (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg"
                  style={{
                    background: step.applied ? "rgba(0,212,106,0.06)" : "hsl(240 12% 8%)",
                    border: `1px solid ${step.applied ? "rgba(0,212,106,0.2)" : "hsl(240 12% 12%)"}`,
                  }}>
                  <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: step.applied ? "rgba(0,212,106,0.15)" : "hsl(240 12% 14%)", color: step.applied ? "var(--green)" : "hsl(240 8% 45%)" }}>
                    {step.applied ? "✓" : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase"
                        style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
                        {LEVEL_LABEL[step.level] || step.level}
                      </span>
                      <span className="text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>
                        mode: <span className="font-mono" style={{ color: "hsl(240 15% 80%)" }}>{step.mode}</span>
                      </span>
                      {step.source && (
                        <span className="text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>
                          origem: <span className="font-mono" style={{ color: "hsl(240 15% 80%)" }}>{step.source}</span>
                        </span>
                      )}
                    </div>
                    {step.reason && (
                      <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 48%)" }}>{step.reason}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* State summary */}
      <div className="grid grid-cols-2 gap-2 text-[10px]" style={{ color: "hsl(240 8% 48%)" }}>
        <div>
          <span className="opacity-60">proxy_mode:</span>{" "}
          <span className="font-mono" style={{ color: "hsl(240 15% 80%)" }}>{data.proxy_mode || "—"}</span>
        </div>
        <div>
          <span className="opacity-60">executando:</span>{" "}
          <span className="font-mono" style={{ color: data.running ? "var(--green)" : "#f87171" }}>
            {data.running ? "sim" : "não"}
          </span>
        </div>
        {data.server_id && (
          <div className="col-span-2">
            <span className="opacity-60">server_id:</span>{" "}
            <span className="font-mono" style={{ color: "hsl(240 15% 80%)" }}>{data.server_id}</span>
          </div>
        )}
      </div>
    </div>
  );
}
