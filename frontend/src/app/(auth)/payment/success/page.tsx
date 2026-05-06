"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function SuccessContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const leadId = params.get("lead_id");
  const pendingId = params.get("pending_id");
  const paymentIntentId = params.get("payment_intent");
  const [countdown, setCountdown] = useState(5);
  const [finalizing, setFinalizing] = useState(!!pendingId);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  useEffect(() => {
    // Fluxo novo (defer-creation): pending_id na URL → finalize a
    // matrícula no servidor (que confirma com Stripe) e auto-loga.
    if (pendingId) {
      (async () => {
        try {
          const r = await fetch(`${API}/v1/stripe/finalize-registration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pending_id: pendingId,
              session_id: sessionId || undefined,
              payment_intent_id: paymentIntentId || undefined,
            }),
          });
          const data = await r.json();
          if (!r.ok) {
            setFinalizeError(data.error || "Erro ao finalizar cadastro");
            setFinalizing(false);
            return;
          }
          if (data.access_token) {
            await signIn("credentials", {
              access_token: data.access_token,
              redirect: false,
            });
          }
        } catch (e: any) {
          setFinalizeError("Erro de rede ao finalizar cadastro");
        } finally {
          setFinalizing(false);
        }
      })();
      return;
    }
    // Fluxo legado (lead_id) — mantém pra cobranças de upgrade de
    // user já existente.
    if (leadId) {
      fetch(`${API}/stripe/activate-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      }).catch(console.error);
    }
  }, [pendingId, leadId, sessionId, paymentIntentId]);

  useEffect(() => {
    // Não inicia o countdown enquanto finaliza ou se houve erro —
    // o user precisa ler a mensagem.
    if (finalizing || finalizeError) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [finalizing, finalizeError]);

  useEffect(() => {
    if (countdown === 0 && !finalizing && !finalizeError) {
      router.push("/instances");
    }
  }, [countdown, router, finalizing, finalizeError]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "hsl(240 20% 4%)" }}>
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]"
          style={{ background: "radial-gradient(ellipse, rgba(0,212,106,0.06) 0%, transparent 65%)" }} />
      </div>

      <div className="relative w-full max-w-md text-center animate-fade-in-up">
        <Logo height={36} className="mx-auto mb-8" />

        {/* Success icon */}
        <div className="relative inline-flex mb-6">
          <div className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,212,106,0.12)", border: "2px solid rgba(0,212,106,0.3)" }}>
            <CheckCircle className="w-10 h-10" style={{ color: "#00d46a" }} />
          </div>
          <div className="absolute -top-1 -right-1">
            <Sparkles className="w-5 h-5" style={{ color: "#fbbf24" }} />
          </div>
        </div>

        <h1 className="text-2xl font-extrabold mb-2" style={{ color: "hsl(240 15% 94%)" }}>
          {finalizing ? "Ativando sua conta..." : finalizeError ? "Pagamento recebido — ainda confirmando" : "Pagamento confirmado!"}
        </h1>
        <p className="text-sm mb-2" style={{ color: "hsl(240 8% 55%)" }}>
          {finalizing
            ? "Estamos conferindo seu pagamento com o Stripe. Isso leva alguns segundos."
            : finalizeError
              ? finalizeError + ". Aguarde alguns segundos e tente novamente."
              : "Seu plano foi ativado com sucesso. Aproveite todos os recursos da Uniq.chat."}
        </p>

        {sessionId && (
          <p className="text-[11px] font-mono mb-6 px-3 py-1.5 rounded-lg inline-block"
            style={{ background: "var(--surface-2)", color: "hsl(240 8% 38%)", border: "1px solid hsl(240 12% 12%)" }}>
            Ref: {sessionId.slice(0, 24)}...
          </p>
        )}

        <div className="rounded-2xl p-5 mb-6 space-y-3"
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <p className="text-xs font-medium" style={{ color: "hsl(240 15% 75%)" }}>
            O que acontece agora?
          </p>
          {[
            "Seu plano foi ativado imediatamente",
            "Você receberá o recibo por email",
            "Crie suas instâncias e conecte seus canais",
            "Acesse webhooks, automações e muito mais",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2.5 text-xs"
              style={{ color: "hsl(240 8% 55%)" }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#00d46a" }} />
              {item}
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push("/instances")}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
          style={{ background: "#00d46a", color: "#03170a" }}
        >
          <span>Ir para o Dashboard</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <p className="text-[11px] mt-3" style={{ color: "hsl(240 8% 30%)" }}>
          Redirecionando automaticamente em {countdown}s...
        </p>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(240 20% 4%)" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#00d46a" }} />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
