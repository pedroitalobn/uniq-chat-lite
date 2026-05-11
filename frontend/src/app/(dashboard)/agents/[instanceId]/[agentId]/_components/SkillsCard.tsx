"use client";

import { useState } from "react";
import { Wand2, ArrowRight } from "lucide-react";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import { ALL_ACTIONS, ACTION_CATEGORIES, type ActionId } from "../../../_shared/actionsCatalog";
import { uid, type AgentForm } from "../../../_shared/types";
import { SkillsModal } from "./SkillsModal";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

// Card de Habilidades — mostra preview das ações ativas + botão pra
// abrir o modal completo. Top 6 priorizando enabled. Clicar numa
// ação no preview também abre o modal (ancorado na ação).
export function SkillsCard({ form, update }: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  const isEnabled = (id: ActionId) =>
    form.app_access.some((e) => e.type === "action" && e.name === id && e.enabled);

  const enabled = ALL_ACTIONS.filter((a) => isEnabled(a.id));
  const disabled = ALL_ACTIONS.filter((a) => !isEnabled(a.id));
  // Top 6: prioriza enabled; se não bater 6, completa com disabled (CRM primeiro)
  const preview = [...enabled, ...disabled].slice(0, 6);

  const toggle = (id: ActionId) => {
    update((p) => {
      const idx = p.app_access.findIndex((e) => e.type === "action" && e.name === id);
      if (idx >= 0) {
        const next = [...p.app_access];
        next[idx] = { ...next[idx], enabled: !next[idx].enabled };
        return { ...p, app_access: next };
      }
      return {
        ...p,
        app_access: [
          ...p.app_access,
          {
            id: uid(),
            name: id,
            type: "action",
            target: "",
            description: ALL_ACTIONS.find((a) => a.id === id)?.description || "",
            enabled: true,
          },
        ],
      };
    });
  };

  // Localiza a categoria de uma ação pra colorir o ícone consistente
  const findCategory = (id: ActionId) =>
    ACTION_CATEGORIES.find((c) => c.actions.some((a) => a.id === id));

  return (
    <>
      <CollapsibleCard
        title="Habilidades & Ações"
        icon={Wand2}
        accentColor="#00d46a"
        meta={
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(0,212,106,0.10)",
              color: "var(--green)",
              border: "1px solid rgba(0,212,106,0.20)",
            }}
          >
            {enabled.length}/{ALL_ACTIONS.length} ativas
          </span>
        }
      >
        <div className="space-y-2 pt-3">
          {/* Preview top-6 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {preview.map((action) => {
              const cat = findCategory(action.id);
              const Icon = action.icon;
              const on = isEnabled(action.id);
              const color = cat?.color || "var(--text-3)";
              return (
                <button
                  key={action.id}
                  onClick={() => toggle(action.id)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all"
                  style={{
                    background: on ? `${color}14` : "var(--surface-2)",
                    border: `1px solid ${on ? color + "33" : "var(--surface-border)"}`,
                  }}
                >
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded flex-shrink-0"
                    style={{
                      background: on ? `${color}22` : "var(--input)",
                      color: on ? color : "var(--text-4)",
                    }}
                  >
                    <Icon className="w-3 h-3" />
                  </span>
                  <span
                    className="text-[11px] font-medium truncate flex-1"
                    style={{ color: on ? "var(--text-1)" : "var(--text-3)" }}
                  >
                    {action.label}
                  </span>
                  <span
                    className="text-[8px] uppercase tracking-wider font-mono flex-shrink-0"
                    style={{
                      color: on ? color : "var(--text-4)",
                    }}
                  >
                    {on ? "on" : "off"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Botão Ver todas */}
          <button
            onClick={() => setModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium mt-1"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-2)",
            }}
          >
            Ver todas ({ALL_ACTIONS.length}) e configurar
            <ArrowRight className="w-3 h-3" />
          </button>

          {/* Política de confirmação resumida */}
          <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
            Confirmação:{" "}
            <span style={{ color: "var(--text-3)" }}>
              {form.action_confirmation === "client" && "perguntar ao cliente"}
              {form.action_confirmation === "auto" && "auto-executar"}
              {form.action_confirmation === "human" && "aprovação humana"}
            </span>
          </p>
        </div>
      </CollapsibleCard>

      {modalOpen && <SkillsModal form={form} update={update} onClose={() => setModalOpen(false)} />}
    </>
  );
}
