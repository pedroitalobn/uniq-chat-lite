"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Building2, Lock, Eye, EyeOff,
  ArrowRight, Loader2, AlertCircle, CheckCircle2, XCircle, FileText,
  Search, ChevronDown, ShieldCheck, BadgeCheck, KeyRound,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ── shared input ──────────────────────────────────────────────────────────────
const inputCls =
  "w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-150 bg-[hsl(240_18%_5%)] border text-[hsl(240_15%_92%)] placeholder:text-[hsl(240_8%_38%)]";

type PhoneCountry = {
  code: string;
  name: string;
  dial: string;
  flag: string;
  aliases?: string[];
};

const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "BR", name: "Brasil", dial: "55", flag: "🇧🇷", aliases: ["Brazil"] },
  { code: "US", name: "Estados Unidos", dial: "1", flag: "🇺🇸", aliases: ["United States", "USA", "EUA", "America"] },
  { code: "CA", name: "Canadá", dial: "1", flag: "🇨🇦", aliases: ["Canada"] },
  { code: "PT", name: "Portugal", dial: "351", flag: "🇵🇹" },
  { code: "GB", name: "Reino Unido", dial: "44", flag: "🇬🇧", aliases: ["United Kingdom", "UK", "Great Britain", "Inglaterra"] },
  { code: "MX", name: "México", dial: "52", flag: "🇲🇽", aliases: ["Mexico"] },
  { code: "AR", name: "Argentina", dial: "54", flag: "🇦🇷" },
  { code: "CL", name: "Chile", dial: "56", flag: "🇨🇱" },
  { code: "CO", name: "Colômbia", dial: "57", flag: "🇨🇴", aliases: ["Colombia"] },
  { code: "ES", name: "Espanha", dial: "34", flag: "🇪🇸", aliases: ["Spain"] },
  { code: "FR", name: "França", dial: "33", flag: "🇫🇷", aliases: ["France"] },
  { code: "DE", name: "Alemanha", dial: "49", flag: "🇩🇪", aliases: ["Germany", "Deutschland"] },
  { code: "IT", name: "Itália", dial: "39", flag: "🇮🇹", aliases: ["Italy"] },
  { code: "AU", name: "Austrália", dial: "61", flag: "🇦🇺", aliases: ["Australia"] },
  { code: "JP", name: "Japão", dial: "81", flag: "🇯🇵", aliases: ["Japan"] },
  { code: "AF", name: "Afeganistão", dial: "93", flag: "🇦🇫", aliases: ["Afghanistan"] },
  { code: "AO", name: "Angola", dial: "244", flag: "🇦🇴" },
  { code: "BE", name: "Bélgica", dial: "32", flag: "🇧🇪", aliases: ["Belgium"] },
  { code: "BO", name: "Bolívia", dial: "591", flag: "🇧🇴", aliases: ["Bolivia"] },
  { code: "CH", name: "Suíça", dial: "41", flag: "🇨🇭", aliases: ["Switzerland", "Suisse", "Schweiz"] },
  { code: "CN", name: "China", dial: "86", flag: "🇨🇳" },
  { code: "CR", name: "Costa Rica", dial: "506", flag: "🇨🇷" },
  { code: "CU", name: "Cuba", dial: "53", flag: "🇨🇺" },
  { code: "DO", name: "República Dominicana", dial: "1", flag: "🇩🇴", aliases: ["Dominican Republic"] },
  { code: "EC", name: "Equador", dial: "593", flag: "🇪🇨", aliases: ["Ecuador"] },
  { code: "EG", name: "Egito", dial: "20", flag: "🇪🇬", aliases: ["Egypt"] },
  { code: "GT", name: "Guatemala", dial: "502", flag: "🇬🇹" },
  { code: "HN", name: "Honduras", dial: "504", flag: "🇭🇳" },
  { code: "IE", name: "Irlanda", dial: "353", flag: "🇮🇪", aliases: ["Ireland"] },
  { code: "IN", name: "Índia", dial: "91", flag: "🇮🇳", aliases: ["India"] },
  { code: "IL", name: "Israel", dial: "972", flag: "🇮🇱" },
  { code: "KR", name: "Coreia do Sul", dial: "82", flag: "🇰🇷", aliases: ["South Korea", "Korea"] },
  { code: "MA", name: "Marrocos", dial: "212", flag: "🇲🇦", aliases: ["Morocco"] },
  { code: "MZ", name: "Moçambique", dial: "258", flag: "🇲🇿", aliases: ["Mozambique"] },
  { code: "NI", name: "Nicarágua", dial: "505", flag: "🇳🇮", aliases: ["Nicaragua"] },
  { code: "NL", name: "Países Baixos", dial: "31", flag: "🇳🇱", aliases: ["Netherlands", "Holland", "Holanda"] },
  { code: "PA", name: "Panamá", dial: "507", flag: "🇵🇦", aliases: ["Panama"] },
  { code: "PE", name: "Peru", dial: "51", flag: "🇵🇪" },
  { code: "PY", name: "Paraguai", dial: "595", flag: "🇵🇾", aliases: ["Paraguay"] },
  { code: "RO", name: "Romênia", dial: "40", flag: "🇷🇴", aliases: ["Romania"] },
  { code: "RU", name: "Rússia", dial: "7", flag: "🇷🇺", aliases: ["Russia"] },
  { code: "SV", name: "El Salvador", dial: "503", flag: "🇸🇻" },
  { code: "TR", name: "Turquia", dial: "90", flag: "🇹🇷", aliases: ["Turkey"] },
  { code: "UA", name: "Ucrânia", dial: "380", flag: "🇺🇦", aliases: ["Ukraine"] },
  { code: "UY", name: "Uruguai", dial: "598", flag: "🇺🇾", aliases: ["Uruguay"] },
  { code: "VE", name: "Venezuela", dial: "58", flag: "🇻🇪" },
  { code: "ZA", name: "África do Sul", dial: "27", flag: "🇿🇦", aliases: ["South Africa"] },
  { code: "AE", name: "Emirados Árabes Unidos", dial: "971", flag: "🇦🇪", aliases: ["United Arab Emirates", "UAE"] },
  { code: "AT", name: "Áustria", dial: "43", flag: "🇦🇹", aliases: ["Austria"] },
  { code: "BG", name: "Bulgária", dial: "359", flag: "🇧🇬", aliases: ["Bulgaria"] },
  { code: "CZ", name: "Tchéquia", dial: "420", flag: "🇨🇿", aliases: ["Czechia", "Czech Republic"] },
  { code: "DK", name: "Dinamarca", dial: "45", flag: "🇩🇰", aliases: ["Denmark"] },
  { code: "FI", name: "Finlândia", dial: "358", flag: "🇫🇮", aliases: ["Finland"] },
  { code: "GR", name: "Grécia", dial: "30", flag: "🇬🇷", aliases: ["Greece"] },
  { code: "HR", name: "Croácia", dial: "385", flag: "🇭🇷", aliases: ["Croatia"] },
  { code: "HU", name: "Hungria", dial: "36", flag: "🇭🇺", aliases: ["Hungary"] },
  { code: "ID", name: "Indonésia", dial: "62", flag: "🇮🇩", aliases: ["Indonesia"] },
  { code: "MY", name: "Malásia", dial: "60", flag: "🇲🇾", aliases: ["Malaysia"] },
  { code: "NO", name: "Noruega", dial: "47", flag: "🇳🇴", aliases: ["Norway"] },
  { code: "NZ", name: "Nova Zelândia", dial: "64", flag: "🇳🇿", aliases: ["New Zealand"] },
  { code: "PH", name: "Filipinas", dial: "63", flag: "🇵🇭", aliases: ["Philippines"] },
  { code: "PL", name: "Polônia", dial: "48", flag: "🇵🇱", aliases: ["Poland"] },
  { code: "PR", name: "Porto Rico", dial: "1", flag: "🇵🇷", aliases: ["Puerto Rico"] },
  { code: "SA", name: "Arábia Saudita", dial: "966", flag: "🇸🇦", aliases: ["Saudi Arabia"] },
  { code: "SE", name: "Suécia", dial: "46", flag: "🇸🇪", aliases: ["Sweden"] },
  { code: "SG", name: "Singapura", dial: "65", flag: "🇸🇬", aliases: ["Singapore"] },
  { code: "TH", name: "Tailândia", dial: "66", flag: "🇹🇭", aliases: ["Thailand"] },
  { code: "VN", name: "Vietnã", dial: "84", flag: "🇻🇳", aliases: ["Vietnam"] },
];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9+]/g, "")
    .toLowerCase();
}

function countrySearchHaystack(country: PhoneCountry) {
  return normalizeSearchText([
    country.code,
    country.name,
    country.dial,
    `+${country.dial}`,
    ...(country.aliases ?? []),
  ].join(" "));
}

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
            borderColor: error ? "rgba(239,68,68,0.5)" : focused ? "#2563EB" : "var(--border-default)",
            boxShadow: error
              ? "0 0 0 3px rgba(239,68,68,0.08)"
              : focused ? "0 0 0 3px rgba(37, 99, 235,0.10)" : "none",
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
  const [open, setOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const selected = PHONE_COUNTRIES.find((c) => c.code === countryCode) ?? PHONE_COUNTRIES[0];
  const filteredCountries = useMemo(() => {
    const query = normalizeSearchText(countryQuery);
    if (!query) return PHONE_COUNTRIES;
    return PHONE_COUNTRIES.filter((country) => countrySearchHaystack(country).includes(query));
  }, [countryQuery]);

  function chooseCountry(country: PhoneCountry) {
    onCountryChange(country.code);
    setCountryQuery("");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[hsl(240_15%_65%)]">Celular</label>
      <div
        className="grid grid-cols-[92px_1fr] sm:grid-cols-[104px_1fr] rounded-xl border transition-all duration-150 bg-[hsl(240_18%_5%)]"
        style={{
          borderColor: error ? "rgba(239,68,68,0.5)" : focused ? "#2563EB" : "var(--border-default)",
          boxShadow: error
            ? "0 0 0 3px rgba(239,68,68,0.08)"
            : focused ? "0 0 0 3px rgba(37, 99, 235,0.10)" : "none",
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
            setOpen(false);
          }
        }}
      >
        <div className="relative border-r border-[hsl(240_12%_13%)]">
          <button
            type="button"
            aria-label="País do celular"
            aria-expanded={open}
            onClick={() => {
              setFocused(true);
              setOpen((v) => !v);
            }}
            onFocus={() => setFocused(true)}
            className="flex h-full min-h-[46px] w-full items-center justify-between gap-2 bg-transparent pl-3 pr-2 text-left text-sm outline-none text-[hsl(240_15%_92%)]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span>{selected.flag}</span>
              <span className="truncate">+{selected.dial}</span>
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[hsl(240_8%_45%)] transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div
              className="absolute left-0 top-[calc(100%+6px)] z-30 w-[min(330px,calc(100vw-48px))] rounded-xl border bg-[hsl(240_18%_5%)] shadow-2xl"
              style={{ borderColor: "var(--border-default)" }}
            >
              <div className="relative border-b border-[hsl(240_12%_13%)] p-2">
                <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(240_8%_45%)]" />
                <input
                  autoFocus
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setOpen(false);
                    }
                    if (e.key === "Enter" && filteredCountries[0]) {
                      e.preventDefault();
                      chooseCountry(filteredCountries[0]);
                    }
                  }}
                  placeholder="Buscar país, sigla ou DDI"
                  className="w-full rounded-lg border border-[hsl(240_12%_13%)] bg-[hsl(240_16%_8%)] py-2 pl-9 pr-3 text-sm outline-none text-[hsl(240_15%_92%)] placeholder:text-[hsl(240_8%_38%)]"
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredCountries.length > 0 ? (
                  filteredCountries.map((country) => (
                    <button
                      key={country.code}
                      type="button"
                      onClick={() => chooseCountry(country)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[hsl(240_14%_10%)]"
                      style={{ color: country.code === countryCode ? "#2563EB" : "hsl(240 15% 92%)" }}
                    >
                      <span className="text-base">{country.flag}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{country.name}</span>
                        <span className="block text-xs text-[hsl(240_8%_45%)]">{country.code} · +{country.dial}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-6 text-center text-xs text-[hsl(240_8%_45%)]">
                    Nenhum país encontrado
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <input
          type="tel"
          value={localPhone}
          onChange={(e) => onLocalPhoneChange(e.target.value.replace(/[^\d\s().-]/g, "").slice(0, 22))}
          onFocus={() => setFocused(true)}
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
  const colors = ["#ef4444", "#fb923c", "#2563EB"];
  const labels = ["Fraca", "Média", "Forte"];

  if (!password) return null;
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
      className="flex flex-col gap-2 overflow-hidden">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
            style={{ background: i < score ? colors[score - 1] : "var(--border-default)" }} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {checks.map(c => (
            <span key={c.label} className="flex items-center gap-1 text-xs"
              style={{ color: c.ok ? "#2563EB" : "hsl(240 8% 38%)" }}>
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

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value == null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    const serialized = safeText(value, "");
    if (serialized) return serialized;
  }
  return fallback;
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
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [company, setCompany] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("BR");
  const [localPhone, setLocalPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [step, setStep] = useState(0);
  // Asaas: forma de pagamento. Default PIX Automático (consentimento +
  // débitos auto). Cartão usa CREDIT_CARD transparente.
  // null = ainda não escolheu. Forçar a escolha evita disparo de PIX
  // sem o user ter realmente decidido.
  const [asaasMethod, setAsaasMethod] = useState<"pix_automatic" | "credit_card" | null>(null);
  // Métodos habilitados pelo admin para o provider ativo. Vazio = todos.
  const [allowedAsaasMethods, setAllowedAsaasMethods] = useState<string[]>(["pix_automatic", "credit_card"]);
  // Quando o user finaliza com PIX Automático, exibimos o QR inline aqui
  // mesmo no modal (sem redirect pra /checkout). "Trocar método" vira
  // só um setPixQrState(null) — o form fica intacto.
  const [pixQrState, setPixQrState] = useState<null | {
    brCode: string;
    brCodeBase64: string;
    planName: string;
    planPrice: number;
    authorizationId: string;
  }>(null);
  const [card, setCard] = useState({
    holderName: "",
    number: "",
    expiryMonth: "",
    expiryYear: "",
    cvv: "",
    postalCode: "",
    addressNumber: "",
  });
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
        const rawItems: any[] = Array.isArray(data) ? data : data.items ?? data.plans ?? [];
        const items: PlanOption[] = rawItems.map((item) => ({
          id: safeText(item?.id),
          name: safeText(item?.name, "Plano"),
          price: typeof item?.price === "number" ? item.price : Number(item?.price ?? 0),
          currency: safeText(item?.currency || "", ""),
          description: safeText(item?.description || "", ""),
          is_default: Boolean(item?.is_default),
        })).filter((item) => item.id);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/v1/payments/methods`);
        if (!r.ok) return;
        const data: { asaas?: string[] } = await r.json();
        if (cancelled) return;
        if (Array.isArray(data.asaas) && data.asaas.length > 0) {
          setAllowedAsaasMethods(data.asaas);
        }
      } catch { /* sem rede — usa default */ }
    })();
    return () => { cancelled = true; };
  }, []);

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

  function validateStep(nextStep = step) {
    const e: Record<string, string> = {};
    if (nextStep === 0) {
      if (!name.trim()) e.name = "Nome é obrigatório";
      if (accountType === "business" && !company.trim()) e.company = "Nome da empresa é obrigatório";
    }
    if (nextStep === 1) {
      const localDigits = phoneDigits(localPhone);
      const rawPhone = fullPhoneDigits();
      if (!localDigits) e.phone = "Celular é obrigatório";
      else if (rawPhone.length < 8 || rawPhone.length > 15) e.phone = "Celular inválido para o país selecionado";

      const rawTaxID = taxIDValue(taxId);
      const taxLen = taxIDLength(rawTaxID);
      if (!rawTaxID) {
        e.taxId = accountType === "business"
          ? "CNPJ, EIN ou Tax ID da empresa é obrigatório"
          : "CPF ou Tax ID é obrigatório";
      } else if (taxLen < 4 || taxLen > 32) {
        e.taxId = "Identificador fiscal inválido";
      }

    }
    if (nextStep === 2) {
      if (password.length < 8) e.password = "Mínimo 8 caracteres";
      if (confirmPassword !== password) e.confirmPassword = "Senhas não coincidem";
    }
    if (nextStep === 3 && isPaid && asaasMethod === "credit_card") {
      if (!card.holderName.trim()) e.cardHolder = "Nome no cartão é obrigatório";
      const num = card.number.replace(/\D/g, "");
      if (num.length < 13 || num.length > 19) e.cardNumber = "Número inválido";
      const mm = parseInt(card.expiryMonth, 10);
      if (!mm || mm < 1 || mm > 12) e.cardExpiry = "Validade inválida";
      const yy = parseInt(card.expiryYear, 10);
      if (!yy || (yy < 100 ? 2000 + yy : yy) < new Date().getFullYear()) e.cardExpiry = "Validade inválida";
      if (card.cvv.length < 3) e.cardCvv = "CVV inválido";
      if (!card.postalCode.trim()) e.cardZip = "CEP é obrigatório";
      if (!card.addressNumber.trim()) e.cardAddrNum = "Número do endereço é obrigatório";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Última etapa: 3 quando plano é pago (precisa do passo de pagamento),
  // 2 quando é grátis (só senha).
  const maxStep = isPaid ? 3 : 2;

  function nextStep() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, maxStep));
  }

  function prevStep() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Pressionar Enter num input de step intermediário (ex: senha no
    // step 2) submetia o form direto e disparava o registro/PIX antes
    // do user chegar no passo de pagamento. Só registra de fato quando
    // estamos no step final.
    if (step < maxStep) {
      nextStep();
      return;
    }
    if (!validateStep(2)) return;
    if (isPaid && !validateStep(3)) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/v1/auth/register/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pending_registration_id: pendingId,
          name: name.trim(),
          workspace_name: company.trim() || undefined,
          password,
          phone: fullPhoneDigits(),
          country_code: phoneCountry,
          tax_id: taxIDValue(taxId),
          account_type: accountType,
          company_name: company.trim() || undefined,
          plan_id: selectedPlanID || undefined,
          asaas_payment_method: asaasMethod ?? "pix_automatic",
          asaas_card: asaasMethod === "credit_card" ? {
            holder_name: card.holderName,
            number: card.number.replace(/\s+/g, ""),
            expiry_month: card.expiryMonth,
            expiry_year: card.expiryYear,
            cvv: card.cvv,
          } : undefined,
          asaas_holder: asaasMethod === "credit_card" ? {
            postal_code: card.postalCode.replace(/\D/g, ""),
            address_number: card.addressNumber,
          } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMessage = safeErrorMessage(data?.error, "Erro ao criar conta");
        setErrors({ global: errorMessage });
        return;
      }

      // Paid plan, redirect checkout (Stripe hosted / AbacatePay redirect)
      if (data.checkout_type === "redirect") {
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        setErrors({ global: safeErrorMessage(data.message, "Erro ao gerar link de pagamento. Verifique se o gateway está configurado.") });
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
      // Asaas PIX Automático: cliente paga 1 QR (autoriza + 1ª parcela),
      // próximos meses debitados automaticamente sem QR novo.
      if (data.checkout_type === "pix_automatic" && data.br_code) {
        // Renderiza o QR DENTRO do próprio modal de signup — sem
        // navegação. "Trocar método" preserva os campos.
        setPixQrState({
          brCode: data.br_code,
          brCodeBase64: data.br_code_base64 ?? "",
          planName: data.plan_name ?? "",
          planPrice: data.plan_price ?? 0,
          authorizationId: data.authorization_id ?? "",
        });
        return;
      }
      // Asaas subscription c/ cartão (recorrência via tokenização). Plano
      // já está ativo — não precisa de checkout, redireciona pro success.
      if (data.checkout_type === "subscription" && data.subscription_id) {
        // Cartão: subscription já cobrada/tokenizada no Asaas; o usuário
        // não precisa ver QR. Auto-login e manda direto pro dashboard.
        if (asaasMethod === "credit_card") {
          if (data.access_token) {
            await signIn("credentials", {
              access_token: data.access_token,
              redirect: false,
            });
          }
          router.push("/dashboard?welcome=1");
          return;
        }
        const params = new URLSearchParams({
          subscription_id: data.subscription_id,
          plan_name: data.plan_name ?? "",
          plan_price: String(data.plan_price ?? ""),
          email,
        });
        if (data.pending_id) params.set("pending_id", data.pending_id);
        if (data.first_invoice_url) params.set("first_invoice_url", data.first_invoice_url);
        if (data.first_payment_id) params.set("first_payment_id", data.first_payment_id);
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
            style={{ background: "rgba(37, 99, 235,0.08)", border: "1px solid rgba(37, 99, 235,0.2)", color: "#2563EB" }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {safeText(email)}
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[hsl(240_15%_92%)] tracking-tight">
          {step === 3 && isPaid ? "Selecione Pagamento" : "Complete seu perfil"}
        </h1>
        <p className="text-sm text-[hsl(240_8%_50%)]">
          {step === 3 && isPaid
            ? "Escolha como quer pagar e finalize sua assinatura"
            : "Quase lá — só mais algumas informações"}
        </p>
      </div>

      {pixQrState ? (
        <PixQrInlineView
          state={pixQrState}
          onChangeMethod={() => setPixQrState(null)}
        />
      ) : (
        <>
      {/* Stepper visual — orienta o usuário em qual etapa está */}
      <StepDots current={step} total={maxStep + 1} />

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="step-0"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="flex flex-col gap-5"
          >
            <Field label="Seu nome" value={name} onChange={setName} placeholder="João Silva"
              autoFocus icon={<User className="w-4 h-4" />} error={errors.name} />

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-[hsl(240_15%_65%)]">Tipo de conta</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "personal", label: "Conta pessoal", hint: "CPF, SSN, ITIN ou Tax ID pessoal" },
                  { id: "business", label: "Conta empresa", hint: "CNPJ, EIN e dados da empresa" },
                ].map((option) => {
                  const active = accountType === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setAccountType(option.id as "personal" | "business")}
                      className="rounded-xl px-4 py-3 text-left transition-all"
                      style={{
                        background: active ? "rgba(37, 99, 235,0.06)" : "hsl(240 18% 5%)",
                        border: `1px solid ${active ? "#2563EB" : "var(--border-default)"}`,
                        boxShadow: active ? "0 0 0 3px rgba(37, 99, 235,0.10)" : "none",
                      }}
                    >
                      <span className="block text-sm font-semibold text-[hsl(240_15%_92%)]">{safeText(option.label)}</span>
                      <span className="mt-1 block text-xs text-[hsl(240_8%_50%)]">{safeText(option.hint)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Field
              label={accountType === "business" ? "Nome da empresa" : "Nome da empresa ou workspace (opcional)"}
              value={company}
              onChange={setCompany}
              placeholder={accountType === "business" ? "Minha Empresa LLC" : "Minha empresa"}
              icon={<Building2 className="w-4 h-4" />}
              error={errors.company}
              hint={accountType === "business" ? "Usaremos esse nome também no workspace inicial." : "Opcional. Se vazio, criamos um workspace com seu nome."}
            />
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="flex flex-col gap-5"
          >
            <PhoneField
              countryCode={phoneCountry}
              onCountryChange={setPhoneCountry}
              localPhone={localPhone}
              onLocalPhoneChange={setLocalPhone}
              error={errors.phone}
            />

            <Field
              label={accountType === "business" ? "CNPJ, EIN ou Tax ID da empresa" : "CPF ou Tax ID"}
              value={taxId}
              onChange={v => setTaxId(normalizeTaxIDInput(v))}
              placeholder={accountType === "business" ? "CNPJ, EIN ou VAT ID" : "CPF, SSN, ITIN ou Tax ID"}
              icon={<FileText className="w-4 h-4" />}
              hint={accountType === "business"
                ? "Brasil: CNPJ. EUA: EIN. Outros países: ID fiscal da empresa."
                : "Brasil: CPF. EUA: SSN/ITIN. Outros países: ID fiscal pessoal."}
              error={errors.taxId}
            />

          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="step-2"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="flex flex-col gap-5"
          >
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
                    background: isPaid ? "rgba(37, 99, 235,0.06)" : "rgba(99,91,255,0.06)",
                    border: `1px solid ${isPaid ? "rgba(37, 99, 235,0.25)" : "rgba(99,91,255,0.25)"}`,
                  }}>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-[hsl(240_15%_92%)]">{safeText(planLabel, "Plano")}</span>
                    <span className="text-xs text-[hsl(240_8%_50%)]">
                      {isPaid
                        ? "Você será redirecionado para o pagamento após criar o perfil."
                        : "Plano grátis — sem cartão de crédito."}
                    </span>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: isPaid ? "#2563EB" : "#a5a3ff" }}>
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
                          background: active ? "rgba(37, 99, 235,0.06)" : "hsl(240 18% 5%)",
                          border: `1px solid ${active ? "#2563EB" : "var(--border-default)"}`,
                          boxShadow: active ? "0 0 0 3px rgba(37, 99, 235,0.10)" : "none",
                        }}
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-[hsl(240_15%_92%)]">{safeText(p.name, "Plano")}</span>
                          {p.description && (
                            <span className="text-xs text-[hsl(240_8%_50%)]">{safeText(p.description)}</span>
                          )}
                        </div>
                        <span className="text-sm font-semibold" style={{ color: active ? "#2563EB" : "hsl(240 15% 80%)" }}>
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
          </motion.div>
        )}

        {step === 3 && isPaid && (
          <motion.div
            key="step-3"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="flex flex-col gap-4"
          >
            <SecureHeader planLabel={planLabel} planPriceVal={planPriceVal} />

            <div className="grid grid-cols-2 gap-2">
              {(([
                { id: "pix_automatic", label: "PIX Automático", icon: "⚡" },
                { id: "credit_card",   label: "Cartão",          icon: "💳" },
              ] as const).filter((opt) => allowedAsaasMethods.includes(opt.id))).map((opt) => {
                const active = asaasMethod === opt.id;
                return (
                  <motion.button
                    type="button"
                    key={opt.id}
                    onClick={() => setAsaasMethod(opt.id)}
                    whileTap={{ scale: 0.98 }}
                    className="rounded-xl p-3 text-left transition flex items-center gap-2"
                    style={{
                      background: active ? "rgba(37, 99, 235,0.10)" : "var(--surface-2)",
                      border: `1px solid ${active ? "rgba(37, 99, 235,0.30)" : "var(--surface-border)"}`,
                      color: active ? "var(--green)" : "var(--text-2)",
                    }}
                  >
                    <span className="text-lg">{opt.icon}</span>
                    <span className="text-sm font-semibold">{opt.label}</span>
                  </motion.button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {asaasMethod === "credit_card" ? (
                <motion.div
                  key="card-form"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="flex flex-col gap-3"
                >
                  <AnimatedCardPreview card={card} />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="Nome impresso no cartão"
                      value={card.holderName}
                      onChange={(e) => setCard((c) => ({ ...c, holderName: e.target.value.toUpperCase() }))}
                      className="input-field text-xs col-span-2 uppercase" />
                    <input type="text" placeholder="0000 0000 0000 0000" inputMode="numeric" maxLength={23}
                      value={formatCardNumber(card.number)}
                      onChange={(e) => setCard((c) => ({ ...c, number: e.target.value.replace(/\D/g, "").slice(0, 19) }))}
                      className="input-field text-xs col-span-2 font-mono tracking-wider" />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="MM" inputMode="numeric" maxLength={2}
                        value={card.expiryMonth}
                        onChange={(e) => setCard((c) => ({ ...c, expiryMonth: e.target.value.replace(/\D/g, "").slice(0, 2) }))}
                        className="input-field text-xs text-center font-mono" />
                      <input type="text" placeholder="AAAA" inputMode="numeric" maxLength={4}
                        value={card.expiryYear}
                        onChange={(e) => setCard((c) => ({ ...c, expiryYear: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                        className="input-field text-xs text-center font-mono" />
                    </div>
                    <input type="text" placeholder="CVV" inputMode="numeric" maxLength={4}
                      value={card.cvv}
                      onChange={(e) => setCard((c) => ({ ...c, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                      className="input-field text-xs text-center font-mono" />
                    <input type="text" placeholder="CEP" inputMode="numeric"
                      value={card.postalCode}
                      onChange={(e) => setCard((c) => ({ ...c, postalCode: e.target.value }))}
                      className="input-field text-xs" />
                    <input type="text" placeholder="Número do endereço"
                      value={card.addressNumber}
                      onChange={(e) => setCard((c) => ({ ...c, addressNumber: e.target.value }))}
                      className="input-field text-xs" />
                  </div>
                  {(errors.cardHolder || errors.cardNumber || errors.cardExpiry || errors.cardCvv || errors.cardZip || errors.cardAddrNum) && (
                    <p className="text-[11px]" style={{ color: "#ef4444" }}>
                      {errors.cardHolder || errors.cardNumber || errors.cardExpiry || errors.cardCvv || errors.cardZip || errors.cardAddrNum}
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.p
                  key="pix-info"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="text-xs text-center"
                  style={{ color: "var(--text-3)" }}
                >
                  Você paga 1 QR agora; os meses seguintes são debitados automaticamente.
                </motion.p>
              )}
            </AnimatePresence>

            <TrustBadges />
            <PoweredBy provider="asaas" />
          </motion.div>
        )}
      </AnimatePresence>

      {errors.global && (
        <div className="flex items-start gap-2 p-3 rounded-xl border text-sm"
          style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)", color: "#fca5a5" }}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {safeText(errors.global)}
        </div>
      )}

      <div className="flex gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={prevStep}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-150"
            style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", color: "var(--text-2)" }}
          >
            Voltar
          </button>
        )}

        {step < maxStep ? (
          <button
            type="button"
            onClick={nextStep}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all duration-150"
            style={{ background: "#2563EB", color: "#050508" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#00bf60"; }}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#2563EB"}
          >
            <span>
              {step === 2 && isPaid ? "Continuar para pagamento" : "Continuar"}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={loading || (isPaid && !asaasMethod)}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: "#2563EB", color: "#050508" }}
            onMouseEnter={e => { if (!loading && !(isPaid && !asaasMethod)) (e.currentTarget as HTMLButtonElement).style.background = "#00bf60"; }}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#2563EB"}
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    {isPaid
                      ? (!asaasMethod
                          ? "Selecione uma forma de pagamento"
                          : asaasMethod === "credit_card"
                            ? "Pagar com cartão"
                            : "Gerar PIX e finalizar")
                      : "Criar conta"}
                  </span>
                </>
              )}
          </button>
        )}
      </div>
      </>
      )}
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
    <div
      className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden"
      style={{
        background:
          "radial-gradient(1200px 600px at 20% 0%, rgba(37, 99, 235,0.18), transparent 60%)," +
          "radial-gradient(900px 500px at 100% 100%, rgba(99,102,241,0.16), transparent 65%)," +
          "radial-gradient(700px 400px at 50% 50%, rgba(124,58,237,0.10), transparent 70%)," +
          "linear-gradient(180deg, hsl(240 22% 3%) 0%, hsl(240 18% 4%) 50%, hsl(240 22% 3%) 100%)",
      }}
    >
      {/* Halos animados pra dar sensação de aura futurista. pointer-events
         none pra não bloquear cliques. */}
      <motion.div
        aria-hidden
        className="absolute pointer-events-none rounded-full"
        style={{
          width: 520, height: 520,
          top: "-12%", left: "-10%",
          background: "radial-gradient(circle, rgba(37, 99, 235,0.30) 0%, transparent 65%)",
          filter: "blur(40px)",
        }}
        animate={{ x: [0, 30, 0], y: [0, 20, 0], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute pointer-events-none rounded-full"
        style={{
          width: 480, height: 480,
          bottom: "-15%", right: "-12%",
          background: "radial-gradient(circle, rgba(99,102,241,0.28) 0%, transparent 65%)",
          filter: "blur(40px)",
        }}
        animate={{ x: [0, -25, 0], y: [0, -15, 0], opacity: [0.55, 0.85, 0.55] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md flex flex-col gap-6 rounded-3xl p-6 sm:p-8"
        style={{
          background:
            "linear-gradient(160deg, rgba(20,24,40,0.78), rgba(12,14,24,0.78))",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow:
            "0 40px 80px rgba(0,0,0,0.55)," +
            "0 16px 40px rgba(37, 99, 235,0.08)," +
            "inset 0 1px 0 rgba(255,255,255,0.10)," +
            "inset 0 -1px 0 rgba(0,0,0,0.30)",
        }}
      >
        <div className="flex justify-center">
          <Logo />
        </div>

        <div>
          <AnimatePresence mode="wait">
            {state.status === "loading" && (
              <motion.div key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#2563EB" }} />
                <p className="text-sm text-[hsl(240_8%_50%)]">Verificando seu link…</p>
              </motion.div>
            )}

            {state.status === "valid" && (
              <motion.div key="valid"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}>
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
                  style={{ background: "#2563EB", color: "#050508" }}
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
                  style={{ background: "#2563EB", color: "#050508" }}
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
      </motion.div>
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

// formatCardNumber — insere espaços a cada 4 dígitos pra leitura. Aceita
// só dígitos (caller já filtra). Amex (15 dígitos, prefix 34/37) usa
// grupos 4-6-5; demais usam 4-4-4-4.
function formatCardNumber(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("34") || d.startsWith("37")) {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(" ");
  }
  const groups: string[] = [];
  for (let i = 0; i < d.length; i += 4) groups.push(d.slice(i, i + 4));
  return groups.join(" ");
}

// detectCardBrand — heurística simples por prefixo. Cobre as bandeiras
// mais comuns no BR; "default" deixa o card sem logo (estético).
function detectCardBrand(num: string): "visa" | "master" | "amex" | "elo" | "hipercard" | "default" {
  const d = num.replace(/\D/g, "");
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "master";
  if (/^3[47]/.test(d)) return "amex";
  if (/^(636368|438935|504175|451416|636297|5067|4576|4011|506699)/.test(d)) return "elo";
  if (/^(606282|3841)/.test(d)) return "hipercard";
  return "default";
}

// AnimatedCardPreview — visualização do cartão estilo Stripe Checkout
// que reflete o que o user digita no form. Brilho gradiente em loop +
// flip pra mostrar o CVV quando o usuário focar (eventual; deixamos
// disponível mas sem trigger automático nessa iteração). Reduz a
// sensação de "form solto sem contexto" que o operador relatou.
function AnimatedCardPreview({ card }: { card: { holderName: string; number: string; expiryMonth: string; expiryYear: string; cvv: string } }) {
  const brand = detectCardBrand(card.number);
  const masked = (() => {
    const d = card.number.replace(/\D/g, "");
    if (!d) return "•••• •••• •••• ••••";
    const padded = d.padEnd(16, "•");
    return formatCardNumber(padded);
  })();
  const yy = (card.expiryYear || "AAAA").slice(-2);

  return (
    <motion.div
      initial={{ opacity: 0, rotateX: 10 }}
      animate={{ opacity: 1, rotateX: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 18 }}
      className="relative w-full rounded-2xl p-5 overflow-hidden"
      style={{
        aspectRatio: "1.586 / 1",
        background: "linear-gradient(135deg, #0a1a14 0%, #0a3a25 45%, #145a3b 100%)",
        boxShadow: "0 20px 50px rgba(37, 99, 235,0.18), 0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
        border: "1px solid rgba(37, 99, 235,0.25)",
      }}
    >
      {/* Halo animado */}
      <motion.div
        className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(37, 99, 235,0.18) 0%, transparent 35%)",
        }}
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      />
      {/* Chip dourado */}
      <div
        className="w-10 h-7 rounded-md mb-4 relative z-10"
        style={{
          background: "linear-gradient(135deg, #c8a35a, #e8c878 40%, #a0813f)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.3)",
        }}
      />
      {/* Número */}
      <p
        className="font-mono text-base sm:text-lg tracking-wider relative z-10"
        style={{ color: "rgba(255,255,255,0.95)", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
      >
        {masked}
      </p>
      {/* Linha inferior */}
      <div className="flex items-end justify-between mt-4 relative z-10">
        <div>
          <p className="text-[8px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.55)" }}>Titular</p>
          <p className="text-[11px] font-medium uppercase truncate max-w-[180px]" style={{ color: "rgba(255,255,255,0.92)" }}>
            {card.holderName || "NOME NO CARTÃO"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[8px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.55)" }}>Validade</p>
          <p className="text-[11px] font-mono font-medium" style={{ color: "rgba(255,255,255,0.92)" }}>
            {(card.expiryMonth || "MM").padStart(2, "0").slice(0, 2)}/{yy}
          </p>
        </div>
        <div
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
          style={{
            background: "rgba(255,255,255,0.10)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "rgba(255,255,255,0.92)",
            letterSpacing: "0.05em",
          }}
        >
          {brand === "default" ? "CARD" : brand.toUpperCase()}
        </div>
      </div>
    </motion.div>
  );
}

// SecureHeader — banner do topo do checkout. Combina o resumo do plano
// com um selo grande de "Pagamento seguro" pra reforçar confiança em
// cada subetapa do pagamento (método + form).
function SecureHeader({ planLabel, planPriceVal }: { planLabel?: string; planPriceVal?: number }) {
  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl p-4 flex items-center justify-between"
        style={{
          background: "linear-gradient(135deg, rgba(37, 99, 235,0.10), rgba(37, 99, 235,0.04))",
          border: "1px solid rgba(37, 99, 235,0.25)",
        }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-3)" }}>
            Plano selecionado
          </p>
          <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-1)" }}>
            {planLabel ?? "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Total mensal</p>
          <p className="text-base font-bold" style={{ color: "var(--green)" }}>
            R$ {Number(planPriceVal ?? 0).toFixed(2).replace(".", ",")}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// TrustBadges — linha minimalista de selos no rodapé do step.
function TrustBadges() {
  return (
    <div
      className="flex items-center justify-center gap-3 text-[10px] pt-1"
      style={{ color: "var(--text-4)" }}
    >
      <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> SSL/TLS</span>
      <span>·</span>
      <span>PCI-DSS</span>
      <span>·</span>
      <span>Sem CVV</span>
    </div>
  );
}

// StepDots — pontinhos de progresso. Mostra em qual etapa do form o
// user está agora. Os já completos ficam verdes; o atual verde com glow;
// os futuros muted. Reforça percepção de progresso em fluxos longos.
function StepDots({ current, total }: { current: number; total: number }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 pb-1">
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <motion.span
            key={i}
            initial={false}
            animate={{
              width: active ? 18 : 6,
              opacity: done || active ? 1 : 0.35,
            }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="h-1.5 rounded-full"
            style={{
              background: done || active ? "var(--green)" : "var(--text-4)",
              boxShadow: active ? "0 0 8px rgba(37, 99, 235,0.55)" : "none",
            }}
          />
        );
      })}
    </div>
  );
}

// PixQrInlineView — renderiza o QR do PIX Automático dentro do próprio
// modal de signup, em vez de navegar pra /checkout. Isso preserva o
// estado do form se o user quiser "Trocar método" (botão de cancelar
// o QR e voltar pro picker de pagamento).
function PixQrInlineView({
  state,
  onChangeMethod,
}: {
  state: {
    brCode: string;
    brCodeBase64: string;
    planName: string;
    planPrice: number;
    authorizationId: string;
  };
  onChangeMethod: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.brCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — fallback é selecionar o texto manualmente
    }
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4"
    >
      <div
        className="rounded-2xl p-4 text-center"
        style={{
          background: "linear-gradient(135deg, rgba(37, 99, 235,0.10), rgba(37, 99, 235,0.04))",
          border: "1px solid rgba(37, 99, 235,0.25)",
        }}
      >
        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-3)" }}>
          Pague pra ativar
        </p>
        <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-1)" }}>
          {state.planName || "Plano"}
        </p>
        <p className="text-base font-bold mt-0.5" style={{ color: "var(--green)" }}>
          R$ {Number(state.planPrice).toFixed(2).replace(".", ",")}
        </p>
      </div>

      {/* QR — alto contraste pra escanear de qualquer banco */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-2xl p-4" style={{ background: "#ffffff" }}>
          <QRCodeSVG
            value={state.brCode}
            size={220}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={copy}
        className="rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        style={{
          background: copied ? "rgba(37, 99, 235,0.15)" : "var(--surface-2)",
          border: `1px solid ${copied ? "rgba(37, 99, 235,0.35)" : "var(--surface-border)"}`,
          color: copied ? "var(--green)" : "var(--text-1)",
        }}
      >
        {copied ? "Copiado!" : "Copiar PIX Copia e Cola"}
      </button>

      <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <p style={{ color: "var(--text-2)" }}>
          1. Abra o app do seu banco e escolha pagar PIX.
        </p>
        <p style={{ color: "var(--text-2)" }}>
          2. Escaneie o QR ou cole o código acima.
        </p>
        <p style={{ color: "var(--text-2)" }}>
          3. Confirme — você autoriza este pagamento e os próximos meses são debitados automaticamente.
        </p>
      </div>

      <button
        type="button"
        onClick={onChangeMethod}
        className="text-xs underline underline-offset-2"
        style={{ color: "var(--text-3)" }}
      >
        Trocar método de pagamento
      </button>

      <PoweredBy provider="asaas" />
    </motion.div>
  );
}

// PROVIDER_LOGOS — catálogo dos provedores de pagamento que a Qchat
// integra. Cada um traz o nome de exibição + a URL do logo
// (preferimos SVG hospedado pelo próprio provider pra ficar sempre
// atualizado). Como vamos rotacionar provider (Asaas hoje, Abacatepay
// amanhã), a UI consulta esse mapa em vez de hardcodar "Asaas".
const PROVIDER_LOGOS: Record<string, { name: string; logo: string }> = {
  asaas: {
    name: "Asaas",
    logo: "https://www.asaas.com/assets/logo/asaas-blue-only-icon-9fe98aa6050e814a9ecb83a819109bed.svg",
  },
  abacatepay: {
    name: "AbacatePay",
    logo: "https://www.abacatepay.com/_next/static/media/logo.b7d11a52.svg",
  },
  stripe: {
    name: "Stripe",
    logo: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Stripe_Logo%2C_revised_2016.svg",
  },
};

// PoweredBy — selo "Powered by <Logo> <Name>" no rodapé das telas de
// pagamento. Dinâmico pelo provider atual; se vier um nome
// desconhecido, fica só com o texto.
function PoweredBy({ provider }: { provider: string }) {
  const info = PROVIDER_LOGOS[provider.toLowerCase()];
  if (!info) {
    return (
      <p className="text-[10px] text-center pt-2" style={{ color: "var(--text-4)" }}>
        Powered by {provider}
      </p>
    );
  }
  return (
    <div
      className="flex items-center justify-center gap-1.5 pt-2 text-[10px]"
      style={{ color: "var(--text-4)" }}
    >
      <span>Powered by</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={info.logo}
        alt={info.name}
        className="h-3.5 w-auto opacity-80"
        loading="lazy"
      />
      <span style={{ color: "var(--text-3)" }}>{info.name}</span>
    </div>
  );
}
