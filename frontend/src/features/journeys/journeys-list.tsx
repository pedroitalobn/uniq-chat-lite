"use client";

// Lista de jornadas + edição inline + modal de edição via IA.
// Antes vivia em /agents/page.tsx::JourneysSection — extraído para que o
// módulo /journeys seja standalone (sem dependência do hub /agents).

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity, ChevronDown, ChevronUp, Circle, Clock, Copy, Edit3, Loader2, Pause,
  Play, Plus, Search, Send, Sparkles as SparklesIcon, Trash2, TrendingUp, User, Wand2,
  X, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { agentsApi, journeysApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FlowPreview, type Message, ThinkingDots } from "@/features/uniq-ai/atoms";

// EditableName — clique no título da jornada pra editar inline. Enter
// confirma, Escape/blur sem alteração cancela.
function EditableName({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onBlur={commit}
        className="text-sm font-medium bg-transparent outline-none border-b truncate min-w-0 flex-1"
        style={{ color: "var(--text-1)", borderColor: "var(--green)" }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className="text-sm font-medium truncate text-left hover:underline decoration-dotted underline-offset-2 min-w-0 flex-1"
      style={{ color: "var(--text-1)" }}
      title="Clique pra editar o nome"
    >
      {value}
    </button>
  );
}

// Modal de edição via IA — recebe a jornada selecionada e permite alterações
// em linguagem natural via agentsApi.chat.
function EditJourneyModal({
  journey, onClose,
}: {
  journey: any;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editMessages, setEditMessages] = useState<Message[]>([{
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Editando jornada: **${journey.name || journey.prompt?.slice(0, 50) || "Jornada"}**\n\nPrompt original:\n${journey.prompt}\n\nO que você gostaria de alterar? Pode me dizer em linguagem natural, por exemplo:\n- "Mude a mensagem de resposta para 'Olá!'"\n- "Adicione um passo de esperar 5 segundos"\n- "Mude o grupo para 'vendas'"`,
  }]);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditStreaming, setIsEditStreaming] = useState(false);
  const editScrollRef = useRef<HTMLDivElement>(null);

  const sendEditMessage = async () => {
    if (!editPrompt.trim() || isEditStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: editPrompt.trim(),
      createdAt: new Date(),
    };

    setEditMessages((prev) => [...prev, userMessage]);
    setEditPrompt("");
    setIsEditStreaming(true);

    try {
      const res = await agentsApi.chat(editPrompt.trim());
      const content = res.data?.response || res.data?.content || "";

      setEditMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
      }]);

      if (content.includes("atualizada") || content.includes("modificada") || content.includes("alterada")) {
        queryClient.invalidateQueries({ queryKey: ["journeys"] });
        toast.success("Jornada atualizada!");
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || "Erro ao editar jornada");
      setEditMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Desculpe, ocorreu um erro ao processar sua solicitação.",
      }]);
    } finally {
      setIsEditStreaming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose} />
      <motion.div
        className="relative w-full sm:max-w-2xl sm:max-h-[80vh] max-h-[92vh] rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        initial={{ opacity: 0, scale: 0.95, y: 32 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(139,92,246,0.15)" }}>
              <Edit3 className="w-4 h-4" style={{ color: "#8b5cf6" }} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>Editar Jornada</h3>
              <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>Descreva alterações em linguagem natural</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-3)] flex-shrink-0" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4" ref={editScrollRef}>
          {editMessages.map((msg) => (
            <div key={msg.id} className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}>
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", msg.role === "user" ? "bg-[var(--surface-3)]" : "bg-[#8b5cf6]")}>
                {msg.role === "user" ? <User className="w-4 h-4" style={{ color: "var(--text-2)" }} /> : <SparklesIcon className="w-4 h-4 text-white" />}
              </div>
              <div className={cn("flex-1 max-w-[85%] min-w-0", msg.role === "user" && "text-right")}>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-3)" }}>{msg.role === "user" ? "Você" : "Uniq AI"}</p>
                <div className={cn("rounded-xl p-3 text-sm break-words", msg.role === "user" ? "bg-[var(--surface-3)]" : "bg-[var(--surface-2)]")} style={{ color: "var(--text-1)" }}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          {isEditStreaming && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[#8b5cf6]">
                <SparklesIcon className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <ThinkingDots />
              </div>
            </div>
          )}
        </div>

        <div className="p-3 sm:p-4 border-t flex-shrink-0" style={{ borderColor: "var(--surface-border)" }}>
          <div className="flex items-end gap-2">
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendEditMessage(); } }}
              placeholder="Descreva a alteração que deseja fazer..."
              rows={1}
              className="flex-1 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm resize-none outline-none"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            />
            <button
              onClick={sendEditMessage}
              disabled={!editPrompt.trim() || isEditStreaming}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 flex-shrink-0"
              style={{ background: "#8b5cf6" }}
            >
              {isEditStreaming ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
            </button>
          </div>
          <p className="text-[10px] mt-2 hidden sm:block" style={{ color: "var(--text-3)" }}>
            Enter para enviar · Shift+Enter para nova linha
          </p>
        </div>
      </motion.div>
    </div>
  );
}

type StatusFilter = "all" | "active" | "paused";

export function JourneysList() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [editingJourney, setEditingJourney] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const queryClient = useQueryClient();

  const { data: journeys = [], isLoading } = useQuery({
    queryKey: ["journeys"],
    queryFn: async () => (await journeysApi.list()).data,
  });

  const filteredJourneys = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journeys.filter((j: any) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        j.name, j.prompt, j.trigger_filter, j.instance_name,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [journeys, search, statusFilter]);

  const { data: agentStats } = useQuery({
    queryKey: ["agent-stats"],
    queryFn: async () => (await agentsApi.stats()).data,
    refetchInterval: 30000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) =>
      journeysApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Status atualizado");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err?.message || "Erro ao atualizar status");
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (journey: any) =>
      journeysApi.create(`Cópia de ${journey.prompt}`, undefined, journey.instance_id || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Jornada duplicada");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err?.message || "Erro ao duplicar");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await journeysApi.delete(id);
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Jornada removida");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err?.message || "Erro ao remover");
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      journeysApi.updateTrigger(id, { name }),
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: ["journeys"] });
      const prev = queryClient.getQueryData<any[]>(["journeys"]);
      queryClient.setQueryData<any[]>(["journeys"], (old) =>
        (old ?? []).map((j) => (j.id === id ? { ...j, name } : j)),
      );
      return { prev };
    },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["journeys"], ctx.prev);
      toast.error(err?.response?.data?.error || "Falha ao renomear");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Stats + filter bar */}
      <div className="flex flex-col gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4" style={{ color: "#8b5cf6" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Jornadas</h2>
          </div>
          <div className="flex-1" />
          {agentStats?.journeys && (
            <div className="hidden sm:flex items-center gap-3 sm:gap-4 text-xs" style={{ color: "var(--text-3)" }}>
              <span className="flex items-center gap-1">
                <Circle className="w-2 h-2 fill-emerald-500 text-emerald-500" />
                {agentStats.journeys.active_journeys} ativas
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {agentStats.journeys.today_executions} hoje
              </span>
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {agentStats.journeys.total_executions} total
              </span>
            </div>
          )}
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
            {filteredJourneys.length}{filteredJourneys.length !== journeys.length ? `/${journeys.length}` : ""}
          </span>
        </div>

        {/* Search + status pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--text-3)" }} />
            <input
              type="text"
              placeholder="Buscar por nome, gatilho…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs rounded-lg pl-8 pr-3 py-1.5 outline-none"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            />
          </div>
          <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
            {([
              { id: "all", label: "Todas" },
              { id: "active", label: "Ativas" },
              { id: "paused", label: "Pausadas" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                style={{
                  background: statusFilter === s.id ? "rgba(0,212,106,0.15)" : "transparent",
                  color: statusFilter === s.id ? "var(--green)" : "var(--text-3)",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto space-y-3 p-3 sm:p-4 custom-scrollbar min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--surface-3)" }} />
            ))}
          </div>
        ) : journeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Wand2 className="w-12 h-12 mb-3 opacity-40" style={{ color: "var(--text-3)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Nenhuma jornada ainda</p>
            <p className="text-xs mt-1 mb-4 max-w-sm" style={{ color: "var(--text-3)" }}>
              Descreva em linguagem natural pelo Uniq AI, comece de um template, ou monte direto no canvas.
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button
                onClick={async () => {
                  try {
                    const res = await journeysApi.createBlank();
                    const id = res.data?.id;
                    if (id) window.location.href = `/journeys/${id}`;
                  } catch (e: any) {
                    toast.error(e?.response?.data?.error || "Falha ao criar jornada");
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-2"
                style={{ background: "var(--green)", color: "white" }}
              >
                <Plus className="w-3.5 h-3.5" /> Canvas em branco
              </button>
            </div>
          </div>
        ) : filteredJourneys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <Search className="w-10 h-10 mb-2 opacity-40" style={{ color: "var(--text-3)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Nenhum resultado</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: "var(--text-3)" }}>
              Ajuste a busca ou o filtro de status pra ver outras jornadas.
            </p>
          </div>
        ) : (
          filteredJourneys.map((j: any) => (
            <div key={j.id} className="rounded-xl overflow-hidden" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
              <div
                className="p-3 sm:p-4 flex items-center justify-between cursor-pointer hover:bg-[var(--surface-2)] transition-colors gap-2"
                onClick={() => setExpanded((p) => ({ ...p, [j.id]: !p[j.id] }))}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: j.status === "active" ? "#00d46a" : "#6b7280" }} />
                    <EditableName
                      value={j.name || j.prompt}
                      onSave={(next) => {
                        const trimmed = next.trim();
                        if (trimmed && trimmed !== (j.name || "")) {
                          renameMutation.mutate({ id: j.id, name: trimmed });
                        }
                      }}
                    />
                    {j.instance_name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] hidden sm:inline" style={{ color: "var(--text-3)" }}>
                        {j.instance_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 mt-1.5 flex-wrap">
                    <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-3)" }}>
                      <Zap className="w-3 h-3" /> {j.trigger_filter || j.trigger_type || "automática"}
                    </span>
                    <span className="text-xs opacity-30 hidden sm:inline">·</span>
                    <span className="text-xs" style={{ color: "var(--text-3)" }}>
                      {j.invocations || 0} execuções
                    </span>
                    {j.active_executions > 0 && (
                      <>
                        <span className="text-xs opacity-30 hidden sm:inline">·</span>
                        <span className="text-xs flex items-center gap-1 text-emerald-500">
                          <Activity className="w-3 h-3" /> {j.active_executions} ativa{j.active_executions > 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 sm:ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => toggleMutation.mutate({ id: j.id, status: j.status === "active" ? "paused" : "active" })}
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: j.status === "active" ? "#00d46a" : "var(--text-3)", background: j.status === "active" ? "rgba(0,212,106,0.1)" : "transparent" }}
                    title={j.status === "active" ? "Pausar" : "Ativar"}
                  >
                    {j.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ id: j.id, name: j.name || j.prompt?.slice(0, 30) || "Jornada" })}
                    className="p-2 rounded-lg transition-colors hover:text-red-400"
                    style={{ color: "var(--text-3)" }}
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {expanded[j.id] ? <ChevronUp className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
                </div>
              </div>

              {expanded[j.id] && (
                <div className="p-3 sm:p-4 border-t" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
                  <FlowPreview flow={j.flow} trigger={j.trigger_filter} />

                  <div className="flex flex-col sm:flex-row gap-3 mt-3">
                    <div className="flex-1 p-3 rounded-xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                      <p className="text-[9px] uppercase font-semibold mb-1" style={{ color: "var(--text-3)" }}>Palavras-chave</p>
                      <div className="flex flex-wrap gap-1">
                        {(() => {
                          try {
                            const kws = JSON.parse(j.keywords || "[]") || [];
                            return kws.length > 0 ? kws.map((kw: string, i: number) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,212,106,0.1)", color: "var(--green)" }}>
                                {kw}
                              </span>
                            )) : <span className="text-xs" style={{ color: "var(--text-3)" }}>qualquer mensagem</span>;
                          } catch { return <span className="text-xs" style={{ color: "var(--text-3)" }}>qualquer mensagem</span>; }
                        })()}
                      </div>
                    </div>
                    <div className="flex-1 p-3 rounded-xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                      <p className="text-[9px] uppercase font-semibold mb-1" style={{ color: "var(--text-3)" }}>Estatísticas</p>
                      <div className="text-xs" style={{ color: "var(--text-2)" }}>
                        <div className="flex justify-between"><span>Total:</span><span>{j.invocations || 0}</span></div>
                        <div className="flex justify-between"><span>Completadas:</span><span>{j.completed_executions || 0}</span></div>
                        <div className="flex justify-between"><span>Taxa:</span><span>{j.completion_rate?.toFixed(0) || 0}%</span></div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 p-3 rounded-xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                    <p className="text-xs font-medium mb-1" style={{ color: "var(--text-3)" }}>Prompt original</p>
                    <p className="text-xs break-words" style={{ color: "var(--text-2)" }}>{j.prompt}</p>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap" style={{ borderColor: "var(--surface-border)" }}>
                    <a
                      href={`/journeys/${j.id}`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ background: "rgba(0,212,106,0.12)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.25)" }}
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Canvas
                    </a>
                    <button onClick={() => setEditingJourney(j)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: "rgba(139,92,246,0.1)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,0.2)" }}>
                      <Edit3 className="w-3.5 h-3.5" /> Editar via IA
                    </button>
                    <button onClick={() => duplicateMutation.mutate(j)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}>
                      <Copy className="w-3.5 h-3.5" /> Duplicar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setDeleteConfirm(null)}
          />
          <motion.div
            className="relative w-full max-w-sm rounded-2xl p-5 sm:p-6 shadow-2xl"
            style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <Trash2 className="w-6 h-6" style={{ color: "#ef4444" }} />
              </div>
              <div>
                <h3 className="text-base font-medium" style={{ color: "hsl(240 15% 93%)" }}>Excluir Jornada</h3>
                <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 46%)" }}>Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm mb-6" style={{ color: "hsl(240 8% 60%)" }}>
              Tem certeza que deseja excluir a jornada <span className="font-medium" style={{ color: "hsl(240 15% 93%)" }}>"{deleteConfirm.name}"</span>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{ background: "hsl(240 12% 10%)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 8% 60%)" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{ background: "#ef4444", color: "white" }}
              >
                {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit modal via IA */}
      {editingJourney && (
        <EditJourneyModal journey={editingJourney} onClose={() => setEditingJourney(null)} />
      )}
    </div>
  );
}
