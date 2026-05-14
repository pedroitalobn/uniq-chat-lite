"use client";

import { useState } from "react";
import { CheckCircle2, ChevronUp, X } from "lucide-react";
import { computeReadiness, type AgentForm } from "../../../_shared/types";
import { ALL_ACTIONS } from "../../../_shared/actionsCatalog";
import { StatusCard } from "./StatusCard";

// Versão mobile do StatusCard. Em telas pequenas, o aside sticky de
// 280px não cabe — a gente mostra um resumo de uma linha no topo do
// conteúdo, que ao clicar abre um bottom sheet com o StatusCard
// completo. Lg+ não renderiza nada (o aside já cobre).
export function MobileStatusBar({ form }: { form: AgentForm }) {
  const [open, setOpen] = useState(false);
  const readiness = computeReadiness(form);
  const readyCount = Object.values(readiness).filter(Boolean).length;
  const readyTotal = Object.keys(readiness).length;
  const enabledActions = form.app_access.filter(
    (a) => a.type === "action" && a.enabled && ALL_ACTIONS.some((x) => x.id === a.name),
  ).length;
  const knowledgeAssets = form.assets.filter((a) => a.category === "knowledge").length;
  const isReady = readyCount === readyTotal;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-colors"
        style={{
          background: isReady
            ? "linear-gradient(135deg, rgba(37, 99, 235,0.06), rgba(37, 99, 235,0.02))"
            : "var(--surface-1)",
          border: `1px solid ${isReady ? "rgba(37, 99, 235,0.20)" : "var(--surface-border)"}`,
        }}
      >
        <CheckCircle2
          className="w-3.5 h-3.5 flex-shrink-0"
          style={{ color: isReady ? "var(--green)" : "var(--text-3)" }}
        />
        <span className="text-[11px] font-mono tabular-nums" style={{ color: isReady ? "var(--green)" : "var(--text-2)" }}>
          {readyCount}/{readyTotal}
        </span>
        <span className="w-px h-3" style={{ background: "var(--surface-border)" }} />
        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
          {enabledActions} ações · {form.faq.length} FAQ · {knowledgeAssets} doc
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
          style={{
            background: form.is_active ? "rgba(37, 99, 235,0.10)" : "var(--surface-2)",
            color: form.is_active ? "var(--green)" : "var(--text-4)",
          }}
        >
          {form.is_active ? "ativo" : "inativo"}
        </span>
        <ChevronUp className="w-3 h-3" style={{ color: "var(--text-3)" }} />
      </button>

      {/* Bottom sheet — só em mobile. Abre via translate-y. */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-[140]"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl px-4 pt-3 pb-6"
            style={{
              background: "var(--surface-1)",
              borderTop: "1px solid var(--surface-border)",
              maxHeight: "85vh",
              overflowY: "auto",
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex items-center justify-center mb-2">
              <span
                className="w-10 h-1 rounded-full"
                style={{ background: "var(--text-4)", opacity: 0.4 }}
              />
            </div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                Status do agente
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg"
                style={{ color: "var(--text-3)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <StatusCard form={form} />
          </div>
        </div>
      )}
    </>
  );
}
