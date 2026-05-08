"use client";

// BillingLinkModal — admin clica em "Cobrar / Trocar plano" no card do
// user e abre este modal. Permite: escolher plano (default = atual do
// user), marcar "enviar por email" e gerar a sessão Stripe.
//
// Backend é inteligente:
// - Sub ativa + mesmo plano    → 409 (já assina esse plano)
// - Sub ativa + plano diferente → upgrade/downgrade in-place (proration);
//   modal mostra "Plano trocado" e dispensa link.
// - Sem sub ativa              → retorna checkout URL pra copiar/enviar.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { CreditCard, Copy, Check, ExternalLink, Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import type { Plan, User } from "@/types";

type Result = {
  action: "checkout_link" | "subscription_updated";
  url?: string;
  plan_name: string;
  plan_price: number;
  user_email: string;
  sent_email?: boolean;
  hint?: string;
  sub_status?: string;
};

export function BillingLinkModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [planId, setPlanId] = useState<string>(user.plan?.id || "");
  const [sendEmail, setSendEmail] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const plansQ = useQuery<{ data: Plan[] }>({
    queryKey: ["admin-plans"],
    queryFn: () => adminApi.listPlans(),
  });
  const plans = (plansQ.data?.data ?? []).filter((p: any) => p.price > 0);

  const generateMut = useMutation({
    mutationFn: () => adminApi.billingLink(user.id, {
      plan_id: planId || undefined,
      send_email: sendEmail,
    }),
    onSuccess: (r: any) => {
      setResult(r.data as Result);
      if (r.data?.action === "subscription_updated") {
        toast.success("Plano atualizado direto na assinatura ativa");
      } else if (r.data?.sent_email) {
        toast.success("Link gerado e enviado por email");
      } else {
        toast.success("Link gerado");
      }
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.response?.data?.message || "Falha ao gerar link";
      toast.error(msg);
    },
  });

  const copy = async () => {
    if (!result?.url) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não consegui copiar — selecione e copie manualmente");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-5 space-y-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" style={{ color: "var(--green)" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Cobrar / trocar plano
            </h3>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-lg p-3 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <p style={{ color: "var(--text-2)" }}>
            Para <strong>{user.name}</strong>
          </p>
          <p style={{ color: "var(--text-3)" }}>{user.email}</p>
        </div>

        {!result && (
          <>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
                Plano a cobrar
              </label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="input-field w-full text-sm"
              >
                <option value="">— atual do user —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · R$ {p.price.toFixed(2)}/mês
                  </option>
                ))}
              </select>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                Se o user já tem assinatura ativa em outro plano, será feito upgrade/downgrade in-place (Stripe pro-rateia automaticamente).
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span className="text-xs" style={{ color: "var(--text-2)" }}>
                Enviar link por email pro user
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => generateMut.mutate()}
                disabled={generateMut.isPending}
                className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}
              >
                {generateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                Gerar
              </button>
            </div>
          </>
        )}

        {result && result.action === "subscription_updated" && (
          <div className="space-y-3">
            <div className="rounded-xl p-4" style={{ background: "rgba(0,212,106,0.06)", border: "1px solid rgba(0,212,106,0.25)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
                <p className="text-sm font-medium" style={{ color: "var(--green)" }}>Plano trocado in-place</p>
              </div>
              <p className="text-xs" style={{ color: "var(--text-2)" }}>
                Assinatura existente foi movida pra <strong>{result.plan_name}</strong>.
                Stripe vai pro-ratear na próxima fatura — sem novo link de pagamento necessário.
              </p>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="text-xs font-medium px-3 py-1.5 rounded-lg"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {result && result.action === "checkout_link" && result.url && (
          <div className="space-y-3">
            <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
              <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>
                Link de cobrança · {result.plan_name} · R$ {result.plan_price.toFixed(2)}/mês
              </p>
              <p className="text-xs font-mono break-all" style={{ color: "var(--text-1)" }}>
                {result.url}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={copy}
                className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
                style={{ background: "var(--surface-3)", color: "var(--text-1)" }}
              >
                {copied ? <Check className="w-3 h-3" style={{ color: "var(--green)" }} /> : <Copy className="w-3 h-3" />}
                {copied ? "Copiado" : "Copiar link"}
              </button>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
                style={{ background: "var(--surface-3)", color: "var(--text-1)" }}
              >
                <ExternalLink className="w-3 h-3" />
                Abrir checkout
              </a>
            </div>
            {result.sent_email ? (
              <p className="text-[11px] flex items-center gap-1" style={{ color: "var(--green)" }}>
                <Mail className="w-3 h-3" />
                Link enviado pra {result.user_email}
              </p>
            ) : (
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                Link válido por 24h. Compartilhe com o user.
              </p>
            )}
            <div className="flex justify-end pt-1">
              <button onClick={onClose} className="text-xs font-medium px-3 py-1.5 rounded-lg"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
