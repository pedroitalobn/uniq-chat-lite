"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Check, Loader2, Mail } from "lucide-react";
import { Logo } from "@/components/Logo";
import { authApi } from "@/lib/api";

// /verify-email?token=<token>
// Página pública que recebe o token enviado por email pelo backend
// (gerado em /auth/register quando REQUIRE_EMAIL_VERIFICATION=true).
// Token expira em 24h e é one-shot.
function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const ranRef = useRef(false);

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [needResend, setNeedResend] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);

  useEffect(() => {
    if (ranRef.current) return; // StrictMode dispara 2x — token é one-shot.
    ranRef.current = true;
    if (!token) {
      setStatus("error");
      setErrorMsg("Link inválido — token ausente.");
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || ""}/auth/verify-email`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setErrorMsg(data.error || "Não foi possível verificar.");
          if (data.need_resend) setNeedResend(true);
          return;
        }
        setStatus("success");
        // Auto-login: backend devolve access_token + user. Redireciona após 1.5s.
        setTimeout(() => {
          // Sessão NextAuth não foi criada no fluxo de verify; mais seguro
          // mandar o user pra /login com email pré-preenchido pra ele entrar
          // com a senha que acabou de cadastrar.
          router.push(`/login?email=${encodeURIComponent(data.user?.email || "")}`);
        }, 1500);
      } catch {
        setStatus("error");
        setErrorMsg("Erro de conexão. Tente novamente.");
      }
    })();
  }, [token, router]);

  const requestResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) return;
    try {
      await authApi.resendVerification(resendEmail.trim());
      setResendSent(true);
    } catch {
      setResendSent(true); // resposta neutra (anti-enumeração)
    }
  };

  if (status === "loading") {
    return (
      <div className="p-8 flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--green)" }} />
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Confirmando seu e-mail…</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "var(--green-soft)" }}>
          <Check className="w-6 h-6" style={{ color: "var(--green)" }} />
        </div>
        <h1 className="text-base font-medium" style={{ color: "var(--text-1)" }}>
          E-mail confirmado
        </h1>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Redirecionando pro login…
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Não foi possível verificar
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            {errorMsg}
          </p>
        </div>
      </div>

      {needResend && !resendSent && (
        <form onSubmit={requestResend} className="space-y-2">
          <p className="text-xs" style={{ color: "var(--text-2)" }}>
            Insira seu e-mail pra receber um novo link:
          </p>
          <input type="email" required value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            placeholder="seu@email.com"
            className="input-field" />
          <button type="submit"
            className="w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}>
            <Mail className="w-3.5 h-3.5" />
            Reenviar e-mail
          </button>
        </form>
      )}

      {resendSent && (
        <p className="text-xs" style={{ color: "var(--green)" }}>
          ✓ Se houver uma conta com esse e-mail, um novo link foi enviado.
        </p>
      )}

      <button onClick={() => router.push("/login")}
        className="text-xs underline" style={{ color: "var(--text-3)" }}>
        Voltar ao login
      </button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--surface-solid)" }}>
      <div className="w-full max-w-sm relative animate-fade-in-up">
        <div className="flex flex-col items-center mb-6">
          <Logo height={40} className="mb-3" />
        </div>
        <div className="rounded-2xl overflow-hidden"
          style={{
            background: "var(--surface-solid)",
            boxShadow: "0 0 0 1px var(--border-default), 0 24px 64px rgba(0,0,0,0.5)",
          }}>
          <Suspense fallback={
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--green)" }} />
            </div>
          }>
            <VerifyEmailForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
