"use client";

import { Bot } from "lucide-react";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

// Card de Personalidade — antes uma aba inteira, agora bloco colapsável
// dentro do Studio. Mantém os mesmos campos do editor antigo (nome,
// identidade, objetivo, guidelines, instruções de atendimento,
// restrições) com layout vertical mais compacto.
export function PersonalityCard({ form, update }: Props) {
  return (
    <CollapsibleCard
      title="Personalidade"
      icon={Bot}
      accentColor="#a5b4fc"
      meta={
        form.agent_name && (
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
            background: "rgba(99,102,241,0.12)", color: "#a5b4fc",
            border: "1px solid rgba(99,102,241,0.25)",
          }}>
            {form.agent_name}
          </span>
        )
      }
    >
      <div className="space-y-3 pt-3">
        <Field
          label="Nome do agente"
          hint="Como o agente se identifica nas conversas"
        >
          <input
            type="text"
            value={form.agent_name}
            onChange={(e) => update((p) => ({ ...p, agent_name: e.target.value }))}
            placeholder="Ex: Ana, da Loja XYZ"
            maxLength={120}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Identidade"
          hint="Quem o agente é, contexto da empresa, papel que ocupa"
        >
          <textarea
            value={form.identity}
            onChange={(e) => update((p) => ({ ...p, identity: e.target.value }))}
            placeholder="Sou Ana, atendente da Loja XYZ. Trabalho aqui há 3 anos e..."
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
          />
        </Field>

        <Field
          label="Objetivo"
          hint="O que o agente deve alcançar em cada conversa"
        >
          <textarea
            value={form.objective}
            onChange={(e) => update((p) => ({ ...p, objective: e.target.value }))}
            placeholder="Ajudar clientes a encontrar produtos, tirar dúvidas e fechar vendas..."
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
          />
        </Field>

        <Field
          label="Diretrizes de comunicação"
          hint="Tom, formalidade, ritmo, emojis"
        >
          <textarea
            value={form.communication_guidelines}
            onChange={(e) => update((p) => ({ ...p, communication_guidelines: e.target.value }))}
            placeholder="Tom amigável e direto. Use emojis com moderação. Trate o cliente por você..."
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
          />
        </Field>

        <Field
          label="Instruções de atendimento"
          hint="Passo a passo do fluxo, perguntas obrigatórias, transferências"
        >
          <textarea
            value={form.service_instructions}
            onChange={(e) => update((p) => ({ ...p, service_instructions: e.target.value }))}
            placeholder="1. Cumprimente o cliente. 2. Identifique a necessidade. 3. ..."
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
          />
        </Field>

        <Field
          label="Restrições"
          hint="O que o agente NÃO pode fazer ou dizer"
        >
          <textarea
            value={form.restrictions}
            onChange={(e) => update((p) => ({ ...p, restrictions: e.target.value }))}
            placeholder="Não prometer prazos não confirmados. Não dar descontos sem aprovação..."
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
          />
        </Field>
      </div>
    </CollapsibleCard>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface-2)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};
