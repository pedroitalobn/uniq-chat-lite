"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authApi, plansApi } from "@/lib/api";
import { usePreferences, TIMEZONES, type Language, type ThemeMode } from "@/lib/preferences";
import {
  User, Lock, Check, Loader2, Eye, EyeOff, Globe, Sun, Moon, Monitor,
  Clock, CreditCard, Zap, ArrowRight, Star, Info, ChevronRight, Ticket, Copy, Link2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Plan } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────
type Section = "billing" | "profile" | "security" | "preferences" | "account" | "invites";

const SECTIONS: { id: Section; label: string; icon: React.ElementType; description: string }[] = [
  { id: "billing",     label: "Plano & Billing",  icon: CreditCard, description: "Assinatura e recursos" },
  { id: "profile",     label: "Perfil",            icon: User,       description: "Nome e username" },
  { id: "security",    label: "Segurança",          icon: Lock,       description: "Senha de acesso" },
  { id: "preferences", label: "Preferências",       icon: Globe,      description: "Idioma, tema e fuso" },
  { id: "invites",     label: "Convites",           icon: Ticket,     description: "Indique e ganhe" },
  { id: "account",     label: "Conta",              icon: Info,       description: "Informações da conta" },
];

// ─── Shared primitives ────────────────────────────────────────────────────────
function SectionWrap({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight" style={{ color: "var(--text-1)" }}>{title}</h2>
        {description && <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-6" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium block" style={{ color: "var(--text-2)" }}>{label}</label>
      {children}
      {hint && <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{hint}</p>}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="input-field w-full pr-9" />
      <button type="button" onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
        style={{ color: "var(--text-3)" }}>
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ─── Theme button ─────────────────────────────────────────────────────────────
function ThemeBtn({ value, current, icon: Icon, label, onSelect }: {
  value: ThemeMode; current: ThemeMode; icon: React.ElementType; label: string;
  onSelect: (v: ThemeMode) => void;
}) {
  const active = current === value;
  return (
    <button type="button" onClick={() => onSelect(value)}
      className="flex-1 flex flex-col items-center gap-2 py-3 px-2 rounded-xl border transition-all"
      style={active
        ? { background: "var(--green-dim)", borderColor: "var(--green-border)", color: "var(--green)" }
        : { background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-3)" }
      }>
      <Icon className="w-5 h-5" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

const LANGS: { value: Language; label: string; flag: string }[] = [
  { value: "pt", label: "Português", flag: "🇧🇷" },
  { value: "en", label: "English",   flag: "🇺🇸" },
  { value: "es", label: "Español",   flag: "🇪🇸" },
];

// ─── Billing Section ──────────────────────────────────────────────────────────
function BillingSection({ session }: { session: ReturnType<typeof useSession>["data"] }) {
  const currentPlan = (session?.user as unknown as Record<string, unknown>)?.plan as Plan | undefined;
  const currentPlanName = currentPlan?.name ?? "Free";
  const isFreePlan = currentPlanName.toLowerCase() === "free";

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["stripe-plans"],
    queryFn: () => plansApi.list().then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: subscription } = useQuery<{ status?: string; cancel_at_period_end?: boolean }>({
    queryKey: ["stripe-subscription"],
    queryFn: () => plansApi.subscription().then((r) => r.data),
    enabled: !isFreePlan,
  });

  const checkoutMutation = useMutation({
    mutationFn: (planId: string) => plansApi.checkout({ plan_id: planId }),
    onSuccess: (res) => {
      const url = res.data?.url || res.data?.checkout_url;
      if (url) { window.location.href = url; }
      else { toast.error("URL de checkout não recebida"); }
    },
    onError: () => toast.error("Erro ao criar sessão de checkout"),
  });

  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
    active:   { bg: "rgba(0,212,106,0.08)",  color: "#00d46a", label: "Ativa" },
    past_due: { bg: "rgba(251,191,36,0.08)", color: "#fbbf24", label: "Pagamento pendente" },
    canceled: { bg: "rgba(239,68,68,0.08)",  color: "#f87171", label: "Cancelada" },
    trialing: { bg: "rgba(96,165,250,0.08)", color: "#60a5fa", label: "Em teste" },
  };
  const subStatus = subscription?.status ?? (isFreePlan ? undefined : "active");
  const statusInfo = subStatus ? (statusColors[subStatus] ?? statusColors.active) : null;

  return (
    <SectionWrap title="Plano & Billing" description="Gerencie sua assinatura e recursos disponíveis.">
      <div className="space-y-4">
        {/* Current plan card */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
                {isFreePlan
                  ? <Star className="w-4.5 h-4.5" style={{ color: "var(--green)" }} />
                  : <Zap className="w-4.5 h-4.5" style={{ color: "var(--green)" }} />
                }
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Plano {currentPlanName}</p>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>
                  {currentPlan?.price === 0 || !currentPlan ? "Gratuito" : `R$ ${currentPlan.price}/mês`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusInfo && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: statusInfo.bg, color: statusInfo.color, border: `1px solid ${statusInfo.color}30` }}>
                  {statusInfo.label}
                </span>
              )}
              {subscription?.cancel_at_period_end && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}>
                  Cancela ao fim do período
                </span>
              )}
            </div>
          </div>

          {currentPlan && (
            <div className="flex items-center gap-6 mt-5 pt-5" style={{ borderTop: "1px solid var(--surface-border)" }}>
              {[
                { label: "Instâncias", value: currentPlan.max_instances === -1 ? "∞" : currentPlan.max_instances },
                { label: "Msgs/dia", value: currentPlan.max_messages_per_day === -1 ? "∞" : currentPlan.max_messages_per_day.toLocaleString("pt-BR") },
                { label: "Usuários", value: currentPlan.max_users === -1 ? "∞" : currentPlan.max_users },
                { label: "Workspaces", value: currentPlan.max_workspaces === -1 ? "∞" : currentPlan.max_workspaces },
                { label: "Proxy", value: currentPlan.allow_proxy ? "Ativo" : "Inativo", colored: currentPlan.allow_proxy },
              ].map(({ label, value, colored }, i, arr) => (
                <div key={label} className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-lg font-bold" style={{ color: colored ? "#60a5fa" : "var(--text-1)" }}>{value}</p>
                    <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-3)" }}>{label}</p>
                  </div>
                  {i < arr.length - 1 && <div className="w-px h-8" style={{ background: "var(--surface-border)" }} />}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Plan picker */}
        <Card>
          <p className="text-xs font-semibold mb-4" style={{ color: "var(--text-3)" }}>PLANOS DISPONÍVEIS</p>
          {plansLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
          ) : (
            <div className="space-y-2">
              {plans.map((plan) => {
                const isCurrent = plan.name.toLowerCase() === currentPlanName.toLowerCase();
                return (
                  <div key={plan.id}
                    className="rounded-xl p-3.5 flex items-center justify-between transition-all"
                    style={{
                      background: isCurrent ? "rgba(0,212,106,0.05)" : "var(--surface-3)",
                      border: isCurrent ? "1px solid rgba(0,212,106,0.2)" : "1px solid var(--surface-border)",
                    }}>
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2" style={{ color: isCurrent ? "var(--green)" : "var(--text-1)" }}>
                        {plan.name}
                        {isCurrent && <span className="text-[10px] font-normal opacity-60">plano atual</span>}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                        {plan.price === 0 ? "Gratuito" : `R$ ${plan.price}/mês`}
                        {plan.max_users !== -1 && ` · ${plan.max_users} usuário${plan.max_users !== 1 ? "s" : ""}`}
                        {plan.max_workspaces !== -1 && ` · ${plan.max_workspaces} workspace${plan.max_workspaces !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    {!isCurrent && (
                      <button
                        onClick={() => checkoutMutation.mutate(plan.id)}
                        disabled={checkoutMutation.isPending}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all disabled:opacity-40"
                        style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,106,0.18)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,212,106,0.1)"; }}
                      >
                        {checkoutMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                        Selecionar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {!isFreePlan && (
          <div className="rounded-xl p-3.5" style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)" }}>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              Para cancelar sua assinatura, entre em contato com o suporte ou acesse o portal do cliente Stripe.
            </p>
          </div>
        )}
      </div>
    </SectionWrap>
  );
}

// ─── Profile Section ──────────────────────────────────────────────────────────
function ProfileSection({ session, update, t }: {
  session: ReturnType<typeof useSession>["data"];
  update: ReturnType<typeof useSession>["update"];
  t: (k: string) => string;
}) {
  const user = session?.user;
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(
    (user as unknown as Record<string, unknown>)?.username as string || ""
  );

  const mutation = useMutation({
    mutationFn: () => authApi.updateMe({ name: name.trim() || undefined, username: username.trim() || undefined }),
    onSuccess: async (res) => {
      await update({ name: res.data.name, username: res.data.username });
      toast.success("Perfil atualizado!");
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao atualizar perfil");
    },
  });

  return (
    <SectionWrap title="Perfil" description="Atualize suas informações públicas.">
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) { toast.error("Nome é obrigatório"); return; } mutation.mutate(); }}
          className="space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(0,212,106,0.2), rgba(0,212,106,0.05))",
                       boxShadow: "inset 0 0 0 1px rgba(0,212,106,0.25)", color: "var(--green)" }}>
              {name?.[0]?.toUpperCase() || user?.name?.[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{user?.name}</p>
              <p className="text-xs" style={{ color: "var(--text-3)" }}>{user?.email}</p>
            </div>
          </div>

          <div className="space-y-4" style={{ borderTop: "1px solid var(--surface-border)", paddingTop: "20px" }}>
            <Field label="Nome completo">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="input-field w-full" placeholder="Seu nome" />
            </Field>

            <Field label="Username (opcional)" hint="Apenas letras minúsculas, números e underscore">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-3)" }}>@</span>
                <input type="text" value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  className="input-field w-full pl-7" placeholder="seuusername" />
              </div>
            </Field>

            <Field label="E-mail" hint="E-mail não pode ser alterado">
              <input type="email" value={user?.email || ""} disabled className="input-field w-full opacity-50 cursor-not-allowed" />
            </Field>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={mutation.isPending}
              className="btn-primary disabled:opacity-40">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar perfil
            </button>
          </div>
        </form>
      </Card>
    </SectionWrap>
  );
}

// ─── Security Section ─────────────────────────────────────────────────────────
function SecuritySection() {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(currentPw, newPw),
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao alterar senha");
    },
  });

  return (
    <SectionWrap title="Segurança" description="Altere sua senha de acesso.">
      <Card>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!currentPw || !newPw) { toast.error("Preencha todos os campos"); return; }
          if (newPw.length < 8) { toast.error("Nova senha deve ter ao menos 8 caracteres"); return; }
          if (newPw !== confirmPw) { toast.error("As senhas não coincidem"); return; }
          mutation.mutate();
        }} className="space-y-4">
          <Field label="Senha atual">
            <PasswordInput value={currentPw} onChange={setCurrentPw} placeholder="••••••••" />
          </Field>
          <Field label="Nova senha">
            <PasswordInput value={newPw} onChange={setNewPw} placeholder="Mínimo 8 caracteres" />
          </Field>
          <Field label="Confirmar nova senha">
            <PasswordInput value={confirmPw} onChange={setConfirmPw} placeholder="Repita a nova senha" />
            {confirmPw && newPw && confirmPw !== newPw && (
              <p className="text-[11px] mt-1 text-red-400">As senhas não coincidem</p>
            )}
          </Field>
          <div className="flex justify-end pt-1">
            <button type="submit"
              disabled={mutation.isPending || !currentPw || !newPw || newPw !== confirmPw}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa" }}
              onMouseEnter={e => { if (!mutation.isPending) e.currentTarget.style.background = "rgba(96,165,250,0.16)"; }}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(96,165,250,0.1)")}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Alterar senha
            </button>
          </div>
        </form>
      </Card>
    </SectionWrap>
  );
}

// ─── Preferences Section ──────────────────────────────────────────────────────
function PreferencesSection({ t }: { t: (k: string) => string }) {
  const { language, theme, timezone, setLanguage, setTheme, setTimezone } = usePreferences();

  return (
    <SectionWrap title={t("settings_preferences")} description={t("settings_preferences_desc")}>
      <div className="space-y-4">
        <Card>
          <div className="space-y-5">
            <Field label={t("settings_language")}>
              <div className="flex gap-2">
                {LANGS.map(({ value, label, flag }) => (
                  <button key={value} type="button" onClick={() => setLanguage(value)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all"
                    style={language === value
                      ? { background: "var(--green-dim)", borderColor: "var(--green-border)", color: "var(--green)" }
                      : { background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-2)" }
                    }>
                    <span>{flag}</span>
                    <span className="text-xs">{label}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("settings_theme")}>
              <div className="flex gap-2">
                <ThemeBtn value="dark"   current={theme} icon={Moon}    label={t("settings_theme_dark")}   onSelect={setTheme} />
                <ThemeBtn value="light"  current={theme} icon={Sun}     label={t("settings_theme_light")}  onSelect={setTheme} />
                <ThemeBtn value="system" current={theme} icon={Monitor} label={t("settings_theme_system")} onSelect={setTheme} />
              </div>
            </Field>

            <Field label={t("settings_timezone")}>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--text-3)" }} />
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input-field w-full pl-9">
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                {t("timezone_label")}: <span className="font-mono">{timezone}</span>
              </p>
            </Field>
          </div>
        </Card>

        <div className="flex justify-end">
          <button onClick={() => toast.success(t("settings_saved"))}
            className="btn-primary">
            <Globe className="w-4 h-4" />
            {t("settings_save")}
          </button>
        </div>
      </div>
    </SectionWrap>
  );
}

// ─── Account Info Section ─────────────────────────────────────────────────────
function AccountSection({ session }: { session: ReturnType<typeof useSession>["data"] }) {
  const user = session?.user;
  const planName = (user as unknown as Record<string, unknown>)?.plan
    ? ((user as unknown as Record<string, unknown>).plan as { name?: string })?.name || "Free"
    : "Free";

  const rows = [
    { label: "ID da conta",  value: user?.id || "—" },
    { label: "E-mail",       value: user?.email || "—" },
    { label: "Plano",        value: planName },
    { label: "Função",       value: user?.role === "super_admin" ? "Super Admin" : user?.role === "customer" ? "Cliente" : "—" },
  ];

  return (
    <SectionWrap title="Conta" description="Informações da sua conta.">
      <Card>
        <div className="divide-y" style={{ borderColor: "var(--surface-border)" }}>
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <span className="text-xs" style={{ color: "var(--text-3)" }}>{label}</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-2)" }}>{value}</span>
            </div>
          ))}
        </div>
      </Card>
    </SectionWrap>
  );
}

// ─── Invite Section ────────────────────────────────────────────────────────────
function InviteSection() {
  const [codes, setCodes] = useState<Array<{ id: string; code: string; link: string; used_by?: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [inviteEnabled, setInviteEnabled] = useState(false);
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  const getToken = async () => {
    const { getSession } = await import("next-auth/react");
    const session = await getSession();
    return (session as unknown as { accessToken?: string })?.accessToken || "";
  };

  const loadCodes = async () => {
    setLoading(true);
    try {
      const t = await getToken();
      const [statusRes, codesRes] = await Promise.all([
        fetch(`${API_BASE}/invites/status`),
        fetch(`${API_BASE}/invites/mine`, { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      const status = await statusRes.json();
      const myCodes = await codesRes.json();
      setInviteEnabled(status.enabled);
      setCodes(Array.isArray(myCodes) ? myCodes : []);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCodes(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const t = await getToken();
      const res = await fetch(`${API_BASE}/invites/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        toast.success("Código gerado!");
        loadCodes();
      }
    } catch {
      toast.error("Erro ao gerar código");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success("Link copiado!");
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Código copiado!");
  };

  return (
    <SectionWrap title="Convites" description="Gere códigos de convite e indique novos usuários">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Seus códigos de convite</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {inviteEnabled
                ? "Compartilhe o código ou link para que novos usuários possam se cadastrar"
                : "Gere códigos para indicar novos usuários"}
            </p>
          </div>
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: "var(--green)", color: "#03170a" }}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
            Gerar código
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
          </div>
        ) : codes.length === 0 ? (
          <div className="text-center py-8">
            <Ticket className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-3)" }} />
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Nenhum código gerado ainda</p>
          </div>
        ) : (
          <div className="space-y-2">
            {codes.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-sm font-mono font-bold shrink-0" style={{ color: "var(--green)" }}>{c.code}</code>
                  {c.used_by ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Usado</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,106,0.1)", color: "var(--green)" }}>Disponível</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => copyCode(c.code)} title="Copiar código"
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5" style={{ color: "var(--text-3)" }}>
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => copyLink(c.link)} title="Copiar link"
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5" style={{ color: "var(--text-3)" }}>
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </SectionWrap>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: session, update } = useSession();
  const { t } = usePreferences();
  const [active, setActive] = useState<Section>("billing");

  const activeSection = SECTIONS.find(s => s.id === active)!;

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>
          {t("settings_title")}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
          {t("settings_desc")}
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Submenu sidebar ── */}
        <aside className="w-52 flex-shrink-0 sticky top-0">
          <nav className="rounded-2xl overflow-hidden" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            {SECTIONS.map((section, i) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActive(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all duration-150 relative",
                    i < SECTIONS.length - 1 ? "border-b" : ""
                  )}
                  style={{
                    borderColor: "var(--surface-border)",
                    background: isActive ? "var(--green-dim)" : "transparent",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--surface-3)"; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                      style={{ background: "var(--green)" }} />
                  )}
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isActive ? "rgba(0,212,106,0.15)" : "var(--surface-3)",
                      border: `1px solid ${isActive ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                    }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: isActive ? "var(--green)" : "var(--text-3)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate" style={{ color: isActive ? "var(--green)" : "var(--text-1)" }}>
                      {section.label}
                    </p>
                    <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--text-3)" }}>
                      {section.description}
                    </p>
                  </div>
                  <ChevronRight className="w-3 h-3 flex-shrink-0 transition-transform"
                    style={{ color: isActive ? "var(--green)" : "var(--text-3)", transform: isActive ? "translateX(1px)" : "none" }} />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Content area ── */}
        <div className="flex-1 min-w-0">
          {active === "billing"     && <BillingSection session={session} />}
          {active === "profile"     && <ProfileSection session={session} update={update} t={t} />}
          {active === "security"    && <SecuritySection />}
          {active === "preferences" && <PreferencesSection t={t} />}
          {active === "invites"     && <InviteSection />}
          {active === "account"     && <AccountSection session={session} />}
        </div>
      </div>
    </div>
  );
}
