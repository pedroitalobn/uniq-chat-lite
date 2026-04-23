"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Lock, Lightbulb } from "lucide-react";
import { quickRepliesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";

interface QuickReply {
  id: string;
  shortcut: string;
  title?: string;
  body: string;
  owner_user_id?: string | null;
  usage_count: number;
  is_active: boolean;
}

export default function QuickRepliesPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.ticketsView);
  const canManageOwn = hasPerm(PERM.ticketsView); // owned by author — base permission
  const canManageShared = hasPerm("quickreplies:manage_shared");

  const [scope, setScope] = useState<"all" | "mine" | "workspace">("all");
  const [shortcut, setShortcut] = useState("/");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["quick-replies", wsId, scope],
    queryFn: () =>
      quickRepliesApi.list(wsId as string, scope).then((r) => r.data as { items: QuickReply[] }),
    enabled: !!wsId && canView,
  });

  const create = useMutation({
    mutationFn: () =>
      quickRepliesApi.create(wsId as string, { shortcut, title, body, shared }),
    onSuccess: () => {
      toast.success("Resposta rápida criada");
      setShortcut("/");
      setTitle("");
      setBody("");
      setShared(false);
      qc.invalidateQueries({ queryKey: ["quick-replies", wsId] });
    },
    onError: () => toast.error("Falha ao criar"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => quickRepliesApi.delete(wsId as string, id),
    onSuccess: () => {
      toast.success("Excluída");
      qc.invalidateQueries({ queryKey: ["quick-replies", wsId] });
    },
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-zinc-400" />
        <p className="text-sm text-zinc-500">Sem permissão.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Respostas rápidas</h1>
        <p className="text-sm text-zinc-500">
          Atalhos que o atendente usa no composer digitando <code className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-zinc-800">/shortcut</code>.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) create.mutate();
        }}
        className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="/saudacao"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
          />
          <input
            className="col-span-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Título (opcional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <textarea
          className="w-full min-h-24 resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="Corpo da mensagem. Use variáveis como {{contact.name}} (renderização na Fase 3+)."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={shared}
              disabled={!canManageShared}
              onChange={(e) => setShared(e.target.checked)}
            />
            Compartilhada com o workspace{" "}
            {!canManageShared && <span className="text-[10px]">(exige quickreplies:manage_shared)</span>}
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

      <div className="flex items-center gap-2 text-xs">
        {(["all", "mine", "workspace"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-full px-3 py-1 ${
              scope === s
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {s === "all" ? "Todas" : s === "mine" ? "Minhas" : "Do workspace"}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {isLoading && <li className="p-6 text-sm text-zinc-500">Carregando…</li>}
        {!isLoading && !data?.items.length && (
          <li className="flex items-center gap-2 p-6 text-sm text-zinc-500">
            <Lightbulb className="h-4 w-4" /> Ainda sem respostas rápidas nesse escopo.
          </li>
        )}
        {data?.items.map((qr) => (
          <li key={qr.id} className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  {qr.shortcut || "—"}
                </span>
                {qr.title && <span className="font-medium">{qr.title}</span>}
                {!qr.owner_user_id && (
                  <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                    workspace
                  </span>
                )}
                <span className="ml-auto text-[10px] text-zinc-500">{qr.usage_count} usos</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{qr.body}</p>
            </div>
            <button
              onClick={() => {
                if (confirm("Excluir resposta rápida?")) remove.mutate(qr.id);
              }}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
