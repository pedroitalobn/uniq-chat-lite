"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, ArrowRight, Loader2, AlertCircle,
  CheckCircle2, RefreshCw, ExternalLink, ArrowLeft, Sparkles,
} from "lucide-react";
import { Logo } from "@/components/Logo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ── animation variants ────────────────────────────────────────────────────────
const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40 }),
};

const inputCls =
  "w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-150 bg-[hsl(240_18%_5%)] border text-[hsl(240_15%_92%)] placeholder:text-[hsl(240_8%_38%)]";

function InputField({
  label, type = "text", value, onChange, placeholder, autoFocus, icon,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoFocus?: boolean; icon?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[hsl(240_15%_65%)]">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(240_8%_40%)]">
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
            borderColor: focused ? "#00d46a" : "hsl(240 12% 13%)",
            boxShadow: focused ? "0 0 0 3px rgba(0,212,106,0.10)" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ── Step 1: Email ─────────────────────────────────────────────────────────────
function StepEmail({
  onSent, planName, planID, planPrice,
}: {
  onSent: (email: string) => void;
  planName?: string;
  planID?: string;
  planPrice?: number;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isConflict, setIsConflict] = useState(false);
  const isPaid = !!planName && (planPrice ?? 0) > 0;
  const priceLabel = (planPrice ?? 0) > 0
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(planPrice as number)
    : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError("E-mail é obrigatório"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError("E-mail inválido"); return; }
    setError(""); setIsConflict(false); setLoading(true);
    try {
      const res = await fetch(`${API}/v1/auth/register/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, plan_id: planID || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIsConflict(res.status === 409);
        setError(data.error || "Erro ao enviar link");
        return;
      }
      onSent(trimmed);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold text-[hsl(240_15%_92%)] tracking-tight">
          Crie sua conta
        </h1>
        {planName ? (
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{
                background: isPaid ? "rgba(0,212,106,0.10)" : "rgba(99,91,255,0.10)",
                border: `1px solid ${isPaid ? "rgba(0,212,106,0.25)" : "rgba(99,91,255,0.25)"}`,
                color: isPaid ? "#00d46a" : "#a5a3ff",
              }}
            >
              <Sparkles className="w-3 h-3" />
              Plano {planName}
              {isPaid && (
                <span className="ml-1 opacity-80">· {priceLabel}/mês</span>
              )}
            </span>
          </div>
        ) : (
          <p className="text-sm text-[hsl(240_8%_50%)] leading-relaxed">
            Comece grátis — sem cartão de crédito
          </p>
        )}
      </div>

      <InputField
        label="Seu e-mail profissional"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="nome@empresa.com"
        autoFocus
        icon={<Mail className="w-4 h-4" />}
      />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl border text-sm"
          style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)", color: "#fca5a5" }}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {error}
            {isConflict && (
              <>{" "}<Link href={`/login?email=${encodeURIComponent(email)}`}
                className="underline underline-offset-2 font-medium" style={{ color: "#00d46a" }}>
                Fazer login →
              </Link></>
            )}
          </span>
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
          : <><span>Continuar</span><ArrowRight className="w-4 h-4" /></>}
      </button>

      <p className="text-center text-xs text-[hsl(240_8%_38%)]">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium hover:opacity-80 transition-opacity" style={{ color: "#00d46a" }}>
          Fazer login
        </Link>
      </p>
    </form>
  );
}

// ── Step 2: Check email ───────────────────────────────────────────────────────
function StepCheckEmail({ email, onBack }: { email: string; onBack: () => void }) {
  const [cooldown, setCooldown] = useState(60);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startTimer() {
    setCooldown(60);
    timerRef.current = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    startTimer();
    return () => clearInterval(timerRef.current!);
  }, []);

  async function resend() {
    setResending(true); setResent(false);
    try {
      await fetch(`${API}/v1/auth/register/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
      startTimer();
    } finally {
      setResending(false);
    }
  }

  const domain = email.split("@")[1] ?? "";
  const gmailLink = domain === "gmail.com" ? "https://mail.google.com" : null;
  const outlookLink = ["outlook.com", "hotmail.com", "live.com"].includes(domain)
    ? "https://outlook.live.com" : null;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      {/* Animated envelope */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="relative"
      >
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl select-none"
          style={{ background: "rgba(0,212,106,0.07)", border: "1px solid rgba(0,212,106,0.18)" }}
        >
          ✉️
        </div>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.35, type: "spring", stiffness: 400 }}
          className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: "#00d46a" }}
        >
          <CheckCircle2 className="w-4 h-4" style={{ color: "#050508" }} />
        </motion.div>
      </motion.div>

      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-[hsl(240_15%_92%)]">Verifique seu e-mail</h2>
        <p className="text-sm text-[hsl(240_8%_50%)] leading-relaxed">
          Enviamos um link de acesso para<br />
          <span className="text-[hsl(240_15%_80%)] font-medium">{email}</span>
        </p>
      </div>

      {/* Open email client shortcuts */}
      <div className="flex gap-2 w-full">
        {(gmailLink || outlookLink) ? (
          <a
            href={(gmailLink ?? outlookLink)!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
            style={{ background: "hsl(240 12% 8%)", border: "1px solid hsl(240 12% 14%)", color: "hsl(240 15% 72%)" }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir {gmailLink ? "Gmail" : "Outlook"}
          </a>
        ) : (
          <div
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm"
            style={{ background: "hsl(240 12% 8%)", border: "1px solid hsl(240 12% 14%)", color: "hsl(240 8% 45%)" }}
          >
            <Mail className="w-3.5 h-3.5" />
            Verifique sua caixa de entrada
          </div>
        )}
      </div>

      {/* Hint */}
      <p className="text-xs text-[hsl(240_8%_38%)] -mt-2">
        O link expira em 30 minutos. Verifique a pasta de spam.
      </p>

      {/* Resend */}
      <div className="flex flex-col items-center gap-1.5">
        {resent && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs font-medium"
            style={{ color: "#00d46a" }}
          >
            Novo link enviado!
          </motion.p>
        )}
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0 || resending}
          className="flex items-center gap-1.5 text-xs disabled:opacity-50 transition-all"
          style={{ color: cooldown > 0 ? "hsl(240 8% 38%)" : "#00d46a" }}
        >
          {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar link"}
        </button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-[hsl(240_8%_38%)] hover:text-[hsl(240_15%_65%)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Trocar e-mail
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
function RegisterContent() {
  const params = useSearchParams();
  const planName = params.get("plan") || undefined;
  const planID = params.get("plan_id") || undefined;
  const priceParam = params.get("price");
  const planPrice = priceParam ? Number(priceParam) : undefined;

  const [step, setStep] = useState<0 | 1>(0);
  const [email, setEmail] = useState("");
  const [dir, setDir] = useState(1);

  function goToCheck(sentEmail: string) {
    setEmail(sentEmail); setDir(1); setStep(1);
  }

  function goBack() {
    setDir(-1); setStep(0);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "hsl(240 18% 4%)" }}>
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex justify-center">
          <Logo />
        </div>

        {/* Step indicator (dots + line) */}
        <div className="flex items-center justify-center gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-1">
              <div
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 24 : 7,
                  height: 7,
                  background: i < step
                    ? "#00d46a"
                    : i === step
                      ? "#00d46a"
                      : "hsl(240 12% 16%)",
                  opacity: i > step ? 0.5 : 1,
                }}
              />
              {i < 2 && (
                <div
                  className="h-px w-6 transition-all duration-500"
                  style={{ background: i < step ? "#00d46a" : "hsl(240 12% 16%)" }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7 overflow-hidden"
          style={{
            background: "hsl(240 18% 6%)",
            border: "1px solid hsl(240 12% 11%)",
            boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
          }}
        >
          <AnimatePresence custom={dir} mode="wait">
            {step === 0 ? (
              <motion.div key="email" custom={dir} variants={slide}
                initial="enter" animate="center" exit="exit"
                transition={{ duration: 0.2, ease: "easeInOut" }}>
                <StepEmail onSent={goToCheck} planName={planName} planID={planID} planPrice={planPrice} />
              </motion.div>
            ) : (
              <motion.div key="check" custom={dir} variants={slide}
                initial="enter" animate="center" exit="exit"
                transition={{ duration: 0.2, ease: "easeInOut" }}>
                <StepCheckEmail email={email} onBack={goBack} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-xs text-[hsl(240_8%_32%)]">
          Ao continuar você concorda com os{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-[hsl(240_8%_50%)] transition-colors">
            Termos
          </Link>{" "}
          e a{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-[hsl(240_8%_50%)] transition-colors">
            Privacidade
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterContent />
    </Suspense>
  );
}
