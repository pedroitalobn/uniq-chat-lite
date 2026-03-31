"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plug, Plus, Trash2, RefreshCw, CheckCircle2, XCircle,
  Eye, EyeOff, ChevronDown, Zap, Globe, Bot,
} from "lucide-react";
import { integrationsApi } from "@/lib/api";
import { toast } from "sonner";

// ─── Provider icons (inline SVG) ─────────────────────────────────────────────

const ProviderIcon = ({ id, color }: { id: string; color: string }) => {
  const icons: Record<string, React.ReactNode> = {
    // OpenAI — star/sparkle
    openai: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M12 4.5l1.8 4.5 4.7.2-3.5 2.8 1.2 4.5L12 13.5l-4.2 3 1.2-4.5-3.5-2.8 4.7-.2z" fill={color} stroke={color} strokeWidth="0.5"/>
      </svg>
    ),
    // Claude — Anthropic "A" shape
    claude: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M7 16l2.5-8h2l2 4h1.5l1.5-4h1" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    // DeepSeek — whale/diver icon
    deepseek: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M6 13c1.5-2 4-3 6-3s4.5 1 6 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <path d="M9 10c.5-.8 1.5-1.5 3-1.5s2.5.7 3 1.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <circle cx="9" cy="11" r="1.2" fill={color}/>
        <circle cx="15" cy="11" r="1.2" fill={color}/>
      </svg>
    ),
    // Gemini — four-point star
    gemini: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M12 4c0 4-2 6-6 6 4 0 6 2 6 6 0-4 2-6 6-6-4 0-6-2-6-6z" fill={color}/>
      </svg>
    ),
    // OpenRouter — network/routing
    openrouter: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <circle cx="12" cy="12" r="2.5" fill={color}/>
        <path d="M12 9.5V6M12 14.5V18M9.5 12H6M14.5 12H18" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    // n8n — stylized n
    n8n: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M8 16V8l4 4 4-4v8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    // Kilo — K
    kilo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M8 8v8M8 12l4-4M8 12l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    // Z.AI — Z letter
    zai: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M8 8h8l-8 8h8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    // Kimi (Moonshot) — crescent moon
    kimi: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M15 8.5A6 6 0 0 0 9.5 15 4.5 4.5 0 0 1 15 8.5z" fill={color}/>
        <circle cx="16" cy="8" r="0.8" fill={color}/>
        <circle cx="18" cy="11" r="0.5" fill={color}/>
      </svg>
    ),
    // Qwen (Alibaba) — cloud shape
    qwen: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M7 14a3 3 0 0 1 0-4h1a4 4 0 0 1 7.5-2h.5A2.5 2.5 0 0 1 16 10.5a3 3 0 0 1-1 5.5H7z" fill={color}/>
      </svg>
    ),
    // MiniMax — double M
    minimax: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M6 15V9l2 4 2-4v6M14 15V9l2 4 2-4v6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    // Manus — hexagon with eye
    manus: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/>
        <path d="M6 12c0 0 3-4 6-4s6 4 6 4-3 4-6 4-6-4-6-4z" stroke={color} strokeWidth="1.5" fill="none"/>
        <circle cx="12" cy="12" r="2" fill={color}/>
      </svg>
    ),
  };
  return icons[id] || <Plug className="w-5 h-5" style={{ color }} />;
};

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: "claude",
    name: "Claude (Anthropic)",
    description: "claude-3-5-sonnet, claude-opus-4 e mais",
    color: "#d4a27f",
    bg: "rgba(212,162,127,0.08)",
    border: "rgba(212,162,127,0.2)",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022"],
    hasBaseURL: false,
  },
  {
    id: "openai",
    name: "ChatGPT (OpenAI)",
    description: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo e mais",
    color: "#10a37f",
    bg: "rgba(16,163,127,0.08)",
    border: "rgba(16,163,127,0.2)",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    hasBaseURL: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "deepseek-chat, deepseek-reasoner e mais",
    color: "#4f6ef7",
    bg: "rgba(79,110,247,0.08)",
    border: "rgba(79,110,247,0.2)",
    models: ["deepseek-chat", "deepseek-reasoner"],
    hasBaseURL: false,
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    description: "gemini-1.5-pro, gemini-1.5-flash e mais",
    color: "#4285f4",
    bg: "rgba(66,133,244,0.08)",
    border: "rgba(66,133,244,0.2)",
    models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
    hasBaseURL: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Acesse 100+ modelos via API unificada",
    color: "#7c3aed",
    bg: "rgba(124,58,237,0.08)",
    border: "rgba(124,58,237,0.2)",
    models: ["openai/gpt-4o", "anthropic/claude-opus-4", "google/gemini-pro", "meta-llama/llama-3.1-70b-instruct"],
    hasBaseURL: false,
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Automações e workflows via webhook n8n",
    color: "#ea5e0e",
    bg: "rgba(234,94,14,0.08)",
    border: "rgba(234,94,14,0.2)",
    models: [],
    hasBaseURL: true,
    urlLabel: "Webhook URL do n8n",
    keyLabel: "API Key (opcional)",
  },
  {
    id: "kilo",
    name: "Kilo",
    description: "LLM Kilo - Modelo de linguagem avançado",
    color: "#00d46a",
    bg: "rgba(0,212,106,0.08)",
    border: "rgba(0,212,106,0.2)",
    models: ["kilo/kilo-auto/balanced", "kilo/kilo-auto/reasoning", "kilo/kilo-auto/fast"],
    hasBaseURL: false,
  },
  {
    id: "zai",
    name: "Z.AI",
    description: "Z.AI - Modelo de IA brasileiro",
    color: "#f97316",
    bg: "rgba(249,115,22,0.08)",
    border: "rgba(249,115,22,0.2)",
    models: ["zai/balanco-7b", "zai/pro-7b", "zai/fast-3b"],
    hasBaseURL: false,
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    description: "Moonshot AI - Assistente chinês com contexto longo",
    color: "#00a6ed",
    bg: "rgba(0,166,237,0.08)",
    border: "rgba(0,166,237,0.2)",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    hasBaseURL: false,
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba)",
    description: "Qwen - Modelo da Alibaba Cloud",
    color: "#ff6a00",
    bg: "rgba(255,106,0,0.08)",
    border: "rgba(255,106,0,0.2)",
    models: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen2.5-72b-instruct"],
    hasBaseURL: false,
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax - Modelo chinês de alta performance",
    color: "#7c3aed",
    bg: "rgba(124,58,237,0.08)",
    border: "rgba(124,58,237,0.2)",
    models: ["abab6.5-chat", "abab6.5s-chat", "MiniMax-M1"],
    hasBaseURL: false,
  },
  {
    id: "manus",
    name: "Manus",
    description: "Manus - Modelo de IA avançado",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.08)",
    border: "rgba(236,72,153,0.2)",
    models: ["manus-base", "manus-pro"],
    hasBaseURL: false,
  },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Integration {
  id: string;
  provider: ProviderId;
  name: string;
  masked_key: string;
  base_url?: string;
  model?: string;
  is_active: boolean;
  test_status?: string;
  last_tested_at?: string;
  created_at: string;
}

// ─── Connect Modal ────────────────────────────────────────────────────────────

function ConnectModal({
  provider: providerId,
  onClose,
}: {
  provider: ProviderId;
  onClose: () => void;
}) {
  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: provider.name as string,
    api_key: "",
    base_url: "",
    model: (provider.models[0] ?? "") as string,
  });
  const [showKey, setShowKey] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      integrationsApi.create({
        provider: providerId,
        name: form.name,
        api_key: form.api_key,
        base_url: form.base_url || undefined,
        model: form.model || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integração conectada com sucesso!");
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || "Erro ao conectar integração");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-5"
        style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: provider.bg, border: `1px solid ${provider.border}` }}>
            <ProviderIcon id={provider.id} color={provider.color} />
          </div>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>
              Conectar {provider.name}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>{provider.description}</p>
          </div>
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Nome da integração</label>
          <input
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-1"
            style={{
              background: "var(--surface-3)", borderColor: "var(--surface-border)",
              color: "var(--text-1)",
            }}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
            {provider.id === "n8n" ? "API Key (opcional)" : "API Key"}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              className="w-full rounded-xl border px-3 py-2 pr-10 text-sm outline-none focus:ring-1"
              style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-1)" }}
              placeholder={`sk-...`}
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-3)" }}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Base URL (n8n / webhook / openrouter) */}
        {(provider.hasBaseURL || providerId === "openrouter") && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
              {provider.id === "n8n" ? "Webhook URL do n8n" : "Base URL (opcional)"}
            </label>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-1)" }}
              placeholder="https://..."
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
          </div>
        )}

        {/* Model */}
        {provider.models.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Modelo</label>
            {!customModel ? (
              <div className="relative">
                <select
                  className="w-full rounded-xl border px-3 py-2 text-sm appearance-none outline-none"
                  style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-1)" }}
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                >
                  {provider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                  style={{ color: "var(--text-3)" }} />
              </div>
            ) : (
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-1)" }}
                placeholder="nome-do-modelo"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            )}
            <button
              type="button"
              onClick={() => setCustomModel(!customModel)}
              className="text-xs underline"
              style={{ color: "var(--text-3)" }}
            >
              {customModel ? "Usar lista de modelos" : "Digitar modelo personalizado"}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border text-sm font-medium transition-opacity hover:opacity-70"
            style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || (!form.api_key && providerId !== "n8n")}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--green)", color: "#000" }}
          >
            {create.isPending ? "Conectando..." : "Conectar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Integration Card ─────────────────────────────────────────────────────────

function IntegrationCard({ integration }: { integration: Integration }) {
  const qc = useQueryClient();
  const provider = PROVIDERS.find((p) => p.id === integration.provider);

  const del = useMutation({
    mutationFn: () => integrationsApi.delete(integration.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integração removida");
    },
  });

  const test = useMutation({
    mutationFn: () => integrationsApi.test(integration.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Conexão OK!");
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.error("Falha na conexão");
    },
  });

  const color = provider?.color ?? "#64748b";
  const bg = provider?.bg ?? "rgba(100,116,139,0.08)";
  const border = provider?.border ?? "rgba(100,116,139,0.2)";

  return (
    <div className="rounded-2xl border p-4 flex items-center gap-4"
      style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
      {/* Icon */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: bg, border: `1px solid ${border}` }}>
        <Plug className="w-5 h-5" style={{ color }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
            {integration.name}
          </p>
          {integration.test_status === "ok" && (
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />
          )}
          {integration.test_status === "failed" && (
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" />
          )}
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
          {provider?.name} {integration.model ? `· ${integration.model}` : ""}
          {integration.masked_key ? ` · ${integration.masked_key}` : ""}
        </p>
      </div>

      {/* Status pill */}
      <div className="flex-shrink-0">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          integration.is_active
            ? "text-green-400 bg-green-500/10"
            : "text-gray-400 bg-gray-500/10"
        }`}>
          {integration.is_active ? "Ativo" : "Inativo"}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className="p-2 rounded-xl transition-colors hover:bg-neutral-500/10"
          style={{ color: "var(--text-3)" }}
          title="Testar conexão"
        >
          <RefreshCw className={`w-4 h-4 ${test.isPending ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          className="p-2 rounded-xl transition-colors hover:bg-red-500/10 hover:text-red-400"
          style={{ color: "var(--text-3)" }}
          title="Remover"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Provider Button ──────────────────────────────────────────────────────────

function ProviderButton({
  provider,
  connected,
  onClick,
}: {
  provider: typeof PROVIDERS[number];
  connected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all hover:scale-[1.01]"
      suppressHydrationWarning
      style={{
        background: provider.bg,
        borderColor: connected ? provider.color : provider.border,
        opacity: 1,
      }}
    >
      {connected && (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-500/20 text-green-400">
          <CheckCircle2 className="w-2.5 h-2.5" /> conectado
        </span>
      )}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: `${provider.color}18` }} suppressHydrationWarning>
        <ProviderIcon id={provider.id} color={provider.color} />
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{provider.name}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--text-3)" }}>
          {provider.description}
        </p>
      </div>
      {!connected && (
        <div className="flex items-center gap-1 text-xs font-medium mt-1" style={{ color: provider.color }}>
          <Plus className="w-3 h-3" /> Conectar
        </div>
      )}
      {connected && (
        <div className="flex items-center gap-1 text-xs font-medium mt-1" style={{ color: provider.color }}>
          <Plus className="w-3 h-3" /> Adicionar outro
        </div>
      )}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [connecting, setConnecting] = useState<ProviderId | null>(null);

  const { data, isLoading } = useQuery<Integration[]>({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await integrationsApi.list();
      return res.data;
    },
  });

  const integrations = data ?? [];
  const connectedProviders = new Set(integrations.map((i) => i.provider));

  return (
    <div className="min-h-screen p-6 lg:p-8" style={{ background: "var(--bg)" }} suppressHydrationWarning>
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }} suppressHydrationWarning>
                <Plug className="w-4 h-4" style={{ color: "var(--green)" }} />
              </div>
              <h1 className="text-xl font-bold" style={{ color: "var(--text-1)" }}>Integrações</h1>
            </div>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>
              Conecte LLMs, ferramentas de automação e serviços externos à sua conta
            </p>
          </div>
        </div>

        {/* Use-case info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              icon: Bot,
              title: "Agente nas Instâncias",
              desc: "Conecte um LLM a uma instância WhatsApp para respostas automáticas com IA",
              color: "var(--green)",
            },
            {
              icon: Zap,
              title: "Variações de Campanha",
              desc: "Gere múltiplas versões de mensagens para disparo usando IA",
              color: "#7c3aed",
            },
            {
              icon: Globe,
              title: "Automações n8n",
              desc: "Envie eventos para fluxos n8n e retorne respostas personalizadas",
              color: "#ea5e0e",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl border p-4"
              style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2.5"
                style={{ background: `${card.color}15` }}>
                <card.icon className="w-3.5 h-3.5" style={{ color: card.color }} />
              </div>
              <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-1)" }}>{card.title}</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>{card.desc}</p>
            </div>
          ))}
        </div>

        {/* Provider grid */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-3)" }}>
            Provedores disponíveis
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {PROVIDERS.map((p) => (
              <ProviderButton
                key={p.id}
                provider={p}
                connected={connectedProviders.has(p.id)}
                onClick={() => setConnecting(p.id)}
              />
            ))}
          </div>
        </div>

        {/* Active integrations */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-3)" }}>
            Integrações conectadas
          </h2>
          {isLoading && (
            <div className="text-sm py-8 text-center" style={{ color: "var(--text-3)" }}>
              Carregando...
            </div>
          )}
          {!isLoading && integrations.length === 0 && (
            <div className="rounded-2xl border border-dashed py-12 flex flex-col items-center gap-3"
              style={{ borderColor: "var(--surface-border)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(0,212,106,0.06)", border: "1px solid rgba(0,212,106,0.12)" }}>
                <Plug className="w-5 h-5" style={{ color: "var(--green)", opacity: 0.5 }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>
                  Nenhuma integração conectada
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
                  Escolha um provedor acima para começar
                </p>
              </div>
            </div>
          )}
          {!isLoading && integrations.length > 0 && (
            <div className="space-y-2">
              {integrations.map((integration) => (
                <IntegrationCard key={integration.id} integration={integration} />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Connect modal */}
      {connecting && (
        <ConnectModal
          provider={connecting}
          onClose={() => setConnecting(null)}
        />
      )}
    </div>
  );
}
