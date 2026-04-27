"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plug, Plus, Trash2, RefreshCw, CheckCircle2,
  Eye, EyeOff, Zap, Globe, Bot, Webhook,
  Key, FileJson, ExternalLink, Loader2, Link2, Copy, X, ShoppingBag,
} from "lucide-react";
import { ShopSection } from "@/components/integrations/ShopSection";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { integrationsApi, apiKeysApi, proxiesApi, adminApi, instancesApi } from "@/lib/api";
import { toast } from "sonner";
import { WebhooksPanel } from "@/components/webhooks/WebhooksPanel";
import type { APIKey, Proxy } from "@/types";

type GlobalProxyConfig = {
  id: string;
  name: string;
  enabled: boolean;
  use_env?: boolean;
  host: string;
  port: number;
  proxy_type: string;
  username: string;
  country: string;
};
import { DocsSection } from "./DocsSection";

// ─── Provider icons (inline SVG) ─────────────────────────────────────────────
const ProviderIcon = ({ id, color }: { id: string; color: string }) => {
  const icons: Record<string, React.ReactNode> = {
    openai: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M12 4.5l1.8 4.5 4.7.2-3.5 2.8 1.2 4.5L12 13.5l-4.2 3 1.2-4.5-3.5-2.8 4.7-.2z" fill={color} stroke={color} strokeWidth="0.5"/></svg>,
    claude: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M7 16l2.5-8h2l2 4h1.5l1.5-4h1" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
    deepseek: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M6 13c1.5-2 4-3 6-3s4.5 1 6 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>,
    gemini: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M12 4c0 4-2 6-6 6 4 0 6 2 6 6 0-4 2-6 6-6-4 0-6-2-6-6z" fill={color}/></svg>,
    openrouter: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><circle cx="12" cy="12" r="2.5" fill={color}/><path d="M12 9.5V6M12 14.5V18M9.5 12H6M14.5 12H18" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>,
    qwen: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M8 8l8 8M16 8l-8 8" stroke={color} strokeWidth="2" strokeLinecap="round"/></svg>,
    n8n: <svg viewBox="0 0 24 24" className="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="4" stroke={color} strokeWidth="1.5" fill="none"/><path d="M8 16V8l4 4 4-4v8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
    kilo: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M8 8v8M8 12l4-4M8 12l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    kimi: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><circle cx="9" cy="11" r="1.2" fill={color}/><circle cx="15" cy="11" r="1.2" fill={color}/><path d="M8 15c1 1.5 2.5 2 4 2s3-.5 4-2" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>,
    mistral: <svg viewBox="0 0 24 24" className="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="1.5" fill="none"/><path d="M6 16V8h3v4h3V8h3v4h3v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
    zai: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M8 8h8l-8 8h8" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
    minimax: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M8 14V10M12 14V10M16 14V10M6 16h12" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></svg>,
    manus: <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none"/><path d="M8 16v-4c0-2 1.5-4 4-4s4 2 4 4v4M10 14v-2M14 14v-2" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></svg>,
  };
  return icons[id] || <Plug className="w-5 h-5" style={{ color }} />;
};

const PROVIDERS = [
  { id: "claude", name: "Claude (Anthropic)", description: "API key OR login com conta claude.ai", color: "#d4a27f", bg: "rgba(212,162,127,0.08)", border: "rgba(212,162,127,0.2)", models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"], supportsOAuth: true },
  { id: "openai", name: "ChatGPT (OpenAI)", description: "gpt-4o, gpt-4o-mini, o1-preview", color: "#10a37f", bg: "rgba(16,163,127,0.08)", border: "rgba(16,163,127,0.2)", models: ["gpt-4o", "gpt-4o-mini", "o1-preview"] },
  { id: "deepseek", name: "DeepSeek", description: "deepseek-chat, deepseek-reasoner", color: "#4f6ef7", bg: "rgba(79,110,247,0.08)", border: "rgba(79,110,247,0.2)", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "gemini", name: "Gemini (Google)", description: "gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash", color: "#4285f4", bg: "rgba(66,133,244,0.08)", border: "rgba(66,133,244,0.2)", models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"] },
  { id: "openrouter", name: "OpenRouter", description: "API key OR login com conta OpenRouter — 100+ modelos", color: "#7c3aed", bg: "rgba(124,58,237,0.08)", border: "rgba(124,58,237,0.2)", models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5", "google/gemini-2.5-pro"], supportsOAuth: true },
  { id: "qwen", name: "Qwen (Alibaba)", description: "qwen-turbo, qwen-plus, qwen-max", color: "#ff6a00", bg: "rgba(255,106,0,0.08)", border: "rgba(255,106,0,0.2)", models: ["qwen-turbo", "qwen-plus", "qwen-max"] },
  { id: "kimi", name: "Kimi (Moonshot)", description: "moonshot-v1-8k/32k/128k", color: "#1f8ae0", bg: "rgba(31,138,224,0.08)", border: "rgba(31,138,224,0.2)", models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"] },
  { id: "mistral", name: "Mistral AI", description: "mistral-large, mistral-small, codestral", color: "#ff7000", bg: "rgba(255,112,0,0.08)", border: "rgba(255,112,0,0.2)", models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest", "mistral-medium-latest"] },
  { id: "zai", name: "Z.ai (ChatGLM)", description: "glm-4-plus, glm-4-flash, glm-4-air", color: "#6c5ce7", bg: "rgba(108,92,231,0.08)", border: "rgba(108,92,231,0.2)", models: ["glm-4-plus", "glm-4-flash", "glm-4-air"] },
  { id: "minimax", name: "MiniMax", description: "Modelos da MiniMax", color: "#00bcd4", bg: "rgba(0,188,212,0.08)", border: "rgba(0,188,212,0.2)", models: ["MiniMax-Text-01", "abab6.5-chat"] },
  { id: "manus", name: "Manus", description: "Modelos da Manus", color: "#eab308", bg: "rgba(234,179,8,0.08)", border: "rgba(234,179,8,0.2)", models: ["manus-base"] },
  { id: "n8n", name: "n8n", description: "Automações e workflows", color: "#ea5e0e", bg: "rgba(234,94,14,0.08)", border: "rgba(234,94,14,0.2)", models: [], hasBaseURL: true },
  { id: "kilo", name: "Kilo", description: "LLM Kilo - Modelo avançado", color: "#00d46a", bg: "rgba(0,212,106,0.08)", border: "rgba(0,212,106,0.2)", models: ["kilo/kilo-auto/balanced"] },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

interface Integration {
  id: string;
  provider: ProviderId;
  name: string;
  masked_key: string;
  base_url?: string;
  models?: string[];
  is_active: boolean;
  test_status?: string;
  created_at: string;
}

type Section = "llm" | "agents" | "api" | "webhook" | "mcp" | "shop" | "docs";

const VALID_SECTIONS: Section[] = ["llm", "agents", "api", "webhook", "mcp", "docs"];

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as Section) || "llm";
  const [section, setSection] = useState<Section>(
    VALID_SECTIONS.includes(initialTab) ? initialTab : "llm"
  );
  const [connecting, setConnecting] = useState<ProviderId | null>(null);

  // Reage a mudanças de ?tab=... (navegação via URL externa / back)
  useEffect(() => {
    const tab = searchParams.get("tab") as Section | null;
    if (tab && VALID_SECTIONS.includes(tab) && tab !== section) {
      setSection(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Mantém URL sincronizada quando user clica em tab
  const handleSectionChange = (s: Section) => {
    setSection(s);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("tab", s);
    router.replace(`/integrations?${params.toString()}`, { scroll: false });
  };

  const sections = [
    { id: "llm" as const, label: "LLMs", icon: Bot, color: "var(--green)" },
    { id: "agents" as const, label: "Agents", icon: Zap, color: "#8b5cf6" },
    { id: "mcp" as const, label: "MCPs", icon: Link2, color: "#f59e0b" },
    { id: "webhook" as const, label: "Webhooks", icon: Webhook, color: "#10b981" },
    { id: "shop" as const, label: "Shop", icon: ShoppingBag, color: "#22c55e" },
    { id: "api" as const, label: "API Keys", icon: Key, color: "#f59e0b" },
    { id: "docs" as const, label: "API Docs", icon: FileJson, color: "#64748b" },
  ];

  return (
    <div className="min-h-screen p-6 lg:p-8" style={{ background: "var(--bg)" }}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "var(--green-soft)", border: "1px solid var(--green-border)" }}>
              <Plug className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <h1 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Integrações</h1>
          </div>
          <p className="text-xs hidden sm:block" style={{ color: "var(--text-3)" }}>
            LLMs, agentes, webhooks, shop e mais
          </p>
        </div>

        {/* Layout: sidebar interna + content (mesmo padrão de /settings) */}
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
          {/* Mobile tabs */}
          <div className="sm:hidden flex gap-1 p-1 rounded-xl w-full overflow-x-auto"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            {sections.map((s) => {
              const isActive = section === s.id;
              return (
                <button key={s.id} onClick={() => handleSectionChange(s.id)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{ background: isActive ? `${s.color}15` : "transparent", color: isActive ? s.color : "var(--text-3)" }}>
                  <s.icon className="w-3.5 h-3.5" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden sm:flex w-44 lg:w-52 flex-shrink-0 sticky top-4">
            <nav className="rounded-2xl overflow-hidden w-full"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
              {sections.map((s, i) => {
                const Icon = s.icon;
                const isActive = section === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSectionChange(s.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 lg:px-4 py-3 lg:py-3.5 text-left transition-all duration-150 relative",
                      i < sections.length - 1 ? "border-b" : ""
                    )}
                    style={{
                      borderColor: "var(--surface-border)",
                      background: isActive ? "var(--green-dim)" : "transparent",
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--surface-3)"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                        style={{ background: s.color }} />
                    )}
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isActive ? `${s.color}26` : "var(--surface-3)",
                        border: `1px solid ${isActive ? s.color + "40" : "var(--surface-border)"}`,
                      }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: isActive ? s.color : "var(--text-3)" }} />
                    </div>
                    <p className="text-xs font-medium truncate" style={{ color: isActive ? s.color : "var(--text-1)" }}>
                      {s.label}
                    </p>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 w-full">
            {section === "llm" && <LLMSection onConnect={setConnecting} />}
            {section === "agents" && <AgentsSection />}
            {section === "mcp" && <MCPSection />}
            {section === "webhook" && <WebhooksPanel />}
            {section === "shop" && <ShopSection />}
            {section === "api" && <APIKeysSection />}
            {section === "docs" && <DocsSection />}
          </div>
        </div>
      </div>

      {connecting && <ConnectModal provider={connecting} onClose={() => setConnecting(null)} />}
    </div>
  );
}

// ─── LLM Section ─────────────────────────────────────────────────────────────
function LLMSection({ onConnect }: { onConnect: (p: ProviderId) => void }) {
  const { data, isLoading } = useQuery<Integration[]>({ queryKey: ["integrations"], queryFn: () => integrationsApi.list().then(r => r.data) });
  const integrations = data ?? [];
  const connectedProviders = new Set(integrations.map((i) => i.provider));

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {PROVIDERS.map((p) => (
          <button key={p.id} onClick={() => onConnect(p.id)} className="relative flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all hover:scale-[1.01]"
            style={{ background: p.bg, borderColor: connectedProviders.has(p.id) ? p.color : p.border }}>
            {connectedProviders.has(p.id) && <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-green-500/20 text-green-400"><CheckCircle2 className="w-2.5 h-2.5" /> conectado</span>}
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${p.color}18` }}><ProviderIcon id={p.id} color={p.color} /></div>
            <div><p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{p.name}</p><p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{p.description}</p></div>
            <div className="flex items-center gap-1 text-xs font-medium mt-1" style={{ color: p.color }}><Plus className="w-3 h-3" /> {connectedProviders.has(p.id) ? "Adicionar" : "Conectar"}</div>
          </button>
        ))}
      </div>
      {integrations.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Integrações conectadas</h3>
          {integrations.map(i => <IntegrationCard key={i.id} integration={i} />)}
        </div>
      )}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const qc = useQueryClient();
  const provider = PROVIDERS.find(p => p.id === integration.provider);
  const del = useMutation({ mutationFn: () => integrationsApi.delete(integration.id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast.success("Integração removida"); } });
  const test = useMutation({ mutationFn: () => integrationsApi.test(integration.id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast.success("Conexão OK!"); }, onError: () => toast.error("Falha") });
  const color = provider?.color ?? "#64748b";
  return (
    <div className="rounded-2xl border p-4 flex items-center gap-4" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18`, border: `1px solid ${color}30` }}><Plug className="w-5 h-5" style={{ color }} /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2"><p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{integration.name}</p>
          {integration.test_status === "ok" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}</div>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{provider?.name} · {integration.models?.length || 0} modelo(s)</p>
      </div>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${integration.is_active ? "text-green-400 bg-green-500/10" : "text-gray-400 bg-gray-500/10"}`}>{integration.is_active ? "Ativo" : "Inativo"}</span>
      <div className="flex gap-1.5"><button onClick={() => test.mutate()} className="p-2 rounded-xl hover:bg-neutral-500/10"><RefreshCw className={`w-4 h-4 ${test.isPending ? "animate-spin" : ""}`} style={{ color: "var(--text-3)" }} /></button><button onClick={() => del.mutate()} className="p-2 rounded-xl hover:bg-red-500/10"><Trash2 className="w-4 h-4" style={{ color: "var(--text-3)" }} /></button></div>
    </div>
  );
}

// ─── API Keys Section ───────────────────────────────────────────────────────
function APIKeysSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<APIKey[]>({ queryKey: ["api-keys"], queryFn: () => apiKeysApi.list().then(r => r.data) });
  const create = useMutation({ mutationFn: (name: string) => apiKeysApi.create(name), onSuccess: (res) => { queryClient.invalidateQueries({ queryKey: ["api-keys"] }); setCreatedKey({ key: res.data.key, name: res.data.name }); toast.success("Chave criada"); } });
  const del = useMutation({ mutationFn: (id: string) => apiKeysApi.delete(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["api-keys"] }); toast.success("Chave removida"); } });
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const copyKey = () => {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Create key */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)" }}>
            <Key className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          </div>
          <h2 className="text-sm font-medium" style={{ color: "hsl(240 15% 88%)" }}>Criar nova chave</h2>
        </div>

        <div className="flex gap-3">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate(name)}
            placeholder="Nome da chave (ex: Produção, n8n)" className="input-field flex-1" />
          <button onClick={() => create.mutate(name)} disabled={!name.trim() || create.isPending} className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 disabled:opacity-40">
            {create.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </div>

        {createdKey && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(0,212,106,0.05)", border: "1px solid rgba(0,212,106,0.15)" }}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--green)" }} />
              <p className="text-sm font-medium" style={{ color: "#86efac" }}>Chave <strong>{createdKey.name}</strong> criada! Copie agora — não será exibida novamente.</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "hsl(240 18% 4%)", border: "1px solid hsl(240 12% 11%)" }}>
              <code className="flex-1 text-sm font-mono truncate" style={{ color: "hsl(240 15% 80%)" }}>
                {showKey ? createdKey.key : createdKey.key.replace(/(?<=^.{12}).+(?=.{4}$)/, "•".repeat(24))}
              </code>
              <button onClick={() => setShowKey(!showKey)} className="transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 38)" }}>
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={copyKey} className="transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 38)" }}>
                {copied ? <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={() => setCreatedKey(null)} className="text-xs transition-colors" style={{ color: "hsl(240 8% 38)" }}>Já copiei, fechar</button>
          </div>
        )}
      </div>

      {/* Keys list */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>{data?.length || 0} chave{(data?.length || 0) !== 1 ? "s" : ""} ativa{(data?.length || 0) !== 1 ? "s" : ""}</h2>
        </div>
        {isLoading ? (
          <div className="p-5 space-y-2">{[1, 2].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
        ) : !data?.length ? (
          <div className="p-12 text-center"><div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}><Key className="w-5 h-5" style={{ color: "hsl(240 8% 28%)" }} /></div><p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhuma chave criada</p></div>
        ) : (
          <div>{data.map((k, i) => (
            <div key={k.id} className="px-5 py-4 flex items-center gap-4 transition-colors" style={{ borderBottom: i < data.length - 1 ? "1px solid var(--border-default)" : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}><Key className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 42%)" }} /></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{k.name}</p><p className="text-xs font-mono mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{k.masked_key}</p></div>
              <div className="text-right flex-shrink-0 hidden sm:block">{k.last_used_at ? <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Usado {new Date(k.last_used_at).toLocaleDateString("pt-BR")}</p> : <p className="text-xs" style={{ color: "hsl(240 8% 30%)" }}>Nunca usada</p>}<p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 30%)" }}>Criada {new Date(k.created_at).toLocaleDateString("pt-BR")}</p></div>
              <button onClick={() => del.mutate(k.id)} className="p-2 rounded-lg transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 32%)" }} onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}</div>
        )}
      </div>

      {/* Usage docs */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h2 className="text-xs font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>Como usar</h2>
        <div className="space-y-4">
          <div><p className="text-xs mb-2" style={{ color: "hsl(240 8% 42%)" }}>Header de autenticação</p><div className="rounded-xl px-4 py-3" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}><code className="text-xs font-mono" style={{ color: "var(--green)" }}>Authorization: Bearer sc_...</code></div></div>
          <div><p className="text-xs mb-2" style={{ color: "hsl(240 8% 42%)" }}>Exemplo com curl</p><div className="rounded-xl px-4 py-3" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}><code className="text-xs font-mono whitespace-pre" style={{ color: "hsl(240 8% 62%)" }}>{`curl -X POST \\\n  http://localhost:8080/instances/:id/messages/text \\\n  -H "Authorization: Bearer sc_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"to":"5511999999999","text":"Olá!"}'`}</code></div></div>
        </div>
      </div>
    </div>
  );
}


// ─── Proxies Section ─────────────────────────────────────────────────────────
const PROXY_PROVIDERS = [
  { id: "brightdata", name: "Bright Data", description: "Provedor líder de proxies residenciais", color: "#4f46e5" },
  { id: "oxylabs", name: "Oxylabs", description: "Proxies residenciais e datacenter", color: "#0ea5e9" },
  { id: "proxy_cheap", name: "Proxy Cheap", description: "Proxies económicos", color: "#f97316" },
  { id: "smartproxy", name: "Smartproxy", description: "Proxies residenciais geolocalizados", color: "#8b5cf6" },
  { id: "webshare", name: "Webshare", description: "Proxies compartilhados", color: "#06b6d4" },
  { id: "manual", name: "Proxy Personalizado", description: "Conectar com URL ou credenciais", color: "#64748b" },
];

function ProxiesSection() {
  const queryClient = useQueryClient();
  const { data: proxies = [], isLoading } = useQuery<Proxy[]>({
    queryKey: ["my-proxies"],
    queryFn: () => proxiesApi.listMine().then(r => r.data),
  });
  const del = useMutation({
    mutationFn: (id: string) => proxiesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-proxies"] });
      toast.success("Proxy removido");
    },
  });
  const test = useMutation({
    mutationFn: (id: string) => proxiesApi.test(id).then(r => r.data),
    onSuccess: (data: { success: boolean; external_ip?: string; latency_ms?: number; error?: string }) => {
      if (data.success) toast.success(`IP ${data.external_ip} · ${data.latency_ms}ms`);
      else toast.error(data.error || "Teste falhou");
    },
  });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: "",
    proxy_type: "http" as "http" | "https" | "socks5",
    host: "",
    port: 0,
    username: "",
    password: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; external_ip?: string; latency_ms?: number; error?: string; proxyId?: string } | null>(null);

  const saveDisabled = !form.name.trim() || !form.host.trim() || form.port <= 0;

  const testBeforeSave = async () => {
    if (saveDisabled) return;
    setTesting(true);
    setTestResult(null);
    try {
      const t = await proxiesApi.testInline({
        proxy_type: form.proxy_type,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
      }).then(r => r.data);
      setTestResult(t);
      if (t.success) toast.success(`IP ${t.external_ip} · ${t.latency_ms}ms`);
      else toast.error(t.error || "Teste falhou");
    } catch (err: unknown) {
      setTestResult({ success: false, error: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro" });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    try {
      await proxiesApi.create({
        name: form.name,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
        proxy_type: form.proxy_type,
      });
      toast.success("Proxy criado");
      queryClient.invalidateQueries({ queryKey: ["my-proxies"] });
      setShowModal(false);
      setTestResult(null);
      setForm({ name: "", proxy_type: "http", host: "", port: 0, username: "", password: "" });
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar proxy");
    }
  };

  const COUNTRY_FLAGS: Record<string, string> = { br: "🇧🇷", us: "🇺🇸", gb: "🇬🇧", ar: "🇦🇷" };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(96,165,250,0.1)" }}>
            <Globe className="w-5 h-5" style={{ color: "#60a5fa" }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Proxies customizados</p>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              Criados aqui e selecionáveis na tela de cada server. Todas as instâncias do server herdam o proxy.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={() => { setShowModal(true); setTestResult(null); }}
        className="w-full rounded-2xl border-2 border-dashed p-4 flex items-center justify-center gap-2 transition-all hover:bg-white/5"
        style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}
      >
        <Plus className="w-5 h-5" />
        <span className="text-sm font-medium">Adicionar proxy</span>
      </button>

      {isLoading ? (
        <div className="flex items-center gap-2 p-4">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-3)" }} />
          <span className="text-xs" style={{ color: "var(--text-3)" }}>Carregando…</span>
        </div>
      ) : proxies.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Meus proxies</h3>
          {proxies.map(p => (
            <div key={p.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(96,165,250,0.1)" }}>
                <Globe className="w-4 h-4" style={{ color: "#60a5fa" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{p.name}</p>
                <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>
                  {p.host}:{p.port}{p.proxy_type && ` · ${p.proxy_type.toUpperCase()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {p.country && (
                  <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
                    {COUNTRY_FLAGS[p.country.toLowerCase()] || "🌍"} {p.country.toUpperCase()}
                  </span>
                )}
                <button onClick={() => test.mutate(p.id)}
                  disabled={test.isPending}
                  className="text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(96,165,250,0.1)", color: "#60a5fa" }}>
                  {test.isPending ? "…" : "Testar"}
                </button>
                <button onClick={() => del.mutate(p.id)} className="p-1.5 rounded-lg hover:bg-red-500/10" style={{ color: "var(--text-3)" }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--surface-overlay)" }}>
          <div className="w-full max-w-md rounded-2xl border p-5 space-y-4" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
            <div className="flex items-center justify-between">
              <h2 className="font-medium" style={{ color: "var(--text-1)" }}>Novo proxy</h2>
              <button onClick={() => setShowModal(false)} style={{ color: "var(--text-3)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Nome</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="input-field w-full" placeholder="Meu Proxy BR" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Tipo</label>
                <select value={form.proxy_type}
                  onChange={e => setForm({ ...form, proxy_type: e.target.value as "http" | "https" | "socks5" })}
                  className="input-field w-full">
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Host</label>
                <input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                  className="input-field w-full" placeholder="proxy.exemplo.com" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Porta</label>
              <input type="number" value={form.port || ""}
                onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
                className="input-field w-full" placeholder="8080" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Usuário</label>
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  className="input-field w-full" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Senha</label>
                <input type="password" value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="input-field w-full" />
              </div>
            </div>

            {testResult && (
              <div className="p-3 rounded-xl text-xs"
                style={{
                  background: testResult.success ? "rgba(0,212,106,0.08)" : "rgba(239,68,68,0.08)",
                  color: testResult.success ? "var(--green)" : "#f87171",
                }}>
                {testResult.success
                  ? `✓ OK · IP ${testResult.external_ip} · ${testResult.latency_ms}ms — salvo no catálogo`
                  : `✗ ${testResult.error}`}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={testBeforeSave} disabled={saveDisabled || testing}
                className="btn-ghost flex-1 flex items-center justify-center gap-1.5">
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Testar
              </button>
              <button onClick={save} disabled={saveDisabled} className="btn-primary flex-1">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Connect Modal (LLM) ───────────────────────────────────────────────────
function ConnectModal({ provider: providerId, onClose }: { provider: ProviderId; onClose: () => void }) {
  const provider = PROVIDERS.find(p => p.id === providerId)!;
  const qc = useQueryClient();
  // Tipo pode ser estritamente inferido só para providers que o suportam
  const supportsOAuth = "supportsOAuth" in provider && (provider as { supportsOAuth?: boolean }).supportsOAuth === true;
  const [authMode, setAuthMode] = useState<"api_key" | "oauth">(supportsOAuth ? "oauth" : "api_key");
  const [form, setForm] = useState<{ name: string; api_key: string; models: string[] }>({ name: provider.name, api_key: "", models: [] });
  const [showKey, setShowKey] = useState(false);

  // OAuth state
  const [oauthURL, setOauthURL] = useState<string>("");
  const [oauthState, setOauthState] = useState<string>("");
  const [oauthCode, setOauthCode] = useState<string>("");
  const [oauthStarting, setOauthStarting] = useState(false);
  const [oauthCompleting, setOauthCompleting] = useState(false);

  const create = useMutation({
    mutationFn: () => integrationsApi.create({ provider: providerId, name: form.name, api_key: form.api_key, models: form.models.length ? form.models : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast.success("Conectado!"); onClose(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro"),
  });

  const startOAuth = async () => {
    setOauthStarting(true);
    try {
      let r;
      if (providerId === "openrouter") {
        const callbackUrl = `${window.location.origin}/integrations/openrouter/callback`;
        r = await integrationsApi.startOpenRouterOAuth(callbackUrl);
      } else {
        r = await integrationsApi.startClaudeOAuth();
      }
      setOauthURL(r.data.auth_url);
      setOauthState(r.data.state);
      window.open(r.data.auth_url, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Falha ao iniciar OAuth");
    } finally {
      setOauthStarting(false);
    }
  };

  const completeOAuth = async () => {
    if (!oauthCode.trim() || !oauthState) {
      toast.error("Cole o código mostrado após autorizar.");
      return;
    }
    setOauthCompleting(true);
    try {
      if (providerId === "openrouter") {
        await integrationsApi.completeOpenRouterOAuth({ code: oauthCode.trim(), state: oauthState, name: form.name });
        toast.success("OpenRouter conectado via OAuth!");
      } else {
        await integrationsApi.completeClaudeOAuth({ code: oauthCode.trim(), state: oauthState, name: form.name });
        toast.success("Claude.ai conectado via OAuth!");
      }
      qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Falha no OAuth");
    } finally {
      setOauthCompleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--surface-overlay)" }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: provider.bg, border: `1px solid ${provider.border}` }}><ProviderIcon id={provider.id} color={provider.color} /></div>
          <div><h2 className="font-medium" style={{ color: "var(--text-1)" }}>Conectar {provider.name}</h2><p className="text-xs" style={{ color: "var(--text-3)" }}>{provider.description}</p></div>
        </div>

        {/* Auth mode selector (apenas para providers com supportsOAuth) */}
        {supportsOAuth && (
          <div className="flex rounded-xl p-1" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
            <button
              type="button"
              onClick={() => setAuthMode("oauth")}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: authMode === "oauth" ? provider.color + "22" : "transparent", color: authMode === "oauth" ? provider.color : "var(--text-3)" }}>
              🔐 Login com {providerId === "openrouter" ? "OpenRouter" : "Claude.ai"}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("api_key")}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: authMode === "api_key" ? "var(--border-default)" : "transparent", color: authMode === "api_key" ? "var(--text-1)" : "var(--text-3)" }}>
              🔑 API Key
            </button>
          </div>
        )}

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Nome</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field w-full" />
        </div>

        {authMode === "api_key" ? (
          <>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>API Key</label>
              <div className="relative">
                <input type={showKey ? "text" : "password"} value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} className="input-field w-full" style={{ paddingRight: "2.5rem" }} placeholder="sk-..." />
                <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }}>
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {provider.models.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Modelos</label>
                <div className="rounded-xl border p-3 max-h-40 overflow-y-auto" style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)" }}>
                  {provider.models.map(m => (
                    <label key={m} className="flex items-center gap-2">
                      <input type="checkbox" checked={form.models.includes(m)} onChange={e => setForm(f => ({ ...f, models: e.target.checked ? [...f.models, m] : f.models.filter(x => x !== m) }))} className="rounded" />
                      <span className="text-sm">{m}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={() => create.mutate()} disabled={create.isPending || !form.api_key} className="btn-primary flex-1">
                {create.isPending ? "Conectando..." : "Conectar"}
              </button>
            </div>
          </>
        ) : (
          // ─── OAuth flow ────────────────────────────────────────────────────
          <div className="space-y-3">
            <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(0,212,106,0.06)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <p style={{ color: "var(--text-1)" }}><strong>Como funciona:</strong></p>
              <ol className="list-decimal list-inside space-y-1 mt-2" style={{ color: "var(--text-3)" }}>
                {providerId === "openrouter" ? (
                  <>
                    <li>Clique &quot;Abrir autorização&quot; — uma nova aba com openrouter.ai abre.</li>
                    <li>Autorize o acesso da sua conta.</li>
                    <li>O OpenRouter redireciona automaticamente de volta pra esta aplicação — não precisa copiar nada.</li>
                  </>
                ) : (
                  <>
                    <li>Clique &quot;Abrir autorização&quot; — uma nova aba com claude.ai abre.</li>
                    <li>Autorize o acesso da sua conta.</li>
                    <li>Copie o código mostrado ao final da página.</li>
                    <li>Cole abaixo e clique em &quot;Finalizar&quot;.</li>
                  </>
                )}
              </ol>
            </div>

            {!oauthState ? (
              <button
                onClick={startOAuth}
                disabled={oauthStarting}
                className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: provider.color, color: "#0d0d0d" }}>
                {oauthStarting ? "Gerando link..." : `🚀 Abrir autorização ${providerId === "openrouter" ? "OpenRouter" : "Claude.ai"}`}
              </button>
            ) : providerId === "openrouter" ? (
              <div className="rounded-xl p-3 text-xs space-y-2" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)" }}>
                <p style={{ color: "var(--text-1)" }}>
                  Aguardando o OpenRouter redirecionar a outra aba de volta para esta aplicação…
                </p>
                {oauthURL && (
                  <p style={{ color: "var(--text-3)" }}>
                    Não abriu?{" "}
                    <a href={oauthURL} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: provider.color }}>
                      clique aqui
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <>
                {oauthURL && (
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                    Não abriu?{" "}
                    <a href={oauthURL} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: provider.color }}>
                      clique aqui
                    </a>
                  </p>
                )}
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Código de autorização</label>
                  <textarea
                    value={oauthCode}
                    onChange={e => setOauthCode(e.target.value)}
                    placeholder="Cole o código mostrado pela página da Anthropic após autorizar..."
                    rows={3}
                    className="input-field w-full font-mono text-xs"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
                  <button
                    onClick={completeOAuth}
                    disabled={oauthCompleting || !oauthCode.trim()}
                    className="btn-primary flex-1">
                    {oauthCompleting ? "Finalizando..." : "Finalizar"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agents Section (Apps that consume Uniq API) ──────────────────────────────
function AgentsSection() {
  const { data: keys = [] } = useQuery<APIKey[]>({ queryKey: ["api-keys"], queryFn: () => apiKeysApi.list().then(r => r.data) });
  const { data: instances = [] } = useQuery<any[]>({ queryKey: ["instances"], queryFn: () => instancesApi.list().then(r => r.data) });
  const connectedInstances = instances.filter((i: any) => i.status === "connected");

  const agentApps = [
    {
      id: "claude_desktop",
      name: "Claude Desktop",
      description: "Use Uniq via MCP para ferramentas de WhatsApp",
      icon: "🧠",
      docs: "https://modelcontextprotocol.io",
      setup: "Configure o MCP server no arquivo settings.json",
      config: `{"mcpServers":{"uniq-chat":{"url":"{url}/api/v1/instances/{instance_id}/mcp/sse"}}`,
    },
    {
      id: "open_code",
      name: "Open Code (VSCode)",
      description: "VSCode com IA que conecta ao Uniq para WhatsApp",
      icon: "💻",
      docs: "https://github.com/omercnet/vscode-acp",
      setup: "Use VSCode ACP extension + configure endpoint",
    },
    {
      id: "open_agent",
      name: "Open Agent / Claude Code",
      description: "Agente de IA no terminal comtools WhatsApp",
      icon: "🤖",
      docs: "https://github.com/anthropic/claude-code",
      setup: "Configure via variável de ambiente ou config",
    },
    {
      id: "windsurf",
      name: "Windsurf (Codeium)",
      description: "Agente de IA da Codeium para VSCode",
      icon: "🌊",
      docs: "https://codeium.com/windsurf",
      setup: "Configure API key e instance ID",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)" }}>
            <Bot className="w-5 h-5" style={{ color: "#8b5cf6" }} />
          </div>
          <div>
            <h2 className="text-base font-medium" style={{ color: "var(--text-1)" }}>Apps Agents</h2>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Conecte apps de IA para consumir a API do Uniq</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agentApps.map(app => (
            <div key={app.id} className="rounded-xl p-4" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{app.icon}</span>
                <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{app.name}</h3>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>{app.description}</p>
              <div className="space-y-2">
                <div className="text-[10px] font-medium uppercase" style={{ color: "var(--text-3)" }}>Setup</div>
                <code className="text-xs block p-2 rounded-lg break-all" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  {app.setup}
                </code>
                {app.docs && (
                  <a href={app.docs} target="_blank" rel="noopener noreferrer" 
                    className="text-xs flex items-center gap-1 hover:underline" style={{ color: "var(--green)" }}>
                    Ver documentação → 
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connection Info */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-1)" }}>Informações de Conexão</h3>
        
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Base URL</label>
            <code className="text-xs block p-2 rounded-lg" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
              {typeof window !== 'undefined' ? window.location.origin : ''}/api
            </code>
          </div>
          
          {keys.length > 0 && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>API Key</label>
              <code className="text-xs block p-2 rounded-lg" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                {keys[0].masked_key}
              </code>
            </div>
          )}
          
          {connectedInstances.length > 0 && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Instance UUID</label>
              <code className="text-xs block p-2 rounded-lg" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                {connectedInstances[0].id}
              </code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MCP Section ────────────────────────────────────────────────────────────
function MCPSection() {
  const { data: instances = [] } = useQuery<any[]>({ queryKey: ["instances"], queryFn: () => instancesApi.list().then(r => r.data) });
  const connectedInstances = instances.filter((i: any) => i.status === "connected");
  const mcpInstances = connectedInstances.filter((i: any) => i.mcp_enabled);
  const apiUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)" }}>
            <Zap className="w-5 h-5" style={{ color: "#f59e0b" }} />
          </div>
          <div>
            <h2 className="text-base font-medium" style={{ color: "var(--text-1)" }}>MCP Server</h2>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Model Context Protocol para ferramentas de IA</p>
          </div>
        </div>

        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Use o MCP para conectar ferramentas de WhatsApp a apps de IA como Claude Desktop.
        </p>

        <div className="space-y-2">
          <p className="text-xs font-medium" style={{ color: "var(--text-3)" }}>INSTÂNCIAS CONECTADAS COM MCP HABILITADO:</p>
          {mcpInstances.length === 0 ? (
            <p className="text-sm p-3 rounded-lg" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
              Nenhuma instância conectada com MCP habilitado
            </p>
          ) : (
            mcpInstances.map((inst: any) => (
              <div key={inst.id} className="p-3 rounded-xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{inst.name}</p>
                <code className="text-xs block mt-1" style={{ color: "var(--text-2)" }}>
                  {apiUrl}/api/v1/instances/{inst.id}/mcp/sse
                </code>
              </div>
            ))
          )}
        </div>
      </div>

      {/* MCP Config for Claude Desktop */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-1)" }}>Configuração Claude Desktop</h3>
        
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Adicione no arquivo de configuração:</label>
            <pre className="text-xs p-3 rounded-lg overflow-x-auto" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
{`{
  "mcpServers": {
    "uniq-chat": {
      "url": "${apiUrl}/api/v1/instances/INSTANCE_ID/mcp/sse"
    }
  }
}`}
            </pre>
            <p className="text-xs mt-2" style={{ color: "var(--text-3)" }}>
              Substitua INSTANCE_ID pelo UUID da instância acima.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
