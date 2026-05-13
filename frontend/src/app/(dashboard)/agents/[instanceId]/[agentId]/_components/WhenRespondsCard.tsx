"use client";

import { Clock } from "lucide-react";
import { ActivationTab } from "@/components/agents/ActivationTab";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

const MODE_LABEL: Record<AgentForm["activation_mode"], string> = {
  always: "Sempre",
  business_hours: "Horário comercial",
  off_hours: "Fora do expediente",
  new_contact_only: "1º contato",
  custom: "Customizado",
};

const TRIGGER_LABEL: Record<AgentForm["trigger_mode"], string> = {
  any: "Qualquer mensagem",
  keyword: "Palavra-chave",
  webhook: "Webhook externo",
};

const PACE_LABEL: Record<AgentForm["response_pace"], string> = {
  instant: "Instantâneo",
  natural: "Natural",
  thoughtful: "Pensativo",
  very_human: "Muito humano",
};

const LENGTH_LABEL: Record<AgentForm["response_length"], string> = {
  concise: "Conciso",
  balanced: "Balanceado",
  detailed: "Detalhado",
};

// Card que reusa o ActivationTab existente — ele já cobre os 3 sub-
// blocos: quando responde (modo + grade), como dispara (any/keyword/
// webhook) e ritmo humano (pace + length). Mantemos tudo agrupado
// num bloco só pra não inflar o Settings com 3 cards quase iguais.
export function WhenRespondsCard({ form, update }: Props) {
  return (
    <CollapsibleCard
      title="Quando e como responde"
      icon={Clock}
      accentColor="#fbbf24"
      meta={
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <Chip color="#fbbf24" label={MODE_LABEL[form.activation_mode]} />
          <Chip color="#a5b4fc" label={TRIGGER_LABEL[form.trigger_mode]} />
          <Chip color="#60a5fa" label={`${PACE_LABEL[form.response_pace]} · ${LENGTH_LABEL[form.response_length]}`} />
        </div>
      }
    >
      <div className="pt-3 space-y-5">
        <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
            Agrupar mensagens em rajada
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
            Quando o cliente manda várias mensagens seguidas, o agente espera ele terminar de digitar antes de responder — em vez de responder linha por linha. Mais natural.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([
              { id: "off", label: "Desligado", desc: "Responde cada mensagem na hora" },
              { id: "smart", label: "Inteligente (~6s)", desc: "Espera silêncio curto antes de processar — recomendado" },
              { id: "patient", label: "Paciente (~15s)", desc: "Bom pra quem digita devagar ou intercala áudios" },
            ] as const).map((opt) => {
              const active = form.message_batching === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => update((p) => ({ ...p, message_batching: opt.id }))}
                  title={opt.desc}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg transition"
                  style={{
                    background: active ? "rgba(251,191,36,0.14)" : "var(--surface-1)",
                    color: active ? "#fbbf24" : "var(--text-2)",
                    border: `1px solid ${active ? "rgba(251,191,36,0.35)" : "var(--surface-border)"}`,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <ActivationTab
          mode={form.activation_mode}
          schedule={form.schedule}
          onChangeMode={(m) => update((p) => ({ ...p, activation_mode: m }))}
          onChangeSchedule={(s) => update((p) => ({ ...p, schedule: s }))}
          trigger={{
            mode: form.trigger_mode,
            keywords: form.trigger_keywords,
            message_types: form.trigger_message_types,
            webhook_slug: form.trigger_webhook_slug,
            webhook_secret: form.trigger_webhook_secret,
          }}
          onChangeTrigger={(t) =>
            update((p) => ({
              ...p,
              trigger_mode: t.mode,
              trigger_keywords: t.keywords,
              trigger_message_types: t.message_types,
              trigger_webhook_secret: t.webhook_secret,
            }))
          }
          responseStyle={{ pace: form.response_pace, length: form.response_length, pace_settings: form.pace_settings }}
          onChangeResponseStyle={(s) =>
            update((p) => ({ ...p, response_pace: s.pace, response_length: s.length, pace_settings: s.pace_settings }))
          }
        />
      </div>
    </CollapsibleCard>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full"
      style={{
        background: `${color}14`,
        color,
        border: `1px solid ${color}33`,
      }}
    >
      {label}
    </span>
  );
}
