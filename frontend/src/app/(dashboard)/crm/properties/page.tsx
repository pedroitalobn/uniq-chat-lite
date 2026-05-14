"use client";

// /crm/properties — hub central pra gerenciar tudo que define a estrutura
// dos registros do CRM: funis (pipelines + estágios), tags e campos
// personalizados (custom fields) por entidade (deal, contact, company).
//
// Antes esses managers viviam espalhados (modais dentro de /crm/contacts,
// página separada de /crm/funnels). Centralizando aqui o usuário tem 1 lugar
// pra "configurar" o CRM dele — análogo às "Properties" do HubSpot.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SlidersHorizontal, GitBranch, Tag as TagIcon, Layers, Plus, Trash2, X,
} from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { crmApi } from "@/lib/api";
import { FunnelManagerPanel } from "@/components/crm/FunnelManager";
import { CrmHeader } from "@/components/crm/CrmHeader";
import { CustomFieldsManager } from "@/components/crm/CustomFieldsManager";
import type { Tag } from "@/types";

type TabId = "funnels" | "tags" | "fields";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; description: string }> = [
  { id: "funnels", label: "Funis",  icon: GitBranch, description: "Pipelines e estágios compartilhados entre Contatos e Deals" },
  { id: "tags",    label: "Tags",   icon: TagIcon,   description: "Etiquetas coloridas pra segmentar contatos e deals" },
  { id: "fields",  label: "Campos personalizados", icon: Layers, description: "Crie atributos próprios pra deals, contatos e empresas (em breve)" },
];

const PRESET_COLORS = ["#2563EB", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function PropertiesPage() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const [tab, setTab] = useState<TabId>("funnels");

  return (
    <div className="p-3 sm:p-4 space-y-3 h-full overflow-y-auto">
      <CrmHeader
        icon={<SlidersHorizontal className="w-4 h-4" style={{ color: "var(--green)" }} />}
        title="Propriedades"
        subtitle="Configure a estrutura dos seus registros — funis, tags e campos personalizados."
        toolbar={
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all flex-shrink-0"
                  style={{
                    background: active
                      ? "linear-gradient(135deg, rgba(37, 99, 235,0.18), rgba(37, 99, 235,0.06))"
                      : "var(--input)",
                    border: active ? "1px solid rgba(37, 99, 235,0.25)" : "1px solid var(--border-default)",
                    color: active ? "var(--green)" : "var(--text-2)",
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        }
      />

      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background: "linear-gradient(135deg, var(--input) 0%, rgba(255,255,255,0.01) 100%)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {tab === "funnels" && <FunnelManagerPanel workspaceId={wsId} />}
        {tab === "tags" && <TagsPanel wsId={wsId} />}
        {tab === "fields" && <CustomFieldsManager workspaceId={wsId} />}
      </div>
    </div>
  );
}

// ─── Tags inline panel ────────────────────────────────────────────────────────
function TagsPanel({ wsId }: { wsId?: string }) {
  const qc = useQueryClient();
  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ["tags", wsId],
    queryFn: () => crmApi.listTags(wsId).then((r) => r.data),
  });
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const createTag = useMutation({
    mutationFn: () => crmApi.createTag(name.trim(), color, wsId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      setName("");
      toast.success("Tag criada");
    },
    onError: () => toast.error("Erro ao criar tag"),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => crmApi.deleteTag(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Tag removida");
    },
    onError: () => toast.error("Erro ao remover tag"),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>Nova tag</h3>
        <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>
          Tags ajudam a segmentar contatos e filtrar deals.
        </p>
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-start">
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da tag (ex: Lead quente)"
              onKeyDown={(e) => e.key === "Enter" && name.trim() && createTag.mutate()}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--input)",
                border: "1px solid var(--border-default)",
                color: "var(--text-1)",
              }}
            />
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full transition-all"
                  style={{
                    background: c,
                    boxShadow: color === c ? `0 0 0 2px var(--surface-solid), 0 0 0 4px ${c}` : "none",
                  }}
                />
              ))}
            </div>
          </div>
          <button
            onClick={() => name.trim() && createTag.mutate()}
            disabled={!name.trim() || createTag.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            <Plus className="w-3.5 h-3.5" /> Criar tag
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-1)" }}>
          Tags existentes <span style={{ color: "var(--text-3)" }}>({tags.length})</span>
        </h3>
        {tags.length === 0 ? (
          <p className="text-xs py-6 text-center rounded-xl"
            style={{ color: "var(--text-3)", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border-default)" }}>
            Nenhuma tag ainda. Crie a primeira acima.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl"
                style={{
                  background: tag.color + "11",
                  border: `1px solid ${tag.color}33`,
                }}
              >
                <span className="inline-flex items-center gap-2 truncate" style={{ color: tag.color }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tag.color }} />
                  <span className="text-xs font-medium truncate">{tag.name}</span>
                </span>
                <button
                  onClick={() => deleteTag.mutate(tag.id)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  style={{ color: "var(--text-3)" }}
                  aria-label={`Remover tag ${tag.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

