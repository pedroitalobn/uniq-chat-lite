"use client";

// Thread UI — componentes construídos sobre os primitivos do assistant-ui.
// Cada sub-componente usa as primitivas corretas:
//   ThreadPrimitive, MessagePrimitive, ComposerPrimitive,
//   ActionBarPrimitive, BranchPickerPrimitive, ChainOfThoughtPrimitive

import { forwardRef, type FC, type ReactNode } from "react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  Send,
  Square,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Thinking dots ────────────────────────────────────────────────────────────
export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ background: "var(--green)" }}
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

// ─── Thinking/running message (shown while isRunning) ─────────────────────────
export function ThinkingMessage({ phase }: { phase: string }) {
  return (
    <motion.div
      className="flex gap-3 px-4 sm:px-8 py-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ring-2 ring-green-500/30"
        style={{ background: "var(--green)" }}
      >
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-xs font-semibold" style={{ color: "var(--green)" }}>Uniq AI</p>
        <ThinkingDots />
        <motion.p
          key={phase}
          className="text-xs"
          style={{ color: "var(--text-3)" }}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
        >
          {phase}
        </motion.p>
      </div>
    </motion.div>
  );
}

// ─── Markdown text (assistant-ui + remark-gfm) ────────────────────────────────
const MARKDOWN_OVERRIDES = {
  // Code blocks
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <div className="relative group my-3">
      <pre
        {...props}
        className={cn(
          "overflow-x-auto rounded-xl p-4 text-[13px] font-mono leading-relaxed",
          "border scrollbar-thin scrollbar-thumb-white/10",
          props.className,
        )}
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.07)",
          color: "#e2e8f0",
        }}
      >
        {children}
      </pre>
    </div>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <code className={cn("text-[13px] font-mono", className)} {...props}>{children}</code>;
    }
    return (
      <code
        className="px-1.5 py-0.5 rounded-md text-[13px] font-mono"
        style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd" }}
        {...props}
      >
        {children}
      </code>
    );
  },
  // Tables
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-3 rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
      <table className="w-full text-sm" {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="px-4 py-2.5 text-left text-xs font-semibold tracking-wide"
      style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-2)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td
      className="px-4 py-2.5 text-sm"
      style={{ color: "var(--text-1)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      {...props}
    >
      {children}
    </td>
  ),
  // Lists
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-2 space-y-1 pl-5 list-disc" style={{ color: "var(--text-1)" }} {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="my-2 space-y-1 pl-5 list-decimal" style={{ color: "var(--text-1)" }} {...props}>{children}</ol>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="text-sm leading-relaxed" {...props}>{children}</li>
  ),
  // Headings
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="text-xl font-bold mt-4 mb-2" style={{ color: "var(--text-1)" }} {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-lg font-semibold mt-3 mb-1.5" style={{ color: "var(--text-1)" }} {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-base font-semibold mt-2 mb-1" style={{ color: "var(--text-1)" }} {...props}>{children}</h3>
  ),
  // Blockquote
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="pl-4 my-2 italic text-sm"
      style={{
        borderLeft: "3px solid var(--green)",
        color: "var(--text-2)",
      }}
      {...props}
    >
      {children}
    </blockquote>
  ),
  // Horizontal rule
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-4" style={{ borderColor: "rgba(255,255,255,0.07)" }} {...props} />
  ),
  // Paragraph
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-sm leading-relaxed mb-2 last:mb-0" style={{ color: "var(--text-1)" }} {...props}>{children}</p>
  ),
  // Strong / em
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold" style={{ color: "var(--text-1)" }} {...props}>{children}</strong>
  ),
  em: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <em className="italic" style={{ color: "var(--text-2)" }} {...props}>{children}</em>
  ),
  // Links
  a: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80 transition-opacity"
      style={{ color: "var(--green)" }}
      {...props}
    >
      {children}
    </a>
  ),
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      components={MARKDOWN_OVERRIDES as any}
    />
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyButton() {
  return (
    <ActionBarPrimitive.Copy asChild>
      <button
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white/5"
        style={{ color: "var(--text-3)" }}
        title="Copiar"
      >
        <ActionBarPrimitive.Copy>
          <Copy className="w-3.5 h-3.5" />
        </ActionBarPrimitive.Copy>
      </button>
    </ActionBarPrimitive.Copy>
  );
}

// ─── Reload button ────────────────────────────────────────────────────────────
function ReloadButton() {
  return (
    <ActionBarPrimitive.Reload asChild>
      <button
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white/5"
        style={{ color: "var(--text-3)" }}
        title="Regenerar"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </ActionBarPrimitive.Reload>
  );
}

// ─── Branch Picker ────────────────────────────────────────────────────────────
function BranchPicker() {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <BranchPickerPrimitive.Previous asChild>
        <button
          className="p-1 rounded hover:bg-white/5 disabled:opacity-30 transition-colors"
          style={{ color: "var(--text-3)" }}
          title="Resposta anterior"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className="text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button
          className="p-1 rounded hover:bg-white/5 disabled:opacity-30 transition-colors"
          style={{ color: "var(--text-3)" }}
          title="Próxima resposta"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

// ─── Action bar ───────────────────────────────────────────────────────────────
function MessageActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="flex items-center gap-1 mt-2"
    >
      <BranchPicker />
      <ActionBarPrimitive.Copy asChild>
        <button
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white/5"
          style={{ color: "var(--text-3)" }}
          title="Copiar"
        >
          <MessagePrimitive.If copied={false}>
            <Copy className="w-3.5 h-3.5" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied>
            <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          </MessagePrimitive.If>
        </button>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <button
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white/5"
          style={{ color: "var(--text-3)" }}
          title="Regenerar"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}

// ─── User message ─────────────────────────────────────────────────────────────
export function UserMessage() {
  return (
    <MessagePrimitive.Root className="group flex justify-end gap-3 px-4 sm:px-8 py-3">
      <div className="flex flex-col items-end gap-1 max-w-[75%]">
        <div
          className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed"
          style={{
            background: "linear-gradient(135deg, rgba(0,212,106,0.18) 0%, rgba(0,212,106,0.1) 100%)",
            border: "1px solid rgba(0,212,106,0.2)",
            color: "var(--text-1)",
          }}
        >
          <MessagePrimitive.Parts
            components={{
              Text: (props) => <span style={{ whiteSpace: "pre-wrap" }}>{(props as any).part?.text ?? ""}</span>,
            }}
          />
        </div>
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="flex items-center gap-1">
          <ActionBarPrimitive.Copy asChild>
            <button
              className="p-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-white/5"
              style={{ color: "var(--text-3)" }}
              title="Copiar"
            >
              <MessagePrimitive.If copied={false}>
                <Copy className="w-3 h-3" />
              </MessagePrimitive.If>
              <MessagePrimitive.If copied>
                <Check className="w-3 h-3" style={{ color: "var(--green)" }} />
              </MessagePrimitive.If>
            </button>
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
      </div>
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        <User className="w-4 h-4" style={{ color: "var(--text-2)" }} />
      </div>
    </MessagePrimitive.Root>
  );
}

// ─── Assistant message ────────────────────────────────────────────────────────
export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group flex gap-3 px-4 sm:px-8 py-4">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ring-1 ring-green-500/25"
        style={{
          background: "linear-gradient(135deg, var(--green) 0%, rgba(0,212,106,0.7) 100%)",
        }}
      >
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--green)" }}>Uniq AI</p>
        <div className="prose prose-invert max-w-none">
          <MessagePrimitive.Parts
            components={{
              Text: () => (
                <MarkdownTextPrimitive
                  remarkPlugins={[remarkGfm]}
                  components={MARKDOWN_OVERRIDES as any}
                />
              ),
            }}
          />
        </div>
        <MessageActionBar />
      </div>
    </MessagePrimitive.Root>
  );
}

// ─── Running/thinking message ─────────────────────────────────────────────────
export function RunningMessage({ phase }: { phase: string }) {
  return (
    <ThreadPrimitive.If running>
      <motion.div
        className="flex gap-3 px-4 sm:px-8 py-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: "linear-gradient(135deg, var(--green) 0%, rgba(0,212,106,0.7) 100%)",
          }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            <Sparkles className="w-4 h-4 text-white" />
          </motion.div>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-xs font-semibold" style={{ color: "var(--green)" }}>Uniq AI</p>
          <ThinkingDots />
          <motion.p
            key={phase}
            className="text-xs"
            style={{ color: "var(--text-3)" }}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
          >
            {phase}
          </motion.p>
        </div>
      </motion.div>
    </ThreadPrimitive.If>
  );
}

// ─── Scroll to bottom button ──────────────────────────────────────────────────
export function ScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        className="absolute bottom-4 right-4 p-2 rounded-full shadow-lg transition-colors hover:scale-110"
        style={{
          background: "rgba(20,20,30,0.9)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(8px)",
          color: "var(--text-2)",
        }}
        title="Ir para o fim"
      >
        <ArrowDown className="w-4 h-4" />
      </motion.button>
    </ThreadPrimitive.ScrollToBottom>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: "🤖", label: "Criar automação", text: "Crie uma jornada: quando alguém enviar 'oi' no grupo, mande uma mensagem de boas-vindas no privado" },
  { icon: "📋", label: "Minhas jornadas", text: "Liste todas as minhas jornadas ativas" },
  { icon: "⚡", label: "Ver instâncias", text: "Quais instâncias tenho conectadas?" },
  { icon: "✨", label: "O que posso fazer?", text: "O que você pode fazer por mim?" },
];

export function EmptyStateView({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex flex-col items-center justify-center h-full gap-6 px-4 py-12 text-center">
        <div className="relative">
          <motion.div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--green) 0%, rgba(0,212,106,0.6) 100%)" }}
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
          <div
            className="absolute inset-0 rounded-2xl blur-xl opacity-30"
            style={{ background: "var(--green)" }}
          />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-1)" }}>
            Como posso ajudar?
          </h2>
          <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--text-3)" }}>
            Crie automações, gerencie instâncias, consulte contatos e muito mais.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s.label}
              onClick={() => onSuggestionClick(s.text)}
              className="flex items-start gap-3 p-3 rounded-xl text-left transition-all hover:scale-[1.02]"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
              whileHover={{ background: "rgba(0,212,106,0.06)", borderColor: "rgba(0,212,106,0.15)" }}
              transition={{ duration: 0.15 }}
            >
              <span className="text-base leading-none mt-0.5">{s.icon}</span>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{s.label}</p>
                <p className="text-[11px] mt-0.5 line-clamp-1" style={{ color: "var(--text-3)" }}>{s.text}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
}

// ─── Composer send/cancel buttons ─────────────────────────────────────────────
export function ComposerSendButton() {
  return (
    <ComposerPrimitive.Send asChild>
      <button
        className="p-2 rounded-xl transition-all disabled:opacity-30"
        style={{ background: "var(--green)", color: "white" }}
        title="Enviar (Enter)"
      >
        <Send className="w-4 h-4" />
      </button>
    </ComposerPrimitive.Send>
  );
}

export function ComposerCancelButton() {
  return (
    <ComposerPrimitive.Cancel asChild>
      <button
        className="p-2 rounded-xl transition-all hover:bg-white/5"
        style={{ color: "var(--text-3)" }}
        title="Cancelar"
      >
        <Square className="w-4 h-4" />
      </button>
    </ComposerPrimitive.Cancel>
  );
}

// ─── Thread viewport wrapper ──────────────────────────────────────────────────
export function AuiThreadViewport({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ThreadPrimitive.Viewport
      className={cn("flex-1 min-h-0 overflow-y-auto relative", className)}
    >
      {children}
      <ThreadPrimitive.ViewportFooter className="sticky bottom-0 flex justify-end pointer-events-none">
        <div className="pointer-events-auto">
          <AnimatePresence>
            <ScrollToBottom />
          </AnimatePresence>
        </div>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  );
}

// ─── Thread messages list ─────────────────────────────────────────────────────
export function AuiThreadMessages({ runningPhase }: { runningPhase: string }) {
  return (
    <>
      <ThreadPrimitive.Messages
        components={{
          UserMessage,
          AssistantMessage,
        }}
      />
      <AnimatePresence>
        <RunningMessage phase={runningPhase} />
      </AnimatePresence>
    </>
  );
}
