"use client";

// FunnelOptionPicker / StageOptionPicker / CompanyOptionPicker / etc —
// dropdowns que carregam lista de recursos do workspace e usam o UUID
// como value. Centralizado aqui pra evitar que o builder de Segment/
// Journey/Campaign peça UUID raw ao admin.

import { useQuery } from "@tanstack/react-query";
import {
  crmApi, companiesApi, instancesApi, departmentsApi,
  teamsApi, queuesApi, workspacesApi, journeysApi,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type Option = { value: string; label: string; color?: string };

function Select({ value, onChange, options, placeholder, isLoading }: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  isLoading?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className="input-field text-xs flex-1 min-w-0">
      <option value="">{placeholder ?? "Selecione…"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function FunnelOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ id: string; name: string; color?: string }>>({
    queryKey: ["funnels", wsId],
    queryFn: () => crmApi.listFunnels(wsId).then((r) => r.data),
    staleTime: 60_000,
  });
  const options = (data ?? []).map((f) => ({ value: f.id, label: f.name, color: f.color }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar funil"} isLoading={isLoading} />;
}

export function StageOptionPicker({ funnelId, value, onChange, placeholder }: {
  funnelId: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { data, isLoading } = useQuery<Array<{ id: string; name: string; color?: string }>>({
    queryKey: ["funnel-stages", funnelId],
    queryFn: () => funnelId ? crmApi.listFunnelStages(funnelId).then((r) => r.data) : Promise.resolve([]),
    enabled: !!funnelId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((s) => ({ value: s.id, label: s.name, color: s.color }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={funnelId ? (placeholder ?? "Selecionar estágio") : "Escolha um funil primeiro"}
    isLoading={isLoading} />;
}

export function CompanyOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<{ items: Array<{ id: string; name: string }> }>({
    queryKey: ["companies", wsId],
    queryFn: () => companiesApi.list(wsId as string, { limit: 200 }).then((r) => r.data),
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data?.items ?? []).map((c) => ({ value: c.id, label: c.name }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar empresa"} isLoading={isLoading} />;
}

// AgentOptionPicker — não há /v1/agents global porque agente IA vive
// por instância. Pivotamos pelas instâncias do workspace; o backend
// resolve passed_agent_id pelo instance_id quando aplicável.
export function AgentOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ id: string; name: string; channel?: string }>>({
    queryKey: ["instances-picker", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => r.data || []),
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((a) => ({
    value: a.id,
    label: a.name + (a.channel ? ` · ${a.channel}` : ""),
  }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar agente / instância"} isLoading={isLoading} />;
}

// MemberOptionPicker — membros do workspace (atendentes humanos /
// proprietários de deal). Lista nome+email pra desambiguar
// homônimos.
export function MemberOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ user_id: string; user?: { name?: string; email?: string } }>>({
    queryKey: ["ws-members-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const r = await workspacesApi.listMembers(wsId);
      const d = r.data as { members?: any[] };
      return (d?.members || r.data || []) as Array<{ user_id: string; user?: { name?: string; email?: string } }>;
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((m) => ({
    value: m.user_id,
    label: (m.user?.name || m.user?.email || m.user_id) + (m.user?.email && m.user?.name ? ` (${m.user.email})` : ""),
  }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar membro"} isLoading={isLoading} />;
}

// DepartmentOptionPicker / TeamOptionPicker / QueueOptionPicker —
// recursos do módulo de inbox (atendimento humano). Cada workspace
// tem seu próprio conjunto.
export function DepartmentOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["departments-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const r = await departmentsApi.list(wsId);
      return ((r.data as { items?: any[] })?.items || r.data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((d) => ({ value: d.id, label: d.name }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar departamento"} isLoading={isLoading} />;
}

export function TeamOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["teams-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const r = await teamsApi.list(wsId);
      return ((r.data as { items?: any[] })?.items || r.data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((t) => ({ value: t.id, label: t.name }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar equipe"} isLoading={isLoading} />;
}

export function QueueOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["queues-picker", wsId],
    queryFn: async () => {
      if (!wsId) return [];
      const r = await queuesApi.list(wsId);
      return ((r.data as { items?: any[] })?.items || r.data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((q) => ({ value: q.id, label: q.name }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar fila"} isLoading={isLoading} />;
}

// JourneyOptionPicker — jornadas ativas do workspace. Lista vem do
// /v1/journeys filtrado por workspace. Usado nos filtros do CRM v2.
export function JourneyOptionPicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["journeys-picker", wsId],
    queryFn: async () => {
      const r = await journeysApi.list(wsId);
      const d = r.data as { items?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
      return Array.isArray(d) ? d : (d.items || []);
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
  const options = (data ?? []).map((j) => ({ value: j.id, label: j.name }));
  return <Select value={value} onChange={onChange} options={options}
    placeholder={placeholder ?? "Selecionar jornada"} isLoading={isLoading} />;
}
