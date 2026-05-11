"use client";

// Módulo Jornadas — top-level. Versão enxuta:
//
//   • 1 CTA PRIMÁRIO ("Nova jornada") cria blank e leva direto pro
//     Conversational Builder com Uniq AI já pronta pra ajudar.
//   • 1 CTA SECUNDÁRIO ("Templates") abre o modal — único caminho
//     pra ver templates pré-montados.
//   • Estado vazio com explicação visual dos 2 caminhos pra começar.
//
// Antes a página tinha 3 botões competindo (Uniq AI / Templates /
// Canvas) + um grid de preview de templates + botão duplicado
// "Ver todos templates" dentro do grid. Confundia o user sobre por
// onde começar. Esta versão consolida tudo num fluxo único.

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, LayoutTemplate, Plus, Sparkles, Wand2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";
import { JourneysList } from "@/features/journeys/journeys-list";
import { ActivityPanel } from "@/features/journeys/activity-panel";
import { TemplatesDialog } from "@/features/journeys/templates-dialog";
import { cn } from "@/lib/utils";

type Tab = "list" | "activity";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "list", label: "Jornadas", icon: Wand2 },
  { id: "activity", label: "Atividade", icon: Activity },
];

export default function JourneysPage() {
  const [tab, setTab] = useState<Tab>("list");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Conta de jornadas pra decidir entre estado vazio e listagem.
  // Reusa a mesma queryKey do JourneysList pra cache compartilhado.
  const journeysQ = useQuery({
    queryKey: ["journeys-list"],
    queryFn: () => journeysApi.list().then((r) => r.data),
    staleTime: 10_000,
  });
  const journeyCount = Array.isArray(journeysQ.data) ? journeysQ.data.length : 0;
  const isEmpty = !journeysQ.isLoading && journeyCount === 0;

  // CTA primário: cria journey blank e leva pro Conversational
  // Builder. A Uniq AI já cumprimenta o user lá ("descreve o que
  // essa jornada deve fazer") — sem fricção.
  const createBlank = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await journeysApi.createBlank();
      const id = res.data?.id;
      if (!id) throw new Error("id ausente");
      window.location.href = `/journeys/${id}`;
    } catch (e: any) {
      // Backend devolve { error, hint? }. Hint mostra a causa real
      // (constraint, FK, plan limit) — concatenamos pro user saber
      // o que ajustar. Sem fallback genérico encobre bug útil.
      const data = e?.response?.data;
      const msg = data?.error || "Falha ao criar jornada";
      const hint = data?.hint || data?.detail;
      toast.error(hint ? `${msg} — ${hint}` : msg, { duration: 8000 });
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Header — subtítulo + 2 CTAs claros */}
      <div className="mb-4 flex-shrink-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-xs sm:text-sm max-w-2xl" style={{ color: "var(--text-3)" }}>
            Sequências automáticas de mensagens que rodam sozinhas. Crie do zero conversando com a
            Uniq AI ou comece a partir de um template pronto.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setTemplatesOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
                color: "var(--text-2)",
              }}
              title="Ver templates prontos"
            >
              <LayoutTemplate className="w-4 h-4" />
              Templates
            </button>
            <button
              onClick={createBlank}
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold disabled:opacity-60"
              style={{
                background: "var(--green)",
                color: "var(--green-fg)",
              }}
              title="Criar uma jornada conversando com a Uniq AI (sem trocar de página)"
            >
              <Sparkles className="w-4 h-4" />
              Nova jornada
            </button>
          </div>
        </div>
      </div>

      {/* Empty state — só aparece quando não há nenhuma jornada.
         Explica os 2 caminhos pra começar com cards visuais grandes
         (zero ambiguidade sobre por onde começar). */}
      {isEmpty && (
        <EmptyHero
          onCreate={createBlank}
          onOpenTemplates={() => setTemplatesOpen(true)}
          creating={creating}
        />
      )}

      {/* Tabs + listagem — só quando tem jornadas */}
      {!isEmpty && (
        <>
          <div
            className="flex gap-1 p-1 rounded-xl mb-3 sm:mb-4 flex-shrink-0 self-start"
            style={{
              background: "var(--input)",
              backdropFilter: "blur(12px) saturate(180%)",
              WebkitBackdropFilter: "blur(12px) saturate(180%)",
              border: "1px solid var(--border-default)",
            }}
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium",
                  )}
                  style={{
                    background: isActive
                      ? "linear-gradient(135deg, rgba(0,212,106,0.18) 0%, rgba(0,212,106,0.08) 100%)"
                      : "transparent",
                    backdropFilter: isActive ? "blur(8px)" : "none",
                    border: isActive ? "1px solid rgba(0,212,106,0.20)" : "1px solid transparent",
                    color: isActive ? "var(--green)" : "var(--text-3)",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div
            className="flex-1 min-h-0 rounded-2xl overflow-hidden border"
            style={{ borderColor: "var(--surface-border)" }}
          >
            {tab === "list" && <JourneysList />}
            {tab === "activity" && <ActivityPanel />}
          </div>
        </>
      )}

      {templatesOpen && <TemplatesDialog onClose={() => setTemplatesOpen(false)} />}
    </div>
  );
}

// ─── EmptyHero ─────────────────────────────────────────────────────
//
// Aparece quando o user nunca criou uma jornada. 2 cards grandes
// explicando como começar — zero ambiguidade. CTA primário verde
// chama atenção pro caminho recomendado (com IA).

function EmptyHero({
  onCreate,
  onOpenTemplates,
  creating,
}: {
  onCreate: () => void;
  onOpenTemplates: () => void;
  creating: boolean;
}) {
  return (
    <div className="flex-1 flex items-center justify-center py-8">
      <div className="w-full max-w-3xl space-y-5">
        <div className="text-center space-y-2">
          <span
            className="inline-flex w-12 h-12 rounded-2xl items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.06))",
              border: "1px solid rgba(0,212,106,0.30)",
              color: "var(--green)",
            }}
          >
            <Wand2 className="w-5 h-5" />
          </span>
          <h2 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--text-1)" }}>
            Crie sua primeira jornada
          </h2>
          <p className="text-sm max-w-xl mx-auto" style={{ color: "var(--text-3)" }}>
            Jornadas são sequências automáticas de mensagens que rodam sozinhas. Bem-vindas,
            recuperação, follow-up, NPS — escolha um caminho e comece.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Caminho 1 — IA (recomendado) */}
          <button
            onClick={onCreate}
            disabled={creating}
            className="text-left rounded-2xl p-5 transition-all group disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.10), rgba(0,212,106,0.03))",
              border: "1px solid rgba(0,212,106,0.30)",
            }}
          >
            <div className="flex items-start gap-3">
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: "rgba(0,212,106,0.15)",
                  border: "1px solid rgba(0,212,106,0.30)",
                  color: "var(--green)",
                }}
              >
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                    Conversar com a Uniq AI
                  </p>
                  <span
                    className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: "var(--green)", color: "var(--green-fg)" }}
                  >
                    Recomendado
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
                  Você descreve em texto o que quer ("manda boas-vindas, espera 1 dia, pergunta
                  o objetivo do cliente") e a IA monta os passos pra você. Edite por chat até
                  ficar do jeito certo.
                </p>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium mt-3 transition-transform group-hover:translate-x-1"
                  style={{ color: "var(--green)" }}
                >
                  Começar do zero
                  <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </button>

          {/* Caminho 2 — Templates */}
          <button
            onClick={onOpenTemplates}
            className="text-left rounded-2xl p-5 transition-all group"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-border)",
            }}
          >
            <div className="flex items-start gap-3">
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: "rgba(139,92,246,0.12)",
                  border: "1px solid rgba(139,92,246,0.25)",
                  color: "#a78bfa",
                }}
              >
                <LayoutTemplate className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>
                  Começar de um template
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
                  Mais rápido pra casos comuns. Boas-vindas, qualificação de leads, NPS,
                  agendamento, recuperação de carrinho. Personaliza depois com a IA.
                </p>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium mt-3 transition-transform group-hover:translate-x-1"
                  style={{ color: "#a78bfa" }}
                >
                  Ver templates
                  <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </button>
        </div>

        <p className="text-[11px] text-center" style={{ color: "var(--text-4)" }}>
          Depois de criada, você pode editar via chat com IA, no canvas avançado, ver
          analytics e enrolar contatos.
        </p>
      </div>
    </div>
  );
}
