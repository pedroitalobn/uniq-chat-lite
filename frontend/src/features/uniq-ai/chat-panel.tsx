"use client";

// Painel principal do Uniq AI — chat estilo Claude/GPT.
// O histórico (multi-conversa) vive fora deste componente, em
// /app/(dashboard)/uniq-ai/page.tsx, que passa a conversa ativa via
// props. Aqui só cuidamos do render do chat + envio + criação de jornada.
//
// Canvas e Templates SAÍRAM do header — agora vivem em /journeys.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2, ChevronDown, Loader2, Sparkles, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { agentsApi, instancesApi, integrationsApi, journeysApi } from "@/lib/api";
import { MentionPicker, type Mention, type MentionPickerHandles } from "@/components/MentionPicker";
import {
  ChatMessage, EmptyState, type Message, ThinkingDots,
} from "./atoms";

export interface UniqAIChatPanelProps {
  // Mensagens controladas externamente — quem hospeda o painel decide
  // como persistir (localStorage multi-conversa, Redis, etc).
  messages: Message[];
  onMessagesChange: (next: Message[] | ((prev: Message[]) => Message[])) => void;
  // `compact` reduz paddings/headers para uso em ilha/modal.
  compact?: boolean;
  // Esconde o header de chat (Uniq AI + selectores). Útil quando a página
  // hospedeira já tem cabeçalho próprio.
  hideHeader?: boolean;
  // Quando o usuário tenta enviar a primeira mensagem em uma conversa,
  // chamamos esse callback pra que a página mãe possa criar a conversa
  // se ainda não existe (ex: clique "+ Nova conversa").
  onBeforeFirstSend?: () => void;
}

export function UniqAIChatPanel({
  messages,
  onMessagesChange,
  compact = false,
  hideHeader = false,
  onBeforeFirstSend,
}: UniqAIChatPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedIntegration, setSelectedIntegration] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [groupedIntegrations, setGroupedIntegrations] = useState<Record<string, any[]>>({});
  const [isCreatingJourney, setIsCreatingJourney] = useState(false);
  const [pendingJourneyPrompt, setPendingJourneyPrompt] = useState<string>("");
  const [pendingJourneyRendered, setPendingJourneyRendered] = useState<string>("");
  const [pendingJourneyMentions, setPendingJourneyMentions] = useState<Mention[]>([]);
  const [, setPendingJourneyData] = useState<any>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: instances = [] } = useQuery({
    queryKey: ["instances"],
    queryFn: async () => (await instancesApi.list()).data,
  });

  const loadIntegrations = useCallback(async () => {
    setIsLoadingIntegrations(true);
    try {
      const res = await integrationsApi.list();
      const llmProviders = ["openai", "claude", "deepseek", "gemini", "openrouter", "kilo", "zai", "kimi", "qwen", "minimax", "manus"];
      const filtered = (res.data || []).filter((i: any) =>
        i.is_active && llmProviders.includes(i.provider?.toLowerCase()),
      );
      const grouped = filtered.reduce((acc: Record<string, any[]>, curr: any) => {
        const provider = curr.provider?.toUpperCase() || "OTHER";
        if (!acc[provider]) acc[provider] = [];
        acc[provider].push(curr);
        return acc;
      }, {});
      setGroupedIntegrations(grouped);
      if (filtered.length > 0) {
        setSelectedIntegration((prev) => prev || filtered[0]?.id || "");
      }
    } catch (err) {
      console.error("Failed to load integrations", err);
    } finally {
      setIsLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  useEffect(() => {
    if (scrollRef.current && messages.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (
    messageText: string,
    extras?: { renderedText?: string; mentions?: Mention[]; displayText?: string },
  ) => {
    if (isStreaming) return;
    if (messages.length === 0) onBeforeFirstSend?.();

    const bubbleContent = extras?.displayText ?? messageText;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: bubbleContent,
      createdAt: new Date(),
    };
    const assistantMessageId = crypto.randomUUID();

    onMessagesChange((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    try {
      const res = await agentsApi.chat(
        messageText,
        selectedIntegration || undefined,
        selectedModel || undefined,
        {
          rendered_text: extras?.renderedText,
          original_input: extras?.displayText,
          mentions: extras?.mentions,
        },
      );
      const content = res.data?.response || res.data?.content || res.data || "";

      if (res.data?.journey_preview && res.data?.pending_journey) {
        setIsCreatingJourney(true);
        setPendingJourneyPrompt(messageText);
        setPendingJourneyData(res.data.pending_journey);
      }

      onMessagesChange((prev) => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content,
      }]);
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || "Erro ao enviar mensagem");
      onMessagesChange((prev) => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content: "Desculpe, ocorreu um erro ao processar sua mensagem.",
      }]);
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, selectedIntegration, selectedModel, messages.length, onBeforeFirstSend, onMessagesChange]);

  useEffect(() => {
    if (!selectedIntegration) {
      setSelectedModel("");
      return;
    }
    const allIntegrations = Object.values(groupedIntegrations).flat();
    const integration = allIntegrations.find((i: any) => i.id === selectedIntegration);
    if (integration && Array.isArray(integration?.models) && integration.models.length > 0) {
      setSelectedModel(integration.models[0]);
    } else {
      setSelectedModel("");
    }
  }, [selectedIntegration, groupedIntegrations]);

  const createJourneyMutation = useMutation({
    mutationFn: async (data: {
      prompt: string;
      integrationId?: string;
      instanceId?: string;
      renderedText?: string;
      mentions?: Mention[];
    }) => {
      const res = await journeysApi.create(data.prompt, data.integrationId, data.instanceId, {
        rendered_text: data.renderedText,
        original_input: data.prompt,
        mentions: data.mentions,
      });
      return res.data;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      let responseText = `Jornada **"${res.name || "Criada"}"** criada com sucesso!`;
      if (res.instance_id) {
        const inst = instances.find((i: any) => i.id === res.instance_id);
        responseText += `\n\n📍 **Instância:** ${inst?.name || "N/A"}`;
      }
      if (res.group_jid) {
        responseText += `\n👥 **Grupo:** ${res.group_jid.split("@")[0] || "N/A"}`;
      }
      if (res.flow?.steps?.length) {
        responseText += `\n🔄 **Fluxo:** ${res.flow.steps.length} passo(s)`;
      }
      responseText += "\n\nA jornada já está ativa e monitorando mensagens!";

      onMessagesChange((prev) => [...prev, {
        role: "assistant",
        content: responseText,
        id: crypto.randomUUID(),
      }]);
      setIsCreatingJourney(false);
      setPendingJourneyPrompt("");
      setPendingJourneyRendered("");
      setPendingJourneyMentions([]);
      toast.success("Jornada criada!");
    },
    onError: (err: any) => {
      toast.error("Erro ao criar jornada: " + (err.response?.data?.error || err.message));
      setIsCreatingJourney(false);
    },
  });

  const handleSuggestionClick = (label: string) => {
    if (label === "Criar uma jornada") {
      setPrompt("Quando alguém mandar 'bom dia' no grupo, responda no privado com um oi");
    } else if (label === "Listar jornadas") {
      sendMessage("Liste todas as minhas jornadas de automação ativas.");
    } else if (label === "Ver instâncias") {
      if (instances.length === 0) {
        onMessagesChange((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Você ainda não tem instâncias configuradas. Vá para **Instâncias** para criar uma.",
        }]);
      } else {
        const instList = instances.map((i: any) => `- **${i.name}** (${i.status})`).join("\n");
        onMessagesChange((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Suas instâncias:\n\n${instList}\n\nPara criar uma jornada, mencione o nome da instância no pedido.`,
        }]);
      }
    } else {
      sendMessage("O que você pode fazer? Me explique suas funcionalidades.");
    }
  };

  const handleSend = (info?: MentionPickerHandles) => {
    const raw = (info?.value ?? prompt).trim();
    if (!raw || isStreaming) return;

    const rendered = (info?.renderedText ?? raw).trim();
    const mentions = info?.mentions ?? [];
    const lowerMsg = rendered.toLowerCase();

    const isJourney = lowerMsg.includes("crie") || lowerMsg.includes("criar") ||
      lowerMsg.includes("jornada") || lowerMsg.includes("automação") ||
      lowerMsg.includes("quando alguém") || lowerMsg.includes("responda") ||
      lowerMsg.includes("quando mandar") || lowerMsg.includes("envie mensagem");

    if (isJourney) {
      setIsCreatingJourney(true);
      setPendingJourneyPrompt(raw);
      setPendingJourneyRendered(rendered);
      setPendingJourneyMentions(mentions);
      sendMessage(
        `Analise este pedido de automação WhatsApp e confirme os detalhes:\n\n"${rendered}"\n\nExtraia:\n- Qual instância será usada (se mencionada)\n- Qual grupo será monitorado (se mencionado)\n- Qual a palavra-chave ou mensagem que aciona\n- Qual ação será tomada (enviar mensagem no privado/grupo, adicionar tag, etc)\n\nResponda de forma clara e pergunte se o usuário confirma.`,
        { renderedText: rendered, mentions, displayText: raw },
      );
    } else {
      sendMessage(raw, { renderedText: rendered, mentions, displayText: raw });
    }
    setPrompt("");
  };

  const confirmJourneyCreation = () => {
    if (!pendingJourneyPrompt) {
      toast.error("Nenhuma jornada pendente para criar");
      return;
    }
    createJourneyMutation.mutate({
      prompt: pendingJourneyPrompt,
      integrationId: selectedIntegration || undefined,
      instanceId: selectedInstance || undefined,
      renderedText: pendingJourneyRendered || undefined,
      mentions: pendingJourneyMentions.length > 0 ? pendingJourneyMentions : undefined,
    });
  };

  const cancelJourneyCreation = () => {
    setIsCreatingJourney(false);
    setPendingJourneyPrompt("");
    setPendingJourneyRendered("");
    setPendingJourneyMentions([]);
    setPendingJourneyData(null);
    onMessagesChange((prev) => [...prev, {
      role: "assistant",
      content: "Entendido. Pode me perguntar outras coisas ou criar uma jornada quando quiser.",
      id: crypto.randomUUID(),
    }]);
  };

  // Empty state — input centralizado verticalmente como Claude/GPT.
  // Quando não há mensagens, escondemos o header e tudo respira.
  const isEmpty = messages.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col h-full" style={{ background: "var(--surface-2)" }}>
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-8">
          <div className="w-full max-w-2xl">
            <EmptyState onSuggestionClick={handleSuggestionClick} />
            <div className="mt-2">
              <MentionPicker
                value={prompt}
                onChange={(v) => setPrompt(v)}
                onSend={handleSend}
                disabled={isStreaming}
                isLoading={isStreaming}
                placeholder="Pergunte ou peça… use /instancia, /grupo, /contato, /tag, /funil ou /jornada."
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — só selectors essenciais (LLM + instância). Canvas e
          Templates foram pra /journeys. */}
      {!hideHeader && (
        <div
          className={`flex items-center justify-between gap-2 flex-shrink-0 border-b ${compact ? "px-3 py-2" : "px-3 sm:px-6 py-3 sm:py-4"}`}
          style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--green)" }}>
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-medium truncate" style={{ color: "var(--text-1)" }}>Uniq AI</h2>
              <p className="text-[10px] sm:text-xs truncate" style={{ color: "var(--text-3)" }}>Sua plataforma em linguagem natural</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            {/* Model selector — só desktop */}
            <div className="hidden lg:flex items-center gap-1">
              <div className="relative">
                <select
                  value={selectedIntegration || ""}
                  onChange={(e) => setSelectedIntegration(e.target.value)}
                  className="appearance-none outline-none text-xs font-medium rounded-lg px-3 py-2 pr-8 cursor-pointer min-w-[140px] max-w-[200px]"
                  style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
                >
                  {isLoadingIntegrations ? (
                    <option value="">Carregando...</option>
                  ) : Object.keys(groupedIntegrations).length === 0 ? (
                    <option value="">Nenhum modelo</option>
                  ) : (
                    <>
                      {!selectedIntegration && <option value="">LLM...</option>}
                      {Object.entries(groupedIntegrations).map(([provider, items]: [string, any]) => (
                        <optgroup key={provider} label={`── ${provider} ──`}>
                          {(items as any[]).map((i: any) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </>
                  )}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--text-3)" }} />
              </div>

              {selectedIntegration && (() => {
                const allIntegrations = Object.values(groupedIntegrations).flat();
                const currentIntegration = allIntegrations.find((i: any) => i.id === selectedIntegration);
                const hasModels = currentIntegration && Array.isArray(currentIntegration?.models) && currentIntegration.models.length > 1;
                if (!hasModels || !currentIntegration?.models) return null;
                return (
                  <div className="relative">
                    <select
                      value={selectedModel || ""}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="appearance-none outline-none text-xs font-medium rounded-lg px-3 py-2 pr-8 cursor-pointer min-w-[120px]"
                      style={{ background: "var(--green)", color: "#000", border: "none" }}
                    >
                      {(currentIntegration.models as string[]).map((m: string) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "#000" }} />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Conversa */}
      <div className="flex-1 min-h-0 flex flex-col" style={{ background: "var(--surface-2)" }}>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" style={{ background: "var(--surface-2)" }}>
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <ChatMessage key={msg.id} message={msg} isNew={i === messages.length - 1 && msg.role === "assistant"} />
            ))}
            {isStreaming && (
              <motion.div
                key="thinking"
                className="flex gap-3 sm:gap-4 px-4 sm:px-8 py-4 sm:py-5 border-b border-[var(--surface-border)]"
                style={{ background: "var(--surface-2)" }}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "var(--green)" }}>
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>Uniq AI</p>
                  <ThinkingDots />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Loading overlay */}
        {isStreaming && (
          <div className="px-4 sm:px-6 py-2 border-t flex-shrink-0" style={{ background: "rgba(0,212,106,0.05)", borderColor: "var(--surface-border)" }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--green)" }}>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Processando resposta...</span>
            </div>
          </div>
        )}

        {/* Confirmação de criação de jornada */}
        {isCreatingJourney && !isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && (
          <div className="px-3 sm:px-6 pb-4 pt-2">
            <div className="rounded-xl p-3 sm:p-4" style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Wand2 className="w-4 h-4" style={{ color: "var(--green)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--green)" }}>Confirmar criação da jornada?</span>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                Revise as informações acima e confirme para ativar a automação.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={confirmJourneyCreation} disabled={createJourneyMutation.isPending} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40" style={{ background: "var(--green)", color: "white" }}>
                  {createJourneyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirmar
                </button>
                <button onClick={cancelJourneyCreation} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-shrink-0">
          <MentionPicker
            value={prompt}
            onChange={(v) => setPrompt(v)}
            onSend={handleSend}
            disabled={isStreaming}
            isLoading={isStreaming}
            placeholder={selectedInstance
              ? "Descreva uma automação… use /grupo, /contato, /tag etc."
              : "Pergunte ou peça… use /instancia, /grupo, /contato, /tag, /funil ou /jornada."}
          />
        </div>
      </div>
    </div>
  );
}
