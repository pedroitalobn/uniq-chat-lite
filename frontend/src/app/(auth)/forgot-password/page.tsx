"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, ChevronLeft, Check, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { authApi } from "@/lib/api";

// Solicita envio do email de recuperação. Backend SEMPRE retorna a mesma
// mensagem (anti-enumeration) — aqui mostramos a tela de sucesso mesmo que
// o email não exista, pra não vazar contas.
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Informe seu email");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Email inválido");
      return;
    }
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch {
      // Backend nunca deveria retornar erro (sempre 200). Se acontecer,
      // mostramos o sucesso mesmo assim pra não vazar info.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 20% 4%)" }}>
      {/* Ambient glow */}
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
          {sent ? (
            <div className="p-7 flex flex-col items-center text-center space-y-3">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.3)" }}
              >
                <Check className="h-7 w-7" style={{ color: "#00d46a" }} />
              </div>
              <h1 className="text-base font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
                Verifique seu email
              </h1>
              <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 55%)" }}>
                Se <strong style={{ color: "hsl(240 15% 82%)" }}>{email}</strong> estiver cadastrado,
                enviamos um link pra redefinir sua senha. O link expira em 1 hora.
              </p>
              <p className="text-[11px]" style={{ color: "hsl(240 8% 40%)" }}>
                Não achou o email? Confira a caixa de spam.
              </p>
              <button
                onClick={() => router.push("/login")}
                className="mt-2 text-sm px-5 py-2.5 rounded-xl transition-colors"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-default)",
                  color: "hsl(240 8% 70%)",
                }}
              >
                Voltar ao login
              </button>
            </div>
          ) : (
            <>
              <div className="px-5 pt-5 pb-1">
                <h1 className="text-base font-semibold" style={{ color: "hsl(240 15% 90%)" }}>
                  Esqueceu sua senha?
                </h1>
                <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 44%)" }}>
                  Informe seu email e mandaremos um link pra criar uma nova senha.
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

                <div className="space-y-1.5">
                  <label className="text-xs font-medium block" style={{ color: "hsl(240 8% 58%)" }}>
                    Email
                  </label>
                  <div className="relative">
                    <span
                      className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "hsl(240 8% 36%)" }}
                    >
                      <Mail className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError("");
                      }}
                      placeholder="seu@email.com"
                      autoFocus
                      autoComplete="email"
                      className="w-full rounded-xl py-2.5 pl-9 pr-3.5 text-sm outline-none focus:ring-1 focus:ring-white/10"
                      style={{
                        background: "hsl(240 12% 8%)",
                        border: "1px solid hsl(240 12% 13%)",
                        color: "hsl(240 15% 90%)",
                      }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#00d46a", color: "#0a0a0f" }}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Enviar link de recuperação</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-[11px] text-center mt-4" style={{ color: "hsl(240 8% 30%)" }}>
          Lembrou a senha?{" "}
          <span
            className="underline cursor-pointer"
            style={{ color: "hsl(240 8% 50%)" }}
            onClick={() => router.push("/login")}
          >
            Entrar
          </span>
        </p>
      </div>
    </div>
  );
}
