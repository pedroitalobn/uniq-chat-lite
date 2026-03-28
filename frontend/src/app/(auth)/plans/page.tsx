"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Check, ArrowRight, Zap, Building2, Sparkles,
  MessageSquare, Shield, Globe, Headphones,
  Users, Loader2, ChevronLeft, Star, Flame,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Plan {
  id: string;
  name: string;
  price: number;
  max_instances: number;
  max_messages_per_day: number;
  features: string;
  allow_proxy: boolean;
  stripe_price_id?: string;
}

interface PlanMeta {
  icon: React.ReactNode;
  color: string;
  badge?: string;
}

// Static style/icon per plan name
const PLAN_META: Record<string, PlanMeta> = {
  Free:     { icon: <MessageSquare className="w-5 h-5" />, color: "#60a5fa" },
  Starter:  { icon: <Flame className="w-5 h-5" />,         color: "#fb923c" },
  Pro:      { icon: <Zap className="w-5 h-5" />,           color: "#00d46a", badge: "Mais Popular" },
  Business: { icon: <Building2 className="w-5 h-5" />,     color: "#a78bfa" },
  Lifetime: { icon: <Star className="w-5 h-5" />,          color: "#fbbf24", badge: "Vitalício" },
};

const FEATURE_LABELS: Record<string, string> = {
  whatsapp:     "WhatsApp",
  instagram:    "Instagram",
  crm:          "CRM",
  campaigns:    "Campanhas",
  integrations: "Integrações",
  api:          "API Access",
  webhooks:     "Webhooks",
  mcp:          "MCP AI Tools",
};

function parsePlanFeatures(plan: Plan): { description: string; highlights: string[] } {
  let obj: Record<string, unknown> = {};
  if (plan.features) {
    try { obj = JSON.parse(plan.features); } catch { obj = {}; }
  }

  const description = typeof obj["description"] === "string" ? obj["description"] : "";

  // If admin has set custom highlight texts, use them directly
  if (Array.isArray(obj["highlights"]) && (obj["highlights"] as unknown[]).length > 0) {
    return { description, highlights: (obj["highlights"] as unknown[]).map(String) };
  }

  const highlights: string[] = [];

  // Limits
  const maxInst = plan.max_instances === -1 ? "Ilimitadas" : `${plan.max_instances}`;
  highlights.push(`${maxInst} instância${plan.max_instances !== 1 ? "s" : ""}`);

  const maxMsg = plan.max_messages_per_day === -1
    ? "Mensagens ilimitadas"
    : `${plan.max_messages_per_day.toLocaleString("pt-BR")} msgs/dia`;
  highlights.push(maxMsg);

  if (plan.allow_proxy) highlights.push("Proxy dedicado");

  // Feature flags (new format)
  Object.entries(FEATURE_LABELS).forEach(([key, label]) => {
    if (obj[key] === true) highlights.push(label);
  });

  // Channels array (legacy format)
  const channels = Array.isArray(obj["channels"]) ? (obj["channels"] as string[]) : [];
  channels.forEach((ch) => {
    const label = FEATURE_LABELS[ch];
    if (label && !highlights.includes(label)) highlights.push(label);
  });

  // Support tier
  const support = typeof obj["support"] === "string" ? obj["support"] : "";
  if (support === "priority") highlights.push("Suporte prioritário 24/7");
  else if (support === "email") highlights.push("Suporte por email");
  else if (support === "community") highlights.push("Suporte comunidade");

  return { description, highlights };
}

function PlanCard({ plan, onSelect, loading }: {
  plan: Plan;
  onSelect: (plan: Plan) => void;
  loading: boolean;
}) {
  const meta: PlanMeta = PLAN_META[plan.name] ?? {
    icon: <Sparkles className="w-5 h-5" />,
    color: "#c084fc",
  };

  const { description, highlights } = parsePlanFeatures(plan);
  const isPopular = !!meta.badge;
  const isFree = plan.price === 0;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl p-6 transition-all duration-200 cursor-pointer",
        isPopular ? "ring-2" : "hover:ring-1"
      )}
      style={{
        background: isPopular ? "hsl(240 18% 7%)" : "hsl(240 18% 6%)",
        border: isPopular ? `2px solid ${meta.color}` : "1px solid hsl(240 12% 13%)",
        boxShadow: isPopular ? `0 0 40px ${meta.color}18` : undefined,
      }}
      onClick={() => onSelect(plan)}
    >
      {meta.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide"
            style={{ background: meta.color, color: "#03170a" }}>
            {meta.badge}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${meta.color}18`, color: meta.color }}>
          {meta.icon}
        </div>
        <div>
          <h3 className="text-sm font-bold" style={{ color: "hsl(240 15% 92%)" }}>{plan.name}</h3>
          {description && (
            <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "hsl(240 8% 46%)" }}>{description}</p>
          )}
        </div>
      </div>

      {/* Price */}
      <div className="mb-5">
        {isFree ? (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold" style={{ color: "hsl(240 15% 92%)" }}>Grátis</span>
            <span className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>para sempre</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-xs font-medium" style={{ color: "hsl(240 8% 46%)" }}>R$</span>
            <span className="text-3xl font-extrabold" style={{ color: "hsl(240 15% 92%)" }}>{plan.price}</span>
            <span className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>/mês</span>
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-2 flex-1 mb-6">
        {highlights.map((item) => (
          <li key={item} className="flex items-center gap-2.5 text-xs" style={{ color: "hsl(240 8% 65%)" }}>
            <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
            {item}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        disabled={loading}
        className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-60"
        style={isPopular
          ? { background: meta.color, color: "#03170a" }
          : { background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}30` }}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <span>{isFree ? "Começar grátis" : `Assinar por R$${plan.price}/mês`}</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}

export default function PlansPage() {
  const router = useRouter();
  const [selecting, setSelecting] = useState<string | null>(null);

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["plans-public"],
    queryFn: () => fetch(`${API_BASE}/stripe/plans`).then((r) => r.json()),
  });

  const handleSelect = (plan: Plan) => {
    setSelecting(plan.id);
    router.push(`/register?plan=${encodeURIComponent(plan.name)}&plan_id=${plan.id}`);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-6 pt-12"
      style={{ background: "hsl(240 20% 4%)" }}>
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px]"
          style={{ background: "radial-gradient(ellipse at top, rgba(0,212,106,0.06) 0%, transparent 65%)" }} />
        <div className="absolute bottom-0 right-0 w-[500px] h-[400px]"
          style={{ background: "radial-gradient(ellipse at bottom right, rgba(167,139,250,0.04) 0%, transparent 60%)" }} />
      </div>

      <div className="w-full max-w-4xl relative">
        <button onClick={() => router.push("/login")}
          className="flex items-center gap-1.5 text-xs mb-8 transition-colors"
          style={{ color: "hsl(240 8% 42%)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 75%)")}
          onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 42%)")}>
          <ChevronLeft className="w-3.5 h-3.5" />
          Já tenho conta
        </button>

        <div className="text-center mb-10">
          <Logo height={57} className="mx-auto mb-6" />
          <h1 className="text-3xl font-extrabold tracking-tight mb-3"
            style={{ color: "hsl(240 15% 94%)" }}>
            Escolha seu plano
          </h1>
          <p className="text-sm max-w-md mx-auto" style={{ color: "hsl(240 8% 50%)" }}>
            Comece grátis e escale conforme o seu negócio cresce.
            Cancele quando quiser, sem fidelidade.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(240 8% 40%)" }} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onSelect={handleSelect} loading={selecting === plan.id} />
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-6 flex-wrap">
          {[
            { icon: <Shield className="w-3.5 h-3.5" />, label: "Pagamento seguro via Stripe" },
            { icon: <Headphones className="w-3.5 h-3.5" />, label: "Cancele a qualquer momento" },
            { icon: <Globe className="w-3.5 h-3.5" />, label: "SSL e dados criptografados" },
            { icon: <Users className="w-3.5 h-3.5" />, label: "+10.000 usuários ativos" },
          ].map(({ icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-[11px]"
              style={{ color: "hsl(240 8% 38%)" }}>
              <span style={{ color: "hsl(240 8% 30%)" }}>{icon}</span>
              {label}
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] mt-6" style={{ color: "hsl(240 8% 28%)" }}>
          Preços em BRL · Cobrança mensal · IVA pode ser aplicado
        </p>
      </div>
    </div>
  );
}
