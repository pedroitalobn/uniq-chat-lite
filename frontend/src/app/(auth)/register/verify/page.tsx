"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Building2, AtSign, Lock, Eye, EyeOff,
  ArrowRight, Loader2, AlertCircle, CheckCircle2, XCircle,
} from "lucide-react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ── shared input ──────────────────────────────────────────────────────────────
const inputCls =
  "w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-150 bg-[hsl(240_18%_5%)] border text-[hsl(240_15%_92%)] placeholder:text-[hsl(240_8%_38%)]";

function Field({
  label, type = "text", value, onChange, placeholder, icon, hint, error, autoFocus,
  rightEl,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; icon?: React.ReactNode; hint?: string; error?: string;
  autoFocus?: boolean; rightEl?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[hsl(240_15%_65%)]">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(240_8%_40%)] pointer-events-none">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={inputCls}
          style={{
            paddingLeft: icon ? "2.5rem" : undefined,
            paddingRight: rightEl ? "2.75rem" : undefined,
            borderColor: error ? "rgba(239,68,68,0.5)" : focused ? "#00d46a" : "hsl(240 12% 13%)",
            boxShadow: error
              ? "0 0 0 3px rgba(239,68,68,0.08)"
              : focused ? "0 0 0 3px rgba(0,212,106,0.10)" : "none",
          }}
        />
        {rightEl && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">{rightEl}</span>
        )}
      </div>
      {hint && !error && <p className="text-xs text-[hsl(240_8%_38%)] pl-0.5">{hint}</p>}
      {error && <p className="text-xs text-red-400 pl-0.5">{error}</p>}
    </div>
  );
}

// ── Password strength ─────────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ caracteres", ok: password.length >= 8 },
    { label: "Letra maiúscula", ok: /[A-Z]/.test(password) },
    { label: "Número", ok: /[0-9]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = ["#ef4444", "#fb923c", "#00d46a"];
  const labels = ["Fraca", "Média", "Forte"];

  if (!password) return null;
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
      className="flex flex-col gap-2 overflow-hidden">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
            style={{ background: i < score ? colors[score - 1] : "hsl(240 12% 16%)" }} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {checks.map(c => (
            <span key={c.label} className="flex items-center gap-1 text-xs"
              style={{ color: c.ok ? "#00d46a" : "hsl(240 8% 38%)" }}>
              <CheckCircle2 className="w-3 h-3" />
              {c.label}
            </span>
          ))}
        </div>
        <span className="text-xs font-medium" style={{ color: colors[score - 1] ?? "hsl(240 8% 38%)" }}>
          {score > 0 ? labels[score - 1] : ""}
        </span>
      </div>
    </motion.div>
  );
}

// ── Complete form ─────────────────────────────────────────────────────────────
function CompleteForm({
  email, pendingId,
}: {
  email: string; pendingId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Nome é obrigatório";
    if (password.length < 8) e.password = "Mínimo 8 caracteres";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/v1/auth/register/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pending_registration_id: pendingId,
          name: name.trim(),
          username: username.trim().toLowerCase() || undefined,
          workspace_name: company.trim() || undefined,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.includes("username")) {
          setErrors({ username: data.error });
        } else {
          setErrors({ global: data.error || "Erro ao criar conta" });
        }
        return;
      }

      // Paid plan — redirect to Stripe
      if (data.checkout_type === "redirect" && data.url) {
        window.location.href = data.url;
        return;
      }

      // Free plan — sign in
      if (data.access_token) {
        await signIn("credentials", {
          access_token: data.access_token,
          redirect: false,
        });
        router.push("/dashboard");
      }
    } catch {
      setErrors({ global: "Erro de conexão. Tente novamente." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        {/* Email badge */}
        <div className="flex items-center gap-2 mb-1">
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)", color: "#00d46a" }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {email}
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[hsl(240_15%_92%)] tracking-tight">
          Complete seu perfil
        </h1>
        <p className="text-sm text-[hsl(240_8%_50%)]">
          Quase lá — só mais algumas informações
        </p>
      </div>

      <Field label="Seu nome" value={name} onChange={setName} placeholder="João Silva"
        autoFocus icon={<User className="w-4 h-4" />} error={errors.name} />

      <Field label="Username (opcional)" value={username} onChange={setUsername}
        placeholder="@joaosilva" icon={<AtSign className="w-4 h-4" />}
        hint="Visível para outros usuários" error={errors.username} />

      <Field label="Nome da empresa (opcional)" value={company} onChange={setCompany}
        placeholder="Minha Empresa" icon={<Building2 className="w-4 h-4" />} />

      <div className="flex flex-col gap-2">
        <Field
          label="Crie uma senha"
          type={showPass ? "text" : "password"}
          value={password}
          onChange={setPassword}
          placeholder="Mínimo 8 caracteres"
          icon={<Lock className="w-4 h-4" />}
          error={errors.password}
          rightEl={
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="text-[hsl(240_8%_40%)] hover:text-[hsl(240_15%_65%)] transition-colors">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
        />
        <PasswordStrength password={password} />
      </div>

      {errors.global && (
        <div className="flex items-start gap-2 p-3 rounded-xl border text-sm"
          style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)", color: "#fca5a5" }}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {errors.global}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all duration-150 disabled:opacity-60"
        style={{ background: "#00d46a", color: "#050508" }}
        onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#00bf60"; }}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#00d46a"}
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <><span>Criar conta</span><ArrowRight className="w-4 h-4" /></>}
      </button>
    </form>
  );
}

// ── Token validation states ───────────────────────────────────────────────────
type TokenState =
  | { status: "loading" }
  | { status: "valid"; email: string; pendingId: string }
  | { status: "invalid"; message: string }
  | { status: "expired" };

function VerifyContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<TokenState>({ status: "loading" });

  useEffect(() => {
    if (!token) { setState({ status: "invalid", message: "Token não encontrado" }); return; }
    fetch(`${API}/v1/auth/register/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const data = await res.json();
        if (res.status === 410) { setState({ status: "expired" }); return; }
        if (!res.ok) { setState({ status: "invalid", message: data.error || "Link inválido" }); return; }
        setState({ status: "valid", email: data.email, pendingId: data.pending_registration_id });
      })
      .catch(() => setState({ status: "invalid", message: "Erro de conexão" }));
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "hsl(240 18% 4%)" }}>
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex justify-center">
          <Logo />
        </div>

        <div
          className="rounded-2xl p-7"
          style={{
            background: "hsl(240 18% 6%)",
            border: "1px solid hsl(240 12% 11%)",
            boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
          }}
        >
          <AnimatePresence mode="wait">
            {state.status === "loading" && (
              <motion.div key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#00d46a" }} />
                <p className="text-sm text-[hsl(240_8%_50%)]">Verificando seu link…</p>
              </motion.div>
            )}

            {state.status === "valid" && (
              <motion.div key="valid"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}>
                {/* Step dots — step 3 active */}
                <div className="flex items-center justify-center gap-1 mb-6">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="rounded-full transition-all duration-300"
                        style={{
                          width: i === 2 ? 24 : 7,
                          height: 7,
                          background: i < 2 ? "#00d46a" : i === 2 ? "#00d46a" : "hsl(240 12% 16%)",
                        }} />
                      {i < 2 && (
                        <div className="h-px w-6" style={{ background: "#00d46a" }} />
                      )}
                    </div>
                  ))}
                </div>
                <CompleteForm email={state.email} pendingId={state.pendingId} />
              </motion.div>
            )}

            {state.status === "expired" && (
              <motion.div key="expired"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-5 py-6 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)" }}>
                  <span className="text-3xl">⏰</span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[hsl(240_15%_92%)] mb-1">Link expirado</h2>
                  <p className="text-sm text-[hsl(240_8%_50%)]">
                    Links de acesso expiram em 30 minutos.
                  </p>
                </div>
                <Link
                  href="/register"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: "#00d46a", color: "#050508" }}
                >
                  Solicitar novo link
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            )}

            {state.status === "invalid" && (
              <motion.div key="invalid"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-5 py-6 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <XCircle className="w-8 h-8 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[hsl(240_15%_92%)] mb-1">Link inválido</h2>
                  <p className="text-sm text-[hsl(240_8%_50%)]">
                    {state.message}
                  </p>
                </div>
                <Link
                  href="/register"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: "#00d46a", color: "#050508" }}
                >
                  Tentar novamente
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-xs text-[hsl(240_8%_32%)]">
          Já tem conta?{" "}
          <Link href="/login" className="underline underline-offset-2 hover:text-[hsl(240_8%_50%)] transition-colors">
            Fazer login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterVerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
