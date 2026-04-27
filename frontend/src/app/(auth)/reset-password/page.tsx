"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, ChevronLeft, Check, Eye, EyeOff, Loader2, Lock, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { authApi } from "@/lib/api";

// /reset-password?token=<token>
// Página pública de redefinição. O token veio no email do backend
// (gerado por /auth/forgot-password). Expira em 1h e é one-shot.
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError("Link inválido — token ausente.");
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      setError("Senha deve ter ao menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      setError("Senhas não conferem");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string }; status?: number } };
      setError(e?.response?.data?.error || "Não foi possível redefinir. O link pode ter expirado.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="p-7 flex flex-col items-center text-center space-y-3">
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.3)" }}
        >
          <Check className="h-7 w-7" style={{ color: "#00d46a" }} />
        </div>
        <h1 className="text-base font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
          Senha redefinida
        </h1>
        <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 55%)" }}>
          Já pode entrar com sua nova senha.
        </p>
        <button
          onClick={() => router.push("/login")}
          className="mt-2 flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
          style={{ background: "#00d46a", color: "#0a0a0f" }}
        >
          Ir para o login
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="p-7 flex flex-col items-center text-center space-y-3">
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <X className="h-7 w-7" style={{ color: "#f87171" }} />
        </div>
        <h1 className="text-base font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
          Link inválido
        </h1>
        <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 55%)" }}>
          Este link não tem o token de recuperação. Solicite um novo.
        </p>
        <button
          onClick={() => router.push("/forgot-password")}
          className="mt-2 text-sm px-5 py-2.5 rounded-xl transition-colors"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            color: "hsl(240 8% 70%)",
          }}
        >
          Solicitar novo link
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="px-5 pt-5 pb-1">
        <h1 className="text-base font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
          Criar nova senha
        </h1>
        <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 44%)" }}>
          Escolha uma senha forte, com ao menos 8 caracteres.
        </p>
      </div>
      <form onSubmit={submit} className="p-5 space-y-3.5">
        {error && (
          <div
            className="rounded-xl px-3.5 py-2.5 flex items-center gap-2"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
          >
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <PasswordField
          label="Nova senha"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setError("");
          }}
          autoFocus
          show={showPw}
          onToggle={() => setShowPw(!showPw)}
        />
        <PasswordField
          label="Confirmar nova senha"
          value={confirm}
          onChange={(v) => {
            setConfirm(v);
            setError("");
          }}
          show={showPw}
          onToggle={() => setShowPw(!showPw)}
        />

        <button
          type="submit"
          disabled={loading || !password || !confirm}
          className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "#00d46a", color: "#0a0a0f" }}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <span>Redefinir senha</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoFocus,
  show,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium block" style={{ color: "hsl(240 8% 58%)" }}>
        {label}
      </label>
      <div className="relative">
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "hsl(240 8% 36%)" }}
        >
          <Lock className="w-3.5 h-3.5" />
        </span>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          autoFocus={autoFocus}
          autoComplete="new-password"
          className="w-full rounded-xl py-2.5 pl-9 pr-10 text-sm outline-none focus:ring-1 focus:ring-white/10"
          style={{
            background: "hsl(240 12% 8%)",
            border: "1px solid hsl(240 12% 13%)",
            color: "hsl(240 15% 90%)",
          }}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: "hsl(240 8% 38%)" }}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 20% 4%)" }}>
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at bottom, rgba(0,212,106,0.05) 0%, transparent 70%)" }}
      />

      <div className="w-full max-w-sm relative animate-fade-in-up">
        <button
          onClick={() => router.push("/login")}
          className="flex items-center gap-1.5 text-xs mb-6 transition-colors"
          style={{ color: "hsl(240 8% 42%)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(240 15% 75%)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "hsl(240 8% 42%)")}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Voltar ao login
        </button>

        <div className="flex flex-col items-center mb-6">
          <Logo height={40} className="mb-3" />
        </div>

        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "hsl(240 18% 6%)",
            boxShadow: "0 0 0 1px hsl(240 12% 13%), 0 24px 64px rgba(0,0,0,0.5)",
          }}
        >
          <Suspense
            fallback={
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#00d46a" }} />
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
