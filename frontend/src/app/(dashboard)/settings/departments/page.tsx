"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Lock } from "lucide-react";
import { departmentsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

interface Department {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  is_active: boolean;
  sort_order: number;
}

export default function DepartmentsPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.departmentsView);
  const canManage = hasPerm(PERM.departmentsManage);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#64748b");

  const { data, isLoading } = useQuery({
    queryKey: ["departments", wsId],
    queryFn: () => departmentsApi.list(wsId as string).then((r) => r.data as { items: Department[] }),
    enabled: !!wsId && canView,
  });

  const create = useMutation({
    mutationFn: () =>
      departmentsApi.create(wsId as string, { name, description, color }),
    onSuccess: () => {
      toast.success("Departamento criado");
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["departments", wsId] });
    },
    onError: () => toast.error("Falha ao criar departamento"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => departmentsApi.delete(wsId as string, id),
    onSuccess: () => {
      toast.success("Departamento removido");
      qc.invalidateQueries({ queryKey: ["departments", wsId] });
    },
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) return <Forbidden />;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Departamentos</h1>
        <p className="text-sm text-zinc-500">
          Organize filas e equipes por departamento (Vendas, Suporte, Financeiro…).
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
              placeholder="Nome do departamento"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="col-span-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 md:col-span-2"
              placeholder="Descrição (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Cor
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-6 w-10 cursor-pointer rounded border border-zinc-200"
              />
            </label>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Criar
            </button>
          </div>
        </form>
      )}

      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {isLoading && <li className="p-6 text-sm text-zinc-500">Carregando…</li>}
        {!isLoading && !data?.items.length && (
          <li className="p-6 text-sm text-zinc-500">Nenhum departamento criado ainda.</li>
        )}
        {data?.items.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: d.color || "#64748b" }}
              />
              <div>
                <div className="font-medium">{d.name}</div>
                {d.description && <p className="text-xs text-zinc-500">{d.description}</p>}
              </div>
            </div>
            {canManage && (
              <button
                onClick={() => {
                  if (confirm(`Excluir "${d.name}"?`)) remove.mutate(d.id);
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
    </div>
  );
}

function Forbidden() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Lock className="h-10 w-10 text-zinc-400" />
      <p className="text-sm text-zinc-500">Sem permissão para ver departamentos.</p>
    </div>
  );
}
