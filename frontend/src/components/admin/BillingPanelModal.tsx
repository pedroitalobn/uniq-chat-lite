"use client";

// BillingPanelModal — painel central de billing pra UM user (admin).
// Consome os endpoints novos em backend/internal/api/handlers/admin_billing.go:
// overview (resumo + pagamentos), services (cobranças avulsas), checkout-link,
// custom-invoice, refund, toggle-overage. Substitui o BillingLinkModal antigo
// pra users que precisam de mais do que só "trocar plano".

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { toast } from "sonner";
import {
  X, Loader2, DollarSign, Receipt, Link2, RotateCcw, Plus, Send,
  Copy, Check, ExternalLink, Ban,
} from "lucide-react";
import type { User } from "@/types";

type Tab = "overview" | "services" | "link" | "invoice";

type Overview = {
  user: { id: string; email: string; name: string; role: string };
  plan: { id: string; name: string; price: number; currency?: string } | null;
  provider: string;
  asaas: { customer_id: string; subscription_id: string; status: string; flow: string; next_charge_at: string | null };
  stripe: { customer_id: string; subscription_id: string; status: string };
  abacatepay: { checkout_id: string; subscription_id: string; status: string };
  quota: { overage_allowed?: boolean; messages_used?: number; messages_limit?: number; period_end?: string } | null;
  payments: Array<{ id: string; status: string; value: number; dueDate: string; invoiceUrl?: string; description?: string }>;
  last_received: Record<string, unknown> | null;
};

type ServiceCharge = {
  id: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  invoice_url?: string;
  created_at: string;
};

export function BillingPanelModal({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  const overviewQ = useQuery<Overview>({
    queryKey: ["admin-billing-overview", user.id],
    queryFn: () => adminApi.billingOverview(user.id).then((r) => r.data as Overview),
  });

  const refundMut = useMutation({
    mutationFn: (paymentId: string) => adminApi.billingRefund(user.id, { payment_id: paymentId }),
    onSuccess: () => {
      toast.success("Reembolso solicitado");
      qc.invalidateQueries({ queryKey: ["admin-billing-overview", user.id] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error || "Falha ao reembolsar");
    },
  });

  const overageMut = useMutation({
    mutationFn: (allow: boolean) => adminApi.billingToggleOverage(user.id, allow),
    onSuccess: () => {
      toast.success("Overage atualizado");
      qc.invalidateQueries({ queryKey: ["admin-billing-overview", user.id] });
    },
  });

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--surface-solid)",
          border: "1px solid var(--border)",
          maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Billing — {user.name || user.email}</h2>
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Provider: <span className="font-mono">{overviewQ.data?.provider || "—"}</span>
              {overviewQ.data?.plan && (
                <> · Plano: <span className="font-mono">{overviewQ.data.plan.name}</span> · R$ {overviewQ.data.plan.price?.toFixed?.(2)}</>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </header>

        <nav className="flex border-b text-xs" style={{ borderColor: "var(--border-subtle)" }}>
          {([
            { id: "overview", label: "Visão geral", icon: DollarSign },
            { id: "services", label: "Cobranças extras", icon: Receipt },
            { id: "link", label: "Link de pagamento", icon: Link2 },
            { id: "invoice", label: "Fatura personalizada", icon: Plus },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 font-medium transition"
              style={{
                color: tab === t.id ? "var(--green)" : "var(--text-3)",
                borderBottom: tab === t.id ? "2px solid var(--green)" : "2px solid transparent",
              }}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {overviewQ.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : tab === "overview" ? (
            <OverviewTab data={overviewQ.data} onRefund={(id) => refundMut.mutate(id)} onToggleOverage={(v) => overageMut.mutate(v)} refunding={refundMut.isPending} />
          ) : tab === "services" ? (
            <ServicesTab userId={user.id} provider={overviewQ.data?.provider || ""} />
          ) : tab === "link" ? (
            <CheckoutLinkTab userId={user.id} />
          ) : (
            <CustomInvoiceTab userId={user.id} />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  data, onRefund, onToggleOverage, refunding,
}: {
  data?: Overview;
  onRefund: (paymentId: string) => void;
  onToggleOverage: (v: boolean) => void;
  refunding: boolean;
}) {
  if (!data) return null;
  const sub = data.provider === "asaas" ? data.asaas
    : data.provider === "stripe" ? data.stripe
    : data.provider === "abacatepay" ? data.abacatepay
    : null;
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 text-xs">
        <InfoCard label="Status da assinatura" value={(sub as { status?: string })?.status || "—"} />
        <InfoCard label="Próxima cobrança" value={data.asaas?.next_charge_at ? new Date(data.asaas.next_charge_at).toLocaleDateString() : "—"} />
        <InfoCard label="Customer ID" value={(sub as { customer_id?: string })?.customer_id || "—"} mono />
        <InfoCard label="Subscription ID" value={(sub as { subscription_id?: string })?.subscription_id || "—"} mono />
      </section>

      {data.quota && (
        <section className="rounded-xl p-3 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium" style={{ color: "var(--text-1)" }}>Cobranças extras (overage)</p>
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                Quando o user passa do limite do plano, podemos cobrar o excedente? Mensagens: {data.quota.messages_used ?? 0}/{data.quota.messages_limit ?? 0}.
              </p>
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!data.quota.overage_allowed}
                onChange={(e) => onToggleOverage(e.target.checked)}
              />
              <span style={{ color: "var(--text-2)" }}>Permitido</span>
            </label>
          </div>
        </section>
      )}

      <section>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>Últimos pagamentos no provider</p>
        {data.payments.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Sem pagamentos registrados.</p>
        ) : (
          <div className="space-y-1.5">
            {data.payments.slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-xs rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <div className="min-w-0 flex-1">
                  <p className="font-mono truncate" style={{ color: "var(--text-1)" }}>{p.id}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                    R$ {p.value?.toFixed?.(2) || p.value} · {p.status} · {p.dueDate || "—"}
                  </p>
                </div>
                {p.invoiceUrl && (
                  <a href={p.invoiceUrl} target="_blank" rel="noreferrer" className="p-1 rounded hover:bg-white/5" style={{ color: "var(--text-3)" }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {(p.status === "RECEIVED" || p.status === "CONFIRMED") && (
                  <button
                    onClick={() => onRefund(p.id)}
                    disabled={refunding}
                    className="text-[10px] px-2 py-1 rounded font-medium"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    <RotateCcw className="w-3 h-3 inline mr-1" />Reembolsar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ServicesTab({ userId, provider }: { userId: string; provider: string }) {
  const qc = useQueryClient();
  const listQ = useQuery<{ data: ServiceCharge[] }>({
    queryKey: ["admin-billing-services", userId],
    queryFn: () => adminApi.billingListServices(userId).then((r) => r.data),
  });
  const [form, setForm] = useState({
    name: "", description: "", amount: "", recurring_cycle: "", send_email: true,
  });
  const createMut = useMutation({
    mutationFn: () => adminApi.billingCreateService(userId, {
      name: form.name,
      description: form.description || undefined,
      amount: Number(form.amount),
      recurring_cycle: form.recurring_cycle || undefined,
      send_email: form.send_email,
    }).then((r) => r.data as { warning?: string; url?: string }),
    onSuccess: (r: { warning?: string; url?: string }) => {
      if (r.warning) toast.warning(r.warning);
      else toast.success(r.url ? "Cobrança criada e link gerado" : "Cobrança criada");
      setForm({ name: "", description: "", amount: "", recurring_cycle: "", send_email: true });
      qc.invalidateQueries({ queryKey: ["admin-billing-services", userId] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error || "Falha ao criar"),
  });
  const cancelMut = useMutation({
    mutationFn: (chargeId: string) => adminApi.billingCancelService(userId, chargeId),
    onSuccess: () => {
      toast.success("Cancelada");
      qc.invalidateQueries({ queryKey: ["admin-billing-services", userId] });
    },
  });

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
        className="space-y-2 rounded-xl p-3"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
      >
        <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>Nova cobrança avulsa</p>
        <div className="grid grid-cols-2 gap-2">
          <input className="input-field text-xs col-span-2" placeholder="Nome (ex: Setup, Consultoria, Add-on)"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input-field text-xs col-span-2" placeholder="Descrição (opcional)"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input className="input-field text-xs" placeholder="Valor (BRL)" type="number" step="0.01" min="0.01"
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <select className="input-field text-xs"
            value={form.recurring_cycle} onChange={(e) => setForm({ ...form, recurring_cycle: e.target.value })}>
            <option value="">Pagamento único</option>
            <option value="MONTHLY">Mensal</option>
            <option value="YEARLY">Anual</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-2)" }}>
          <input type="checkbox" checked={form.send_email} onChange={(e) => setForm({ ...form, send_email: e.target.checked })} />
          Enviar link por email automaticamente
        </label>
        {provider && provider !== "asaas" && (
          <p className="text-[10px]" style={{ color: "#fbbf24" }}>
            Provider ativo é <strong>{provider}</strong> — o backend grava o registro mas a cobrança one-off automática só está implementada pra Asaas.
          </p>
        )}
        <button
          type="submit"
          disabled={createMut.isPending}
          className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-60"
          style={{ background: "var(--green)", color: "#03170a" }}
        >
          {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Criar cobrança
        </button>
      </form>

      <div className="space-y-1.5">
        {listQ.isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : !listQ.data?.data?.length ? (
          <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Nenhuma cobrança avulsa.</p>
        ) : (
          listQ.data.data.map((c) => (
            <div key={c.id} className="flex items-center gap-3 text-xs rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate" style={{ color: "var(--text-1)" }}>{c.name}</p>
                <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                  R$ {c.amount.toFixed(2)} · {c.status} · {c.provider} · {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              {c.invoice_url && (
                <a href={c.invoice_url} target="_blank" rel="noreferrer" className="p-1 rounded hover:bg-white/5" style={{ color: "var(--text-3)" }}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {c.status !== "canceled" && c.status !== "paid" && (
                <button
                  onClick={() => cancelMut.mutate(c.id)}
                  className="p-1 rounded hover:bg-white/5"
                  title="Cancelar"
                  style={{ color: "#fca5a5" }}
                >
                  <Ban className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CheckoutLinkTab({ userId }: { userId: string }) {
  const [form, setForm] = useState({
    value: "", description: "", plan_name: "",
    charge_type: "DETACHED" as "DETACHED" | "RECURRENT",
    subscription_cycle: "MONTHLY",
    send_email: false,
  });
  const [result, setResult] = useState<{ url: string; checkout_id: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const mut = useMutation({
    mutationFn: () => adminApi.billingCheckoutLink(userId, {
      value: Number(form.value),
      description: form.description || undefined,
      plan_name: form.plan_name || undefined,
      charge_type: form.charge_type,
      subscription_cycle: form.charge_type === "RECURRENT" ? form.subscription_cycle : undefined,
      send_email: form.send_email,
    }).then((r) => r.data as { url: string; checkout_id: string; emailed: boolean }),
    onSuccess: (r: { url: string; checkout_id: string; emailed: boolean }) => {
      setResult(r);
      toast.success(r.emailed ? "Link enviado por email" : "Link gerado");
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error || "Falha"),
  });
  const sendMut = useMutation({
    mutationFn: () => adminApi.billingSendLink(userId, { url: result?.url || "" }),
    onSuccess: () => toast.success("Email enviado"),
  });
  return (
    <div className="space-y-3">
      {!result ? (
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-2">
          <input className="input-field text-xs" placeholder="Valor (BRL)" type="number" step="0.01" min="0.01"
            value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
          <input className="input-field text-xs" placeholder="Nome / produto"
            value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} />
          <input className="input-field text-xs" placeholder="Descrição"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className="input-field text-xs"
              value={form.charge_type} onChange={(e) => setForm({ ...form, charge_type: e.target.value as "DETACHED" | "RECURRENT" })}>
              <option value="DETACHED">Pagamento único</option>
              <option value="RECURRENT">Recorrente</option>
            </select>
            {form.charge_type === "RECURRENT" && (
              <select className="input-field text-xs"
                value={form.subscription_cycle} onChange={(e) => setForm({ ...form, subscription_cycle: e.target.value })}>
                <option value="MONTHLY">Mensal</option>
                <option value="YEARLY">Anual</option>
              </select>
            )}
          </div>
          <label className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-2)" }}>
            <input type="checkbox" checked={form.send_email} onChange={(e) => setForm({ ...form, send_email: e.target.checked })} />
            Já mandar o link por email
          </label>
          <button
            type="submit"
            disabled={mut.isPending}
            className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-60"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            {mut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            Gerar link
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg p-3 break-all text-xs font-mono" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
            {result.url}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(result.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
            <a
              href={result.url} target="_blank" rel="noreferrer"
              className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            >
              <ExternalLink className="w-3 h-3" /> Abrir
            </a>
            {!result.emailed && (
              <button
                onClick={() => sendMut.mutate()}
                disabled={sendMut.isPending}
                className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                style={{ background: "var(--green)", color: "#03170a" }}
              >
                {sendMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Enviar por email
              </button>
            )}
          </div>
          <button onClick={() => setResult(null)} className="text-[11px] underline" style={{ color: "var(--text-3)" }}>
            Gerar outro link
          </button>
        </div>
      )}
    </div>
  );
}

function CustomInvoiceTab({ userId }: { userId: string }) {
  const [form, setForm] = useState({
    value: "", description: "", due_date: "", billing_type: "PIX",
  });
  const [result, setResult] = useState<{ invoice_url: string; payment_id: string } | null>(null);
  const mut = useMutation({
    mutationFn: () => adminApi.billingCustomInvoice(userId, {
      value: Number(form.value),
      description: form.description || undefined,
      due_date: form.due_date || undefined,
      billing_type: form.billing_type,
    }).then((r) => r.data as { invoice_url: string; payment_id: string }),
    onSuccess: (r: { invoice_url: string; payment_id: string }) => {
      setResult(r);
      toast.success("Fatura criada");
    },
    onError: (e: { response?: { data?: { error?: string; message?: string } } }) =>
      toast.error(e.response?.data?.message || e.response?.data?.error || "Falha"),
  });
  return (
    <div className="space-y-3">
      {!result ? (
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-2">
          <input className="input-field text-xs" placeholder="Valor (BRL)" type="number" step="0.01" min="0.01"
            value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
          <input className="input-field text-xs" placeholder="Descrição"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input-field text-xs" placeholder="Vencimento (YYYY-MM-DD)" type="date"
              value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <select className="input-field text-xs"
              value={form.billing_type} onChange={(e) => setForm({ ...form, billing_type: e.target.value })}>
              <option value="PIX">PIX</option>
              <option value="BOLETO">Boleto</option>
              <option value="CREDIT_CARD">Cartão</option>
              <option value="UNDEFINED">Cliente escolhe</option>
            </select>
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            Por enquanto disponível apenas pra users com customer Asaas.
          </p>
          <button
            type="submit"
            disabled={mut.isPending}
            className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-60"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            {mut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Gerar fatura
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: "var(--text-2)" }}>Fatura criada: <span className="font-mono">{result.payment_id}</span></p>
          {result.invoice_url && (
            <a href={result.invoice_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ background: "var(--green)", color: "#03170a" }}>
              <ExternalLink className="w-3 h-3" /> Abrir fatura
            </a>
          )}
          <button onClick={() => setResult(null)} className="block text-[11px] underline" style={{ color: "var(--text-3)" }}>
            Criar outra
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className={`text-xs ${mono ? "font-mono break-all" : "font-medium"}`} style={{ color: "var(--text-1)" }}>{value}</p>
    </div>
  );
}
