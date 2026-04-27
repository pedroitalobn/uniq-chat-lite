"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Brain, Globe, Link2, Mic2, Plus,
  Save, Shield, Sparkles, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { instancesApi, integrationsApi } from "@/lib/api";

type TabId = "personality" | "knowledge" | "skills" | "access";

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
  voice: {
    provider?: string;
    voice?: string;
    stability: number;
    similarity: number;
    style: number;
    speed: number;
  };
  skills: Array<{ id: string; name: string; type: string; description: string; enabled: boolean }>;
  app_access: Array<{ id: string; name: string; type: string; target: string; description: string; enabled: boolean }>;
  rag_enabled: boolean;
  is_active: boolean;
  webhook_url: string;
  webhook_secret: string;
  mcp_server_url: string;
  compiled_prompt: string;
  assets: AgentAsset[];
};

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType; description: string }> = [
  { id: "personality", label: "Personality", icon: Bot, description: "Identidade, voz e atendimento" },
  { id: "knowledge", label: "Knowledge", icon: Brain, description: "Base, FAQ e documentos" },
  { id: "skills", label: "Skills", icon: Sparkles, description: "Capacidades prontas e markdown" },
  { id: "access", label: "Access", icon: Globe, description: "LLM, MCP, apps e integrações" },
];

const PRESET_SKILLS = [
  { name: "Lead Qualifier", type: "preset", description: "Qualifica intenção, estágio e urgência antes de ofertar." },
  { name: "Agenda Assistant", type: "preset", description: "Ajuda a conduzir para agendamento e próximos passos." },
  { name: "Gmail Copilot", type: "preset", description: "Prepara respostas e resumos para fluxos conectados ao Gmail." },
  { name: "FAQ Resolver", type: "preset", description: "Prioriza respostas curtas, claras e consistentes." },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyForm(): AgentForm {
  return {
    integration_id: "",
    model: "",
    system_prompt: "",
    agent_name: "",
    identity: "",
    objective: "",
    communication_guidelines: "",
    service_instructions: "",
    restrictions: "",
    knowledge_base: "",
    faq: [],
    variables: [],
    voice: {
      provider: "",
      voice: "",
      stability: 0.5,
      similarity: 0.7,
      style: 0.5,
      speed: 1,
    },
    skills: [],
    app_access: [],
    rag_enabled: true,
    is_active: false,
    webhook_url: "",
    webhook_secret: "",
    mcp_server_url: "",
    compiled_prompt: "",
    assets: [],
  };
}

function parseJSONArray<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
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
    faq: parseJSONArray(data?.faq, []).map((item: any) => ({
      id: item.id || uid(),
      question: item.question || "",
      answer: item.answer || "",
    })),
    variables: parseJSONArray(data?.variables, []).map((item: any) => ({
      id: item.id || uid(),
      key: item.key || "",
      value: item.value || "",
      description: item.description || "",
    })),
    voice: {
      ...form.voice,
      ...(typeof data?.voice === "string" ? parseJSONArray(data.voice, {}) : data?.voice || {}),
    },
    skills: parseJSONArray(data?.skills, []).map((item: any) => ({
      id: item.id || uid(),
      name: item.name || "",
      type: item.type || "custom",
      description: item.description || "",
      enabled: item.enabled !== false,
    })),
    app_access: parseJSONArray(data?.app_access, []).map((item: any) => ({
      id: item.id || uid(),
      name: item.name || "",
      type: item.type || "mcp",
      target: item.target || "",
      description: item.description || "",
      enabled: item.enabled !== false,
    })),
    rag_enabled: data?.rag_enabled ?? true,
    is_active: data?.is_active ?? false,
    webhook_url: data?.webhook_url || "",
    webhook_secret: data?.webhook_secret || "",
    mcp_server_url: data?.mcp_server_url || "",
    compiled_prompt: data?.compiled_prompt || "",
    assets: data?.assets || [],
  };
}

function cardStyle(emphasis = false): CSSProperties {
  return {
    background: emphasis ? "linear-gradient(180deg, rgba(0,212,106,0.08), var(--border-subtle))" : "var(--surface-2)",
    border: `1px solid ${emphasis ? "rgba(0,212,106,0.18)" : "var(--surface-border)"}`,
  };
}

function inputStyle(multiline = false): CSSProperties {
  return {
    width: "100%",
    borderRadius: 14,
    border: "1px solid var(--surface-border)",
    background: "var(--surface-3)",
    color: "var(--text-1)",
    padding: multiline ? "12px 14px" : "11px 14px",
    fontSize: 14,
    minHeight: multiline ? 120 : undefined,
  };
}

export default function AgentPersonalityPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("personality");
  const [selectedInstance, setSelectedInstance] = useState("");
  const [form, setForm] = useState<AgentForm>(emptyForm());
  const knowledgeUploadRef = useRef<HTMLInputElement | null>(null);
  const skillUploadRef = useRef<HTMLInputElement | null>(null);

  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: async () => {
      const res = await instancesApi.list();
      return res.data || [];
    },
  });

  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await integrationsApi.list();
      return res.data || [];
    },
  });

  useEffect(() => {
    if (!selectedInstance && instancesQuery.data?.length) {
      setSelectedInstance(instancesQuery.data[0].id);
    }
  }, [instancesQuery.data, selectedInstance]);

  const agentQuery = useQuery({
    queryKey: ["instance-agent", selectedInstance],
    queryFn: async () => {
      const res = await integrationsApi.getAgent(selectedInstance);
      return res.data;
    },
    enabled: !!selectedInstance,
  });

  useEffect(() => {
    if (agentQuery.data) {
      setForm(mapAgent(agentQuery.data));
    } else if (selectedInstance) {
      setForm(emptyForm());
    }
  }, [agentQuery.data, selectedInstance]);

  const selectedIntegration = useMemo(
    () => integrationsQuery.data?.find((item: any) => item.id === form.integration_id),
    [integrationsQuery.data, form.integration_id],
  );
  const selectedIntegrationModels = useMemo(() => {
    const raw = selectedIntegration?.models;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [selectedIntegration]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInstance) return;
      await integrationsApi.updateAgent(selectedInstance, {
        integration_id: form.integration_id || null,
        model: form.model,
        system_prompt: form.system_prompt,
        agent_name: form.agent_name,
        identity: form.identity,
        objective: form.objective,
        communication_guidelines: form.communication_guidelines,
        service_instructions: form.service_instructions,
        restrictions: form.restrictions,
        knowledge_base: form.knowledge_base,
        faq: form.faq,
        variables: form.variables,
        voice: form.voice,
        skills: form.skills,
        app_access: form.app_access,
        rag_enabled: form.rag_enabled,
        is_active: form.is_active,
        webhook_url: form.webhook_url,
        webhook_secret: form.webhook_secret,
        mcp_server_url: form.mcp_server_url,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instance-agent", selectedInstance] });
      toast.success("Personalidade do agente salva.");
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Não foi possível salvar o agente.");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, category }: { file: File; category: "knowledge" | "skill" }) => {
      if (!selectedInstance) return;
      await integrationsApi.uploadAgentAsset(selectedInstance, file, category);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instance-agent", selectedInstance] });
      toast.success("Arquivo adicionado ao agente.");
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Falha ao enviar arquivo.");
    },
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
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Falha ao remover arquivo.");
    },
  });

  const assetsByCategory = useMemo(() => {
    const knowledge = form.assets.filter((item) => item.category === "knowledge");
    const skill = form.assets.filter((item) => item.category === "skill");
    return { knowledge, skill };
  }, [form.assets]);

  const applyMarinaPreset = () => {
    setForm((prev) => ({
      ...prev,
      is_active: true,
      agent_name: "Marina",
      identity:
        "Você é Marina, assistente virtual de Julia Viscardi, profissional que integra nutrição, mentoria, terapia integrativa e expansão de consciência. Sua identidade deve refletir acolhimento, profundidade, ética, clareza e foco em transformação consciente.",
      objective:
        "Atuar como ponto inicial de contato, educar o público, qualificar leads com sensibilidade, direcionar para o serviço mais adequado e incentivar o próximo passo com sutileza e profissionalismo.",
      communication_guidelines:
        "Mantenha um tom acolhedor, empático, claro, inspirador, respeitoso e integrativo. Evite jargões sem explicação, não julgue, não faça promessas irreais e sempre reconecte a conversa com essência, comportamento, emoção e corpo.",
      service_instructions:
        "No primeiro contato, apresente-se como assistente virtual de Julia Viscardi. Antes de ofertar valores, faça perguntas abertas para entender momento, dor, objetivo e contexto. Depois apresente o serviço mais adequado, esclareça dúvidas e conduza para o próximo passo com CTA suave.",
      restrictions:
        "Não forneça aconselhamento médico ou nutricional direto. Não diagnostique. Não garanta resultados. Não solicite dados sensíveis. Não processe pagamentos. Não se apresente como Julia. Não entre em debates. Não envie valores antes de qualificar o lead.",
      knowledge_base:
        "Julia Viscardi atua com desenvolvimento pessoal, emocional e comportamental, integrando TCC, Constelação Familiar, ThetaHealing e Access Consciousness. Serviços: Mentoria, Sessões Terapêuticas Integrativas, Acompanhamento Nutricional Integrativo, Formação em Barras de Access e Desafio R4.",
      faq: [
        { id: uid(), question: "Como funciona o primeiro atendimento?", answer: "Marina acolhe, entende a necessidade principal, qualifica o momento da pessoa e então orienta o próximo passo com Julia." },
        { id: uid(), question: "Vocês passam valores logo no início?", answer: "Não. Primeiro entendemos a necessidade e o momento da pessoa para indicar o serviço mais adequado antes de falar de investimento." },
      ],
      variables: [
        { id: uid(), key: "nome_cliente", value: "", description: "Nome informado pelo lead." },
        { id: uid(), key: "principal_dor", value: "", description: "Dor, bloqueio ou objetivo identificado na qualificação." },
      ],
      voice: {
        provider: prev.voice.provider || "",
        voice: prev.voice.voice || "",
        stability: 0.5,
        similarity: 0.7,
        style: 0.5,
        speed: 1,
      },
      skills: [
        { id: uid(), name: "Lead Qualifier", type: "preset", description: "Qualifica sem pressionar e organiza intenção, fase e urgência.", enabled: true },
        { id: uid(), name: "FAQ Resolver", type: "preset", description: "Responde perguntas recorrentes mantendo consistência e tom acolhedor.", enabled: true },
      ],
    }));
    toast.success("Preset Marina aplicado no formulário.");
  };

  const onUpload = (event: ChangeEvent<HTMLInputElement>, category: "knowledge" | "skill") => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate({ file, category });
    event.target.value = "";
  };

  const renderListEditor = (
    items: Array<any>,
    onAdd: () => void,
    renderItem: (item: any, index: number) => React.ReactNode,
  ) => (
    <div className="space-y-3">
      {items.map(renderItem)}
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
        style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}
      >
        <Plus className="w-4 h-4" />
        Adicionar
      </button>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2 sm:gap-3" style={{ color: "var(--text-1)" }}>
            <Bot className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: "var(--green)" }} />
            Agentes
          </h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--text-3)" }}>
            Personalidade, voz, base de conhecimento e skills de cada instância — atribua um agente a quem responde.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={applyMarinaPreset}
            className="px-3 py-2 rounded-xl text-xs sm:text-sm font-medium"
            style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.18)", color: "#c084fc" }}
          >
            Aplicar exemplo Marina
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!selectedInstance || saveMutation.isPending}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold"
            style={{ background: "var(--green)", color: "#06210f", opacity: saveMutation.isPending ? 0.7 : 1 }}
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? "Salvando..." : "Salvar agente"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-5">
        <aside className="space-y-4">
          <div className="rounded-3xl p-4" style={cardStyle(true)}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-3)" }}>
              Instância
            </p>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="w-full rounded-xl px-3 py-3 text-sm"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            >
              {instancesQuery.data?.map((instance: any) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} · {instance.channel}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
              <div className="rounded-2xl p-3" style={cardStyle()}>
                <p style={{ color: "var(--text-3)" }}>RAG</p>
                <strong style={{ color: "var(--text-1)" }}>{form.rag_enabled ? "Ligado" : "Desligado"}</strong>
              </div>
              <div className="rounded-2xl p-3" style={cardStyle()}>
                <p style={{ color: "var(--text-3)" }}>Status</p>
                <strong style={{ color: form.is_active ? "var(--green)" : "var(--text-1)" }}>{form.is_active ? "Ativo" : "Inativo"}</strong>
              </div>
            </div>
          </div>

          <nav className="rounded-3xl overflow-hidden" style={cardStyle()}>
            {TABS.map((item, index) => {
              const active = tab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left"
                  style={{
                    borderBottom: index < TABS.length - 1 ? "1px solid var(--surface-border)" : undefined,
                    background: active ? "rgba(0,212,106,0.08)" : "transparent",
                  }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: active ? "rgba(0,212,106,0.14)" : "var(--surface-3)" }}>
                    <Icon className="w-4 h-4" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>{item.label}</p>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>{item.description}</p>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="space-y-5">
          {tab === "personality" && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-5 space-y-4" style={cardStyle()}>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Identidade</h2>
                  <input
                    value={form.agent_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, agent_name: e.target.value }))}
                    placeholder="Nome do agente"
                    style={inputStyle()}
                  />
                  <textarea
                    value={form.identity}
                    onChange={(e) => setForm((prev) => ({ ...prev, identity: e.target.value }))}
                    placeholder="Quem esse agente é e o que ele representa?"
                    style={inputStyle(true)}
                  />
                  <textarea
                    value={form.objective}
                    onChange={(e) => setForm((prev) => ({ ...prev, objective: e.target.value }))}
                    placeholder="Objetivo principal"
                    style={inputStyle(true)}
                  />
                </div>

                <div className="rounded-3xl p-5 space-y-4" style={cardStyle()}>
                  <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                    <Mic2 className="w-4 h-4" style={{ color: "var(--green)" }} />
                    Voz configurada
                  </h2>
                  <input
                    value={form.voice.voice || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, voice: { ...prev.voice, voice: e.target.value } }))}
                    placeholder="Ex.: marina-br"
                    style={inputStyle()}
                  />
                  <input
                    value={form.voice.provider || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, voice: { ...prev.voice, provider: e.target.value } }))}
                    placeholder="Provider de voz"
                    style={inputStyle()}
                  />
                  {[
                    ["stability", "Estabilidade", 0, 1, 0.1],
                    ["similarity", "Similaridade", 0, 1, 0.1],
                    ["style", "Sotaque / estilo", 0, 1, 0.1],
                    ["speed", "Velocidade", 0.7, 1.2, 0.1],
                  ].map(([key, label, min, max, step]) => (
                    <label key={key} className="block text-sm" style={{ color: "var(--text-2)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span>{label}</span>
                        <strong style={{ color: "var(--text-1)" }}>{(form.voice as any)[key]}</strong>
                      </div>
                      <input
                        type="range"
                        min={Number(min)}
                        max={Number(max)}
                        step={Number(step)}
                        value={(form.voice as any)[key]}
                        onChange={(e) => setForm((prev) => ({ ...prev, voice: { ...prev.voice, [key]: Number(e.target.value) } }))}
                        className="w-full"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl p-5 space-y-4" style={cardStyle()}>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Diretrizes e atendimento</h2>
                <textarea
                  value={form.communication_guidelines}
                  onChange={(e) => setForm((prev) => ({ ...prev, communication_guidelines: e.target.value }))}
                  placeholder="Tom, postura, estilo de resposta, linguagem..."
                  style={inputStyle(true)}
                />
                <textarea
                  value={form.service_instructions}
                  onChange={(e) => setForm((prev) => ({ ...prev, service_instructions: e.target.value }))}
                  placeholder="Fluxo de atendimento, qualificação, CTA e encerramento..."
                  style={inputStyle(true)}
                />
                <textarea
                  value={form.restrictions}
                  onChange={(e) => setForm((prev) => ({ ...prev, restrictions: e.target.value }))}
                  placeholder="Restrições operacionais, legais e de segurança..."
                  style={inputStyle(true)}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-5" style={cardStyle()}>
                  <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-1)" }}>Variáveis</h2>
                  {renderListEditor(
                    form.variables,
                    () => setForm((prev) => ({ ...prev, variables: [...prev.variables, { id: uid(), key: "", value: "", description: "" }] })),
                    (item, index) => (
                      <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 p-3 rounded-2xl" style={cardStyle()}>
                        <div className="space-y-2">
                          <input value={item.key} onChange={(e) => setForm((prev) => ({ ...prev, variables: prev.variables.map((row, i) => i === index ? { ...row, key: e.target.value } : row) }))} placeholder="Chave" style={inputStyle()} />
                          <input value={item.value} onChange={(e) => setForm((prev) => ({ ...prev, variables: prev.variables.map((row, i) => i === index ? { ...row, value: e.target.value } : row) }))} placeholder="Valor padrão" style={inputStyle()} />
                        </div>
                        <textarea value={item.description} onChange={(e) => setForm((prev) => ({ ...prev, variables: prev.variables.map((row, i) => i === index ? { ...row, description: e.target.value } : row) }))} placeholder="Descrição" style={inputStyle(true)} />
                        <button onClick={() => setForm((prev) => ({ ...prev, variables: prev.variables.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ),
                  )}
                </div>

                <div className="rounded-3xl p-5" style={cardStyle()}>
                  <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-1)" }}>Prompt compilado</h2>
                  <textarea readOnly value={form.compiled_prompt} style={{ ...inputStyle(true), minHeight: 360, opacity: 0.85 }} />
                </div>
              </div>
            </>
          )}

          {tab === "knowledge" && (
            <>
              <div className="rounded-3xl p-5 space-y-4" style={cardStyle()}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Base de conhecimento manual</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Informações centrais que o agente deve usar como fonte primária.</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-2)" }}>
                    <input type="checkbox" checked={form.rag_enabled} onChange={(e) => setForm((prev) => ({ ...prev, rag_enabled: e.target.checked }))} />
                    Habilitar RAG
                  </label>
                </div>
                <textarea
                  value={form.knowledge_base}
                  onChange={(e) => setForm((prev) => ({ ...prev, knowledge_base: e.target.value }))}
                  placeholder="Descreva serviços, políticas, visão de marca, diferenciais, processos, objeções, preços e regras internas..."
                  style={{ ...inputStyle(true), minHeight: 240 }}
                />
              </div>

              <div className="rounded-3xl p-5" style={cardStyle()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>FAQ personalizado</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Perguntas frequentes e respostas aprovadas.</p>
                  </div>
                </div>
                {renderListEditor(
                  form.faq,
                  () => setForm((prev) => ({ ...prev, faq: [...prev.faq, { id: uid(), question: "", answer: "" }] })),
                  (item, index) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 p-3 rounded-2xl mb-3" style={cardStyle()}>
                      <div className="space-y-2">
                        <input value={item.question} onChange={(e) => setForm((prev) => ({ ...prev, faq: prev.faq.map((row, i) => i === index ? { ...row, question: e.target.value } : row) }))} placeholder="Pergunta" style={inputStyle()} />
                        <textarea value={item.answer} onChange={(e) => setForm((prev) => ({ ...prev, faq: prev.faq.map((row, i) => i === index ? { ...row, answer: e.target.value } : row) }))} placeholder="Resposta" style={inputStyle(true)} />
                      </div>
                      <button onClick={() => setForm((prev) => ({ ...prev, faq: prev.faq.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ),
                )}
              </div>

              <div className="rounded-3xl p-5" style={cardStyle()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Documentos e arquivos</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Upload para RAG e referência do agente. Suporta `json`, `txt`, `doc`, `docx`, `pdf` e `pptx`.</p>
                  </div>
                  <div>
                    <input ref={knowledgeUploadRef} type="file" hidden onChange={(e) => onUpload(e, "knowledge")} />
                    <button onClick={() => knowledgeUploadRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}>
                      <Upload className="w-4 h-4" />
                      Enviar arquivo
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {assetsByCategory.knowledge.length === 0 && (
                    <div className="rounded-2xl p-4 text-sm" style={cardStyle()}>
                      Nenhum arquivo anexado ainda.
                    </div>
                  )}
                  {assetsByCategory.knowledge.map((asset) => (
                    <div key={asset.id} className="rounded-2xl p-4 flex items-start justify-between gap-4" style={cardStyle()}>
                      <div className="min-w-0">
                        <p className="font-medium truncate" style={{ color: "var(--text-1)" }}>{asset.name || asset.file_name}</p>
                        <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>{asset.file_name} · {Math.round(asset.size_bytes / 1024)} KB</p>
                        {asset.extracted_text && (
                          <p className="text-xs mt-2 line-clamp-3" style={{ color: "var(--text-2)" }}>{asset.extracted_text}</p>
                        )}
                      </div>
                      <button onClick={() => deleteAssetMutation.mutate(asset.id)} className="px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "skills" && (
            <>
              <div className="rounded-3xl p-5" style={cardStyle()}>
                <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-1)" }}>Skills prontas</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PRESET_SKILLS.map((skill) => {
                    const enabled = form.skills.some((item) => item.name === skill.name && item.enabled);
                    return (
                      <button
                        key={skill.name}
                        onClick={() =>
                          setForm((prev) => {
                            const existing = prev.skills.find((item) => item.name === skill.name);
                            if (existing) {
                              return {
                                ...prev,
                                skills: prev.skills.map((item) => item.name === skill.name ? { ...item, enabled: !item.enabled } : item),
                              };
                            }
                            return {
                              ...prev,
                              skills: [...prev.skills, { id: uid(), ...skill, enabled: true }],
                            };
                          })
                        }
                        className="text-left rounded-2xl p-4 transition-transform hover:scale-[1.01]"
                        style={{
                          ...cardStyle(enabled),
                          boxShadow: enabled ? "inset 0 0 0 1px rgba(0,212,106,0.16)" : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold" style={{ color: enabled ? "var(--green)" : "var(--text-1)" }}>{skill.name}</p>
                          <span className="text-xs px-2 py-1 rounded-full" style={{ background: enabled ? "rgba(0,212,106,0.12)" : "var(--surface-3)", color: enabled ? "var(--green)" : "var(--text-3)" }}>
                            {enabled ? "Ativa" : "Adicionar"}
                          </span>
                        </div>
                        <p className="text-sm mt-2" style={{ color: "var(--text-3)" }}>{skill.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl p-5" style={cardStyle()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Skills customizadas</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Você pode subir arquivos `.md` como skill ou registrar capacidades manuais.</p>
                  </div>
                  <div>
                    <input ref={skillUploadRef} type="file" accept=".md,.txt" hidden onChange={(e) => onUpload(e, "skill")} />
                    <button onClick={() => skillUploadRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.18)", color: "#60a5fa" }}>
                      <Upload className="w-4 h-4" />
                      Upload .md
                    </button>
                  </div>
                </div>

                {renderListEditor(
                  form.skills,
                  () => setForm((prev) => ({ ...prev, skills: [...prev.skills, { id: uid(), name: "", type: "custom", description: "", enabled: true }] })),
                  (item, index) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 p-3 rounded-2xl mb-3" style={cardStyle()}>
                      <div className="space-y-2">
                        <input value={item.name} onChange={(e) => setForm((prev) => ({ ...prev, skills: prev.skills.map((row, i) => i === index ? { ...row, name: e.target.value } : row) }))} placeholder="Nome da skill" style={inputStyle()} />
                        <textarea value={item.description} onChange={(e) => setForm((prev) => ({ ...prev, skills: prev.skills.map((row, i) => i === index ? { ...row, description: e.target.value } : row) }))} placeholder="O que essa skill faz" style={inputStyle(true)} />
                      </div>
                      <div className="space-y-2">
                        <input value={item.type} onChange={(e) => setForm((prev) => ({ ...prev, skills: prev.skills.map((row, i) => i === index ? { ...row, type: e.target.value } : row) }))} placeholder="preset, custom, integration..." style={inputStyle()} />
                        <label className="flex items-center gap-2 text-sm px-3 py-3 rounded-xl" style={{ ...cardStyle(), color: "var(--text-2)" }}>
                          <input type="checkbox" checked={item.enabled} onChange={(e) => setForm((prev) => ({ ...prev, skills: prev.skills.map((row, i) => i === index ? { ...row, enabled: e.target.checked } : row) }))} />
                          Habilitada
                        </label>
                      </div>
                      <button onClick={() => setForm((prev) => ({ ...prev, skills: prev.skills.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ),
                )}

                {assetsByCategory.skill.length > 0 && (
                  <div className="mt-5 space-y-3">
                    <h3 className="font-medium" style={{ color: "var(--text-1)" }}>Arquivos de skill</h3>
                    {assetsByCategory.skill.map((asset) => (
                      <div key={asset.id} className="rounded-2xl p-4 flex items-start justify-between gap-3" style={cardStyle()}>
                        <div>
                          <p className="font-medium" style={{ color: "var(--text-1)" }}>{asset.file_name}</p>
                          <p className="text-sm" style={{ color: "var(--text-3)" }}>{asset.extracted_text?.slice(0, 220) || "Arquivo anexado ao agente."}</p>
                        </div>
                        <button onClick={() => deleteAssetMutation.mutate(asset.id)} className="px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "access" && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-5 space-y-4" style={cardStyle()}>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>LLM e ativação</h2>
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-2)" }}>
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                    Ativar agente nesta instância
                  </label>
                  <select value={form.integration_id} onChange={(e) => setForm((prev) => ({ ...prev, integration_id: e.target.value, model: "" }))} style={inputStyle()}>
                    <option value="">Selecione uma integração de IA</option>
                    {integrationsQuery.data?.map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.provider}
                      </option>
                    ))}
                  </select>
                  <input
                    value={form.model}
                    onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                    placeholder={selectedIntegrationModels[0] ? `Modelo sugerido: ${selectedIntegrationModels[0]}` : "Modelo a usar nesta instância"}
                    style={inputStyle()}
                  />
                  <textarea
                    value={form.system_prompt}
                    onChange={(e) => setForm((prev) => ({ ...prev, system_prompt: e.target.value }))}
                    placeholder="Prompt base adicional para a LLM"
                    style={inputStyle(true)}
                  />
                </div>

                <div className="rounded-3xl p-5 space-y-4" style={cardStyle()}>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Integrações operacionais</h2>
                  <input value={form.mcp_server_url} onChange={(e) => setForm((prev) => ({ ...prev, mcp_server_url: e.target.value }))} placeholder="MCP server URL" style={inputStyle()} />
                  <input value={form.webhook_url} onChange={(e) => setForm((prev) => ({ ...prev, webhook_url: e.target.value }))} placeholder="Webhook URL opcional" style={inputStyle()} />
                  <input value={form.webhook_secret} onChange={(e) => setForm((prev) => ({ ...prev, webhook_secret: e.target.value }))} placeholder="Webhook secret opcional" style={inputStyle()} />
                  <div className="rounded-2xl p-4 text-sm" style={cardStyle()}>
                    <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-1)" }}>
                      <Shield className="w-4 h-4" />
                      Recomendação
                    </div>
                    <p style={{ color: "var(--text-3)" }}>
                      Use `integration_id + model` para a LLM, `mcp_server_url` para apps e ferramentas, e o webhook apenas quando precisar delegar execução externa.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl p-5" style={cardStyle()}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Apps e acessos disponíveis</h2>
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Cadastre apps que o agente pode usar via MCP, integração, OAuth, API ou webhook.</p>
                  </div>
                </div>

                {renderListEditor(
                  form.app_access,
                  () => setForm((prev) => ({ ...prev, app_access: [...prev.app_access, { id: uid(), name: "", type: "mcp", target: "", description: "", enabled: true }] })),
                  (item, index) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_180px_1fr_auto] gap-3 p-3 rounded-2xl mb-3" style={cardStyle()}>
                      <div className="space-y-2">
                        <input value={item.name} onChange={(e) => setForm((prev) => ({ ...prev, app_access: prev.app_access.map((row, i) => i === index ? { ...row, name: e.target.value } : row) }))} placeholder="Nome do app" style={inputStyle()} />
                        <textarea value={item.description} onChange={(e) => setForm((prev) => ({ ...prev, app_access: prev.app_access.map((row, i) => i === index ? { ...row, description: e.target.value } : row) }))} placeholder="O que o agente pode fazer com esse app" style={inputStyle(true)} />
                      </div>
                      <div className="space-y-2">
                        <input value={item.type} onChange={(e) => setForm((prev) => ({ ...prev, app_access: prev.app_access.map((row, i) => i === index ? { ...row, type: e.target.value } : row) }))} placeholder="mcp, integration, oauth..." style={inputStyle()} />
                        <label className="flex items-center gap-2 text-sm px-3 py-3 rounded-xl" style={{ ...cardStyle(), color: "var(--text-2)" }}>
                          <input type="checkbox" checked={item.enabled} onChange={(e) => setForm((prev) => ({ ...prev, app_access: prev.app_access.map((row, i) => i === index ? { ...row, enabled: e.target.checked } : row) }))} />
                          Disponível
                        </label>
                      </div>
                      <input value={item.target} onChange={(e) => setForm((prev) => ({ ...prev, app_access: prev.app_access.map((row, i) => i === index ? { ...row, target: e.target.value } : row) }))} placeholder="URL, app id, connector, server..." style={inputStyle()} />
                      <button onClick={() => setForm((prev) => ({ ...prev, app_access: prev.app_access.filter((_, i) => i !== index) }))} className="h-11 px-3 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ),
                )}
              </div>

              <div className="rounded-3xl p-5" style={cardStyle()}>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                  <Link2 className="w-4 h-4" style={{ color: "var(--green)" }} />
                  Resumo técnico
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl p-4" style={cardStyle()}>
                    <p style={{ color: "var(--text-3)" }}>LLM</p>
                    <strong style={{ color: "var(--text-1)" }}>{selectedIntegration?.name || "Não definida"}</strong>
                  </div>
                  <div className="rounded-2xl p-4" style={cardStyle()}>
                    <p style={{ color: "var(--text-3)" }}>Modelo</p>
                    <strong style={{ color: "var(--text-1)" }}>{form.model || "Padrão do provider"}</strong>
                  </div>
                  <div className="rounded-2xl p-4" style={cardStyle()}>
                    <p style={{ color: "var(--text-3)" }}>Apps disponíveis</p>
                    <strong style={{ color: "var(--text-1)" }}>{form.app_access.filter((item) => item.enabled).length}</strong>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
