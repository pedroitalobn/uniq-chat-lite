"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { proxyApi, proxyPoolsApi } from "@/lib/api";
import {
  Globe, Loader2, CheckCircle2, XCircle, Trash2, TriangleAlert,
  ChevronDown, Plus, Shield, X, Eye, EyeOff, Check,
} from "lucide-react";
// (imports acima cobrem todos os ícones usados no arquivo)
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { showConfirm } from "@/lib/confirm";

const COUNTRY_FLAGS: Record<string, string> = {
  br: "🇧🇷", us: "🇺🇸", gb: "🇬🇧", ar: "🇦🇷", co: "🇨🇴", mx: "🇲🇽",
  es: "🇪🇸", de: "🇩🇪", fr: "🇫🇷", it: "🇮🇹", jp: "🇯🇵", cn: "🇨🇳",
  global: "🌍",
};

interface Props {
  instanceId: string;
}

interface ProxyProviderConfig {
  id: string;
  provider: string;
  name: string;
  country?: string;
  proxy_type?: string;
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  is_active?: boolean;
}

interface GlobalProxyConfig {
  id: string;
  name?: string;
  country?: string;
  enabled?: boolean;
  is_default?: boolean;
  host?: string;
  port?: number;
  proxy_type?: string;
}

type SelectedKey =
  | { kind: "none" }
  | { kind: "inherit" }
  | { kind: "global"; id: string }
  | { kind: "provider"; id: string };

export function ProxyConfigForm({ instanceId }: Props) {
  const router = useRouter();
  const { data: session } = useSession();

  const plan = (session?.user as unknown as { plan?: { allow_proxy?: boolean } })?.plan;
  const allowProxy = plan?.allow_proxy as boolean | undefined;

  const { data: proxy, refetch: refetchProxy } = useQuery({
    queryKey: ["proxy", instanceId],
    queryFn: () => proxyApi.get(instanceId).then((r) => r.data),
    enabled: !!allowProxy,
  });

  const { data: effective, refetch: refetchEffective } = useQuery({
    queryKey: ["proxy-effective", instanceId],
    queryFn: () => proxyApi.effective(instanceId).then((r) => r.data),
    enabled: !!allowProxy,
    refetchInterval: 30000,
  });

  const { data: providers = [], refetch: refetchProviders } = useQuery<ProxyProviderConfig[]>({
    queryKey: ["proxy-providers"],
    queryFn: () => proxyPoolsApi.listProviders().then((r) => r.data),
    enabled: !!allowProxy,
  });

  const { data: globals = [] } = useQuery<GlobalProxyConfig[]>({
    queryKey: ["global-proxies"],
    queryFn: () => proxyPoolsApi.getGlobalProxies().then((r) => r.data),
    enabled: !!allowProxy,
  });

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; external_ip?: string; latency_ms?: number; error?: string } | null>(null);

  // Resolve o "selecionado" a partir do estado persistido da instância
  const currentSelection: SelectedKey = useMemo(() => {
    const mode = proxy?.mode || effective?.proxy_mode;
    if (!proxy?.enabled && mode === "none") return { kind: "none" };
    if (mode === "inherit") return { kind: "inherit" };
    if (effective?.use_global_proxy && effective?.global_proxy_id) {
      return { kind: "global", id: String(effective.global_proxy_id) };
    }
    // Mode manual — tenta casar com um provider existente pelo host
    if (proxy?.host) {
      const match = providers.find(
        (p) =>
          p.proxy_host === proxy.host &&
          p.proxy_port === proxy.port &&
          p.proxy_type === proxy.type,
      );
      if (match) return { kind: "provider", id: match.id };
    }
    return { kind: "none" };
  }, [proxy, effective, providers]);

  const selectionLabel = (sel: SelectedKey): string => {
    if (sel.kind === "none") return "❌ Sem proxy";
    if (sel.kind === "inherit") return "🔗 Herdar do Server / Global padrão";
    if (sel.kind === "global") {
      const g = globals.find((x) => String(x.id) === sel.id);
      return g ? `🌐 ${g.name || "Proxy Global"} ${g.country ? (COUNTRY_FLAGS[g.country.toLowerCase()] || g.country) : ""}` : "🌐 Proxy Global";
    }
    const p = providers.find((x) => x.id === sel.id);
    if (!p) return "Proxy customizado";
    return `📌 ${p.name}${p.country ? ` ${COUNTRY_FLAGS[p.country.toLowerCase()] || ""}` : ""}`;
  };

  const saveMutation = useMutation({
    mutationFn: async (sel: SelectedKey) => {
      if (sel.kind === "none") {
        return proxyApi.setMode(instanceId, { mode: "none" });
      }
      if (sel.kind === "inherit") {
        return proxyApi.setMode(instanceId, { mode: "inherit" });
      }
      if (sel.kind === "global") {
        return proxyApi.setMode(instanceId, { mode: "global", global_proxy_id: sel.id });
      }
      return proxyApi.setMode(instanceId, { mode: "manual", provider_id: sel.id });
    },
    onSuccess: () => {
      toast.success("Proxy salvo");
      setTimeout(() => {
        refetchProxy();
        refetchEffective();
      }, 600);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Erro ao salvar proxy";
      toast.error(msg);
    },
  });

  const handleDelete = async () => {
    if (!(await showConfirm("Remover configuração de proxy? A instância voltará a usar a cadeia de herança.", { title: "Remover proxy", confirmLabel: "Remover" }))) return;
    try {
      await proxyApi.delete(instanceId);
      toast.success("Proxy removido");
      refetchProxy();
      refetchEffective();
    } catch {
      toast.error("Erro ao remover proxy");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await proxyApi.test(instanceId);
      setTestResult(r.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao testar";
      setTestResult({ success: false, error: msg });
    } finally {
      setTesting(false);
    }
  };

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  if (!allowProxy) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-10 text-center" style={cardStyle}>
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
          <button onClick={() => router.push("/plans")} className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm">
            Fazer upgrade
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      <EffectiveProxyPanel instanceId={instanceId} />

      <div className="rounded-2xl p-6 space-y-5" style={cardStyle}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)" }}
          >
            <Globe className="w-4 h-4" style={{ color: "#60a5fa" }} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
              Configuração de Proxy
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 48%)" }}>
              Escolha um proxy cadastrado ou herde da cadeia (Server → Global padrão).
            </p>
          </div>
        </div>

        {/* Dropdown Selector */}
        <div className="relative">
          <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>
            Proxy selecionado
          </label>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid hsl(240 12% 16%)",
              color: "hsl(240 15% 90%)",
            }}
          >
            <span className="truncate">{selectionLabel(currentSelection)}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} style={{ color: "hsl(240 8% 48%)" }} />
          </button>

          {dropdownOpen && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Fechar"
                onClick={() => setDropdownOpen(false)}
              />
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-20 max-h-80 overflow-y-auto"
                style={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 16%)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
              >
                {/* Seção: Herança */}
                <DropdownHeader label="Herança" />
                <DropdownItem
                  active={currentSelection.kind === "inherit"}
                  icon={<Shield className="w-3.5 h-3.5" style={{ color: "#818cf8" }} />}
                  title="Herdar do Server / Global padrão"
                  subtitle="Segue a cadeia — recomendado para a maioria dos casos"
                  onClick={() => {
                    setDropdownOpen(false);
                    saveMutation.mutate({ kind: "inherit" });
                  }}
                />

                {/* Seção: Proxies Globais */}
                {globals.filter((g) => g.enabled).length > 0 && (
                  <>
                    <DropdownHeader label="Proxies Globais (compartilhados)" />
                    {globals
                      .filter((g) => g.enabled)
                      .map((g) => (
                        <DropdownItem
                          key={g.id}
                          active={currentSelection.kind === "global" && currentSelection.id === String(g.id)}
                          icon={<span className="text-sm">{g.country ? COUNTRY_FLAGS[g.country.toLowerCase()] || "🌐" : "🌐"}</span>}
                          title={`${g.name || "Proxy Global"}${g.is_default ? " · default" : ""}`}
                          subtitle={g.host ? `${g.proxy_type || "http"}://${g.host}:${g.port || "?"}` : "host vazio (usa env)"}
                          onClick={() => {
                            setDropdownOpen(false);
                            saveMutation.mutate({ kind: "global", id: String(g.id) });
                          }}
                        />
                      ))}
                  </>
                )}

                {/* Seção: Meus Proxies */}
                <DropdownHeader label={`Meus Proxies (${providers.length})`} />
                {providers.length === 0 ? (
                  <div className="px-3 py-2 text-[11px]" style={{ color: "hsl(240 8% 42%)" }}>
                    Nenhum proxy cadastrado ainda.
                  </div>
                ) : (
                  providers.map((p) => (
                    <DropdownItem
                      key={p.id}
                      active={currentSelection.kind === "provider" && currentSelection.id === p.id}
                      icon={<span className="text-sm">{p.country ? COUNTRY_FLAGS[p.country.toLowerCase()] || "📌" : "📌"}</span>}
                      title={p.name}
                      subtitle={p.proxy_host ? `${p.proxy_type || "http"}://${p.proxy_host}:${p.proxy_port}` : p.provider}
                      onClick={() => {
                        setDropdownOpen(false);
                        saveMutation.mutate({ kind: "provider", id: p.id });
                      }}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false);
                    setShowNewModal(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left border-t"
                  style={{ color: "var(--green)", borderColor: "hsl(240 12% 14%)" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo proxy da conta...
                </button>

                {/* Seção: Desabilitar */}
                <DropdownHeader label="Outras" />
                <DropdownItem
                  active={currentSelection.kind === "none"}
                  icon={<XCircle className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />}
                  title="Sem proxy (conexão direta)"
                  subtitle="Bloqueia qualquer herança — não passa por proxy"
                  onClick={() => {
                    setDropdownOpen(false);
                    saveMutation.mutate({ kind: "none" });
                  }}
                />
              </div>
            </>
          )}
        </div>

        {saveMutation.isPending && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(240 8% 55%)" }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aplicando...
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div
            className="rounded-xl p-3 text-sm flex items-start gap-2"
            style={
              testResult.success
                ? { background: "rgba(0,212,106,0.06)", border: "1px solid rgba(0,212,106,0.15)" }
                : { background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }
            }
          >
            {testResult.success ? (
              <>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
                <span style={{ color: "#86efac" }}>
                  IP: <strong>{testResult.external_ip}</strong> — Latência: {testResult.latency_ms}ms
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
            disabled={testing}
            className="btn-ghost flex items-center gap-2 text-sm font-medium px-4 py-2.5 disabled:opacity-40"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Testar proxy atual
          </button>
          <div className="flex-1" />
          {proxy?.enabled && (
            <button
              type="button"
              onClick={handleDelete}
              className="p-2.5 rounded-xl transition-all"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                color: "hsl(240 8% 38%)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
                (e.currentTarget as HTMLElement).style.color = "#ef4444";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.15)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 38%)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
              }}
              title="Remover proxy"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Modal: Novo proxy da conta */}
      {showNewModal && (
        <NewProviderModal
          onClose={() => setShowNewModal(false)}
          onCreated={(createdId) => {
            setShowNewModal(false);
            refetchProviders();
            // Seleciona o recém-criado imediatamente
            saveMutation.mutate({ kind: "provider", id: createdId });
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DropdownHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase font-bold tracking-wider" style={{ color: "hsl(240 8% 42%)" }}>
      {label}
    </div>
  );
}

function DropdownItem({
  active, icon, title, subtitle, onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
      style={{
        background: active ? "rgba(0,212,106,0.08)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium" style={{ color: active ? "var(--green)" : "hsl(240 15% 88%)" }}>
          {title}
        </div>
        {subtitle && (
          <div className="text-[10px] font-mono truncate" style={{ color: "hsl(240 8% 42%)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {active && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--green)" }} />}
    </button>
  );
}

// ─── Modal: Novo proxy ───────────────────────────────────────────────────────
function NewProviderModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    type: "http" as "http" | "https" | "socks5",
    host: "",
    port: 33335,
    username: "",
    password: "",
    country: "br",
  });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSave = form.name.trim() && form.host.trim() && form.port > 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const r = await proxyPoolsApi.createProvider({
        provider: "manual",
        name: form.name.trim(),
        country: form.country,
        proxy_type: form.type,
        proxy_host: form.host.trim(),
        proxy_port: form.port,
        proxy_username: form.username,
        proxy_password: form.password,
      });
      const createdId = r.data?.id || r.data?.ID;
      if (!createdId) throw new Error("resposta sem id");
      toast.success("Proxy criado e selecionado");
      onCreated(createdId);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Erro ao criar proxy";
      toast.error(msg);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl p-6 space-y-4"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <Plus className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <div>
              <h3 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Novo Proxy</h3>
              <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 48%)" }}>
                Registra na sua conta — pode ser usado em várias instâncias.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "hsl(240 8% 48%)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>
            Nome *
          </label>
          <input
            className="input-field w-full"
            placeholder="Ex: BrightData BR Res"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Tipo</label>
            <select
              className="input-field w-full"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>País</label>
            <select
              className="input-field w-full"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            >
              <option value="br">🇧🇷 BR</option>
              <option value="us">🇺🇸 US</option>
              <option value="gb">🇬🇧 GB</option>
              <option value="ar">🇦🇷 AR</option>
              <option value="mx">🇲🇽 MX</option>
              <option value="global">🌍 Global</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Porta *</label>
            <input
              type="number"
              min={1}
              max={65535}
              className="input-field w-full"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Host *</label>
          <input
            className="input-field w-full"
            placeholder="brd.superproxy.io"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Usuário</label>
            <input
              className="input-field w-full"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 52%)" }}>Senha</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                className="input-field w-full pr-9"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                style={{ color: "hsl(240 8% 48%)" }}
              >
                {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm">Cancelar</button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--green)", color: "#0d0d0d" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar e selecionar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Effective Proxy Panel (exibe a cadeia de herança resolvida pelo backend) ─
interface ResolutionStep {
  level: string;
  mode: string;
  source?: string;
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
