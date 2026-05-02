"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformAIApi, PlatformAIConfig } from "@/lib/api";
import {
  Bot,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Sparkles,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "openai", label: "OpenAI", models: "gpt-4o,gpt-4o-mini,gpt-4-turbo,gpt-3.5-turbo" },
  { value: "anthropic", label: "Anthropic (Claude)", models: "claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001" },
  { value: "deepseek", label: "DeepSeek", models: "deepseek-chat,deepseek-reasoner" },
  { value: "groq", label: "Groq", models: "llama-3.3-70b-versatile,mixtral-8x7b-32768" },
  { value: "openrouter", label: "OpenRouter", models: "" },
  { value: "google", label: "Google Gemini", models: "gemini-2.0-flash,gemini-1.5-pro" },
  { value: "mistral", label: "Mistral", models: "mistral-large-latest,mistral-small-latest" },
  { value: "cohere", label: "Cohere", models: "command-r-plus,command-r" },
  { value: "custom", label: "Custom / Self-hosted", models: "" },
];

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const ok = status === "ok";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        ok
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : "bg-red-500/10 text-red-400 border border-red-500/20"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-emerald-400" : "bg-red-400")} />
      {ok ? "Conectado" : "Falhou"}
    </span>
  );
}

export default function PlatformAIPage() {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState<{
    provider: string;
    name: string;
    api_key: string;
    base_url: string;
    models: string;
    is_active: boolean;
  } | null>(null);

  const { data: config, isLoading } = useQuery<PlatformAIConfig>({
    queryKey: ["admin", "platform-ai"],
    queryFn: async () => {
      const res = await platformAIApi.get();
      return res.data;
    },
  });

  useEffect(() => {
    if (config && !form) {
      setForm({
        provider: config.provider || "openai",
        name: config.name || "Uniq AI",
        api_key: "",
        base_url: config.base_url || "",
        models: config.models || "",
        is_active: config.is_active ?? true,
      });
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: () =>
      platformAIApi.update({
        provider: form!.provider,
        name: form!.name,
        base_url: form!.base_url || undefined,
        models: form!.models || undefined,
        is_active: form!.is_active,
        ...(form!.api_key ? { api_key: form!.api_key } : {}),
      }),
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["admin", "platform-ai"] });
      setForm((prev) => prev ? { ...prev, api_key: "" } : prev);
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  const testMut = useMutation({
    mutationFn: () => platformAIApi.test(),
    onSuccess: (res) => {
      if (res.data.status === "ok") toast.success("Conexão OK");
      else toast.error(res.data.message || "Falhou");
      qc.invalidateQueries({ queryKey: ["admin", "platform-ai"] });
    },
    onError: () => toast.error("Erro ao testar"),
  });

  const selectedProvider = PROVIDERS.find((p) => p.value === form?.provider);

  function handleProviderChange(value: string) {
    const p = PROVIDERS.find((pr) => pr.value === value);
    setForm((prev) =>
      prev
        ? {
            ...prev,
            provider: value,
            models: p?.models || prev.models,
            base_url: value === "custom" ? prev.base_url : "",
          }
        : prev
    );
  }

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
          <Sparkles className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Uniq AI</h1>
          <p className="text-sm text-muted-foreground">
            Provedor de IA compartilhado — disponível para todos os usuários da plataforma
          </p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={config?.test_status} />
        </div>
      </div>

      {/* Card */}
      <div className="rounded-xl border bg-card p-6 space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Nome exibido</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((prev) => prev ? { ...prev, name: e.target.value } : prev)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            placeholder="Uniq AI"
          />
        </div>

        {/* Provider */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Provider LLM</label>
          <div className="relative">
            <select
              value={form.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full appearance-none px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 pr-8"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">API Key</label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={form.api_key}
              onChange={(e) => setForm((prev) => prev ? { ...prev, api_key: e.target.value } : prev)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 pr-10"
              placeholder={config?.has_api_key ? "••••••••••••••• (chave salva)" : "Insira a API key"}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {config?.has_api_key && !form.api_key && (
            <p className="text-xs text-muted-foreground">Deixe em branco para manter a chave atual</p>
          )}
        </div>

        {/* Base URL — only for custom or openrouter */}
        {(form.provider === "custom" || form.provider === "openrouter" || form.base_url) && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Base URL{" "}
              <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <input
              type="url"
              value={form.base_url}
              onChange={(e) => setForm((prev) => prev ? { ...prev, base_url: e.target.value } : prev)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              placeholder="https://api.seu-provider.com/v1"
            />
          </div>
        )}

        {/* Models */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Modelos disponíveis{" "}
            <span className="text-muted-foreground font-normal">(separados por vírgula)</span>
          </label>
          <input
            type="text"
            value={form.models}
            onChange={(e) => setForm((prev) => prev ? { ...prev, models: e.target.value } : prev)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            placeholder={selectedProvider?.models || "modelo-1,modelo-2"}
          />
          {selectedProvider?.models && (
            <p className="text-xs text-muted-foreground">
              Padrão: {selectedProvider.models}
            </p>
          )}
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium">Ativo</p>
            <p className="text-xs text-muted-foreground">
              Desativar oculta o Uniq AI para todos os usuários
            </p>
          </div>
          <button
            type="button"
            onClick={() => setForm((prev) => prev ? { ...prev, is_active: !prev.is_active } : prev)}
            className={cn(
              "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
              form.is_active ? "bg-violet-500" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out",
                form.is_active ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending || saveMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          {testMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TestTube2 className="h-4 w-4" />
          )}
          Testar conexão
        </button>

        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || testMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50 ml-auto"
        >
          {saveMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar
        </button>
      </div>

      {/* Info box */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex gap-3">
        <Bot className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-blue-300">Como funciona</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            O Uniq AI é um provedor de IA global da plataforma. Você configura o LLM por trás
            (OpenAI, DeepSeek, Claude, etc.) e todos os usuários podem usar via aba de Integrações,
            sem precisar inserir suas próprias chaves. Perfeito para oferecer IA como feature do plano.
          </p>
        </div>
      </div>
    </div>
  );
}
