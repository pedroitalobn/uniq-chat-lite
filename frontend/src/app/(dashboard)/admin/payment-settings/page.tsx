"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { CreditCard, Shield, Check, X, Loader2, Save, Key, Globe, ExternalLink, Lock } from "lucide-react";
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
  hotmart_api_key?: string;
  hotmart_webhook_secret?: string;
}

const PROVIDERS = [
  { id: "stripe", label: "Stripe", icon: "💳", color: "#635bff", desc: "Cartão Internacional" },
  { id: "asaas", label: "Asaas", icon: "🇧🇷", color: "#22c55e", desc: "Pix, Boleto, Cartão (BR)" },
  { id: "hotmart", label: "Hotmart", icon: "🎯", color: "#fbbf24", desc: "Em breve" },
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
  hotmart_api_key: string;
  hotmart_webhook_secret: string;
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
    hotmart_api_key: "",
    hotmart_webhook_secret: "",
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
      newForm.asaas_checkout_type !== (settings.asaas_checkout_type || "transparent")
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
        hotmart_api_key: settings.hotmart_api_key || "",
        hotmart_webhook_secret: settings.hotmart_webhook_secret || "",
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "hsl(240 15% 93%)" }}>
          Configurações de Pagamento
        </h1>
        <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
          Configure o provedor de pagamento e metode de checkout.
        </p>
      </div>

      {/* Status do Provedor Ativo */}
      <div
        className="rounded-2xl p-4 flex items-center justify-between"
        style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(0,212,106,0.15)" }}
          >
            <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "hsl(240 15% 93%)" }}>
              Provedor Ativo
            </p>
            <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
              {PROVIDERS.find((p) => p.id === activeProvider)?.desc}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-[10px] px-2 py-1 rounded" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>
              Alterações pendentes
            </span>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,212,106,0.15)" }}>
            <span style={{ color: "var(--green)" }}>
              {PROVIDERS.find((p) => p.id === activeProvider)?.icon}
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--green)" }}>
              {PROVIDERS.find((p) => p.id === activeProvider)?.label}
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
          <h2 className="font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
            Selecione o Provedor
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => setPendingProvider(provider.id)}
              className="p-3 rounded-xl border-2 transition-all text-center relative"
              style={{
                borderColor: displayProvider === provider.id ? provider.color : "hsl(240 12% 15%)",
                background: displayProvider === provider.id ? `${provider.color}10` : "transparent",
                opacity: provider.id === "hotmart" ? 0.5 : 1,
              }}
              disabled={provider.id === "hotmart"}
            >
              <div className="text-2xl mb-1">{provider.icon}</div>
              <div className="font-medium text-sm" style={{ color: displayProvider === provider.id ? provider.color : "hsl(240 15% 93%)" }}>
                {provider.label}
              </div>
              <div className="text-[10px]" style={{ color: "hsl(240 8% 46%)" }}>
                {provider.desc}
              </div>
              {displayProvider === provider.id && (
                <div className="absolute top-2 right-2">
                  <Check className="w-4 h-4" style={{ color: provider.color }} />
                </div>
              )}
            </button>
          ))}
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
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(99,91,255,0.15)" }}>
                <Shield className="w-4 h-4" style={{ color: "#635bff" }} />
              </div>
              <div>
                <h3 className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>Stripe</h3>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Configurações do Stripe</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(99,91,255,0.15)", color: "#635bff" }}>Ativo</span>
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
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                <Globe className="w-4 h-4" style={{ color: "#22c55e" }} />
              </div>
              <div>
                <h3 className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>Asaas</h3>
                <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Gateway de pagamento brasileiro</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>Ativo</span>
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