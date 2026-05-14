"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  Loader2, CreditCard, Check, QrCode, FileText, Lock,
  ArrowLeft, CheckCircle, Banknote, Copy, Clock, Shield
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const PIX_EXPIRATION_MINUTES = 30;

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [checkoutData, setCheckoutData] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "boleto" | "credit_card">("pix");
  const [step, setStep] = useState<"plan" | "checkout" | "success">("plan");
  const [copied, setCopied] = useState(false);
  const [pixTimeLeft, setPixTimeLeft] = useState<number | null>(null);
  const [pollingPayment, setPollingPayment] = useState(false);
  const checkoutCreatedAt = useRef<number | null>(null);

  // For transparent checkout from registration
  const clientSecret = searchParams.get("client_secret");
  const leadId = searchParams.get("lead_id");
  const pendingId = searchParams.get("pending_id");
  const paymentIntentId = searchParams.get("payment_intent_id");
  const planName = searchParams.get("plan_name");
  const planPrice = searchParams.get("plan_price");
  const providerFromUrl = searchParams.get("provider");
  const subscriptionId = searchParams.get("subscription_id");
  const firstInvoiceUrl = searchParams.get("first_invoice_url");
  // PIX Automático — vem do /register/verify quando o user escolhe PIX
  // Auto. Trazemos o br_code + base64 direto pela URL pra a página
  // renderizar o QR sem nova chamada de API.
  const urlMode = searchParams.get("mode");
  const urlBrCode = searchParams.get("br_code");
  const urlBrCodeBase64 = searchParams.get("br_code_base64");
  const urlAuthorizationId = searchParams.get("authorization_id");

  // For old flow
  const planId = searchParams.get("plan_id");
  const provider = providerFromUrl || "asaas";

  const isTransparentCheckout = !!clientSecret;
  const isAsaasSubscription = !!subscriptionId;
  const isPixAutomatic = urlMode === "pix_automatic" && !!urlBrCode;
  const isAbacatePay = provider === "abacatepay";
  const hasBrCode = !!checkoutData?.br_code && !checkoutData?.payment_link;
  const hasPaymentLink = !!checkoutData?.payment_link;

  // PIX expiration countdown
  useEffect(() => {
    if (!hasBrCode || !checkoutCreatedAt.current) return;
    const expiresAt = checkoutCreatedAt.current + PIX_EXPIRATION_MINUTES * 60 * 1000;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setPixTimeLeft(remaining);
      if (remaining <= 0) return;
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hasBrCode]);

  // Poll for payment confirmation in transparent mode
  useEffect(() => {
    if ((!hasBrCode && !isAsaasSubscription) || !pendingId || pollingPayment) return;
    if (pixTimeLeft !== null && pixTimeLeft <= 0) return;

    setPollingPayment(true);
    const poll = async () => {
      try {
        const r = await fetch(`${API}/v1/payments/finalize-registration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pending_id: pendingId,
            payment_intent_id: paymentIntentId || undefined,
            subscription_id: subscriptionId || undefined,
          }),
        });
        if (r.status === 202) return; // still processing
        const data = await r.json();
        if (r.ok && data.access_token) {
          router.push(`/payment/success?pending_id=${pendingId}`);
        }
      } catch { /* retry on next interval */ }
    };

    const interval = setInterval(poll, 5000);
    poll(); // immediate first poll
    return () => clearInterval(interval);
  }, [hasBrCode, isAsaasSubscription, pendingId, paymentIntentId, subscriptionId, pollingPayment, pixTimeLeft, router]);

  useEffect(() => {
    if (isPixAutomatic) {
      // /register/verify nos passou o br_code da autorização. Renderizamos
      // QR + copia-e-cola inline (não precisa nova chamada de API).
      setCheckoutData({
        checkout_type: "pix_automatic",
        plan_name: planName || "Plano",
        plan_price: parseFloat(planPrice || "0"),
        br_code: urlBrCode,
        br_code_base64: urlBrCodeBase64 || "",
        authorization_id: urlAuthorizationId,
        provider: "asaas",
      });
      setStep("checkout");
      setLoading(false);
    } else if (isTransparentCheckout) {
      setCheckoutData({
        checkout_type: "transparent",
        plan_name: planName || "Plano",
        plan_price: parseFloat(planPrice || "0"),
        client_secret: clientSecret,
        lead_id: leadId,
        provider: providerFromUrl || "stripe",
      });
      setStep("checkout");
      setLoading(false);
    } else if (isAsaasSubscription) {
      setCheckoutData({
        checkout_type: "subscription",
        plan_name: planName || "Plano",
        plan_price: parseFloat(planPrice || "0"),
        subscription_id: subscriptionId,
        first_invoice_url: firstInvoiceUrl,
        provider: "asaas",
      });
      setStep("checkout");
      setLoading(false);
    } else if (planId) {
      loadCheckoutData();
    } else {
      setLoading(false);
    }
  }, [isTransparentCheckout, isAsaasSubscription, clientSecret, subscriptionId]);

  const loadCheckoutData = async () => {
    try {
      const endpoint = provider === "abacatepay"
        ? "/abacatepay/checkout"
        : provider === "asaas"
        ? "/asaas/checkout"
        : "/stripe/checkout";
      const res = await api.post(endpoint, {
        plan_id: planId,
        payment_method: paymentMethod,
      });
      setCheckoutData(res.data);
      if (res.data.br_code) {
        checkoutCreatedAt.current = Date.now();
      }
    } catch (err: any) {
      toast.error("Erro ao carregar checkout: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    setProcessing(true);

    if ((isTransparentCheckout || isAsaasSubscription) && pendingId) {
      try {
        const r = await fetch(`${API}/v1/payments/finalize-registration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pending_id: pendingId,
            payment_intent_id: paymentIntentId || undefined,
            subscription_id: subscriptionId || undefined,
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          toast.error(data.error || "Erro ao finalizar cadastro");
          setProcessing(false);
          return;
        }
        if (data.access_token) {
          router.push(`/payment/success?pending_id=${pendingId}`);
          return;
        }
      } catch {
        toast.error("Erro de rede ao finalizar cadastro");
        setProcessing(false);
        return;
      }
    } else if (isTransparentCheckout && leadId) {
      try {
        await fetch(`${API}/stripe/activate-lead`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId }),
        });
      } catch {
        console.error("Failed to activate lead:", Error);
      }
    }

    setTimeout(() => {
      setStep("success");
      setProcessing(false);
    }, 2000);
  };

  const copyPixCode = useCallback(() => {
    const code = checkoutData?.br_code || checkoutData?.qr_code_text;
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Código PIX copiado!");
    setTimeout(() => setCopied(false), 2000);
  }, [checkoutData?.br_code, checkoutData?.qr_code_text]);

  const formatTimeLeft = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const paymentOptions = [
    { id: "pix" as const, icon: QrCode, label: "PIX", color: isAbacatePay ? "#0ea5e9" : "#22c55e" },
    { id: "boleto" as const, icon: FileText, label: "Boleto", color: "#f59e0b" },
    ...(provider === "stripe" ? [] : [{ id: "credit_card" as const, icon: CreditCard, label: "Cartão", color: provider === "abacatepay" ? "#8b5cf6" : "#635bff" }]),
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(240 12% 6%)" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: "var(--green)" }} />
          <p className="text-sm" style={{ color: "hsl(240 8% 46%)" }}>Carregando checkout...</p>
        </motion.div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 12% 6%)" }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl p-8 text-center relative overflow-hidden"
          style={{
            background: "hsl(240 18% 8%)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(37, 99, 235,0.08) 0%, transparent 60%)" }} />
          <div className="relative">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: "rgba(37, 99, 235,0.15)" }}
            >
              <CheckCircle className="w-10 h-10" style={{ color: "var(--green)" }} />
            </motion.div>
            <h2 className="text-xl font-semibold mb-2" style={{ color: "hsl(240 15% 93%)" }}>Pagamento Realizado!</h2>
            <p className="text-sm mb-6" style={{ color: "hsl(240 8% 46%)" }}>
              Sua assinatura foi ativada com sucesso. Bem-vindo ao {checkoutData?.plan_name}!
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-6 py-2.5 rounded-xl font-medium transition-transform active:scale-[0.98]"
              style={{ background: "var(--green)", color: "white" }}
            >
              Ir para o Dashboard
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(1200px 600px at 20% 0%, rgba(37, 99, 235,0.18), transparent 60%)," +
          "radial-gradient(900px 500px at 100% 100%, rgba(99,102,241,0.16), transparent 65%)," +
          "linear-gradient(180deg, hsl(240 22% 3%) 0%, hsl(240 18% 4%) 50%, hsl(240 22% 3%) 100%)",
      }}
    >
      {/* Animated background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute w-[400px] h-[400px] rounded-full"
          style={{
            top: "10%", left: "-10%",
            background: "radial-gradient(circle, rgba(14,165,233,0.12) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        <motion.div
          animate={{ x: [0, -30, 0], y: [0, 40, 0], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute w-[350px] h-[350px] rounded-full"
          style={{
            bottom: "5%", right: "-8%",
            background: "radial-gradient(circle, rgba(37, 99, 235,0.1) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-2xl overflow-hidden relative"
        style={{
          background: "hsl(240 18% 8% / 0.85)",
          border: "1px solid var(--border)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border-default)" }}>
          {step === "checkout" && !hasBrCode && (
            <button onClick={() => setStep("plan")} className="flex items-center gap-1 text-sm hover:opacity-80 transition-opacity" style={{ color: "var(--text-3)" }}>
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
          )}
          {/* PIX QR (PIX Automático ou subscription) — botão Voltar leva
             pro /register/verify pra que o user troque o método. */}
          {step === "checkout" && hasBrCode && (
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1 text-sm hover:opacity-80 transition-opacity"
              style={{ color: "var(--text-3)" }}
            >
              <ArrowLeft className="w-4 h-4" /> Trocar método
            </button>
          )}
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: "var(--green)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--green)" }}>Checkout Seguro</span>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-xs px-2.5 py-1 rounded-full capitalize font-medium"
            style={{
              background: isAbacatePay ? "rgba(14,165,233,0.15)" : provider === "asaas" ? "rgba(34,197,94,0.15)" : "rgba(99,91,255,0.15)",
              color: isAbacatePay ? "#0ea5e9" : provider === "asaas" ? "#22c55e" : "#635bff",
            }}
          >
            {isAbacatePay ? "AbacatePay" : provider === "asaas" ? "Asaas" : "Stripe"}
          </motion.div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          <AnimatePresence mode="wait">
            {step === "plan" && (
              <motion.div
                key="plan"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                <div className="p-4 rounded-xl" style={{ background: "rgba(37, 99, 235,0.08)", border: "1px solid rgba(37, 99, 235,0.2)" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>{checkoutData?.plan_name || "Plano Pro"}</p>
                      <p className="text-2xl font-semibold" style={{ color: "var(--green)" }}>R$ {checkoutData?.plan_price?.toFixed(2) || "99,00"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>/mês</p>
                      <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>Cobrança mensal</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-sm" style={{ color: "var(--text-3)" }}>
                  <div className="flex justify-between"><span>Acesso a todas funcionalidades</span><Check className="w-4 h-4" style={{ color: "var(--green)" }} /></div>
                  <div className="flex justify-between"><span>Suporte prioritário</span><Check className="w-4 h-4" style={{ color: "var(--green)" }} /></div>
                  <div className="flex justify-between"><span>Cancelamento livre</span><Check className="w-4 h-4" style={{ color: "var(--green)" }} /></div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep("checkout")}
                  className="w-full py-3 rounded-xl font-medium"
                  style={{ background: "var(--green)", color: "white" }}
                >
                  Continuar para pagamento
                </motion.button>
              </motion.div>
            )}

            {step === "checkout" && hasBrCode && (
              <motion.div
                key="pix-qr"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-4"
              >
                {/* PIX QR Code */}
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 180, damping: 18 }}
                    className="inline-flex p-4 rounded-2xl mb-3"
                    style={{ background: "white" }}
                  >
                    <QRCodeSVG
                      value={checkoutData.br_code}
                      size={200}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </motion.div>
                  <p className="text-xs mb-1" style={{ color: "hsl(240 8% 46%)" }}>
                    Escaneie o QR Code com seu celular
                  </p>

                  {/* Countdown timer */}
                  {pixTimeLeft !== null && pixTimeLeft > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: pixTimeLeft < 300 ? [1, 0.5, 1] : 1 }}
                      transition={{ duration: 1, repeat: pixTimeLeft < 300 ? Infinity : 0 }}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full"
                      style={{
                        background: pixTimeLeft < 300 ? "rgba(239,68,68,0.12)" : "rgba(14,165,233,0.1)",
                        color: pixTimeLeft < 300 ? "#ef4444" : "#0ea5e9",
                      }}
                    >
                      <Clock className="w-3 h-3" />
                      Expira em {formatTimeLeft(pixTimeLeft)}
                    </motion.div>
                  )}
                </div>

                {/* PIX code copy */}
                <div className="p-4 rounded-xl" style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
                  <p className="text-[11px] font-mono break-all mb-3 select-all" style={{ color: "var(--text-3)" }}>
                    {checkoutData.br_code}
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={copyPixCode}
                    className="w-full text-xs py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                    style={{
                      background: copied ? "rgba(37, 99, 235,0.2)" : "rgba(14,165,233,0.12)",
                      color: copied ? "#2563EB" : "#0ea5e9",
                    }}
                  >
                    <AnimatePresence mode="wait">
                      {copied ? (
                        <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5" /> Copiado!
                        </motion.span>
                      ) : (
                        <motion.span key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-1.5">
                          <Copy className="w-3.5 h-3.5" /> Copiar código PIX
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </div>

                {/* Total */}
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "rgba(37, 99, 235,0.08)" }}>
                  <span className="text-sm" style={{ color: "var(--text-3)" }}>Total a pagar</span>
                  <span className="text-lg font-semibold" style={{ color: "var(--green)" }}>
                    R$ {checkoutData?.plan_price?.toFixed(2) || "99,00"}
                  </span>
                </div>

                {/* Polling indicator */}
                {pollingPayment && (
                  <div className="flex items-center justify-center gap-2 text-xs" style={{ color: "hsl(240 8% 46%)" }}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Aguardando confirmação do pagamento...
                  </div>
                )}

                {/* PIX expired */}
                {pixTimeLeft !== null && pixTimeLeft <= 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-lg text-center"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    <p className="text-sm font-medium mb-2" style={{ color: "#ef4444" }}>QR Code expirado</p>
                    <button
                      onClick={() => { checkoutCreatedAt.current = null; setPixTimeLeft(null); loadCheckoutData(); }}
                      className="text-xs px-4 py-2 rounded-lg font-medium"
                      style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                    >
                      Gerar novo PIX
                    </button>
                  </motion.div>
                )}

                <p className="text-[10px] text-center" style={{ color: "var(--text-4)" }}>
                  Abra o app do seu banco e escaneie o QR Code para concluir o pagamento
                </p>
              </motion.div>
            )}

            {step === "checkout" && isAsaasSubscription && (
              <motion.div
                key="asaas-sub"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-4"
              >
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
                    style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <QrCode className="w-8 h-8" style={{ color: "#22c55e" }} />
                  </div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Pagamento via PIX — Asaas</p>
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>
                    Sua assinatura foi criada. Clique no botão abaixo para acessar o QR Code PIX.
                  </p>
                </div>

                {checkoutData?.first_invoice_url && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => window.open(checkoutData.first_invoice_url, "_blank")}
                    className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                    style={{ background: "#22c55e", color: "white" }}
                  >
                    <Banknote className="w-4 h-4" />
                    Abrir QR Code PIX
                  </motion.button>
                )}

                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "rgba(37, 99, 235,0.08)" }}>
                  <span className="text-sm" style={{ color: "var(--text-3)" }}>Total a pagar</span>
                  <span className="text-lg font-semibold" style={{ color: "var(--green)" }}>
                    R$ {checkoutData?.plan_price?.toFixed(2) || "99,00"}
                  </span>
                </div>

                {/* Polling indicator */}
                {pollingPayment && (
                  <div className="flex items-center justify-center gap-2 text-xs" style={{ color: "var(--text-3)" }}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Aguardando confirmação do pagamento...
                  </div>
                )}

                <p className="text-[10px] text-center" style={{ color: "var(--text-4)" }}>
                  Após o pagamento, sua conta será ativada automaticamente.
                </p>
              </motion.div>
            )}

            {step === "checkout" && !hasBrCode && !isAsaasSubscription && (
              <motion.div
                key="payment-methods"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-5"
              >
                <div className="space-y-3">
                  <p className="text-xs font-medium" style={{ color: "hsl(240 8% 46%)" }}>Como você prefere pagar?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {paymentOptions.map((m) => (
                      <motion.button
                        key={m.id}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setPaymentMethod(m.id)}
                        className="p-3 rounded-xl border-2 transition-all text-center"
                        style={{
                          borderColor: paymentMethod === m.id ? m.color : "var(--border-default)",
                          background: paymentMethod === m.id ? `${m.color}12` : "transparent",
                        }}
                      >
                        <motion.div
                          animate={{ scale: paymentMethod === m.id ? 1.1 : 1 }}
                          className="mb-1 flex justify-center"
                        >
                          <m.icon size={20} color={paymentMethod === m.id ? m.color : "var(--text-3)"} />
                        </motion.div>
                        <div className="text-xs font-medium" style={{ color: paymentMethod === m.id ? m.color : "var(--text-3)" }}>
                          {m.label}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl" style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
                  <AnimatePresence mode="wait">
                    {paymentMethod === "pix" && (
                      <motion.div key="pix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                        <QrCode className="w-16 h-16 mx-auto mb-3" style={{ color: isAbacatePay ? "#0ea5e9" : "#22c55e" }} />
                        <p className="text-xs mb-3" style={{ color: "hsl(240 8% 46%)" }}>
                          {isAbacatePay ? "Escaneie o QR Code com seu banco" : "Escaneie o QR Code PIX com seu banco"}
                        </p>
                        {hasPaymentLink ? (
                          <button
                            onClick={() => window.open(checkoutData.payment_link, "_blank")}
                            className="text-xs px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity"
                            style={{ background: "rgba(14,165,233,0.15)", color: "#0ea5e9" }}
                          >
                            Abrir link de pagamento
                          </button>
                        ) : (
                          <button
                            onClick={copyPixCode}
                            className="text-xs px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                          >
                            Copiar código Pix
                          </button>
                        )}
                      </motion.div>
                    )}

                    {paymentMethod === "boleto" && (
                      <motion.div key="boleto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                        <FileText className="w-16 h-16 mx-auto mb-3" style={{ color: "#f59e0b" }} />
                        <p className="text-xs mb-3" style={{ color: "hsl(240 8% 46%)" }}>
                          {isAbacatePay ? "O boleto será gerado no portal AbacatePay" : "O boleto será gerado após confirmação"}
                        </p>
                      </motion.div>
                    )}

                    {paymentMethod === "credit_card" && (
                      <motion.div key="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                        <CreditCard className="w-16 h-16 mx-auto mb-3" style={{ color: "#8b5cf6" }} />
                        <p className="text-xs mb-3" style={{ color: "hsl(240 8% 46%)" }}>Pagamento via cartão de crédito</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "rgba(37, 99, 235,0.08)" }}>
                  <span className="text-sm" style={{ color: "var(--text-3)" }}>Total a pagar</span>
                  <span className="text-lg font-semibold" style={{ color: "var(--green)" }}>
                    R$ {checkoutData?.plan_price?.toFixed(2) || "99,00"}
                  </span>
                </div>

                {hasPaymentLink && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => window.open(checkoutData.payment_link, "_blank")}
                    className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                    style={{ background: "#0ea5e9", color: "white" }}
                  >
                    <Banknote className="w-4 h-4" />
                    Abrir no AbacatePay
                  </motion.button>
                )}

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePayment}
                  disabled={processing}
                  className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-opacity"
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
                </motion.button>

                <p className="text-[10px] text-center" style={{ color: "var(--text-4)" }}>
                  Ao confirmar, você concorda com os termos de uso. O pagamento será processado de forma segura.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
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
