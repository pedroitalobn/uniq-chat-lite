"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { rolesApi, permissionsApi } from "@/lib/api";
import { Shield, Plus, Loader2, ChevronLeft, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import type { Role, Permission } from "@/types";

interface GroupedPermissions {
  [category: string]: Permission[];
}

export default function RolesPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = params.workspaceId as string;

  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [groupedPerms, setGroupedPerms] = useState<GroupedPermissions>({});

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["workspace-roles", workspaceId],
    queryFn: () => rolesApi.list(workspaceId).then((r) => r.data.roles || r.data),
    enabled: !!workspaceId,
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["permissions"],
    queryFn: async () => {
      const res = await permissionsApi.list();
      const perms = res.data.permissions || res.data;
      const grouped: GroupedPermissions = {};
      perms.forEach((p: Permission) => {
        if (!grouped[p.category]) grouped[p.category] = [];
        grouped[p.category]!.push(p);
      });
      setGroupedPerms(grouped);
      return perms;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; permission_ids: string[] }) =>
      rolesApi.create(workspaceId, data),
    onSuccess: () => {
      toast.success("Função criada");
      queryClient.invalidateQueries({ queryKey: ["workspace-roles", workspaceId] });
      resetForm();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar função";
      toast.error(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; permission_ids: string[] }) =>
      rolesApi.update(workspaceId, editingRole!.id, data),
    onSuccess: () => {
      toast.success("Função atualizada");
      queryClient.invalidateQueries({ queryKey: ["workspace-roles", workspaceId] });
      setEditingRole(null);
      resetForm();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao atualizar função";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.delete(workspaceId, roleId),
    onSuccess: () => {
      toast.success("Função excluída");
      queryClient.invalidateQueries({ queryKey: ["workspace-roles", workspaceId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao excluir função";
      toast.error(msg);
    },
  });

  const resetForm = () => {
    setShowCreate(false);
    setCreateName("");
    setCreateDesc("");
    setSelectedPerms([]);
    setEditingRole(null);
  };

  const startEdit = (role: Role) => {
    setEditingRole(role);
    setCreateName(role.name);
    setCreateDesc(role.description || "");
    // role.permissions pode vir null/undefined dependendo do preload do
    // backend — fallback pra array vazio evita crash silencioso (form
    // abria sem checkboxes marcados antes).
    setSelectedPerms((role.permissions ?? []).map((p) => p.id));
    setShowCreate(false);
  };

  const togglePerm = (permId: string) => {
    setSelectedPerms(prev =>
      prev.includes(permId) ? prev.filter(id => id !== permId) : [...prev, permId]
    );
  };

  const handleSubmit = () => {
    if (!createName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (editingRole) {
      updateMutation.mutate({ name: createName, description: createDesc, permission_ids: selectedPerms });
    } else {
      createMutation.mutate({ name: createName, description: createDesc, permission_ids: selectedPerms });
    }
  };

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      // Inbox/atendimento
      inbox: "Inbox",
      tickets: "Atendimentos",
      notes: "Notas Internas",
      queues: "Filas",
      teams: "Equipes",
      departments: "Departamentos",
      quickreplies: "Respostas Rápidas",
      reports: "Relatórios",
      presence: "Presença",
      // Infra / módulos
      instances: "Instâncias",
      servers: "Servidores",
      agents: "Agentes IA",
      integrations: "Integrações",
      campaigns: "Campanhas",
      dashboard: "Dashboard",
      billing: "Plano / Billing",
      // CRM
      crm: "CRM",
      // Workspace
      team: "Membros do Workspace",
      roles: "Funções",
      settings: "Configurações",
    };
    return labels[cat] || cat;
  };

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      // Inbox/atendimento — verde Uniq
      inbox: "#00d46a",
      tickets: "#4ade80",
      notes: "#a3e635",
      queues: "#34d399",
      teams: "#06b6d4",
      departments: "#0ea5e9",
      quickreplies: "#10b981",
      reports: "#22d3ee",
      presence: "#67e8f9",
      // Infra — azul/ciano
      instances: "#60a5fa",
      servers: "#3b82f6",
      agents: "#818cf8",
      integrations: "#6366f1",
      campaigns: "#f472b6",
      dashboard: "#38bdf8",
      billing: "#facc15",
      // CRM — amarelo
      crm: "#fbbf24",
      // Workspace — roxo
      team: "#a78bfa",
      roles: "#fb923c",
      settings: "#94a3b8",
    };
    return colors[cat] || "#94a3b8";
  };

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/workspace/${workspaceId}/team`)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "hsl(240 8% 50%)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
              Funções e Permissões
            </h1>
            <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
              Defina funções customizadas para seu time.
            </p>
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreate(true); }}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus className="w-4 h-4" />
          Nova Função
        </button>
      </div>

      {/* Create/Edit form */}
      {(showCreate || editingRole) && (
        <div className="rounded-2xl p-5 space-y-5 animate-fade-in-up" style={cardStyle}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.15)" }}
              >
                <Shield className="w-3.5 h-3.5" style={{ color: "#fb923c" }} />
              </div>
              <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>
                {editingRole ? "Editar Função" : "Criar Nova Função"}
              </h2>
            </div>
            <button
              onClick={resetForm}
              className="p-1 rounded"
              style={{ color: "hsl(240 8% 40%)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: "hsl(240 8% 50%)" }}>Nome</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Ex: SDR, Marketing, Suporte"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: "hsl(240 8% 50%)" }}>Descrição (opcional)</label>
              <input
                type="text"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Breve descrição da função"
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Permissions grid */}
          <div>
            <label className="text-xs mb-3 block" style={{ color: "hsl(240 8% 50%)" }}>Permissões</label>
            <div className="space-y-4">
              {Object.entries(groupedPerms).map(([category, perms]) => {
                const permIds = perms.map((p) => p.id);
                const selectedInCat = permIds.filter((id) => selectedPerms.includes(id)).length;
                const allSelected = selectedInCat === perms.length && perms.length > 0;
                const someSelected = selectedInCat > 0 && selectedInCat < perms.length;
                const toggleAllCat = () => {
                  if (allSelected) {
                    // remove todas da categoria
                    setSelectedPerms((prev) => prev.filter((id) => !permIds.includes(id)));
                  } else {
                    // adiciona as que faltam
                    setSelectedPerms((prev) => Array.from(new Set([...prev, ...permIds])));
                  }
                };
                return (
                <div key={category}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: getCategoryColor(category) }}
                      />
                      <span className="text-xs font-medium" style={{ color: "hsl(240 8% 60%)" }}>
                        {getCategoryLabel(category)}
                      </span>
                      <span className="text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                        {selectedInCat}/{perms.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleAllCat}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-white/5"
                      style={{
                        color: allSelected ? "#00d46a" : someSelected ? "#f59e0b" : "hsl(240 8% 52%)",
                        border: `1px solid ${allSelected ? "rgba(0,212,106,0.3)" : "var(--border-default)"}`,
                      }}
                      title={allSelected ? "Desmarcar todas do módulo" : "Selecionar todas do módulo"}
                    >
                      <span
                        className="flex h-3 w-3 items-center justify-center rounded-[3px]"
                        style={{
                          background: allSelected
                            ? "var(--green)"
                            : someSelected
                            ? "rgba(245,158,11,0.4)"
                            : "var(--surface-2)",
                        }}
                      >
                        {allSelected && <Check className="h-2 w-2" style={{ color: "#03170a" }} />}
                        {someSelected && <span className="h-[2px] w-2 rounded-full bg-white/70" />}
                      </span>
                      {allSelected ? "Todas" : someSelected ? "Parcial" : "Selecionar módulo"}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {perms.map((perm) => {
                      const isSelected = selectedPerms.includes(perm.id);
                      return (
                        <button
                          key={perm.id}
                          onClick={() => togglePerm(perm.id)}
                          className="flex items-center gap-2 p-2.5 rounded-xl text-left transition-all"
                          style={{
                            background: isSelected ? "rgba(0,212,106,0.08)" : "var(--surface-2)",
                            border: `1px solid ${isSelected ? "rgba(0,212,106,0.2)" : "var(--surface-2)"}`,
                          }}
                        >
                          <div
                            className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                            style={{
                              background: isSelected ? "rgba(0,212,106,0.15)" : "var(--surface-2)",
                              border: `1px solid ${isSelected ? "rgba(0,212,106,0.3)" : "var(--border-strong)"}`,
                            }}
                          >
                            {isSelected && <Check className="w-3 h-3" style={{ color: "var(--green)" }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: isSelected ? "#86efac" : "hsl(240 8% 70%)" }}>
                              {perm.name}
                            </p>
                            <p className="text-xs truncate" style={{ color: "hsl(240 8% 35%)" }}>{perm.key}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs" style={{ color: "hsl(240 8% 40%)" }}>
              {selectedPerms.length} permissão{selectedPerms.length !== 1 ? "s" : ""} selecionada{selectedPerms.length !== 1 ? "s" : ""}
            </span>
            <div className="flex gap-3">
              <button onClick={resetForm} className="btn-secondary text-sm px-4 py-2">
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="btn-primary flex items-center gap-2 text-sm px-4 py-2 disabled:opacity-40"
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingRole ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roles list */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up" style={cardStyle}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            {roles.length} função{roles.length !== 1 ? "s" : ""}
          </h2>
        </div>

        {rolesLoading ? (
          <div className="p-5 space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
        ) : roles.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="w-8 h-8 mx-auto mb-3" style={{ color: "hsl(240 8% 28%)" }} />
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhuma função criada</p>
          </div>
        ) : (
          <div>
            {roles.map((role, i) => (
              <div
                key={role.id}
                className="px-5 py-4 transition-colors"
                style={{
                  borderBottom: i < roles.length - 1 ? "1px solid var(--border-default)" : undefined,
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{role.name}</p>
                      {role.is_default && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: "var(--surface-2)", color: "hsl(240 8% 50%)" }}
                        >
                          Padrão
                        </span>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-xs mb-2" style={{ color: "hsl(240 8% 38%)" }}>{role.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {(role.permissions ?? []).slice(0, 6).map((perm) => (
                        <span
                          key={perm.id}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: "var(--surface-2)", color: "hsl(240 8% 55%)" }}
                        >
                          {perm.name}
                        </span>
                      ))}
                      {(role.permissions ?? []).length > 6 && (
                        <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: "var(--surface-2)", color: "hsl(240 8% 40%)" }}
                        >
                          +{(role.permissions ?? []).length - 6} mais
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(role)}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "hsl(240 8% 32%)" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 55%)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {!role.is_default && (
                      <button
                        onClick={async () => {
                          if (!await showConfirm(`Excluir função "${role.name}"?`, { title: "Excluir função", confirmLabel: "Excluir" })) return;
                          deleteMutation.mutate(role.id);
                        }}
                        className="p-2 rounded-lg transition-colors"
                        style={{ color: "hsl(240 8% 32%)" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info card */}
      <div
        className="rounded-2xl p-5 space-y-3 animate-fade-in-up"
        style={{ ...cardStyle, animationDelay: "100ms", animationFillMode: "both" }}
      >
        <h3 className="text-sm font-medium" style={{ color: "hsl(240 15% 85%)" }}>
          Sobre Funções e Permissões
        </h3>
        <p className="text-sm" style={{ color: "hsl(240 8% 50%)" }}>
          Funções permitem controlar o acesso dos membros às diferentes áreas do workspace. 
          A função Admin (padrão) tem acesso total. Você pode criar funções customizadas 
          para diferentes necessidades do seu time.
        </p>
      </div>
    </div>
  );
}
