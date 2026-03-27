"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Eye, EyeOff, AlertCircle, ArrowRight,
  Loader2, User, Lock, Mail, AtSign,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

type Tab = "login" | "register";
type Lang = "pt" | "en" | "es";

const LOGIN_TR = {
  pt: {
    tab_login: "Entrar", tab_register: "Criar conta",
    divider_login: "ou entre com", divider_register: "ou crie com",
    footer: "Ao continuar você concorda com nossos", terms: "Termos de Uso",
    label_identifier: "Email ou username", ph_identifier: "seu@email.com ou @username",
    label_password: "Senha", ph_password: "Sua senha",
    btn_login: "Entrar", welcome: "Bem-vindo de volta!",
    label_name: "Nome completo", ph_name: "João Silva",
    label_email: "E-mail", ph_email: "seu@email.com",
    label_username: "Username (opcional)", ph_username: "@joaosilva",
    label_newpass: "Senha", ph_newpass: "Mínimo 8 caracteres",
    label_confirm: "Confirmar senha", ph_confirm: "Repita a senha",
    btn_register: "Criar conta",
    err_name: "Nome é obrigatório", err_email: "E-mail é obrigatório",
    err_email_invalid: "E-mail inválido", err_pass_min: "Mínimo 8 caracteres",
    err_pass_match: "Senhas não conferem",
  },
  en: {
    tab_login: "Sign in", tab_register: "Create account",
    divider_login: "or sign in with", divider_register: "or sign up with",
    footer: "By continuing you agree to our", terms: "Terms of Use",
    label_identifier: "Email or username", ph_identifier: "you@email.com or @username",
    label_password: "Password", ph_password: "Your password",
    btn_login: "Sign in", welcome: "Welcome back!",
    label_name: "Full name", ph_name: "John Smith",
    label_email: "Email", ph_email: "you@email.com",
    label_username: "Username (optional)", ph_username: "@johnsmith",
    label_newpass: "Password", ph_newpass: "At least 8 characters",
    label_confirm: "Confirm password", ph_confirm: "Repeat your password",
    btn_register: "Create account",
    err_name: "Name is required", err_email: "Email is required",
    err_email_invalid: "Invalid email", err_pass_min: "At least 8 characters",
    err_pass_match: "Passwords don't match",
  },
  es: {
    tab_login: "Iniciar sesión", tab_register: "Crear cuenta",
    divider_login: "o entra con", divider_register: "o regístrate con",
    footer: "Al continuar aceptas nuestros", terms: "Términos de Uso",
    label_identifier: "Email o usuario", ph_identifier: "tu@email.com o @usuario",
    label_password: "Contraseña", ph_password: "Tu contraseña",
    btn_login: "Iniciar sesión", welcome: "¡Bienvenido de nuevo!",
    label_name: "Nombre completo", ph_name: "Juan García",
    label_email: "Email", ph_email: "tu@email.com",
    label_username: "Usuario (opcional)", ph_username: "@juangarcia",
    label_newpass: "Contraseña", ph_newpass: "Mínimo 8 caracteres",
    label_confirm: "Confirmar contraseña", ph_confirm: "Repite tu contraseña",
    btn_register: "Crear cuenta",
    err_name: "El nombre es obligatorio", err_email: "El email es obligatorio",
    err_email_invalid: "Email inválido", err_pass_min: "Mínimo 8 caracteres",
    err_pass_match: "Las contraseñas no coinciden",
  },
} as const;

// Map country code → language
function countryToLang(country: string): Lang {
  const pt = ["BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL"];
  const es = ["MX", "AR", "CO", "CL", "PE", "VE", "EC", "BO", "PY", "UY", "CR", "PA", "GT", "HN", "SV", "NI", "DO", "CU", "PR", "ES", "GQ"];
  if (pt.includes(country)) return "pt";
  if (es.includes(country)) return "es";
  return "en";
}

// ─── OAuth Button ─────────────────────────────────────────────────────────────
function OAuthButton({
  provider, label, icon, onClick, loading,
}: {
  provider: string; label: string; icon: React.ReactNode;
  onClick: () => void; loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex items-center justify-center gap-2.5 w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150 disabled:opacity-50"
      style={{
        background: "hsl(240 12% 8%)",
        border: "1px solid hsl(240 12% 14%)",
        color: "hsl(240 15% 75%)",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "hsl(240 12% 22%)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "hsl(240 12% 14%)")}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────
function Divider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center gap-3 my-1">
      <div className="flex-1 h-px" style={{ background: "hsl(240 12% 13%)" }} />
      <span className="text-[10px] font-semibold uppercase tracking-widest flex-shrink-0"
        style={{ color: "hsl(240 8% 32%)" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: "hsl(240 12% 13%)" }} />
    </div>
  );
}

// ─── Input Field ──────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, type = "text", placeholder, icon, error,
  autoFocus, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; icon?: React.ReactNode;
  error?: string; autoFocus?: boolean; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (show ? "text" : "password") : type;

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium block" style={{ color: "hsl(240 8% 58%)" }}>
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "hsl(240 8% 36%)" }}>
            {icon}
          </span>
        )}
        <input
          type={inputType}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className={cn(
            "w-full rounded-xl py-2.5 text-sm outline-none transition-all duration-150",
            icon ? "pl-9 pr-10" : "px-3.5",
            !icon && isPassword ? "pl-3.5 pr-10" : "",
            error ? "ring-1 ring-red-500/30" : "focus:ring-1 focus:ring-white/10"
          )}
          style={{
            background: "hsl(240 12% 8%)",
            border: error ? "1px solid rgba(239,68,68,0.35)" : "1px solid hsl(240 12% 13%)",
            color: "hsl(240 15% 90%)",
          }}
          onFocus={e => !error && (e.currentTarget.style.borderColor = "hsl(240 12% 22%)")}
          onBlur={e => !error && (e.currentTarget.style.borderColor = "hsl(240 12% 13%)")}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
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

// ─── Login Form ───────────────────────────────────────────────────────────────
function LoginForm({ onSuccess, tr }: { onSuccess: () => void; tr: (typeof LOGIN_TR)[Lang] }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      identifier: identifier.trim(),
      password: password.trim(),
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError(result.error);
    } else {
      toast.success(tr.welcome);
      onSuccess();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field
        label={tr.label_identifier}
        value={identifier}
        onChange={v => { setIdentifier(v); setError(""); }}
        placeholder={tr.ph_identifier}
        icon={<AtSign className="w-3.5 h-3.5" />}
        autoFocus
        autoComplete="username"
        error={error && !password ? error : undefined}
      />
      <Field
        label={tr.label_password}
        value={password}
        onChange={v => { setPassword(v); setError(""); }}
        type="password"
        placeholder={tr.ph_password}
        icon={<Lock className="w-3.5 h-3.5" />}
        autoComplete="current-password"
        error={error && password ? error : undefined}
      />
      {error && !(!identifier.trim() || !password.trim()) && (
        <p className="text-xs flex items-center gap-1.5 text-red-400 -mt-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading || !identifier.trim() || !password.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: "var(--green)", color: "#03170a" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
          <><span>{tr.btn_login}</span><ArrowRight className="w-4 h-4" /></>
        )}
      </button>
    </form>
  );
}

// ─── Register Form ────────────────────────────────────────────────────────────
function RegisterForm({ onSuccess, tr }: { onSuccess: () => void; tr: (typeof LOGIN_TR)[Lang] }) {
  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [errors, setErrors]       = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr.err_name;
    if (!email.trim()) e.email = tr.err_email;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = tr.err_email_invalid;
    if (password.length < 8) e.password = tr.err_pass_min;
    if (password !== confirm) e.confirm = tr.err_pass_match;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), username: username.trim() || undefined, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors({ global: data.error || "Erro ao criar conta" });
        return;
      }
      // Auto sign-in after register
      const result = await signIn("credentials", {
        identifier: email.trim(),
        password,
        redirect: false,
      });
      if (result?.error) {
        setErrors({ global: result.error });
      } else {
        toast.success("Conta criada com sucesso! Bem-vindo!");
        onSuccess();
      }
    } catch {
      setErrors({ global: "Erro de conexão" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      {errors.global && (
        <div className="rounded-xl px-3.5 py-2.5 flex items-center gap-2"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">{errors.global}</p>
        </div>
      )}
      <Field label={tr.label_name} value={name} onChange={v => { setName(v); setErrors(p => ({ ...p, name: "" })); }}
        placeholder={tr.ph_name} icon={<User className="w-3.5 h-3.5" />}
        autoFocus autoComplete="name" error={errors.name} />
      <Field label={tr.label_email} value={email} onChange={v => { setEmail(v); setErrors(p => ({ ...p, email: "" })); }}
        placeholder={tr.ph_email} icon={<Mail className="w-3.5 h-3.5" />}
        autoComplete="email" error={errors.email} />
      <Field label={tr.label_username} value={username} onChange={setUsername}
        placeholder={tr.ph_username} icon={<AtSign className="w-3.5 h-3.5" />}
        autoComplete="username" />
      <Field label={tr.label_newpass} value={password} onChange={v => { setPassword(v); setErrors(p => ({ ...p, password: "" })); }}
        type="password" placeholder={tr.ph_newpass}
        icon={<Lock className="w-3.5 h-3.5" />}
        autoComplete="new-password" error={errors.password} />
      <Field label={tr.label_confirm} value={confirm} onChange={v => { setConfirm(v); setErrors(p => ({ ...p, confirm: "" })); }}
        type="password" placeholder={tr.ph_confirm}
        icon={<Lock className="w-3.5 h-3.5" />}
        autoComplete="new-password" error={errors.confirm} />
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-40 mt-1"
        style={{ background: "var(--green)", color: "#03170a" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
          <><span>{tr.btn_register}</span><ArrowRight className="w-4 h-4" /></>
        )}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("login");
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("pt");
  const tr = LOGIN_TR[lang];

  useEffect(() => {
    fetch("https://freeipapi.com/api/json", { signal: AbortSignal.timeout(3000) })
      .then(r => r.json())
      .then(d => { if (d?.countryCode) setLang(countryToLang(d.countryCode)); })
      .catch(() => {/* keep default pt */});
  }, []);

  const onSuccess = () => {
    window.location.href = "/dashboard";
  };

  const handleTabChange = (t: Tab) => {
    if (t === "register") {
      router.push("/plans");
      return;
    }
    setTab(t);
  };

  const oauthSignIn = async (provider: string) => {
    setOauthLoading(provider);
    try {
      await signIn(provider, { callbackUrl: "/instances" });
    } catch {
      toast.error(`Erro ao autenticar com ${provider}`);
    } finally {
      setOauthLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "hsl(240 20% 4%)" }}>
      {/* Ambient glow */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at bottom, rgba(0,212,106,0.05) 0%, transparent 70%)" }} />
      <div className="fixed top-0 right-0 w-[500px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at top right, rgba(96,165,250,0.03) 0%, transparent 60%)" }} />

      <div className="w-full max-w-sm relative animate-fade-in-up">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo height={71} />
        </div>

        {/* Card */}
        <div className="rounded-2xl overflow-hidden"
          style={{
            background: "hsl(240 18% 6%)",
            boxShadow: "0 0 0 1px hsl(240 12% 13%), 0 24px 64px rgba(0,0,0,0.5)",
          }}>

          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: "hsl(240 12% 11%)" }}>
            {(["login", "register"] as Tab[]).map((t) => (
              <button key={t} onClick={() => handleTabChange(t)}
                className={cn("flex-1 py-3.5 text-sm font-semibold transition-all duration-150",
                  tab === t ? "text-white" : "text-slate-500 hover:text-slate-400")}
                style={tab === t ? {
                  borderBottom: "2px solid var(--green)",
                  color: "hsl(240 15% 92%)",
                } : { borderBottom: "2px solid transparent" }}
              >
                {t === "login" ? tr.tab_login : tr.tab_register}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-5">
            {/* OAuth buttons */}
            <div className="grid grid-cols-2 gap-2">
              <OAuthButton
                provider="google" label="Google"
                icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>}
                onClick={() => oauthSignIn("google")}
                loading={oauthLoading === "google"}
              />
              <OAuthButton
                provider="github" label="GitHub"
                icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>}
                onClick={() => oauthSignIn("github")}
                loading={oauthLoading === "github"}
              />
              <OAuthButton
                provider="apple" label="Apple"
                icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>}
                onClick={() => toast.info("Apple Login em breve")}
              />
              <OAuthButton
                provider="facebook" label="Facebook"
                icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1877F2">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>}
                onClick={() => toast.info("Facebook Login em breve")}
              />
            </div>

            <Divider label={tab === "login" ? tr.divider_login : tr.divider_register} />

            {/* Form */}
            {tab === "login"
              ? <LoginForm onSuccess={onSuccess} tr={tr} />
              : <RegisterForm onSuccess={onSuccess} tr={tr} />
            }
          </div>
        </div>

        {/* Footer */}
        <p className="text-[11px] text-center mt-5" style={{ color: "hsl(240 8% 32%)" }}>
          {tr.footer}{" "}
          <span className="underline cursor-pointer" style={{ color: "hsl(240 8% 46%)" }}>
            {tr.terms}
          </span>
        </p>
      </div>
    </div>
  );
}
