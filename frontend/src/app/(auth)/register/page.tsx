"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye, EyeOff, AlertCircle, ArrowRight, Loader2,
  User, Lock, Mail, AtSign, ChevronLeft, Zap, Building2, MessageSquare,
  Flame, Star, Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import api from "@/lib/api";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/v1";

function getPlanMeta(plan: { name: string; price: number } | null) {
  if (!plan) return { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "#60a5fa", label: "Grátis" };
  const price = plan.price;
  if (price === 0) return { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "#60a5fa", label: "Grátis" };
  if (price < 50) return { icon: <Flame className="w-3.5 h-3.5" />, color: "#fb923c", label: `R$${price}/mês` };
  if (price < 120) return { icon: <Zap className="w-3.5 h-3.5" />, color: "#00d46a", label: `R$${price}/mês` };
  return { icon: <Building2 className="w-3.5 h-3.5" />, color: "#a78bfa", label: `R$${price}/mês` };
}

function Field({
  label, value, onChange, type = "text", placeholder, icon, error, autoFocus, autoComplete, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; icon?: React.ReactNode;
  error?: string; autoFocus?: boolean; autoComplete?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (show ? "text" : "password") : type;

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium block" style={{ color: "hsl(240 8% 58%)" }}>{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "hsl(240 8% 36%)" }}>{icon}</span>
        )}
        <input
          type={inputType}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          disabled={disabled}
          readOnly={disabled}
          className={cn(
            "w-full rounded-xl py-2.5 text-sm outline-none transition-all duration-150",
            icon ? "pl-9 pr-10" : "px-3.5",
            !icon && isPassword ? "pl-3.5 pr-10" : "",
            error ? "ring-1 ring-red-500/30" : "focus:ring-1 focus:ring-white/10",
            disabled ? "cursor-not-allowed opacity-80" : "",
          )}
          style={{
            background: disabled ? "hsl(240 12% 6%)" : "hsl(240 12% 8%)",
            border: error ? "1px solid rgba(239,68,68,0.35)" : "1px solid hsl(240 12% 13%)",
            color: "hsl(240 15% 90%)",
          }}
          onFocus={e => !error && !disabled && (e.currentTarget.style.borderColor = "hsl(240 12% 22%)")}
          onBlur={e => !error && (e.currentTarget.style.borderColor = "hsl(240 12% 13%)")}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(240 8% 38%)" }}>
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs flex items-center gap-1.5 text-red-400">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const planName = params.get("plan") || "Free";
  const planId   = params.get("plan_id") || "";
  const planPrice = parseFloat(params.get("price") || "0");
  const inviteFromUrl = params.get("invite") || "";
  // workspace_invite — token vindo do email de convite. Quando presente,
  // o cadastro entra direto no workspace convidado (sem criar novo).
  const workspaceInviteToken = params.get("workspace_invite") || "";
  const emailFromInvite = params.get("email") || "";
  const isPaidPlan = planPrice > 0 && !workspaceInviteToken;

  const meta = getPlanMeta(planPrice > 0 ? { name: planName, price: planPrice } : { name: "Free", price: 0 });

  const [name, setName]         = useState("");
  const [email, setEmail]       = useState(emailFromInvite);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [loading, setLoading]   = useState(false);
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [inviteEnabled, setInviteEnabled] = useState(false);
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);

  // Preview do convite pra mostrar "você foi convidado pra X por Y" no topo.
  const [wsInvitePreview, setWsInvitePreview] = useState<{
    workspace_name: string;
    inviter_name: string;
    role_name: string;
  } | null>(null);
  useEffect(() => {
    if (!workspaceInviteToken) return;
    fetch(`${API_BASE}/workspaces/invites/preview/${encodeURIComponent(workspaceInviteToken)}`)
      .then(r => r.json())
      .then(d => {
        if (d.workspace_name) {
          setWsInvitePreview({
            workspace_name: d.workspace_name,
            inviter_name: d.inviter_name,
            role_name: d.role_name,
          });
          if (d.email) setEmail(d.email);
        }
      })
      .catch(() => {});
  }, [workspaceInviteToken]);

  useEffect(() => {
    fetch(`${API_BASE}/invites/status`)
      .then(r => r.json())
      .then(d => setInviteEnabled(d.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (inviteCode.trim().length >= 6) {
      fetch(`${API_BASE}/invites/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim() }),
      })
        .then(r => r.json())
        .then(d => setInviteValid(d.valid))
        .catch(() => setInviteValid(null));
    } else {
      setInviteValid(null);
    }
  }, [inviteCode]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Nome é obrigatório";
    if (!email.trim()) e.email = "E-mail é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "E-mail inválido";
    if (password.length < 8) e.password = "Mínimo 8 caracteres";
    if (password !== confirm) e.confirm = "Senhas não conferem";
    if (inviteEnabled && !inviteCode.trim()) e.invite_code = "Código de convite é obrigatório";
    if (inviteEnabled && inviteCode.trim() && inviteValid === false) e.invite_code = "Código de convite inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    try {
      // 1. Create account (or lead for paid plans)
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          username: username.trim() || undefined,
          password,
          workspace_name: workspaceInviteToken ? undefined : workspaceName.trim() || undefined,
          invite_code: inviteCode.trim() || undefined,
          plan_id: workspaceInviteToken ? undefined : planId || undefined,
          workspace_invite_token: workspaceInviteToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors({ global: data.error || "Erro ao criar conta" });
        return;
      }

      // 2. If paid plan, redirect to payment
      if (isPaidPlan && planId) {
        if (data.checkout_type === "transparent" && data.client_secret) {
          // Transparent checkout - redirect to checkout page with client secret
          router.push(`/checkout?client_secret=${encodeURIComponent(data.client_secret)}&lead_id=${data.lead_id}&plan_name=${encodeURIComponent(data.plan_name || "")}&plan_price=${data.plan_price}`);
          return;
        } else if (data.url) {
          // Redirect checkout
          window.location.href = data.url;
          return;
        }
      }

      // 3. Free plan - Auto sign-in
      const result = await signIn("credentials", {
        identifier: email.trim(),
        password,
        redirect: false,
      });
      if (result?.error) {
        setErrors({ global: result.error });
        return;
      }

      if (workspaceInviteToken) {
        toast.success(
          wsInvitePreview
            ? `Conta criada! Você já faz parte de ${wsInvitePreview.workspace_name}.`
            : "Conta criada! Você já faz parte do workspace.",
        );
        router.push("/inbox");
      } else {
        toast.success("Conta criada! Bem-vindo à Uniq.chat!");
        router.push("/instances");
      }
      router.refresh();
    } catch {
      setErrors({ global: "Erro de conexão" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "hsl(240 20% 4%)" }}>
      {/* Ambient glow */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] pointer-events-none"
        style={{ background: `radial-gradient(ellipse at bottom, ${meta.color}08 0%, transparent 70%)` }} />

      <div className="w-full max-w-sm relative animate-fade-in-up">
        {/* Back — só mostra quando NÃO veio de um workspace invite */}
        {!workspaceInviteToken && (
          <button onClick={() => router.push("/plans")}
            className="flex items-center gap-1.5 text-xs mb-6 transition-colors"
            style={{ color: "hsl(240 8% 42%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 75%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 42%)")}>
            <ChevronLeft className="w-3.5 h-3.5" />
            Voltar aos planos
          </button>
        )}

        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <Logo height={40} className="mb-3" />
        </div>

        {/* Workspace invite banner — substitui o plan badge quando aceita convite */}
        {workspaceInviteToken ? (
          <div
            className="mb-5 rounded-2xl p-4"
            style={{ background: "rgba(0,212,106,0.05)", border: "1px solid rgba(0,212,106,0.2)" }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Building2 className="w-3.5 h-3.5" style={{ color: "#00d46a" }} />
              <span className="text-xs font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
                {wsInvitePreview?.workspace_name || "Convite para workspace"}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "hsl(240 8% 58%)" }}>
              {wsInvitePreview ? (
                <>
                  <strong style={{ color: "hsl(240 15% 82%)" }}>{wsInvitePreview.inviter_name}</strong> convidou
                  você como{" "}
                  <span style={{ color: "#a5b4fc" }}>{wsInvitePreview.role_name}</span>.
                  Conclua o cadastro pra entrar.
                </>
              ) : (
                "Conclua o cadastro pra entrar no workspace."
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center mb-5">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold"
              style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}30` }}>
              <span style={{ color: meta.color }}>{meta.icon}</span>
              Plano {planName} — {meta.label}
            </div>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl overflow-hidden"
          style={{
            background: "hsl(240 18% 6%)",
            boxShadow: "0 0 0 1px hsl(240 12% 13%), 0 24px 64px rgba(0,0,0,0.5)",
          }}>
          <div className="px-5 pt-5 pb-1">
            <h2 className="text-base font-bold" style={{ color: "hsl(240 15% 90%)" }}>
              {workspaceInviteToken ? "Crie sua conta para entrar" : "Criar sua conta"}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 44%)" }}>
              {workspaceInviteToken
                ? "Seu email já foi preenchido a partir do convite."
                : "Preencha os dados abaixo para começar"}
            </p>
          </div>

          <form onSubmit={submit} className="p-5 space-y-3.5">
            {errors.global && (
              <div className="rounded-xl px-3.5 py-2.5 flex items-center gap-2"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-400">{errors.global}</p>
              </div>
            )}

            <Field label="Nome completo" value={name}
              onChange={v => { setName(v); setErrors(p => ({ ...p, name: "" })); }}
              placeholder="João Silva" icon={<User className="w-3.5 h-3.5" />}
              autoFocus autoComplete="name" error={errors.name} />

            <Field
              label={workspaceInviteToken ? "E-mail (do convite)" : "E-mail"}
              value={email}
              onChange={v => { setEmail(v); setErrors(p => ({ ...p, email: "" })); }}
              placeholder="seu@email.com"
              icon={<Mail className="w-3.5 h-3.5" />}
              autoComplete="email"
              error={errors.email}
              disabled={!!workspaceInviteToken}
            />

            <Field label="Username (opcional)" value={username} onChange={setUsername}
              placeholder="@joaosilva" icon={<AtSign className="w-3.5 h-3.5" />}
              autoComplete="username" />

            <Field label="Senha" value={password}
              onChange={v => { setPassword(v); setErrors(p => ({ ...p, password: "" })); }}
              type="password" placeholder="Mínimo 8 caracteres"
              icon={<Lock className="w-3.5 h-3.5" />}
              autoComplete="new-password" error={errors.password} />

            <Field label="Confirmar senha" value={confirm}
              onChange={v => { setConfirm(v); setErrors(p => ({ ...p, confirm: "" })); }}
              type="password" placeholder="Repita a senha"
              icon={<Lock className="w-3.5 h-3.5" />}
              autoComplete="new-password" error={errors.confirm} />

            {!workspaceInviteToken && (
              <Field label="Nome da empresa (opcional)" value={workspaceName}
                onChange={v => { setWorkspaceName(v); setErrors(p => ({ ...p, workspace: "" })); }}
                placeholder="Minha Empresa"
                icon={<Building2 className="w-3.5 h-3.5" />}
                autoComplete="organization" />
            )}

            {inviteEnabled && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium block" style={{ color: "hsl(240 8% 58%)" }}>
                  Código de convite *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "hsl(240 8% 36%)" }}>
                    <Ticket className="w-3.5 h-3.5" />
                  </span>
                  <input
                    value={inviteCode}
                    onChange={e => { setInviteCode(e.target.value); setErrors(p => ({ ...p, invite_code: "" })); }}
                    placeholder="Código do convite"
                    className={cn(
                      "w-full rounded-xl py-2.5 pl-9 pr-10 text-sm outline-none transition-all duration-150",
                      errors.invite_code ? "ring-1 ring-red-500/30" : "focus:ring-1 focus:ring-white/10"
                    )}
                    style={{
                      background: "hsl(240 12% 8%)",
                      border: errors.invite_code ? "1px solid rgba(239,68,68,0.35)" : "1px solid hsl(240 12% 13%)",
                      color: "hsl(240 15% 90%)",
                    }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {inviteValid === true && <span className="text-green-400 text-xs font-medium">Válido</span>}
                    {inviteValid === false && <span className="text-red-400 text-xs font-medium">Inválido</span>}
                    {inviteCode.trim().length >= 6 && inviteValid === null && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(240 8% 40%)" }} />}
                  </span>
                </div>
                {errors.invite_code && (
                  <p className="text-xs flex items-center gap-1.5 text-red-400">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.invite_code}
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-40 mt-1"
              style={{ background: meta.color, color: !isPaidPlan ? "hsl(240 15% 90%)" : "#03170a" }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>{!isPaidPlan ? "Criar conta grátis" : "Criar conta e pagar"}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-[11px] text-center mt-4" style={{ color: "hsl(240 8% 30%)" }}>
          Já tem conta?{" "}
          <span className="underline cursor-pointer" style={{ color: "hsl(240 8% 50%)" }}
            onClick={() => router.push("/login")}>
            Entrar
          </span>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
