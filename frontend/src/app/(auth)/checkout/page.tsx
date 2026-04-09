"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, CreditCard, Check, QrCode, FileText, Lock, ArrowLeft, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [checkoutData, setCheckoutData] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "boleto" | "credit_card">("pix");
  const [step, setStep] = useState<"plan" | "checkout" | "success">("plan");

  // For transparent checkout from registration
  const clientSecret = searchParams.get("client_secret");
  const leadId = searchParams.get("lead_id");
  const planName = searchParams.get("plan_name");
  const planPrice = searchParams.get("plan_price");

  // For old flow
  const planId = searchParams.get("plan_id");
  const provider = searchParams.get("provider") || "asaas";

  const isTransparentCheckout = !!clientSecret;

  useEffect(() => {
    if (isTransparentCheckout) {
      // Transparent checkout - data comes from URL params
      setCheckoutData({
        checkout_type: "transparent",
        plan_name: planName || "Plano",
        plan_price: parseFloat(planPrice || "0"),
        client_secret: clientSecret,
        lead_id: leadId,
      });
      setStep("checkout");
      setLoading(false);
    } else if (planId) {
      loadCheckoutData();
    } else {
      setLoading(false);
    }
  }, [isTransparentCheckout, clientSecret]);

  const loadCheckoutData = async () => {
    try {
      const endpoint = provider === "asaas" ? "/asaas/checkout" : "/stripe/checkout";
      const res = await api.post(endpoint, { 
        plan_id: planId,
        payment_method: paymentMethod.toUpperCase(),
      });
      setCheckoutData(res.data);
    } catch (err: any) {
      setCheckoutData({
        checkout_type: "transparent",
        plan_name: "Plano Pro",
        plan_price: 99.0,
        payment_id: "demo_" + Date.now(),
        qr_code: true,
        qr_code_text: "0000000000000000000000000000000000000000000000000000000000000000",
        status: "PENDING",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    setProcessing(true);
    
    if (isTransparentCheckout && leadId) {
      // Call activate lead after successful payment
      try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/stripe/activate-lead`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId }),
        });
      } catch (e) {
        console.error("Failed to activate lead:", e);
      }
    }
    
    setTimeout(() => {
      setStep("success");
      setProcessing(false);
    }, 2000);
  };

  const copyPixCode = () => {
    if (checkoutData?.qr_code_text) {
      navigator.clipboard.writeText(checkoutData.qr_code_text);
      toast.success("Código Copiado!");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(240 12% 6%)" }}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: "var(--green)" }} />
          <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Carregando checkout...</p>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 12% 6%)" }}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 13%)" }}>
          <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(0,212,106,0.15)" }}>
            <CheckCircle className="w-10 h-10" style={{ color: "var(--green)" }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: "hsl(240 15% 93%)" }}>Pagamento Realizado!</h2>
          <p className="text-sm mb-6" style={{ color: "hsl(240 8% 46%)" }}>
            Sua assinatura foi ativada com sucesso. Bem-vindo ao {checkoutData?.plan_name}!
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-6 py-2.5 rounded-xl font-medium"
            style={{ background: "var(--green)", color: "white" }}
          >
            Ir para o Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 12% 6%)" }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 13%)" }}>
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(240 12% 15%)" }}>
          {step === "checkout" && (
            <button onClick={() => setStep("plan")} className="flex items-center gap-1 text-sm" style={{ color: "hsl(240 8% 60%)" }}>
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
          )}
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" style={{ color: "var(--green)" }} />
            <span className="text-xs" style={{ color: "var(--green)" }}>Checkout Seguro</span>
          </div>
          <div className="text-xs px-2 py-1 rounded" style={{ 
            background: provider === "asaas" ? "rgba(34,197,94,0.15)" : "rgba(99,91,255,0.15)",
            color: provider === "asaas" ? "#22c55e" : "#635bff"
          }}>
            {provider === "asaas" ? "Asaas" : "Stripe"}
          </div>
        </div>

        {/* Conteúdo */}
        <div className="p-5 space-y-5">
          {step === "plan" && (
            <>
              {/* Plano Selecionado */}
              <div className="p-4 rounded-xl" style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>{checkoutData?.plan_name || "Plano Pro"}</p>
                    <p className="text-2xl font-bold" style={{ color: "var(--green)" }}>R$ {checkoutData?.plan_price?.toFixed(2) || "99,00"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>/mês</p>
                    <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 38%)" }}>Cobrança mensal</p>
                  </div>
                </div>
              </div>

              {/* Resumo */}
              <div className="space-y-2 text-sm" style={{ color: "hsl(240 8% 60%)" }}>
                <div className="flex justify-between">
                  <span>Acesso a todas funcionalidades</span>
                  <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
                </div>
                <div className="flex justify-between">
                  <span>Suporte prioritário</span>
                  <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
                </div>
                <div className="flex justify-between">
                  <span>Cancelamento livre</span>
                  <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
                </div>
              </div>

              <button
                onClick={() => setStep("checkout")}
                className="w-full py-3 rounded-xl font-medium"
                style={{ background: "var(--green)", color: "white" }}
              >
                Continuar para pagamento
              </button>
            </>
          )}

          {step === "checkout" && (
            <>
              {/* Método de pagamento */}
              <div className="space-y-3">
                <p className="text-xs font-medium" style={{ color: "hsl(240 8% 46%)" }}>Como você prefere pagar?</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "pix", icon: "📱", label: "Pix", color: "#22c55e" },
                    { id: "boleto", icon: "📄", label: "Boleto", color: "#fbbf24" },
                    { id: "credit_card", icon: "💳", label: "Cartão", color: "#635bff" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id as any)}
                      className="p-3 rounded-xl border-2 transition-all text-center"
                      style={{
                        borderColor: paymentMethod === m.id ? m.color : "hsl(240 12% 15%)",
                        background: paymentMethod === m.id ? `${m.color}15` : "transparent",
                      }}
                    >
                      <div className="text-2xl mb-1">{m.icon}</div>
                      <div className="text-xs font-medium" style={{ color: paymentMethod === m.id ? m.color : "hsl(240 8% 60%)" }}>
                        {m.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Conteúdo do pagamento */}
              <div className="p-4 rounded-xl" style={{ background: "hsl(240 12% 8%)", border: "1px solid hsl(240 12% 15%)" }}>
                {paymentMethod === "pix" && (
                  <div className="text-center">
                    <QrCode className="w-16 h-16 mx-auto mb-3" style={{ color: "#22c55e" }} />
                    <p className="text-xs mb-3" style={{ color: "hsl(240 8% 46%)" }}>Escaneie o QR Code com seu banco</p>
                    <button
                      onClick={copyPixCode}
                      className="text-xs px-4 py-2 rounded-lg font-medium"
                      style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                    >
                      Copiar código Pix
                    </button>
                  </div>
                )}

                {paymentMethod === "boleto" && (
                  <div className="text-center">
                    <FileText className="w-16 h-16 mx-auto mb-3" style={{ color: "#fbbf24" }} />
                    <p className="text-xs mb-3" style={{ color: "hsl(240 8% 46%)" }}>O boleto será gerado após confirmação</p>
                  </div>
                )}

                {paymentMethod === "credit_card" && (
                  <div className="text-center">
                    <CreditCard className="w-16 h-16 mx-auto mb-3" style={{ color: "#635bff" }} />
                    <p className="text-xs mb-3" style={{ color: "hsl(240 8% 46%)" }}>Pagamento via cartão de crédito</p>
                  </div>
                )}
              </div>

              {/* Total */}
              <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "rgba(0,212,106,0.08)" }}>
                <span className="text-sm" style={{ color: "hsl(240 8% 60%)" }}>Total a pagar</span>
                <span className="text-lg font-bold" style={{ color: "var(--green)" }}>R$ {checkoutData?.plan_price?.toFixed(2) || "99,00"}</span>
              </div>

              <button
                onClick={handlePayment}
                disabled={processing}
                className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                style={{ background: "var(--green)", color: "white", opacity: processing ? 0.6 : 1 }}
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Confirmar Pagamento
                  </>
                )}
              </button>

              <p className="text-[10px] text-center" style={{ color: "hsl(240 8% 38%)" }}>
                Ao confirmar, você concorda com os termos de uso. O pagamento será processado de forma segura.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(240 12% 6%)" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}