"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Lock, UserPlus, X } from "lucide-react";
import { teamsApi, departmentsApi, workspacesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

interface Team {
  id: string;
  name: string;
  description?: string;
  department_id?: string;
  department?: { id: string; name: string } | null;
  leader_user_id?: string;
  is_active: boolean;
}

interface WorkspaceMember {
  user_id: string;
  user?: { id: string; name: string; email: string };
}

interface TeamMemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  user_name: string;
  user_email: string;
}

interface Department {
  id: string;
  name: string;
}

export default function TeamsPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.teamsView);
  const canManage = hasPerm(PERM.teamsManage);

  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const { data: teams, isLoading } = useQuery({
    queryKey: ["teams", wsId],
    queryFn: () => teamsApi.list(wsId as string).then((r) => r.data as { items: Team[] }),
    enabled: !!wsId && canView,
  });

  const { data: departments } = useQuery({
    queryKey: ["departments", wsId],
    queryFn: () => departmentsApi.list(wsId as string).then((r) => r.data as { items: Department[] }),
    enabled: !!wsId && canView,
  });

  const create = useMutation({
    mutationFn: () =>
      teamsApi.create(wsId as string, {
        name,
        department_id: departmentId || undefined,
      }),
    onSuccess: () => {
      toast.success("Equipe criada");
      setName("");
      setDepartmentId("");
      qc.invalidateQueries({ queryKey: ["teams", wsId] });
    },
    onError: () => toast.error("Falha ao criar equipe"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => teamsApi.delete(wsId as string, id),
    onSuccess: () => {
      toast.success("Equipe removida");
      qc.invalidateQueries({ queryKey: ["teams", wsId] });
      if (selectedTeamId) setSelectedTeamId(null);
    },
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) return <Forbidden />;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Equipes</h1>
        <p className="text-sm text-zinc-500">
          Agrupe atendentes por equipe. Use departamentos para organização hierárquica.
        </p>
      </header>

      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <input
              className="col-span-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="Nome da equipe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select
              className="col-span-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">Sem departamento</option>
              {departments?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Criar equipe
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Equipes</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {isLoading && <li className="p-4 text-sm text-zinc-500">Carregando…</li>}
            {!isLoading && !teams?.items.length && (
              <li className="p-4 text-sm text-zinc-500">Nenhuma equipe criada ainda.</li>
            )}
            {teams?.items.map((t) => (
              <li
                key={t.id}
                className={`flex cursor-pointer items-center justify-between gap-2 p-4 hover:bg-zinc-100 dark:hover:bg-zinc-900/40 ${
                  selectedTeamId === t.id ? "bg-blue-500/5" : ""
                }`}
                onClick={() => setSelectedTeamId(t.id)}
              >
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-zinc-500">
                    {t.department?.name ?? "Sem departamento"}
                  </div>
                </div>
                {canManage && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Excluir "${t.name}"?`)) remove.mutate(t.id);
                    }}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {selectedTeamId && (
          <TeamMembers teamId={selectedTeamId} canManage={canManage} wsId={wsId} />
        )}
      </div>
    </div>
  );
}

function TeamMembers({
  teamId,
  canManage,
  wsId,
}: {
  teamId: string;
  canManage: boolean;
  wsId: string;
}) {
  const qc = useQueryClient();
  const { data: members } = useQuery({
    queryKey: ["team-members", wsId, teamId],
    queryFn: () => teamsApi.listMembers(wsId, teamId).then((r) => r.data as { items: TeamMemberRow[] }),
  });

  const { data: workspaceMembers } = useQuery({
    queryKey: ["workspace-members", wsId],
    queryFn: () =>
      workspacesApi.listMembers(wsId).then((r) => {
        const raw = r.data as { members?: WorkspaceMember[] } | WorkspaceMember[];
        return Array.isArray(raw) ? raw : raw.members ?? [];
      }),
    enabled: canManage,
  });

  const addMember = useMutation({
    mutationFn: (userId: string) => teamsApi.addMember(wsId, teamId, { user_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members", wsId, teamId] });
    },
    onError: () => toast.error("Falha ao adicionar membro"),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(wsId, teamId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members", wsId, teamId] });
    },
  });

  const memberIDs = new Set(members?.items.map((m) => m.user_id) ?? []);
  const addable = (workspaceMembers ?? []).filter((m) => !memberIDs.has(m.user_id));

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-500">
        <UserPlus className="h-4 w-4" />
        Membros
      </h2>
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {!members?.items.length && (
          <li className="p-4 text-sm text-zinc-500">Sem membros. Adicione abaixo.</li>
        )}
        {members?.items.map((m) => (
          <li key={m.id} className="flex items-center justify-between p-3">
            <div>
              <div className="text-sm font-medium">{m.user_name || m.user_email}</div>
              <div className="text-xs text-zinc-500">{m.user_email}</div>
            </div>
            {canManage && (
              <button
                onClick={() => removeMember.mutate(m.user_id)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && addable.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <div className="mb-2 text-xs font-medium text-zinc-500">Adicionar à equipe</div>
          <div className="flex flex-wrap gap-2">
            {addable.map((m) => (
              <button
                key={m.user_id}
                onClick={() => addMember.mutate(m.user_id)}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-600 dark:border-zinc-700"
              >
                + {m.user?.name || m.user?.email || m.user_id.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Forbidden() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Lock className="h-10 w-10 text-zinc-400" />
      <p className="text-sm text-zinc-500">Sem permissão para ver equipes.</p>
    </div>
  );
}
