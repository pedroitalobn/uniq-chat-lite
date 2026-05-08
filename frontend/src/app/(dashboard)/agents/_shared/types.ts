// Tipos e helpers compartilhados entre o editor antigo (/agents/page.tsx)
// e o novo Studio (/agents/[instanceId]/[agentId]). Mantemos um único
// shape de AgentForm pra que dados carregados/salvos por uma tela
// sejam compatíveis com a outra durante a migração.

export type AgentAsset = {
  id: string;
  category: "knowledge" | "faq" | "skill";
  name: string;
  file_name: string;
  content_type?: string;
  size_bytes: number;
  extracted_text?: string;
  created_at: string;
};

export type AgentForm = {
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
    workspace_voice_id?: string;
    audio_enabled?: boolean;
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
  role: string;
  handoff_skills: string[];
  action_confirmation: "client" | "auto" | "human";
  activation_mode: "always" | "business_hours" | "off_hours" | "new_contact_only" | "custom";
  schedule: {
    timezone: string;
    days: Record<string, Array<{ from: string; to: string }>>;
  };
  trigger_mode: "any" | "keyword" | "webhook";
  trigger_keywords: string[];
  trigger_webhook_slug: string;
  trigger_webhook_secret: string;
  response_pace: "instant" | "natural" | "thoughtful" | "very_human";
  response_length: "concise" | "balanced" | "detailed";
};

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function parseJSONArray<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function emptyForm(): AgentForm {
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
      workspace_voice_id: "",
      audio_enabled: false,
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
    role: "primary",
    handoff_skills: [],
    action_confirmation: "client",
    activation_mode: "always",
    schedule: { timezone: "America/Sao_Paulo", days: {} },
    trigger_mode: "any",
    trigger_keywords: [],
    trigger_webhook_slug: "",
    trigger_webhook_secret: "",
    response_pace: "natural",
    response_length: "balanced",
  };
}

export function mapAgent(data: any): AgentForm {
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
    faq: parseJSONArray<any[]>(data?.faq, []).map((item: any) => ({
      id: item.id || uid(),
      question: item.question || "",
      answer: item.answer || "",
    })),
    variables: parseJSONArray<any[]>(data?.variables, []).map((item: any) => ({
      id: item.id || uid(),
      key: item.key || "",
      value: item.value || "",
      description: item.description || "",
    })),
    voice: {
      ...form.voice,
      ...(typeof data?.voice === "string" ? parseJSONArray(data.voice, {}) : data?.voice || {}),
    },
    skills: parseJSONArray<any[]>(data?.skills, []).map((item: any) => ({
      id: item.id || uid(),
      name: item.name || "",
      type: item.type || "custom",
      description: item.description || "",
      enabled: item.enabled !== false,
    })),
    app_access: parseJSONArray<any[]>(data?.app_access, []).map((item: any) => ({
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
    role: data?.role || "primary",
    handoff_skills: parseJSONArray<string[]>(data?.handoff_skills, []),
    action_confirmation:
      data?.action_confirmation === "auto" || data?.action_confirmation === "human"
        ? data.action_confirmation
        : "client",
    activation_mode: ["always", "business_hours", "off_hours", "new_contact_only", "custom"].includes(
      data?.activation_mode,
    )
      ? data.activation_mode
      : "always",
    schedule: (() => {
      const raw =
        typeof data?.schedule === "string" ? parseJSONArray<any>(data.schedule, {}) : data?.schedule || {};
      return {
        timezone: raw.timezone || "America/Sao_Paulo",
        days: raw.days || {},
      };
    })(),
    trigger_mode: ["any", "keyword", "webhook"].includes(data?.trigger_mode) ? data.trigger_mode : "any",
    trigger_keywords: parseJSONArray<string[]>(data?.trigger_keywords, []),
    trigger_webhook_slug: data?.trigger_webhook_slug || "",
    trigger_webhook_secret: data?.trigger_webhook_secret || "",
    response_pace: ["instant", "natural", "thoughtful", "very_human"].includes(data?.response_pace)
      ? data.response_pace
      : "natural",
    response_length: ["concise", "balanced", "detailed"].includes(data?.response_length)
      ? data.response_length
      : "balanced",
  };
}

// Readiness — quantos requisitos básicos pra ativar o agente estão
// preenchidos. usingUniqAI: sem integration_id custom, cai no provider
// default da plataforma e o backend resolve modelo automaticamente.
export function computeReadiness(form: AgentForm) {
  const usingUniqAI = !form.integration_id;
  return {
    hasLLM: usingUniqAI || !!form.integration_id,
    hasModel: usingUniqAI || !!form.model.trim(),
    hasIdentity: !!form.identity.trim() || !!form.agent_name.trim(),
    hasInstructions: !!form.system_prompt.trim() || !!form.service_instructions.trim(),
  };
}
