"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Lock, Settings2, X } from "lucide-react";
import {
  queuesApi, departmentsApi, teamsApi, workspacesApi, instancesApi,
  type QueueAssignmentStrategy,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface Queue {
  id: string;
  name: string;
  description?: string;
  color?: string;
  department_id?: string | null;
  team_id?: string | null;
  department?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
  assignment_strategy: QueueAssignmentStrategy;
  auto_assign_on_open: boolean;
  max_concurrent_per_user: number;
  reopen_window_minutes: number;
  enable_chatbot: boolean;
  is_active: boolean;
  priority: number;
}

interface Department { id: string; name: string }
interface Team { id: string; name: string }

interface QueueMemberRow {
  id: string;
  queue_id: string;
  user_id: string;
  can_receive: boolean;
  priority: number;
  user_name: string;
  user_email: string;
}

interface QueueChannelRow {
  queue_id: string;
  instance_id: string;
  is_default: boolean;
  instance_name: string;
  instance_channel: string;
}

interface WorkspaceMember {
  user_id: string;
  user?: { id: string; name: string; email: string };
}

interface Instance {
  id: string;
  name: string;
  channel: string;
  status: string;
}

const STRATEGIES: { value: QueueAssignmentStrategy; label: string; hint: string }[] = [
  { value: "round_robin",   label: "Round-Robin",     hint: "Rotaciona entre agentes online (cursor por último atendido)" },
  { value: "least_busy",    label: "Menos ocupado",   hint: "Atribui a quem tem menos conversas abertas" },
  { value: "load_balanced", label: "Balanceado",      hint: "Aleatório ponderado por prioridade × 1/carga" },
  { value: "sticky_owner",  label: "Dono do contato", hint: "Prioriza o owner_id do contato se online" },
  { value: "manual",        label: "Manual",          hint: "Fica na fila até alguém puxar" },
];

export default function QueuesPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.queuesView);
  const canManage = hasPerm(PERM.queuesManage);

  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState<QueueAssignmentStrategy>("round_robin");
  const [depId, setDepId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [editing, setEditing] = useState<Queue | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);

  const { data: queues, isLoading } = useQuery({
    queryKey: ["queues", wsId],
    queryFn: () => queuesApi.list(wsId as string).then((r) => r.data as { items: Queue[] }),
    enabled: !!wsId && canView,
  });

  const { data: departments } = useQuery({
    queryKey: ["departments", wsId],
    queryFn: () => departmentsApi.list(wsId as string).then((r) => r.data as { items: Department[] }),
    enabled: !!wsId && canView,
  });

  const { data: teams } = useQuery({
    queryKey: ["teams", wsId],
    queryFn: () => teamsApi.list(wsId as string).then((r) => r.data as { items: Team[] }),
    enabled: !!wsId && canView,
  });

  const create = useMutation({
    mutationFn: () =>
      queuesApi.create(wsId as string, {
        name,
        assignment_strategy: strategy,
        department_id: depId || undefined,
        team_id: teamId || undefined,
      }),
    onSuccess: () => {
      toast.success("Fila criada");
      setName("");
      setDepId("");
      setTeamId("");
      setStrategy("round_robin");
      qc.invalidateQueries({ queryKey: ["queues", wsId] });
    },
    onError: () => toast.error("Falha ao criar fila"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => queuesApi.delete(wsId as string, id),
    onSuccess: () => {
      toast.success("Fila removida");
      qc.invalidateQueries({ queryKey: ["queues", wsId] });
      if (editing) setEditing(null);
    },
  });

  if (!wsId || permsLoading) return <div className="p-6">Carregando…</div>;
  if (!canView) return <Forbidden />;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Filas</h1>
        <p className="text-sm text-zinc-500">
          Defina como os atendimentos são distribuídos: estratégia, horário, SLA e canais.
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="Nome da fila"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as QueueAssignmentStrategy)}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={depId}
              onChange={(e) => setDepId(e.target.value)}
            >
              <option value="">Sem departamento</option>
              {departments?.items.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">Sem equipe</option>
              {teams?.items.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Criar fila
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {STRATEGIES.find((s) => s.value === strategy)?.hint}
          </p>
        </form>
      )}

      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {isLoading && <li className="p-6 text-sm text-zinc-500">Carregando…</li>}
        {!isLoading && !queues?.items.length && (
          <li className="p-6 text-sm text-zinc-500">Nenhuma fila criada ainda.</li>
        )}
        {queues?.items.map((q) => (
          <li key={q.id} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: q.color || "#64748b" }} />
              <div>
                <div className="flex items-center gap-2 font-medium">
                  {q.name}
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {STRATEGIES.find((s) => s.value === q.assignment_strategy)?.label ?? q.assignment_strategy}
                  </span>
                  {!q.auto_assign_on_open && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                      manual
                    </span>
                  )}
                  {q.enable_chatbot && (
                    <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-700 dark:text-purple-400">
                      chatbot
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {q.department?.name && `${q.department.name} · `}
                  {q.team?.name ?? "Sem equipe"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canManage && (
                <>
                  <button
                    onClick={() => setEditing(q)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:border-blue-500 hover:text-blue-600 dark:border-zinc-700"
                  >
                    <Settings2 className="h-3.5 w-3.5" /> Configurar
                  </button>
                  <button
                    onClick={() => setConfirmDel({ id: q.id, name: q.name })}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <QueueDrawer
          queue={editing}
          wsId={wsId}
          canManage={canManage}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="Excluir fila"
          body={<>A fila <span style={{ color: "hsl(240 15% 92%)" }}>&quot;{confirmDel.name}&quot;</span> será removida. Atendimentos em curso permanecem mas não recebem novos.</>}
          confirmLabel="Excluir"
          variant="danger"
          onConfirm={() => {
            remove.mutate(confirmDel.id);
            setConfirmDel(null);
          }}
          onCancel={() => setConfirmDel(null)}
          isPending={remove.isPending}
        />
      )}
    </div>
  );
}

function QueueDrawer({
  queue,
  wsId,
  canManage,
  onClose,
}: {
  queue: Queue;
  wsId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"settings" | "members" | "channels">("settings");

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="flex w-full max-w-xl flex-col bg-white shadow-xl dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h2 className="font-semibold">{queue.name}</h2>
            <p className="text-xs text-zinc-500">
              {queue.department?.name || "Sem departamento"} · {queue.team?.name || "Sem equipe"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex border-b border-zinc-200 dark:border-zinc-800">
          {(["settings", "members", "channels"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2 text-sm ${
                tab === t
                  ? "border-b-2 border-blue-500 font-medium text-blue-600 dark:text-blue-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t === "settings" ? "Configurações" : t === "members" ? "Membros" : "Canais"}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-auto p-4">
          {tab === "settings" && <QueueSettings queue={queue} wsId={wsId} canManage={canManage} onSaved={() => qc.invalidateQueries({ queryKey: ["queues", wsId] })} />}
          {tab === "members" && <QueueMembers queueId={queue.id} wsId={wsId} canManage={canManage} />}
          {tab === "channels" && <QueueChannels queueId={queue.id} wsId={wsId} canManage={canManage} />}
        </div>
      </div>
    </div>
  );
}

function QueueSettings({
  queue, wsId, canManage, onSaved,
}: {
  queue: Queue;
  wsId: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [strategy, setStrategy] = useState<QueueAssignmentStrategy>(queue.assignment_strategy);
  const [maxConcurrent, setMaxConcurrent] = useState(queue.max_concurrent_per_user);
  const [reopenWindow, setReopenWindow] = useState(queue.reopen_window_minutes);
  const [autoAssign, setAutoAssign] = useState(queue.auto_assign_on_open);
  const [enableChatbot, setEnableChatbot] = useState(queue.enable_chatbot);
  const [priority, setPriority] = useState(queue.priority);

  const save = useMutation({
    mutationFn: () =>
      queuesApi.patch(wsId, queue.id, {
        assignment_strategy: strategy,
        max_concurrent_per_user: maxConcurrent,
        reopen_window_minutes: reopenWindow,
        auto_assign_on_open: autoAssign,
        enable_chatbot: enableChatbot,
        priority,
      }),
    onSuccess: () => {
      toast.success("Fila atualizada");
      onSaved();
    },
    onError: () => toast.error("Falha ao salvar"),
  });

  return (
    <div className="space-y-4">
      <Field label="Estratégia de atribuição">
        <select
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as QueueAssignmentStrategy)}
          disabled={!canManage}
        >
          {STRATEGIES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">{STRATEGIES.find((s) => s.value === strategy)?.hint}</p>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Máx. atendimentos simultâneos por agente (0 = ilimitado)">
          <input
            type="number"
            min={0}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            disabled={!canManage}
          />
        </Field>
        <Field label="Janela de auto-reabertura (minutos)">
          <input
            type="number"
            min={0}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={reopenWindow}
            onChange={(e) => setReopenWindow(Number(e.target.value))}
            disabled={!canManage}
          />
        </Field>
      </div>

      <Field label="Prioridade (quanto maior, vence em empate)">
        <input
          type="number"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          disabled={!canManage}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoAssign}
          onChange={(e) => setAutoAssign(e.target.checked)}
          disabled={!canManage}
        />
        Atribuir automaticamente ao abrir
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enableChatbot}
          onChange={(e) => setEnableChatbot(e.target.checked)}
          disabled={!canManage}
        />
        Habilitar chatbot da fila (precede bot-por-instância)
      </label>

      {canManage && (
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Salvar alterações
        </button>
      )}
    </div>
  );
}

function QueueMembers({
  queueId, wsId, canManage,
}: {
  queueId: string; wsId: string; canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data: members } = useQuery({
    queryKey: ["queue-members", wsId, queueId],
    queryFn: () => queuesApi.listMembers(wsId, queueId).then((r) => r.data as { items: QueueMemberRow[] }),
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

  const add = useMutation({
    mutationFn: (userId: string) => queuesApi.addMember(wsId, queueId, { user_id: userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue-members", wsId, queueId] }),
    onError: () => toast.error("Falha ao adicionar"),
  });
  const toggle = useMutation({
    mutationFn: ({ userId, canReceive }: { userId: string; canReceive: boolean }) =>
      queuesApi.updateMember(wsId, queueId, userId, { can_receive: canReceive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue-members", wsId, queueId] }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => queuesApi.removeMember(wsId, queueId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue-members", wsId, queueId] }),
  });

  const memberIDs = new Set(members?.items.map((m) => m.user_id) ?? []);
  const addable = (workspaceMembers ?? []).filter((m) => !memberIDs.has(m.user_id));

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {!members?.items.length && (
          <li className="p-3 text-sm text-zinc-500">Ainda sem membros.</li>
        )}
        {members?.items.map((m) => (
          <li key={m.id} className="flex items-center justify-between p-3">
            <div>
              <div className="text-sm font-medium">{m.user_name || m.user_email}</div>
              <div className="text-xs text-zinc-500">Prioridade {m.priority}</div>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <input
                    type="checkbox"
                    checked={m.can_receive}
                    onChange={(e) => toggle.mutate({ userId: m.user_id, canReceive: e.target.checked })}
                  />
                  Recebendo
                </label>
                <button
                  onClick={() => remove.mutate(m.user_id)}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && addable.length > 0 && (
        <div className="rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <div className="mb-2 text-xs font-medium text-zinc-500">Adicionar à fila</div>
          <div className="flex flex-wrap gap-2">
            {addable.map((m) => (
              <button
                key={m.user_id}
                onClick={() => add.mutate(m.user_id)}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-600 dark:border-zinc-700"
              >
                + {m.user?.name || m.user?.email || m.user_id.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueChannels({
  queueId, wsId, canManage,
}: {
  queueId: string; wsId: string; canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data: channels } = useQuery({
    queryKey: ["queue-channels", wsId, queueId],
    queryFn: () => queuesApi.listChannels(wsId, queueId).then((r) => r.data as { items: QueueChannelRow[] }),
  });
  const { data: instances } = useQuery({
    queryKey: ["instances", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => r.data as Instance[] | { items: Instance[] }),
    enabled: canManage,
  });

  const instanceList: Instance[] = Array.isArray(instances) ? instances : (instances?.items ?? []);
  const boundIDs = new Set(channels?.items.map((c) => c.instance_id) ?? []);
  const addable = instanceList.filter((i) => !boundIDs.has(i.id));

  const add = useMutation({
    mutationFn: ({ instanceId, isDefault }: { instanceId: string; isDefault: boolean }) =>
      queuesApi.addChannel(wsId, queueId, { instance_id: instanceId, is_default: isDefault }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue-channels", wsId, queueId] }),
    onError: () => toast.error("Falha ao vincular canal"),
  });
  const remove = useMutation({
    mutationFn: (instanceId: string) => queuesApi.removeChannel(wsId, queueId, instanceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue-channels", wsId, queueId] }),
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Instâncias vinculadas alimentam esta fila. Marcar “padrão” garante que novas conversas
        dessa instância caiam aqui quando não houver outra regra aplicável.
      </p>
      <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {!channels?.items.length && (
          <li className="p-3 text-sm text-zinc-500">Nenhum canal vinculado.</li>
        )}
        {channels?.items.map((c) => (
          <li key={c.instance_id} className="flex items-center justify-between p-3">
            <div>
              <div className="text-sm font-medium">{c.instance_name}</div>
              <div className="text-xs text-zinc-500">
                {c.instance_channel}
                {c.is_default && " · padrão"}
              </div>
            </div>
            {canManage && (
              <button
                onClick={() => remove.mutate(c.instance_id)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && addable.length > 0 && (
        <div className="rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <div className="mb-2 text-xs font-medium text-zinc-500">Vincular instância</div>
          <div className="flex flex-wrap gap-2">
            {addable.map((i) => (
              <button
                key={i.id}
                onClick={() => add.mutate({ instanceId: i.id, isDefault: false })}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-600 dark:border-zinc-700"
              >
                + {i.name} <span className="text-zinc-500">({i.channel})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Forbidden() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Lock className="h-10 w-10 text-zinc-400" />
      <p className="text-sm text-zinc-500">Sem permissão para ver filas.</p>
    </div>
  );
}
