"use client";

import { Suspense, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { toast } from "sonner";
import { AnimatedTabContent } from "@/components/ui/AnimatedTabContent";
import {
  CreditCard, Mail, MessageSquare, Server, Globe, Shield, Key, Save, Check, X,
  Loader2, RefreshCw, Edit2, ExternalLink, Smartphone, Settings2, Sparkles, Mic2, DollarSign,
} from "lucide-react";
import { PlatformAIPanel } from "@/app/(dashboard)/admin/platform-ai/page";
import { PlatformVoicePanel } from "@/components/admin/PlatformVoicePanel";
import { PricingConfigPanel } from "@/components/admin/PricingConfigPanel";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = "payment" | "communication" | "server" | "proxies" | "ai" | "voice" | "pricing";
type CommSection = "email" | "templates" | "otp";

interface PaymentSettings {
  active_provider: string;
  stripe_checkout_type?: string;
  stripe_configured?: boolean;
  stripe_webhook_url?: string;
  /** Preview mascarado da secret key (ex: "sk_l••••••••aBc1"). Nunca a key crua. */
  stripe_secret_key_preview?: string;
  /** "live" | "test" | "" — derivado do prefixo da secret key. */
  stripe_secret_key_env?: string;
  stripe_webhook_secret_preview?: string;
  /** Status real do último teste de conectividade — "ok" | "failed" | "" (nunca testado). */
  stripe_test_status?: string;
  stripe_tested_at?: string | null;
  stripe_test_error?: string;
  stripe_country_codes?: string[];
  asaas_environment?: string;
  asaas_configured?: boolean;
  asaas_webhook_url?: string;
  asaas_api_key_preview?: string;
  asaas_webhook_secret_preview?: string;
  asaas_test_status?: string;
  asaas_tested_at?: string | null;
  asaas_test_error?: string;
  asaas_country_codes?: string[];
  abacatepay_environment?: string;
  abacatepay_configured?: boolean;
  abacatepay_checkout_type?: string;
  abacatepay_webhook_url?: string;
  abacatepay_api_key_preview?: string;
  abacatepay_webhook_secret_preview?: string;
  abacatepay_test_status?: string;
  abacatepay_tested_at?: string | null;
  abacatepay_test_error?: string;
  abacatepay_country_codes?: string[];
}

interface EmailSettings {
  api_key?: string;
  sender_email?: string;
  sender_name?: string;
  is_enabled?: boolean;
}

interface EmailTemplate {
  id: string;
  slug: string;
  name: string;
  subject: string;
  html_content: string;
  is_active: boolean;
}

interface ServerRow { name: string; address: string; port: number; status: string; owner_email?: string; }
interface InstanceRow { name: string; type?: string; channel?: string; status: string; owner_email?: string; server?: string; }

// ─── Shared primitives ────────────────────────────────────────────────────────
const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid var(--border-default)",
  borderRadius: 16,
  padding: 24,
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...CARD, ...style }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-1)" }}>{children}</h2>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-3)" }}>{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none focus:border-[#00d46a] transition-colors"
      style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", color: "var(--text-1)" }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none focus:border-[#00d46a] transition-colors"
      style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", color: "var(--text-1)" }}
    />
  );
}

function SaveBtn({ loading, onClick, label = "Salvar" }: { loading?: boolean; onClick?: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-2 bg-[#00d46a] text-[#050508] font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
      style={{ background: ok ? "rgba(0,212,106,0.12)" : "rgba(251,191,36,0.12)", color: ok ? "#00d46a" : "#fbbf24" }}>
      {label ?? (ok ? "Configurado" : "Não configurado")}
    </span>
  );
}

// TestConnectionButton — chama POST /admin/payment-settings/test/<provider>
// que faz uma chamada read-only no provider (Stripe: GET /v1/balance,
// Asaas: GET /api/v3/customers?limit=1) e atualiza test_status. Refresh
// do query "admin-payment-settings" pra UI re-renderizar com o novo
// status assim que volta.
function TestConnectionButton({ provider, disabled }: { provider: "stripe" | "asaas" | "abacatepay"; disabled?: boolean }) {
  const queryClient = useQueryClient();
  const testMut = useMutation({
    mutationFn: () => adminApi.testPaymentProvider(provider),
    onSuccess: (res) => {
      const ok = (res.data as { ok?: boolean })?.ok;
      const errMsg = (res.data as { error?: string })?.error;
      queryClient.invalidateQueries({ queryKey: ["admin-payment-settings"] });
      if (ok) toast.success(`Conexão ${provider} OK`);
      else toast.error(`Falhou: ${errMsg || "verifique credenciais"}`);
    },
    onError: () => toast.error("Erro ao testar conexão"),
  });
  return (
    <button
      type="button"
      onClick={() => testMut.mutate()}
      disabled={disabled || testMut.isPending}
      className="text-[10px] px-2.5 py-1 rounded-md font-medium disabled:opacity-50"
      style={{
        background: "var(--input)",
        border: "1px solid var(--border-default)",
        color: "hsl(240 15% 80%)",
      }}
    >
      {testMut.isPending ? "Testando…" : "Testar conexão"}
    </button>
  );
}

// PaymentProviderBadge — distingue entre 4 estados visuais de um
// provider de pagamento na UI do admin:
//   - disabled (provedor ainda não suportado no backend)
//   - sem credencial salva → "Não configurado" (amarelo)
//   - credencial salva mas nunca testada → "Não testado" (cinza)
//   - test_status="ok" → "Conectado" (verde)
//   - test_status="failed" → "Falhou" (vermelho)
// Antes a UI mostrava apenas "Configurado/Não configurado" baseado em
// is_configured do backend, que apenas checava se tinha key no DB —
// chave inválida aparecia como "Configurado ✓" e o admin só descobria
// quando o checkout estourava 500.
function PaymentProviderBadge({
  configured, testStatus, disabled,
}: {
  configured: boolean;
  testStatus?: string;
  disabled?: boolean;
}) {
  if (disabled) return <StatusBadge ok={false} label="Em breve" />;
  if (!configured) return <StatusBadge ok={false} label="Não configurado" />;
  if (testStatus === "ok") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(0,212,106,0.12)", color: "#00d46a" }}>
        Conectado
      </span>
    );
  }
  if (testStatus === "failed") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>
        Falhou
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
      style={{ background: "var(--border-default)", color: "var(--text-3)" }}>
      Não testado
    </span>
  );
}

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { id: "payment",       label: "Pagamento",    icon: CreditCard,    desc: "Stripe, Asaas, AbacatePay" },
  { id: "communication", label: "Comunicação",  icon: Mail,          desc: "Email, templates, OTP" },
  // AI: configura provedores globais (OpenAI, Anthropic, etc.) usados
  // por todos os módulos da plataforma — Uniq AI chat, transcrição
  // Whisper de áudios do inbox, agente de instâncias.
  { id: "ai",            label: "Uniq AI",      icon: Sparkles,      desc: "Provedores LLM globais (OpenAI, Anthropic, etc.)" },
  // Voice: TTS gerenciado pela plataforma. Espelha Uniq AI — providers
  // globais (OpenAI TTS, ElevenLabs, etc.) que viram a "Uniq Voice"
  // pra workspaces com allow_voice no plano.
  { id: "voice",         label: "Uniq Voice",   icon: Mic2,          desc: "Provedores TTS globais (OpenAI TTS, ElevenLabs)" },
  // Pricing: margem dinâmica por categoria + custo bruto dos providers
  // + top-up packs publicados pra venda. Mudança aqui afeta todos os
  // events futuros em <5s (cache do recorder invalidado no PUT).
  { id: "pricing",       label: "Pricing",      icon: DollarSign,    desc: "Margem, custo bruto, top-up packs" },
  { id: "server",        label: "Servidor",     icon: Server,        desc: "Servidores e instâncias" },
  { id: "proxies",       label: "Proxies",      icon: Globe,         desc: "Gerenciamento de proxies" },
];

// ─── Payment Tab ──────────────────────────────────────────────────────────────
const PROVIDERS: { id: string; label: string; icon: string; color: string; disabled?: boolean }[] = [
  { id: "stripe",  label: "Stripe",  icon: "💳", color: "#635bff" },
  { id: "asaas",   label: "Asaas",   icon: "🇧🇷", color: "#22c55e" },
  { id: "abacatepay", label: "AbacatePay", icon: "🥑", color: "#0ea5e9" },
];

const PAYMENT_COUNTRIES = [
  { code: "BR", label: "Brasil", flag: "🇧🇷" },
  { code: "US", label: "Estados Unidos", flag: "🇺🇸" },
  { code: "CA", label: "Canadá", flag: "🇨🇦" },
  { code: "PT", label: "Portugal", flag: "🇵🇹" },
  { code: "GB", label: "Reino Unido", flag: "🇬🇧" },
  { code: "MX", label: "México", flag: "🇲🇽" },
  { code: "AR", label: "Argentina", flag: "🇦🇷" },
  { code: "CL", label: "Chile", flag: "🇨🇱" },
  { code: "CO", label: "Colômbia", flag: "🇨🇴" },
  { code: "ES", label: "Espanha", flag: "🇪🇸" },
];

type CountryProvider = "stripe" | "asaas" | "abacatepay";

function CountryRoutingCard({
  form,
  setForm,
}: {
  form: {
    stripe_country_codes: string[];
    asaas_country_codes: string[];
    abacatepay_country_codes: string[];
  };
  setForm: React.Dispatch<React.SetStateAction<any>>;
}) {
  const providerOf = (code: string): CountryProvider | "" => {
    if (form.stripe_country_codes.includes(code)) return "stripe";
    if (form.asaas_country_codes.includes(code)) return "asaas";
    if (form.abacatepay_country_codes.includes(code)) return "abacatepay";
    return "";
  };
  const assign = (code: string, provider: CountryProvider | "") => {
    setForm((f: any) => ({
      ...f,
      stripe_country_codes: provider === "stripe"
        ? Array.from(new Set([...f.stripe_country_codes, code]))
        : f.stripe_country_codes.filter((c: string) => c !== code),
      asaas_country_codes: provider === "asaas"
        ? Array.from(new Set([...f.asaas_country_codes, code]))
        : f.asaas_country_codes.filter((c: string) => c !== code),
      abacatepay_country_codes: provider === "abacatepay"
        ? Array.from(new Set([...f.abacatepay_country_codes, code]))
        : f.abacatepay_country_codes.filter((c: string) => c !== code),
    }));
  };
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Roteamento por país</h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            País sem regra usa o provider ativo acima. Ex: Stripe para EUA e AbacatePay para Brasil.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PAYMENT_COUNTRIES.map((country) => {
          const selected = providerOf(country.code);
          return (
            <div key={country.code} className="flex items-center gap-2 rounded-xl p-2"
              style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
              <span className="w-24 text-xs" style={{ color: "var(--text-2)" }}>
                {country.flag} {country.code}
              </span>
              <select
                value={selected}
                onChange={(e) => assign(country.code, e.target.value as CountryProvider | "")}
                className="flex-1 px-2.5 py-2 rounded-lg text-xs outline-none"
                style={{ background: "hsl(240 18% 5%)", border: "1px solid var(--border)", color: "var(--text-1)" }}
              >
                <option value="">Provider ativo</option>
                <option value="stripe">Stripe</option>
                <option value="asaas">Asaas</option>
                <option value="abacatepay">AbacatePay</option>
              </select>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PaymentTab() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery<PaymentSettings>({
    queryKey: ["admin-payment-settings"],
    queryFn: () => adminApi.getPaymentSettings().then((r) => r.data),
  });

  const [activeProvider, setActiveProvider] = useState("stripe");
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const displayProvider = pendingProvider ?? activeProvider;
  const [form, setForm] = useState({
    stripe_secret_key: "", stripe_webhook_secret: "", stripe_checkout_type: "redirect",
    asaas_api_key: "", asaas_webhook_secret: "", asaas_environment: "sandbox",
    abacatepay_api_key: "", abacatepay_webhook_secret: "", abacatepay_environment: "sandbox", abacatepay_checkout_type: "redirect",
    stripe_country_codes: [] as string[],
    asaas_country_codes: [] as string[],
    abacatepay_country_codes: [] as string[],
  });

  useEffect(() => {
    if (settings) {
      setActiveProvider(settings.active_provider || "stripe");
      setPendingProvider(null);
      setForm(f => ({
        ...f,
        stripe_checkout_type: settings.stripe_checkout_type || "redirect",
        stripe_country_codes: settings.stripe_country_codes || [],
        asaas_environment: settings.asaas_environment || "sandbox",
        asaas_country_codes: settings.asaas_country_codes || [],
        abacatepay_environment: settings.abacatepay_environment || "sandbox",
        abacatepay_checkout_type: settings.abacatepay_checkout_type || "redirect",
        abacatepay_country_codes: settings.abacatepay_country_codes || [],
      }));
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () => adminApi.updatePaymentSettings({ active_provider: displayProvider, ...form }),
    onSuccess: () => { toast.success("Configurações salvas!"); setActiveProvider(displayProvider); setPendingProvider(null); queryClient.invalidateQueries({ queryKey: ["admin-payment-settings"] }); },
    onError: () => toast.error("Erro ao salvar"),
  });

  const copyUrl = (url: string) => { navigator.clipboard.writeText(url); toast.success("URL copiada!"); };

  if (isLoading) return <div className="flex items-center gap-2 py-8"><Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" /><span className="text-sm" style={{ color: "var(--text-3)" }}>Carregando...</span></div>;

  // apiBase pra montar a URL de webhook que vai colar no Stripe/Asaas.
  // Estratégia: derivar SEMPRE do hostname público quando disponível —
  // antes confiávamos em NEXT_PUBLIC_API_URL, mas envs mal configurados
  // (ex: build do front com NEXT_PUBLIC_API_URL=https://app.uniq.chat)
  // mostravam a URL errada e o webhook caía em 404. Agora qualquer
  // hostname `app.*` / `admin.*` / `dashboard.*` é normalizado pra
  // `api.*` independente do env.
  const swapAppToApi = (raw: string): string => {
    try {
      const u = new URL(raw);
      const h = u.hostname;
      if (h.startsWith("app.") || h.startsWith("admin.") || h.startsWith("dashboard.")) {
        u.hostname = "api." + h.split(".").slice(1).join(".");
      }
      return `${u.protocol}//${u.hostname}`;
    } catch {
      return raw;
    }
  };

  const rawApi = process.env.NEXT_PUBLIC_API_URL?.replace(/\/v1\/?$/, "") || "";
  let apiBase: string;
  if (rawApi && !/localhost|127\.0\.0\.1/.test(rawApi)) {
    apiBase = swapAppToApi(rawApi);
  } else if (typeof window !== "undefined" && window.location.hostname && !/localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    apiBase = swapAppToApi(`${window.location.protocol}//${window.location.hostname}`);
    // Se o host raiz não tinha sub (ex: uniq.chat direto), prepende `api.`.
    if (!new URL(apiBase).hostname.startsWith("api.")) {
      const u = new URL(apiBase);
      u.hostname = "api." + u.hostname;
      apiBase = `${u.protocol}//${u.hostname}`;
    }
  } else {
    apiBase = rawApi || "https://api.uniq.chat";
  }
  // URLs versionadas (/v1/payments/webhook/:provider) — alinha com
  // o resto da API (/v1/...) e segue o padrão do
  // /v1/payments/finalize-registration agnóstico. Aliases não-versionados
  // continuam funcionando no backend pra compat com webhooks já
  // configurados no Stripe/Asaas.
  const stripeWebhookURL = `${apiBase}/v1/payments/webhook/stripe`;
  const asaasWebhookURL = `${apiBase}/v1/payments/webhook/asaas`;
  const abacatepayWebhookURL = `${apiBase}/abacatepay/webhook`;

  return (
    <div className="space-y-5">
      <SectionTitle>Pagamento</SectionTitle>

      {/* Provider cards */}
      <Card>
        <p className="text-xs font-medium mb-3" style={{ color: "var(--text-3)" }}>PROVEDOR ATIVO</p>
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const isActive = p.id === activeProvider;
            const isPending = p.id === pendingProvider && p.id !== activeProvider;
            const isSelected = displayProvider === p.id;
            const isConfigured = p.id === "stripe" ? settings?.stripe_configured
              : p.id === "asaas" ? settings?.asaas_configured
              : settings?.abacatepay_configured;
            const testStatus = p.id === "stripe" ? settings?.stripe_test_status
              : p.id === "asaas" ? settings?.asaas_test_status
              : settings?.abacatepay_test_status;
            return (
              <button key={p.id} onClick={() => { if (!p.disabled) setPendingProvider(p.id); }}
                disabled={p.disabled}
                className="p-3 rounded-xl border-2 text-center relative transition-all"
                style={{
                  borderColor: isSelected ? p.color : isActive ? "var(--green)" : "var(--border-default)",
                  background: isSelected ? `${p.color}12` : isActive ? "rgba(0,212,106,0.06)" : "transparent",
                  opacity: p.disabled ? 0.45 : 1,
                }}>
                {/* Badges no topo */}
                <div className="absolute top-2 left-2 right-2 flex justify-between">
                  <div>
                    {!isConfigured && !p.disabled && <Shield className="w-3 h-3" style={{ color: "#fbbf24" }} />}
                  </div>
                  <div>
                    {isActive && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider"
                        style={{ background: "rgba(0,212,106,0.18)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.35)" }}>
                        ATIVO
                      </span>
                    )}
                    {isPending && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: `${p.color}18`, color: p.color, border: `1px solid ${p.color}40` }}>
                        selecionado
                      </span>
                    )}
                    {testStatus === "ok" && !isActive && !isPending && <Check className="w-3 h-3 text-[#00d46a]" />}
                    {testStatus === "failed" && !isActive && !isPending && <X className="w-3 h-3" style={{ color: "#f87171" }} />}
                  </div>
                </div>
                <div className="text-2xl mb-1 mt-3">{p.icon}</div>
                <div className="text-sm font-medium" style={{ color: isSelected ? p.color : isActive ? "var(--green)" : "var(--text-1)" }}>{p.label}</div>
                <div className="mt-1"><PaymentProviderBadge configured={!!isConfigured} testStatus={testStatus} disabled={!!p.disabled} /></div>
              </button>
            );
          })}
        </div>
      </Card>

      <CountryRoutingCard form={form} setForm={setForm} />

      {/* Stripe config */}
      {displayProvider === "stripe" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Stripe</h3>
            <div className="flex items-center gap-2">
              <PaymentProviderBadge configured={!!settings?.stripe_configured} testStatus={settings?.stripe_test_status} />
              <TestConnectionButton provider="stripe" disabled={!settings?.stripe_configured} />
            </div>
          </div>
          {settings?.stripe_test_status === "failed" && settings?.stripe_test_error && (
            <div className="mb-4 p-3 rounded-lg text-xs"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", color: "#fca5a5" }}>
              <strong className="font-semibold">Último teste falhou:</strong> {settings.stripe_test_error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Secret Key</Label>
              <div className="relative">
                <Input type="password" value={form.stripe_secret_key}
                  onChange={e => setForm(f => ({ ...f, stripe_secret_key: e.target.value }))}
                  placeholder={settings?.stripe_secret_key_preview || "sk_live_..."} />
              </div>
              {settings?.stripe_secret_key_preview && (
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(240 18% 5%)", color: "var(--text-2)" }}>
                    {settings.stripe_secret_key_preview}
                  </code>
                  {settings.stripe_secret_key_env === "live" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                      style={{ background: "rgba(0,212,106,0.12)", color: "#00d46a" }}>
                      Live
                    </span>
                  )}
                  {settings.stripe_secret_key_env === "test" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                      style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                      Test
                    </span>
                  )}
                </div>
              )}
              <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>Deixe vazio para manter o atual</p>
            </div>
            <div>
              <Label>Webhook Secret</Label>
              <Input type="password" value={form.stripe_webhook_secret}
                onChange={e => setForm(f => ({ ...f, stripe_webhook_secret: e.target.value }))}
                placeholder={settings?.stripe_webhook_secret_preview || "whsec_..."} />
              {settings?.stripe_webhook_secret_preview && (
                <code className="inline-block mt-1.5 text-[11px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "hsl(240 18% 5%)", color: "var(--text-2)" }}>
                  {settings.stripe_webhook_secret_preview}
                </code>
              )}
            </div>
          </div>
          <div className="mt-4">
            <Label>Tipo de Checkout</Label>
            <div className="flex gap-4">
              {["redirect", "transparent"].map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="stripe_checkout" checked={form.stripe_checkout_type === t}
                    onChange={() => setForm(f => ({ ...f, stripe_checkout_type: t }))}
                    className="accent-[#635bff]" />
                  <span className="text-xs capitalize" style={{ color: "hsl(240 15% 80%)" }}>{t === "redirect" ? "Redirect" : "Transparente"}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-default)" }}>
            <Label>URL do Webhook</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 18% 5%)", color: "var(--text-3)" }}>
                {stripeWebhookURL}
              </code>
              <button onClick={() => copyUrl(stripeWebhookURL)} className="p-2 rounded hover:bg-white/5" title="Copiar URL">
                <Key className="w-4 h-4" style={{ color: "var(--text-3)" }} />
              </button>
            </div>

            {/* Instruções passo-a-passo — cobre as dúvidas comuns:
                qual URL colar, quais eventos selecionar, onde achar
                o signing secret. Reduz tickets de suporte. */}
            <div className="mt-3 rounded-lg p-3 space-y-2.5"
              style={{ background: "rgba(99,91,255,0.06)", border: "1px solid rgba(99,91,255,0.18)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#a5a0ff" }}>
                Como configurar na Stripe
              </p>
              <ol className="text-[11px] space-y-1.5 list-decimal pl-4" style={{ color: "hsl(240 8% 70%)" }}>
                <li>
                  No <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#a5a0ff" }}>Dashboard → Developers → Webhooks</a>, clique em <span className="font-semibold">Add endpoint</span>.
                </li>
                <li>
                  Cole a URL acima no campo <span className="font-mono">Endpoint URL</span>.
                </li>
                <li>
                  Em <span className="font-semibold">Events to listen to</span>, selecione:
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[
                      "checkout.session.completed",
                      "customer.subscription.created",
                      "customer.subscription.updated",
                      "customer.subscription.deleted",
                      "invoice.payment_succeeded",
                      "invoice.payment_failed",
                      "payment_intent.succeeded",
                      "payment_intent.payment_failed",
                    ].map((ev) => (
                      <code key={ev} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: "rgba(99,91,255,0.10)", color: "#c0bdff", border: "1px solid rgba(99,91,255,0.20)" }}>
                        {ev}
                      </code>
                    ))}
                  </div>
                </li>
                <li>
                  Após criar, copie o <span className="font-semibold">Signing secret</span> (<span className="font-mono">whsec_...</span>) e cole no campo <span className="font-semibold">Webhook Secret</span> abaixo.
                </li>
              </ol>
              <div className="text-[10px] pt-1.5" style={{ color: "var(--text-3)", borderTop: "1px solid rgba(99,91,255,0.12)" }}>
                <p className="mt-1.5">
                  Aliases aceitos pelo backend (escolha qualquer um — todos vão pro mesmo handler):
                </p>
                <ul className="mt-0.5 space-y-0.5 font-mono">
                  <li>· {apiBase}/v1/payments/webhook/stripe</li>
                  <li>· {apiBase}/v1/stripe/webhook</li>
                  <li>· {apiBase}/stripe/webhook <span className="opacity-60">(legacy)</span></li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Asaas config */}
      {displayProvider === "asaas" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Asaas</h3>
            <div className="flex items-center gap-2">
              <PaymentProviderBadge configured={!!settings?.asaas_configured} testStatus={settings?.asaas_test_status} />
              <TestConnectionButton provider="asaas" disabled={!settings?.asaas_configured} />
            </div>
          </div>
          {settings?.asaas_test_status === "failed" && settings?.asaas_test_error && (
            <div className="mb-4 p-3 rounded-lg text-xs"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", color: "#fca5a5" }}>
              <strong className="font-semibold">Último teste falhou:</strong> {settings.asaas_test_error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>API Key</Label>
              <Input type="password" value={form.asaas_api_key}
                onChange={e => setForm(f => ({ ...f, asaas_api_key: e.target.value }))}
                placeholder={settings?.asaas_api_key_preview || "$aas_..."} />
              {settings?.asaas_api_key_preview && (
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(240 18% 5%)", color: "var(--text-2)" }}>
                    {settings.asaas_api_key_preview}
                  </code>
                  {settings?.asaas_environment === "production" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                      style={{ background: "rgba(0,212,106,0.12)", color: "#00d46a" }}>
                      Produção
                    </span>
                  )}
                  {settings?.asaas_environment === "sandbox" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                      style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                      Sandbox
                    </span>
                  )}
                </div>
              )}
              <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>Deixe vazio para manter o atual</p>
            </div>
            <div>
              <Label>Ambiente</Label>
              <Select value={form.asaas_environment} onChange={e => setForm(f => ({ ...f, asaas_environment: e.target.value }))}>
                <option value="sandbox">Sandbox (Homologação)</option>
                <option value="production">Produção</option>
              </Select>
            </div>
            <div>
              <Label>Webhook Secret</Label>
              <Input type="password" value={form.asaas_webhook_secret}
                onChange={e => setForm(f => ({ ...f, asaas_webhook_secret: e.target.value }))}
                placeholder={settings?.asaas_webhook_secret_preview || "whsec_..."} />
              {settings?.asaas_webhook_secret_preview && (
                <code className="inline-block mt-1.5 text-[11px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "hsl(240 18% 5%)", color: "var(--text-2)" }}>
                  {settings.asaas_webhook_secret_preview}
                </code>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-default)" }}>
            <Label>URL do Webhook</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 18% 5%)", color: "var(--text-3)" }}>
                {asaasWebhookURL}
              </code>
              <button onClick={() => copyUrl(asaasWebhookURL)} className="p-2 rounded hover:bg-white/5" title="Copiar URL">
                <Key className="w-4 h-4" style={{ color: "var(--text-3)" }} />
              </button>
            </div>
            <div className="mt-3 rounded-lg p-3 space-y-2.5"
              style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#86efac" }}>
                Como configurar no Asaas
              </p>
              <ol className="text-[11px] space-y-1.5 list-decimal pl-4" style={{ color: "hsl(240 8% 70%)" }}>
                <li>
                  No <a href="https://www.asaas.com/integracoes/webhooks" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#86efac" }}>Painel Asaas → Integrações → Webhooks</a>, clique em <span className="font-semibold">Adicionar webhook</span>.
                </li>
                <li>
                  Cole a URL acima em <span className="font-mono">URL de notificação</span>.
                </li>
                <li>
                  Defina um <span className="font-semibold">Token de autenticação</span> qualquer (ex: <span className="font-mono">uniq-secret-xyz</span>) e cole o mesmo valor no campo <span className="font-semibold">Webhook Secret</span> abaixo.
                </li>
                <li>
                  Eventos recomendados: <span className="font-mono">PAYMENT_CONFIRMED</span>, <span className="font-mono">PAYMENT_RECEIVED</span>, <span className="font-mono">PAYMENT_OVERDUE</span>, <span className="font-mono">PAYMENT_REFUNDED</span>, <span className="font-mono">SUBSCRIPTION_CREATED</span>, <span className="font-mono">SUBSCRIPTION_DELETED</span>.
                </li>
              </ol>
            </div>
          </div>
        </Card>
      )}

      {/* AbacatePay config */}
      {displayProvider === "abacatepay" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>AbacatePay</h3>
            <div className="flex items-center gap-2">
              <PaymentProviderBadge configured={!!settings?.abacatepay_configured} testStatus={settings?.abacatepay_test_status} />
              <TestConnectionButton provider="abacatepay" disabled={!settings?.abacatepay_configured} />
            </div>
          </div>
          {settings?.abacatepay_test_status === "failed" && settings?.abacatepay_test_error && (
            <div className="mb-4 p-3 rounded-lg text-xs"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", color: "#fca5a5" }}>
              <strong className="font-semibold">Último teste falhou:</strong> {settings.abacatepay_test_error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>API Key</Label>
              <Input type="password" value={form.abacatepay_api_key}
                onChange={e => setForm(f => ({ ...f, abacatepay_api_key: e.target.value }))}
                placeholder={settings?.abacatepay_api_key_preview || "abac_..."} />
              {settings?.abacatepay_api_key_preview && (
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(240 18% 5%)", color: "var(--text-2)" }}>
                    {settings.abacatepay_api_key_preview}
                  </code>
                  {settings?.abacatepay_environment === "production" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                      style={{ background: "rgba(0,212,106,0.12)", color: "#00d46a" }}>
                      Produção
                    </span>
                  )}
                  {settings?.abacatepay_environment === "sandbox" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                      style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                      Sandbox
                    </span>
                  )}
                </div>
              )}
              <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>Deixe vazio para manter o atual</p>
            </div>
            <div>
              <Label>Ambiente</Label>
              <Select value={form.abacatepay_environment} onChange={e => setForm(f => ({ ...f, abacatepay_environment: e.target.value }))}>
                <option value="sandbox">Sandbox (Homologação)</option>
                <option value="production">Produção</option>
              </Select>
            </div>
            <div>
              <Label>Webhook Secret</Label>
              <div className="flex items-center gap-2">
                <Input type="password" value={form.abacatepay_webhook_secret}
                  onChange={e => setForm(f => ({ ...f, abacatepay_webhook_secret: e.target.value }))}
                  placeholder={settings?.abacatepay_webhook_secret_preview || "whsec_..."} />
                <button
                  type="button"
                  onClick={() => {
                    const chars = "0123456789abcdef";
                    let secret = "whsec_";
                    for (let i = 0; i < 32; i++) secret += chars[Math.floor(Math.random() * 16)];
                    setForm(f => ({ ...f, abacatepay_webhook_secret: secret }));
                    toast.success("Secret gerado! Use o mesmo valor no AbacatePay.");
                  }}
                  className="text-[10px] px-3 py-2 rounded-lg font-medium shrink-0 hover:opacity-80 transition-opacity"
                  style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", color: "#7dd3fc" }}
                >
                  Gerar Secret
                </button>
              </div>
              {settings?.abacatepay_webhook_secret_preview && (
                <code className="inline-block mt-1.5 text-[11px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "hsl(240 18% 5%)", color: "var(--text-2)" }}>
                  {settings.abacatepay_webhook_secret_preview}
                </code>
              )}
            </div>
          </div>
          <div className="mt-4">
            <Label>Tipo de Checkout</Label>
            <div className="flex gap-4">
              {["transparent", "redirect"].map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="abacatepay_checkout" checked={form.abacatepay_checkout_type === t}
                    onChange={() => setForm(f => ({ ...f, abacatepay_checkout_type: t }))}
                    className="accent-[#0ea5e9]" />
                  <span className="text-xs capitalize" style={{ color: "hsl(240 15% 80%)" }}>{t === "transparent" ? "Transparente (PIX Uniq)" : "Redirect"}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-default)" }}>
            <Label>URL do Webhook</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 18% 5%)", color: "var(--text-3)" }}>
                {(() => {
                  const secret = form.abacatepay_webhook_secret || settings?.abacatepay_webhook_secret_preview;
                  return secret ? `${abacatepayWebhookURL}?webhookSecret=${secret}` : abacatepayWebhookURL;
                })()}
              </code>
              <button onClick={() => {
                const secret = form.abacatepay_webhook_secret || settings?.abacatepay_webhook_secret_preview;
                const url = secret ? `${abacatepayWebhookURL}?webhookSecret=${secret}` : abacatepayWebhookURL;
                copyUrl(url);
              }} className="p-2 rounded hover:bg-white/5" title="Copiar URL">
                <Key className="w-4 h-4" style={{ color: "var(--text-3)" }} />
              </button>
            </div>
            <div className="mt-3 rounded-lg p-3 space-y-2.5"
              style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.18)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#7dd3fc" }}>
                Como configurar no AbacatePay
              </p>
              <ol className="text-[11px] space-y-1.5 list-decimal pl-4" style={{ color: "hsl(240 8% 70%)" }}>
                <li>
                  Acesse o <a href="https://abacatepay.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#7dd3fc" }}>Painel AbacatePay → Webhooks</a> e clique em <span className="font-semibold">Criar webhook</span>.
                </li>
                <li>
                  Cole a <span className="font-semibold">URL completa</span> acima (já inclui o <span className="font-mono">?webhookSecret=</span>) no campo <span className="font-semibold">URL</span> do AbacatePay.
                </li>
                <li>
                  Copie o <span className="font-semibold">mesmo Secret</span> gerado acima e cole no campo <span className="font-semibold">Secret</span> do AbacatePay.
                </li>
                <li>
                  Selecione os eventos:
                  <div className="mt-1 flex flex-wrap gap-1">
                    {["checkout.completed", "transparent.completed", "subscription.completed", "subscription.cancelled", "subscription.renewed"].map((ev) => (
                      <code key={ev} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: "rgba(14,165,233,0.10)", color: "#7dd3fc", border: "1px solid rgba(14,165,233,0.20)" }}>
                        {ev}
                      </code>
                    ))}
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <SaveBtn loading={saveMut.isPending} onClick={() => saveMut.mutate()} />
      </div>
    </div>
  );
}

// ─── Email Settings ────────────────────────────────────────────────────────────
function EmailSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<EmailSettings>({
    queryKey: ["admin-email-settings"],
    queryFn: () => adminApi.getEmailSettings().then((r) => r.data),
  });

  const [form, setForm] = useState<EmailSettings>({});
  const [testEmail, setTestEmail] = useState("");

  useEffect(() => { if (data) setForm(data); }, [data]);

  const saveMut = useMutation({
    mutationFn: () => adminApi.updateEmailSettings(form),
    onSuccess: () => { toast.success("Configurações de email salvas!"); queryClient.invalidateQueries({ queryKey: ["admin-email-settings"] }); },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      toast.error(r?.message || r?.error || "Erro ao salvar configurações de email");
    },
  });

  const testMut = useMutation({
    mutationFn: () => adminApi.testEmail(testEmail),
    onSuccess: () => toast.success("Email de teste enviado!"),
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      toast.error(r?.message || r?.error || "Erro ao enviar email de teste");
    },
  });

  if (isLoading) return <div className="py-4"><Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" /></div>;

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-1)" }}>Email (Maileroo)</h3>
      <div className="space-y-3">
        <div>
          <Label>API Key</Label>
          <Input type="password" value={form.api_key || ""} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder="Maileroo API Key" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Email do Remetente</Label>
            <Input type="email" value={form.sender_email || ""} onChange={e => setForm(f => ({ ...f, sender_email: e.target.value }))} placeholder="noreply@seudominio.com" />
          </div>
          <div>
            <Label>Nome do Remetente</Label>
            <Input value={form.sender_name || ""} onChange={e => setForm(f => ({ ...f, sender_name: e.target.value }))} placeholder="Uniq Chat" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_enabled ?? false} onChange={e => setForm(f => ({ ...f, is_enabled: e.target.checked }))} className="accent-[#00d46a]" />
            <span className="text-sm" style={{ color: "hsl(240 15% 80%)" }}>Habilitado</span>
          </label>
        </div>
      </div>
      <div className="mt-4 pt-4 flex items-end gap-3" style={{ borderTop: "1px solid var(--border-default)" }}>
        <div className="flex-1">
          <Label>Testar Email</Label>
          <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="email@teste.com" />
        </div>
        <button onClick={() => testMut.mutate()} disabled={!testEmail || testMut.isPending}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--border-subtle)", border: "1px solid rgba(255,255,255,0.1)", color: "hsl(240 15% 80%)" }}>
          {testMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
          Testar
        </button>
      </div>
      <div className="flex justify-end mt-4">
        <SaveBtn loading={saveMut.isPending} onClick={() => saveMut.mutate()} />
      </div>
    </Card>
  );
}

// ─── Template Editor Modal ────────────────────────────────────────────────────
function TemplateModal({ template, onClose }: { template: EmailTemplate; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [html, setHtml] = useState(template.html_content);

  const saveMut = useMutation({
    mutationFn: () => adminApi.updateEmailTemplate(template.slug, { subject, html_content: html }),
    onSuccess: () => { toast.success("Template salvo!"); queryClient.invalidateQueries({ queryKey: ["admin-email-templates"] }); onClose(); },
    onError: () => toast.error("Erro ao salvar template"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl p-6 space-y-4"
        style={{ background: "hsl(240 18% 8%)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold" style={{ color: "var(--text-1)" }}>{template.name}</h3>
          <button onClick={onClose} className="hover:opacity-70"><X className="w-4 h-4" style={{ color: "var(--text-3)" }} /></button>
        </div>
        <div>
          <Label>Assunto</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>HTML</Label>
          <textarea value={html} onChange={e => setHtml(e.target.value)} rows={12}
            className="w-full px-3.5 py-2.5 rounded-xl text-xs outline-none focus:border-[#00d46a] font-mono resize-y"
            style={{ background: "hsl(240 18% 5%)", border: "1px solid var(--border)", color: "hsl(240 15% 80%)" }} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ background: "var(--input)", color: "var(--text-3)" }}>Cancelar</button>
          <SaveBtn loading={saveMut.isPending} onClick={() => saveMut.mutate()} />
        </div>
      </div>
    </div>
  );
}

// ─── Templates Section ────────────────────────────────────────────────────────
function TemplatesSection() {
  const { data: templates = [], isLoading } = useQuery<EmailTemplate[]>({
    queryKey: ["admin-email-templates"],
    queryFn: () => adminApi.listEmailTemplates().then((r) => r.data),
  });
  const [editing, setEditing] = useState<EmailTemplate | null>(null);

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-1)" }}>Templates de Email</h3>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" />
      ) : templates.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum template encontrado.</p>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "var(--input)", border: "1px solid var(--border-subtle)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{t.name}</p>
                <p className="text-xs font-mono" style={{ color: "var(--text-3)" }}>{t.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge ok={t.is_active} label={t.is_active ? "Ativo" : "Inativo"} />
                <button onClick={() => setEditing(t)} className="p-1.5 rounded-lg hover:bg-white/5">
                  <Edit2 className="w-3.5 h-3.5" style={{ color: "#00d46a" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <TemplateModal template={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// ─── OTP Section ──────────────────────────────────────────────────────────────
function OtpSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: ["admin-comm-settings"],
    queryFn: () => adminApi.getCommunicationSettings().then((r) => r.data),
  });
  const { data: instances = [] } = useQuery<InstanceRow[]>({
    queryKey: ["admin-all-instances"],
    queryFn: () => adminApi.listAllInstances().then((r) => r.data),
  });

  const [form, setForm] = useState({ otp_provider: "email", otp_instance_id: "", auto_msg_provider: "email", auto_msg_instance_id: "" });

  useEffect(() => {
    if (settings) {
      setForm({
        otp_provider: (settings.otp_provider as string) || "email",
        otp_instance_id: (settings.otp_instance_id as string) || "",
        auto_msg_provider: (settings.auto_msg_provider as string) || "email",
        auto_msg_instance_id: (settings.auto_msg_instance_id as string) || "",
      });
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () => adminApi.updateCommunicationSettings(form),
    onSuccess: () => { toast.success("Configurações salvas!"); queryClient.invalidateQueries({ queryKey: ["admin-comm-settings"] }); },
    onError: () => toast.error("Erro ao salvar"),
  });

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" />;

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-1)" }}>OTP & Mensagens</h3>
      <div className="space-y-5">
        {/* OTP Provider */}
        <div>
          <Label>Provedor de OTP</Label>
          <div className="flex gap-4">
            {["email", "whatsapp", "sms"].map(p => (
              <label key={p} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="otp_provider" checked={form.otp_provider === p}
                  onChange={() => setForm(f => ({ ...f, otp_provider: p }))} className="accent-[#00d46a]" />
                <span className="text-sm capitalize" style={{ color: "hsl(240 15% 80%)" }}>
                  {p === "whatsapp" ? "WhatsApp" : p === "sms" ? "SMS" : "Email"}
                </span>
              </label>
            ))}
          </div>
          {form.otp_provider === "whatsapp" && (
            <div className="mt-3">
              <Label>Instância WhatsApp (OTP)</Label>
              <Select value={form.otp_instance_id} onChange={e => setForm(f => ({ ...f, otp_instance_id: e.target.value }))}>
                <option value="">Selecione uma instância</option>
                {instances.map((inst, i) => (
                  <option key={i} value={(inst as unknown as Record<string, string>).id || inst.name}>{inst.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {/* Auto Message Provider */}
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 16 }}>
          <Label>Provedor de Mensagens Automáticas</Label>
          <div className="flex gap-4">
            {["email", "whatsapp"].map(p => (
              <label key={p} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="auto_msg_provider" checked={form.auto_msg_provider === p}
                  onChange={() => setForm(f => ({ ...f, auto_msg_provider: p }))} className="accent-[#00d46a]" />
                <span className="text-sm capitalize" style={{ color: "hsl(240 15% 80%)" }}>
                  {p === "whatsapp" ? "WhatsApp" : "Email"}
                </span>
              </label>
            ))}
          </div>
          {form.auto_msg_provider === "whatsapp" && (
            <div className="mt-3">
              <Label>Instância WhatsApp (Mensagens)</Label>
              <Select value={form.auto_msg_instance_id} onChange={e => setForm(f => ({ ...f, auto_msg_instance_id: e.target.value }))}>
                <option value="">Selecione uma instância</option>
                {instances.map((inst, i) => (
                  <option key={i} value={(inst as unknown as Record<string, string>).id || inst.name}>{inst.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <SaveBtn loading={saveMut.isPending} onClick={() => saveMut.mutate()} />
      </div>
    </Card>
  );
}

// ─── Communication Tab ────────────────────────────────────────────────────────
function CommunicationTab() {
  const [sub, setSub] = useState<CommSection>("email");
  const SUB_TABS: { id: CommSection; label: string; icon: React.ElementType }[] = [
    { id: "email",     label: "Email",        icon: Mail },
    { id: "templates", label: "Templates",    icon: Settings2 },
    { id: "otp",       label: "OTP & Msgs",   icon: Smartphone },
  ];
  return (
    <div className="space-y-5">
      <SectionTitle>Comunicação</SectionTitle>
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--input)", border: "1px solid var(--border-default)" }}>
        {SUB_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSub(id)}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all"
            style={{ background: sub === id ? "rgba(0,212,106,0.15)" : "transparent", color: sub === id ? "#00d46a" : "var(--text-3)" }}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>
      <AnimatedTabContent tabKey={sub}>
        {sub === "email"     && <EmailSection />}
        {sub === "templates" && <TemplatesSection />}
        {sub === "otp"       && <OtpSection />}
      </AnimatedTabContent>
    </div>
  );
}

// ─── Server Tab ───────────────────────────────────────────────────────────────
function ServerTab() {
  const [view, setView] = useState<"servers" | "instances">("servers");
  const { data: servers = [], isLoading: serversLoading } = useQuery<ServerRow[]>({
    queryKey: ["admin-all-servers"],
    queryFn: () => adminApi.listAllServers().then((r) => r.data),
    enabled: view === "servers",
  });
  const { data: instances = [], isLoading: instancesLoading } = useQuery<InstanceRow[]>({
    queryKey: ["admin-all-instances"],
    queryFn: () => adminApi.listAllInstances().then((r) => r.data),
    enabled: view === "instances",
  });

  const loading = view === "servers" ? serversLoading : instancesLoading;

  return (
    <div className="space-y-5">
      <SectionTitle>Servidor</SectionTitle>
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--input)", border: "1px solid var(--border-default)" }}>
        {(["servers", "instances"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all"
            style={{ background: view === v ? "rgba(0,212,106,0.15)" : "transparent", color: view === v ? "#00d46a" : "var(--text-3)" }}>
            {v === "servers" ? "Servidores" : "Instâncias"}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 py-4"><Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" /></div>
        ) : view === "servers" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--text-3)" }}>
                  {["Nome", "Endereço", "Porta", "Status", "Owner"].map(h => (
                    <th key={h} className="text-left pb-3 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {servers.length === 0 ? (
                  <tr><td colSpan={5} className="py-4" style={{ color: "var(--text-3)" }}>Nenhum servidor encontrado.</td></tr>
                ) : servers.map((s, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 font-medium" style={{ color: "var(--text-1)" }}>{s.name}</td>
                    <td className="py-3 pr-4 font-mono" style={{ color: "var(--text-2)" }}>{s.address}</td>
                    <td className="py-3 pr-4 font-mono" style={{ color: "var(--text-2)" }}>{s.port}</td>
                    <td className="py-3 pr-4"><StatusBadge ok={s.status === "active" || s.status === "connected"} label={s.status} /></td>
                    <td className="py-3" style={{ color: "var(--text-3)" }}>{s.owner_email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--text-3)" }}>
                  {["Nome", "Canal", "Status", "Owner", "Servidor"].map(h => (
                    <th key={h} className="text-left pb-3 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {instances.length === 0 ? (
                  <tr><td colSpan={5} className="py-4" style={{ color: "var(--text-3)" }}>Nenhuma instância encontrada.</td></tr>
                ) : instances.map((inst, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 font-medium" style={{ color: "var(--text-1)" }}>{inst.name}</td>
                    <td className="py-3 pr-4 capitalize" style={{ color: "var(--text-2)" }}>{inst.type || inst.channel || "—"}</td>
                    <td className="py-3 pr-4"><StatusBadge ok={inst.status === "active" || inst.status === "connected"} label={inst.status} /></td>
                    <td className="py-3 pr-4" style={{ color: "var(--text-3)" }}>{inst.owner_email || "—"}</td>
                    <td className="py-3" style={{ color: "var(--text-3)" }}>{inst.server || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Proxies Tab ──────────────────────────────────────────────────────────────
function ProxiesTab() {
  const { data, isLoading } = useQuery<{ proxies?: unknown[] }>({
    queryKey: ["admin-proxy-config"],
    queryFn: () => adminApi.getProxyConfig().then((r) => r.data),
  });
  const count = Array.isArray(data?.proxies) ? data.proxies.length : Array.isArray(data) ? (data as unknown[]).length : 0;

  return (
    <div className="space-y-5">
      <SectionTitle>Proxies</SectionTitle>
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>Gerenciamento completo de proxies</h3>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>
              Configure, teste e gerencie proxies para suas instâncias. Acesse o painel completo para adicionar ou remover entradas.
            </p>
            {!isLoading && (
              <p className="text-xs mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.2)" }}>
                <Globe className="w-3 h-3" />
                {count} {count === 1 ? "proxy configurado" : "proxies configurados"}
              </p>
            )}
          </div>
          <a href="/admin/proxy"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium shrink-0 transition-all"
            style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.25)", color: "#00d46a" }}>
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir painel
          </a>
        </div>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function ProvidersPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  // Aba inicial vem do query (?tab=ai por exemplo) — usado pelo
  // redirect de /admin/platform-ai e bookmarks que linkam direto.
  const initialTab = (searchParams.get("tab") as Tab) || "payment";
  const validTabs: Tab[] = ["payment", "communication", "ai", "voice", "pricing", "server", "proxies"];
  const router = useRouter();
  const [active, setActive] = useState<Tab>(validTabs.includes(initialTab) ? initialTab : "payment");
  const isSuperAdmin = (session?.user as { role?: string })?.role === "super_admin";

  // "proxies" não tem painel embutido — só placeholder com link.
  // Em vez de exibir o placeholder, mandamos direto pra página
  // dedicada /admin/proxy. Outras abas seguem inline normalmente.
  const handleTabClick = (id: Tab) => {
    if (id === "proxies") { router.push("/admin/proxy"); return; }
    setActive(id);
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="w-10 h-10" style={{ color: "hsl(240 8% 35%)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--text-3)" }}>Acesso restrito a super administradores.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>Providers</h1>
        <p className="text-sm mt-1 hidden sm:block" style={{ color: "var(--text-3)" }}>
          Configure provedores de pagamento, comunicação, servidores e proxies.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
        {/* Sidebar */}
        <aside className="hidden sm:flex w-44 lg:w-52 flex-shrink-0 sticky top-0">
          <nav className="rounded-2xl overflow-hidden w-full"
            style={{ background: "var(--input)", border: "1px solid var(--border-default)" }}>
            {TABS.map((tab, i) => {
              const Icon = tab.icon;
              const isActive = active === tab.id;
              return (
                <button key={tab.id} onClick={() => handleTabClick(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 lg:px-4 py-3 lg:py-3.5 text-left relative${i < TABS.length - 1 ? " border-b" : ""}`}
                  style={{ borderColor: "var(--border-subtle)", background: isActive ? "rgba(0,212,106,0.10)" : "transparent", transition: "background 0.2s" }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--input)"; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r" style={{ background: "#00d46a" }} />}
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: isActive ? "rgba(0,212,106,0.15)" : "var(--input)", border: `1px solid ${isActive ? "rgba(0,212,106,0.25)" : "var(--border-default)"}` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: isActive ? "#00d46a" : "var(--text-3)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: isActive ? "#00d46a" : "var(--text-1)" }}>{tab.label}</p>
                    <p className="text-[10px] truncate mt-0.5 hidden lg:block" style={{ color: "var(--text-3)" }}>{tab.desc}</p>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile tabs */}
        <div className="sm:hidden flex gap-1 p-1 rounded-xl w-full" style={{ background: "var(--input)", border: "1px solid var(--border-default)" }}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => handleTabClick(id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium"
              style={{ background: active === id ? "rgba(0,212,106,0.15)" : "transparent", color: active === id ? "#00d46a" : "var(--text-3)" }}>
              <Icon className="w-3.5 h-3.5" />
              <span className="truncate">{label.split(" ")[0]}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <AnimatedTabContent tabKey={active}>
            {active === "payment"       && <PaymentTab />}
            {active === "communication" && <CommunicationTab />}
            {active === "ai"            && <PlatformAIPanel />}
            {active === "voice"         && <PlatformVoicePanel />}
            {active === "pricing"       && <PricingConfigPanel />}
            {active === "server"        && <ServerTab />}
            {active === "proxies"       && <ProxiesTab />}
          </AnimatedTabContent>
        </div>
      </div>
    </div>
  );
}

export default function ProvidersPage() {
  return (
    <Suspense fallback={null}>
      <ProvidersPageInner />
    </Suspense>
  );
}
