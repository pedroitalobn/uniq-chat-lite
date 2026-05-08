"use client";

// PricingConfigPanel — admin edita margens dinamicamente + custos brutos
// dos providers + top-up packs publicados. Usado dentro da aba "Pricing"
// em /admin/providers.
//
// Princípio: super admin altera margem (ex: bumpar 100% → 130%) e o
// efeito é imediato em todos os events futuros (cache do recorder
// invalidado no PUT). Não recalcula events passados — auditoria e
// invoices ficam consistentes com o pricing do momento.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save, DollarSign, Percent, Info, Sparkles, Mic2, MessageSquare, Globe } from "lucide-react";
import { adminUsageApi, type PricingConfig } from "@/lib/api";

export function PricingConfigPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PricingConfig>({
    queryKey: ["admin", "pricing-config"],
    queryFn: () => adminUsageApi.pricing().then(r => r.data),
  });

  const [draft, setDraft] = useState<Partial<PricingConfig>>({});
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (patch: Partial<PricingConfig>) => adminUsageApi.updatePricing(patch),
    onSuccess: () => {
      toast.success("Pricing salvo — vai refletir em ~5s");
      qc.invalidateQueries({ queryKey: ["admin", "pricing-config"] });
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  if (isLoading || !draft) {
    return (
      <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
    );
  }

  const update = (k: keyof PricingConfig, v: any) => setDraft({ ...draft, [k]: v });

  return (
    <div style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto" }}>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl"
          style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.25)" }}>
          <DollarSign className="w-4 h-4" style={{ color: "var(--green)" }} />
        </div>
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Pricing & Margem</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
            Custo bruto que a Uniq paga + margem aplicada por categoria.
            Valores em <strong>USD micros</strong> ($0.000001 unidade).
          </p>
        </div>
      </div>

      {/* Margens */}
      <Section title="Margem por categoria" icon={Percent} hint="100 = user paga 2x o custo bruto. 50 = 1.5x. Mude e salve — aplica imediato em events futuros.">
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Uniq AI (%)" value={draft.margin_pct_ai}
            onChange={(v) => update("margin_pct_ai", v)} icon={Sparkles} color="#a78bfa" />
          <NumberField label="Uniq Voice (%)" value={draft.margin_pct_voice}
            onChange={(v) => update("margin_pct_voice", v)} icon={Mic2} color="#f59e0b" />
          <NumberField label="Mensagens (%)" value={draft.margin_pct_message}
            onChange={(v) => update("margin_pct_message", v)} icon={MessageSquare} color="#00d46a" />
          <NumberField label="Proxy (%)" value={draft.margin_pct_proxy}
            onChange={(v) => update("margin_pct_proxy", v)} icon={Globe} color="#60a5fa" />
        </div>
      </Section>

      {/* Unidade do crédito */}
      <Section title="Unidade do crédito" icon={DollarSign} hint="Quantos USD micros valem 1 crédito (após margem). Default 1000 = $0.001/crédito = R$ 0,005 a 1:5. Não mexer em produção sem migração — eventos antigos teriam custo em micros antigos.">
        <NumberField label="USD micros / crédito" value={draft.credit_unit_micros}
          onChange={(v) => update("credit_unit_micros", v)} />
      </Section>

      {/* LLM */}
      <Section title="LLM (Uniq AI) — custo bruto" icon={Sparkles} hint="Defaults usados quando o modelo não está na matrix. USD micros por 1k tokens.">
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Input default ($/1k)"
            value={draft.llm_default_input_cost_per_1k}
            onChange={(v) => update("llm_default_input_cost_per_1k", v)} />
          <NumberField label="Output default ($/1k)"
            value={draft.llm_default_output_cost_per_1k}
            onChange={(v) => update("llm_default_output_cost_per_1k", v)} />
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
            Cost matrix por modelo (JSON)
          </label>
          <textarea
            value={draft.llm_cost_matrix || ""}
            onChange={(e) => update("llm_cost_matrix", e.target.value)}
            placeholder={`{"openai:gpt-4o":{"in":2500,"out":10000},"anthropic:claude-3-5-sonnet":{"in":3000,"out":15000}}`}
            rows={4}
            className="input-field w-full text-xs font-mono"
            style={{ resize: "vertical" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
            Override por modelo. Vazio = usa defaults acima.
          </p>
        </div>
      </Section>

      {/* TTS / STT */}
      <Section title="Voice (TTS / STT) — custo bruto" icon={Mic2}>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="TTS ($/100 chars)" value={draft.tts_default_cost_per_100_chars}
            onChange={(v) => update("tts_default_cost_per_100_chars", v)} />
          <NumberField label="STT ($/segundo)" value={draft.stt_default_cost_per_second}
            onChange={(v) => update("stt_default_cost_per_second", v)} />
        </div>
      </Section>

      {/* Mensagens */}
      <Section title="Mensagens — custo bruto" icon={MessageSquare}>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="WhatsApp QR / msg" value={draft.message_outbound_qr_cost}
            onChange={(v) => update("message_outbound_qr_cost", v)} />
          <NumberField label="WABA Utility / msg" value={draft.message_outbound_waba_util}
            onChange={(v) => update("message_outbound_waba_util", v)} />
          <NumberField label="WABA Marketing / msg" value={draft.message_outbound_waba_mkt}
            onChange={(v) => update("message_outbound_waba_mkt", v)} />
          <NumberField label="Inbound (geralmente 0)" value={draft.message_inbound_cost}
            onChange={(v) => update("message_inbound_cost", v)} />
        </div>
      </Section>

      {/* Proxy */}
      <Section title="Proxy — custo bruto" icon={Globe}>
        <NumberField label="USD micros / 100MB" value={draft.proxy_default_cost_per_100_mb}
          onChange={(v) => update("proxy_default_cost_per_100_mb", v)} />
      </Section>

      {/* Top-up packs */}
      <Section title="Top-up packs (venda)" icon={DollarSign} hint="JSON array de pacotes vendidos no checkout. Cada pack: {category, credits, price_cents, label}.">
        <textarea
          value={draft.topup_packs || ""}
          onChange={(e) => update("topup_packs", e.target.value)}
          placeholder={`[{"category":"ai","credits":10000,"price_cents":1990,"label":"10k AI por R$19,90"}]`}
          rows={4}
          className="input-field w-full text-xs font-mono"
          style={{ resize: "vertical" }}
        />
      </Section>

      {/* Save */}
      <div className="flex justify-end pt-4 sticky bottom-4 z-10">
        <button
          onClick={() => saveMut.mutate(draft)}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-lg"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}
        >
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar pricing
        </button>
      </div>
    </div>
  );
}

function Section({
  title, icon: Icon, hint, children,
}: {
  title: string;
  icon: any;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 p-4 rounded-2xl"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5" style={{ color: "var(--text-2)" }} />
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{title}</h3>
      </div>
      {hint && (
        <div className="flex items-start gap-1.5 mb-3 text-[11px]" style={{ color: "var(--text-3)" }}>
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <p>{hint}</p>
        </div>
      )}
      {children}
    </div>
  );
}

function NumberField({
  label, value, onChange, icon: Icon, color,
}: {
  label: string;
  value?: number;
  onChange: (v: number) => void;
  icon?: any;
  color?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium flex items-center gap-1.5 mb-1.5" style={{ color: "var(--text-2)" }}>
        {Icon && <Icon className="w-3 h-3" style={{ color }} />}
        {label}
      </label>
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-field w-full text-sm font-mono tabular-nums"
      />
    </div>
  );
}
