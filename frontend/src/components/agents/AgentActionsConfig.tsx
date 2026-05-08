"use client";

// AgentActionsConfig — toggles para as ações nativas que o agente pode
// executar dentro da Uniq durante uma conversa (add_tag, criar tarefa,
// agendar reunião, etc) + política de confirmação. Os toggles são
// persistidos como entradas do array app_access (type="action") pra
// reusar a infra existente; o backend lê via parseEnabledTools.

import { Bot, BookmarkPlus, ClipboardList, FileText, MessageSquareWarning, NotebookPen, Tag, UserMinus, UsersRound } from "lucide-react";

type ActionId =
  | "add_tag"
  | "remove_tag"
  | "note"
  | "create_task"
  | "schedule_meeting"
  | "transfer_to_human";

type AppAccessEntry = {
  id: string;
  name: string;
  type: string;
  target: string;
  description: string;
  enabled: boolean;
};

const ACTIONS: Array<{
  id: ActionId;
  label: string;
  description: string;
  icon: any;
}> = [
  { id: "add_tag",           label: "Adicionar tag",       description: "Marca o contato com uma tag (ex: VIP, comprador, lead-quente).", icon: Tag },
  { id: "remove_tag",        label: "Remover tag",         description: "Tira uma tag do contato.",                                       icon: BookmarkPlus },
  { id: "note",              label: "Anotar no CRM",       description: "Registra uma nota interna na timeline do contato.",               icon: NotebookPen },
  { id: "create_task",       label: "Criar tarefa",        description: "Abre tarefa pra time humano (ex: ligar amanhã, enviar proposta).", icon: ClipboardList },
  { id: "schedule_meeting",  label: "Agendar reunião",     description: "Cria reunião na agenda do CRM com horário sugerido.",             icon: FileText },
  { id: "transfer_to_human", label: "Transferir pra humano", description: "Desliga o bot e passa a conversa pro atendimento humano.",       icon: UserMinus },
];

const CONFIRMATION_OPTIONS = [
  { value: "client", label: "Pergunta no chat",    description: "Agente confirma com o cliente antes de executar (default)." },
  { value: "auto",   label: "Executa direto",       description: "Sem confirmação. Use só quando o agente é experiente e o risco é baixo." },
  { value: "human",  label: "Aprovação humana",     description: "Cria tarefa no painel pra time aprovar antes de executar." },
];

function uid() { return Math.random().toString(36).slice(2, 10); }

export function AgentActionsConfig({
  appAccess,
  confirmation,
  onChangeAppAccess,
  onChangeConfirmation,
}: {
  appAccess: AppAccessEntry[];
  confirmation: "client" | "auto" | "human";
  onChangeAppAccess: (next: AppAccessEntry[]) => void;
  onChangeConfirmation: (v: "client" | "auto" | "human") => void;
}) {
  const isEnabled = (id: ActionId) =>
    appAccess.some((e) => e.type === "action" && e.name === id && e.enabled);

  const toggle = (id: ActionId) => {
    const idx = appAccess.findIndex((e) => e.type === "action" && e.name === id);
    if (idx >= 0) {
      const next = [...appAccess];
      next[idx] = { ...next[idx], enabled: !next[idx].enabled };
      onChangeAppAccess(next);
    } else {
      onChangeAppAccess([
        ...appAccess,
        {
          id: uid(),
          name: id,
          type: "action",
          target: "",
          description: ACTIONS.find((a) => a.id === id)?.description || "",
          enabled: true,
        },
      ]);
    }
  };

  const enabledCount = ACTIONS.filter((a) => isEnabled(a.id)).length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-1)" }}>
          <Bot className="w-4 h-4" style={{ color: "#a78bfa" }} />
          Ações dentro da Uniq
        </h3>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
          O agente pode executar ações no sistema durante a conversa (taguear, agendar, anotar). Liga só o que faz sentido pro fluxo dele.
        </p>
      </div>

      <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>Política de confirmação</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {CONFIRMATION_OPTIONS.map((opt) => {
            const active = confirmation === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeConfirmation(opt.value as any)}
                className="text-left rounded-lg p-2.5 transition"
                style={{
                  background: active ? "rgba(0,212,106,0.08)" : "var(--surface-3)",
                  border: `1px solid ${active ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
                }}
              >
                <p className="text-xs font-medium" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>{opt.label}</p>
                <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Ações habilitadas</p>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {enabledCount}/{ACTIONS.length} ativas
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            const on = isEnabled(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className="text-left rounded-xl p-3 transition flex items-start gap-2"
                style={{
                  background: on ? "rgba(0,212,106,0.06)" : "var(--surface-2)",
                  border: `1px solid ${on ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                }}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: on ? "var(--green)" : "var(--text-3)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{a.label}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{a.description}</p>
                </div>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: on ? "rgba(0,212,106,0.15)" : "var(--surface-3)",
                    color: on ? "var(--green)" : "var(--text-3)",
                  }}
                >
                  {on ? "ON" : "OFF"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
        <UsersRound className="w-3 h-3 inline mr-1" />
        O agente vai mencionar a ação no chat antes de executar (em modo &quot;Pergunta no chat&quot;) e usa o marker
        <code className="text-[10px] mx-1 px-1 rounded" style={{ background: "var(--surface-3)", color: "#a5b4fc" }}>{"[[action:nome({...})]]"}</code>
        que o backend remove automaticamente da resposta.
      </p>
    </div>
  );
}
