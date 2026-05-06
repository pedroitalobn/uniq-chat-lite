"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { toast } from "sonner";
import { AnimatedTabContent } from "@/components/ui/AnimatedTabContent";
import {
  CreditCard, Mail, MessageSquare, Server, Globe, Shield, Key, Save, Check, X,
  Loader2, RefreshCw, Edit2, ExternalLink, Smartphone, Settings2, Sparkles,
} from "lucide-react";
import { PlatformAIPanel } from "@/app/(dashboard)/admin/platform-ai/page";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = "payment" | "communication" | "server" | "proxies" | "ai";
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
  asaas_environment?: string;
  asaas_configured?: boolean;
  asaas_webhook_url?: string;
  asaas_api_key_preview?: string;
  asaas_webhook_secret_preview?: string;
  asaas_test_status?: string;
  asaas_tested_at?: string | null;
  asaas_test_error?: string;
  hotmart_configured?: boolean;
  hotmart_api_key_preview?: string;
  hotmart_webhook_secret_preview?: string;
  hotmart_test_status?: string;
  hotmart_tested_at?: string | null;
  hotmart_test_error?: string;
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
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 24,
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...CARD, ...style }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold mb-4" style={{ color: "hsl(240 15% 92%)" }}>{children}</h2>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none focus:border-[#00d46a] transition-colors"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)", color: "hsl(240 15% 90%)" }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none focus:border-[#00d46a] transition-colors"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)", color: "hsl(240 15% 90%)" }}
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
function TestConnectionButton({ provider, disabled }: { provider: "stripe" | "asaas"; disabled?: boolean }) {
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
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.10)",
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
      style={{ background: "rgba(255,255,255,0.07)", color: "hsl(240 8% 55%)" }}>
      Não testado
    </span>
  );
}

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { id: "payment",       label: "Pagamento",    icon: CreditCard,    desc: "Stripe, Asaas, Hotmart" },
  { id: "communication", label: "Comunicação",  icon: Mail,          desc: "Email, templates, OTP" },
  // AI: configura provedores globais (OpenAI, Anthropic, etc.) usados
  // por todos os módulos da plataforma — Uniq AI chat, transcrição
  // Whisper de áudios do inbox, agente de instâncias.
  { id: "ai",            label: "Uniq AI",      icon: Sparkles,      desc: "Provedores LLM globais (OpenAI, Anthropic, etc.)" },
  { id: "server",        label: "Servidor",     icon: Server,        desc: "Servidores e instâncias" },
  { id: "proxies",       label: "Proxies",      icon: Globe,         desc: "Gerenciamento de proxies" },
];

// ─── Payment Tab ──────────────────────────────────────────────────────────────
const PROVIDERS = [
  { id: "stripe",  label: "Stripe",  icon: "💳", color: "#635bff" },
  { id: "asaas",   label: "Asaas",   icon: "🇧🇷", color: "#22c55e" },
  { id: "hotmart", label: "Hotmart", icon: "🎯", color: "#fbbf24", disabled: true },
];

function PaymentTab() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery<PaymentSettings>({
    queryKey: ["admin-payment-settings"],
    queryFn: () => adminApi.getPaymentSettings().then((r) => r.data),
  });

  const [provider, setProvider] = useState("stripe");
  const [form, setForm] = useState({
    stripe_secret_key: "", stripe_webhook_secret: "", stripe_checkout_type: "redirect",
    asaas_api_key: "", asaas_webhook_secret: "", asaas_environment: "sandbox",
    hotmart_api_key: "",
  });

  useEffect(() => {
    if (settings) {
      setProvider(settings.active_provider || "stripe");
      // Os campos de credencial ficam vazios — backend não devolve a
      // key crua mais, só preview mascarado. Se o admin quiser
      // alterar, digita a nova; se deixar vazio, o save preserva
      // a atual (handler ignora strings vazias).
      setForm(f => ({
        ...f,
        stripe_checkout_type: settings.stripe_checkout_type || "redirect",
        asaas_environment: settings.asaas_environment || "sandbox",
      }));
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () => adminApi.updatePaymentSettings({ active_provider: provider, ...form }),
    onSuccess: () => { toast.success("Configurações salvas!"); queryClient.invalidateQueries({ queryKey: ["admin-payment-settings"] }); },
    onError: () => toast.error("Erro ao salvar"),
  });

  const copyUrl = (url: string) => { navigator.clipboard.writeText(url); toast.success("URL copiada!"); };

  if (isLoading) return <div className="flex items-center gap-2 py-8"><Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" /><span className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>Carregando...</span></div>;

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace("/v1", "") || "https://api.uniq.chat";

  return (
    <div className="space-y-5">
      <SectionTitle>Pagamento</SectionTitle>

      {/* Provider cards */}
      <Card>
        <p className="text-xs font-medium mb-3" style={{ color: "hsl(240 8% 55%)" }}>PROVEDOR ATIVO</p>
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const isActive = provider === p.id;
            const isConfigured = p.id === "stripe" ? settings?.stripe_configured
              : p.id === "asaas" ? settings?.asaas_configured
              : settings?.hotmart_configured;
            // test_status reflete o resultado real do último teste de
            // conectividade contra o provider — diferente de
            // isConfigured que só checa se há key no DB.
            const testStatus = p.id === "stripe" ? settings?.stripe_test_status
              : p.id === "asaas" ? settings?.asaas_test_status
              : settings?.hotmart_test_status;
            return (
              <button key={p.id} onClick={() => !p.disabled && setProvider(p.id)}
                disabled={p.disabled}
                className="p-3 rounded-xl border-2 text-center relative transition-all"
                style={{
                  borderColor: isActive ? p.color : "rgba(255,255,255,0.08)",
                  background: isActive ? `${p.color}12` : "transparent",
                  opacity: p.disabled ? 0.45 : 1,
                }}>
                <div className="text-2xl mb-1">{p.icon}</div>
                <div className="text-sm font-medium" style={{ color: isActive ? p.color : "hsl(240 15% 85%)" }}>{p.label}</div>
                {testStatus === "ok" && <Check className="w-3 h-3 absolute top-2 right-2 text-[#00d46a]" />}
                {testStatus === "failed" && <X className="w-3 h-3 absolute top-2 right-2" style={{ color: "#f87171" }} />}
                {!isConfigured && !p.disabled && <Shield className="w-3 h-3 absolute top-2 left-2" style={{ color: "#fbbf24" }} />}
                <div className="mt-1"><PaymentProviderBadge configured={!!isConfigured} testStatus={testStatus} disabled={!!p.disabled} /></div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Stripe config */}
      {provider === "stripe" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 92%)" }}>Stripe</h3>
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
                    style={{ background: "hsl(240 18% 5%)", color: "hsl(240 8% 65%)" }}>
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
              <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 40%)" }}>Deixe vazio para manter o atual</p>
            </div>
            <div>
              <Label>Webhook Secret</Label>
              <Input type="password" value={form.stripe_webhook_secret}
                onChange={e => setForm(f => ({ ...f, stripe_webhook_secret: e.target.value }))}
                placeholder={settings?.stripe_webhook_secret_preview || "whsec_..."} />
              {settings?.stripe_webhook_secret_preview && (
                <code className="inline-block mt-1.5 text-[11px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "hsl(240 18% 5%)", color: "hsl(240 8% 65%)" }}>
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
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <Label>URL do Webhook</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 18% 5%)", color: "hsl(240 8% 60%)" }}>
                {settings?.stripe_webhook_url || `${apiBase}/stripe/webhook`}
              </code>
              <button onClick={() => copyUrl(settings?.stripe_webhook_url || `${apiBase}/stripe/webhook`)} className="p-2 rounded hover:bg-white/5">
                <Key className="w-4 h-4" style={{ color: "hsl(240 8% 55%)" }} />
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Asaas config */}
      {provider === "asaas" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 92%)" }}>Asaas</h3>
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
                    style={{ background: "hsl(240 18% 5%)", color: "hsl(240 8% 65%)" }}>
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
              <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 40%)" }}>Deixe vazio para manter o atual</p>
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
                  style={{ background: "hsl(240 18% 5%)", color: "hsl(240 8% 65%)" }}>
                  {settings.asaas_webhook_secret_preview}
                </code>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <Label>URL do Webhook</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs p-2 rounded font-mono break-all" style={{ background: "hsl(240 18% 5%)", color: "hsl(240 8% 60%)" }}>
                {settings?.asaas_webhook_url || `${apiBase}/asaas/webhook`}
              </code>
              <button onClick={() => copyUrl(settings?.asaas_webhook_url || `${apiBase}/asaas/webhook`)} className="p-2 rounded hover:bg-white/5">
                <Key className="w-4 h-4" style={{ color: "hsl(240 8% 55%)" }} />
              </button>
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
    onError: () => toast.error("Erro ao salvar"),
  });

  const testMut = useMutation({
    mutationFn: () => adminApi.testEmail(testEmail),
    onSuccess: () => toast.success("Email de teste enviado!"),
    onError: () => toast.error("Erro ao enviar email de teste"),
  });

  if (isLoading) return <div className="py-4"><Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" /></div>;

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-4" style={{ color: "hsl(240 15% 92%)" }}>Email (Maileroo)</h3>
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
      <div className="mt-4 pt-4 flex items-end gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex-1">
          <Label>Testar Email</Label>
          <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="email@teste.com" />
        </div>
        <button onClick={() => testMut.mutate()} disabled={!testEmail || testMut.isPending}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "hsl(240 15% 80%)" }}>
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
          <h3 className="font-semibold" style={{ color: "hsl(240 15% 92%)" }}>{template.name}</h3>
          <button onClick={onClose} className="hover:opacity-70"><X className="w-4 h-4" style={{ color: "hsl(240 8% 55%)" }} /></button>
        </div>
        <div>
          <Label>Assunto</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>HTML</Label>
          <textarea value={html} onChange={e => setHtml(e.target.value)} rows={12}
            className="w-full px-3.5 py-2.5 rounded-xl text-xs outline-none focus:border-[#00d46a] font-mono resize-y"
            style={{ background: "hsl(240 18% 5%)", border: "1px solid hsl(240 12% 13%)", color: "hsl(240 15% 80%)" }} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.05)", color: "hsl(240 8% 55%)" }}>Cancelar</button>
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
      <h3 className="text-sm font-semibold mb-4" style={{ color: "hsl(240 15% 92%)" }}>Templates de Email</h3>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-[#00d46a]" />
      ) : templates.length === 0 ? (
        <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>Nenhum template encontrado.</p>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "hsl(240 15% 88%)" }}>{t.name}</p>
                <p className="text-xs font-mono" style={{ color: "hsl(240 8% 55%)" }}>{t.slug}</p>
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
      <h3 className="text-sm font-semibold mb-4" style={{ color: "hsl(240 15% 92%)" }}>OTP & Mensagens</h3>
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
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
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
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {SUB_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSub(id)}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all"
            style={{ background: sub === id ? "rgba(0,212,106,0.15)" : "transparent", color: sub === id ? "#00d46a" : "hsl(240 8% 55%)" }}>
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
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {(["servers", "instances"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all"
            style={{ background: view === v ? "rgba(0,212,106,0.15)" : "transparent", color: view === v ? "#00d46a" : "hsl(240 8% 55%)" }}>
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
                <tr style={{ color: "hsl(240 8% 55%)" }}>
                  {["Nome", "Endereço", "Porta", "Status", "Owner"].map(h => (
                    <th key={h} className="text-left pb-3 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {servers.length === 0 ? (
                  <tr><td colSpan={5} className="py-4" style={{ color: "hsl(240 8% 55%)" }}>Nenhum servidor encontrado.</td></tr>
                ) : servers.map((s, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 font-medium" style={{ color: "hsl(240 15% 88%)" }}>{s.name}</td>
                    <td className="py-3 pr-4 font-mono" style={{ color: "hsl(240 8% 65%)" }}>{s.address}</td>
                    <td className="py-3 pr-4 font-mono" style={{ color: "hsl(240 8% 65%)" }}>{s.port}</td>
                    <td className="py-3 pr-4"><StatusBadge ok={s.status === "active" || s.status === "connected"} label={s.status} /></td>
                    <td className="py-3" style={{ color: "hsl(240 8% 55%)" }}>{s.owner_email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "hsl(240 8% 55%)" }}>
                  {["Nome", "Canal", "Status", "Owner", "Servidor"].map(h => (
                    <th key={h} className="text-left pb-3 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {instances.length === 0 ? (
                  <tr><td colSpan={5} className="py-4" style={{ color: "hsl(240 8% 55%)" }}>Nenhuma instância encontrada.</td></tr>
                ) : instances.map((inst, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 font-medium" style={{ color: "hsl(240 15% 88%)" }}>{inst.name}</td>
                    <td className="py-3 pr-4 capitalize" style={{ color: "hsl(240 8% 65%)" }}>{inst.type || inst.channel || "—"}</td>
                    <td className="py-3 pr-4"><StatusBadge ok={inst.status === "active" || inst.status === "connected"} label={inst.status} /></td>
                    <td className="py-3 pr-4" style={{ color: "hsl(240 8% 55%)" }}>{inst.owner_email || "—"}</td>
                    <td className="py-3" style={{ color: "hsl(240 8% 55%)" }}>{inst.server || "—"}</td>
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
            <h3 className="text-sm font-semibold mb-1" style={{ color: "hsl(240 15% 92%)" }}>Gerenciamento completo de proxies</h3>
            <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>
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
export default function ProvidersPage() {
  const { data: session } = useSession();
  const [active, setActive] = useState<Tab>("payment");
  const isSuperAdmin = (session?.user as { role?: string })?.role === "super_admin";

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Shield className="w-10 h-10" style={{ color: "hsl(240 8% 35%)" }} />
        <p className="text-sm font-medium" style={{ color: "hsl(240 8% 55%)" }}>Acesso restrito a super administradores.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 92%)" }}>Providers</h1>
        <p className="text-sm mt-1 hidden sm:block" style={{ color: "hsl(240 8% 55%)" }}>
          Configure provedores de pagamento, comunicação, servidores e proxies.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
        {/* Sidebar */}
        <aside className="hidden sm:flex w-44 lg:w-52 flex-shrink-0 sticky top-0">
          <nav className="rounded-2xl overflow-hidden w-full"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {TABS.map((tab, i) => {
              const Icon = tab.icon;
              const isActive = active === tab.id;
              return (
                <button key={tab.id} onClick={() => setActive(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 lg:px-4 py-3 lg:py-3.5 text-left relative${i < TABS.length - 1 ? " border-b" : ""}`}
                  style={{ borderColor: "rgba(255,255,255,0.06)", background: isActive ? "rgba(0,212,106,0.10)" : "transparent", transition: "background 0.2s" }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r" style={{ background: "#00d46a" }} />}
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: isActive ? "rgba(0,212,106,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${isActive ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.08)"}` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: isActive ? "#00d46a" : "hsl(240 8% 55%)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: isActive ? "#00d46a" : "hsl(240 15% 88%)" }}>{tab.label}</p>
                    <p className="text-[10px] truncate mt-0.5 hidden lg:block" style={{ color: "hsl(240 8% 45%)" }}>{tab.desc}</p>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile tabs */}
        <div className="sm:hidden flex gap-1 p-1 rounded-xl w-full" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActive(id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium"
              style={{ background: active === id ? "rgba(0,212,106,0.15)" : "transparent", color: active === id ? "#00d46a" : "hsl(240 8% 55%)" }}>
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
            {active === "server"        && <ServerTab />}
            {active === "proxies"       && <ProxiesTab />}
          </AnimatedTabContent>
        </div>
      </div>
    </div>
  );
}
