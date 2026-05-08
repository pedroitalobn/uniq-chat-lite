"use client";

// Módulo Jornadas — top-level. Cabeçalho concentra todas as formas de
// criar uma jornada (Uniq AI / Templates / Canvas em branco). Tabs
// dividem listagem e atividade em tempo real.

import React, { useState } from "react";
import Link from "next/link";
import { Activity, LayoutTemplate, Plus, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";
import { JourneysList } from "@/features/journeys/journeys-list";
import { ActivityPanel } from "@/features/journeys/activity-panel";
import { TemplatesDialog } from "@/features/journeys/templates-dialog";
import { cn } from "@/lib/utils";

const JOURNEY_TEMPLATE_PREVIEWS = [
  { id: "recuperacao-clientes",     name: "Recuperação de Clientes",    description: "Reengaje clientes inativos com mensagem personalizada", emoji: "🔄", color: "#f59e0b", category: "Retenção",    steps: 5 },
  { id: "boas-vindas-onboarding",   name: "Boas-vindas & Onboarding",   description: "Receba novos contatos e direcione cada um para o caminho certo", emoji: "🚀", color: "#3b82f6", category: "Captação",    steps: 5 },
  { id: "aniversariantes",          name: "Aniversariantes",            description: "Surpreenda clientes no aniversário com mensagem e cupom exclusivo", emoji: "🎂", color: "#ec4899", category: "Engajamento", steps: 3 },
  { id: "solicitacao-indicacao",    name: "Solicitação de Indicação",   description: "Ative clientes VIP para indicarem conhecidos e recompense automaticamente", emoji: "🤝", color: "#10b981", category: "Retenção",    steps: 6 },
  { id: "retencao-pos-compra",      name: "Retenção Pós-compra",        description: "Fidelize compradores com acompanhamento pós-venda e upsell", emoji: "💎", color: "#8b5cf6", category: "Retenção",    steps: 6 },
  { id: "qualificacao-leads",       name: "Qualificação de Leads",      description: "Classifique leads automaticamente por interesse e comportamento", emoji: "🎯", color: "#f97316", category: "Captação",    steps: 8 },
];

function JourneyTemplateCards({ onOpenAll, onCreateFromTemplate }: { onOpenAll: () => void; onCreateFromTemplate: (id: string) => void }) {
  return (
    <div className="space-y-3 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Templates de Jornada</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>Comece com uma jornada pré-montada e personalize</p>
        </div>
        <button onClick={onOpenAll}
          className="text-xs px-2.5 py-1.5 rounded-lg transition"
          style={{ color: "var(--text-3)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
          Ver todos os templates
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {JOURNEY_TEMPLATE_PREVIEWS.map((tpl) => (
          <div key={tpl.id}
            className="rounded-2xl p-3.5 flex flex-col gap-2 cursor-pointer transition-all duration-200"
            style={{
              background: `${tpl.color}08`,
              border: `1px solid ${tpl.color}18`,
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
            onClick={() => onCreateFromTemplate(tpl.id)}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 16px ${tpl.color}20, 0 0 0 1px ${tpl.color}28`}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)"}>
            <div className="flex items-start justify-between gap-1">
              <span className="text-xl leading-none">{tpl.emoji}</span>
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                style={{ background: `${tpl.color}15`, color: tpl.color }}>
                {tpl.steps} passos
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold leading-tight" style={{ color: "var(--text-1)" }}>{tpl.name}</p>
              <p className="text-[11px] mt-0.5 leading-snug line-clamp-2" style={{ color: "var(--text-3)" }}>{tpl.description}</p>
            </div>
            <span className="text-[10px] font-medium mt-auto" style={{ color: tpl.color }}>{tpl.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Tab = "list" | "activity";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "list", label: "Jornadas", icon: Wand2 },
  { id: "activity", label: "Atividade", icon: Activity },
];

export default function JourneysPage() {
  const [tab, setTab] = useState<Tab>("list");
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const createBlank = async () => {
    try {
      const res = await journeysApi.createBlank();
      const id = res.data?.id;
      if (!id) throw new Error("id ausente");
      window.location.href = `/journeys/${id}`;
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Falha ao criar jornada");
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Header */}
      <div className="mb-3 sm:mb-4 flex-shrink-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {/* Título "Jornadas" agora no ModuleHeader (layout). */}
            <p className="text-xs sm:text-sm" style={{ color: "var(--text-3)" }}>
              Cadências e regras de relacionamento — crie via canvas, template ou linguagem natural pelo Uniq AI.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/uniq-ai"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium"
              style={{
                background: "linear-gradient(135deg, rgba(0,212,106,0.12) 0%, rgba(0,212,106,0.05) 100%)",
                backdropFilter: "blur(12px) saturate(180%)",
                WebkitBackdropFilter: "blur(12px) saturate(180%)",
                border: "1px solid rgba(0,212,106,0.20)",
                color: "var(--green)",
                transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(0,212,106,0.20) 0%, rgba(0,212,106,0.10) 100%)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(0,212,106,0.12) 0%, rgba(0,212,106,0.05) 100%)"; }}
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Criar via Uniq AI</span>
              <span className="sm:hidden">Uniq AI</span>
            </Link>
            <button
              onClick={() => setTemplatesOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium"
              style={{
                background: "linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0.05) 100%)",
                backdropFilter: "blur(12px) saturate(180%)",
                WebkitBackdropFilter: "blur(12px) saturate(180%)",
                border: "1px solid rgba(139,92,246,0.20)",
                color: "#a78bfa",
                transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(139,92,246,0.20) 0%, rgba(139,92,246,0.10) 100%)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0.05) 100%)"; }}
            >
              <LayoutTemplate className="w-4 h-4" />
              Templates
            </button>
            <button
              onClick={createBlank}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
                backdropFilter: "blur(12px) saturate(180%)",
                WebkitBackdropFilter: "blur(12px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "var(--text-1)",
                transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)"; }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Canvas em branco</span>
              <span className="sm:hidden">Canvas</span>
            </button>
          </div>
        </div>
      </div>

      {/* Template Cards */}
      <div className="mb-4 sm:mb-5 flex-shrink-0">
        <JourneyTemplateCards
          onOpenAll={() => setTemplatesOpen(true)}
          onCreateFromTemplate={() => setTemplatesOpen(true)}
        />
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl mb-3 sm:mb-4 flex-shrink-0 self-start"
        style={{
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(12px) saturate(180%)",
          WebkitBackdropFilter: "blur(12px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.09)",
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

      {/* Content */}
      <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--surface-border)" }}>
        {tab === "list" && <JourneysList />}
        {tab === "activity" && <ActivityPanel />}
      </div>

      {templatesOpen && (
        <TemplatesDialog onClose={() => setTemplatesOpen(false)} />
      )}
    </div>
  );
}
