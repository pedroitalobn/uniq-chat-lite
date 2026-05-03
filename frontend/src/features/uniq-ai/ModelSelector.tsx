"use client";

// ModelSelector — seletor de integração + modelo do Uniq AI.
// Estilo Cursor/Claude Code: pill compacta que abre dropdown agrupado por provider.
// Persiste em localStorage (model-preference.ts) para que Dynamic Island
// e chat-panel compartilhem a mesma preferência.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, Loader2, Sparkles, Zap } from "lucide-react";
import { integrationsApi, platformAIApi } from "@/lib/api";
import { loadModelPref, saveModelPref, type ModelPreference } from "./model-preference";

export interface ModelSelectorProps {
  value: ModelPreference | null;
  onChange: (pref: ModelPreference) => void;
}

const LLM_PROVIDERS = ["openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"];

const PROVIDER_COLORS: Record<string, string> = {
  openai:      "#10a37f",
  claude:      "#d97706",
  deepseek:    "#6366f1",
  gemini:      "#4285f4",
  openrouter:  "#7c3aed",
  kilo:        "#06b6d4",
  manus:       "#f43f5e",
  default:     "#6b7280",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai:      "OpenAI",
  claude:      "Anthropic",
  deepseek:    "DeepSeek",
  gemini:      "Gemini",
  openrouter:  "OpenRouter",
  kilo:        "Kilo",
  zai:         "ZAI",
  kimi:        "Kimi",
  qwen:        "Qwen",
  minimax:     "MiniMax",
  manus:       "Manus",
};

function providerColor(p: string) {
  return PROVIDER_COLORS[p.toLowerCase()] ?? PROVIDER_COLORS.default;
}

function providerLabel(p: string) {
  return PROVIDER_LABELS[p.toLowerCase()] ?? p.toUpperCase();
}

function ProviderBadge({ provider, size = "sm" }: { provider: string; size?: "sm" | "xs" }) {
  const color = providerColor(provider);
  const label = providerLabel(provider);
  const cls = size === "xs" ? "text-[8px] px-1 py-0 rounded" : "text-[9px] px-1.5 py-0.5 rounded";
  return (
    <span
      className={`font-bold uppercase tracking-wide ${cls}`}
      style={{ background: color + "22", color, border: `1px solid ${color}44` }}
    >
      {label.slice(0, 3)}
    </span>
  );
}

interface Integration {
  id: string;
  name: string;
  provider: string;
  models: string[];
}

// Preferência virtual que representa a Uniq AI (plataforma)
const PLATFORM_AI_PREF: ModelPreference = {
  integrationId: "platform-ai",
  integrationName: "Uniq AI",
  provider: "platform",
  model: "",
};

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Record<string, Integration[]>>({});
  const [hasPlatformAI, setHasPlatformAI] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [intRes, paiRes] = await Promise.allSettled([
        integrationsApi.list(),
        platformAIApi.getPublic(),
      ]);

      const pai = paiRes.status === "fulfilled" ? paiRes.value.data : null;
      const platformActive = !!(pai?.is_active && pai?.provider);
      setHasPlatformAI(platformActive);

      const filtered: Integration[] = (intRes.status === "fulfilled" ? intRes.value.data || [] : [])
        .filter((i: any) => i.is_active && LLM_PROVIDERS.includes(i.provider?.toLowerCase()))
        .map((i: any) => ({
          id: i.id,
          name: i.name,
          provider: i.provider?.toLowerCase() ?? "other",
          models: Array.isArray(i.models) ? i.models : [],
        }));

      const g: Record<string, Integration[]> = {};
      for (const integ of filtered) {
        const key = providerLabel(integ.provider);
        if (!g[key]) g[key] = [];
        g[key].push(integ);
      }
      setGroups(g);

      // Auto-seleção: preferência salva → Uniq AI (quando ativa) → primeira integração
      if (!value) {
        const saved = loadModelPref();
        const stillActive = saved && (
          saved.integrationId === "platform-ai" ? platformActive :
          filtered.find((i) => i.id === saved.integrationId)
        );
        if (stillActive) {
          onChange(saved!);
        } else if (platformActive) {
          // Uniq AI é o padrão quando disponível
          saveModelPref(PLATFORM_AI_PREF);
          onChange(PLATFORM_AI_PREF);
        } else if (filtered.length > 0) {
          const first = filtered[0];
          const pref: ModelPreference = {
            integrationId: first.id,
            integrationName: first.name,
            provider: first.provider,
            model: first.models[0] ?? "",
          };
          saveModelPref(pref);
          onChange(pref);
        }
      }
    } catch {
      /* silencia */
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Fecha ao clicar fora
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const select = (integ: Integration, model: string) => {
    const pref: ModelPreference = {
      integrationId: integ.id,
      integrationName: integ.name,
      provider: integ.provider,
      model,
    };
    saveModelPref(pref);
    onChange(pref);
    setOpen(false);
  };

  const allCount = Object.values(groups).reduce((s, arr) => s + arr.reduce((a, i) => a + Math.max(i.models.length, 1), 0), 0);

  return (
    <div className="relative" ref={ref}>
      {/* Pill */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-all"
        style={{
          background: open ? "var(--surface-3)" : "transparent",
          border: "1px solid " + (open ? "var(--surface-border)" : "transparent"),
          color: "var(--text-2)",
        }}
        title="Selecionar modelo"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--text-3)" }} />
        ) : value?.integrationId === "platform-ai" ? (
          <>
            <Sparkles className="w-3 h-3 flex-shrink-0" style={{ color: "var(--green)" }} />
            <span className="truncate max-w-[120px] sm:max-w-[160px]" style={{ color: "var(--green)" }}>
              Uniq AI
            </span>
          </>
        ) : value ? (
          <>
            <ProviderBadge provider={value.provider} size="xs" />
            <span className="truncate max-w-[120px] sm:max-w-[160px]" style={{ color: "var(--text-1)" }}>
              {value.model || value.integrationName}
            </span>
          </>
        ) : (
          <>
            <Zap className="w-3 h-3" style={{ color: "var(--text-3)" }} />
            <span style={{ color: "var(--text-3)" }}>Modelo</span>
          </>
        )}
        <ChevronDown
          className="w-3 h-3 flex-shrink-0 transition-transform"
          style={{ color: "var(--text-3)", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full mb-1.5 left-0 z-50 rounded-xl overflow-hidden shadow-2xl"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              width: 260,
              maxHeight: 360,
              overflowY: "auto",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            }}
          >
            <div className="py-1">
              {/* Uniq AI — sempre no topo quando ativa */}
              {hasPlatformAI && (
                <div>
                  <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                    Plataforma
                  </div>
                  <button
                    onClick={() => {
                      saveModelPref(PLATFORM_AI_PREF);
                      onChange(PLATFORM_AI_PREF);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ background: value?.integrationId === "platform-ai" ? "rgba(0,212,106,0.08)" : "transparent" }}
                    onMouseEnter={(e) => value?.integrationId !== "platform-ai" && (e.currentTarget.style.background = "var(--surface-3)")}
                    onMouseLeave={(e) => value?.integrationId !== "platform-ai" && (e.currentTarget.style.background = "transparent")}
                  >
                    <div className="w-3.5 h-3.5 flex-shrink-0">
                      {value?.integrationId === "platform-ai"
                        ? <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                        : <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: value?.integrationId === "platform-ai" ? "var(--green)" : "var(--text-1)" }}>
                        Uniq AI
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                        Padrão da plataforma
                      </p>
                    </div>
                  </button>
                </div>
              )}
              {allCount === 0 && !hasPlatformAI ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>
                    Nenhuma integração LLM ativa.
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                    Vá em Integrações para conectar OpenAI, Claude etc.
                  </p>
                </div>
              ) : (
                <>
                {Object.entries(groups).map(([providerLabel, integrations]) => (
                  <div key={providerLabel}>
                    {/* Provider header */}
                    <div
                      className="px-3 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest"
                      style={{ color: "var(--text-3)" }}
                    >
                      {providerLabel}
                    </div>
                    {integrations.map((integ) =>
                      integ.models.length > 0
                        ? integ.models.map((model) => {
                            const isActive =
                              value?.integrationId === integ.id && value?.model === model;
                            return (
                              <button
                                key={`${integ.id}-${model}`}
                                onClick={() => select(integ, model)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                                style={{
                                  background: isActive ? "rgba(0,212,106,0.08)" : "transparent",
                                }}
                                onMouseEnter={(e) =>
                                  !isActive && ((e.currentTarget.style.background = "var(--surface-3)"))
                                }
                                onMouseLeave={(e) =>
                                  !isActive && ((e.currentTarget.style.background = "transparent"))
                                }
                              >
                                <div className="w-3.5 h-3.5 flex-shrink-0">
                                  {isActive && (
                                    <Check
                                      className="w-3.5 h-3.5"
                                      style={{ color: "var(--green)" }}
                                    />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p
                                    className="text-xs font-medium truncate"
                                    style={{
                                      color: isActive ? "var(--green)" : "var(--text-1)",
                                    }}
                                  >
                                    {model}
                                  </p>
                                  <p
                                    className="text-[10px] truncate"
                                    style={{ color: "var(--text-3)" }}
                                  >
                                    {integ.name}
                                  </p>
                                </div>
                              </button>
                            );
                          })
                        : /* integração sem models listados — usa nome da integração */
                          (() => {
                            const isActive =
                              value?.integrationId === integ.id;
                            return (
                              <button
                                key={integ.id}
                                onClick={() => select(integ, "")}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                                style={{ background: isActive ? "rgba(0,212,106,0.08)" : "transparent" }}
                                onMouseEnter={(e) =>
                                  !isActive && ((e.currentTarget.style.background = "var(--surface-3)"))
                                }
                                onMouseLeave={(e) =>
                                  !isActive && ((e.currentTarget.style.background = "transparent"))
                                }
                              >
                                <div className="w-3.5 h-3.5 flex-shrink-0">
                                  {isActive && <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p
                                    className="text-xs font-medium truncate"
                                    style={{ color: isActive ? "var(--green)" : "var(--text-1)" }}
                                  >
                                    {integ.name}
                                  </p>
                                </div>
                              </button>
                            );
                          })()
                    )}
                  </div>
                ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
