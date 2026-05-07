"use client";

// FunnelOptionPicker / StageOptionPicker / CompanyOptionPicker —
// dropdowns que carregam lista de Funnels/Stages/Companies do
// workspace e usam o UUID como value. Usado em Segment e Journey
// builders pra evitar pedir o UUID raw ao admin.

import { useQuery } from "@tanstack/react-query";
import { crmApi, companiesApi } from "@/lib/api";
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
