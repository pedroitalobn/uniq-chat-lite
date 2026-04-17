"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Sparkles, MessageSquare,
  Trash2, Wand2, ChevronRight, ChevronUp, ChevronDown, Loader2, Play, Pause,
  CheckCircle2, Zap, ArrowRight, Hash, Users, Contact, Megaphone, Tag,
  Copy, Check, SparklesIcon, Circle, Activity, TrendingUp, Eye, Clock,
  Server, Globe, AlertCircle, Edit3, X, Maximize2
} from "lucide-react";
import { integrationsApi, agentsApi, journeysApi, groupsApi, instancesApi } from "@/lib/api";
import api from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import ReactMarkdown from "react-markdown";
import type { ChannelType } from "@/types";

type AgentSection = "chat" | "journeys" | "activity";

const CHANNELS: { id: ChannelType; label: string; color: string }[] = [
  { id: "whatsapp", label: "WhatsApp", color: "#25d366" },
  { id: "instagram", label: "Instagram", color: "#e1306c" },
  { id: "facebook", label: "Facebook", color: "#1877f2" },
  { id: "telegram", label: "Telegram", color: "#229ed9" },
  { id: "linkedin", label: "LinkedIn", color: "#0a66c2" },
  { id: "tiktok", label: "TikTok", color: "#ff0050" },
  { id: "kwai", label: "Kwai", color: "#ff6600" },
];

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
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed(0);
    setDone(false);
  }, [text]);

  useEffect(() => {
    if (displayed >= text.length) {
      setDone(true);
      return;
    }
    const speed = text.length > 200 ? 6 : 12;
    const t = setTimeout(() => setDisplayed(d => d + 1), speed);
    return () => clearTimeout(t);
  }, [displayed, text]);

  const displayText = text.slice(0, displayed);

  return (
    <div>
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
        {displayText}
      </ReactMarkdown>
      {!done && (
        <span
          className="inline-block w-[2px] h-[1em] ml-[1px] align-middle animate-pulse"
          style={{ background: "var(--green)", borderRadius: 1 }}
        />
      )}
    </div>
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
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [groupedIntegrations, setGroupedIntegrations] = useState<Record<string, any[]>>({});
  const [isCreatingJourney, setIsCreatingJourney] = useState(false);
  const [pendingJourneyPrompt, setPendingJourneyPrompt] = useState<string>("");
  const [pendingJourneyData, setPendingJourneyData] = useState<any>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);
  const [editingJourney, setEditingJourney] = useState<any>(null);
  const [editMessages, setEditMessages] = useState<Message[]>([]);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: instances = [] } = useQuery({
    queryKey: ["instances"],
    queryFn: async () => (await instancesApi.list()).data,
  });

  // Load chat history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("agents_chat_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMessages(parsed.map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) })));
      } catch { /* ignore */ }
    }
  }, []);

  // Save chat history to localStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("agents_chat_history", JSON.stringify(messages));
    }
  }, [messages]);

  // Clear chat history
  const clearChatHistory = () => {
    setMessages([]);
    localStorage.removeItem("agents_chat_history");
    toast.success("Histórico limpo");
  };

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
      const res = await agentsApi.chat(messageText, selectedIntegration || undefined, selectedModel || undefined);
      const content = res.data?.response || res.data?.content || res.data || "";
      
      // Check if this is a journey preview that needs confirmation
      if (res.data?.journey_preview && res.data?.pending_journey) {
        setIsCreatingJourney(true);
        setPendingJourneyPrompt(messageText);
        setPendingJourneyData(res.data.pending_journey);
      }
      
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
  }, [isStreaming, selectedIntegration, selectedModel]);

  // Update selected model when integration changes
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
    setPendingJourneyData(null);
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
          <div className="flex items-center gap-1">
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
            
            {/* Model sub-selector */}
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

function JourneysSection({ onEditJourney }: { onEditJourney?: (journey: any) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{id: string; name: string} | null>(null);
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
      const session = await import("next-auth/react").then(m => m.getSession());
      const token = (session as any)?.accessToken;
      console.log("Toggling journey:", id, status, "Token exists:", !!token);
      
      const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
      const res = await fetch(`${baseURL}/journeys/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao atualizar status");
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Status atualizado!");
    },
    onError: (err) => {
      console.error("Toggle error:", err);
      toast.error("Erro: " + (err as Error).message);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (journey: any) => {
      const session = await import("next-auth/react").then(m => m.getSession());
      const token = (session as any)?.accessToken;
      const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
      
      const res = await fetch(`${baseURL}/journeys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: `Cópia de ${journey.prompt}`,
          instance_id: journey.instance_id
        }),
        credentials: "include",
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao duplicar jornada");
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Jornada duplicada!");
    },
    onError: (err) => {
      toast.error("Erro ao duplicar: " + (err as Error).message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const session = await import("next-auth/react").then(m => m.getSession());
      const token = (session as any)?.accessToken;
      
      const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
      const res = await fetch(`${baseURL}/journeys/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error("Erro ao deletar jornada");
      }
      
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys"] });
      toast.success("Jornada removida!");
    },
    onError: (err) => {
      console.error("Delete error:", err);
      toast.error("Erro: " + (err as Error).message);
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
                <div className="flex items-center gap-1 ml-4" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { console.log("Click on pause/delete buttons, journey id:", j.id); toggleMutation.mutate({ id: j.id, status: j.status === "active" ? "paused" : "active" }); }}
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: j.status === "active" ? "#00d46a" : "var(--text-3)", background: j.status === "active" ? "rgba(0,212,106,0.1)" : "transparent" }}
                    title={j.status === "active" ? "Pausar" : "Ativar"}
                  >
                    {j.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ id: j.id, name: j.name || j.prompt?.slice(0, 30) || 'Jornada' })}
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
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap" style={{ borderColor: "var(--surface-border)" }}>
                    <a
                      href={`/agents/builder/${j.id}`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ background: "rgba(0,212,106,0.12)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.25)" }}
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Canvas
                    </a>
                    <button onClick={() => onEditJourney?.(j)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: "rgba(139,92,246,0.1)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,0.2)" }}>
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

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 backdrop-blur-sm" 
            style={{ background: "rgba(0,0,0,0.7)" }} 
            onClick={() => setDeleteConfirm(null)} 
          />
          <motion.div
            className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
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
                <h3 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Excluir Jornada</h3>
                <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 46%)" }}>Esta ação não pode ser desfeita</p>
              </div>
            </div>
            
            <p className="text-sm mb-6" style={{ color: "hsl(240 8% 60%)" }}>
              Tem certeza que deseja excluir a jornada <span className="font-semibold" style={{ color: "hsl(240 15% 93%)" }}>"{deleteConfirm.name}"</span>?
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
    </div>
  );
}

function ActivitySection() {
  const { data: activityData, isLoading } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: async () => (await agentsApi.activity(50)).data,
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ["agent-stats"],
    queryFn: async () => (await agentsApi.stats()).data,
    refetchInterval: 30000,
  });

  const items = activityData?.items || [];

  const getActivityIcon = (item: any) => {
    if (item.last_message_type === "inbound") return <MessageSquare className="w-4 h-4" style={{ color: "#60a5fa" }} />;
    if (item.last_message_type === "outbound") return <Send className="w-4 h-4" style={{ color: "#00d46a" }} />;
    if (item.last_message_type === "wait") return <Clock className="w-4 h-4" style={{ color: "#f59e0b" }} />;
    return <Zap className="w-4 h-4" style={{ color: "#8b5cf6" }} />;
  };

  const getActivityMessage = (item: any) => {
    if (item.last_message_type === "inbound") {
      return `Recebeu "${item.last_message?.slice(0, 30) || 'mensagem'}..." de ${item.contact_name || item.contact_jid?.split('@')[0]}`;
    }
    if (item.last_message_type === "outbound") {
      const mode = item.response_mode === "private" ? "no privado" : "no grupo";
      return `Enviou mensagem ${mode}: "${item.last_message?.slice(0, 40) || '...'}..."`;
    }
    if (item.status === "completed") {
      return `Jornada concluída com sucesso!`;
    }
    if (item.status === "failed") {
      return `Falhou: ${item.error_message || 'erro desconhecido'}`;
    }
    return item.last_message || `Executando passo ${(item.step_index || 0) + 1}/${item.total_steps || '?'}`;
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "active": return { color: "#10b981", bg: "rgba(16,185,129,0.1)", label: "Executando" };
      case "completed": return { color: "#3b82f6", bg: "rgba(59,130,246,0.1)", label: "Concluída" };
      case "failed": return { color: "#ef4444", bg: "rgba(239,68,68,0.1)", label: "Falhou" };
      case "pending": return { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", label: "Pendente" };
      default: return { color: "#6b7280", bg: "rgba(107,114,128,0.1)", label: status };
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with stats */}
      <div className="flex items-center gap-4 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4" style={{ color: "#10b981" }} />
          <h2 className="text-sm font-bold" style={{ color: "var(--text-1)" }}>Atividade em Tempo Real</h2>
        </div>
        <div className="flex-1" />
        {stats && (
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-3)" }}>
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
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--surface-3)" }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 opacity-40 text-center">
            <Activity className="w-12 h-12 mb-3" style={{ color: "var(--text-3)" }} />
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhuma atividade ainda</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>As execuções aparecerão aqui em tempo real</p>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {items.map((item: any, i: number) => {
              const statusConfig = getStatusConfig(item.status);
              return (
                <div key={i} className="rounded-xl p-4 transition-all hover:scale-[1.01]" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: statusConfig.bg }}>
                      {getActivityIcon(item)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                          {item.journey_name || 'Jornada'}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: statusConfig.bg, color: statusConfig.color }}>
                          {statusConfig.label}
                        </span>
                      </div>

                      {/* Action message */}
                      <p className="text-sm mb-2" style={{ color: item.last_message_type === "outbound" ? "#00d46a" : "var(--text-2)" }}>
                        {getActivityMessage(item)}
                      </p>

                      {/* Meta info */}
                      <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-3)" }}>
                        {item.contact_name && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {item.contact_name}
                          </span>
                        )}
                        {item.instance_name && (
                          <span className="flex items-center gap-1">
                            <Server className="w-3 h-3" />
                            {item.instance_name}
                          </span>
                        )}
                        {item.group_name && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {item.group_name}
                          </span>
                        )}
                        {item.total_steps > 0 && (
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            Passo {(item.step_index || 0) + 1}/{item.total_steps}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Time */}
                    <div className="flex-shrink-0 text-right">
                      {item.started_at && (
                        <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                          {new Date(item.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentsPageClient() {
  const { currentWorkspace } = useWorkspace();
  const [active, setActive] = useState<AgentSection>("chat");
  const [editingJourney, setEditingJourney] = useState<any>(null);
  const [editMessages, setEditMessages] = useState<Message[]>([]);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isEditStreaming, setIsEditStreaming] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<ChannelType[]>(["whatsapp"]);
  const editScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: instData = [] } = useQuery<any[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then(r => r.data),
  });

  const chAvail = CHANNELS.filter(c => instData.some((i: any) => i.channel === c.id && i.status === "connected"));

  const handleEditJourney = (journey: any) => {
    setEditingJourney(journey);
    setEditMessages([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: `Editando jornada: **${journey.name || journey.prompt?.slice(0, 50) || 'Jornada'}**\n\nPrompt original:\n${journey.prompt}\n\nO que você gostaria de alterar? Pode me dizer em linguagem natural, por exemplo:\n- "Mude a mensagem de resposta para 'Olá!'\n- "Adicione um passo de esperar 5 segundos"\n- "Mude o grupo para 'vendas'"`
    }]);
    setIsEditing(true);
  };

  const closeEditModal = () => {
    setIsEditing(false);
    setEditingJourney(null);
    setEditMessages([]);
    setEditPrompt("");
  };

  const sendEditMessage = async () => {
    if (!editPrompt.trim() || isEditStreaming) return;
    
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: editPrompt.trim(),
      createdAt: new Date(),
    };
    
    setEditMessages(prev => [...prev, userMessage]);
    setEditPrompt("");
    setIsEditStreaming(true);
    
    try {
      const res = await agentsApi.chat(editPrompt.trim());
      const content = res.data?.response || res.data?.content || "";
      
      setEditMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: content,
      }]);
      
      // Check if journey was updated
      if (content.includes("atualizada") || content.includes("modificada") || content.includes("alterada")) {
        queryClient.invalidateQueries({ queryKey: ["journeys"] });
        toast.success("Jornada atualizada!");
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || "Erro ao editar jornada");
      setEditMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Desculpe, ocorreu um erro ao processar sua solicitação.",
      }]);
    } finally {
      setIsEditStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3" style={{ color: "var(--text-1)" }}>
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: "#8b5cf6" }} />
          <span className="hidden sm:inline">Centro de Agentes</span>
          <span className="sm:hidden">Agentes</span>
        </h1>
        <p className="text-sm mt-1 hidden sm:block" style={{ color: "var(--text-3)" }}>
          Crie jornadas estilo ManyChat via comandos em linguagem natural.
        </p>
      </div>

      <div className="flex gap-4 sm:gap-6 flex-1 min-h-0">
        {/* Submenu sidebar - hidden on mobile, shown as tabs */}
        <aside className="hidden sm:flex w-44 lg:w-52 flex-shrink-0 flex-col gap-4">
          <nav className="rounded-2xl overflow-hidden" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            {SECTIONS.map((section, i) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActive(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 lg:px-4 py-3 lg:py-4 text-left transition-all duration-150 relative",
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

          {/* Channel Selector */}
          <div className="rounded-2xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-3)" }}>Canais</p>
            <div className="flex flex-wrap gap-1.5">
              {chAvail.map(ch => {
                const isSelected = selectedChannels.includes(ch.id);
                return (
                  <button key={ch.id}
                    onClick={() => {
                      if (isSelected && selectedChannels.length > 1) {
                        setSelectedChannels(selectedChannels.filter(c => c !== ch.id));
                      } else if (!isSelected) {
                        setSelectedChannels([...selectedChannels, ch.id]);
                      }
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: isSelected ? ch.color : "var(--surface-3)",
                      color: isSelected ? "#fff" : "var(--text-3)",
                    }}>
                    {ch.label.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Mobile tabs - visible only on mobile */}
        <div className="sm:hidden flex gap-1 p-1 rounded-xl mb-2" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button key={section.id} onClick={() => setActive(section.id)} className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all"
                style={{ background: isActive ? "rgba(0,212,106,0.15)" : "transparent", color: isActive ? "var(--green)" : "var(--text-3)" }}>
                <Icon className="w-3.5 h-3.5" />
                <span>{section.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0 min-h-0 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--surface-border)" }}>
          {active === "chat" && <ChatSection />}
          {active === "journeys" && <JourneysSection onEditJourney={handleEditJourney} />}
          {active === "activity" && <ActivitySection />}
        </div>
      </div>

      {/* Edit Journey Modal */}
      {isEditing && editingJourney && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.7)" }} onClick={closeEditModal} />
          <motion.div
            className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl flex flex-col shadow-2xl"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)" }}>
                  <Edit3 className="w-4 h-4" style={{ color: "#8b5cf6" }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Editar Jornada</h3>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Descreva as alterações em linguagem natural</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={closeEditModal} className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-3)]" style={{ color: "var(--text-3)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Chat */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4" ref={editScrollRef}>
              {editMessages.map((msg) => (
                <div key={msg.id} className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}>
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", msg.role === "user" ? "bg-[var(--surface-3)]" : "bg-[#8b5cf6]")}>
                    {msg.role === "user" ? <User className="w-4 h-4" style={{ color: "var(--text-2)" }} /> : <SparklesIcon className="w-4 h-4 text-white" />}
                  </div>
                  <div className={cn("flex-1 max-w-[85%]", msg.role === "user" && "text-right")}>
                    <p className="text-xs font-medium mb-1" style={{ color: "var(--text-3)" }}>{msg.role === "user" ? "Você" : "Assistente IA"}</p>
                    <div className={cn("rounded-xl p-3 text-sm", msg.role === "user" ? "bg-[var(--surface-3)]" : "bg-[var(--surface-2)]")} style={{ color: "var(--text-1)" }}>
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

            {/* Input */}
            <div className="p-4 border-t flex-shrink-0" style={{ borderColor: "var(--surface-border)" }}>
              <div className="flex items-end gap-2">
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendEditMessage(); } }}
                  placeholder="Descreva a alteração que deseja fazer..."
                  rows={1}
                  className="flex-1 rounded-xl px-4 py-3 text-sm resize-none outline-none"
                  style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
                />
                <button
                  onClick={sendEditMessage}
                  disabled={!editPrompt.trim() || isEditStreaming}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                  style={{ background: "#8b5cf6" }}
                >
                  {isEditStreaming ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
                </button>
              </div>
              <p className="text-[10px] mt-2" style={{ color: "var(--text-3)" }}>
                Enter para enviar · Shift+Enter para nova linha
              </p>
            </div>
          </motion.div>
        </div>
      )}
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
