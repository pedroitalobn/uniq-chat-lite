"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Check, Loader2, Lock, Sparkles, Zap, Building2, Crown,
  ArrowRight, CreditCard, QrCode, X,
} from "lucide-react";
import { plansApi, billingApi, authApi, stripeApi, asaasApi } from "@/lib/api";
import { toast } from "sonner";

interface Plan {
  id: string;
  name: string;
  slug: string;
  price: number;
  max_instances: number;
  max_messages_per_day: number;
  max_users: number;
  max_workspaces: number;
  max_agents: number;
  max_journeys: number;
  max_campaigns: number;
  max_webhooks: number;
  allow_ai: boolean;
  allow_journeys: boolean;
  allow_crm: boolean;
  allow_inbox: boolean;
  allow_campaigns: boolean;
  allow_triggers: boolean;
  allow_warmup: boolean;
  allow_newsletters: boolean;
  allow_communities: boolean;
  allow_instagram: boolean;
  allow_tiktok: boolean;
  allow_api_access: boolean;
  allow_global_webhook: boolean;
  allow_proxy: boolean;
  allow_proxy_residencial: boolean;
  is_active: boolean;
  stripe_price_id?: string;
}

interface UpgradePreview {
  has_active_subscription: boolean;
  new_plan: string;
  new_price: number;
  old_price?: number;
  current_period_end?: string;
  days_remaining?: number;
  amount_due_now?: number; // centavos
  next_charge_amount?: number;
  currency?: string;
  action?: "checkout";
}

const ICON_BY_SLUG: Record<string, typeof Sparkles> = {
  free: Sparkles,
  starter: Zap,
  pro: Building2,
  enterprise: Crown,
};

function fmtPrice(cents: number, currency = "brl"): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: currency.toUpperCase() });
}

function fmtBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtLimit(n: number, unit: string): string {
  if (n === -1) return "Ilimitado";
  if (n === 0) return "—";
  return `${n.toLocaleString("pt-BR")} ${unit}`;
}

type PaymentMethod = "card" | "pix";

export default function PlansPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [previewing, setPreviewing] = useState<{ plan: Plan; preview: UpgradePreview } | null>(null);
  // Modal de checkout pra novo cliente (sem subscription) escolhendo método
  const [checkingOut, setCheckingOut] = useState<{ plan: Plan; method: PaymentMethod } | null>(null);
  const [cpf, setCpf] = useState("");
  const [pixResult, setPixResult] = useState<{ url: string; subId: string } | null>(null);

  const { data: me } = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => authApi.me().then(r => r.data),
  });

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["public-plans"],
    queryFn: () => plansApi.list().then(r => r.data as Plan[]),
  });

  const previewMut = useMutation({
    mutationFn: (planId: string) => billingApi.preview(planId).then(r => r.data),
    onSuccess: (data, planId) => {
      const plan = plans.find(p => p.id === planId);
      if (plan) setPreviewing({ plan, preview: data });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao calcular preview";
      toast.error(msg);
    },
  });

  const upgradeMut = useMutation({
    mutationFn: (planId: string) => billingApi.upgrade(planId),
    onSuccess: () => {
      toast.success("Upgrade aplicado! Proration calculada pelo Stripe.");
      setPreviewing(null);
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      qc.invalidateQueries({ queryKey: ["billing-status"] });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message
                || (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                || "Erro no upgrade";
      toast.error(msg);
    },
  });

  const currentPlanId = me?.plan?.id;
  const hasActiveSub = !!(me?.stripe_subscription_id || me?.asaas_subscription_id);

  // Click em "Cartão" — usa Stripe. Se já tem sub Stripe ativa, faz upgrade
  // proration. Senão, redireciona pro checkout Stripe.
  const handlePayCard = (plan: Plan) => {
    if (plan.id === currentPlanId) return;
    if (plan.price === 0) {
      handleDowngrade();
      return;
    }
    if (!plan.stripe_price_id) {
      toast.error("Plano sem stripe_price_id. Contate suporte.");
      return;
    }
    if (me?.stripe_subscription_id) {
      // Já tem sub Stripe — preview proration nativo
      previewMut.mutate(plan.id);
    } else {
      // Não tem sub — manda pra checkout Stripe
      stripeApi.createCheckout(plan.id).then((res) => {
        if (res.data.url) window.location.href = res.data.url;
      }).catch(() => toast.error("Falha ao iniciar checkout Stripe"));
    }
  };

  // Click em "PIX recorrente" — usa Asaas. Se já tem sub Asaas, faz upgrade
  // (cancela atual, cria nova alinhada, emite payment de proration). Senão,
  // abre modal pedindo CPF.
  const handlePayPix = (plan: Plan) => {
    if (plan.id === currentPlanId) return;
    if (plan.price === 0) {
      handleDowngrade();
      return;
    }
    if (me?.asaas_subscription_id) {
      previewMut.mutate(plan.id);
    } else {
      setCheckingOut({ plan, method: "pix" });
    }
  };

  const handleDowngrade = () => {
    if (confirm("Cancelar plano pago e voltar pro Free no fim do ciclo?")) {
      billingApi.cancel(false).then(() => {
        toast.success("Cancelamento agendado.");
        qc.invalidateQueries();
      });
    }
  };

  const handleAsaasCheckoutConfirm = async () => {
    if (!checkingOut) return;
    if (!cpf.trim() || cpf.replace(/\D/g, "").length !== 11) {
      toast.error("CPF inválido");
      return;
    }
    try {
      const res = await asaasApi.createCheckout({ plan_id: checkingOut.plan.id, cpf: cpf.replace(/\D/g, "") });
      const data = res.data as { first_invoice_url?: string; subscription_id: string };
      if (data.first_invoice_url) {
        setPixResult({ url: data.first_invoice_url, subId: data.subscription_id });
      } else {
        toast.success("Assinatura PIX criada — em alguns segundos a fatura aparece.");
      }
      setCheckingOut(null);
      setCpf("");
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message
                || (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                || "Falha ao criar assinatura";
      toast.error(msg);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-10">
        <h1 className="text-display-page mb-3">Planos & assinatura</h1>
        <p className="text-soft text-base">
          Escolha o plano ideal pro seu time. Upgrade na hora, downgrade no fim do ciclo.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "var(--text-3)" }} />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.filter(p => p.is_active).sort((a, b) => a.price - b.price).map(plan => {
            const Icon = ICON_BY_SLUG[plan.slug] || Sparkles;
            const isCurrent = plan.id === currentPlanId;
            const isUpgrading = previewMut.isPending && previewMut.variables === plan.id;

            return (
              <div
                key={plan.id}
                className="rounded-2xl p-6 flex flex-col"
                style={{
                  background: isCurrent ? "var(--surface-2)" : "var(--surface-1)",
                  border: `1px solid ${isCurrent ? "var(--green-border)" : "var(--surface-border)"}`,
                  boxShadow: isCurrent ? "0 0 0 1px var(--green)" : "var(--shadow-1)",
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-5 h-5" style={{ color: "var(--green)" }} />
                  <h2 className="text-lg font-bold" style={{ color: "var(--text-1)" }}>{plan.name}</h2>
                  {isCurrent && (
                    <span className="ml-auto text-[10px] uppercase font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                      Atual
                    </span>
                  )}
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-extrabold" style={{ color: "var(--text-1)" }}>
                    {plan.price === 0 ? "Grátis" : fmtBRL(plan.price)}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-sm ml-1" style={{ color: "var(--text-3)" }}>/mês</span>
                  )}
                </div>

                <ul className="space-y-1.5 mb-6 flex-1">
                  <FeatureRow ok>{fmtLimit(plan.max_instances, "instâncias WhatsApp")}</FeatureRow>
                  <FeatureRow ok>{fmtLimit(plan.max_messages_per_day, "mensagens/dia")}</FeatureRow>
                  <FeatureRow ok>{fmtLimit(plan.max_users, "agentes")}</FeatureRow>
                  <FeatureRow ok={plan.allow_inbox}>Inbox + Atendimento</FeatureRow>
                  <FeatureRow ok={plan.allow_crm}>CRM (contatos, deals, pipelines)</FeatureRow>
                  <FeatureRow ok={plan.allow_ai}>Agentes IA + RAG</FeatureRow>
                  <FeatureRow ok={plan.allow_journeys}>Journeys (automação)</FeatureRow>
                  <FeatureRow ok={plan.allow_campaigns}>Campanhas em massa</FeatureRow>
                  <FeatureRow ok={plan.allow_triggers}>Triggers (autoresponder)</FeatureRow>
                  <FeatureRow ok={plan.allow_warmup}>Warmup (anti-ban)</FeatureRow>
                  <FeatureRow ok={plan.allow_global_webhook}>Webhooks globais</FeatureRow>
                  <FeatureRow ok={plan.allow_proxy}>Proxy</FeatureRow>
                  <FeatureRow ok={plan.allow_instagram || plan.allow_tiktok}>
                    Multi-canal (Instagram + TikTok)
                  </FeatureRow>
                </ul>

                {isCurrent ? (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors"
                    style={{ background: "var(--surface-3)", color: "var(--text-3)" }}
                  >
                    Plano atual
                  </button>
                ) : plan.price === 0 ? (
                  <button
                    onClick={handleDowngrade}
                    disabled={!hasActiveSub}
                    className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
                  >
                    {hasActiveSub ? "Voltar pro Free" : "Plano gratuito"}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button
                      onClick={() => handlePayCard(plan)}
                      disabled={isUpgrading}
                      className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                      style={{ background: "var(--green)", color: "var(--green-fg)" }}
                    >
                      {isUpgrading ? <Loader2 className="w-4 h-4 animate-spin" /> :
                        <><CreditCard className="w-4 h-4" /> Cartão</>}
                    </button>
                    <button
                      onClick={() => handlePayPix(plan)}
                      disabled={isUpgrading}
                      className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                      style={{
                        background: "var(--surface-3)",
                        color: "var(--text-1)",
                        border: "1px solid var(--surface-border)",
                      }}
                    >
                      <QrCode className="w-4 h-4" /> PIX recorrente
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {previewing && (
        <UpgradeConfirmDialog
          plan={previewing.plan}
          preview={previewing.preview}
          onCancel={() => setPreviewing(null)}
          onConfirm={() => upgradeMut.mutate(previewing.plan.id)}
          confirming={upgradeMut.isPending}
        />
      )}

      {checkingOut && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--surface-overlay)" }}
          onClick={() => setCheckingOut(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <QrCode className="w-5 h-5" style={{ color: "var(--green)" }} />
              <h3 className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
                PIX recorrente — {checkingOut.plan.name}
              </h3>
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
              Asaas exige CPF pra criar a assinatura PIX. A primeira fatura é gerada na hora.
              Próximas saem automaticamente todo mês.
            </p>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
              CPF
            </label>
            <input
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-4"
              style={{
                background: "var(--surface-3)",
                color: "var(--text-1)",
                border: "1px solid var(--surface-border)",
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setCheckingOut(null)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleAsaasCheckoutConfirm}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}
              >
                Criar assinatura
              </button>
            </div>
          </div>
        </div>
      )}

      {pixResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--surface-overlay)" }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 text-center"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
          >
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={() => setPixResult(null)}
                className="p-1.5 rounded-lg hover:bg-white/5"
                style={{ color: "var(--text-3)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <QrCode className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--green)" }} />
            <h3 className="text-lg font-bold mb-2" style={{ color: "var(--text-1)" }}>
              Assinatura PIX criada!
            </h3>
            <p className="text-sm mb-5" style={{ color: "var(--text-2)" }}>
              Sua primeira fatura está pronta. Pague com PIX e o plano ativa automaticamente.
              As próximas faturas serão geradas mensalmente.
            </p>
            <a
              href={pixResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}
            >
              Abrir fatura PIX <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-xs" style={{ color: ok ? "var(--text-2)" : "var(--text-4)" }}>
      {ok ? (
        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--green)" }} />
      ) : (
        <Lock className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className={ok ? "" : "line-through"}>{children}</span>
    </li>
  );
}

function UpgradeConfirmDialog({
  plan,
  preview,
  onCancel,
  onConfirm,
  confirming,
}: {
  plan: Plan;
  preview: UpgradePreview;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  // Sem subscription ativa → manda pro checkout (criar assinatura nova)
  const router = useRouter();
  const isFirstSub = !preview.has_active_subscription;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-2" style={{ color: "var(--text-1)" }}>
          Confirmar upgrade pra {plan.name}
        </h3>

        {isFirstSub ? (
          <p className="text-sm mb-5" style={{ color: "var(--text-2)" }}>
            Você ainda não tem assinatura ativa. Vamos te levar pro checkout do Stripe pra começar.
          </p>
        ) : (
          <div className="space-y-3 mb-5">
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--text-3)" }}>Plano novo</span>
              <span className="font-semibold" style={{ color: "var(--text-1)" }}>
                {fmtBRL(preview.new_price)}/mês
              </span>
            </div>
            {preview.days_remaining !== undefined && (
              <div className="flex justify-between text-sm">
                <span style={{ color: "var(--text-3)" }}>Dias restantes do ciclo</span>
                <span style={{ color: "var(--text-2)" }}>{preview.days_remaining}d</span>
              </div>
            )}
            {preview.amount_due_now !== undefined && (
              <div
                className="flex justify-between items-baseline pt-3 border-t"
                style={{ borderColor: "var(--surface-border)" }}
              >
                <span className="font-medium" style={{ color: "var(--text-1)" }}>Cobrança hoje</span>
                <span className="text-xl font-extrabold" style={{ color: "var(--green)" }}>
                  {fmtPrice(preview.amount_due_now, preview.currency)}
                </span>
              </div>
            )}
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Stripe calcula a diferença proporcional automaticamente. O próximo ciclo será cobrado o valor cheio do plano novo.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (isFirstSub) {
                router.push("/payment/checkout?plan=" + plan.id);
              } else {
                onConfirm();
              }
            }}
            disabled={confirming}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
