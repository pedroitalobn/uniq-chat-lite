"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plug, Plus, Trash2, RefreshCw, CheckCircle2, XCircle,
  Eye, EyeOff, Zap, Globe, Bot, Webhook, Play, Search,
  Key, FileJson, ExternalLink, Loader2, Shield, Link2, Copy, X,
} from "lucide-react";
import { integrationsApi, globalWebhooksApi, apiKeysApi, proxyPoolsApi, adminApi, instancesApi } from "@/lib/api";
import { toast } from "sonner";
import type { APIKey, ProxyProviderConfig } from "@/types";

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
  };
  return icons[id] || <Plug className="w-5 h-5" style={{ color }} />;
};

const PROVIDERS = [
  { id: "claude", name: "Claude (Anthropic)", description: "claude-sonnet-4-6, claude-opus-4-6", color: "#d4a27f", bg: "rgba(212,162,127,0.08)", border: "rgba(212,162,127,0.2)", models: ["claude-sonnet-4-6", "claude-opus-4-6"] },
  { id: "openai", name: "ChatGPT (OpenAI)", description: "gpt-4o, gpt-4o-mini, o1-preview", color: "#10a37f", bg: "rgba(16,163,127,0.08)", border: "rgba(16,163,127,0.2)", models: ["gpt-4o", "gpt-4o-mini", "o1-preview"] },
  { id: "deepseek", name: "DeepSeek", description: "deepseek-chat, deepseek-reasoner", color: "#4f6ef7", bg: "rgba(79,110,247,0.08)", border: "rgba(79,110,247,0.2)", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "gemini", name: "Gemini (Google)", description: "gemini-1.5-pro, gemini-1.5-flash", color: "#4285f4", bg: "rgba(66,133,244,0.08)", border: "rgba(66,133,244,0.2)", models: ["gemini-1.5-pro", "gemini-1.5-flash"] },
  { id: "openrouter", name: "OpenRouter", description: "100+ modelos via API unificada", color: "#7c3aed", bg: "rgba(124,58,237,0.08)", border: "rgba(124,58,237,0.2)", models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"] },
  { id: "qwen", name: "Qwen (Alibaba)", description: "qwen-turbo, qwen-plus, qwen-max", color: "#ff6a00", bg: "rgba(255,106,0,0.08)", border: "rgba(255,106,0,0.2)", models: ["qwen-turbo", "qwen-plus", "qwen-max"] },
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

type Section = "agents" | "api" | "webhook" | "docs" | "mcp";

export default function IntegrationsPage() {
  const [section, setSection] = useState<Section>("agents");
  const [connecting, setConnecting] = useState<ProviderId | null>(null);

  const sections = [
    { id: "agents" as const, label: "Agents", icon: Bot, color: "#8b5cf6" },
    { id: "api" as const, label: "API Keys", icon: Key, color: "#f59e0b" },
    { id: "webhook" as const, label: "Webhooks", icon: Webhook, color: "#10b981" },
    { id: "mcp" as const, label: "MCP", icon: Zap, color: "#f59e0b" },
    { id: "docs" as const, label: "API Docs", icon: FileJson, color: "#64748b" },
  ];

  return (
    <div className="min-h-screen p-6 lg:p-8" style={{ background: "var(--bg)" }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <Plug className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text-1)" }}>Integrações</h1>
          </div>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Conecte LLMs, APIs, webhooks e proxies à sua conta</p>
        </div>

        <div className="flex flex-wrap gap-1 p-1 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          {sections.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex-1 justify-center"
              style={{ background: section === s.id ? `${s.color}15` : "transparent", color: section === s.id ? s.color : "var(--text-3)" }}>
              <s.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </div>

        {section === "agents" && <AgentsSection />}
        {section === "api" && <APIKeysSection />}
        {section === "webhook" && <WebhooksSection />}
        {section === "mcp" && <MCPSection />}
        {section === "docs" && <DocsSection />}
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
            {connectedProviders.has(p.id) && <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-500/20 text-green-400"><CheckCircle2 className="w-2.5 h-2.5" /> conectado</span>}
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${p.color}18` }}><ProviderIcon id={p.id} color={p.color} /></div>
            <div><p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{p.name}</p><p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{p.description}</p></div>
            <div className="flex items-center gap-1 text-xs font-medium mt-1" style={{ color: p.color }}><Plus className="w-3 h-3" /> {connectedProviders.has(p.id) ? "Adicionar" : "Conectar"}</div>
          </button>
        ))}
      </div>
      {integrations.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Integrações conectadas</h3>
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
        <div className="flex items-center gap-2"><p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>{integration.name}</p>
          {integration.test_status === "ok" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}</div>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{provider?.name} · {integration.models?.length || 0} modelo(s)</p>
      </div>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${integration.is_active ? "text-green-400 bg-green-500/10" : "text-gray-400 bg-gray-500/10"}`}>{integration.is_active ? "Ativo" : "Inativo"}</span>
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
          <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Criar nova chave</h2>
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
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>{data?.length || 0} chave{(data?.length || 0) !== 1 ? "s" : ""} ativa{(data?.length || 0) !== 1 ? "s" : ""}</h2>
        </div>
        {isLoading ? (
          <div className="p-5 space-y-2">{[1, 2].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
        ) : !data?.length ? (
          <div className="p-12 text-center"><div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}><Key className="w-5 h-5" style={{ color: "hsl(240 8% 28%)" }} /></div><p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhuma chave criada</p></div>
        ) : (
          <div>{data.map((k, i) => (
            <div key={k.id} className="px-5 py-4 flex items-center gap-4 transition-colors" style={{ borderBottom: i < data.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}><Key className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 42%)" }} /></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{k.name}</p><p className="text-xs font-mono mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{k.masked_key}</p></div>
              <div className="text-right flex-shrink-0 hidden sm:block">{k.last_used_at ? <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Usado {new Date(k.last_used_at).toLocaleDateString("pt-BR")}</p> : <p className="text-xs" style={{ color: "hsl(240 8% 30%)" }}>Nunca usada</p>}<p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 30%)" }}>Criada {new Date(k.created_at).toLocaleDateString("pt-BR")}</p></div>
              <button onClick={() => del.mutate(k.id)} className="p-2 rounded-lg transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 32%)" }} onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}</div>
        )}
      </div>

      {/* Usage docs */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>Como usar</h2>
        <div className="space-y-4">
          <div><p className="text-xs mb-2" style={{ color: "hsl(240 8% 42%)" }}>Header de autenticação</p><div className="rounded-xl px-4 py-3" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}><code className="text-xs font-mono" style={{ color: "var(--green)" }}>Authorization: Bearer sc_...</code></div></div>
          <div><p className="text-xs mb-2" style={{ color: "hsl(240 8% 42%)" }}>Exemplo com curl</p><div className="rounded-xl px-4 py-3" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}><code className="text-xs font-mono whitespace-pre" style={{ color: "hsl(240 8% 62%)" }}>{`curl -X POST \\\n  http://localhost:8080/instances/:id/messages/text \\\n  -H "Authorization: Bearer sc_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"to":"5511999999999","text":"Olá!"}'`}</code></div></div>
        </div>
      </div>
    </div>
  );
}

// ─── Webhooks Section ───────────────────────────────────────────────────────
const WEBHOOK_EVENTS = [
  { id: "message.received", name: "Mensagem Recebida", category: "Mensagem" },
  { id: "message.sent", name: "Mensagem Enviada", category: "Mensagem" },
  { id: "instance.created", name: "Instância Criada", category: "Instância" },
  { id: "instance.connected", name: "Instância Conectada", category: "Instância" },
  { id: "instance.disconnected", name: "Instância Desconectada", category: "Instância" },
  { id: "crm.contact.created", name: "Contato Criado", category: "CRM" },
  { id: "crm.contact.updated", name: "Contato Atualizado", category: "CRM" },
  { id: "crm.tag.assigned", name: "Tag Atribuída", category: "CRM" },
  { id: "crm.stage.assigned", name: "Stage Atribuído", category: "CRM" },
  { id: "crm.funnel.assigned", name: "Funil Atribuído", category: "CRM" },
  { id: "campaign.created", name: "Campanha Criada", category: "Campanha" },
  { id: "campaign.started", name: "Campanha Iniciada", category: "Campanha" },
  { id: "campaign.paused", name: "Campanha Pausada", category: "Campanha" },
  { id: "campaign.completed", name: "Campanha Finalizada", category: "Campanha" },
  { id: "user.registered", name: "Usuário Registrado", category: "Usuário" },
  { id: "workspace.created", name: "Workspace Criado", category: "Workspace" },
  { id: "workspace.member_added", name: "Membro Adicionado", category: "Workspace" },
  { id: "payment.success", name: "Pagamento Succedido", category: "Pagamento" },
  { id: "payment.failed", name: "Pagamento Falhou", category: "Pagamento" },
];

function WebhooksSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["global-webhooks"], queryFn: () => globalWebhooksApi.list().then(r => r.data) });
  const create = useMutation({ mutationFn: (data: { name: string; url: string; events: string[] }) => globalWebhooksApi.create(data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["global-webhooks"] }); toast.success("Webhook criado"); }, onError: (e: any) => toast.error(e?.response?.data?.error || "Erro ao criar") });
  const del = useMutation({ mutationFn: (id: string) => globalWebhooksApi.delete(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["global-webhooks"] }); toast.success("Webhook removido"); } });
  const test = useMutation({ mutationFn: (id: string) => globalWebhooksApi.test(id), onSuccess: () => toast.success("Teste enviado!"), onError: () => toast.error("Erro ao enviar teste") });
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const groupedEvents = WEBHOOK_EVENTS.reduce((acc, e) => {
    if (!acc[e.category]) acc[e.category] = [];
    acc[e.category].push(e);
    return acc;
  }, {} as Record<string, typeof WEBHOOK_EVENTS>);

  return (
    <div className="space-y-5">
      {/* Create webhook */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)" }}>
            <Webhook className="w-3.5 h-3.5" style={{ color: "#8b5cf6" }} />
          </div>
          <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Webhooks Globais</h2>
        </div>
        <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Eventos da plataforma (usuários, pagamentos, workspaces)</p>
        
        <div className="space-y-3">
          <div className="flex gap-3">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do webhook" className="input-field flex-1" />
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seu-webhook.com.br/webhook" className="input-field flex-[2]" />
          </div>
          
          {/* Event selection */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "hsl(240 8% 42%)" }}>Eventos (selecione ou deixe vazio para todos)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-2 rounded-xl" style={{ background: "hsl(240 18% 4%)", border: "1px solid hsl(240 12% 11%)" }}>
              {Object.entries(groupedEvents).map(([category, events]) => (
                <div key={category} className="col-span-full">
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 36%)" }}>{category}</p>
                  <div className="flex flex-wrap gap-1">
                    {events.map(e => (
                      <label key={e.id} className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={selectedEvents.includes(e.id)} onChange={(cb) => setSelectedEvents(cb.target.checked ? [...selectedEvents, e.id] : selectedEvents.filter(x => x !== e.id))} className="rounded w-3 h-3" />
                        <span className="text-[10px]" style={{ color: "hsl(240 8% 55%)" }}>{e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <button onClick={() => create.mutate({ name, url, events: selectedEvents })} disabled={!name || !url || create.isPending} className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 disabled:opacity-40">
            {create.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar Webhook
          </button>
        </div>
      </div>

      {/* Webhooks list */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>{data?.length || 0} webhook{data?.length !== 1 ? "s" : ""} configurado{data?.length !== 1 ? "s" : ""}</h2>
        </div>
        {isLoading ? (
          <div className="p-5 space-y-2">{[1, 2].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
        ) : !data?.length ? (
          <div className="p-12 text-center">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Webhook className="w-5 h-5" style={{ color: "hsl(240 8% 28%)" }} />
            </div>
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhum webhook configurado</p>
          </div>
        ) : (
          <div>{data.map((w: any, i: number) => (
            <div key={w.id} className="px-5 py-4 flex items-center gap-4 transition-colors" style={{ borderBottom: i < data.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)" }}>
                <Webhook className="w-3.5 h-3.5" style={{ color: "#8b5cf6" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 80%)" }}>{w.name}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: "hsl(240 8% 38%)" }}>{w.url}</p>
                <p className="text-[10px] mt-0.5" style={{ color: "hsl(240 8% 32%)" }}>Eventos: {w.events?.length > 0 ? w.events.join(", ") : "todos"}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${w.is_active ? "text-green-400 bg-green-500/10" : "text-gray-400 bg-gray-500/10"}`}>
                {w.is_active ? "Ativo" : "Inativo"}
              </span>
              <button onClick={() => test.mutate(w.id)} className="p-2 rounded-lg transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 32%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#8b5cf6")} onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}>
                <Play className="w-4 h-4" />
              </button>
              <button onClick={() => del.mutate(w.id)} className="p-2 rounded-lg transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 32%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}</div>
        )}
      </div>

      {/* Webhook events info */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42)" }}>Eventos disponíveis</h2>
        {Object.entries(groupedEvents).map(([category, events]) => (
          <div key={category}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 36%)" }}>{category}</p>
            <div className="grid grid-cols-2 gap-1 text-xs" style={{ color: "hsl(240 8% 55%)" }}>
              {events.map(e => (
                <div key={e.id}><code style={{ color: "var(--green)" }}>{e.id}</code> - {e.name}</div>
              ))}
            </div>
          </div>
        ))}
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
  const { data: globalProxies, isLoading: globalProxyLoading } = useQuery<GlobalProxyConfig[]>({ queryKey: ["global-proxies"], queryFn: () => proxyPoolsApi.getGlobalProxies().then(r => r.data) });
  const { data: proxyList, isLoading } = useQuery<ProxyProviderConfig[]>({ queryKey: ["proxy-providers"], queryFn: () => proxyPoolsApi.listProviders().then(r => r.data) });
  const create = useMutation({ mutationFn: (d: any) => proxyPoolsApi.createProvider(d), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proxy-providers"] }); toast.success("Proxy criado com sucesso!"); }, onError: (e: any) => toast.error(e?.response?.data?.error || "Erro ao criar proxy") });
  const del = useMutation({ mutationFn: (id: string) => proxyPoolsApi.deleteProvider(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proxy-providers"] }); toast.success("Proxy removido"); } });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", proxy_url: "", proxy_type: "socks5", proxy_host: "", proxy_port: 33335, proxy_username: "", proxy_password: "" });

  const isGlobalProxyActive = globalProxies?.some(p => p.enabled && (p.host || p.use_env));
  const hasAnyGlobalProxy = globalProxies && globalProxies.length > 0;

  const handleSave = () => {
    if (!form.name) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!form.proxy_url && (!form.proxy_host || !form.proxy_port)) {
      toast.error("Forneça a URL do proxy ou host:porta");
      return;
    }
    create.mutate({ 
      provider: "manual", 
      name: form.name, 
      proxy_url: form.proxy_url, 
      proxy_type: form.proxy_type, 
      proxy_host: form.proxy_host, 
      proxy_port: form.proxy_port, 
      proxy_username: form.proxy_username, 
      proxy_password: form.proxy_password
    });
    setShowModal(false);
    setForm({ name: "", proxy_url: "", proxy_type: "socks5", proxy_host: "", proxy_port: 33335, proxy_username: "", proxy_password: "" });
  };

  const COUNTRY_FLAGS: Record<string, string> = { br: "🇧🇷", us: "🇺🇸", global: "🌍" };
  const COUNTRY_NAMES: Record<string, string> = { br: "Brasil", us: "EUA", global: "Global" };

  return (
    <div className="space-y-4">
      {/* Global Proxy Status */}
      {globalProxyLoading ? (
        <div className="flex items-center gap-2 p-4 rounded-2xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
          <span className="text-sm" style={{ color: "var(--text-3)" }}>Carregando...</span>
        </div>
      ) : hasAnyGlobalProxy ? (
        <div className="rounded-2xl border p-4" style={{ background: isGlobalProxyActive ? "rgba(0,212,106,0.08)" : "rgba(0,212,106,0.04)", borderColor: isGlobalProxyActive ? "rgba(0,212,106,0.3)" : "rgba(0,212,106,0.15)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,212,106,0.15)" }}>
                <Globe className="w-5 h-5" style={{ color: "#00d46a" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Proxy Global Uniq</p>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>
                  {isGlobalProxyActive ? "Ativo • Aplicado automaticamente" : "Configurado • Aguardando instância"}
                </p>
              </div>
            </div>
            {isGlobalProxyActive ? (
              <span className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "var(--green)", color: "#04200f" }}>
                Ativo
              </span>
            ) : (
              <a href="/admin/proxy" className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,212,106,0.15)", color: "#00d46a" }}>
                Configurar
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border p-4" style={{ background: "rgba(0,212,106,0.04)", borderColor: "rgba(0,212,106,0.15)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,212,106,0.1)" }}>
                <Globe className="w-5 h-5" style={{ color: "#00d46a" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Proxy Global Uniq</p>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>Disponível automaticamente em novas instâncias</p>
              </div>
            </div>
            <a href="/admin/proxy" className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,212,106,0.15)", color: "#00d46a" }}>
              Configurar
            </a>
          </div>
        </div>
      )}

      {/* Add New Proxy Button */}
      <button
        onClick={() => setShowModal(true)}
        className="w-full rounded-2xl border-2 border-dashed p-4 flex items-center justify-center gap-2 transition-all hover:bg-white/5"
        style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}
      >
        <Plus className="w-5 h-5" />
        <span className="text-sm font-medium">Adicionar Proxy</span>
      </button>

      {/* Proxy List */}
      {proxyList && proxyList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Meus Proxies</h3>
          {proxyList.map(p => (
            <div key={p.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(96,165,250,0.1)" }}>
                <Globe className="w-4 h-4" style={{ color: "#60a5fa" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{p.name}</p>
                <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>
                  {p.proxy_host ? `${p.proxy_host}:${p.proxy_port}` : p.provider}
                  {p.proxy_type && ` · ${p.proxy_type.toUpperCase()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {p.country ? (
                  <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-2)" }}>
                    {COUNTRY_FLAGS[p.country.toLowerCase()] || "🌍"} {COUNTRY_NAMES[p.country.toLowerCase()] || "Global"}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-3)" }}>
                    Detectando...
                  </span>
                )}
                <button onClick={() => del.mutate(p.id)} className="p-1.5 rounded-lg hover:bg-red-500/10" style={{ color: "var(--text-3)" }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Proxy Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="w-full max-w-md rounded-2xl border p-5 space-y-4" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: "var(--text-1)" }}>Adicionar Proxy</h2>
              <button onClick={() => setShowModal(false)} style={{ color: "var(--text-3)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Nome do Proxy</label>
              <input 
                value={form.name} 
                onChange={e => setForm({...form, name: e.target.value})} 
                className="input-field w-full" 
                placeholder="Meu Proxy Brasil" 
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
                URL do Proxy <span style={{ color: "var(--text-3)" }}>(ou cole tudo aqui)</span>
              </label>
              <input 
                value={form.proxy_url} 
                onChange={e => setForm({...form, proxy_url: e.target.value})} 
                className="input-field w-full" 
                placeholder="socks5://user:pass@host:port"
              />
              <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
                Supported: socks5://, socks4://, http://, https://
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Tipo</label>
              <select value={form.proxy_type} onChange={e => setForm({...form, proxy_type: e.target.value})} className="input-field w-full">
                <option value="socks5">SOCKS5</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks4">SOCKS4</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Host</label>
                <input 
                  value={form.proxy_host} 
                  onChange={e => setForm({...form, proxy_host: e.target.value})} 
                  className="input-field w-full" 
                  placeholder="proxy.exemplo.com"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Porta</label>
                <input 
                  type="number" 
                  value={form.proxy_port} 
                  onChange={e => setForm({...form, proxy_port: parseInt(e.target.value) || 33335})} 
                  className="input-field w-full" 
                  placeholder="33335"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
                  Usuário <span style={{ color: "var(--text-3)" }}>(opcional)</span>
                </label>
                <input 
                  value={form.proxy_username} 
                  onChange={e => setForm({...form, proxy_username: e.target.value})} 
                  className="input-field w-full" 
                  placeholder="usuário"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
                  Senha <span style={{ color: "var(--text-3)" }}>(opcional)</span>
                </label>
                <input 
                  type="password" 
                  value={form.proxy_password} 
                  onChange={e => setForm({...form, proxy_password: e.target.value})} 
                  className="input-field w-full" 
                  placeholder="senha"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={handleSave} disabled={create.isPending} className="btn-primary flex-1">
                {create.isPending ? "Salvando..." : "Salvar Proxy"}
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
  const [form, setForm] = useState<{ name: string; api_key: string; models: string[] }>({ name: provider.name, api_key: "", models: [] });
  const [showKey, setShowKey] = useState(false);
  const create = useMutation({ mutationFn: () => integrationsApi.create({ provider: providerId, name: form.name, api_key: form.api_key, models: form.models.length ? form.models : undefined }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast.success("Conectado!"); onClose(); }, onError: (e: any) => toast.error(e?.response?.data?.error || "Erro") });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: provider.bg, border: `1px solid ${provider.border}` }}><ProviderIcon id={provider.id} color={provider.color} /></div>
          <div><h2 className="font-semibold" style={{ color: "var(--text-1)" }}>Conectar {provider.name}</h2><p className="text-xs" style={{ color: "var(--text-3)" }}>{provider.description}</p></div>
        </div>
        <div><label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>Nome</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field w-full" /></div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>API Key</label>
          <div className="relative">
            <input type={showKey ? "text" : "password"} value={form.api_key} onChange={e => setForm({...form, api_key: e.target.value})} className="input-field w-full" style={{ paddingRight: "2.5rem" }} placeholder="sk-..." />
            <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }}>
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {provider.models.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Modelos</label>
            <div className="rounded-xl border p-3 max-h-40 overflow-y-auto" style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)" }}>{provider.models.map(m => <label key={m} className="flex items-center gap-2"><input type="checkbox" checked={form.models.includes(m)} onChange={e => setForm(f => ({...f, models: e.target.checked ? [...f.models, m] : f.models.filter(x => x !== m)}))} className="rounded" /><span className="text-sm">{m}</span></label>)}</div>
          </div>
        )}
        <div className="flex gap-2 pt-2"><button onClick={onClose} className="btn-ghost flex-1">Cancelar</button><button onClick={() => create.mutate()} disabled={create.isPending || !form.api_key} className="btn-primary flex-1">{create.isPending ? "Conectando..." : "Conectar"}</button></div>
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
      id: "open_agent",
      name: "Open Agent",
      description: "Use Uniq como ferramenta no Open Agent (VSCode Extension)",
      icon: "🤖",
      color: "#3b82f6",
      setup: "Configure a API Key e Instance UUID no Open Agent",
    },
    {
      id: "open_code",
      name: "Open Code",
      description: "VSCode com IA que conecta ao Uniq para WhatsApp",
      icon: "💻",
      color: "#10b981",
      setup: "Configure o endpoint da API no Open Code",
    },
    {
      id: "claude_desktop",
      name: "Claude Desktop",
      description: "Use Uniq via MCP no Claude Desktop",
      icon: "🧠",
      color: "#f59e0b",
      setup: "Configure o server MCP na seção MCP do Claude Desktop",
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
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Apps Agents</h2>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Conecte apps de IA para consumir a API do Uniq</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agentApps.map(app => (
            <div key={app.id} className="rounded-xl p-4" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
              <div className="text-2xl mb-2">{app.icon}</div>
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>{app.name}</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>{app.description}</p>
              <div className="space-y-2">
                <div className="text-[10px] font-medium uppercase" style={{ color: "var(--text-3)" }}>Setup</div>
                <code className="text-xs block p-2 rounded-lg" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  {app.setup}
                </code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connection Info */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-1)" }}>Informações de Conexão</h3>
        
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
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>MCP Server</h2>
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
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>Configuração Claude Desktop</h3>
        
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
