"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { ACTION_CATEGORIES, ALL_ACTIONS, type ActionId } from "../../../_shared/actionsCatalog";
import { uid, type AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
  onClose: () => void;
};

const CONFIRMATION_OPTIONS: Array<{
  value: AgentForm["action_confirmation"];
  label: string;
  desc: string;
}> = [
  { value: "client", label: "Pedir ao cliente", desc: "Default — agente confirma no chat antes de executar" },
  { value: "auto",   label: "Auto-executar",    desc: "Sem confirmação. Use quando o risco é baixo" },
  { value: "human",  label: "Aprovação humana", desc: "Cria tarefa pra time aprovar antes de executar" },
];

// Modal com catálogo completo de ações nativas. Filtros por categoria
// + busca textual + política de confirmação no rodapé. Toggles
// persistem no array app_access (type=action) — mesmo formato do
// editor antigo, então convivem em paralelo.
export function SkillsModal({ form, update, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("");

  const isEnabled = (id: ActionId) =>
    form.app_access.some((e) => e.type === "action" && e.name === id && e.enabled);

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

  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ACTION_CATEGORIES.map((c) => ({
      ...c,
      actions: c.actions.filter((a) => {
        if (activeCat && c.id !== activeCat) return false;
        if (!q) return true;
        return (
          a.label.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q)
        );
      }),
    })).filter((c) => c.actions.length > 0);
  }, [query, activeCat]);

  const enabledCount = ALL_ACTIONS.filter((a) => isEnabled(a.id)).length;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              Habilidades & Ações
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
              {enabledCount} de {ALL_ACTIONS.length} ativadas pra esse agente
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filtros */}
        <div
          className="px-5 py-3 space-y-2 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
          >
            <Search className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ação..."
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: "var(--text-1)" }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CatChip
              label="Todas"
              emoji="✨"
              color="var(--text-2)"
              active={!activeCat}
              onClick={() => setActiveCat("")}
            />
            {ACTION_CATEGORIES.map((c) => (
              <CatChip
                key={c.id}
                label={c.label}
                emoji={c.emoji}
                color={c.color}
                active={activeCat === c.id}
                onClick={() => setActiveCat(activeCat === c.id ? "" : c.id)}
              />
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 min-h-0 overflow-auto px-5 py-3 space-y-4">
          {visibleCategories.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>
              Nenhuma ação encontrada com esse filtro.
            </p>
          ) : (
            visibleCategories.map((cat) => (
              <div key={cat.id}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span style={{ fontSize: 14 }}>{cat.emoji}</span>
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: cat.color }}>
                    {cat.label}
                  </h3>
                  <span className="text-[10px] font-mono" style={{ color: "var(--text-4)" }}>
                    {cat.actions.filter((a) => isEnabled(a.id)).length}/{cat.actions.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cat.actions.map((action) => {
                    const enabled = isEnabled(action.id);
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        onClick={() => toggle(action.id)}
                        className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all"
                        style={{
                          background: enabled ? `${cat.color}14` : "var(--surface-2)",
                          border: `1px solid ${enabled ? cat.color + "40" : "var(--surface-border)"}`,
                        }}
                      >
                        <span
                          className="flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 mt-0.5"
                          style={{
                            background: enabled ? `${cat.color}22` : "rgba(255,255,255,0.04)",
                            border: `1px solid ${enabled ? cat.color + "55" : "rgba(255,255,255,0.06)"}`,
                            color: enabled ? cat.color : "var(--text-3)",
                          }}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-xs font-semibold truncate"
                            style={{ color: enabled ? "var(--text-1)" : "var(--text-2)" }}
                          >
                            {action.label}
                          </p>
                          <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "var(--text-3)" }}>
                            {action.description}
                          </p>
                        </div>
                        <span
                          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                          style={{
                            background: enabled ? cat.color : "var(--surface-3)",
                            color: enabled ? "#0c0a09" : "var(--text-4)",
                          }}
                        >
                          {enabled ? "ON" : "OFF"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer — política de confirmação */}
        <div
          className="px-5 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid var(--surface-border)", background: "var(--surface-2)" }}
        >
          <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>
            Política padrão de confirmação
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {CONFIRMATION_OPTIONS.map((opt) => {
              const active = form.action_confirmation === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => update((p) => ({ ...p, action_confirmation: opt.value }))}
                  className="flex flex-col gap-1 px-3 py-2 rounded-lg text-left transition-all"
                  style={{
                    background: active ? "rgba(0,212,106,0.10)" : "var(--surface-1)",
                    border: `1px solid ${active ? "rgba(0,212,106,0.30)" : "var(--surface-border)"}`,
                  }}
                >
                  <span
                    className="text-xs font-semibold"
                    style={{ color: active ? "var(--green)" : "var(--text-2)" }}
                  >
                    {opt.label}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-4)" }}>
                    {opt.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CatChip({
  label,
  emoji,
  color,
  active,
  onClick,
}: {
  label: string;
  emoji: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
      style={{
        background: active ? `${color}1f` : "var(--surface-2)",
        border: `1px solid ${active ? color + "55" : "var(--surface-border)"}`,
        color: active ? color : "var(--text-3)",
      }}
    >
      <span>{emoji}</span>
      {label}
    </button>
  );
}
