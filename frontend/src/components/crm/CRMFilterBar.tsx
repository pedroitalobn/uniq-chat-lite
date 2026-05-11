"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Smartphone, Tag, GitBranch, Wand2, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { instancesApi, crmApi, journeysApi } from "@/lib/api";

// CRMFilterBar — barra de filtros REUTILIZÁVEL pras páginas de
// Contatos / Deals / Companies. Antes cada página tinha sua própria
// faixa de filtros e o usuário pediu paridade entre elas: instância,
// tag, funil, jornada. Centralizar evita drift visual e duplicação.
//
// Cada filtro é opcional via prop "show*". Páginas escolhem só o que
// faz sentido (ex.: companies não tem owner per se — é via contato).
//
// O componente é controlled: pai mantém o state e cada onChange dispara
// requery. Sem state interno além dos popovers.

export interface CRMFilters {
  instanceId?: string;
  tagId?: string;
  funnel?: string;
  journey?: string;
}

interface Props {
  workspaceId?: string;
  value: CRMFilters;
  onChange: (next: CRMFilters) => void;
  showInstance?: boolean;
  showTag?: boolean;
  showFunnel?: boolean;
  showJourney?: boolean;
}

export function CRMFilterBar({
  workspaceId, value, onChange, showInstance = true, showTag = true, showFunnel = true, showJourney = true,
}: Props) {
  const instancesQ = useQuery({
    queryKey: ["instances-for-crm-filter", workspaceId],
    queryFn: () =>
      instancesApi.list(undefined, workspaceId).then((r) => {
        const raw = r.data as Array<{ id: string; name: string; channel?: string }> | { items?: Array<{ id: string; name: string; channel?: string }> };
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: !!workspaceId && showInstance,
    staleTime: 60_000,
  });

  const tagsQ = useQuery({
    queryKey: ["tags-for-crm-filter", workspaceId],
    queryFn: () =>
      crmApi.listTags(workspaceId).then((r) => {
        const raw = r.data as Array<{ id: string; name: string; color?: string }> | { items?: Array<{ id: string; name: string; color?: string }> };
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: !!workspaceId && showTag,
    staleTime: 60_000,
  });

  const funnelsQ = useQuery({
    queryKey: ["funnels-for-crm-filter", workspaceId],
    queryFn: () =>
      crmApi.listFunnels(workspaceId).then((r) => {
        const raw = r.data as Array<{ id: string; name: string }> | { items?: Array<{ id: string; name: string }> };
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: !!workspaceId && showFunnel,
    staleTime: 60_000,
  });

  const journeysQ = useQuery({
    queryKey: ["journeys-for-crm-filter"],
    queryFn: () =>
      journeysApi.list().then((r) => {
        const raw = r.data as Array<{ id: string; name: string }> | { items?: Array<{ id: string; name: string }> };
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: showJourney,
    staleTime: 60_000,
  });

  const instances = instancesQ.data ?? [];
  const tags = tagsQ.data ?? [];
  const funnels = funnelsQ.data ?? [];
  const journeys = journeysQ.data ?? [];

  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    instances.forEach((i) => (map["instance:" + i.id] = i.name));
    tags.forEach((t) => (map["tag:" + t.id] = t.name));
    funnels.forEach((f) => (map["funnel:" + f.name] = f.name));
    journeys.forEach((j) => (map["journey:" + j.name] = j.name));
    return map;
  }, [instances, tags, funnels, journeys]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showInstance && (
        <FilterDropdown
          icon={<Smartphone className="h-3.5 w-3.5" />}
          label={value.instanceId ? labels["instance:" + value.instanceId] || "Instância" : "Todas as instâncias"}
          active={!!value.instanceId}
          options={[
            { id: "", label: "Todas as instâncias" },
            ...instances.map((i) => ({ id: i.id, label: i.name, sub: i.channel })),
          ]}
          selected={value.instanceId ?? ""}
          onSelect={(id) => onChange({ ...value, instanceId: id || undefined })}
        />
      )}
      {showTag && (
        <FilterDropdown
          icon={<Tag className="h-3.5 w-3.5" />}
          label={value.tagId ? labels["tag:" + value.tagId] || "Tag" : "Todas as tags"}
          active={!!value.tagId}
          options={[
            { id: "", label: "Todas as tags" },
            ...tags.map((t) => ({ id: t.id, label: t.name, color: t.color })),
          ]}
          selected={value.tagId ?? ""}
          onSelect={(id) => onChange({ ...value, tagId: id || undefined })}
        />
      )}
      {showFunnel && (
        <FilterDropdown
          icon={<GitBranch className="h-3.5 w-3.5" />}
          label={value.funnel ? value.funnel : "Todos os funis"}
          active={!!value.funnel}
          options={[
            { id: "", label: "Todos os funis" },
            ...funnels.map((f) => ({ id: f.name, label: f.name })),
          ]}
          selected={value.funnel ?? ""}
          onSelect={(id) => onChange({ ...value, funnel: id || undefined })}
        />
      )}
      {showJourney && (
        <FilterDropdown
          icon={<Wand2 className="h-3.5 w-3.5" />}
          label={value.journey ? value.journey : "Todas as jornadas"}
          active={!!value.journey}
          options={[
            { id: "", label: "Todas as jornadas" },
            ...journeys.map((j) => ({ id: j.name, label: j.name })),
          ]}
          selected={value.journey ?? ""}
          onSelect={(id) => onChange({ ...value, journey: id || undefined })}
        />
      )}
      {(value.instanceId || value.tagId || value.funnel || value.journey) && (
        <button
          onClick={() => onChange({})}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium"
          style={{
            background: "rgba(248,113,113,0.10)",
            border: "1px solid rgba(248,113,113,0.22)",
            color: "#f87171",
          }}
        >
          Limpar
        </button>
      )}
    </div>
  );
}

interface FilterOption {
  id: string;
  label: string;
  sub?: string;
  color?: string;
}

function FilterDropdown({
  icon, label, active, options, selected, onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  options: FilterOption[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
        style={{
          background: active ? "rgba(0,212,106,0.12)" : "var(--border-subtle)",
          border: `1px solid ${active ? "rgba(0,212,106,0.25)" : "var(--border-default)"}`,
          color: active ? "#00d46a" : "var(--text-1)",
          boxShadow: active ? "0 0 12px rgba(0,212,106,0.10)" : "none",
          transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <span style={{ color: active ? "#00d46a" : "hsl(240 8% 48%)", display: "inline-flex" }}>{icon}</span>
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-56 rounded-lg shadow-xl overflow-auto"
          style={{
            maxHeight: "60vh",
            background: "linear-gradient(135deg, rgba(18,18,30,0.97) 0%, rgba(10,10,20,0.99) 100%)",
            backdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid var(--border-default)",
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.id === selected;
            return (
              <button
                key={opt.id || "_all"}
                onClick={() => { onSelect(opt.id); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5"
                style={{
                  color: isSelected ? "#00d46a" : "var(--text-1)",
                  background: isSelected ? "rgba(0,212,106,0.08)" : "transparent",
                }}
              >
                {opt.color && (
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ background: opt.color }}
                  />
                )}
                <span className="flex-1 truncate">{opt.label}</span>
                {opt.sub && (
                  <span className="text-[10px]" style={{ color: "var(--text-4)" }}>{opt.sub}</span>
                )}
                {isSelected && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
