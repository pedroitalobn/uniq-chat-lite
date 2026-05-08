"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Bot, Brain, CheckCircle, CheckCircle2, ChevronDown, ChevronRight, Globe, Link2,
  Loader2, Mic2, Pause, Play, Plus, RefreshCw, Save, Settings2, Shield, Sparkles, Trash2,
  Upload, Volume2, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { instancesApi, integrationsApi, voicesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";
import { AnimatedTabContent } from "@/components/ui/AnimatedTabContent";
import { AgentSwitcher } from "@/components/agents/AgentSwitcher";
import { ActivationTab } from "@/components/agents/ActivationTab";
import { QuickSetupWizard } from "@/components/agents/QuickSetupWizard";
import { AgentActionsConfig } from "@/components/agents/AgentActionsConfig";

// ─── Types ──────────────────────────────────────────────────────────────────

type TabId = "personality" | "knowledge" | "skills" | "access" | "voice_studio" | "activation";

type AgentAsset = {
  id: string;
  category: "knowledge" | "faq" | "skill";
  name: string;
  file_name: string;
  content_type?: string;
  size_bytes: number;
  extracted_text?: string;
  created_at: string;
};

type AgentForm = {
  integration_id: string;
  model: string;
  system_prompt: string;
  agent_name: string;
  identity: string;
  objective: string;
  communication_guidelines: string;
  service_instructions: string;
  restrictions: string;
  knowledge_base: string;
  faq: Array<{ id: string; question: string; answer: string }>;
  variables: Array<{ id: string; key: string; value: string; description: string }>;
  voice: { workspace_voice_id?: string; audio_enabled?: boolean; provider?: string; voice?: string; stability: number; similarity: number; style: number; speed: number };
  skills: Array<{ id: string; name: string; type: string; description: string; enabled: boolean }>;
  app_access: Array<{ id: string; name: string; type: string; target: string; description: string; enabled: boolean }>;
  rag_enabled: boolean;
  is_active: boolean;
  webhook_url: string;
  webhook_secret: string;
  mcp_server_url: string;
  compiled_prompt: string;
  assets: AgentAsset[];
  // Multi-agente
  role: string;
  handoff_skills: string[];
  action_confirmation: "client" | "auto" | "human";
  // Janelas de ativação
  activation_mode: "always" | "business_hours" | "off_hours" | "new_contact_only" | "custom";
  schedule: {
    timezone: string;
    days: Record<string, Array<{ from: string; to: string }>>;
  };
};

// ─── Skills catalog ─────────────────────────────────────────────────────────

const SKILL_CATEGORIES = [
  {
    id: "sales",
    label: "Vendas & CRM",
    color: "#00d46a",
    icon: "💰",
    skills: [
      { name: "Lead Qualifier",    description: "Qualifica e pontua leads automaticamente por intenção, estágio e urgência." },
      { name: "Sales Closer",      description: "Conduz objeções e fecha negócios com argumentação contextual." },
      { name: "Upsell & Cross-sell", description: "Sugere produtos complementares no momento certo da conversa." },
      { name: "Quote Generator",   description: "Gera orçamentos instantâneos com base no catálogo e regras de preço." },
      { name: "Follow-up Reminder",description: "Agenda e dispara follow-ups automáticos no intervalo ideal." },
      { name: "Deal Tracker",      description: "Monitora status de oportunidades e atualiza o funil." },
      { name: "CRM Updater",       description: "Atualiza contatos e negócios no CRM via integração." },
    ],
  },
  {
    id: "support",
    label: "Suporte ao Cliente",
    color: "#60a5fa",
    icon: "🎧",
    skills: [
      { name: "Order Status",      description: "Informa status de pedidos em tempo real via integração com e-commerce." },
      { name: "Return Handler",    description: "Processa trocas e devoluções seguindo política da empresa." },
      { name: "Complaint Solver",  description: "Resolve reclamações com empatia e propõe soluções alternativas." },
      { name: "Ticket Creator",    description: "Abre chamados automaticamente e notifica a equipe responsável." },
      { name: "NPS Collector",     description: "Coleta avaliações e feedback pós-atendimento." },
      { name: "Live Escalation",   description: "Detecta frustração e transfere para humano no momento certo." },
      { name: "KB Search",         description: "Busca na base de conhecimento com RAG antes de responder." },
    ],
  },
  {
    id: "marketing",
    label: "Marketing & Engajamento",
    color: "#a78bfa",
    icon: "📣",
    skills: [
      { name: "FAQ Resolver",      description: "Responde perguntas frequentes com consistência e rapidez." },
      { name: "Coupon Sender",     description: "Distribui cupons e promoções conforme o perfil do contato." },
      { name: "Loyalty Checker",   description: "Consulta pontos de fidelidade e benefícios do programa." },
      { name: "Cart Recovery",     description: "Recupera carrinhos abandonados com oferta personalizada." },
      { name: "Product Recommender", description: "Recomenda produtos com base no histórico e contexto da conversa." },
      { name: "Review Collector",  description: "Solicita avaliações pós-compra no canal certo." },
      { name: "Lead Scorer",       description: "Pontua leads por comportamento e engajamento na conversa." },
    ],
  },
  {
    id: "ops",
    label: "Operações & Automação",
    color: "#f59e0b",
    icon: "⚙️",
    skills: [
      { name: "Agenda Assistant",  description: "Agenda reuniões e consultas via Calendly, Google Calendar ou n8n." },
      { name: "Gmail Copilot",     description: "Lê, resume e responde e-mails conectados via OAuth." },
      { name: "Payment Link",      description: "Gera links de pagamento PIX ou cartão na conversa." },
      { name: "Invoice Sender",    description: "Envia notas fiscais automaticamente via integração fiscal." },
      { name: "Delivery Tracker",  description: "Rastreia entregas em tempo real com código de rastreio." },
      { name: "Stock Checker",     description: "Consulta disponibilidade de estoque por produto e variação." },
      { name: "Webhook Trigger",   description: "Dispara webhooks customizados em eventos da conversa." },
      { name: "n8n Connector",     description: "Executa automações no n8n com passagem de contexto." },
      { name: "Form Filler",       description: "Coleta dados estruturados e preenche formulários externos." },
    ],
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function emptyForm(): AgentForm {
  return {
    integration_id: "", model: "", system_prompt: "", agent_name: "", identity: "",
    objective: "", communication_guidelines: "", service_instructions: "", restrictions: "",
    knowledge_base: "", faq: [], variables: [],
    voice: { workspace_voice_id: "", audio_enabled: false, provider: "", voice: "", stability: 0.5, similarity: 0.7, style: 0.5, speed: 1 },
    skills: [], app_access: [], rag_enabled: true, is_active: false,
    webhook_url: "", webhook_secret: "", mcp_server_url: "", compiled_prompt: "", assets: [],
    role: "primary", handoff_skills: [], action_confirmation: "client",
    activation_mode: "always",
    schedule: { timezone: "America/Sao_Paulo", days: {} },
  };
}

function parseJSONArray<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function mapAgent(data: any): AgentForm {
  const form = emptyForm();
  return {
    ...form,
    integration_id: data?.integration_id || "",
    model: data?.model || "",
    system_prompt: data?.system_prompt || "",
    agent_name: data?.agent_name || "",
    identity: data?.identity || "",
    objective: data?.objective || "",
    communication_guidelines: data?.communication_guidelines || "",
    service_instructions: data?.service_instructions || "",
    restrictions: data?.restrictions || "",
    knowledge_base: data?.knowledge_base || "",
    faq: parseJSONArray(data?.faq, []).map((item: any) => ({ id: item.id || uid(), question: item.question || "", answer: item.answer || "" })),
    variables: parseJSONArray(data?.variables, []).map((item: any) => ({ id: item.id || uid(), key: item.key || "", value: item.value || "", description: item.description || "" })),
    voice: { ...form.voice, ...(typeof data?.voice === "string" ? parseJSONArray(data.voice, {}) : data?.voice || {}) },
    skills: parseJSONArray(data?.skills, []).map((item: any) => ({ id: item.id || uid(), name: item.name || "", type: item.type || "custom", description: item.description || "", enabled: item.enabled !== false })),
    app_access: parseJSONArray(data?.app_access, []).map((item: any) => ({ id: item.id || uid(), name: item.name || "", type: item.type || "mcp", target: item.target || "", description: item.description || "", enabled: item.enabled !== false })),
    rag_enabled: data?.rag_enabled ?? true,
    is_active: data?.is_active ?? false,
    webhook_url: data?.webhook_url || "",
    webhook_secret: data?.webhook_secret || "",
    mcp_server_url: data?.mcp_server_url || "",
    compiled_prompt: data?.compiled_prompt || "",
    assets: data?.assets || [],
    role: data?.role || "primary",
    handoff_skills: parseJSONArray<string[]>(data?.handoff_skills, []),
    action_confirmation: (data?.action_confirmation === "auto" || data?.action_confirmation === "human") ? data.action_confirmation : "client",
    activation_mode: ["always", "business_hours", "off_hours", "new_contact_only", "custom"].includes(data?.activation_mode) ? data.activation_mode : "always",
    schedule: (() => {
      const raw = typeof data?.schedule === "string" ? parseJSONArray<any>(data.schedule, {}) : (data?.schedule || {});
      return {
        timezone: raw.timezone || "America/Sao_Paulo",
        days: raw.days || {},
      };
    })(),
  };
}

const glassCardStyle: CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "20px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.10)",
  transition: "all 0.35s cubic-bezier(0.16,1,0.3,1)",
};

const glassPillStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "10px",
};

const glassBtnStyle: CSSProperties = {
  background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(0,212,106,0.30)",
  boxShadow: "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
};

function cs(emphasis = false): CSSProperties {
  if (emphasis) {
    return {
      ...glassCardStyle,
      background: "linear-gradient(135deg, rgba(0,212,106,0.08) 0%, rgba(255,255,255,0.02) 100%)",
      border: "1px solid rgba(0,212,106,0.18)",
    };
  }
  return { ...glassCardStyle };
}

function inp(multiline = false): CSSProperties {
  return {
    width: "100%", borderRadius: 14, border: "1px solid var(--surface-border)",
    background: "var(--surface-3)", color: "var(--text-1)",
    padding: multiline ? "12px 14px" : "11px 14px", fontSize: 14,
    minHeight: multiline ? 120 : undefined,
  };
}

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType; description: string }> = [
  { id: "personality",   label: "Personality",   icon: Bot,     description: "Identidade, voz e atendimento" },
  { id: "knowledge",     label: "Knowledge",     icon: Brain,   description: "Base, FAQ e documentos" },
  { id: "skills",        label: "Skills",        icon: Sparkles, description: "30+ capacidades prontas" },
  { id: "access",        label: "Access",        icon: Globe,   description: "LLM, MCP, apps e integrações" },
  { id: "voice_studio",  label: "Voice Studio",  icon: Volume2, description: "Vozes, clones e providers" },
  { id: "activation",    label: "Ativação",      icon: Zap,     description: "Quando o agente responde" },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const [view, setView] = useState<"list" | "editor">("list");
  const [tab, setTab] = useState<TabId>("personality");
  const [selectedInstance, setSelectedInstance] = useState("");
  // Multi-agente: id do agente sendo editado dentro da instância. "" = primário.
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [showQuickSetup, setShowQuickSetup] = useState(false);
  const [form, setForm] = useState<AgentForm>(emptyForm());
  const knowledgeUploadRef = useRef<HTMLInputElement | null>(null);
  const skillUploadRef = useRef<HTMLInputElement | null>(null);

  const instancesQuery = useQuery({
    queryKey: ["instances", wsId],
    queryFn: async () => (await instancesApi.list(undefined, wsId)).data || [],
    enabled: !!wsId,
  });
  const integrationsQuery = useQuery({ queryKey: ["integrations"], queryFn: async () => (await integrationsApi.list()).data || [] });
  const voicesQuery = useQuery({
    queryKey: ["voices", wsId],
    queryFn: () => voicesApi.listVoices(wsId).then(r => r.data as Array<{ id: string; name: string; language: string; gender: string; provider?: { provider: string } }>),
    enabled: !!wsId,
  });

  useEffect(() => {
    if (!selectedInstance && instancesQuery.data?.length) setSelectedInstance(instancesQuery.data[0].id);
  }, [instancesQuery.data, selectedInstance]);

  const agentQuery = useQuery({
    queryKey: ["instance-agent", selectedInstance, selectedAgentId],
    queryFn: async () => (await integrationsApi.getAgent(selectedInstance, selectedAgentId || undefined)).data,
    enabled: !!selectedInstance,
  });

  // Reset do selectedAgentId ao trocar de instância — caso contrário o id
  // seria de outra instância e o GET retornaria 404.
  useEffect(() => {
    setSelectedAgentId("");
  }, [selectedInstance]);

  // Batch-fetch para list view — mesmo queryKey do editor, sem double-fetch
  const agentQueries = useQueries({
    queries: (instancesQuery.data ?? []).map((inst: any) => ({
      queryKey: ["instance-agent", inst.id],
      queryFn: async () => (await integrationsApi.getAgent(inst.id)).data,
      enabled: !!inst.id && view === "list",
    })),
  });

  useEffect(() => {
    if (agentQuery.data) setForm(mapAgent(agentQuery.data));
    else if (selectedInstance) setForm(emptyForm());
  }, [agentQuery.data, selectedInstance]);

  const selectedIntegration = useMemo(
    () => integrationsQuery.data?.find((item: any) => item.id === form.integration_id),
    [integrationsQuery.data, form.integration_id],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInstance) return;
      await integrationsApi.updateAgent(selectedInstance, {
        integration_id: form.integration_id || null, model: form.model,
        system_prompt: form.system_prompt, agent_name: form.agent_name,
        identity: form.identity, objective: form.objective,
        communication_guidelines: form.communication_guidelines,
        service_instructions: form.service_instructions, restrictions: form.restrictions,
        knowledge_base: form.knowledge_base, faq: form.faq, variables: form.variables,
        voice: form.voice, skills: form.skills, app_access: form.app_access,
        rag_enabled: form.rag_enabled, is_active: form.is_active,
        webhook_url: form.webhook_url, webhook_secret: form.webhook_secret,
        mcp_server_url: form.mcp_server_url,
        // Multi-agente + ativação (item 1 e 4 do roadmap de agentes).
        role: form.role, handoff_skills: form.handoff_skills,
        action_confirmation: form.action_confirmation,
        activation_mode: form.activation_mode,
        schedule: form.schedule,
      } as any, selectedAgentId || undefined);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instance-agent", selectedInstance, selectedAgentId] });
      await queryClient.invalidateQueries({ queryKey: ["instance-agents", selectedInstance] });
      toast.success("Agente salvo.");
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || "Não foi possível salvar."),
  });

  // Toggle de ativação independente do save geral. Antes ativação
  // ficava amarrada ao "Salvar agente" (PUT inteiro), agora faz só
  // o PATCH-equivalente do is_active e atualiza o estado local
  // imediatamente — UX direto, sem perder o resto do form não-salvo.
  const toggleActiveMutation = useMutation({
    mutationFn: async (active: boolean) => {
      if (!selectedInstance) throw new Error("instância não selecionada");
      await integrationsApi.updateAgent(selectedInstance, { is_active: active }, selectedAgentId || undefined);
      return active;
    },
    onSuccess: async (active) => {
      setForm((p) => ({ ...p, is_active: active }));
      await queryClient.invalidateQueries({ queryKey: ["instance-agent", selectedInstance, selectedAgentId] });
      await queryClient.invalidateQueries({ queryKey: ["instance-agents", selectedInstance] });
      await queryClient.invalidateQueries({ queryKey: ["agents-instance"] });
      toast.success(active ? "Agente ativado." : "Agente desativado.");
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || "Não foi possível alterar o status."),
  });

  // Checklist do que está pronto pra ativar com sucesso. Inclui LLM
  // (integração + modelo), prompt base, e identidade. Sem isso o
  // agente "ativo" não tem o que responder.
  const readiness = {
    hasLLM: !!form.integration_id,
    hasModel: !!form.model.trim(),
    hasIdentity: !!form.identity.trim() || !!form.agent_name.trim(),
    hasInstructions: !!form.system_prompt.trim() || !!form.service_instructions.trim(),
  };
  const readyCount = Object.values(readiness).filter(Boolean).length;
  const readyTotal = Object.keys(readiness).length;

  const uploadMutation = useMutation({
    mutationFn: async ({ file, category }: { file: File; category: "knowledge" | "skill" }) => {
      if (!selectedInstance) return;
      await integrationsApi.uploadAgentAsset(selectedInstance, file, category);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instance-agent", selectedInstance] });
      toast.success("Arquivo adicionado.");
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || "Falha ao enviar arquivo."),
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      if (!selectedInstance) return;
      await integrationsApi.deleteAgentAsset(selectedInstance, assetId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instance-agent", selectedInstance] });
      toast.success("Arquivo removido.");
    },
  });

  const assetsByCategory = useMemo(() => ({
    knowledge: form.assets.filter((a) => a.category === "knowledge"),
    skill: form.assets.filter((a) => a.category === "skill"),
  }), [form.assets]);

  const onUpload = (e: ChangeEvent<HTMLInputElement>, category: "knowledge" | "skill") => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate({ file, category });
    e.target.value = "";
  };

  const toggleSkill = (skillName: string, description: string) => {
    setForm((prev) => {
      const existing = prev.skills.find((s) => s.name === skillName);
      if (existing) {
        return { ...prev, skills: prev.skills.map((s) => s.name === skillName ? { ...s, enabled: !s.enabled } : s) };
      }
      return { ...prev, skills: [...prev.skills, { id: uid(), name: skillName, type: "preset", description, enabled: true }] };
    });
  };

  const activeSkillNames = new Set(form.skills.filter((s) => s.enabled).map((s) => s.name));
  const totalActiveSkills = activeSkillNames.size;

  const renderListEditor = (
    items: Array<any>,
    onAdd: () => void,
    renderItem: (item: any, index: number) => React.ReactNode,
  ) => (
    <div className="space-y-3">
      {items.map(renderItem)}
      <button onClick={onAdd} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
        style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}>
        <Plus className="w-4 h-4" /> Adicionar
      </button>
    </div>
  );

  // Derive live stats for the header
  const totalInstances = instancesQuery.data?.length ?? 0;
  const activeAgents = agentQueries.filter((q) => (q.data as any)?.is_active).length;
  const configuredAgents = agentQueries.filter((q) => (q.data as any)?.agent_name).length;

  return (
    <div className="flex flex-col gap-4">
      {/* AI Command Center header */}
      <div className="rounded-2xl overflow-hidden" style={{
        background: "linear-gradient(135deg, rgba(167,139,250,0.07) 0%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(167,139,250,0.14)",
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        boxShadow: "0 4px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}>
        <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            {view === "editor" && (
              <button
                onClick={() => setView("list")}
                className="inline-flex items-center gap-1.5 text-xs mb-2 px-2 py-1 rounded-lg"
                style={{ color: "var(--text-3)", background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                <ArrowLeft className="w-3 h-3" /> Agentes
              </button>
            )}
            {view === "list" && (
              <>
                <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                  <Bot className="w-5 h-5" style={{ color: "#a78bfa" }} />
                  Agentes IA
                </h1>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                  Configure, treine e ative seus agentes de IA por instância.
                </p>
              </>
            )}

            {view === "editor" && (() => {
              const inst = instancesQuery.data?.find((i: any) => i.id === selectedInstance);
              const channelColor = inst ? (CHANNEL_COLOR[inst.channel] || "#a78bfa") : "#a78bfa";
              const displayName = form.agent_name?.trim() || "Agente sem nome";
              return (
                <div className="flex items-start gap-3 min-w-0">
                  {/* Avatar com cor do canal — reforça vínculo visual */}
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 mt-1"
                    style={{
                      background: `${channelColor}1a`,
                      border: `1px solid ${channelColor}40`,
                    }}>
                    <Bot className="w-5 h-5" style={{ color: channelColor }} />
                  </div>
                  <div className="min-w-0">
                    {/* Nome do agente em destaque + edição inline.
                        Antes mostrava o nome da INSTÂNCIA aqui — agora
                        o nome do agente vem primeiro, instância vai
                        pra metadata abaixo. */}
                    <input
                      value={form.agent_name}
                      onChange={(e) => setForm((p) => ({ ...p, agent_name: e.target.value }))}
                      placeholder="Nome do agente"
                      className="w-full bg-transparent border-0 outline-none text-xl sm:text-2xl font-semibold tracking-tight"
                      style={{
                        color: form.agent_name?.trim() ? "var(--text-1)" : "var(--text-3)",
                        minWidth: 200,
                      }}
                      title="Clique para editar o nome do agente"
                    />
                    {/* Subtítulo: instância vinculada + canal + status */}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                        Conectado a
                      </span>
                      {inst ? (
                        <>
                          <span className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                            {inst.name}
                          </span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize"
                            style={{ background: `${channelColor}18`, color: channelColor, border: `1px solid ${channelColor}30` }}>
                            {String(inst.channel ?? "").replace("_", " ")}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: STATUS_COLOR[inst.status] || "#71717a" }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[inst.status] || "#71717a" }} />
                            {inst.status}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-3)" }}>Selecione uma instância</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Live stat pills */}
          {view === "list" && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium" style={{
                background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa",
              }}>
                <Bot className="w-3.5 h-3.5" />
                {totalInstances} instâncias
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium" style={{
                background: configuredAgents > 0 ? "rgba(0,212,106,0.08)" : "rgba(255,255,255,0.04)",
                border: configuredAgents > 0 ? "1px solid rgba(0,212,106,0.18)" : "1px solid rgba(255,255,255,0.07)",
                color: configuredAgents > 0 ? "var(--green)" : "var(--text-3)",
              }}>
                {configuredAgents > 0 && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
                {configuredAgents} configurados
              </div>
              {activeAgents > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium" style={{
                  background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.25)", color: "var(--green)",
                }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping opacity-75" />
                  {activeAgents} ativo{activeAgents !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          )}

          {view === "editor" && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle de ativação clicável — antes era pill read-only.
                  Aplica direto via PATCH (toggleActiveMutation) sem
                  precisar do botão "Salvar agente". Avisa quando ativa
                  sem LLM configurada (agente sobe mas não responde). */}
              <button
                disabled={!selectedInstance || toggleActiveMutation.isPending}
                onClick={() => {
                  if (!form.is_active && !readiness.hasLLM) {
                    if (!confirm("Você está ativando o agente sem uma LLM configurada. Sem isso ele não responde. Ativar mesmo assim?")) return;
                  }
                  toggleActiveMutation.mutate(!form.is_active);
                }}
                className="group flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl transition-all"
                style={{
                  ...glassPillStyle,
                  cursor: "pointer",
                  borderColor: form.is_active ? "rgba(0,212,106,0.35)" : "rgba(255,255,255,0.07)",
                  background: form.is_active ? "rgba(0,212,106,0.08)" : glassPillStyle.background,
                  opacity: toggleActiveMutation.isPending ? 0.6 : 1,
                }}
                title={form.is_active ? "Clique para desativar o agente" : "Clique para ativar o agente"}>
                {toggleActiveMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full ${form.is_active ? "bg-green-500" : "bg-zinc-500"}`} />
                )}
                <span style={{ color: form.is_active ? "var(--green)" : "var(--text-2)" }}>
                  {form.is_active ? "Ativo" : "Inativo"}
                </span>
                {/* Mini-switch visual à direita pra reforçar que é interativo */}
                <span className="ml-1 inline-flex h-4 w-7 rounded-full transition-all"
                  style={{
                    background: form.is_active ? "var(--green)" : "rgba(255,255,255,0.1)",
                    padding: 1.5,
                  }}>
                  <span className="h-3 w-3 rounded-full bg-white transition-transform"
                    style={{ transform: form.is_active ? "translateX(12px)" : "translateX(0)" }} />
                </span>
              </button>

              {/* Readiness — quantos passos da config estão prontos.
                  Clica e leva pra Identidade onde o user resolve. */}
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl"
                style={{
                  ...glassPillStyle,
                  borderColor: readyCount === readyTotal
                    ? "rgba(0,212,106,0.20)"
                    : readyCount === 0
                      ? "rgba(248,113,113,0.20)"
                      : "rgba(251,191,36,0.20)",
                  color: readyCount === readyTotal ? "var(--green)" : readyCount === 0 ? "#f87171" : "#fbbf24",
                }}>
                <CheckCircle className="w-3 h-3" />
                Setup {readyCount}/{readyTotal}
              </div>

              {totalActiveSkills > 0 && (
                <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl" style={{ ...glassPillStyle, border: "1px solid rgba(139,92,246,0.20)", color: "#a78bfa" }}>
                  <Sparkles className="w-3 h-3" />
                  {totalActiveSkills} skill{totalActiveSkills !== 1 ? "s" : ""}
                </div>
              )}
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!selectedInstance || saveMutation.isPending}
                className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all"
                style={{ ...glassBtnStyle, color: "var(--green)", opacity: saveMutation.isPending ? 0.7 : 1, borderRadius: "12px" }}>
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? "Salvando..." : "Salvar agente"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── List view ── */}
      {view === "list" && (
        <AgentListView
          instances={instancesQuery.data ?? []}
          agentQueries={agentQueries}
          isLoading={instancesQuery.isLoading}
          onEdit={(instanceId) => {
            setSelectedInstance(instanceId);
            setView("editor");
          }}
          onToggleActive={async (instanceId, active) => {
            try {
              await integrationsApi.updateAgent(instanceId, { is_active: active });
              await queryClient.invalidateQueries({ queryKey: ["instance-agent", instanceId] });
              toast.success(active ? "Agente ativado." : "Agente desativado.");
            } catch (e: any) {
              toast.error(e?.response?.data?.error || "Erro ao alterar status.");
            }
          }}
        />
      )}

      {/* ── Editor view ── */}
      {view === "editor" && (
      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-5">
        {/* Sidebar */}
        <aside className="space-y-4">
          {/* Instance selector — seguindo a mesma hierarquia da
              header: agora rotulado como "Trocar de agente" pra
              deixar claro que cada instância tem seu agente separado. */}
          <div className="rounded-3xl p-4" style={cs(true)}>
            <p className="text-xs font-medium uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-3)" }}>Trocar de agente</p>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="w-full rounded-xl px-3 py-3 text-sm"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}>
              {instancesQuery.data?.map((i: any) => (
                <option key={i.id} value={i.id}>{i.name} · {i.channel}</option>
              ))}
            </select>
            {/* Multi-agente — chips dos agentes desta instância. Permite
                criar/promover/remover sem sair do editor. */}
            {selectedInstance && (
              <div className="mt-3">
                <AgentSwitcher
                  instanceId={selectedInstance}
                  selectedAgentId={selectedAgentId}
                  onSelect={setSelectedAgentId}
                />
              </div>
            )}
            {/* Setup rápido: 7 perguntas que geram identity/objective/etc via LLM.
                Dispara modal — substitui o passo de "encarar 5 abas vazias". */}
            {selectedInstance && (
              <button
                type="button"
                onClick={() => setShowQuickSetup(true)}
                className="mt-3 w-full text-xs font-medium px-3 py-2 rounded-xl inline-flex items-center justify-center gap-1.5"
                style={{
                  background: "rgba(99,102,241,0.1)",
                  color: "#a5b4fc",
                  border: "1px dashed rgba(99,102,241,0.3)",
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Setup rápido com IA
              </button>
            )}
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
              <div className="rounded-2xl p-3" style={cs()}>
                <p style={{ color: "var(--text-3)" }}>RAG</p>
                <strong style={{ color: "var(--text-1)" }}>{form.rag_enabled ? "Ligado" : "Desligado"}</strong>
              </div>
              <div className="rounded-2xl p-3" style={cs()}>
                <p style={{ color: "var(--text-3)" }}>Skills</p>
                <strong style={{ color: totalActiveSkills > 0 ? "#a78bfa" : "var(--text-1)" }}>{totalActiveSkills} / 30+</strong>
              </div>
            </div>
          </div>

          {/* Tab nav */}
          <nav className="rounded-3xl overflow-hidden" style={cs()}>
            {TABS.map((item, index) => {
              const active = tab === item.id;
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => setTab(item.id)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left"
                  style={{ borderBottom: index < TABS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : undefined, background: active ? "rgba(0,212,106,0.08)" : "transparent" }}>
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: active ? "rgba(0,212,106,0.14)" : "var(--surface-3)" }}>
                    <Icon className="w-4 h-4" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>{item.label}</p>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>{item.description}</p>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <AnimatedTabContent tabKey={tab}>
        <section className="space-y-5">
          {/* ── Personality tab ── */}
          {tab === "personality" && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-5 space-y-4" style={cs()}>
                  <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Identidade</h2>
                  <input value={form.agent_name} onChange={(e) => setForm((p) => ({ ...p, agent_name: e.target.value }))} placeholder="Nome do agente" style={inp()} />
                  <textarea value={form.identity} onChange={(e) => setForm((p) => ({ ...p, identity: e.target.value }))} placeholder="Quem esse agente é e o que representa?" style={inp(true)} />
                  <textarea value={form.objective} onChange={(e) => setForm((p) => ({ ...p, objective: e.target.value }))} placeholder="Objetivo principal" style={inp(true)} />
                </div>

                <div className="rounded-3xl p-5 space-y-4" style={cs()}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                      <Mic2 className="w-4 h-4" style={{ color: "var(--green)" }} /> Resposta em áudio
                    </h2>
                    {/* audio_enabled toggle */}
                    <button
                      onClick={() => setForm(p => ({ ...p, voice: { ...p.voice, audio_enabled: !p.voice.audio_enabled } }))}
                      className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-xl transition-all"
                      style={{ background: form.voice.audio_enabled ? "rgba(0,200,100,0.12)" : "var(--surface-3)", color: form.voice.audio_enabled ? "var(--green)" : "var(--text-3)", border: `1px solid ${form.voice.audio_enabled ? "var(--green)" : "var(--surface-border)"}` }}>
                      {form.voice.audio_enabled ? "Ativado" : "Desativado"}
                    </button>
                  </div>

                  {/* Voice picker */}
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Voz</label>
                    <select
                      value={form.voice.workspace_voice_id || ""}
                      onChange={e => setForm(p => ({ ...p, voice: { ...p.voice, workspace_voice_id: e.target.value } }))}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: form.voice.workspace_voice_id ? "var(--text-1)" : "var(--text-3)" }}>
                      <option value="">Selecionar voz...</option>
                      {(voicesQuery.data ?? []).map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name}{v.language ? ` · ${v.language}` : ""}{v.gender ? ` · ${v.gender}` : ""}{v.provider?.provider ? ` (${v.provider.provider})` : ""}
                        </option>
                      ))}
                    </select>
                    {!voicesQuery.data?.length && (
                      <p className="text-[11px] mt-1.5" style={{ color: "var(--text-3)" }}>
                        Nenhuma voz disponível. Configure providers em{" "}
                        <a href="/integrations?tab=voices" className="underline" style={{ color: "var(--green)" }}>Integrações → Vozes</a>.
                      </p>
                    )}
                  </div>

                  {(["stability", "similarity", "style", "speed"] as const).map((key) => {
                    const labels: Record<string, string> = { stability: "Estabilidade", similarity: "Similaridade", style: "Sotaque / estilo", speed: "Velocidade" };
                    const [min, max] = key === "speed" ? [0.7, 1.2] : [0, 1];
                    return (
                      <label key={key} className="block text-sm" style={{ color: "var(--text-2)" }}>
                        <div className="flex items-center justify-between mb-2">
                          <span>{labels[key]}</span>
                          <strong style={{ color: "var(--text-1)" }}>{form.voice[key]}</strong>
                        </div>
                        <input type="range" min={min} max={max} step={0.1}
                          value={form.voice[key]}
                          onChange={(e) => setForm((p) => ({ ...p, voice: { ...p.voice, [key]: Number(e.target.value) } }))}
                          className="w-full" />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl p-5 space-y-4" style={cs()}>
                <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Diretrizes e atendimento</h2>
                <textarea value={form.communication_guidelines} onChange={(e) => setForm((p) => ({ ...p, communication_guidelines: e.target.value }))} placeholder="Tom, postura, estilo de resposta, linguagem..." style={inp(true)} />
                <textarea value={form.service_instructions} onChange={(e) => setForm((p) => ({ ...p, service_instructions: e.target.value }))} placeholder="Fluxo de atendimento, qualificação, CTA e encerramento..." style={inp(true)} />
                <textarea value={form.restrictions} onChange={(e) => setForm((p) => ({ ...p, restrictions: e.target.value }))} placeholder="Restrições operacionais, legais e de segurança..." style={inp(true)} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-5" style={cs()}>
                  <h2 className="text-lg font-medium mb-4" style={{ color: "var(--text-1)" }}>Variáveis</h2>
                  {renderListEditor(
                    form.variables,
                    () => setForm((p) => ({ ...p, variables: [...p.variables, { id: uid(), key: "", value: "", description: "" }] })),
                    (item, index) => (
                      <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 p-3 rounded-2xl mb-3" style={cs()}>
                        <div className="space-y-2">
                          <input value={item.key} onChange={(e) => setForm((p) => ({ ...p, variables: p.variables.map((r, i) => i === index ? { ...r, key: e.target.value } : r) }))} placeholder="Chave" style={inp()} />
                          <input value={item.value} onChange={(e) => setForm((p) => ({ ...p, variables: p.variables.map((r, i) => i === index ? { ...r, value: e.target.value } : r) }))} placeholder="Valor padrão" style={inp()} />
                        </div>
                        <textarea value={item.description} onChange={(e) => setForm((p) => ({ ...p, variables: p.variables.map((r, i) => i === index ? { ...r, description: e.target.value } : r) }))} placeholder="Descrição" style={inp(true)} />
                        <button onClick={() => setForm((p) => ({ ...p, variables: p.variables.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ),
                  )}
                </div>
                <div className="rounded-3xl p-5" style={cs()}>
                  <h2 className="text-lg font-medium mb-4" style={{ color: "var(--text-1)" }}>Prompt compilado</h2>
                  <textarea readOnly value={form.compiled_prompt} style={{ ...inp(true), minHeight: 360, opacity: 0.85 }} />
                </div>
              </div>
            </>
          )}

          {/* ── Knowledge tab ── */}
          {tab === "knowledge" && (
            <>
              <div className="rounded-3xl p-5 space-y-4" style={cs()}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Base de conhecimento manual</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Informações que o agente usa como fonte primária.</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-2)" }}>
                    <input type="checkbox" checked={form.rag_enabled} onChange={(e) => setForm((p) => ({ ...p, rag_enabled: e.target.checked }))} />
                    Habilitar RAG
                  </label>
                </div>
                <textarea value={form.knowledge_base} onChange={(e) => setForm((p) => ({ ...p, knowledge_base: e.target.value }))} placeholder="Serviços, políticas, preços, processos, objeções..." style={{ ...inp(true), minHeight: 240 }} />
              </div>

              <div className="rounded-3xl p-5" style={cs()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>FAQ personalizado</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Perguntas frequentes e respostas aprovadas.</p>
                  </div>
                </div>
                {renderListEditor(
                  form.faq,
                  () => setForm((p) => ({ ...p, faq: [...p.faq, { id: uid(), question: "", answer: "" }] })),
                  (item, index) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 p-3 rounded-2xl mb-3" style={cs()}>
                      <div className="space-y-2">
                        <input value={item.question} onChange={(e) => setForm((p) => ({ ...p, faq: p.faq.map((r, i) => i === index ? { ...r, question: e.target.value } : r) }))} placeholder="Pergunta" style={inp()} />
                        <textarea value={item.answer} onChange={(e) => setForm((p) => ({ ...p, faq: p.faq.map((r, i) => i === index ? { ...r, answer: e.target.value } : r) }))} placeholder="Resposta" style={inp(true)} />
                      </div>
                      <button onClick={() => setForm((p) => ({ ...p, faq: p.faq.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ),
                )}
              </div>

              <div className="rounded-3xl p-5" style={cs()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Documentos e arquivos</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Upload para RAG. Suporta pdf, doc, docx, txt, md, pptx, json.</p>
                  </div>
                  <div>
                    <input ref={knowledgeUploadRef} type="file" hidden onChange={(e) => onUpload(e, "knowledge")} />
                    <button onClick={() => knowledgeUploadRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}>
                      <Upload className="w-4 h-4" /> Enviar arquivo
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {assetsByCategory.knowledge.length === 0 && (
                    <div className="rounded-2xl p-4 text-sm" style={cs()}>Nenhum arquivo anexado ainda.</div>
                  )}
                  {assetsByCategory.knowledge.map((asset) => (
                    <div key={asset.id} className="rounded-2xl p-4 flex items-start justify-between gap-4" style={cs()}>
                      <div className="min-w-0">
                        <p className="font-medium truncate" style={{ color: "var(--text-1)" }}>{asset.name || asset.file_name}</p>
                        <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>{asset.file_name} · {Math.round(asset.size_bytes / 1024)} KB</p>
                        {asset.extracted_text && <p className="text-xs mt-2 line-clamp-3" style={{ color: "var(--text-2)" }}>{asset.extracted_text}</p>}
                      </div>
                      <button onClick={() => deleteAssetMutation.mutate(asset.id)} className="px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Skills tab ── */}
          {tab === "skills" && <SkillsTab form={form} setForm={setForm} activeSkillNames={activeSkillNames} toggleSkill={toggleSkill} skillUploadRef={skillUploadRef} onUpload={onUpload} assetsByCategory={assetsByCategory} deleteAssetMutation={deleteAssetMutation} renderListEditor={renderListEditor} />}

          {/* ── Voice Studio tab ── */}
          {tab === "voice_studio" && <VoiceStudioTab wsId={wsId} selectedVoiceId={form.voice.workspace_voice_id} onSelect={(id) => setForm(p => ({ ...p, voice: { ...p.voice, workspace_voice_id: id } }))} />}
          {tab === "activation" && (
            <ActivationTab
              mode={form.activation_mode}
              schedule={form.schedule}
              onChangeMode={(m) => setForm((p) => ({ ...p, activation_mode: m }))}
              onChangeSchedule={(s) => setForm((p) => ({ ...p, schedule: s }))}
            />
          )}

          {/* ── Access tab ── */}
          {tab === "access" && (
            <>
              {/* Ações nativas do agente dentro da Uniq — toggles + política
                  de confirmação. Usa app_access (type=action) pra reaproveitar
                  estrutura existente; backend lê via parseEnabledTools. */}
              <div className="rounded-3xl p-5" style={cs()}>
                <AgentActionsConfig
                  appAccess={form.app_access as any}
                  confirmation={form.action_confirmation}
                  onChangeAppAccess={(next) => setForm((p) => ({ ...p, app_access: next as any }))}
                  onChangeConfirmation={(v) => setForm((p) => ({ ...p, action_confirmation: v }))}
                />
              </div>

              {/* Card de Estado — DEDICADO. Antes ativação ficava
                  amarrada ao card de LLM ("LLM e ativação"), o que
                  fazia parecer que "ligar agente" e "ligar LLM" eram
                  a mesma coisa. Agora cada um vive na sua casa: este
                  card é só status; o outro é só config de LLM. */}
              <div className="rounded-3xl p-5" style={cs()}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background: form.is_active ? "rgba(0,212,106,0.10)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${form.is_active ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.08)"}`,
                      }}>
                      <Bot className="w-5 h-5" style={{ color: form.is_active ? "var(--green)" : "var(--text-3)" }} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Estado do agente</h2>
                      <p className="text-sm" style={{ color: "var(--text-3)" }}>
                        {form.is_active
                          ? "Respondendo conversas nesta instância automaticamente."
                          : "Conversas chegam normal mas o agente não responde sozinho. Humanos atendem."}
                      </p>
                    </div>
                  </div>
                  <button
                    disabled={toggleActiveMutation.isPending}
                    onClick={() => {
                      if (!form.is_active && !readiness.hasLLM) {
                        if (!confirm("Você está ativando o agente sem uma LLM configurada. Sem isso ele não responde. Ativar mesmo assim?")) return;
                      }
                      toggleActiveMutation.mutate(!form.is_active);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                    style={form.is_active
                      ? { background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }
                      : { background: "var(--green)", color: "#03170a" }}>
                    {toggleActiveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {form.is_active ? "Desativar agente" : "Ativar agente"}
                  </button>
                </div>

                {/* Checklist visual — o que precisa estar pronto pra
                    ativação fazer sentido. Cada item é clicável e leva
                    pra tab onde resolver. */}
                <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { ok: readiness.hasLLM,          label: "LLM",        hint: "Selecione provedor",  goto: "access" },
                    { ok: readiness.hasModel,        label: "Modelo",     hint: "Defina o modelo",     goto: "access" },
                    { ok: readiness.hasIdentity,     label: "Identidade", hint: "Nome do agente",      goto: "identity" },
                    { ok: readiness.hasInstructions, label: "Instruções", hint: "Prompt base",         goto: "identity" },
                  ].map((it) => (
                    <button key={it.label} onClick={() => setTab(it.goto as typeof tab)}
                      className="flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl text-left transition-all"
                      style={{
                        background: it.ok ? "rgba(0,212,106,0.05)" : "var(--surface-2)",
                        border: `1px solid ${it.ok ? "rgba(0,212,106,0.18)" : "var(--surface-border)"}`,
                      }}>
                      <span className="flex items-center gap-1.5 text-[11px] font-medium"
                        style={{ color: it.ok ? "var(--green)" : "var(--text-3)" }}>
                        <CheckCircle className="w-3 h-3" />
                        {it.label}
                      </span>
                      <span className="text-[11px]" style={{ color: it.ok ? "var(--text-2)" : "var(--text-3)" }}>
                        {it.ok ? "Pronto" : it.hint}
                      </span>
                    </button>
                  ))}
                </div>

                {form.is_active && !readiness.hasLLM && (
                  <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)" }}>
                    <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#f87171" }} />
                    <p className="text-xs" style={{ color: "#fca5a5" }}>
                      Agente está ativo mas sem LLM configurada — ele não vai responder. Configure abaixo ou desative pra atendimento humano.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-5 space-y-4" style={cs()}>
                  <div>
                    <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Modelo de linguagem</h2>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                      Provedor e modelo que geram as respostas. Independente do estado de ativação acima.
                    </p>
                  </div>
                  <select value={form.integration_id || "uniq"} onChange={(e) => setForm((p) => ({ ...p, integration_id: e.target.value === "uniq" ? "" : e.target.value, model: "" }))} style={inp()}>
                    {/* "Uniq AI" é a opção default — quando selecionada,
                        integration_id fica vazio e o backend cai no
                        PlatformAI configurado pelo admin (transparente
                        pro user, sem expor provider/model interno).
                        Recomendada pra maioria dos casos. */}
                    <option value="uniq">Uniq AI (recomendado)</option>
                    {(integrationsQuery.data?.length ?? 0) > 0 && (
                      <option disabled>──────────</option>
                    )}
                    {integrationsQuery.data?.map((item: any) => (
                      <option key={item.id} value={item.id}>{item.name} · {item.provider}</option>
                    ))}
                  </select>
                  <input value={form.model} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} placeholder={form.integration_id ? "Modelo (ex: claude-sonnet-4-5)" : "Auto (Uniq AI escolhe)"} style={inp()} disabled={!form.integration_id} />
                  <textarea value={form.system_prompt} onChange={(e) => setForm((p) => ({ ...p, system_prompt: e.target.value }))} placeholder="Prompt base adicional" style={inp(true)} />
                </div>

                <div className="rounded-3xl p-5 space-y-4" style={cs()}>
                  <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Integrações operacionais</h2>
                  <input value={form.mcp_server_url} onChange={(e) => setForm((p) => ({ ...p, mcp_server_url: e.target.value }))} placeholder="MCP server URL" style={inp()} />
                  <input value={form.webhook_url} onChange={(e) => setForm((p) => ({ ...p, webhook_url: e.target.value }))} placeholder="Webhook URL (n8n, Zapier, etc.)" style={inp()} />
                  <input value={form.webhook_secret} onChange={(e) => setForm((p) => ({ ...p, webhook_secret: e.target.value }))} placeholder="Webhook secret" style={inp()} />
                  <div className="rounded-2xl p-4 text-sm" style={cs()}>
                    <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-1)" }}>
                      <Shield className="w-4 h-4" /> Recomendação
                    </div>
                    <p style={{ color: "var(--text-3)" }}>Use integration_id + model para a LLM, mcp_server_url para tools, e webhook para delegar execução externa.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl p-5" style={cs()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Apps e acessos disponíveis</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Apps que o agente pode usar via MCP, OAuth, API ou webhook.</p>
                  </div>
                </div>
                {renderListEditor(
                  form.app_access,
                  () => setForm((p) => ({ ...p, app_access: [...p.app_access, { id: uid(), name: "", type: "mcp", target: "", description: "", enabled: true }] })),
                  (item, index) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_180px_1fr_auto] gap-3 p-3 rounded-2xl mb-3" style={cs()}>
                      <div className="space-y-2">
                        <input value={item.name} onChange={(e) => setForm((p) => ({ ...p, app_access: p.app_access.map((r, i) => i === index ? { ...r, name: e.target.value } : r) }))} placeholder="Nome do app" style={inp()} />
                        <textarea value={item.description} onChange={(e) => setForm((p) => ({ ...p, app_access: p.app_access.map((r, i) => i === index ? { ...r, description: e.target.value } : r) }))} placeholder="O que o agente pode fazer com esse app" style={inp(true)} />
                      </div>
                      <div className="space-y-2">
                        <input value={item.type} onChange={(e) => setForm((p) => ({ ...p, app_access: p.app_access.map((r, i) => i === index ? { ...r, type: e.target.value } : r) }))} placeholder="mcp, oauth, webhook..." style={inp()} />
                        <label className="flex items-center gap-2 text-sm px-3 py-3 rounded-xl" style={{ ...cs(), color: "var(--text-2)" }}>
                          <input type="checkbox" checked={item.enabled} onChange={(e) => setForm((p) => ({ ...p, app_access: p.app_access.map((r, i) => i === index ? { ...r, enabled: e.target.checked } : r) }))} />
                          Disponível
                        </label>
                      </div>
                      <input value={item.target} onChange={(e) => setForm((p) => ({ ...p, app_access: p.app_access.map((r, i) => i === index ? { ...r, target: e.target.value } : r) }))} placeholder="URL, app id, endpoint..." style={inp()} />
                      <button onClick={() => setForm((p) => ({ ...p, app_access: p.app_access.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ),
                )}
              </div>

              <div className="rounded-3xl p-5" style={cs()}>
                <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                  <Link2 className="w-4 h-4" style={{ color: "var(--green)" }} /> Resumo técnico
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl p-4" style={cs()}>
                    <p style={{ color: "var(--text-3)" }}>LLM</p>
                    <strong style={{ color: "var(--text-1)" }}>{selectedIntegration?.name || "Não definida"}</strong>
                  </div>
                  <div className="rounded-2xl p-4" style={cs()}>
                    <p style={{ color: "var(--text-3)" }}>Modelo</p>
                    <strong style={{ color: "var(--text-1)" }}>{form.model || "Padrão do provider"}</strong>
                  </div>
                  <div className="rounded-2xl p-4" style={cs()}>
                    <p style={{ color: "var(--text-3)" }}>Apps disponíveis</p>
                    <strong style={{ color: "var(--text-1)" }}>{form.app_access.filter((a) => a.enabled).length}</strong>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
        </AnimatedTabContent>
      </div>
      )}

      {/* QuickSetup wizard — modal global do editor. Quando aplica,
          preenche os campos do form sem persistir; user revisa e salva. */}
      {showQuickSetup && selectedInstance && (
        <QuickSetupWizard
          instanceId={selectedInstance}
          agentId={selectedAgentId || undefined}
          initialName={form.agent_name}
          onClose={() => setShowQuickSetup(false)}
          onApply={(s) => setForm((p) => ({
            ...p,
            agent_name: s.agent_name || p.agent_name,
            identity: s.identity || p.identity,
            objective: s.objective || p.objective,
            communication_guidelines: s.communication_guidelines || p.communication_guidelines,
            service_instructions: s.service_instructions || p.service_instructions,
            restrictions: s.restrictions || p.restrictions,
          }))}
        />
      )}
    </div>
  );
}

// ─── Agent List View ─────────────────────────────────────────────────────────

const CHANNEL_COLOR: Record<string, string> = {
  whatsapp: "#25d366", waba: "#25d366", instagram: "#e1306c",
  instagram_api: "#e1306c", telegram: "#229ed9", facebook: "#1877f2",
  linkedin: "#0a66c2", tiktok: "#010101",
};

const STATUS_COLOR: Record<string, string> = {
  connected: "#22c55e", disconnected: "#71717a", connecting: "#f59e0b", banned: "#ef4444",
};

// Seeded rand for deterministic sparklines
function agentSeed(id: string, i: number) {
  const s = id.charCodeAt(0) * 31 + id.charCodeAt(1);
  const x = Math.sin(s * 9301 + i * 49297 + 233) * 134775813;
  return x - Math.floor(x);
}

function AgentActivityBars({ instanceId, isActive }: { instanceId: string; isActive: boolean }) {
  const color = isActive ? "#00d46a" : "#334155";
  const bars = Array.from({ length: 7 }, (_, i) =>
    isActive ? Math.max(0.15, agentSeed(instanceId, i)) : agentSeed(instanceId, i) * 0.3
  );
  return (
    <div className="flex items-end gap-[3px] h-8">
      {bars.map((h, i) => (
        <div key={i} className="flex-1 rounded-sm transition-all duration-500"
          style={{ height: `${Math.round(h * 28) + 4}px`, background: isActive ? `${color}${Math.round(40 + h * 120).toString(16).padStart(2, "0")}` : color, opacity: isActive ? 0.7 + h * 0.3 : 0.2 + h * 0.3 }} />
      ))}
    </div>
  );
}

function AgentScoreRing({ score, isActive, size = 56 }: { score: number; isActive: boolean; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const color = isActive ? "#00d46a" : "#334155";
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${(score / 100) * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold" style={{ color: isActive ? color : "#475569" }}>{score}</span>
      </div>
    </div>
  );
}

function AgentListView({
  instances, agentQueries, isLoading, onEdit, onToggleActive,
}: {
  instances: any[];
  agentQueries: Array<{ data: any; isLoading: boolean }>;
  isLoading: boolean;
  onEdit: (instanceId: string) => void;
  onToggleActive: (instanceId: string, active: boolean) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-3xl p-5 animate-pulse" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", height: 220 }} />
        ))}
      </div>
    );
  }

  if (!instances.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="mb-6 opacity-60">
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
            <rect x="36" y="22" width="48" height="38" rx="8" stroke="var(--text-3)" strokeWidth="2.5" fill="none" />
            <line x1="60" y1="22" x2="60" y2="12" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="60" cy="10" r="3" fill="var(--green)" />
            <circle cx="50" cy="38" r="5" stroke="var(--green)" strokeWidth="2" fill="none" />
            <circle cx="70" cy="38" r="5" stroke="var(--green)" strokeWidth="2" fill="none" />
            <circle cx="50" cy="38" r="2" fill="var(--green)" opacity="0.7" />
            <circle cx="70" cy="38" r="2" fill="var(--green)" opacity="0.7" />
            <rect x="42" y="64" width="36" height="26" rx="6" stroke="var(--text-3)" strokeWidth="2" fill="none" />
            <line x1="60" y1="60" x2="60" y2="64" stroke="var(--text-3)" strokeWidth="3" strokeLinecap="round" />
            <line x1="42" y1="74" x2="28" y2="80" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" />
            <line x1="78" y1="74" x2="92" y2="80" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="26" cy="81" r="4" stroke="var(--text-3)" strokeWidth="1.5" fill="none" />
            <circle cx="94" cy="81" r="4" stroke="var(--text-3)" strokeWidth="1.5" fill="none" />
            <circle cx="60" cy="77" r="3" fill="var(--text-3)" opacity="0.4" />
          </svg>
        </div>
        <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-1)" }}>Nenhuma instância encontrada</h3>
        <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--text-3)" }}>Crie uma instância para começar a configurar agentes de IA.</p>
        <a href="/instances" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)" }}>
          <Plus className="w-4 h-4" /> Criar primeira instância
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {instances.map((inst: any, idx: number) => {
        const agentData = agentQueries[idx]?.data;
        const agentLoading = agentQueries[idx]?.isLoading;
        const configured = !!agentData?.agent_name;
        const isActive = !!agentData?.is_active;
        const channelColor = CHANNEL_COLOR[inst.channel] || "#a78bfa";
        const statusColor = STATUS_COLOR[inst.status] || "#71717a";
        const totalSkills = (() => {
          try { return agentData?.skills ? JSON.parse(agentData.skills).filter((s: any) => s.enabled).length : 0; }
          catch { return 0; }
        })();
        const hasLLM = !!agentData?.integration_id;
        const hasRAG = !!agentData?.rag_enabled;

        // Compute a score 0-100 based on configuration completeness
        const score = configured ? Math.min(100, Math.round(
          (agentData.agent_name ? 20 : 0) +
          (agentData.system_prompt || agentData.objective ? 20 : 0) +
          (hasLLM ? 20 : 0) +
          (totalSkills > 0 ? Math.min(20, totalSkills * 3) : 0) +
          (hasRAG ? 10 : 0) +
          (isActive ? 10 : 0)
        )) : 0;

        const SKILL_DOTS = [
          { label: "Vendas", color: "#00d46a" },
          { label: "Suporte", color: "#60a5fa" },
          { label: "Agenda", color: "#a78bfa" },
          { label: "Pagamento", color: "#f59e0b" },
        ];

        return (
          <div
            key={inst.id}
            className="rounded-3xl flex flex-col gap-0 overflow-hidden transition-all duration-200"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: configured
                ? isActive ? "1px solid rgba(0,212,106,0.22)" : "1px solid rgba(255,255,255,0.10)"
                : "1px solid rgba(255,255,255,0.07)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}>

            {/* Card header — gradient band */}
            <div className="px-5 pt-5 pb-4"
              style={{
                background: isActive
                  ? "linear-gradient(135deg, rgba(0,212,106,0.07) 0%, transparent 100%)"
                  : configured
                    ? "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 100%)"
                    : "transparent",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}>
              <div className="flex items-start justify-between gap-3">
                {/* Score ring + info */}
                <div className="flex items-center gap-3">
                  <AgentScoreRing score={score} isActive={isActive} />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: "var(--text-1)" }}>
                      {inst.name}
                    </p>
                    {agentLoading ? (
                      <div className="h-3 rounded animate-pulse mt-1" style={{ background: "var(--surface-3)", width: 80 }} />
                    ) : configured ? (
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--green)" }}>{agentData.agent_name}</p>
                    ) : (
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-4)" }}>Sem agente</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize"
                        style={{ background: `${channelColor}18`, color: channelColor }}>
                        {inst.channel?.replace("_", " ")}
                      </span>
                      <span className="flex items-center gap-1 text-[10px]" style={{ color: statusColor }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                        {inst.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Active badge clicável — toggle direto via PATCH
                    sem precisar entrar no editor. Mostra "ativar"
                    quando configurado e desativado, "desativar" quando
                    rodando. Exige LLM configurada pra ativar (UX warn). */}
                {configured && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isActive && !hasLLM) {
                        if (!confirm("Sem LLM configurada o agente não responde. Ativar mesmo assim?")) return;
                      }
                      onToggleActive(inst.id, !isActive);
                    }}
                    className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold mt-0.5 transition-all hover:opacity-80"
                    style={{ background: isActive ? "rgba(0,212,106,0.14)" : "rgba(255,255,255,0.06)", color: isActive ? "#00d46a" : "hsl(240 8% 45%)", border: `1px solid ${isActive ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.08)"}`, cursor: "pointer" }}
                    title={isActive ? "Clique para desativar" : "Clique para ativar"}>
                    {isActive ? "● Ativo" : "○ Inativo"}
                  </button>
                )}
              </div>
            </div>

            {/* Card body */}
            <div className="px-5 py-4 flex flex-col gap-3 flex-1">
              {/* Config pills */}
              {configured && (
                <div className="flex flex-wrap gap-1.5">
                  {hasLLM && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(167,139,250,0.10)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.18)" }}>
                      LLM
                    </span>
                  )}
                  {hasRAG && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(96,165,250,0.10)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.18)" }}>
                      RAG
                    </span>
                  )}
                  {totalSkills > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(0,212,106,0.10)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.18)" }}>
                      {totalSkills} skills
                    </span>
                  )}
                </div>
              )}

              {/* Activity bars */}
              <div>
                <p className="text-[9px] uppercase tracking-wider font-medium mb-1.5" style={{ color: "var(--text-4)" }}>
                  Atividade 7d
                </p>
                <AgentActivityBars instanceId={inst.id} isActive={isActive} />
              </div>

              {/* Skill dots */}
              {configured && totalSkills > 0 && (
                <div className="flex items-center gap-2">
                  {SKILL_DOTS.map(dot => (
                    <div key={dot.label} className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: dot.color, opacity: 0.7 }} />
                      <span className="text-[9px]" style={{ color: "var(--text-4)" }}>{dot.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CTA footer */}
            <div className="px-4 pb-4">
              <button
                onClick={() => onEdit(inst.id)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-medium transition-all"
                style={{
                  background: configured ? "rgba(0,212,106,0.10)" : "var(--surface-3)",
                  color: configured ? "var(--green)" : "var(--text-2)",
                  border: `1px solid ${configured ? "rgba(0,212,106,0.20)" : "var(--surface-border)"}`,
                }}>
                <Settings2 className="w-4 h-4" />
                {configured ? "Editar agente" : "Configurar agente"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Voice Studio Tab ────────────────────────────────────────────────────────

type VoiceEntry = {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  category?: string; // "preset" | "clone" | "generated"
  is_active: boolean;
  provider?: { id: string; provider: string; name: string };
};

type ProviderEntry = { id: string; provider: string; name: string; is_active: boolean; masked_key?: string };

function VoiceStudioTab({ wsId, selectedVoiceId, onSelect }: {
  wsId: string;
  selectedVoiceId?: string;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [filterProvider, setFilterProvider] = useState("");
  const [testText, setTestText] = useState("Olá! Eu sou o seu agente de atendimento.");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState<string | null>(null); // providerId

  const providersQuery = useQuery({
    queryKey: ["voice-providers", wsId],
    queryFn: () => voicesApi.listProviders(wsId).then(r => (r.data as ProviderEntry[]) || []),
    enabled: !!wsId,
  });

  const voicesQuery = useQuery({
    queryKey: ["voices", wsId, filterProvider],
    queryFn: () => voicesApi.listVoices(wsId, filterProvider ? { provider_id: filterProvider } : undefined).then(r => (r.data as VoiceEntry[]) || []),
    enabled: !!wsId,
  });

  const syncMutation = useMutation({
    mutationFn: (providerId: string) => voicesApi.syncVoices(wsId, providerId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["voices", wsId] }); toast.success("Vozes sincronizadas."); },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao sincronizar."),
  });

  const testProviderMutation = useMutation({
    mutationFn: (id: string) => voicesApi.testProvider(wsId, id),
    onSuccess: () => toast.success("Conexão OK!"),
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha no teste."),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: (id: string) => voicesApi.deleteProvider(wsId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice-providers", wsId] });
      queryClient.invalidateQueries({ queryKey: ["voices", wsId] });
      toast.success("Provider removido.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Erro ao remover."),
  });

  const deleteVoiceMutation = useMutation({
    mutationFn: (id: string) => voicesApi.deleteVoice(wsId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voices", wsId] });
      toast.success("Voz removida.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Erro ao remover voz."),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => voicesApi.toggleVoice(wsId, id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["voices", wsId] }),
    onError: (e: any) => toast.error(e?.response?.data?.error || "Erro ao alterar voz."),
  });

  const testMutation = useMutation({
    mutationFn: (voiceId: string) => voicesApi.testTTS(wsId, voiceId, testText),
    onSuccess: (res, voiceId) => {
      const blob = new Blob([res.data as ArrayBuffer], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(voiceId);
      audio.play();
      audio.onended = () => setPlayingId(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao gerar áudio."),
  });

  const PROVIDER_LABELS: Record<string, string> = {
    elevenlabs: "ElevenLabs", openai_tts: "OpenAI TTS", qwen_tts: "Qwen TTS",
  };

  const PROVIDER_COLORS: Record<string, string> = {
    elevenlabs: "#f59e0b", openai_tts: "#10b981", qwen_tts: "#6366f1",
  };

  return (
    <>
      {/* Providers */}
      <div className="rounded-3xl p-5 space-y-4" style={glassCardStyle}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium flex items-center gap-2" style={{ color: "var(--text-1)" }}>
              <Volume2 className="w-4 h-4" style={{ color: "var(--green)" }} /> Providers de voz
            </h2>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Configure suas chaves de API para habilitar síntese de voz.</p>
          </div>
          <button
            onClick={() => setShowProviderModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}>
            <Plus className="w-4 h-4" /> Adicionar provider
          </button>
        </div>

        {providersQuery.isLoading && (
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando providers...</p>
        )}

        {!providersQuery.isLoading && !providersQuery.data?.length && (
          <div className="rounded-2xl p-5 text-center" style={{ background: "var(--surface-3)", border: "1px dashed var(--surface-border)" }}>
            <Volume2 className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-3)" }} />
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text-2)" }}>Nenhum provider conectado</p>
            <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>Conecte ElevenLabs (clonagem), OpenAI TTS ou Qwen TTS pra começar.</p>
            <button onClick={() => setShowProviderModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: "var(--green)", color: "#03170a" }}>
              <Plus className="w-4 h-4" /> Conectar provider
            </button>
          </div>
        )}

        {providersQuery.data && providersQuery.data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {providersQuery.data.map((prov) => {
              const color = PROVIDER_COLORS[prov.provider] || "#a78bfa";
              const label = PROVIDER_LABELS[prov.provider] || prov.provider;
              const canClone = prov.provider === "elevenlabs";
              return (
                <div key={prov.id} className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "var(--surface-3)", border: `1px solid ${color}25` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>{label}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${prov.is_active ? "bg-green-500" : "bg-zinc-500"}`} />
                      </div>
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{prov.name}</p>
                      {prov.masked_key && (
                        <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: "var(--text-3)" }}>{prov.masked_key}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => testProviderMutation.mutate(prov.id)} disabled={testProviderMutation.isPending}
                      title="Testar conexão" className="px-2 py-1 rounded-lg text-[11px] inline-flex items-center gap-1"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                      {testProviderMutation.isPending && testProviderMutation.variables === prov.id
                        ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />} Testar
                    </button>
                    <button onClick={() => syncMutation.mutate(prov.id)} disabled={syncMutation.isPending}
                      title="Sincronizar vozes" className="px-2 py-1 rounded-lg text-[11px] inline-flex items-center gap-1"
                      style={{ background: `${color}12`, color, border: `1px solid ${color}25` }}>
                      <RefreshCw className={`w-3 h-3 ${syncMutation.isPending ? "animate-spin" : ""}`} /> Sincronizar
                    </button>
                    {canClone && (
                      <button onClick={() => setShowCloneModal(prov.id)}
                        title="Clonar voz" className="px-2 py-1 rounded-lg text-[11px] inline-flex items-center gap-1"
                        style={{ background: "rgba(168,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(168,139,250,0.25)" }}>
                        <Sparkles className="w-3 h-3" /> Clonar voz
                      </button>
                    )}
                    <button onClick={() => { if (confirm("Remover este provider e todas as vozes vinculadas?")) deleteProviderMutation.mutate(prov.id); }}
                      title="Remover" className="ml-auto p-1.5 rounded-lg"
                      style={{ background: "rgba(239,68,68,0.10)", color: "#f87171", border: "1px solid rgba(239,68,68,0.20)" }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Voice browser */}
      <div className="rounded-3xl p-5 space-y-4" style={glassCardStyle}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Biblioteca de vozes</h2>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>{voicesQuery.data?.length ?? 0} voz(es) disponível(is)</p>
          </div>
          <select
            value={filterProvider}
            onChange={e => setFilterProvider(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm w-full sm:w-52"
            style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}>
            <option value="">Todos os providers</option>
            {providersQuery.data?.map(p => (
              <option key={p.id} value={p.id}>{PROVIDER_LABELS[p.provider] || p.provider} — {p.name}</option>
            ))}
          </select>
        </div>

        {/* Test text input */}
        <div className="flex gap-2">
          <input
            value={testText}
            onChange={e => setTestText(e.target.value)}
            placeholder="Texto para testar a voz..."
            className="flex-1 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
          />
        </div>

        {voicesQuery.isLoading && <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando vozes...</p>}

        {!voicesQuery.isLoading && !voicesQuery.data?.length && (
          <div className="rounded-2xl p-4 text-sm" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
            <p style={{ color: "var(--text-3)" }}>Nenhuma voz encontrada. Adicione um provider e clique em sincronizar.</p>
          </div>
        )}

        {voicesQuery.data && voicesQuery.data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {voicesQuery.data.map((voice) => {
              const isSelected = selectedVoiceId === voice.id;
              const isPlaying = playingId === voice.id;
              const provColor = PROVIDER_COLORS[voice.provider?.provider || ""] || "#a78bfa";
              return (
                <div
                  key={voice.id}
                  className="rounded-2xl p-4 flex flex-col gap-3 transition-all"
                  style={{
                    background: isSelected ? "rgba(0,212,106,0.07)" : "var(--surface-3)",
                    border: `1px solid ${isSelected ? "rgba(0,212,106,0.30)" : "var(--surface-border)"}`,
                    outline: isSelected ? "1px solid rgba(0,212,106,0.20)" : "none",
                  }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: isSelected ? "var(--green)" : "var(--text-1)" }}>{voice.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {voice.provider?.provider && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${provColor}18`, color: provColor }}>
                            {PROVIDER_LABELS[voice.provider.provider] || voice.provider.provider}
                          </span>
                        )}
                        {voice.language && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>{voice.language}</span>}
                        {voice.gender && <span className="text-[10px] px-1.5 py-0.5 rounded-full capitalize" style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>{voice.gender}</span>}
                      </div>
                    </div>
                    {/* Active toggle */}
                    <button
                      onClick={() => toggleMutation.mutate({ id: voice.id, active: !voice.is_active })}
                      className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                      style={{ background: voice.is_active ? "rgba(0,212,106,0.12)" : "var(--surface-2)", border: `1px solid ${voice.is_active ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}` }}
                      title={voice.is_active ? "Desativar" : "Ativar"}>
                      <span className={`w-2 h-2 rounded-full ${voice.is_active ? "bg-green-500" : "bg-zinc-500"}`} />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    {/* Preview */}
                    <button
                      onClick={() => {
                        if (isPlaying) { audioRef.current?.pause(); setPlayingId(null); }
                        else testMutation.mutate(voice.id);
                      }}
                      disabled={testMutation.isPending && !isPlaying}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all"
                      style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.20)" }}>
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {isPlaying ? "Pausar" : "Preview"}
                    </button>
                    {/* Select */}
                    <button
                      onClick={() => onSelect(isSelected ? "" : voice.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all"
                      style={{ background: isSelected ? "rgba(0,212,106,0.14)" : "var(--surface-2)", color: isSelected ? "var(--green)" : "var(--text-2)", border: `1px solid ${isSelected ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}` }}>
                      {isSelected ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                      {isSelected ? "Selecionada" : "Usar"}
                    </button>
                    {/* Delete (apenas vozes clonadas — preset não pode ser
                        apagado, então o botão fica indisponível pra elas
                        sem cluttering a UI). */}
                    {voice.category === "clone" && (
                      <button
                        onClick={() => { if (confirm(`Remover a voz "${voice.name}"? Isso também a apaga no provider.`)) deleteVoiceMutation.mutate(voice.id); }}
                        className="p-2 rounded-xl"
                        title="Remover voz"
                        style={{ background: "rgba(239,68,68,0.10)", color: "#f87171", border: "1px solid rgba(239,68,68,0.20)" }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showProviderModal && (
        <ProviderConnectModal wsId={wsId} onClose={() => setShowProviderModal(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["voice-providers", wsId] });
            setShowProviderModal(false);
          }} />
      )}

      {showCloneModal && (
        <CloneVoiceModal wsId={wsId} providerId={showCloneModal}
          onClose={() => setShowCloneModal(null)}
          onCloned={() => {
            queryClient.invalidateQueries({ queryKey: ["voices", wsId] });
            setShowCloneModal(null);
          }} />
      )}
    </>
  );
}

// ─── Modal: conectar provider ────────────────────────────────────────────────

function ProviderConnectModal({ wsId, onClose, onCreated }: {
  wsId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [provider, setProvider] = useState<"elevenlabs" | "openai_tts" | "qwen_tts">("elevenlabs");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await voicesApi.createProvider(wsId, { provider, name: name.trim() || provider, api_key: apiKey.trim() });
      const created = res.data as ProviderEntry;
      // Test imediato pra validar a key — se falhar, removemos o provider
      // pra evitar deixar credencial inválida salva.
      try {
        await voicesApi.testProvider(wsId, created.id);
        // Sync inicial pra trazer as vozes preset (ElevenLabs/OpenAI/Qwen
        // têm vozes públicas que precisamos listar imediatamente).
        await voicesApi.syncVoices(wsId, created.id);
      } catch (e: any) {
        await voicesApi.deleteProvider(wsId, created.id).catch(() => {});
        throw new Error(e?.response?.data?.error || "Chave inválida — provider removido.");
      }
      return created;
    },
    onSuccess: () => { toast.success("Provider conectado!"); onCreated(); },
    onError: (e: any) => toast.error(e?.message || e?.response?.data?.error || "Erro ao conectar."),
  });

  const PROVIDER_HINTS: Record<string, { label: string; hint: string; href: string }> = {
    elevenlabs: { label: "ElevenLabs", hint: "Inclui Instant Voice Cloning, vozes premium e multilíngue.", href: "https://elevenlabs.io/app/settings/api-keys" },
    openai_tts: { label: "OpenAI TTS", hint: "tts-1 e tts-1-hd com 6 vozes neutras prontas.", href: "https://platform.openai.com/api-keys" },
    qwen_tts:   { label: "Qwen TTS",   hint: "CosyVoice via DashScope (Alibaba) — bom pra mandarim.", href: "https://dashscope.console.aliyun.com/apiKey" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-base font-semibold mb-3" style={{ color: "var(--text-1)" }}>Conectar provider de voz</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--text-2)" }}>Provider</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["elevenlabs", "openai_tts", "qwen_tts"] as const).map((p) => (
                <button key={p} onClick={() => setProvider(p)} type="button"
                  className="px-2 py-2 rounded-xl text-xs font-medium"
                  style={provider === p
                    ? { background: "rgba(0,212,106,0.10)", border: "1px solid rgba(0,212,106,0.30)", color: "var(--green)" }
                    : { background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                  {PROVIDER_HINTS[p].label}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: "var(--text-3)" }}>{PROVIDER_HINTS[provider].hint}</p>
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--text-2)" }}>Apelido (opcional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={PROVIDER_HINTS[provider].label}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
          </div>
          <div>
            <label className="text-xs block mb-1.5 flex items-center justify-between" style={{ color: "var(--text-2)" }}>
              <span>API key *</span>
              <a href={PROVIDER_HINTS[provider].href} target="_blank" rel="noopener noreferrer"
                className="text-[11px] underline" style={{ color: "#a78bfa" }}>
                onde encontro?
              </a>
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_..."
                className="w-full px-3 py-2 pr-10 rounded-xl text-sm outline-none font-mono"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
              <button type="button" onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5 rounded"
                style={{ color: "var(--text-3)" }}>
                {showKey ? "ocultar" : "mostrar"}
              </button>
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              Validamos a chave imediatamente. Se inválida, o provider não será salvo.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text-2)" }}>Cancelar</button>
          <button onClick={() => createMut.mutate()} disabled={!apiKey.trim() || createMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
            style={{ background: "var(--green)", color: "#03170a" }}>
            {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Conectar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: clonar voz (ElevenLabs IVC) ──────────────────────────────────────

function CloneVoiceModal({ wsId, providerId, onClose, onCloned }: {
  wsId: string; providerId: string; onClose: () => void; onCloned: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cloneMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("name", name.trim());
      if (description.trim()) fd.append("description", description.trim());
      for (const f of files) fd.append("files", f);
      return voicesApi.cloneVoice(wsId, providerId, fd);
    },
    onSuccess: () => { toast.success("Voz clonada com sucesso!"); onCloned(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao clonar voz."),
  });

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-base font-semibold mb-1 flex items-center gap-2" style={{ color: "var(--text-1)" }}>
          <Sparkles className="w-4 h-4" style={{ color: "#a78bfa" }} /> Clonar voz (ElevenLabs IVC)
        </h3>
        <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
          Envie 1-2 minutos de áudio limpo (sem ruído de fundo, com a pessoa falando naturalmente). Quanto melhor a qualidade, melhor o clone.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--text-2)" }}>Nome da voz *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: João Comercial"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--text-2)" }}>Descrição (opcional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="Ex: tom amigável, ritmo médio, sotaque paulista"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--text-2)" }}>Áudios de referência *</label>
            <input ref={fileRef} type="file" accept="audio/*" multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="hidden" />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full px-3 py-3 rounded-xl text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)", color: "var(--text-2)" }}>
              <Upload className="w-4 h-4" />
              {files.length === 0 ? "Selecionar áudios (mp3/wav/m4a/ogg)" : `${files.length} arquivo(s) — ${(totalSize / 1024 / 1024).toFixed(1)} MB`}
            </button>
            {files.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {files.map((f, i) => (
                  <li key={i} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-3)" }}>
                    <span className="truncate">{f.name}</span>
                    <span className="font-mono">{(f.size / 1024).toFixed(0)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text-2)" }}>Cancelar</button>
          <button onClick={() => cloneMut.mutate()}
            disabled={!name.trim() || files.length === 0 || cloneMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
            style={{ background: "#a78bfa", color: "#1a1530" }}>
            {cloneMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {cloneMut.isPending ? "Clonando..." : "Clonar voz"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skills Tab (separated for readability) ──────────────────────────────────

function SkillsTab({
  form, setForm, activeSkillNames, toggleSkill,
  skillUploadRef, onUpload, assetsByCategory, deleteAssetMutation, renderListEditor,
}: {
  form: AgentForm;
  setForm: React.Dispatch<React.SetStateAction<AgentForm>>;
  activeSkillNames: Set<string>;
  toggleSkill: (name: string, desc: string) => void;
  skillUploadRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: ChangeEvent<HTMLInputElement>, cat: "knowledge" | "skill") => void;
  assetsByCategory: { knowledge: AgentAsset[]; skill: AgentAsset[] };
  deleteAssetMutation: any;
  renderListEditor: any;
}) {
  const [expandedCat, setExpandedCat] = useState<string | null>("sales");

  return (
    <>
      {/* Catalog header */}
      <div className="rounded-3xl p-5 relative overflow-hidden" style={glassCardStyle}>
        <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
        <div className="flex items-center justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Catálogo de skills</h2>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Ative em um clique — {activeSkillNames.size} de 30+ skills ativas</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}>
            <Sparkles className="w-3.5 h-3.5" />
            {activeSkillNames.size} ativa{activeSkillNames.size !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min((activeSkillNames.size / 30) * 100, 100)}%`, background: "linear-gradient(90deg, #7c3aed, #00d46a)" }} />
        </div>
      </div>

      {/* Skill categories */}
      <div className="space-y-3">
        {SKILL_CATEGORIES.map((cat) => {
          const isExpanded = expandedCat === cat.id;
          const activeInCat = cat.skills.filter((s) => activeSkillNames.has(s.name)).length;
          return (
            <div key={cat.id} className="rounded-3xl overflow-hidden relative" style={glassCardStyle}>
              <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent)" }} />
              <button
                onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left transition-all"
                style={{ borderBottom: isExpanded ? "1px solid rgba(255,255,255,0.06)" : undefined }}>
                <span className="text-xl">{cat.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{cat.label}</p>
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>{cat.skills.length} skills · {activeInCat} ativa{activeInCat !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeInCat > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}30` }}>
                      {activeInCat}/{cat.skills.length}
                    </span>
                  )}
                  {isExpanded ? <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronRight className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
                </div>
              </button>

              {isExpanded && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                  {cat.skills.map((skill) => {
                    const active = activeSkillNames.has(skill.name);
                    return (
                      <button
                        key={skill.name}
                        onClick={() => toggleSkill(skill.name, skill.description)}
                        className={cn("text-left rounded-2xl p-4 transition-all hover:scale-[1.01]")}
                        style={{
                          background: active ? `${cat.color}10` : "var(--surface-3)",
                          border: `1px solid ${active ? cat.color + "40" : "var(--surface-border)"}`,
                          outline: active ? `1px solid ${cat.color}60` : "none",
                        }}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-sm font-semibold leading-tight" style={{ color: active ? cat.color : "var(--text-1)" }}>{skill.name}</p>
                          <div className={cn("w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors", active ? "opacity-100" : "opacity-0")}>
                            <CheckCircle2 className="w-4 h-4" style={{ color: cat.color }} />
                          </div>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>{skill.description}</p>
                        <div className="mt-2 text-[10px] font-medium px-2 py-0.5 rounded-full inline-block"
                          style={{ background: active ? `${cat.color}20` : "var(--surface-2)", color: active ? cat.color : "var(--text-3)" }}>
                          {active ? "Ativa" : "Adicionar"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom skills */}
      <div className="rounded-3xl p-5 relative overflow-hidden" style={glassCardStyle}>
        <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>Skills customizadas</h2>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Crie skills em Markdown ou registre capacidades manuais.</p>
          </div>
          <div>
            <input ref={skillUploadRef} type="file" accept=".md,.txt" hidden onChange={(e) => onUpload(e, "skill")} />
            <button onClick={() => skillUploadRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.18)", color: "#60a5fa" }}>
              <Upload className="w-4 h-4" /> Upload .md
            </button>
          </div>
        </div>

        {renderListEditor(
          form.skills,
          () => setForm((p) => ({ ...p, skills: [...p.skills, { id: uid(), name: "", type: "custom", description: "", enabled: true }] })),
          (item: any, index: number) => (
            <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 p-3 rounded-2xl mb-3" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
              <div className="space-y-2">
                <input value={item.name} onChange={(e) => setForm((p) => ({ ...p, skills: p.skills.map((r, i) => i === index ? { ...r, name: e.target.value } : r) }))} placeholder="Nome da skill" style={inp()} />
                <textarea value={item.description} onChange={(e) => setForm((p) => ({ ...p, skills: p.skills.map((r, i) => i === index ? { ...r, description: e.target.value } : r) }))} placeholder="O que essa skill faz" style={inp(true)} />
              </div>
              <div className="space-y-2">
                <input value={item.type} onChange={(e) => setForm((p) => ({ ...p, skills: p.skills.map((r, i) => i === index ? { ...r, type: e.target.value } : r) }))} placeholder="preset, custom, integration..." style={inp()} />
                <label className="flex items-center gap-2 text-sm px-3 py-3 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                  <input type="checkbox" checked={item.enabled} onChange={(e) => setForm((p) => ({ ...p, skills: p.skills.map((r, i) => i === index ? { ...r, enabled: e.target.checked } : r) }))} />
                  Habilitada
                </label>
              </div>
              <button onClick={() => setForm((p) => ({ ...p, skills: p.skills.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}><Trash2 className="w-4 h-4" /></button>
            </div>
          ),
        )}

        {assetsByCategory.skill.length > 0 && (
          <div className="mt-5 space-y-3">
            <h3 className="font-medium" style={{ color: "var(--text-1)" }}>Arquivos de skill</h3>
            {assetsByCategory.skill.map((asset) => (
              <div key={asset.id} className="rounded-2xl p-4 flex items-start justify-between gap-3" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                <div>
                  <p className="font-medium" style={{ color: "var(--text-1)" }}>{asset.file_name}</p>
                  <p className="text-sm" style={{ color: "var(--text-3)" }}>{asset.extracted_text?.slice(0, 220) || "Arquivo anexado ao agente."}</p>
                </div>
                <button onClick={() => deleteAssetMutation.mutate(asset.id)} className="px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skills summary */}
      {activeSkillNames.size > 0 && (
        <div className="rounded-3xl p-5" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4" style={{ color: "#a78bfa" }} />
            <h3 className="text-sm font-semibold" style={{ color: "#a78bfa" }}>Skills ativas neste agente</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {form.skills.filter((s) => s.enabled).map((s) => (
              <span key={s.id} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
