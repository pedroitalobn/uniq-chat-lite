"use client";

// Painel principal do Uniq AI — chat moderno estilo Perplexity/GPT/Gemini.
// Usa assistant-ui (useExternalStoreRuntime) para gerenciar estado e
// renderizar mensagens com primitivos: Thread, Message, Composer, ActionBar,
// BranchPicker, MarkdownText — tudo com tema Uniq.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type ExternalStoreAdapter,
} from "@assistant-ui/react";
import { Loader2, SendHorizonal, Sparkles, Square, Wand2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { agentsApi, instancesApi, journeysApi } from "@/lib/api";
import { MentionPicker, type Mention, type MentionPickerHandles } from "@/components/MentionPicker";
import { type Message } from "./atoms";
import {
  AuiThreadMessages,
  AuiThreadViewport,
  EmptyStateView,
  RunningMessage,
} from "./thread-ui";
import { ModelSelector } from "./ModelSelector";
import { loadModelPref, type ModelPreference } from "./model-preference";
import type { IslandPageContext } from "@/components/uniq-ai/island-context";
import { cn } from "@/lib/utils";

export interface UniqAIChatPanelProps {
  messages: Message[];
  onMessagesChange: (next: Message[] | ((prev: Message[]) => Message[])) => void;
  pageContext?: IslandPageContext | null;
  compact?: boolean;
  hideHeader?: boolean;
  onBeforeFirstSend?: () => void;
}

const THINKING_PHASES = [
  "Analisando seu pedido…",
  "Consultando instâncias…",
  "Verificando jornadas…",
  "Formulando resposta…",
  "Quase lá…",
];

// Convert our Message[] to the format useExternalStoreRuntime expects
function toExternalMessages(messages: Message[]): ThreadMessageLike[] {
  return messages.map((m) => ({
    role: m.role as "user" | "assistant",
    id: m.id,
    content: [{ type: "text" as const, text: m.content }],
  }));
}

export function UniqAIChatPanel({
  messages,
  onMessagesChange,
  compact = false,
  hideHeader = false,
  onBeforeFirstSend,
  pageContext,
}: UniqAIChatPanelProps) {
  const [modelPref, setModelPref] = useState<ModelPreference | null>(() => loadModelPref());
  const [isRunning, setIsRunning] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [isCreatingJourney, setIsCreatingJourney] = useState(false);
  const [pendingJourneyPrompt, setPendingJourneyPrompt] = useState("");
  const [pendingJourneyRendered, setPendingJourneyRendered] = useState("");
  const [pendingJourneyMentions, setPendingJourneyMentions] = useState<Mention[]>([]);
  const queryClient = useQueryClient();

  const selectedIntegration = modelPref?.integrationId ?? "";
  const selectedModel = modelPref?.model ?? "";

  const { data: instances = [] } = useQuery({
    queryKey: ["instances"],
    queryFn: async () => (await instancesApi.list()).data,
  });

  // Cycle thinking phases while running
  useEffect(() => {
    if (!isRunning) { setPhaseIdx(0); return; }
    const t = setInterval(() => setPhaseIdx((p) => (p + 1) % THINKING_PHASES.length), 2200);
    return () => clearInterval(t);
  }, [isRunning]);

  // ── Core send logic ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (
    messageText: string,
    extras?: { renderedText?: string; mentions?: Mention[]; displayText?: string },
  ) => {
    if (isRunning) return;
    if (messages.length === 0) onBeforeFirstSend?.();

    const displayContent = extras?.displayText ?? messageText;
    const assistantId = crypto.randomUUID();

    onMessagesChange((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: displayContent, createdAt: new Date() },
    ]);
    setIsRunning(true);

    try {
      const contextPrefix = pageContext
        ? `[Contexto: ${pageContext.scope}${pageContext.label ? ` — ${pageContext.label}` : ""}]\n\n`
        : "";

      const res = await agentsApi.chat(
        contextPrefix + messageText,
        selectedIntegration || undefined,
        selectedModel || undefined,
        {
          rendered_text: extras?.renderedText,
          original_input: extras?.displayText,
          mentions: extras?.mentions,
        },
      );

      const content: string = res.data?.response || res.data?.content || res.data || "";

      if (res.data?.journey_preview && res.data?.pending_journey) {
        setIsCreatingJourney(true);
        setPendingJourneyPrompt(messageText);
        setPendingJourneyRendered(extras?.renderedText ?? messageText);
        setPendingJourneyMentions(extras?.mentions ?? []);
      }

      onMessagesChange((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content, createdAt: new Date() },
      ]);
    } catch (err: any) {
      const raw: string = err.response?.data?.error || err.message || "Erro desconhecido";
      toast.error(raw);
      const lower = raw.toLowerCase();
      let reason = "Erro interno.";
      if (lower.includes("rate limit") || lower.includes("too many")) reason = "Rate limit atingido.";
      else if (lower.includes("timeout")) reason = "Timeout na requisição.";
      else if (lower.includes("unauthorized") || lower.includes("401")) reason = "Credenciais inválidas.";
      else if (lower.includes("network") || lower.includes("fetch")) reason = "Falha de conexão.";

      onMessagesChange((prev) => [
        ...prev,
        {
          id: assistantId, role: "assistant",
          content: `❌ **Não consegui processar seu pedido**\n\n**Motivo:** ${raw}\n\n**Diagnóstico:** ${reason}\n\nTente reformular ou tente novamente.`,
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, selectedIntegration, selectedModel, messages.length, onBeforeFirstSend, onMessagesChange, pageContext]);

  // ── Journey confirmation ─────────────────────────────────────────────────────
  const createJourneyMutation = useMutation({
    mutationFn: async () => journeysApi.create(
      pendingJourneyPrompt,
      selectedIntegration || undefined,
      undefined,
      { rendered_text: pendingJourneyRendered, original_input: pendingJourneyPrompt, mentions: pendingJourneyMentions },
    ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      const name = res.data?.name ?? "Criada";
      onMessagesChange((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `✅ Jornada **"${name}"** criada e já está ativa!` },
      ]);
      setIsCreatingJourney(false);
      setPendingJourneyPrompt("");
      setPendingJourneyRendered("");
      setPendingJourneyMentions([]);
      toast.success("Jornada criada!");
    },
    onError: (e: any) => {
      toast.error("Erro ao criar: " + (e.response?.data?.error || e.message));
      setIsCreatingJourney(false);
    },
  });

  const cancelJourney = () => {
    setIsCreatingJourney(false);
    setPendingJourneyPrompt("");
    onMessagesChange((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", content: "Entendido. Pode me pedir outra coisa quando quiser." },
    ]);
  };

  // ── External store runtime (bridges our state → assistant-ui) ───────────────
  const externalMessages = useMemo(() => toExternalMessages(messages), [messages]);

  const adapter: ExternalStoreAdapter<ThreadMessageLike> = {
    messages: externalMessages,
    isRunning,
    convertMessage: (msg) => msg,
    onNew: async (appendMsg) => {
      const text = appendMsg.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      await sendMessage(text);
    },
    onReload: async () => {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      onMessagesChange((prev) => {
        const idxs = prev.map((m, i) => m.role === "assistant" ? i : -1).filter((i) => i >= 0);
        const last = idxs.at(-1);
        return last != null ? prev.slice(0, last) : prev;
      });
      await sendMessage(lastUser.content);
    },
  };
  const runtime = useExternalStoreRuntime(adapter);

  // ── Composer state (separate from the runtime composer since we use MentionPicker) ──
  const [composerValue, setComposerValue] = useState("");

  const handleSend = useCallback((info?: MentionPickerHandles) => {
    const raw = (info?.value ?? composerValue).trim();
    if (!raw || isRunning) return;
    const rendered = (info?.renderedText ?? raw).trim();
    const mentions = info?.mentions ?? [];
    setComposerValue("");
    sendMessage(raw, { renderedText: rendered, mentions, displayText: raw });
  }, [composerValue, isRunning, sendMessage]);

  const handleSuggestionClick = useCallback((text: string) => {
    sendMessage(text, { displayText: text });
  }, [sendMessage]);

  const isEmpty = messages.length === 0;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full" style={{ background: "var(--surface-2)" }}>

        {/* Header */}
        {!hideHeader && (
          <div
            className={cn(
              "flex items-center gap-2 flex-shrink-0 border-b",
              compact ? "px-3 py-2" : "px-4 sm:px-6 py-3",
            )}
            style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--green)" }}
            >
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Uniq AI</span>
            <div className="ml-auto">
              <ModelSelector value={modelPref} onChange={setModelPref} />
            </div>
          </div>
        )}

        {/* Thread root — assistant-ui owns the scroll + message list */}
        <ThreadPrimitive.Root className="flex flex-col flex-1 min-h-0">

          {/* Empty state */}
          {isEmpty && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="min-h-full flex flex-col items-center justify-center py-6 sm:py-10 px-4">
                <div className="w-full max-w-2xl space-y-3">
                  <EmptyStateView onSuggestionClick={handleSuggestionClick} />
                </div>
              </div>
            </div>
          )}

          {/* Messages viewport */}
          {!isEmpty && (
            <AuiThreadViewport>
              <div className="py-2">
                <AuiThreadMessages runningPhase={THINKING_PHASES[phaseIdx]} />
              </div>
            </AuiThreadViewport>
          )}

          {/* Journey confirm bar */}
          <AnimatePresence>
            {isCreatingJourney && !isRunning && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="flex-shrink-0 mx-3 mb-2 rounded-xl p-3"
                style={{
                  background: "rgba(0,212,106,0.08)",
                  border: "1px solid rgba(0,212,106,0.2)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Wand2 className="w-4 h-4" style={{ color: "var(--green)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--green)" }}>
                    Confirmar criação da jornada?
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => createJourneyMutation.mutate()}
                    disabled={createJourneyMutation.isPending}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                    style={{ background: "var(--green)", color: "white" }}
                  >
                    {createJourneyMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Confirmar
                  </button>
                  <button
                    onClick={cancelJourney}
                    className="flex-1 inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                    style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Composer */}
          <ComposerArea
            value={composerValue}
            onChange={setComposerValue}
            onSend={handleSend}
            isRunning={isRunning}
            onStop={() => setIsRunning(false)}
            modelPref={modelPref}
            onModelChange={setModelPref}
            isEmpty={isEmpty}
          />
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}

// ─── Composer area ─────────────────────────────────────────────────────────────
interface ComposerAreaProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (info?: MentionPickerHandles) => void;
  isRunning: boolean;
  onStop: () => void;
  modelPref: ModelPreference | null;
  onModelChange: (p: ModelPreference | null) => void;
  isEmpty: boolean;
}

function ComposerArea({
  value, onChange, onSend, isRunning, onStop,
  modelPref, onModelChange, isEmpty,
}: ComposerAreaProps) {
  return (
    <ComposerPrimitive.Root className="flex-shrink-0">
      <div
        className={cn(
          "relative mx-3 mb-3 rounded-2xl overflow-hidden",
          isEmpty && "mx-auto w-full max-w-2xl",
        )}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
          backdropFilter: "blur(20px)",
        }}
      >
        <MentionPicker
          value={value}
          onChange={onChange}
          onSend={onSend}
          disabled={isRunning}
          isLoading={isRunning}
          placeholder="Pergunte ou peça… use @instancia, @grupo, @contato, @tag, @jornada"
        />

        {/* Footer bar */}
        <div className="flex items-center justify-between px-3 pb-2 pt-0">
          <ModelSelector value={modelPref} onChange={onModelChange} />

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] hidden sm:inline select-none" style={{ color: "var(--text-3)" }}>
              Enter · enviar
            </span>

            {/* Stop or Send — using assistant-ui primitives when possible */}
            <AnimatePresence mode="wait" initial={false}>
              {isRunning ? (
                <motion.button
                  key="stop"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                  onClick={onStop}
                  className="p-1.5 rounded-xl flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}
                  title="Parar geração"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Parar</span>
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => onSend()}
                  disabled={!value.trim()}
                  className="p-1.5 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105"
                  style={{ background: "var(--green)", color: "white" }}
                  title="Enviar (Enter)"
                >
                  <SendHorizonal className="w-4 h-4" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Running indicator strip */}
        <AnimatePresence>
          {isRunning && (
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              exit={{ scaleX: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute bottom-0 left-0 right-0 h-0.5 origin-left"
              style={{ background: "linear-gradient(90deg, var(--green), rgba(0,212,106,0.3))" }}
            />
          )}
        </AnimatePresence>
      </div>
    </ComposerPrimitive.Root>
  );
}
