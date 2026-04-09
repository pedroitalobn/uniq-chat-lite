"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";

function SuccessContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const leadId = params.get("lead_id");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    // If lead_id present, call backend to activate lead
    if (leadId) {
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/stripe/activate-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      }).catch(console.error);
    }
  }, [leadId]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (countdown === 0) {
      router.push("/instances");
    }
  }, [countdown, router]);

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
          Pagamento confirmado!
        </h1>
        <p className="text-sm mb-2" style={{ color: "hsl(240 8% 55%)" }}>
          Seu plano foi ativado com sucesso. Aproveite todos os recursos da Uniq.chat.
        </p>

        {sessionId && (
          <p className="text-[11px] font-mono mb-6 px-3 py-1.5 rounded-lg inline-block"
            style={{ background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 38%)", border: "1px solid hsl(240 12% 12%)" }}>
            Ref: {sessionId.slice(0, 24)}...
          </p>
        )}

        <div className="rounded-2xl p-5 mb-6 space-y-3"
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          <p className="text-xs font-semibold" style={{ color: "hsl(240 15% 75%)" }}>
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
          className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
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
