"use client";

// Conversational Builder de Jornadas — UX agent-os style.
//
// O canvas ReactFlow continua disponível em /journeys/[id]/canvas pra
// edição avançada, mas a entrada principal aqui é CHAT com Uniq AI:
//
//   1. User descreve o que quer ("manda boas-vindas + pergunta o
//      objetivo + cria deal no CRM")
//   2. IA gera o flow inteiro via FlowBuilder.Build no primeiro turno
//      ou edita via FlowBuilder.Edit nos turnos seguintes
//   3. Preview vertical à direita reflete o flow em tempo real
//   4. Steps modificados ganham highlight verde "novo" por 4s
//
// Mesma DNA do Studio de Agentes — split-view, IA como copiloto,
// canvas como modo avançado opcional.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Send,
  Sparkles,
  Loader2,
  PlayCircle,
  PauseCircle,
  Pencil,
  MessageSquare,
  Hand,
  Clock,
  GitBranch,
  Tag,
  Webhook,
  HandHelping,
  Network,
  Wand2,
  AlertTriangle,
  UserPlus,
  Mail,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";
import { JourneyPreview } from "@/components/journeys/JourneyPreview";
import { EnrollContactsModal } from "@/components/journeys/EnrollContactsModal";

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
};

type FlowStep = {
  id: string;
  type: string;
  label?: string;
  config?: any;
  next_step_id?: string;
  branch_true?: string;
  branch_false?: string;
  is_start_step?: boolean;
};

type JourneyFlow = {
  start_step?: string;
  steps?: FlowStep[];
};

const QUICK_ACTIONS: Array<{
  label: string;
  prompt: string;
  icon: typeof MessageSquare;
  color: string;
}> = [
  { label: "WhatsApp msg",        prompt: "Adicione uma mensagem WhatsApp com o texto: ",             icon: MessageSquare, color: "#00d46a" },
  { label: "Email",               prompt: "Envie um email com assunto e corpo: ",                     icon: Mail,          color: "#3b82f6" },
  { label: "SMS",                 prompt: "Envie um SMS com o texto: ",                                icon: Smartphone,    color: "#ec4899" },
  { label: "Adicionar pergunta",  prompt: "Adicione uma pergunta ao usuário: ",                       icon: Hand,          color: "#fbbf24" },
  { label: "Adicionar espera",    prompt: "Adicione um wait de ",                                     icon: Clock,         color: "#a78bfa" },
  { label: "Adicionar condição",  prompt: "Adicione uma condição que checa: ",                        icon: GitBranch,     color: "#f97316" },
  { label: "Adicionar tag",       prompt: "Após o último step, adicione tag no contato: ",            icon: Tag,           color: "#10b981" },
  { label: "Resposta IA",         prompt: "Use IA pra responder a última mensagem do usuário com: ",  icon: Bot,           color: "#a5b4fc" },
  { label: "Webhook externo",     prompt: "Faça uma chamada HTTP pra: ",                              icon: Webhook,       color: "#94a3b8" },
  { label: "Transferir pra humano", prompt: "Adicione handoff pra atendente humano com a msg: ",      icon: HandHelping,   color: "#fb923c" },
];

export default function JourneyConversationalBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [changedStepIds, setChangedStepIds] = useState<Set<string>>(new Set());
  const [enrollOpen, setEnrollOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const journeyQ = useQuery({
    queryKey: ["journey", params.id],
    queryFn: () => journeysApi.get(params.id).then((r) => r.data),
    enabled: !!params.id,
  });

  const journey = journeyQ.data as any;
  const flow: JourneyFlow | null = useMemo(() => {
    if (!journey?.flow) return null;
    if (typeof journey.flow === "string") {
      try {
        return JSON.parse(journey.flow);
      } catch {
        return null;
      }
    }
    return journey.flow;
  }, [journey?.flow]);

  // Welcome message — uma vez quando carrega journey. Texto difere
  // se a jornada já tem flow (edição) ou está vazia (criação).
  useEffect(() => {
    if (!journey || messages.length > 0) return;
    const hasFlow = !!flow?.steps?.length;
    setMessages([
      {
        id: rand(),
        role: "assistant",
        text: hasFlow
          ? `Oi! Sou a Uniq AI. Esta jornada tem ${flow!.steps!.length} passo${
              flow!.steps!.length !== 1 ? "s" : ""
            }. Quer ajustar algo? Pode pedir em texto ou usar os atalhos abaixo.`
          : "Oi! Sou a Uniq AI. Descreve aqui o que essa jornada deve fazer (ex: \"manda boas-vindas, pergunta o objetivo do cliente, cria um deal no CRM\") e eu monto os passos pra você.",
        ts: Date.now(),
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey?.id]);

  // Auto-scroll quando chega mensagem nova ou loading aparece.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Edit/Build via LLM — backend escolhe Build (sem flow) ou Edit (com flow)
  const editMut = useMutation({
    mutationFn: async (instruction: string) => {
      const r = await journeysApi.editWithLLM(params.id, instruction);
      return r.data as { flow?: JourneyFlow; ok?: boolean };
    },
    onSuccess: (data) => {
      const newFlow = data?.flow as JourneyFlow | undefined;
      // Diff: marca steps modificados/criados pra highlight verde 4s.
      // Comparação por JSON.stringify pega mudanças em config também.
      if (newFlow?.steps && flow?.steps) {
        const oldMap = new Map(flow.steps.map((s) => [s.id, JSON.stringify(s)]));
        const changed = new Set<string>();
        for (const s of newFlow.steps) {
          const old = oldMap.get(s.id);
          if (!old || old !== JSON.stringify(s)) changed.add(s.id);
        }
        setChangedStepIds(changed);
        setTimeout(() => setChangedStepIds(new Set()), 4000);
      } else if (newFlow?.steps) {
        // flow novo do zero — destaca tudo
        setChangedStepIds(new Set(newFlow.steps.map((s) => s.id)));
        setTimeout(() => setChangedStepIds(new Set()), 4000);
      }
      qc.invalidateQueries({ queryKey: ["journey", params.id] });
      const stepCount = newFlow?.steps?.length ?? 0;
      setMessages((prev) => [
        ...prev,
        {
          id: rand(),
          role: "assistant",
          text: stepCount
            ? `Pronto. Agora a jornada tem ${stepCount} passo${stepCount !== 1 ? "s" : ""}. Olha o preview ao lado e me diz se precisa ajustar.`
            : "Apliquei a mudança. Confere o preview ao lado.",
          ts: Date.now(),
        },
      ]);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || "Não consegui aplicar a mudança.";
      setMessages((prev) => [
        ...prev,
        {
          id: rand(),
          role: "assistant",
          text: `⚠ ${msg}`,
          ts: Date.now(),
        },
      ]);
    },
  });

  const toggleStatusMut = useMutation({
    mutationFn: () =>
      journeysApi.updateStatus(params.id, journey?.is_active ? "paused" : "active"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journey", params.id] });
      toast.success(journey?.is_active ? "Jornada pausada" : "Jornada ativada");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Não foi possível alterar o status"),
  });

  const submit = (preset?: string) => {
    const instruction = (preset ?? input).trim();
    if (!instruction || editMut.isPending) return;
    setMessages((prev) => [
      ...prev,
      { id: rand(), role: "user", text: instruction, ts: Date.now() },
    ]);
    setInput("");
    editMut.mutate(instruction);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  if (journeyQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-3)" }} />
      </div>
    );
  }

  if (journeyQ.error || !journey) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <AlertTriangle className="w-7 h-7" style={{ color: "#ef4444" }} />
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          Não foi possível carregar a jornada.
        </p>
        <button
          onClick={() => router.push("/journeys")}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
        >
          Voltar
        </button>
      </div>
    );
  }

  const isActive = !!journey.is_active;

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--surface-base)" }}>
      {/* Header */}
      <header
        className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 flex-shrink-0 flex-wrap"
        style={{ borderBottom: "1px solid var(--surface-border)" }}
      >
        <button
          onClick={() => router.push("/journeys")}
          className="p-1.5 rounded-lg hover:bg-white/5 flex-shrink-0"
          style={{ color: "var(--text-3)" }}
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.05))",
            border: "1px solid rgba(0,212,106,0.30)",
            color: "var(--green)",
          }}
        >
          <Wand2 className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
            {journey.name || "Jornada sem nome"}
          </p>
          <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
            {flow?.steps?.length ?? 0} passo{(flow?.steps?.length ?? 0) !== 1 ? "s" : ""} ·{" "}
            {journey.trigger_type || "sem trigger"}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setEnrollOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg"
            style={{
              background: "rgba(0,212,106,0.10)",
              border: "1px solid rgba(0,212,106,0.25)",
              color: "var(--green)",
            }}
            title="Enrolar contatos manualmente nesta jornada"
          >
            <UserPlus className="w-3 h-3" />
            <span className="hidden sm:inline">Enrolar contatos</span>
          </button>
          <button
            onClick={() => router.push(`/journeys/${params.id}/canvas`)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-2)",
            }}
            title="Editar no canvas (modo avançado)"
          >
            <Network className="w-3 h-3" />
            <span className="hidden sm:inline">Canvas</span>
          </button>
          <button
            onClick={() => toggleStatusMut.mutate()}
            disabled={toggleStatusMut.isPending}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
            style={
              isActive
                ? {
                    background: "rgba(0,212,106,0.12)",
                    border: "1px solid rgba(0,212,106,0.30)",
                    color: "var(--green)",
                  }
                : {
                    background: "var(--surface-2)",
                    border: "1px solid var(--surface-border)",
                    color: "var(--text-3)",
                  }
            }
          >
            {toggleStatusMut.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : isActive ? (
              <PauseCircle className="w-3 h-3" />
            ) : (
              <PlayCircle className="w-3 h-3" />
            )}
            {isActive ? "Ativa" : "Pausada"}
          </button>
        </div>
      </header>

      {/* Split: chat (esquerda) + preview (direita) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* CHAT */}
        <section
          className="flex-1 min-w-0 flex flex-col"
          style={{ borderRight: "1px solid var(--surface-border)" }}
        >
          {/* Mensagens */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
            {messages.map((m) => (
              <ChatBubble key={m.id} msg={m} />
            ))}
            {editMut.isPending && (
              <div className="flex items-center gap-2 px-3 py-2">
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--text-3)" }} />
                <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  Uniq AI montando a mudança…
                </span>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div
            className="px-3 sm:px-5 py-2 flex-shrink-0 overflow-x-auto"
            style={{ borderTop: "1px solid var(--surface-border)" }}
          >
            <div className="flex items-center gap-1.5 flex-nowrap">
              {QUICK_ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => {
                      setInput(a.prompt);
                      inputRef.current?.focus();
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full whitespace-nowrap"
                    style={{
                      background: `${a.color}14`,
                      color: a.color,
                      border: `1px solid ${a.color}33`,
                    }}
                    title={a.prompt}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Composer */}
          <div
            className="px-3 sm:px-5 py-3 flex-shrink-0"
            style={{
              borderTop: "1px solid var(--surface-border)",
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }}
          >
            <div
              className="flex items-end gap-2 rounded-xl px-3 py-2"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
              }}
            >
              <Sparkles className="w-3.5 h-3.5 mt-1 flex-shrink-0" style={{ color: "#a5b4fc" }} />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Descreva o que a jornada deve fazer ou peça uma mudança…"
                className="flex-1 bg-transparent outline-none text-xs resize-none"
                style={{ color: "var(--text-1)", maxHeight: 140, minHeight: 22 }}
                rows={1}
              />
              <button
                onClick={() => submit()}
                disabled={!input.trim() || editMut.isPending}
                className="p-1.5 rounded-lg disabled:opacity-40 flex-shrink-0"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}
              >
                {editMut.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="text-[9px] mt-1 px-1" style={{ color: "var(--text-4)" }}>
              Enter envia · Shift+Enter quebra linha · IA gera ou edita o flow conforme você descreve.
            </p>
          </div>
        </section>

        {/* PREVIEW */}
        <aside className="w-full lg:w-[420px] xl:w-[480px] flex-shrink-0 overflow-y-auto px-3 sm:px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--text-4)" }}
            >
              Preview da jornada
            </p>
            {changedStepIds.size > 0 && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{
                  background: "rgba(0,212,106,0.10)",
                  color: "var(--green)",
                  border: "1px solid rgba(0,212,106,0.20)",
                }}
              >
                {changedStepIds.size} alterado{changedStepIds.size !== 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={() => router.push(`/journeys/${params.id}/canvas`)}
              className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-3)",
                border: "1px solid var(--surface-border)",
              }}
              title="Editar no canvas avançado"
            >
              <Pencil className="w-2.5 h-2.5" />
              canvas
            </button>
          </div>
          <JourneyPreview flow={flow} changedStepIds={changedStepIds} />
        </aside>
      </div>

      {/* Modal de enrollment proativo (Fase 2) */}
      {enrollOpen && (
        <EnrollContactsModal
          journeyId={params.id}
          journeyName={journey.name || "Jornada sem nome"}
          onClose={() => setEnrollOpen(false)}
        />
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-xl px-3 py-2"
        style={
          isUser
            ? {
                background: "var(--green)",
                color: "var(--green-fg)",
                borderTopRightRadius: 4,
              }
            : {
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
                color: "var(--text-1)",
                borderTopLeftRadius: 4,
              }
        }
      >
        <p className="text-xs whitespace-pre-wrap break-words">{msg.text}</p>
      </div>
    </div>
  );
}

function rand() {
  return Math.random().toString(36).slice(2, 10);
}
