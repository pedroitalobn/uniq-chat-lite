"use client";

// Módulo Jornadas — top-level. Cabeçalho concentra todas as formas de
// criar uma jornada (Uniq AI / Templates / Canvas em branco). Tabs
// dividem listagem e atividade em tempo real.

import { useState } from "react";
import Link from "next/link";
import { Activity, LayoutTemplate, Plus, Sparkles, Wand2 } from "lucide-react";
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
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="mb-3 sm:mb-4 flex-shrink-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2 sm:gap-3" style={{ color: "var(--text-1)" }}>
              <Wand2 className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: "#8b5cf6" }} />
              Jornadas
            </h1>
            <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--text-3)" }}>
              Cadências e regras de relacionamento — crie via canvas, template ou linguagem natural pelo Uniq AI.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/uniq-ai"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors"
              style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Criar via Uniq AI</span>
              <span className="sm:hidden">Uniq AI</span>
            </Link>
            <button
              onClick={() => setTemplatesOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors"
              style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.18)", color: "#a78bfa" }}
            >
              <LayoutTemplate className="w-4 h-4" />
              Templates
            </button>
            <button
              onClick={createBlank}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Canvas em branco</span>
              <span className="sm:hidden">Canvas</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl mb-3 sm:mb-4 flex-shrink-0 self-start" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all",
              )}
              style={{
                background: isActive ? "rgba(0,212,106,0.15)" : "transparent",
                color: isActive ? "var(--green)" : "var(--text-3)",
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
