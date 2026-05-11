"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { CreditCard, Shield, Check, X, Loader2, Save, Key, Globe, ExternalLink, Lock, Copy } from "lucide-react";
import { toast } from "sonner";

interface PaymentSettings {
  id: string;
  active_provider: string;
  stripe_secret_key?: string;
  stripe_webhook_secret?: string;
  stripe_checkout_type?: string;
  asaas_api_key?: string;
  asaas_webhook_secret?: string;
  asaas_environment?: string;
  asaas_checkout_type?: string;
  abacatepay_api_key?: string;
  abacatepay_webhook_secret?: string;
  abacatepay_environment?: string;
  abacatepay_checkout_type?: string;
  abacatepay_test_status?: string;
  abacatepay_tested_at?: string | null;
  abacatepay_test_error?: string;
  // Configuration status
  stripe_configured?: boolean;
  asaas_configured?: boolean;
  abacatepay_configured?: boolean;
  // Webhook URLs
  stripe_webhook_url?: string;
  asaas_webhook_url?: string;
  abacatepay_webhook_url?: string;
}

const PROVIDERS = [
  {
    id: "stripe",
    label: "Stripe",
    icon: "💳",
    color: "#635bff",
    desc: "Cartão Internacional",
    descConfigured: "Cartão Internacional (Configurado)"
  },
  {
    id: "asaas",
    label: "Asaas",
    icon: "🇧🇷",
    color: "#22c55e",
    desc: "Pix, Boleto, Cartão (BR) - Configure no painel",
    descConfigured: "Pix, Boleto, Cartão (BR) (Configurado)"
  },
  {
    id: "abacatepay",
    label: "AbacatePay",
    icon: "🥑",
    color: "#0ea5e9",
    desc: "PIX Transparente — checkout otimizado",
    descConfigured: "PIX Transparente (Configurado)"
  },
];

const ASAAS_ENVIRONMENTS = [
  { id: "sandbox", label: "Sandbox (Homologação)" },
  { id: "production", label: "Produção" },
];

interface PaymentConfig {
  stripe_secret_key: string;
  stripe_webhook_secret: string;
  stripe_checkout_type: "redirect" | "transparent";
  asaas_api_key: string;
  asaas_webhook_secret: string;
  asaas_environment: string;
  asaas_checkout_type: "redirect" | "transparent";
  abacatepay_api_key: string;
  abacatepay_webhook_secret: string;
  abacatepay_environment: string;
  abacatepay_checkout_type: "redirect" | "transparent";
}

export default function PaymentSettingsPage() {
  const queryClient = useQueryClient();
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const { data: settings, isLoading } = useQuery<PaymentSettings>({
    queryKey: ["payment-settings"],
    queryFn: () => adminApi.getPaymentSettings().then((r) => r.data),
  });

  const [form, setForm] = useState<PaymentConfig>({
    stripe_secret_key: "",
    stripe_webhook_secret: "",
    stripe_checkout_type: "redirect",
    asaas_api_key: "",
    asaas_webhook_secret: "",
    asaas_environment: "sandbox",
    asaas_checkout_type: "transparent",
    abacatepay_api_key: "",
    abacatepay_webhook_secret: "",
    abacatepay_environment: "sandbox",
    abacatepay_checkout_type: "redirect",
  });

  const [activeProvider, setActiveProvider] = useState("stripe");
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const displayProvider = pendingProvider ?? activeProvider;

  // Check if form has changes from saved settings
  const checkChanges = (newForm: PaymentConfig, newProvider: string) => {
    if (!settings) return false;
    const currentProvider = newProvider;
    return (
      currentProvider !== settings.active_provider ||
      newForm.stripe_secret_key !== "" ||
      newForm.stripe_webhook_secret !== (settings.stripe_webhook_secret || "") ||
      newForm.stripe_checkout_type !== (settings.stripe_checkout_type || "redirect") ||
      newForm.asaas_api_key !== "" ||
      newForm.asaas_webhook_secret !== (settings.asaas_webhook_secret || "") ||
      newForm.asaas_environment !== (settings.asaas_environment || "sandbox") ||
      newForm.asaas_checkout_type !== (settings.asaas_checkout_type || "transparent") ||
      newForm.abacatepay_api_key !== "" ||
      newForm.abacatepay_webhook_secret !== (settings.abacatepay_webhook_secret || "") ||
      newForm.abacatepay_environment !== (settings.abacatepay_environment || "sandbox") ||
      newForm.abacatepay_checkout_type !== (settings.abacatepay_checkout_type || "redirect")
    );
  };

  useEffect(() => {
    if (settings) {
      setActiveProvider(settings.active_provider || "stripe");
      setPendingProvider(null);
      setForm((prev) => ({
        ...prev,
        stripe_webhook_secret: settings.stripe_webhook_secret || "",
        stripe_checkout_type: settings.stripe_checkout_type as "redirect" | "transparent" || "redirect",
        asaas_api_key: settings.asaas_api_key || "",
        asaas_webhook_secret: settings.asaas_webhook_secret || "",
        asaas_environment: settings.asaas_environment || "sandbox",
        asaas_checkout_type: settings.asaas_checkout_type as "redirect" | "transparent" || "transparent",
        abacatepay_api_key: settings.abacatepay_api_key || "",
        abacatepay_webhook_secret: settings.abacatepay_webhook_secret || "",
        abacatepay_environment: settings.abacatepay_environment || "sandbox",
        abacatepay_checkout_type: settings.abacatepay_checkout_type as "redirect" | "transparent" || "redirect",
      }));
      setHasChanges(false);
    }
  }, [settings]);

  // Track changes
  useEffect(() => {
    if (settings) {
      setHasChanges(checkChanges(form, pendingProvider ?? activeProvider));
    }
  }, [form, pendingProvider, activeProvider, settings]);

  // Update form handler
  const updateForm = (updates: Partial<PaymentConfig>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  // Helper to mask API keys
  const maskKey = (key: string, showLast: number = 4) => {
    if (!key) return null;
    if (key.length <= showLast) return key;
    return "••••••••" + key.slice(-showLast);
  };

  const isKeyFilled = (key: string | undefined) => key && key.length > 0;

  const updateMutation = useMutation({
    mutationFn: () => adminApi.updatePaymentSettings({
      active_provider: displayProvider,
      ...form,
    }),
    onSuccess: () => {
      toast.success("Configurações salvas!");
      setActiveProvider(displayProvider);
      setPendingProvider(null);
      queryClient.invalidateQueries({ queryKey: ["payment-settings"] });
    },
    onError: () => toast.error("Erro ao salvar configurações"),
  });

  const toggleKey = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <div className="skeleton h-8 w-64 rounded-xl mb-2" />
          <div className="skeleton h-4 w-80 rounded-xl" />
        </div>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 opacity-20" style={{ borderColor: "var(--green)" }} />
            <div className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--green)" }} />
          </div>
          <span className="text-sm" style={{ color: "var(--text-3)" }}>Carregando...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
          <span className="hidden sm:inline">Configurações de Pagamento</span>
          <span className="sm:hidden">Pagamento</span>
        </h1>
        <p className="text-sm mt-1 hidden sm:block" style={{ color: "hsl(240 8% 46%)" }}>
          Configure o provedor de pagamento e metode de checkout.
        </p>
      </div>

      {/* Status do Provedor Ativo */}
      <div
        className="rounded-2xl p-4 flex items-center justify-between"
        style={{
          background: settings?.active_provider &&
            ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
             (settings.active_provider === 'asaas' && settings.asaas_configured) ||
             (settings.active_provider === 'abacatepay' && settings.abacatepay_configured))
            ? "rgba(0,212,106,0.08)"
            : "rgba(251,191,36,0.08)",
          border: `1px solid ${
            settings?.active_provider &&
            ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
             (settings.active_provider === 'asaas' && settings.asaas_configured) ||
             (settings.active_provider === 'abacatepay' && settings.abacatepay_configured))
            ? "rgba(0,212,106,0.2)"
            : "rgba(251,191,36,0.2)"
          }`
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: settings?.active_provider &&
                ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
                 (settings.active_provider === 'asaas' && settings.asaas_configured) ||
                 (settings.active_provider === 'abacatepay' && settings.abacatepay_configured))
                ? "rgba(0,212,106,0.15)"
                : "rgba(251,191,36,0.15)"
            }}
          >
            {settings?.active_provider &&
              ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
               (settings.active_provider === 'asaas' && settings.asaas_configured) ||
               (settings.active_provider === 'abacatepay' && settings.abacatepay_configured)) ? (
              <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
            ) : (
              <Shield className="w-4 h-4" style={{ color: "#fbbf24" }} />
            )}
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "hsl(240 15% 93%)" }}>
              Provedor Ativo
            </p>
            <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
              {PROVIDERS.find((p) => p.id === settings?.active_provider)?.descConfigured ||
               PROVIDERS.find((p) => p.id === settings?.active_provider)?.desc ||
               "Não configurado"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-[10px] px-2 py-1 rounded" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>
              Alterações pendentes
            </span>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{
            background: settings?.active_provider &&
              ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
               (settings.active_provider === 'asaas' && settings.asaas_configured) ||
               (settings.active_provider === 'abacatepay' && settings.abacatepay_configured))
              ? "rgba(0,212,106,0.15)"
              : "rgba(251,191,36,0.15)"
          }}>
            <span style={{
              color: settings?.active_provider &&
                ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
                 (settings.active_provider === 'asaas' && settings.asaas_configured) ||
                 (settings.active_provider === 'abacatepay' && settings.abacatepay_configured))
                ? "var(--green)"
                : "#fbbf24"
            }}>
              {PROVIDERS.find((p) => p.id === settings?.active_provider)?.icon}
            </span>
            <span className="text-sm font-medium" style={{
              color: settings?.active_provider &&
                ((settings.active_provider === 'stripe' && settings.stripe_configured) ||
                 (settings.active_provider === 'asaas' && settings.asaas_configured) ||
                 (settings.active_provider === 'abacatepay' && settings.abacatepay_configured))
                ? "var(--green)"
                : "#fbbf24"
            }}>
              {settings?.active_provider === 'stripe' && settings?.stripe_configured ? 'Stripe' :
               settings?.active_provider === 'asaas' && settings?.asaas_configured ? 'Asaas' :
               settings?.active_provider === 'abacatepay' && settings?.abacatepay_configured ? 'AbacatePay' :
               settings?.active_provider || 'Stripe'}
            </span>
          </div>
        </div>
      </div>

      {/* Seleção de Provedor */}
      <div
        className="rounded-2xl p-6"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="w-5 h-5" style={{ color: "hsl(240 8% 60%)" }} />
          <h2 className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>
            Selecione o Provedor
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((provider) => {
            const isConfigured =
              (provider.id === 'stripe' && settings?.stripe_configured) ||
              (provider.id === 'asaas' && settings?.asaas_configured) ||
              (provider.id === 'abacatepay' && settings?.abacatepay_configured);
            const isActive = provider.id === activeProvider;
            const isPending = provider.id === pendingProvider && provider.id !== activeProvider;
            const isSelected = displayProvider === provider.id;

            return (
              <button
                key={provider.id}
                onClick={() => {
                  if (provider.id !== 'hotmart') {
                    setPendingProvider(provider.id);
                  }
                }}
                className="p-3 rounded-xl border-2 transition-all text-center relative"
                style={{
                  borderColor: isSelected ? provider.color : isActive ? "var(--green)" : isConfigured ? "hsl(240 12% 15%)" : "hsl(240 12% 10%)",
                  background: isSelected ? `${provider.color}10` : isActive ? "rgba(0,212,106,0.06)" : "transparent",
                  opacity: provider.id === "hotmart" ? 0.5 : (isConfigured ? 1 : 0.6),
                }}
                disabled={provider.id === "hotmart"}
              >
                {/* Badge de status no topo */}
                <div className="absolute top-2 left-2 right-2 flex justify-between">
                  <div>
                    {!isConfigured && provider.id !== 'hotmart' && (
                      <Shield className="w-3 h-3" style={{ color: "#fbbf24" }} />
                    )}
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
                        style={{ background: `${provider.color}18`, color: provider.color, border: `1px solid ${provider.color}40` }}>
                        selecionado
                      </span>
                    )}
                    {isSelected && !isActive && !isPending && (
                      <Check className="w-4 h-4" style={{ color: provider.color }} />
                    )}
                  </div>
                </div>

                <div className="text-2xl mb-1 mt-3">{provider.icon}</div>
                <div className="font-medium text-sm" style={{ color: isSelected ? provider.color : isActive ? "var(--green)" : isConfigured ? "hsl(240 15% 93%)" : "hsl(240 8% 46%)" }}>
                  {provider.label}
                  {isConfigured && (
                    <Check className="w-3 h-3 inline ml-1" style={{ color: "var(--green)" }} />
                  )}
                </div>
                <div className="text-[10px]" style={{ color: isConfigured ? "var(--green)" : "hsl(240 8% 46%)" }}>
                  {isActive ? "Provedor ativo" : isConfigured ? provider.descConfigured : provider.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Configurações do Stripe */}
      {displayProvider === "stripe" && (
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: settings?.stripe_configured ? "rgba(99,91,255,0.15)" : "rgba(251,191,36,0.15)" }}>
                {settings?.stripe_configured ? (
                  <Shield className="w-4 h-4" style={{ color: "#635bff" }} />
                ) : (
                  <Shield className="w-4 h-4" style={{ color: "#fbbf24" }} />
                )}
              </div>
              <div>
                <h3 className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>Stripe</h3>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Configurações do Stripe {settings?.stripe_configured ? "(via painel)" : "(via .env)"}</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded" style={{ 
              background: settings?.stripe_configured ? "rgba(0,212,106,0.15)" : "rgba(251,191,36,0.15)", 
              color: settings?.stripe_configured ? "var(--green)" : "#fbbf24" 
            }}>
              {settings?.stripe_configured ? "Configurado" : "Fallback .env"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Stripe Secret Key</label>
              <div className="relative">
                <input
                  type={showKeys.stripe_secret ? "text" : "password"}
                  value={form.stripe_secret_key}
                  onChange={(e) => updateForm({ stripe_secret_key: e.target.value })}
                  placeholder={settings?.stripe_secret_key ? maskKey(settings.stripe_secret_key) : "sk_live_..."}
                  className="input-field w-full pr-8 font-mono text-xs"
                />
                <button type="button" onClick={() => toggleKey("stripe_secret")} className="absolute right-2 top-1/2 -translate-y-1/2">
                  {showKeys.stripe_secret ? <X className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
                </button>
              </div>
              {isKeyFilled(settings?.stripe_secret_key) && (
                <p className="text-[10px] mt-1" style={{ color: "var(--green)" }}>
                  ✓ Configurado ({maskKey(settings?.stripe_secret_key || "")})
                </p>
              )}
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>Deixe vazio para manter o atual</p>
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Webhook Secret</label>
              <input
                type="text"
                value={form.stripe_webhook_secret}
                onChange={(e) => updateForm({ stripe_webhook_secret: e.target.value })}
                placeholder={settings?.stripe_webhook_secret ? maskKey(settings.stripe_webhook_secret) : "whsec_..."}
                className="input-field w-full font-mono text-xs"
              />
              {isKeyFilled(settings?.stripe_webhook_secret) && (
                <p className="text-[10px] mt-1" style={{ color: "var(--green)" }}>✓ Configurado</p>
              )}
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <div className="pt-4">
              <label className="text-xs block mb-2" style={{ color: "hsl(240 8% 46%)" }}>Tipo de Checkout</label>
              <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="stripe_checkout"
                    checked={form.stripe_checkout_type === "redirect"}
                    onChange={() => updateForm({ stripe_checkout_type: "redirect" })}
                    className="accent-[#635bff]"
                  />
                  <div className="text-xs" style={{ color: "hsl(240 15% 80%)" }}>
                    <span className="font-medium">Redirect</span>
                    <p style={{ color: "hsl(240 8% 46%)" }}>Redireciona para página do Stripe</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="stripe_checkout"
                    checked={form.stripe_checkout_type === "transparent"}
                    onChange={() => updateForm({ stripe_checkout_type: "transparent" })}
                    className="accent-[#635bff]"
                  />
                  <div className="text-xs" style={{ color: "hsl(240 15% 80%)" }}>
                    <span className="font-medium">Transparente</span>
                    <p style={{ color: "hsl(240 8% 46%)" }}>Checkout direto na aplicação (Stripe Elements)</p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="border-t pt-4" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <label className="text-xs block mb-2" style={{ color: "hsl(240 8% 46%)" }}>URL do Webhook (para configurar no Stripe)</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 60%)" }}>
                {settings?.stripe_webhook_url || `${process.env.NEXT_PUBLIC_API_URL?.replace('/v1', '') || 'https://api.uniq.chat'}/stripe/webhook`}
              </code>
              <button
                type="button"
                onClick={() => {
                  const url = settings?.stripe_webhook_url || `${process.env.NEXT_PUBLIC_API_URL?.replace('/v1', '') || 'https://api.uniq.chat'}/stripe/webhook`;
                  navigator.clipboard.writeText(url);
                  toast.success("URL copiada!");
                }}
                className="p-2 rounded hover:bg-white/5"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 38%)" }}>
              Configure esta URL no painel do Stripe em: webhook settings → Add endpoint
            </p>
          </div>
        </div>
      )}

      {/* Configurações do Asaas */}
      {displayProvider === "asaas" && (
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: settings?.asaas_configured ? "rgba(34,197,94,0.15)" : "rgba(251,191,36,0.15)" }}>
                {settings?.asaas_configured ? (
                  <Globe className="w-4 h-4" style={{ color: "#22c55e" }} />
                ) : (
                  <Globe className="w-4 h-4" style={{ color: "#fbbf24" }} />
                )}
              </div>
              <div>
                <h3 className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>Asaas</h3>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Gateway de pagamento brasileiro {settings?.asaas_configured ? "(configurado)" : "(não configurado)"}</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded" style={{ 
              background: settings?.asaas_configured ? "rgba(0,212,106,0.15)" : "rgba(251,191,36,0.15)", 
              color: settings?.asaas_configured ? "var(--green)" : "#fbbf24" 
            }}>
              {settings?.asaas_configured ? "Configurado" : "Não configurado"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Ambiente</label>
              <select
                value={form.asaas_environment}
                onChange={(e) => updateForm({ asaas_environment: e.target.value })}
                className="input-field w-full text-xs"
              >
                {ASAAS_ENVIRONMENTS.map((env) => (
                  <option key={env.id} value={env.id}>{env.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Webhook Secret</label>
              <input
                type="text"
                value={form.asaas_webhook_secret}
                onChange={(e) => updateForm({ asaas_webhook_secret: e.target.value })}
                placeholder={settings?.asaas_webhook_secret ? maskKey(settings.asaas_webhook_secret) : "whsec_..."}
                className="input-field w-full font-mono text-xs"
              />
              {isKeyFilled(settings?.asaas_webhook_secret) && (
                <p className="text-[10px] mt-1" style={{ color: "var(--green)" }}>✓ Configurado</p>
              )}
            </div>
            <div className="col-span-2">
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Asaas API Key</label>
              <div className="relative">
                <input
                  type={showKeys.asaas_api_key ? "text" : "password"}
                  value={form.asaas_api_key}
                  onChange={(e) => updateForm({ asaas_api_key: e.target.value })}
                  placeholder={settings?.asaas_api_key ? maskKey(settings.asaas_api_key) : "$aas_..."}
                  className="input-field w-full pr-8 font-mono text-xs"
                />
                <button type="button" onClick={() => toggleKey("asaas_api_key")} className="absolute right-2 top-1/2 -translate-y-1/2">
                  {showKeys.asaas_api_key ? <X className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
                </button>
              </div>
              {isKeyFilled(settings?.asaas_api_key) && (
                <p className="text-[10px] mt-1" style={{ color: "var(--green)" }}>
                  ✓ Configurado ({maskKey(settings?.asaas_api_key || "")})
                </p>
              )}
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>Deixe vazio para manter o atual</p>
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <div className="pt-4">
              <label className="text-xs block mb-2" style={{ color: "hsl(240 8% 46%)" }}>Tipo de Checkout</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="asaas_checkout"
                    checked={form.asaas_checkout_type === "transparent"}
                    onChange={() => updateForm({ asaas_checkout_type: "transparent" })}
                    className="accent-[#22c55e]"
                  />
                  <div className="text-xs" style={{ color: "hsl(240 15% 80%)" }}>
                    <span className="font-medium">Transparente</span>
                    <p style={{ color: "hsl(240 8% 46%)" }}>Checkout direto na aplicação ( Asaas Checkout )</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="asaas_checkout"
                    checked={form.asaas_checkout_type === "redirect"}
                    onChange={() => updateForm({ asaas_checkout_type: "redirect" })}
                    className="accent-[#22c55e]"
                  />
                  <div className="text-xs" style={{ color: "hsl(240 15% 80%)" }}>
                    <span className="font-medium">Redirect</span>
                    <p style={{ color: "hsl(240 8% 46%)" }}>Redireciona para página do Asaas</p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="border-t pt-4" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <label className="text-xs block mb-2" style={{ color: "hsl(240 8% 46%)" }}>URL do Webhook (para configurar no Asaas)</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 60%)" }}>
                {settings?.asaas_webhook_url || `${process.env.NEXT_PUBLIC_API_URL?.replace('/v1', '') || 'https://api.uniq.chat'}/asaas/webhook`}
              </code>
              <button
                type="button"
                onClick={() => {
                  const url = settings?.asaas_webhook_url || `${process.env.NEXT_PUBLIC_API_URL?.replace('/v1', '') || 'https://api.uniq.chat'}/asaas/webhook`;
                  navigator.clipboard.writeText(url);
                  toast.success("URL copiada!");
                }}
                className="p-2 rounded hover:bg-white/5"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 38%)" }}>
              Configure esta URL no painel do Asaas em: Configurações → Webhooks
            </p>
          </div>
        </div>
      )}

      {/* Configurações do AbacatePay */}
      {displayProvider === "abacatepay" && (
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: settings?.abacatepay_configured ? "rgba(14,165,233,0.15)" : "rgba(251,191,36,0.15)" }}>
                {settings?.abacatepay_configured ? (
                  <Shield className="w-4 h-4" style={{ color: "#0ea5e9" }} />
                ) : (
                  <Shield className="w-4 h-4" style={{ color: "#fbbf24" }} />
                )}
              </div>
              <div>
                <h3 className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>AbacatePay</h3>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Gateway PIX brasileiro {settings?.abacatepay_configured ? "(configurado)" : "(não configurado)"}</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded" style={{
              background: settings?.abacatepay_configured ? "rgba(0,212,106,0.15)" : "rgba(251,191,36,0.15)",
              color: settings?.abacatepay_configured ? "var(--green)" : "#fbbf24"
            }}>
              {settings?.abacatepay_configured ? "Configurado" : "Não configurado"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Ambiente</label>
              <select
                value={form.abacatepay_environment}
                onChange={(e) => updateForm({ abacatepay_environment: e.target.value })}
                className="input-field w-full text-xs"
              >
                {ASAAS_ENVIRONMENTS.map((env) => (
                  <option key={env.id} value={env.id}>{env.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Webhook Secret</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={form.abacatepay_webhook_secret}
                  onChange={(e) => updateForm({ abacatepay_webhook_secret: e.target.value })}
                  placeholder={settings?.abacatepay_webhook_secret ? maskKey(settings.abacatepay_webhook_secret) : "whsec_..."}
                  className="input-field flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const chars = "0123456789abcdef";
                    let secret = "whsec_";
                    for (let i = 0; i < 32; i++) secret += chars[Math.floor(Math.random() * 16)];
                    updateForm({ abacatepay_webhook_secret: secret });
                    toast.success("Secret gerado! Use o mesmo valor no AbacatePay.");
                  }}
                  className="text-[10px] px-3 py-2 rounded-lg font-medium shrink-0 hover:opacity-80 transition-opacity"
                  style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", color: "#7dd3fc" }}
                >
                  Gerar Secret
                </button>
              </div>
              {isKeyFilled(settings?.abacatepay_webhook_secret) && (
                <p className="text-[10px] mt-1" style={{ color: "var(--green)" }}>✓ Configurado</p>
              )}
            </div>
            <div className="col-span-2">
              <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>AbacatePay API Key</label>
              <div className="relative">
                <input
                  type={showKeys.abacatepay_api_key ? "text" : "password"}
                  value={form.abacatepay_api_key}
                  onChange={(e) => updateForm({ abacatepay_api_key: e.target.value })}
                  placeholder={settings?.abacatepay_api_key ? maskKey(settings.abacatepay_api_key) : "abac_..."}
                  className="input-field w-full pr-8 font-mono text-xs"
                />
                <button type="button" onClick={() => toggleKey("abacatepay_api_key")} className="absolute right-2 top-1/2 -translate-y-1/2">
                  {showKeys.abacatepay_api_key ? <X className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
                </button>
              </div>
              {isKeyFilled(settings?.abacatepay_api_key) && (
                <p className="text-[10px] mt-1" style={{ color: "var(--green)" }}>
                  ✓ Configurado ({maskKey(settings?.abacatepay_api_key || "")})
                </p>
              )}
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>Deixe vazio para manter o atual</p>
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <div className="pt-4">
              <label className="text-xs block mb-2" style={{ color: "hsl(240 8% 46%)" }}>Tipo de Checkout</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="abacatepay_checkout"
                    checked={form.abacatepay_checkout_type === "transparent"}
                    onChange={() => updateForm({ abacatepay_checkout_type: "transparent" })}
                    className="accent-[#0ea5e9]"
                  />
                  <div className="text-xs" style={{ color: "hsl(240 15% 80%)" }}>
                    <span className="font-medium">Transparente</span>
                    <p style={{ color: "hsl(240 8% 46%)" }}>PIX direto na aplicação (checkout Uniq)</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="radio"
                    name="abacatepay_checkout"
                    checked={form.abacatepay_checkout_type === "redirect"}
                    onChange={() => updateForm({ abacatepay_checkout_type: "redirect" })}
                    className="accent-[#0ea5e9]"
                  />
                  <div className="text-xs" style={{ color: "hsl(240 15% 80%)" }}>
                    <span className="font-medium">Redirect</span>
                    <p style={{ color: "hsl(240 8% 46%)" }}>Redireciona para página do AbacatePay</p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="border-t pt-4" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <label className="text-xs block mb-2" style={{ color: "hsl(240 8% 46%)" }}>URL do Webhook (para configurar no AbacatePay)</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 60%)" }}>
                {(() => {
                  const base = settings?.abacatepay_webhook_url || `${process.env.NEXT_PUBLIC_API_URL?.replace('/v1', '') || 'https://api.uniq.chat'}/abacatepay/webhook`;
                  const secret = form.abacatepay_webhook_secret || settings?.abacatepay_webhook_secret;
                  return secret ? `${base}?webhookSecret=${secret}` : base;
                })()}
              </code>
              <button
                type="button"
                onClick={() => {
                  const base = settings?.abacatepay_webhook_url || `${process.env.NEXT_PUBLIC_API_URL?.replace('/v1', '') || 'https://api.uniq.chat'}/abacatepay/webhook`;
                  const secret = form.abacatepay_webhook_secret || settings?.abacatepay_webhook_secret;
                  const url = secret ? `${base}?webhookSecret=${secret}` : base;
                  navigator.clipboard.writeText(url);
                  toast.success("URL copiada!");
                }}
                className="p-2 rounded hover:bg-white/5"
              >
                <Copy className="w-4 h-4" />
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

          {/* Status do teste de conexão */}
          {settings?.abacatepay_test_status && (
            <div className="border-t pt-4" style={{ borderColor: "hsl(240 12% 15%)" }}>
              <div className="flex items-center gap-3">
                <span className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Status da API:</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  settings.abacatepay_test_status === "ok" ? "bg-[rgba(0,212,106,0.15)] text-[var(--green)]" :
                  "bg-[rgba(239,68,68,0.15)] text-[#ef4444]"
                }`}>
                  {settings.abacatepay_test_status === "ok" ? "✓ Conectado" : "✕ Falhou"}
                </span>
                {settings.abacatepay_tested_at && (
                  <span className="text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                    {new Date(settings.abacatepay_tested_at).toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
              {settings.abacatepay_test_error && (
                <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{settings.abacatepay_test_error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Botão Salvar */}
      <div className="flex justify-end">
        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="btn-primary flex items-center gap-2 px-6 py-2.5"
        >
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configurações
        </button>
      </div>
    </div>
  );
}