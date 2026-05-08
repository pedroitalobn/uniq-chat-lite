"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { authApi, plansApi, workspacesApi } from "@/lib/api";
import { usePreferences, type Language, type ThemeMode } from "@/lib/preferences";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import {
  User, Lock, Check, Loader2, Eye, EyeOff, Globe, Sun, Moon, Monitor,
  Clock, CreditCard, Zap, ArrowRight, Star, Info, ChevronRight, Ticket, Copy, Link2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Plan } from "@/types";
import { AnimatedTabContent } from "@/components/ui/AnimatedTabContent";
import { TimezonePicker } from "@/components/ui/TimezonePicker";

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
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>{title}</h2>
        {description && <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-6" style={{
      background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "20px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.10)",
    }}>
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
                <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Plano {currentPlanName}</p>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>
                  {currentPlan?.price === 0 || !currentPlan ? "Gratuito" : `R$ ${currentPlan.price}/mês`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusInfo && (
                <span className="text-[10px] font-medium px-2.5 py-1 rounded-full"
                  style={{ background: statusInfo.bg, color: statusInfo.color, border: `1px solid ${statusInfo.color}30` }}>
                  {statusInfo.label}
                </span>
              )}
              {subscription?.cancel_at_period_end && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}>
                  Cancela ao fim do período
                </span>
              )}
            </div>
          </div>

          {currentPlan && (
            <div className="flex items-center gap-6 mt-5 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              {[
                { label: "Instâncias", value: currentPlan.max_instances === -1 ? "∞" : currentPlan.max_instances },
                { label: "Msgs/dia", value: currentPlan.max_messages_per_day === -1 ? "∞" : currentPlan.max_messages_per_day.toLocaleString("pt-BR") },
                { label: "Usuários", value: currentPlan.max_users === -1 ? "∞" : currentPlan.max_users },
                { label: "Workspaces", value: currentPlan.max_workspaces === -1 ? "∞" : currentPlan.max_workspaces },
                { label: "Proxy", value: currentPlan.allow_proxy ? "Ativo" : "Inativo", colored: currentPlan.allow_proxy },
              ].map(({ label, value, colored }, i, arr) => (
                <div key={label} className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: colored ? "#60a5fa" : "var(--text-1)" }}>{value}</p>
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
          <p className="text-xs font-medium mb-4" style={{ color: "var(--text-3)" }}>PLANOS DISPONÍVEIS</p>
          {plansLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
          ) : (
            <div className="space-y-2">
              {plans.map((plan) => {
                const isCurrent = plan.name.toLowerCase() === currentPlanName.toLowerCase();
                return (
                  <div key={plan.id}
                    className="rounded-xl p-3.5 flex items-center justify-between"
                    style={{
                      background: isCurrent ? "rgba(0,212,106,0.07)" : "rgba(255,255,255,0.03)",
                      border: isCurrent ? "1px solid rgba(0,212,106,0.20)" : "1px solid rgba(255,255,255,0.07)",
                      backdropFilter: "blur(8px)",
                      transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                    }}>
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2" style={{ color: isCurrent ? "var(--green)" : "var(--text-1)" }}>
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
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl disabled:opacity-40"
                        style={{
                          background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
                          backdropFilter: "blur(12px)",
                          border: "1px solid rgba(0,212,106,0.30)",
                          boxShadow: "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
                          color: "var(--green)",
                          transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.transform = "translateY(-1px)";
                          e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,212,106,0.28), inset 0 1px 0 rgba(255,255,255,0.16)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.transform = "translateY(0)";
                          e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)";
                        }}
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

  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => authApi.updateMe({ name: name.trim() || undefined, username: username.trim() || undefined }),
    onSuccess: async (res) => {
      // Sync next-auth session com os novos campos.
      await update({ name: res.data.name, username: res.data.username });
      // Invalida o cache react-query do /v1/auth/session usado pelo
      // LayoutClient — sem isso a UI continuava mostrando os dados
      // antigos até o user fazer logout/login. Outros componentes que
      // dependem de session via useQuery agora veem o valor novo.
      await qc.invalidateQueries({ queryKey: ["session"] });
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
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(0,212,106,0.2), rgba(0,212,106,0.05))",
                       boxShadow: "inset 0 0 0 1px rgba(0,212,106,0.25)", color: "var(--green)" }}>
              {name?.[0]?.toUpperCase() || user?.name?.[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{user?.name}</p>
              <p className="text-xs" style={{ color: "var(--text-3)" }}>{user?.email}</p>
            </div>
          </div>

          <div className="space-y-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px" }}>
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
    <SectionWrap title="Segurança" description="Altere sua senha e ative autenticação em duas etapas.">
      <TwoFactorCard />
      <div className="h-4" />
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, rgba(96,165,250,0.15), rgba(96,165,250,0.06))",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(96,165,250,0.25)",
                boxShadow: "0 4px 16px rgba(96,165,250,0.12), inset 0 1px 0 rgba(255,255,255,0.10)",
                color: "#60a5fa",
                transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
              }}
              onMouseEnter={e => {
                if (!mutation.isPending) {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(96,165,250,0.22), inset 0 1px 0 rgba(255,255,255,0.14)";
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(96,165,250,0.12), inset 0 1px 0 rgba(255,255,255,0.10)";
              }}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Alterar senha
            </button>
          </div>
        </form>
      </Card>
    </SectionWrap>
  );
}

// ─── 2FA Card ─────────────────────────────────────────────────────────────────
function TwoFactorCard() {
  const { data: session, update } = useSession();
  const totpEnabled = !!(session?.user as { totp_enabled_at?: string } | undefined)?.totp_enabled_at;

  const [step, setStep] = useState<"idle" | "setup" | "verify" | "backup" | "disable">("idle");
  const [qrDataURL, setQrDataURL] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const setupMut = useMutation({
    mutationFn: () => authApi.setup2FA(),
    onSuccess: async (res: { data: { secret: string; otpauth_url: string } }) => {
      setSecret(res.data.secret);
      const dataURL = await QRCode.toDataURL(res.data.otpauth_url, { width: 200, margin: 1 });
      setQrDataURL(dataURL);
      setStep("setup");
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao iniciar 2FA");
    },
  });

  const enableMut = useMutation({
    mutationFn: () => authApi.enable2FA(code),
    onSuccess: (res: { data: { backup_codes: string[] } }) => {
      setBackupCodes(res.data.backup_codes);
      setStep("backup");
      setCode("");
      update();
    },
    onError: () => toast.error("Código inválido"),
  });

  const disableMut = useMutation({
    mutationFn: () => authApi.disable2FA(code),
    onSuccess: () => {
      toast.success("2FA desativado");
      setStep("idle");
      setCode("");
      update();
    },
    onError: () => toast.error("Código inválido"),
  });

  const copyAll = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success("Códigos copiados");
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-1)" }}>
            <Lock className="w-4 h-4" /> Autenticação em duas etapas
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            {totpEnabled
              ? "Ativa. Sua conta exige um código TOTP no login."
              : "Adicione uma camada extra de segurança usando Google Authenticator, Authy ou 1Password."}
          </p>
        </div>
        {totpEnabled ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
            style={{ background: "var(--green-soft)", color: "var(--green)" }}>
            ATIVO
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
            style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
            INATIVO
          </span>
        )}
      </div>

      {step === "idle" && !totpEnabled && (
        <button onClick={() => setupMut.mutate()} disabled={setupMut.isPending}
          className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}>
          {setupMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
          Ativar 2FA
        </button>
      )}

      {step === "idle" && totpEnabled && (
        <button onClick={() => setStep("disable")}
          className="text-xs font-medium px-3 py-2 rounded-lg"
          style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
          Desativar 2FA
        </button>
      )}

      {step === "setup" && (
        <div className="space-y-3 mt-2">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {qrDataURL && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataURL} alt="QR 2FA" className="rounded-lg border" style={{ borderColor: "var(--surface-border)" }} />
            )}
            <div className="flex-1">
              <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                Escaneie o QR no app autenticador, ou cole este segredo manualmente:
              </p>
              <code className="text-[11px] block p-2 rounded-md font-mono break-all"
                style={{ background: "var(--surface-3)", color: "var(--text-1)" }}>
                {secret}
              </code>
            </div>
          </div>
          <Field label="Digite o código gerado pelo app">
            <input type="text" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input-field tracking-widest text-center text-lg font-mono"
              placeholder="000000" />
          </Field>
          <div className="flex gap-2">
            <button onClick={() => setStep("idle")} className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>Cancelar</button>
            <button onClick={() => enableMut.mutate()} disabled={code.length !== 6 || enableMut.isPending}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-40"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}>
              {enableMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Confirmar e ativar
            </button>
          </div>
        </div>
      )}

      {step === "backup" && (
        <div className="space-y-3 mt-2">
          <div className="rounded-lg p-3" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <p className="text-xs font-medium mb-1" style={{ color: "#f59e0b" }}>⚠️ Guarde estes códigos AGORA</p>
            <p className="text-[11px]" style={{ color: "var(--text-2)" }}>
              São 10 códigos de uso único. Cada um pode substituir o app autenticador caso você perca o acesso. Não serão mostrados novamente.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs p-3 rounded-lg"
            style={{ background: "var(--surface-3)" }}>
            {backupCodes.map((c, i) => (
              <span key={i} style={{ color: "var(--text-1)" }}>{c}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={copyAll} className="text-xs px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              <Copy className="w-3.5 h-3.5" /> Copiar todos
            </button>
            <button onClick={() => setStep("idle")}
              className="text-xs font-medium px-3 py-2 rounded-lg"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}>
              Já guardei, fechar
            </button>
          </div>
        </div>
      )}

      {step === "disable" && (
        <div className="space-y-3 mt-2">
          <Field label="Digite o código atual pra confirmar">
            <input type="text" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input-field tracking-widest text-center text-lg font-mono"
              placeholder="000000" />
          </Field>
          <div className="flex gap-2">
            <button onClick={() => { setStep("idle"); setCode(""); }} className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>Cancelar</button>
            <button onClick={() => disableMut.mutate()} disabled={code.length !== 6 || disableMut.isPending}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-40"
              style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
              Desativar
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Preferences Section ──────────────────────────────────────────────────────
function PreferencesSection({ t }: { t: (k: string) => string }) {
  const { language, theme, timezone, setLanguage, setTheme, setTimezone } = usePreferences();
  const { currentWorkspace } = useWorkspace();
  const { isOwner, isSuperAdmin, hasPerm } = useWorkspacePermissions();
  const canEditWorkspace = isOwner || isSuperAdmin || hasPerm("workspaces:manage");
  // Espelho do timezone do workspace pra exibir/alterar daqui (em vez de
  // forçar o user a achar /workspace/[id]/messaging). É o valor que o
  // scheduler de campanhas, freqcap e quiet hours usam.
  const wsTimezone = (currentWorkspace as unknown as { timezone?: string } | null)?.timezone ?? "America/Sao_Paulo";
  const [pendingWsTz, setPendingWsTz] = useState<string>(wsTimezone);

  // Sincroniza quando o workspace ativo muda.
  useEffect(() => {
    setPendingWsTz(wsTimezone);
  }, [wsTimezone]);

  const saveWsTz = useMutation({
    mutationFn: () => {
      if (!currentWorkspace?.id) throw new Error("Sem workspace ativo");
      return workspacesApi.update(currentWorkspace.id, { timezone: pendingWsTz });
    },
    onSuccess: () => toast.success("Timezone do workspace atualizado"),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Erro ao salvar timezone do workspace";
      toast.error(msg);
    },
  });

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

            <Field label={`${t("settings_timezone")} (exibição)`}>
              <TimezonePicker value={timezone} onChange={setTimezone} />
              <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                Aplicado só na sua interface (datas, horários listados). Não afeta agendamento de campanhas.
              </p>
            </Field>

            {currentWorkspace && (
              <Field label="Timezone do workspace (agendamentos)">
                {canEditWorkspace ? (
                  <TimezonePicker value={pendingWsTz} onChange={setPendingWsTz} />
                ) : (
                  <div className="relative opacity-60">
                    <TimezonePicker value={pendingWsTz} onChange={() => {}} />
                  </div>
                )}
                <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                  Usado por <strong>campanhas</strong> (janelas <span className="font-mono">schedule_hours</span>),
                  <strong> frequency caps</strong> e <strong>quiet hours</strong>. Busque pela cidade — ex: Orlando vira <span className="font-mono">America/New_York</span>.
                </p>
                {canEditWorkspace && pendingWsTz !== wsTimezone && (
                  <button
                    type="button"
                    onClick={() => saveWsTz.mutate()}
                    disabled={saveWsTz.isPending}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--green)", color: "#03170a" }}
                  >
                    {saveWsTz.isPending ? "Salvando…" : `Salvar como timezone do workspace`}
                  </button>
                )}
                {!canEditWorkspace && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                    Só dono ou admin do workspace pode alterar.
                  </p>
                )}
              </Field>
            )}
          </div>
        </Card>
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
        <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
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
  const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "https://api.uniq.chat") + "/v1";

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
            <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Seus códigos de convite</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {inviteEnabled
                ? "Compartilhe o código ou link para que novos usuários possam se cadastrar"
                : "Gere códigos para indicar novos usuários"}
            </p>
          </div>
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(0,212,106,0.30)",
              boxShadow: "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
              color: "var(--green)",
              transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,212,106,0.28), inset 0 1px 0 rgba(255,255,255,0.16)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)";
            }}>
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
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  backdropFilter: "blur(8px)",
                  transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                }}>
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-sm font-mono font-semibold shrink-0" style={{ color: "var(--green)" }}>{c.code}</code>
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
    <div className="max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
          {t("settings_title")}
        </h1>
        <p className="text-sm mt-1 hidden sm:block" style={{ color: "var(--text-3)" }}>
          {t("settings_desc")}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
        {/* ── Submenu sidebar - hidden on mobile, tabs visible on mobile ── */}
        {/* Mobile tabs */}
        <div className="sm:hidden flex gap-1 p-1 rounded-xl w-full" style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.20)",
        }}>
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button key={section.id} onClick={() => setActive(section.id)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium"
                style={{
                  background: isActive ? "rgba(0,212,106,0.15)" : "transparent",
                  color: isActive ? "var(--green)" : "var(--text-3)",
                  transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                }}>
                <Icon className="w-3.5 h-3.5" />
                <span className="truncate">{section.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden sm:flex w-44 lg:w-52 flex-shrink-0 sticky top-0">
          <nav className="rounded-2xl overflow-hidden w-full" style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
            backdropFilter: "blur(16px) saturate(180%)",
            WebkitBackdropFilter: "blur(16px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.10)",
          }}>
            {SECTIONS.map((section, i) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActive(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 lg:px-4 py-3 lg:py-3.5 text-left relative",
                    i < SECTIONS.length - 1 ? "border-b" : ""
                  )}
                  style={{
                    borderColor: "rgba(255,255,255,0.06)",
                    background: isActive ? "rgba(0,212,106,0.10)" : "transparent",
                    transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
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
                    <p className="text-xs font-medium truncate" style={{ color: isActive ? "var(--green)" : "var(--text-1)" }}>
                      {section.label}
                    </p>
                    <p className="text-[10px] truncate mt-0.5 hidden lg:block" style={{ color: "var(--text-3)" }}>
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
          <AnimatedTabContent tabKey={active}>
            {active === "billing"     && <BillingSection session={session} />}
            {active === "profile"     && <ProfileSection session={session} update={update} t={t} />}
            {active === "security"    && <SecuritySection />}
            {active === "preferences" && <PreferencesSection t={t} />}
            {active === "invites"     && <InviteSection />}
            {active === "account"     && <AccountSection session={session} />}
          </AnimatedTabContent>
        </div>
      </div>
    </div>
  );
}
