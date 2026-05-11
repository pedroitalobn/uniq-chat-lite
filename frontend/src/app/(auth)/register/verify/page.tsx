"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Building2, AtSign, Lock, Eye, EyeOff,
  ArrowRight, Loader2, AlertCircle, CheckCircle2, XCircle, FileText,
} from "lucide-react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ── shared input ──────────────────────────────────────────────────────────────
const inputCls =
  "w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-150 bg-[hsl(240_18%_5%)] border text-[hsl(240_15%_92%)] placeholder:text-[hsl(240_8%_38%)]";

const PHONE_COUNTRIES = [
  { code: "BR", name: "Brasil", dial: "55", flag: "🇧🇷" },
  { code: "US", name: "Estados Unidos", dial: "1", flag: "🇺🇸" },
  { code: "PT", name: "Portugal", dial: "351", flag: "🇵🇹" },
  { code: "GB", name: "Reino Unido", dial: "44", flag: "🇬🇧" },
  { code: "CA", name: "Canadá", dial: "1", flag: "🇨🇦" },
  { code: "MX", name: "México", dial: "52", flag: "🇲🇽" },
  { code: "AR", name: "Argentina", dial: "54", flag: "🇦🇷" },
  { code: "CL", name: "Chile", dial: "56", flag: "🇨🇱" },
  { code: "CO", name: "Colômbia", dial: "57", flag: "🇨🇴" },
  { code: "ES", name: "Espanha", dial: "34", flag: "🇪🇸" },
  { code: "FR", name: "França", dial: "33", flag: "🇫🇷" },
  { code: "DE", name: "Alemanha", dial: "49", flag: "🇩🇪" },
  { code: "IT", name: "Itália", dial: "39", flag: "🇮🇹" },
  { code: "AU", name: "Austrália", dial: "61", flag: "🇦🇺" },
  { code: "JP", name: "Japão", dial: "81", flag: "🇯🇵" },
];

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

function PhoneField({
  countryCode, onCountryChange, localPhone, onLocalPhoneChange, error,
}: {
  countryCode: string;
  onCountryChange: (v: string) => void;
  localPhone: string;
  onLocalPhoneChange: (v: string) => void;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const selected = PHONE_COUNTRIES.find((c) => c.code === countryCode) ?? PHONE_COUNTRIES[0];
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[hsl(240_15%_65%)]">Celular</label>
      <div
        className="grid grid-cols-[minmax(112px,132px)_1fr] rounded-xl border overflow-hidden transition-all duration-150 bg-[hsl(240_18%_5%)]"
        style={{
          borderColor: error ? "rgba(239,68,68,0.5)" : focused ? "#00d46a" : "hsl(240 12% 13%)",
          boxShadow: error
            ? "0 0 0 3px rgba(239,68,68,0.08)"
            : focused ? "0 0 0 3px rgba(0,212,106,0.10)" : "none",
        }}
      >
        <div className="relative border-r border-[hsl(240_12%_13%)]">
          <select
            aria-label="País do celular"
            value={countryCode}
            onChange={(e) => onCountryChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="w-full h-full min-h-[46px] appearance-none bg-transparent pl-3 pr-7 text-sm outline-none text-[hsl(240_15%_92%)]"
          >
            {PHONE_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.flag} +{country.dial}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[hsl(240_8%_45%)]">
            ▾
          </span>
        </div>
        <input
          type="tel"
          value={localPhone}
          onChange={(e) => onLocalPhoneChange(e.target.value.replace(/[^\d\s().-]/g, "").slice(0, 22))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={selected.code === "US" ? "(415) 555-0199" : "11 99999-8888"}
          className="w-full min-w-0 px-4 py-3 text-sm outline-none bg-transparent text-[hsl(240_15%_92%)] placeholder:text-[hsl(240_8%_38%)]"
        />
      </div>
      {!error && (
        <p className="text-xs text-[hsl(240_8%_38%)] pl-0.5">
          {selected.name} (+{selected.dial})
        </p>
      )}
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

interface PlanOption {
  id: string;
  name: string;
  price: number;
  currency?: string;
  description?: string;
  is_default?: boolean;
}

function CompleteForm({
  email, pendingId, prefilledPlanID, prefilledPlanName, prefilledPlanPrice,
}: {
  email: string;
  pendingId: string;
  prefilledPlanID?: string;
  prefilledPlanName?: string;
  prefilledPlanPrice?: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [company, setCompany] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("BR");
  const [localPhone, setLocalPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Quando o pending já traz plan_id (user veio de /plans → /register?plan_id=...)
  // pulamos o picker — ele já escolheu, não faz sentido perguntar de novo.
  // Caso contrário busca a lista pública e deixa escolher.
  const hasPrefilledPlan = !!prefilledPlanID;
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedPlanID, setSelectedPlanID] = useState<string>(prefilledPlanID ?? "");
  const [loadingPlans, setLoadingPlans] = useState(!hasPrefilledPlan);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (hasPrefilledPlan) return;
    let cancelled = false;
    async function loadPlans() {
      try {
        const r = await fetch(`${API}/v1/payments/plans`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const items: PlanOption[] = Array.isArray(data) ? data : data.items ?? data.plans ?? [];
        setPlans(items);
        const def = items.find((p) => p.is_default) ?? items.find((p) => p.price === 0) ?? items[0];
        if (def) setSelectedPlanID(def.id);
      } catch {
        /* sem rede — segue sem plan picker, registra como free */
      } finally {
        if (!cancelled) setLoadingPlans(false);
      }
    }
    loadPlans();
    return () => { cancelled = true; };
  }, [hasPrefilledPlan]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanID);
  const isPaid = hasPrefilledPlan
    ? (prefilledPlanPrice ?? 0) > 0
    : !!selectedPlan && selectedPlan.price > 0;
  const planLabel = hasPrefilledPlan ? prefilledPlanName : selectedPlan?.name;
  const planPriceVal = hasPrefilledPlan ? prefilledPlanPrice : selectedPlan?.price;

  function phoneDigits(v: string) {
    return v.replace(/\D/g, "");
  }

  function fullPhoneDigits() {
    const country = PHONE_COUNTRIES.find((c) => c.code === phoneCountry) ?? PHONE_COUNTRIES[0];
    return country.dial + phoneDigits(localPhone);
  }

  function normalizeTaxIDInput(v: string) {
    return v.replace(/[^a-zA-Z0-9.\-/\s]/g, "").toUpperCase().slice(0, 64);
  }

  function taxIDValue(v: string) {
    return normalizeTaxIDInput(v).trim();
  }

  function taxIDLength(v: string) {
    return v.replace(/[^a-zA-Z0-9]/g, "").length;
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Nome é obrigatório";
    const localDigits = phoneDigits(localPhone);
    const rawPhone = fullPhoneDigits();
    if (!localDigits) e.phone = "Celular é obrigatório";
    else if (rawPhone.length < 8 || rawPhone.length > 15) e.phone = "Celular inválido para o país selecionado";
    const rawTaxID = taxIDValue(taxId);
    const taxLen = taxIDLength(rawTaxID);
    if (!rawTaxID) e.taxId = "CPF, CNPJ ou Tax ID é obrigatório";
    else if (taxLen < 4 || taxLen > 32) e.taxId = "Identificador fiscal inválido";
    if (password.length < 8) e.password = "Mínimo 8 caracteres";
    if (confirmPassword !== password) e.confirmPassword = "Senhas não coincidem";
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
          phone: fullPhoneDigits(),
          country_code: phoneCountry,
          tax_id: taxIDValue(taxId),
          plan_id: selectedPlanID || undefined,
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

      // Paid plan, redirect checkout (Stripe hosted / AbacatePay redirect)
      if (data.checkout_type === "redirect") {
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        setErrors({ global: data.message || "Erro ao gerar link de pagamento. Verifique se o gateway está configurado." });
        return;
      }
      // Paid plan, transparent PIX (AbacatePay)
      if (data.checkout_type === "transparent" && data.br_code) {
        const params = new URLSearchParams({
          br_code: data.br_code,
          br_code_base64: data.br_code_base64 ?? "",
          plan_name: data.plan_name ?? "",
          plan_price: String(data.plan_price ?? ""),
          email,
        });
        if (data.pending_id) params.set("pending_id", data.pending_id);
        if (data.checkout_id) params.set("checkout_id", data.checkout_id);
        router.push(`/checkout?${params.toString()}`);
        return;
      }
      // Paid plan, transparent — leva pro próximo passo de pagamento
      // dentro do app (PaymentElement do Stripe).
      if (data.checkout_type === "transparent" && data.client_secret) {
        const params = new URLSearchParams({
          client_secret: data.client_secret,
          plan_name: data.plan_name ?? "",
          plan_price: String(data.plan_price ?? ""),
          email,
        });
        if (data.pending_id) params.set("pending_id", data.pending_id);
        if (data.payment_intent_id) params.set("payment_intent_id", data.payment_intent_id);
        router.push(`/checkout?${params.toString()}`);
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

      <PhoneField
        countryCode={phoneCountry}
        onCountryChange={setPhoneCountry}
        localPhone={localPhone}
        onLocalPhoneChange={setLocalPhone}
        error={errors.phone}
      />

      <Field label="CPF, CNPJ ou Tax ID" value={taxId} onChange={v => setTaxId(normalizeTaxIDInput(v))}
        placeholder="CPF, CNPJ, SSN, ITIN ou EIN" icon={<FileText className="w-4 h-4" />}
        hint="Brasil: CPF/CNPJ. EUA: SSN/ITIN/EIN. Outros países: ID fiscal local." error={errors.taxId} />

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

      <Field
        label="Repita a senha"
        type={showConfirm ? "text" : "password"}
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Digite a senha novamente"
        icon={<Lock className="w-4 h-4" />}
        error={errors.confirmPassword}
        rightEl={
          <button type="button" onClick={() => setShowConfirm(s => !s)}
            className="text-[hsl(240_8%_40%)] hover:text-[hsl(240_15%_65%)] transition-colors">
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        }
      />

      {hasPrefilledPlan && planLabel && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-[hsl(240_15%_65%)]">Plano selecionado</label>
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
            style={{
              background: isPaid ? "rgba(0,212,106,0.06)" : "rgba(99,91,255,0.06)",
              border: `1px solid ${isPaid ? "rgba(0,212,106,0.25)" : "rgba(99,91,255,0.25)"}`,
            }}>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-[hsl(240_15%_92%)]">{planLabel}</span>
              <span className="text-xs text-[hsl(240_8%_50%)]">
                {isPaid
                  ? "Você será redirecionado para o pagamento após criar o perfil."
                  : "Plano grátis — sem cartão de crédito."}
              </span>
            </div>
            <span className="text-sm font-semibold" style={{ color: isPaid ? "#00d46a" : "#a5a3ff" }}>
              {(planPriceVal ?? 0) > 0
                ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(planPriceVal as number)
                : "Grátis"}
            </span>
          </div>
        </div>
      )}

      {!hasPrefilledPlan && !loadingPlans && plans.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-[hsl(240_15%_65%)]">Escolha seu plano</label>
          <div className="grid grid-cols-1 gap-2">
            {plans.map((p) => {
              const active = p.id === selectedPlanID;
              const priceLabel = p.price === 0
                ? "Grátis"
                : new Intl.NumberFormat("pt-BR", { style: "currency", currency: p.currency || "BRL" }).format(p.price);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlanID(p.id)}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-left transition-all"
                  style={{
                    background: active ? "rgba(0,212,106,0.06)" : "hsl(240 18% 5%)",
                    border: `1px solid ${active ? "#00d46a" : "hsl(240 12% 13%)"}`,
                    boxShadow: active ? "0 0 0 3px rgba(0,212,106,0.10)" : "none",
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-[hsl(240_15%_92%)]">{p.name}</span>
                    {p.description && (
                      <span className="text-xs text-[hsl(240_8%_50%)]">{p.description}</span>
                    )}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: active ? "#00d46a" : "hsl(240 15% 80%)" }}>
                    {priceLabel}
                  </span>
                </button>
              );
            })}
          </div>
          {isPaid && (
            <p className="text-xs text-[hsl(240_8%_50%)] pl-0.5">
              Você será redirecionado para o pagamento após criar o perfil.
            </p>
          )}
        </div>
      )}

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
          : <><span>{isPaid ? "Continuar para pagamento" : "Criar conta"}</span><ArrowRight className="w-4 h-4" /></>}
      </button>
    </form>
  );
}

// ── Token validation states ───────────────────────────────────────────────────
type TokenState =
  | { status: "loading" }
  | { status: "valid"; email: string; pendingId: string; planID?: string; planName?: string; planPrice?: number }
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
        setState({
          status: "valid",
          email: data.email,
          pendingId: data.pending_registration_id,
          planID: data.plan_id ?? undefined,
          planName: data.plan_name ?? undefined,
          planPrice: typeof data.plan_price === "number" ? data.plan_price : undefined,
        });
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
            background: "var(--surface-solid)",
            border: "1px solid var(--border)",
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
                <CompleteForm
                  email={state.email}
                  pendingId={state.pendingId}
                  prefilledPlanID={state.planID}
                  prefilledPlanName={state.planName}
                  prefilledPlanPrice={state.planPrice}
                />
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
