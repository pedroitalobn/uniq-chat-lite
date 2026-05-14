"use client";

// /usage — painel de consumo do user (estilo Claude Code).
//
// Layout:
//   1. Hero — gauge circular do tipo mais consumido + plano + ciclo
//   2. Cards de categoria (AI / Voice / Message) com progress bar +
//      saldo restante + topup + overage acumulado
//   3. Toggle "deixar passar quando estourar" (overage_allowed)
//   4. Timeseries chart (30d × categoria)
//   5. Tabela com últimos 50 eventos
//
// Pendente: botão "Comprar mais créditos" (Phase 4 com Stripe checkout).

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Mic2, MessageSquare, AlertTriangle, Plus, Loader2,
  CheckCircle2, ArrowUpRight, Info, RefreshCw,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { toast } from "sonner";
import {
  usageApi, type UsageView, type UsageCategoryView, type UsageEvent, type UsageTimeseriesPoint,
  type TopupPack,
} from "@/lib/api";
import { ModuleHeader } from "@/components/layout/ModuleHeader";

const CATEGORY_META: Record<string, { label: string; icon: any; color: string; bg: string; border: string }> = {
  ai:      { label: "QChat AI",   icon: Sparkles,       color: "#a78bfa", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.25)" },
  voice:   { label: "Qchat Voice",icon: Mic2,           color: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.25)" },
  message: { label: "Mensagens", icon: MessageSquare,  color: "#2563EB", bg: "rgba(37, 99, 235,0.10)",   border: "rgba(37, 99, 235,0.25)" },
};

export default function UsagePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [eventCategory, setEventCategory] = useState<string>("");
  const [topupOpen, setTopupOpen] = useState(false);

  // Volta do Stripe checkout — mostra toast e invalida quota pra puxar
  // o saldo novo. Webhook applies o topup async, então damos 2s de
  // grace antes do refetch agressivo.
  useEffect(() => {
    const t = searchParams.get("topup");
    if (t === "success") {
      toast.success("Pagamento aprovado — créditos chegando…");
      const i1 = setTimeout(() => qc.invalidateQueries({ queryKey: ["usage"] }), 2_000);
      const i2 = setTimeout(() => qc.invalidateQueries({ queryKey: ["usage"] }), 6_000);
      router.replace("/usage");
      return () => { clearTimeout(i1); clearTimeout(i2); };
    }
    if (t === "cancel") {
      toast.info("Compra cancelada");
      router.replace("/usage");
    }
  }, [searchParams, qc, router]);

  const { data: view, isLoading, error, refetch } = useQuery<UsageView>({
    queryKey: ["usage", "me"],
    queryFn: () => usageApi.me().then(r => r.data),
    refetchInterval: 30_000,
    // Sem retry agressivo: se o endpoint falhar (401/500), mostramos
    // o erro logo. Antes a página ficava infinitamente em "Carregando…"
    // porque `isLoading || !view` é true mesmo após 3 retries falhados.
    retry: 1,
  });

  const { data: timeseries } = useQuery<{ items: UsageTimeseriesPoint[] }>({
    queryKey: ["usage", "me", "timeseries"],
    queryFn: () => usageApi.timeseries(30).then(r => r.data),
  });

  const { data: events } = useQuery<{ items: UsageEvent[] }>({
    queryKey: ["usage", "me", "events", eventCategory],
    queryFn: () => usageApi.events({
      category: eventCategory || undefined,
      limit: 50,
    }).then(r => r.data),
  });

  const overageMut = useMutation({
    mutationFn: (allowed: boolean) => usageApi.setOverage(allowed),
    onSuccess: (_, allowed) => {
      toast.success(allowed ? "Overage liberado" : "Overage bloqueado — soft stop ativo");
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
    onError: () => toast.error("Falha ao atualizar"),
  });

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <ModuleHeader title="Consumo" subtitle="Carregando…" icon={Sparkles} />
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-3)" }} />
        </div>
      </div>
    );
  }

  // Estado de erro — antes a página ficava em loading infinito quando
  // o endpoint falhava. Agora mostra erro + botão de retentar.
  if (error || !view) {
    const msg = (error as any)?.response?.data?.error
      || (error as any)?.message
      || "Não foi possível carregar seu consumo agora.";
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
        <ModuleHeader title="Consumo" subtitle="Erro ao carregar" icon={Sparkles} />
        <div
          className="rounded-2xl p-6 mt-4 flex items-start gap-4"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          <div className="p-2 rounded-lg flex-shrink-0"
            style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <AlertTriangle className="w-5 h-5" style={{ color: "#ef4444" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Não foi possível carregar seu consumo
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{msg}</p>
            <button
              onClick={() => refetch()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}
            >
              <RefreshCw className="w-3 h-3" />
              Tentar de novo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Maior percent define o card hero (e cor do gauge).
  const cats: { key: keyof UsageView & string; data: UsageCategoryView }[] = [
    { key: "ai", data: view.ai },
    { key: "voice", data: view.voice },
    { key: "message", data: view.message },
  ];
  const topCat = [...cats].sort((a, b) => b.data.percent - a.data.percent)[0];
  const anyHigh = cats.some(c => c.data.percent >= 80);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto space-y-6">
      <ModuleHeader
        title="Consumo"
        subtitle={`${view.plan.name}${view.plan.is_payg ? " · pague conforme usa" : ""}`}
        icon={Sparkles}
      />

      {/* Banner de alerta quando alguma categoria ≥80% */}
      {anyHigh && (
        <div
          className="rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.30)",
          }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
          <div className="flex-1 text-xs">
            <p className="font-medium" style={{ color: "#f59e0b" }}>
              Você está usando muito do seu plano
            </p>
            <p className="mt-0.5" style={{ color: "var(--text-2)" }}>
              {cats.filter(c => c.data.percent >= 80).map(c => `${CATEGORY_META[c.key].label} (${c.data.percent}%)`).join(" · ")}
              . Compre top-up ou ajuste o overage abaixo pra não interromper.
            </p>
          </div>
        </div>
      )}

      {/* Hero — gauge circular do top consumido */}
      <HeroGauge cat={topCat.key} data={topCat.data} period={view.period_end} />

      {/* Grid de categorias */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cats.map(({ key, data }) => (
          <CategoryCard key={key} category={key} data={data} />
        ))}
      </div>

      {/* Overage toggle + faturamento extra */}
      <OverageCard
        allowed={view.overage_allowed}
        onToggle={(v) => overageMut.mutate(v)}
        cents={view.overage_cents_accumulated}
        pending={overageMut.isPending}
        isPayg={view.plan.is_payg}
      />

      {/* Timeseries */}
      <TimeseriesCard items={timeseries?.items ?? []} />

      {/* Eventos recentes */}
      <EventsCard
        items={events?.items ?? []}
        category={eventCategory}
        onCategoryChange={setEventCategory}
      />

      {/* Comprar — abre modal com packs do PricingConfig */}
      <BuyTopupCTA onClick={() => setTopupOpen(true)} />
      {topupOpen && <TopupModal onClose={() => setTopupOpen(false)} />}
    </div>
  );
}

// ─── Hero gauge ──────────────────────────────────────────────────────────

function HeroGauge({ cat, data, period }: { cat: string; data: UsageCategoryView; period: string }) {
  const meta = CATEGORY_META[cat];
  const Icon = meta.icon;
  const pct = Math.min(100, data.percent);
  const isOver = data.percent >= 100;
  const remaining = data.available;
  const periodEnd = new Date(period).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

  // SVG gauge: arco de 270° (gap de 90° na base).
  const r = 78;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c * 0.75; // 75% do círculo
  const gapDash = c * 0.25;

  return (
    <div
      className="rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6"
      style={{
        background: "linear-gradient(135deg, var(--surface-1), var(--surface-2))",
        border: "1px solid var(--surface-border)",
      }}
    >
      <div className="relative" style={{ width: 180, height: 180 }}>
        <svg width={180} height={180} viewBox="0 0 180 180" style={{ transform: "rotate(135deg)" }}>
          <circle cx={90} cy={90} r={r} fill="none"
            stroke="var(--border-subtle)" strokeWidth={10}
            strokeDasharray={`${c * 0.75} ${gapDash}`}
            strokeLinecap="round"
          />
          <circle cx={90} cy={90} r={r} fill="none"
            stroke={isOver ? "#ef4444" : meta.color} strokeWidth={10}
            strokeDasharray={`${dash} ${c}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.16,1,0.3,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon className="w-5 h-5 mb-1" style={{ color: meta.color }} />
          <p className="text-3xl font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>{data.percent}%</p>
          <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: "var(--text-3)" }}>
            {meta.label}
          </p>
        </div>
      </div>
      <div className="flex-1 min-w-0 text-center sm:text-left">
        <p className="text-xs" style={{ color: "var(--text-3)" }}>Categoria mais consumida no ciclo</p>
        <p className="text-lg font-semibold mt-0.5" style={{ color: "var(--text-1)" }}>
          {fmtCredits(data.used)} / {fmtCredits(data.limit + data.topup)} créditos
        </p>
        <p className="text-xs mt-1" style={{ color: remaining < 0 ? "#ef4444" : "var(--text-2)" }}>
          {remaining >= 0
            ? `${fmtCredits(remaining)} créditos restantes`
            : `${fmtCredits(-remaining)} créditos em overage`}
        </p>
        <p className="text-[11px] mt-2" style={{ color: "var(--text-3)" }}>
          Próximo reset em <span style={{ color: "var(--text-2)" }}>{periodEnd}</span>
        </p>
      </div>
    </div>
  );
}

// ─── Card por categoria ──────────────────────────────────────────────────

function CategoryCard({ category, data }: { category: string; data: UsageCategoryView }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const pct = Math.min(100, data.percent);
  const total = data.limit + data.topup;
  const isPayg = total === 0 && data.used === 0;
  const isOver = data.percent >= 100;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-lg" style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
          <Icon className="w-4 h-4" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{meta.label}</h3>
          {data.hard_stopped && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>
              Bloqueado
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-mono tabular-nums" style={{ color: "var(--text-1)" }}>
            {fmtCredits(data.used)}
          </span>
          <span className="font-mono tabular-nums" style={{ color: "var(--text-3)" }}>
            / {isPayg ? "PAYG" : fmtCredits(total)}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--input)" }}>
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: isOver ? "#ef4444" : meta.color,
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-3)" }}>
          <span>{data.percent}% usado</span>
          {data.topup > 0 && <span>+{fmtCredits(data.topup)} top-up</span>}
          {data.overage > 0 && (
            <span style={{ color: "#f59e0b" }}>+{fmtCredits(data.overage)} overage</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Overage card ────────────────────────────────────────────────────────

function OverageCard({
  allowed, onToggle, cents, pending, isPayg,
}: {
  allowed: boolean;
  onToggle: (v: boolean) => void;
  cents: number;
  pending: boolean;
  isPayg: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-4 flex items-start gap-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="p-2 rounded-lg flex-shrink-0"
        style={{ background: "rgba(96,165,250,0.10)", border: "1px solid rgba(96,165,250,0.25)" }}>
        <Info className="w-4 h-4" style={{ color: "#60a5fa" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            Quando atingir o limite
          </h3>
          {cents > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(245,158,11,0.10)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
              R$ {(cents / 100).toFixed(2)} em overage acumulado
            </span>
          )}
        </div>
        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
          {isPayg
            ? "No plano free você usa 100% pay-as-you-go — compre top-ups pra usar QChat AI ou Voice."
            : allowed
              ? "Continuar consumindo e cobrar os créditos extras na próxima fatura. Recomendado pra quem não pode parar."
              : "Pausar consumo desse tipo até o próximo ciclo ou comprar top-up. Recomendado pra controlar gastos."}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => onToggle(false)}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={!allowed
              ? { background: "var(--green)", color: "var(--green-fg)" }
              : { background: "var(--surface-3)", color: "var(--text-2)" }
            }
          >
            Pausar quando atingir
          </button>
          <button
            onClick={() => onToggle(true)}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={allowed
              ? { background: "#f59e0b", color: "#1f1300" }
              : { background: "var(--surface-3)", color: "var(--text-2)" }
            }
          >
            Deixar passar (cobrar extra)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Timeseries chart ────────────────────────────────────────────────────

function TimeseriesCard({ items }: { items: UsageTimeseriesPoint[] }) {
  const data = useMemo(() => items.map(it => ({
    date: new Date(it.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    AI: it.ai,
    Voice: it.voice,
    Mensagens: it.message,
  })), [items]);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>
        Consumo nos últimos 30 dias
      </h3>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="g-ai" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-voice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-msg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--input)" vertical={false} />
            <XAxis dataKey="date" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "hsl(240 18% 6.5%)", border: "1px solid var(--surface-border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--text-2)" }}
            />
            <Area type="monotone" dataKey="AI" stroke="#a78bfa" strokeWidth={2} fill="url(#g-ai)" />
            <Area type="monotone" dataKey="Voice" stroke="#f59e0b" strokeWidth={2} fill="url(#g-voice)" />
            <Area type="monotone" dataKey="Mensagens" stroke="#2563EB" strokeWidth={2} fill="url(#g-msg)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Events card ─────────────────────────────────────────────────────────

function EventsCard({
  items, category, onCategoryChange,
}: {
  items: UsageEvent[];
  category: string;
  onCategoryChange: (v: string) => void;
}) {
  const filters: { id: string; label: string }[] = [
    { id: "", label: "Todos" },
    { id: "ai", label: "AI" },
    { id: "voice", label: "Voice" },
    { id: "message", label: "Mensagens" },
  ];

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          Eventos recentes
        </h3>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => onCategoryChange(f.id)}
              className="text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors"
              style={category === f.id
                ? { background: "rgba(37, 99, 235,0.18)", color: "var(--green)", border: "1px solid rgba(37, 99, 235,0.35)" }
                : { background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: "var(--text-3)" }}>
          Nenhum consumo registrado{category ? " neste filtro" : " no ciclo"}.
        </p>
      ) : (
        <div className="rounded-lg overflow-hidden"
          style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          {items.map((ev, i) => (
            <EventRow key={ev.id} ev={ev} divider={i > 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ ev, divider }: { ev: UsageEvent; divider: boolean }) {
  const meta = CATEGORY_META[ev.category] ?? { color: "var(--text-3)", label: ev.category };
  const time = new Date(ev.occurred_at).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={divider ? { borderTop: "1px solid var(--surface-border)" } : undefined}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
            {ev.event_type.replace(/_/g, " ")}
          </span>
          {ev.resource && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: "var(--input)", color: "var(--text-3)" }}>
              {ev.resource}
            </span>
          )}
          {ev.is_overage && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.10)", color: "#f59e0b" }}>overage</span>
          )}
        </div>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
          {fmtQuantity(ev)} · {time}
        </p>
      </div>
      <span className="text-xs font-mono tabular-nums" style={{ color: "var(--text-1)" }}>
        {ev.credits} cr
      </span>
    </div>
  );
}

// ─── CTA topup ───────────────────────────────────────────────────────────

function BuyTopupCTA({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-3"
      style={{
        background: "linear-gradient(135deg, rgba(37, 99, 235,0.08), rgba(167,139,250,0.06))",
        border: "1px solid rgba(37, 99, 235,0.25)",
      }}
    >
      <div className="p-2 rounded-lg"
        style={{ background: "rgba(37, 99, 235,0.12)", border: "1px solid rgba(37, 99, 235,0.25)" }}>
        <Plus className="w-4 h-4" style={{ color: "var(--green)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          Comprar mais créditos
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
          Top-ups são permanentes — não vencem com o ciclo. Aparecem como saldo extra no painel.
        </p>
      </div>
      <button
        onClick={onClick}
        className="text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 transition-opacity hover:opacity-90"
        style={{ background: "var(--green)", color: "var(--green-fg)" }}
      >
        Comprar
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Topup modal ─────────────────────────────────────────────────────────

function TopupModal({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ items: TopupPack[] }>({
    queryKey: ["topup-packs"],
    queryFn: () => usageApi.topupPacks().then(r => r.data),
  });
  const checkout = useMutation({
    mutationFn: (idx: number) => usageApi.topupCheckout({ pack_index: idx, scope: "account" }),
    onSuccess: (r) => {
      // Redireciona pra Stripe checkout. Volta automático pro /usage
      // depois com ?topup=success ou ?topup=cancel.
      window.location.href = r.data.checkout_url;
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error || "Erro ao iniciar pagamento");
    },
  });

  const packs = data?.items ?? [];

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-5 space-y-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              Comprar créditos
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              Pagamento via Stripe. Créditos somam no seu saldo na hora.
            </p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}>
            ✕
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
          </div>
        ) : packs.length === 0 ? (
          <div className="rounded-xl py-8 text-center"
            style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
            <p className="text-sm" style={{ color: "var(--text-2)" }}>Nenhum pack disponível ainda.</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
              Admin precisa configurar packs em /admin/providers → Pricing.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {packs.map((pack, idx) => {
              const meta = CATEGORY_META[pack.category] ?? CATEGORY_META.ai;
              const Icon = meta.icon;
              const isSel = selected === idx;
              return (
                <button
                  key={idx}
                  onClick={() => setSelected(idx)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left"
                  style={{
                    background: isSel ? meta.bg : "var(--surface-2)",
                    border: `1px solid ${isSel ? meta.color : "var(--surface-border)"}`,
                  }}
                >
                  <div className="p-2 rounded-lg"
                    style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
                    <Icon className="w-4 h-4" style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                      {pack.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                      {pack.credits.toLocaleString("pt-BR")} créditos {meta.label}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold tabular-nums" style={{ color: "var(--text-1)" }}>
                      R$ {(pack.price_cents / 100).toFixed(2)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-2 rounded-lg"
            style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
          >Cancelar</button>
          <button
            onClick={() => selected !== null && checkout.mutate(selected)}
            disabled={selected === null || checkout.isPending}
            className="text-xs font-medium px-4 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            {checkout.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Ir para o pagamento
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function fmtCredits(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function fmtQuantity(ev: UsageEvent): string {
  switch (ev.event_type) {
    case "ai.tokens":
      return `${ev.quantity.toLocaleString("pt-BR")} tokens`;
    case "voice.tts_chars":
      return `${ev.quantity.toLocaleString("pt-BR")} chars`;
    case "voice.stt_seconds":
      return `${ev.quantity}s áudio`;
    case "message.outbound":
      return `1 mensagem enviada`;
    case "message.inbound":
      return `1 mensagem recebida`;
    case "instance.day":
      return `1 dia de instância`;
    case "proxy.bytes":
      return `${(ev.quantity / 1024 / 1024).toFixed(1)} MB`;
  }
  return String(ev.quantity);
}
