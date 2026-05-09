"use client";

import { useQuery } from "@tanstack/react-query";
import { Users, Lock, Crown, Shield } from "lucide-react";
import { rolesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Role = {
  id: string;
  name: string;
  description?: string;
  is_default?: boolean;
};

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

// Acesso da equipe — controla quem do workspace pode editar este
// agente. Default: todo membro com agents:manage pode (legado). Quando
// AccessRestricted=true, só os papéis selecionados (+ dono e
// super-admin) editam. Owners e super-admin sempre passam, então não
// dá pra "trancar" o agente sem volta. Backend enforça em UpdateAgent.
export function TeamAccessCard({ form, update }: Props) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const rolesQuery = useQuery({
    queryKey: ["workspace-roles", wsId],
    queryFn: async () => {
      const r = await rolesApi.list(wsId);
      return (r.data?.roles || r.data || []) as Role[];
    },
    enabled: !!wsId,
  });

  const restricted = form.access_restricted;
  const roles = rolesQuery.data || [];
  const selectedCount = form.editor_role_ids.length;

  const toggleRole = (roleId: string) => {
    update((p) => {
      const has = p.editor_role_ids.includes(roleId);
      return {
        ...p,
        editor_role_ids: has
          ? p.editor_role_ids.filter((id) => id !== roleId)
          : [...p.editor_role_ids, roleId],
      };
    });
  };

  return (
    <CollapsibleCard
      title="Acesso da equipe"
      icon={Users}
      accentColor="#a78bfa"
      defaultOpen={false}
      meta={
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={
            restricted
              ? {
                  background: "rgba(167,139,250,0.10)",
                  color: "#a78bfa",
                  border: "1px solid rgba(167,139,250,0.20)",
                }
              : {
                  background: "var(--surface-2)",
                  color: "var(--text-4)",
                  border: "1px solid var(--surface-border)",
                }
          }
        >
          {restricted ? `restrito · ${selectedCount} ${selectedCount === 1 ? "papel" : "papéis"}` : "qualquer admin"}
        </span>
      }
    >
      <div className="pt-3 space-y-3">
        {/* Toggle de modo */}
        <div className="space-y-2">
          <ModeOption
            active={!restricted}
            onClick={() => update((p) => ({ ...p, access_restricted: false }))}
            icon={Crown}
            label="Aberto pro workspace"
            description="Qualquer membro com permissão agents:manage pode editar (comportamento padrão)."
            color="#fbbf24"
          />
          <ModeOption
            active={restricted}
            onClick={() => update((p) => ({ ...p, access_restricted: true }))}
            icon={Shield}
            label="Restrito a papéis específicos"
            description="Só os papéis selecionados abaixo podem editar. Dono do workspace e super-admin sempre passam."
            color="#a78bfa"
          />
        </div>

        {/* Lista de papéis — só aparece se restrito */}
        {restricted && (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-4)" }}>
              Papéis com permissão de editar
            </p>
            {rolesQuery.isLoading ? (
              <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                Carregando papéis…
              </p>
            ) : roles.length === 0 ? (
              <div
                className="rounded-lg px-3 py-2.5 text-[10px]"
                style={{
                  background: "rgba(245,158,11,0.06)",
                  border: "1px solid rgba(245,158,11,0.20)",
                  color: "#fbbf24",
                }}
              >
                Nenhum papel customizado neste workspace. Crie em <b>/workspace</b> → aba "Papéis".
                Sem papéis listados, só o dono consegue editar este agente.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {roles.map((role) => {
                  const checked = form.editor_role_ids.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      className="flex items-start gap-2 px-2.5 py-2 rounded-lg text-left transition-all"
                      style={{
                        background: checked ? "rgba(167,139,250,0.08)" : "var(--surface-2)",
                        border: `1px solid ${checked ? "rgba(167,139,250,0.30)" : "var(--surface-border)"}`,
                      }}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded mt-0.5 flex items-center justify-center flex-shrink-0"
                        style={{
                          background: checked ? "#a78bfa" : "var(--surface-3)",
                          border: `1px solid ${checked ? "rgba(167,139,250,0.50)" : "var(--surface-border)"}`,
                        }}
                      >
                        {checked && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <path d="M1 4l2 2 4-4" stroke="#1a0a2e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                          {role.name}
                          {role.is_default && (
                            <span
                              className="ml-1.5 text-[8px] uppercase tracking-wider px-1 py-0.5 rounded"
                              style={{ background: "var(--surface-3)", color: "var(--text-4)" }}
                            >
                              padrão
                            </span>
                          )}
                        </p>
                        {role.description && (
                          <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "var(--text-4)" }}>
                            {role.description}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedCount === 0 && roles.length > 0 && (
              <div
                className="rounded-lg px-3 py-2 flex items-start gap-2"
                style={{
                  background: "rgba(239,68,68,0.05)",
                  border: "1px solid rgba(239,68,68,0.20)",
                }}
              >
                <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "#f87171" }} />
                <p className="text-[10px]" style={{ color: "#fca5a5" }}>
                  Nenhum papel selecionado — só você (dono do workspace) e super-admins poderão
                  editar este agente.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Observação fixa */}
        <p
          className="text-[10px] pt-2"
          style={{ color: "var(--text-4)", borderTop: "1px solid var(--surface-border)" }}
        >
          Observação: dono do workspace e super-admin <b>sempre</b> conseguem editar — independente
          dessa configuração.
        </p>
      </div>
    </CollapsibleCard>
  );
}

function ModeOption({
  active,
  onClick,
  icon: Icon,
  label,
  description,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Crown;
  label: string;
  description: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all"
      style={{
        background: active ? `${color}10` : "var(--surface-2)",
        border: `1px solid ${active ? `${color}40` : "var(--surface-border)"}`,
      }}
    >
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: active ? `${color}22` : "rgba(255,255,255,0.04)",
          border: `1px solid ${active ? `${color}55` : "rgba(255,255,255,0.06)"}`,
          color: active ? color : "var(--text-3)",
        }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: active ? "var(--text-1)" : "var(--text-2)" }}>
          {label}
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
          {description}
        </p>
      </div>
    </button>
  );
}
