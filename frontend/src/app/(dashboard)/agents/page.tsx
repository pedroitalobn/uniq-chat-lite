"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Sparkles, MessageSquare,
  Trash2, Wand2, ChevronRight, ChevronUp, ChevronDown, Loader2, Play, Pause,
  CheckCircle2, Zap, ArrowRight, Hash, Users, Contact, Megaphone, Tag,
  Copy, Check, SparklesIcon, Circle, Activity, TrendingUp, Eye, Clock,
  Server, Globe, AlertCircle
} from "lucide-react";
import { integrationsApi, agentsApi, journeysApi, groupsApi, instancesApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

type AgentSection = "chat" | "journeys" | "activity";

const SECTIONS: { id: AgentSection; label: string; icon: React.ElementType; description: string }[] = [
  { id: "chat",     label: "Chat IA",    icon: MessageSquare, description: "Converse e crie jornadas" },
  { id: "journeys", label: "Jornadas",   icon: Wand2,        description: "Suas automações" },
  { id: "activity", label: "Atividade",  icon: Activity,     description: "Monitoramento em tempo real" },
];

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}

const WELCOME_SUGGESTIONS = [
  { icon: Wand2, label: "Criar uma jornada", description: "Quando alguém mandar 'bom dia' no grupo, responda com um oi" },
  { icon: MessageSquare, label: "Listar jornadas", description: "Veja suas automações ativas" },
  { icon: Sparkles, label: "Explorar recursos", description: "Descubra o que posso fazer" },
  { icon: Server, label: "Ver instâncias", description: "Suas instâncias disponíveis" },
];

/* ── Typewriter effect for AI responses ── */
function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    setDisplayed(0);
  }, [text]);

  useEffect(() => {
    if (displayed >= text.length) return;
    const speed = text.length > 200 ? 6 : 12;
    const t = setTimeout(() => setDisplayed(d => d + 1), speed);
    return () => clearTimeout(t);
  }, [displayed, text]);

  return (
    <span>
      {text.slice(0, displayed)}
      {displayed < text.length && (
        <span
          className="inline-block w-[2px] h-[1em] ml-[1px] align-middle animate-pulse"
          style={{ background: "var(--green)", borderRadius: 1 }}
        />
      )}
    </span>
  );
}

/* ── Thinking dots ── */
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ background: "var(--green)" }}
          animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/* ── Flow Preview Component ── */
function FlowPreview({ flow, trigger }: { flow?: any; trigger?: string }) {
  if (!flow?.steps?.length) {
    return (
      <div className="flex items-center gap-3 overflow-x-auto pb-2">
        <div className="flex flex-col items-center gap-1.5 min-w-[100px] p-2.5 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="p-1.5 rounded-full" style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
            <Zap className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          </div>
          <span className="text-[9px] uppercase font-bold" style={{ color: "var(--text-3)" }}>Gatilho</span>
          <span className="text-[10px] font-semibold text-center truncate w-full" style={{ color: "var(--text-1)" }}>
            {trigger || "keyword"}
          </span>
        </div>
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        <div className="flex flex-col items-center gap-1.5 min-w-[100px] p-2.5 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="p-1.5 rounded-full" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)" }}>
            <MessageSquare className="w-3.5 h-3.5" style={{ color: "#eab308" }} />
          </div>
          <span className="text-[9px] uppercase font-bold" style={{ color: "var(--text-3)" }}>Ação</span>
          <span className="text-[10px] font-semibold text-center" style={{ color: "var(--text-1)" }}>
            Responder
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {/* Trigger */}
      <div className="flex flex-col items-center gap-1.5 min-w-[90px] p-2 rounded-xl flex-shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="p-1.5 rounded-full" style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
          <Zap className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
        </div>
        <span className="text-[8px] uppercase font-bold" style={{ color: "var(--text-3)" }}>Gatilho</span>
        <span className="text-[10px] font-semibold text-center truncate w-full" style={{ color: "var(--text-1)" }}>
          {trigger || "message"}
        </span>
      </div>

      {/* Steps */}
      {flow.steps.slice(0, 5).map((step: any, i: number) => (
        <div key={step.id || i} className="flex items-center gap-2 flex-shrink-0">
          <ArrowRight className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
          <div className="flex flex-col items-center gap-1 min-w-[80px] p-2 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            <div className="p-1 rounded-full" style={{
              background: step.type === "message" ? "rgba(59,130,246,0.1)" :
                         step.type === "wait" ? "rgba(234,179,8,0.1)" :
                         step.type === "tag" ? "rgba(234,179,8,0.1)" :
                         "rgba(139,92,246,0.1)",
              border: `1px solid ${
                step.type === "message" ? "rgba(59,130,246,0.2)" :
                step.type === "wait" ? "rgba(234,179,8,0.2)" :
                step.type === "tag" ? "rgba(234,179,8,0.2)" :
                "rgba(139,92,246,0.2)"
              }`
            }}>
              {step.type === "message" ? <Send className="w-3 h-3" style={{ color: "#3b82f6" }} /> :
               step.type === "wait" ? <Clock className="w-3 h-3" style={{ color: "#eab308" }} /> :
               step.type === "tag" ? <Tag className="w-3 h-3" style={{ color: "#eab308" }} /> :
               <Bot className="w-3 h-3" style={{ color: "#8b5cf6" }} />}
            </div>
            <span className="text-[8px] uppercase font-bold" style={{ color: "var(--text-3)" }}>
              {step.type === "message" ? "Enviar" : step.type === "wait" ? "Esperar" : step.type === "tag" ? "Tag" : step.type}
            </span>
            <span className="text-[9px] text-center truncate w-full" style={{ color: "var(--text-2)" }}>
              {step.label || (step.config?.message?.slice(0, 20) || "passo")}
            </span>
          </div>
        </div>
      ))}
      {flow.steps.length > 5 && (
        <div className="flex-shrink-0 text-xs" style={{ color: "var(--text-3)" }}>
          +{flow.steps.length - 5}
        </div>
      )}
    </div>
  );
}

/* ── Empty state ── */
function EmptyState({ onSuggestionClick }: { onSuggestionClick: (label: string) => void }) {
  return (
    <motion.div
      className="h-full flex flex-col items-center justify-center px-8 py-12"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
        <SparklesIcon className="w-8 h-8" style={{ color: "var(--green)" }} />
      </div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text-1)" }}>
        Olá, sou seu assistente IA
      </h2>
      <p className="text-sm text-center mb-8 max-w-md" style={{ color: "var(--text-3)" }}>
        Posso ajudá-lo a criar jornadas de automação estilo ManyChat. Descreva o que precisa ou escolha uma sugestão abaixo.
      </p>
      <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
        {WELCOME_SUGGESTIONS.map((item, idx) => (
          <motion.button
            key={idx}
            onClick={() => onSuggestionClick(item.label)}
            className="p-4 rounded-xl text-left"
            style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + idx * 0.07 }}
            whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
            whileTap={{ scale: 0.97 }}
          >
            <item.icon className="w-5 h-5 mb-2" style={{ color: "var(--green)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{item.label}</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{item.description}</p>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Chat message ── */
function ChatMessage({ message, isNew = false }: { message: Message; isNew?: boolean }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      className={cn("group flex gap-4 px-8 py-5",
        !isUser && "border-b border-[var(--surface-border)]"
      )}
      style={isUser ? { background: "var(--surface-3)" } : { background: "var(--surface-2)" }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={isUser
          ? { background: "var(--surface-2)", border: "1px solid var(--surface-border)" }
          : { background: "var(--green)" }
        }
      >
        {isUser
          ? <User className="w-4 h-4" style={{ color: "var(--text-2)" }} />
          : <SparklesIcon className="w-4 h-4 text-white" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--text-3)" }}>
          {isUser ? "Você" : "Assistente IA"}
        </p>
        <div className="text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            isNew ? <TypewriterText text={message.content} /> : (
              <ReactMarkdown
                components={{
                  p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
                  strong({ children }) { return <strong className="font-bold">{children}</strong>; },
                  em({ children }) { return <em className="italic opacity-90">{children}</em>; },
                  ol({ children }) { return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>; },
                  ul({ children }) { return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>; },
                  li({ children }) { return <li className="leading-relaxed">{children}</li>; },
                  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--green)" }}>{children}</a>; },
                }}
              >
                {message.content}
              </ReactMarkdown>
            )
          )}
        </div>
      </div>

      {!isUser && message.content && (
        <motion.button
          onClick={handleCopy}
          className="shrink-0 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
          style={{ color: "var(--text-3)" }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="Copiar"
        >
          {copied
            ? <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
            : <Copy className="w-4 h-4" />
          }
        </motion.button>
      )}
    </motion.div>
  );
}

/* ── Prompt input ── */
function PromptInput({
  value, onChange, onSend, onKeyDown, disabled, isLoading, placeholder
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  const canSend = value.trim() && !disabled;

  return (
    <div className="px-6 pb-5 pt-3">
      <motion.div
        className="flex items-end gap-2 rounded-2xl px-4 py-3"
        style={{ 
          background: isLoading ? "rgba(0,212,106,0.08)" : "var(--surface-3)", 
          border: `1px solid ${isLoading ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
          transition: "all 0.2s ease"
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder || "Descreva a automação que deseja criar..."}
          disabled={disabled || isLoading}
          rows={1}
          className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed py-0.5"
          style={{ color: "var(--text-1)", maxHeight: "160px", opacity: isLoading ? 0.6 : 1 }}
        />
        <motion.button
          onClick={onSend}
          disabled={!canSend || isLoading}
          className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
          animate={isLoading ? { scale: [1, 1.05, 1] } : {}}
          transition={isLoading ? { repeat: Infinity, duration: 1.5 } : {}}
          style={{ 
            background: isLoading ? "var(--green)" : (canSend ? "var(--green)" : "var(--surface-2)"), 
            border: "1px solid var(--surface-border)",
            opacity: isLoading ? 1 : (canSend ? 1 : 0.5)
          }}
          whileHover={canSend && !isLoading ? { scale: 1.08 } : {}}
          whileTap={canSend && !isLoading ? { scale: 0.93 } : {}}
        >
          {isLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-white" />
            : <Send className="w-4 h-4" style={{ color: canSend ? "white" : "var(--text-3)" }} />
          }
        </motion.button>
      </motion.div>
      <p className="text-center text-xs mt-2" style={{ color: "var(--text-3)" }}>
        {isLoading ? (
          <span style={{ color: "var(--green)" }}>Aguarde, processando...</span>
        ) : (
          "Enter para enviar · Shift+Enter para nova linha"
        )}
      </p>
    </div>
  );
}

function ChatSection() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>("");
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [groupedIntegrations, setGroupedIntegrations] = useState<Record<string, any[]>>({});
  const [isCreatingJourney, setIsCreatingJourney] = useState(false);
  const [pendingJourneyPrompt, setPendingJourneyPrompt] = useState<string>("");
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
        i.is_active && llmProviders.includes(i.provider?.toLowerCase())
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

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  useEffect(() => {
    if (scrollRef.current && messages.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (messageText: string) => {
    if (isStreaming) return;
    
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageText,
      createdAt: new Date(),
    };
    
    const assistantMessageId = crypto.randomUUID();
    
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    
    try {
      const res = await agentsApi.chat(messageText, selectedIntegration || undefined);
      const content = res.data?.response || res.data?.content || res.data || "";
      
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content: content,
      }]);
      
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || "Erro ao enviar mensagem");
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content: "Desculpe, ocorreu um erro ao processar sua mensagem.",
      }]);
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, selectedIntegration]);

  const createJourneyMutation = useMutation({
    mutationFn: async (data: { prompt: string; integrationId?: string; instanceId?: string }) => {
      const res = await journeysApi.create(data.prompt, data.integrationId, data.instanceId);
      return res.data;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      
      let responseText = `Jornada **"${res.name || 'Criada'}"** criada com sucesso!`;
      if (res.instance_id) {
        const inst = instances.find((i: any) => i.id === res.instance_id);
        responseText += `\n\n📍 **Instância:** ${inst?.name || 'N/A'}`;
      }
      if (res.group_jid) {
        responseText += `\n👥 **Grupo:** ${res.group_jid.split('@')[0] || 'N/A'}`;
      }
      if (res.flow?.steps?.length) {
        responseText += `\n🔄 **Fluxo:** ${res.flow.steps.length} passo(s)`;
      }
      responseText += "\n\nA jornada já está ativa e monitorando mensagens!";
      
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: responseText,
        id: crypto.randomUUID()
      }]);
      setIsCreatingJourney(false);
      setPendingJourneyPrompt("");
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
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Você ainda não tem instâncias configuradas. Vá para **Instâncias** para criar uma."
        }]);
      } else {
        const instList = instances.map((i: any) => `- **${i.name}** (${i.status})`).join('\n');
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Suas instâncias:\n\n${instList}\n\nPara criar uma jornada, mencione o nome da instância no pedido.`
        }]);
      }
    } else {
      sendMessage("O que você pode fazer? Me explique suas funcionalidades.");
    }
  };

  const handleSend = () => {
    if (!prompt.trim() || isStreaming) return;
    
    const userMessage = prompt.trim();
    const lowerMsg = userMessage.toLowerCase();
    
    // Detecção de criação de jornada
    const isJourney = lowerMsg.includes("crie") || lowerMsg.includes("criar") ||
                      lowerMsg.includes("jornada") || lowerMsg.includes("automação") ||
                      lowerMsg.includes("quando alguém") || lowerMsg.includes("responda") ||
                      lowerMsg.includes("quando mandar") || lowerMsg.includes("envie mensagem");
    
    if (isJourney) {
      setIsCreatingJourney(true);
      setPendingJourneyPrompt(userMessage);
      sendMessage(`Analise este pedido de automação WhatsApp e confirme os detalhes:

"${userMessage}"

Extraia:
- Qual instância será usada (se mencionada)
- Qual grupo será monitorado (se mencionado)
- Qual a palavra-chave ou mensagem que aciona
- Qual ação será tomada (enviar mensagem no privado/grupo, adicionar tag, etc)

Responda de forma clara e pergunte se o usuário confirma.`);
    } else {
      sendMessage(userMessage);
    }
  };

  const confirmJourneyCreation = () => {
    if (!pendingJourneyPrompt) {
      toast.error("Nenhuma jornada pendente para criar");
      return;
    }
    createJourneyMutation.mutate({
      prompt: pendingJourneyPrompt,
      integrationId: selectedIntegration || undefined,
      instanceId: selectedInstance || undefined
    });
  };

  const cancelJourneyCreation = () => {
    setIsCreatingJourney(false);
    setPendingJourneyPrompt("");
    setMessages((prev) => [...prev, {
      role: "assistant",
      content: "Entendido. Pode me perguntar outras coisas ou criar uma jornada quando quiser.",
      id: crypto.randomUUID()
    }]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--green)" }}>
            <SparklesIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Assistente IA</h2>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Crie jornadas ManyChat</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Instance selector */}
          <div className="relative">
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="appearance-none outline-none text-xs font-medium rounded-lg px-3 py-2 pr-8 cursor-pointer min-w-[150px]"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            >
              <option value="">Todas instâncias</option>
              {instances.map((inst: any) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} {inst.status === "connected" ? "🟢" : "⚫"}
                </option>
              ))}
            </select>
            <Server className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--text-3)" }} />
          </div>

          {/* Model selector */}
          <div className="relative">
            <select
              value={selectedIntegration || ""}
              onChange={(e) => setSelectedIntegration(e.target.value)}
              className="appearance-none outline-none text-xs font-medium rounded-lg px-3 py-2 pr-8 cursor-pointer min-w-[180px] max-w-[250px]"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            >
              {isLoadingIntegrations ? (
                <option value="">Carregando...</option>
              ) : Object.keys(groupedIntegrations).length === 0 ? (
                <option value="">Nenhum modelo</option>
              ) : (
                <>
                  {!selectedIntegration && <option value="">Modelo...</option>}
                  {Object.entries(groupedIntegrations).map(([provider, items]: [string, any]) => (
                    <optgroup key={provider} label={`── ${provider} ──`}>
                      {(items as any[]).map((i: any) => (
                        <option key={i.id} value={i.id}>
                          {i.name}{i.model ? ` (${i.model})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </>
              )}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--text-3)" }} />
          </div>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0 flex flex-col" style={{ background: "var(--surface-2)" }}>
        {messages.length === 0 ? (
          <EmptyState onSuggestionClick={handleSuggestionClick} />
        ) : (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" style={{ background: "var(--surface-2)" }}>
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <ChatMessage key={msg.id} message={msg} isNew={i === messages.length - 1 && msg.role === "assistant"} />
              ))}
              {isStreaming && (
                <motion.div key="thinking" className="flex gap-4 px-8 py-5 border-b border-[var(--surface-border)]" style={{ background: "var(--surface-2)" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "var(--green)" }}>
                    <SparklesIcon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--text-3)" }}>Assistente IA</p>
                    <ThinkingDots />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        
        {/* Loading overlay */}
        {isStreaming && (
          <div className="px-6 py-2 border-t flex-shrink-0" style={{ background: "rgba(0,212,106,0.05)", borderColor: "var(--surface-border)" }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--green)" }}>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Processando resposta...</span>
            </div>
          </div>
        )}
        
        {/* Journey confirmation */}
        {isCreatingJourney && !isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && (
          <div className="px-6 pb-4 pt-2">
            <div className="rounded-xl p-4" style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Wand2 className="w-4 h-4" style={{ color: "var(--green)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--green)" }}>Confirmar criação da jornada?</span>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                Revise as informações acima e confirme para ativar a automação.
              </p>
              <div className="flex gap-2">
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
          <PromptInput
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            isLoading={isStreaming}
            placeholder={selectedInstance ? "Descreva uma automação para esta instância..." : "Descreva a automação que deseja criar..."}
          />
        </div>
      </div>
    </div>
  );
}

function JourneysSection() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  const { data: journeys = [], isLoading } = useQuery({
    queryKey: ["journeys"],
    queryFn: async () => (await journeysApi.list()).data,
  });

  const { data: agentStats } = useQuery({
    queryKey: ["agent-stats"],
    queryFn: async () => (await agentsApi.stats()).data,
    refetchInterval: 30000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await journeysApi.updateStatus(id, status as "active" | "paused");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Status atualizado!");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await journeysApi.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Jornada removida!");
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4" style={{ color: "#8b5cf6" }} />
          <h2 className="text-sm font-bold" style={{ color: "var(--text-1)" }}>Jornadas</h2>
        </div>
        <div className="flex-1" />
        {agentStats?.journeys && (
          <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-3)" }}>
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
          {journeys.length}
        </span>
      </div>

      {/* Journeys list */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4 custom-scrollbar min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--surface-3)" }} />
            ))}
          </div>
        ) : journeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 opacity-40 text-center">
            <Wand2 className="w-12 h-12 mb-3" style={{ color: "var(--text-3)" }} />
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhuma jornada criada</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Vá para Chat IA para criar uma</p>
          </div>
        ) : (
          journeys.map((j: any) => (
            <div key={j.id} className="rounded-xl overflow-hidden" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                onClick={() => setExpanded((p) => ({ ...p, [j.id]: !p[j.id] }))}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: j.status === "active" ? "#00d46a" : "#6b7280" }} />
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>{j.name || j.prompt}</p>
                    {j.instance_name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)]" style={{ color: "var(--text-3)" }}>
                        {j.instance_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-3)" }}>
                      <Zap className="w-3 h-3" /> {j.trigger_filter || j.trigger_type || "automática"}
                    </span>
                    <span className="text-xs opacity-30">·</span>
                    <span className="text-xs" style={{ color: "var(--text-3)" }}>
                      {j.invocations || 0} execuções
                    </span>
                    {j.active_executions > 0 && (
                      <>
                        <span className="text-xs opacity-30">·</span>
                        <span className="text-xs flex items-center gap-1 text-emerald-500">
                          <Activity className="w-3 h-3" /> {j.active_executions} ativa{j.active_executions > 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: j.id, status: j.status === "active" ? "paused" : "active" }); }}
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: j.status === "active" ? "#00d46a" : "var(--text-3)" }}
                    title={j.status === "active" ? "Pausar" : "Ativar"}
                  >
                    {j.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${j.status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-500"}`}>
                    {j.status}
                  </span>
                  {expanded[j.id] ? <ChevronUp className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
                </div>
              </div>
              
              {expanded[j.id] && (
                <div className="p-4 border-t" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
                  {/* Flow preview */}
                  <FlowPreview flow={j.flow} trigger={j.trigger_filter} />

                  {/* Keywords & stats */}
                  <div className="flex gap-3 mt-3">
                    <div className="flex-1 p-3 rounded-xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                      <p className="text-[9px] uppercase font-bold mb-1" style={{ color: "var(--text-3)" }}>Palavras-chave</p>
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
                      <p className="text-[9px] uppercase font-bold mb-1" style={{ color: "var(--text-3)" }}>Estatísticas</p>
                      <div className="text-xs" style={{ color: "var(--text-2)" }}>
                        <div className="flex justify-between">
                          <span>Total:</span><span>{j.invocations || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Completadas:</span><span>{j.completed_executions || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Taxa:</span><span>{j.completion_rate?.toFixed(0) || 0}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Prompt */}
                  <div className="mt-3 p-3 rounded-xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                    <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-3)" }}>Prompt original</p>
                    <p className="text-xs" style={{ color: "var(--text-2)" }}>{j.prompt}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: "var(--surface-border)" }}>
                    <button onClick={() => { if (confirm("Deseja realmente excluir esta jornada?")) deleteMutation.mutate(j.id); }} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-red-500/10 hover:text-red-400" style={{ color: "var(--text-3)" }}>
                      <Trash2 className="w-3.5 h-3.5" /> Excluir
                    </button>
                    <button onClick={() => toggleMutation.mutate({ id: j.id, status: j.status === "active" ? "paused" : "active" })} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: j.status === "active" ? "rgba(234,179,8,0.1)" : "rgba(0,212,106,0.1)", color: j.status === "active" ? "#eab308" : "#00d46a", border: `1px solid ${j.status === "active" ? "rgba(234,179,8,0.2)" : "rgba(0,212,106,0.2)"}` }}>
                      {j.status === "active" ? <><Pause className="w-3.5 h-3.5" /> Pausar</> : <><Play className="w-3.5 h-3.5" /> Ativar</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ActivitySection() {
  const { data: activityData, isLoading } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: async () => (await agentsApi.activity(50)).data,
    refetchInterval: 10000,
  });

  const { data: stats } = useQuery({
    queryKey: ["agent-stats"],
    queryFn: async () => (await agentsApi.stats()).data,
    refetchInterval: 30000,
  });

  const items = activityData?.items || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header with stats */}
      <div className="flex items-center gap-4 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4" style={{ color: "#10b981" }} />
          <h2 className="text-sm font-bold" style={{ color: "var(--text-1)" }}>Atividade</h2>
        </div>
        <div className="flex-1" />
        {stats && (
          <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-3)" }}>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(0,212,106,0.1)" }}>
              <Activity className="w-3 h-3" style={{ color: "var(--green)" }} />
              {stats.journeys.active_executions} ativa{stats.journeys.active_executions !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.1)" }}>
              <TrendingUp className="w-3 h-3" style={{ color: "#3b82f6" }} />
              {stats.journeys.today_executions} hoje
            </span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(139,92,246,0.1)" }}>
              <Server className="w-3 h-3" style={{ color: "#8b5cf6" }} />
              {stats.instances_active} instância{stats.instances_active !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--surface-3)" }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 opacity-40 text-center">
            <Activity className="w-12 h-12 mb-3" style={{ color: "var(--text-3)" }} />
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhuma atividade ainda</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>As execuções aparecerão aqui em tempo real</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--surface-border)" }}>
            {items.map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--surface-3)] transition-colors">
                {/* Status indicator */}
                <div className="flex-shrink-0">
                  <span className={`w-2.5 h-2.5 rounded-full block ${
                    item.status === "active" ? "bg-emerald-500 animate-pulse" :
                    item.status === "completed" ? "bg-blue-500" :
                    item.status === "failed" ? "bg-red-500" :
                    "bg-zinc-500"
                  }`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                      {item.contact_name || item.contact_jid}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                      background: item.status === "active" ? "rgba(16,185,129,0.1)" :
                                 item.status === "completed" ? "rgba(59,130,246,0.1)" :
                                 "rgba(107,114,128,0.1)",
                      color: item.status === "active" ? "#10b981" :
                             item.status === "completed" ? "#3b82f6" :
                             "var(--text-3)"
                    }}>
                      {item.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                      {item.journey_name}
                    </span>
                    {item.group_name && (
                      <>
                        <span className="text-[10px] opacity-30">·</span>
                        <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                          {item.group_name}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Steps & message */}
                <div className="flex-shrink-0 text-right max-w-[200px]">
                  {item.total_steps > 0 && (
                    <div className="text-[10px] mb-1" style={{ color: "var(--text-3)" }}>
                      Passo {item.step_index + 1}/{item.total_steps}
                    </div>
                  )}
                  {item.last_message && (
                    <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                      {item.last_message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentsPageClient() {
  const [active, setActive] = useState<AgentSection>("chat");

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3" style={{ color: "var(--text-1)" }}>
          <Sparkles className="w-6 h-6" style={{ color: "#8b5cf6" }} />
          Centro de Agentes
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
          Crie jornadas estilo ManyChat via comandos em linguagem natural.
        </p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Submenu sidebar */}
        <aside className="w-52 flex-shrink-0">
          <nav className="rounded-2xl overflow-hidden" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            {SECTIONS.map((section, i) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActive(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-4 text-left transition-all duration-150 relative",
                    i < SECTIONS.length - 1 ? "border-b" : ""
                  )}
                  style={{ borderColor: "var(--surface-border)", background: isActive ? "var(--surface-3)" : "transparent" }}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r" style={{ background: "var(--green)" }} />
                  )}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isActive ? "rgba(0,212,106,0.15)" : "var(--surface-3)",
                      border: `1px solid ${isActive ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                    }}
                  >
                    <Icon className="w-4 h-4" style={{ color: isActive ? "var(--green)" : "var(--text-3)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate" style={{ color: isActive ? "var(--green)" : "var(--text-1)" }}>
                      {section.label}
                    </p>
                    <p className="text-[10px] truncate mt-0.5 opacity-60" style={{ color: isActive ? "var(--green)" : "var(--text-3)" }}>
                      {section.description}
                    </p>
                  </div>
                  <ChevronRight
                    className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
                    style={{ color: isActive ? "var(--green)" : "var(--text-3)", transform: isActive ? "translateX(1px)" : "none" }}
                  />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content area */}
        <div className="flex-1 min-w-0 min-h-0 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--surface-border)" }}>
          {active === "chat" && <ChatSection />}
          {active === "journeys" && <JourneysSection />}
          {active === "activity" && <ActivitySection />}
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3" style={{ color: "var(--text-1)" }}>
            <Sparkles className="w-6 h-6" style={{ color: "#8b5cf6" }} />
            Centro de Agentes
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Carregando...</p>
        </div>
        <div className="flex gap-6">
          <div className="w-52 h-24 rounded-2xl animate-pulse" style={{ background: "var(--surface-2)" }} />
          <div className="flex-1 h-[600px] rounded-2xl animate-pulse" style={{ background: "var(--surface-2)" }} />
        </div>
      </div>
    );
  }

  return <AgentsPageClient />;
}
