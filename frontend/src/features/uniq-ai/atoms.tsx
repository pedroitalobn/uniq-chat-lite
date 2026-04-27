"use client";

// Átomos visuais compartilhados pelo Chat IA (página /uniq-ai e Dynamic Island).
// Antes viviam dentro de app/(dashboard)/agents/page.tsx — extraídos pra que o
// chat possa rodar em telas distintas (home full-screen, ilha rodapé, etc).

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, Bot, Check, Clock, Copy, Loader2, MessageSquare, Send, Server,
  Sparkles as SparklesIcon, Tag, User, Wand2, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RichMentionText } from "@/components/MentionPicker";
import { cn } from "@/lib/utils";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}

export const WELCOME_SUGGESTIONS = [
  { icon: Wand2, label: "Criar uma jornada", description: "Quando alguém mandar 'bom dia' no grupo, responda com um oi" },
  { icon: MessageSquare, label: "Listar jornadas", description: "Veja suas automações ativas" },
  { icon: SparklesIcon, label: "Explorar recursos", description: "Descubra o que posso fazer" },
  { icon: Server, label: "Ver instâncias", description: "Suas instâncias disponíveis" },
];

export function TypewriterText({ text }: { text: string }) {
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
    const t = setTimeout(() => setDisplayed((d) => d + 1), speed);
    return () => clearTimeout(t);
  }, [displayed, text]);

  const displayText = text.slice(0, displayed);

  return (
    <div>
      <ReactMarkdown
        components={{
          p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
          strong({ children }) { return <strong className="font-semibold">{children}</strong>; },
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

export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map((i) => (
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

// Mini-preview do flow — usado tanto no chat (em respostas com pending_journey)
// quanto na lista de jornadas. Mantém tipos `any` porque a forma do flow
// vem do backend e não há schema TS compartilhado.
export function FlowPreview({ flow, trigger }: { flow?: any; trigger?: string }) {
  if (!flow?.steps?.length) {
    return (
      <div className="flex items-center gap-3 overflow-x-auto pb-2">
        <div className="flex flex-col items-center gap-1.5 min-w-[100px] p-2.5 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="p-1.5 rounded-full" style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
            <Zap className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          </div>
          <span className="text-[9px] uppercase font-semibold" style={{ color: "var(--text-3)" }}>Gatilho</span>
          <span className="text-[10px] font-medium text-center truncate w-full" style={{ color: "var(--text-1)" }}>
            {trigger || "keyword"}
          </span>
        </div>
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        <div className="flex flex-col items-center gap-1.5 min-w-[100px] p-2.5 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="p-1.5 rounded-full" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)" }}>
            <MessageSquare className="w-3.5 h-3.5" style={{ color: "#eab308" }} />
          </div>
          <span className="text-[9px] uppercase font-semibold" style={{ color: "var(--text-3)" }}>Ação</span>
          <span className="text-[10px] font-medium text-center" style={{ color: "var(--text-1)" }}>
            Responder
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      <div className="flex flex-col items-center gap-1.5 min-w-[90px] p-2 rounded-xl flex-shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="p-1.5 rounded-full" style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
          <Zap className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
        </div>
        <span className="text-[8px] uppercase font-semibold" style={{ color: "var(--text-3)" }}>Gatilho</span>
        <span className="text-[10px] font-medium text-center truncate w-full" style={{ color: "var(--text-1)" }}>
          {trigger || "message"}
        </span>
      </div>

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
              }`,
            }}>
              {step.type === "message" ? <Send className="w-3 h-3" style={{ color: "#3b82f6" }} /> :
               step.type === "wait" ? <Clock className="w-3 h-3" style={{ color: "#eab308" }} /> :
               step.type === "tag" ? <Tag className="w-3 h-3" style={{ color: "#eab308" }} /> :
               <Bot className="w-3 h-3" style={{ color: "#8b5cf6" }} />}
            </div>
            <span className="text-[8px] uppercase font-semibold" style={{ color: "var(--text-3)" }}>
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

export function EmptyState({ onSuggestionClick }: { onSuggestionClick: (label: string) => void }) {
  return (
    <motion.div
      className="h-full flex flex-col items-center justify-center px-4 sm:px-8 py-8 sm:py-12"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-5 sm:mb-6"
        style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
        <SparklesIcon className="w-7 h-7 sm:w-8 sm:h-8" style={{ color: "var(--green)" }} />
      </div>
      <h2 className="text-lg sm:text-xl font-medium mb-2 text-center" style={{ color: "var(--text-1)" }}>
        Olá, sou o Uniq AI
      </h2>
      <p className="text-sm text-center mb-6 sm:mb-8 max-w-md" style={{ color: "var(--text-3)" }}>
        Crie jornadas, gerencie suas instâncias, e em breve dispare campanhas e mensagens — tudo via linguagem natural.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {WELCOME_SUGGESTIONS.map((item, idx) => (
          <motion.button
            key={idx}
            onClick={() => onSuggestionClick(item.label)}
            className="p-3 sm:p-4 rounded-xl text-left"
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

export function ChatMessage({ message, isNew = false }: { message: Message; isNew?: boolean }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      className={cn("group flex gap-3 sm:gap-4 px-4 sm:px-8 py-4 sm:py-5",
        !isUser && "border-b border-[var(--surface-border)]"
      )}
      style={isUser ? { background: "var(--surface-3)" } : { background: "var(--surface-2)" }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
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
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>
          {isUser ? "Você" : "Uniq AI"}
        </p>
        <div className="text-sm leading-relaxed break-words" style={{ color: "var(--text-1)" }}>
          {isUser ? (
            <RichMentionText className="block" text={message.content} />
          ) : (
            isNew ? <TypewriterText text={message.content} /> : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
                  code({ className, children, ...props }: any) {
                    const inline = !/language-/.test(className || "");
                    if (inline) {
                      return <code className="px-1 py-0.5 rounded text-[12px] font-mono"
                        style={{ background: "var(--surface-3)", color: "var(--green)" }} {...props}>{children}</code>;
                    }
                    return <code className={cn("font-mono text-[12px]", className)} {...props}>{children}</code>;
                  },
                  pre({ children }) {
                    return <pre className="rounded-lg p-3 my-2 overflow-x-auto text-[12px]"
                      style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>{children}</pre>;
                  },
                  table({ children }) {
                    return <div className="my-2 overflow-x-auto"><table className="text-[13px] border-collapse">{children}</table></div>;
                  },
                  th({ children }) { return <th className="px-2 py-1 text-left font-medium border-b" style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}>{children}</th>; },
                  td({ children }) { return <td className="px-2 py-1 border-b" style={{ borderColor: "var(--surface-border)" }}>{children}</td>; },
                  blockquote({ children }) {
                    return <blockquote className="border-l-2 pl-3 my-2 italic" style={{ borderColor: "var(--green)", color: "var(--text-2)" }}>{children}</blockquote>;
                  },
                  h1({ children }) { return <h3 className="text-base font-medium mt-3 mb-2">{children}</h3>; },
                  h2({ children }) { return <h4 className="text-sm font-medium mt-3 mb-1.5">{children}</h4>; },
                  h3({ children }) { return <h5 className="text-sm font-medium mt-2 mb-1">{children}</h5>; },
                  strong({ children }) { return <strong className="font-semibold">{children}</strong>; },
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

export function PromptInput({
  value, onChange, onSend, onKeyDown, disabled, isLoading, placeholder,
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
    <div className="px-3 sm:px-6 pb-4 sm:pb-5 pt-2 sm:pt-3">
      <motion.div
        className="flex items-end gap-2 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3"
        style={{
          background: isLoading ? "rgba(0,212,106,0.08)" : "var(--surface-3)",
          border: `1px solid ${isLoading ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
          transition: "all 0.2s ease",
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder || "Pergunte ou peça uma automação…"}
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
            opacity: isLoading ? 1 : (canSend ? 1 : 0.5),
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
          <span className="hidden sm:inline">Enter para enviar · Shift+Enter para nova linha</span>
        )}
        {!isLoading && <span className="sm:hidden">Toque em enviar</span>}
      </p>
    </div>
  );
}
