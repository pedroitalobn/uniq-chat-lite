"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Eye, EyeOff, AlertCircle, ArrowRight,
  Loader2, Lock, AtSign,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ── Field ─────────────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, type = "text", placeholder, icon, error,
  autoFocus, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; icon?: React.ReactNode;
  error?: string; autoFocus?: boolean; autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (show ? "text" : "password") : type;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[hsl(240_8%_58%)]">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: focused ? "#00d46a" : "hsl(240 8% 36%)", transition: "color 0.15s" }}>
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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full rounded-xl py-3 text-sm outline-none transition-all duration-150 text-[hsl(240_15%_90%)] placeholder:text-[hsl(240_8%_32%)]"
          style={{
            paddingLeft: icon ? "2.75rem" : "1rem",
            paddingRight: isPassword ? "2.75rem" : "1rem",
            background: "rgba(255,255,255,0.03)",
            border: error
              ? "1px solid rgba(239,68,68,0.4)"
              : focused
                ? "1px solid rgba(0,212,106,0.5)"
                : "1px solid rgba(255,255,255,0.07)",
            boxShadow: focused
              ? error ? "0 0 0 3px rgba(239,68,68,0.08)" : "0 0 0 3px rgba(0,212,106,0.08)"
              : "none",
          }}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}>
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs flex items-center gap-1.5 text-red-400">
          <AlertCircle className="w-3 h-3 shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

// ── Social button ─────────────────────────────────────────────────────────────
function SocialBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
      style={{
        background: hover ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${hover ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)"}`,
        color: "hsl(240 15% 72%)",
      }}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── Login Form ────────────────────────────────────────────────────────────────
function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const params = useSearchParams();
  const emailFromUrl = params.get("email") || "";
  const [identifier, setIdentifier] = useState(emailFromUrl);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) return;
    setLoading(true); setError("");
    try {
      const probe = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password: password.trim() }),
      });
      const probeData = await probe.json().catch(() => ({}));
      if (probe.status === 202 && probeData.requires_2fa) {
        setChallengeToken(probeData.challenge_token);
        setLoading(false); return;
      }
      if (!probe.ok) {
        setError(probeData.error || "Credenciais incorretas");
        setLoading(false); return;
      }
      const result = await signIn("credentials", {
        identifier: identifier.trim(), password: password.trim(), redirect: false,
      });
      setLoading(false);
      if (result?.error) setError("Erro ao iniciar sessão");
      else { toast.success("Bem-vindo de volta!"); onSuccess(); }
    } catch {
      setLoading(false); setError("Erro de conexão. Tente novamente.");
    }
  };

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    setLoading(true); setError("");
    const result = await signIn("credentials", {
      challenge_token: challengeToken, code: totpCode, redirect: false,
    });
    setLoading(false);
    if (result?.error) { setError("Código inválido"); setTotpCode(""); }
    else { toast.success("Bem-vindo de volta!"); onSuccess(); }
  };

  if (challengeToken) {
    return (
      <form onSubmit={submitTotp} className="flex flex-col gap-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl text-xs text-red-400"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[hsl(240_8%_58%)]">Código do autenticador</label>
          <input type="text" inputMode="numeric" maxLength={6} value={totpCode}
            onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
            autoFocus placeholder="000000"
            className="w-full py-3 px-4 rounded-xl text-sm text-center tracking-widest font-mono outline-none transition-all text-[hsl(240_15%_90%)] placeholder:text-[hsl(240_8%_32%)]"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }} />
          <p className="text-xs text-[hsl(240_8%_40%)]">Use o código de 6 dígitos do seu app autenticador.</p>
        </div>
        <GreenBtn disabled={totpCode.length !== 6 || loading} loading={loading}>Verificar</GreenBtn>
        <button type="button" onClick={() => { setChallengeToken(""); setTotpCode(""); setPassword(""); }}
          className="text-xs text-center text-[hsl(240_8%_40%)] hover:text-[hsl(240_8%_58%)] transition-colors">
          Voltar
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-3 rounded-xl text-xs text-red-400"
          style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
        </motion.div>
      )}

      <Field label="Email ou username" value={identifier}
        onChange={v => { setIdentifier(v); setError(""); }}
        placeholder="seu@email.com" icon={<AtSign className="w-3.5 h-3.5" />}
        autoFocus autoComplete="username" />

      <div className="flex flex-col gap-1.5">
        <Field label="Senha" value={password}
          onChange={v => { setPassword(v); setError(""); }}
          type="password" placeholder="Sua senha" icon={<Lock className="w-3.5 h-3.5" />}
          autoComplete="current-password" />
        <div className="flex justify-end">
          <Link href="/forgot-password"
            className="text-xs transition-colors text-[hsl(240_8%_42%)] hover:text-[#00d46a]">
            Esqueceu a senha?
          </Link>
        </div>
      </div>

      <GreenBtn disabled={loading || !identifier.trim() || !password.trim()} loading={loading}>
        Entrar
      </GreenBtn>
    </form>
  );
}

function GreenBtn({ children, disabled, loading }: {
  children: React.ReactNode; disabled?: boolean; loading?: boolean;
}) {
  return (
    <button type="submit" disabled={disabled}
      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      style={{ background: "#00d46a", color: "#050508" }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#00bf60"; }}
      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#00d46a"}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <>{children}<ArrowRight className="w-4 h-4" /></>
      )}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
function LoginContent() {
  const onSuccess = () => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const cb = url.searchParams.get("callbackUrl");
      if (cb && cb.startsWith("/") && !cb.startsWith("//")) {
        window.location.href = cb; return;
      }
    }
    window.location.href = "/uniq-ai";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "#060609" }}>

      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-[800px] h-[600px] rounded-full -bottom-40 -left-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(0,212,106,0.055) 0%, transparent 70%)" }} />
        <div className="absolute w-[600px] h-[500px] rounded-full -top-32 -right-32 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(96,165,250,0.04) 0%, transparent 65%)" }} />
        <div className="absolute w-[400px] h-[400px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(167,139,250,0.025) 0%, transparent 70%)" }} />
        {/* Subtle dot grid */}
        <div className="absolute inset-0" style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.018) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo height={48} />
        </div>

        {/* Glass card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "rgba(13,14,20,0.75)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.03) inset, 0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,106,0.04)",
          }}
        >
          {/* Card header */}
          <div className="px-7 pt-7 pb-5">
            <h1 className="text-xl font-bold text-[hsl(240_15%_93%)] tracking-tight">
              Bem-vindo de volta
            </h1>
            <p className="text-sm text-[hsl(240_8%_46%)] mt-0.5">
              Faça login na sua conta
            </p>
          </div>

          <div className="px-7 pb-7 flex flex-col gap-5">
            {/* Social */}
            <div className="grid grid-cols-2 gap-2">
              <SocialBtn
                label="Google"
                onClick={() => toast.info("Google Login em breve")}
                icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>}
              />
              <SocialBtn
                label="GitHub"
                onClick={() => toast.info("GitHub Login em breve")}
                icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>}
              />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <span className="text-[10px] font-medium uppercase tracking-widest text-[hsl(240_8%_30%)]">ou</span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>

            {/* Form */}
            <Suspense fallback={<div className="h-40 animate-pulse rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }} />}>
              <LoginForm onSuccess={onSuccess} />
            </Suspense>

            {/* Register link */}
            <p className="text-center text-xs text-[hsl(240_8%_38%)]">
              Não tem conta?{" "}
              <Link href="/register" className="font-medium transition-colors text-[hsl(240_8%_58%)] hover:text-[#00d46a]">
                Criar conta grátis
              </Link>
            </p>
          </div>
        </div>

        {/* Footer links */}
        <div className="flex items-center justify-center gap-4 mt-6">
          <Link href="/api-docs" className="text-[11px] text-[hsl(240_8%_32%)] hover:text-[hsl(240_8%_46%)] transition-colors">
            API Docs
          </Link>
          <span className="text-[hsl(240_8%_22%)]">·</span>
          <Link href="/terms" className="text-[11px] text-[hsl(240_8%_32%)] hover:text-[hsl(240_8%_46%)] transition-colors">
            Termos
          </Link>
          <span className="text-[hsl(240_8%_22%)]">·</span>
          <Link href="/privacy" className="text-[11px] text-[hsl(240_8%_32%)] hover:text-[hsl(240_8%_46%)] transition-colors">
            Privacidade
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
