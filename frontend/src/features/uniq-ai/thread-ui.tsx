"use client";

// Thread UI — componentes construídos sobre os primitivos do assistant-ui.
// Cada sub-componente usa as primitivas corretas:
//   ThreadPrimitive, MessagePrimitive, ComposerPrimitive,
//   ActionBarPrimitive, BranchPickerPrimitive, ChainOfThoughtPrimitive

import { forwardRef, useState, type FC, type ReactNode } from "react";
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
  BarChart2,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  HelpCircle,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Plug,
  RefreshCw,
  Send,
  Smartphone,
  Square,
  Sparkles,
  User,
  Users,
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
      style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-2)", borderBottom: "1px solid var(--border-subtle)" }}
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
    <hr className="my-4" style={{ borderColor: "var(--border-subtle)" }} {...props} />
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
            background: "linear-gradient(135deg, rgba(0,212,106,0.16) 0%, rgba(0,212,106,0.07) 100%)",
            border: "1px solid rgba(0,212,106,0.22)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            boxShadow: "0 4px 20px rgba(0,212,106,0.08), inset 0 1px 0 rgba(255,255,255,0.06)",
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

// ─── Module orbit (empty state) ──────────────────────────────────────────────
const ORBIT_MODULES = [
  {
    id: "crm", icon: Users, label: "CRM", color: "#60a5fa",
    prompt: "O que você quer saber sobre seu CRM hoje? Posso listar contatos, analisar leads ou encontrar oportunidades de crescimento.",
  },
  {
    id: "journeys", icon: GitBranch, label: "Jornadas", color: "#a78bfa",
    prompt: "O que você gostaria de fazer com suas jornadas? Posso criar automações, listar as ativas ou otimizar fluxos existentes.",
  },
  {
    id: "campaigns", icon: Megaphone, label: "Campanhas", color: "#f59e0b",
    prompt: "Como posso ajudar com suas campanhas? Posso criar uma nova campanha, analisar resultados ou sugerir melhorias.",
  },
  {
    id: "inbox", icon: MessageCircle, label: "Inbox", color: "#34d399",
    prompt: "Tem algum atendimento específico que precisa de atenção? Posso ajudar a priorizar ou gerenciar suas conversas.",
  },
  {
    id: "instances", icon: Smartphone, label: "WhatsApp", color: "#4ade80",
    prompt: "Como estão suas instâncias do WhatsApp? Posso verificar status de conexão, monitorar ou ajudar a configurar.",
  },
  {
    id: "helpdesk", icon: LifeBuoy, label: "Help Desk", color: "#fb7185",
    prompt: "O que gostaria de saber sobre seu Help Desk? Posso verificar tickets abertos, base de conhecimento ou configurações.",
  },
  {
    id: "dashboard", icon: BarChart2, label: "Relatórios", color: "#818cf8",
    prompt: "Quais métricas você quer analisar hoje? Posso gerar relatórios, identificar tendências ou comparar períodos.",
  },
  {
    id: "integrations", icon: Plug, label: "Integrações", color: "#38bdf8",
    prompt: "Precisa de ajuda com alguma integração? Posso verificar o status, testar conexões ou sugerir novas.",
  },
];

const ORBIT_SIZE   = 440;
const ORBIT_CENTER = ORBIT_SIZE / 2;
const ORBIT_RADIUS = 155;
const MODULE_SIZE  = 64;

function getTooltipPos(angle: number): React.CSSProperties {
  const a = ((angle % 360) + 360) % 360;
  if (a >= 315 || a < 45)
    return { bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)" };
  if (a >= 45 && a < 135)
    return { top: "50%", left: "calc(100% + 10px)", transform: "translateY(-50%)" };
  if (a >= 135 && a < 225)
    return { top: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)" };
  return { top: "50%", right: "calc(100% + 10px)", transform: "translateY(-50%)" };
}

function OrbitModule({
  icon: Icon, label, color, prompt, angle, onSuggestionClick,
}: {
  icon: React.ElementType; label: string; color: string; prompt: string;
  angle: number; onSuggestionClick: (text: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const rad = ((angle - 90) * Math.PI) / 180;
  const x   = ORBIT_CENTER + ORBIT_RADIUS * Math.cos(rad) - MODULE_SIZE / 2;
  const y   = ORBIT_CENTER + ORBIT_RADIUS * Math.sin(rad) - MODULE_SIZE / 2;

  return (
    <motion.button
      onClick={() => onSuggestionClick(prompt)}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      style={{ position: "absolute", left: x, top: y, width: MODULE_SIZE, height: MODULE_SIZE }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3 + (angle / 360) * 0.5, duration: 0.45, type: "spring", bounce: 0.35 }}
      whileHover={{ scale: 1.18, zIndex: 20 }}
      whileTap={{ scale: 0.93 }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          background: hovered
            ? `linear-gradient(135deg, ${color}22, ${color}10)`
            : "rgba(255,255,255,0.04)",
          border: `1px solid ${hovered ? color + "66" : "rgba(255,255,255,0.09)"}`,
          boxShadow: hovered
            ? `0 0 28px ${color}44, 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)`
            : "inset 0 1px 0 rgba(255,255,255,0.04)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <Icon
          style={{
            width: 20, height: 20,
            color: hovered ? color : "rgba(255,255,255,0.5)",
            transition: "color 0.2s",
          }}
          strokeWidth={1.8}
        />
        <span style={{
          fontSize: 9, fontWeight: 600, letterSpacing: "0.05em",
          color: hovered ? color : "rgba(255,255,255,0.4)",
          transition: "color 0.2s",
        }}>
          {label}
        </span>

        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.13 }}
              style={{
                position: "absolute",
                ...getTooltipPos(angle),
                pointerEvents: "none",
                zIndex: 50,
                width: 190,
                padding: "8px 12px",
                borderRadius: 12,
                background: "rgba(8,8,16,0.97)",
                border: `1px solid ${color}33`,
                boxShadow: `0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px ${color}11`,
                backdropFilter: "blur(20px)",
              }}
            >
              <p style={{ fontSize: 10, fontWeight: 700, color, marginBottom: 3, letterSpacing: "0.03em" }}>{label}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>
                {prompt.length > 90 ? prompt.slice(0, 90) + "…" : prompt}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.button>
  );
}

function UniqOrbHero({ size = 120 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size * 2.2, height: size * 2.2 }}>
      {/* Outermost aurora — slow, large */}
      <motion.div className="absolute rounded-full"
        style={{
          width: size * 2.2, height: size * 2.2,
          background: "radial-gradient(circle, rgba(0,212,106,0.10) 0%, rgba(0,180,90,0.04) 50%, transparent 75%)",
        }}
        animate={{ scale: [1, 1.18, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} />

      {/* Mid aurora — counter-pulse */}
      <motion.div className="absolute rounded-full"
        style={{
          width: size * 1.7, height: size * 1.7,
          background: "radial-gradient(circle, rgba(0,212,106,0.16) 0%, transparent 65%)",
          border: "1px solid rgba(0,212,106,0.12)",
          boxShadow: "0 0 60px rgba(0,212,106,0.14)",
        }}
        animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.8 }} />

      {/* Inner ring — crisp border with glow */}
      <motion.div className="absolute rounded-full"
        style={{
          width: size * 1.22, height: size * 1.22,
          border: "1.5px solid rgba(0,212,106,0.35)",
          boxShadow: "0 0 32px rgba(0,212,106,0.22), inset 0 0 24px rgba(0,212,106,0.06)",
        }}
        animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }} />

      {/* Orbit particle */}
      <motion.div
        className="absolute"
        style={{ width: size * 1.22, height: size * 1.22 }}
        animate={{ rotate: 360 }}
        transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-2 h-2 rounded-full"
            style={{ background: "#00d46a", boxShadow: "0 0 8px rgba(0,212,106,0.9), 0 0 20px rgba(0,212,106,0.5)" }} />
        </div>
      </motion.div>

      {/* Counter-orbit particle */}
      <motion.div
        className="absolute"
        style={{ width: size * 1.0, height: size * 1.0 }}
        animate={{ rotate: -360 }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#00d46a", opacity: 0.6, boxShadow: "0 0 6px rgba(0,212,106,0.8)" }} />
        </div>
      </motion.div>

      {/* Core orb */}
      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{
          width: size, height: size,
          background: "radial-gradient(circle at 32% 32%, rgba(0,255,140,0.55) 0%, rgba(0,212,106,0.35) 35%, rgba(0,60,30,0.95) 100%)",
          boxShadow: "0 0 48px rgba(0,212,106,0.45), 0 0 120px rgba(0,212,106,0.18), inset 0 0 32px rgba(0,212,106,0.15)",
          border: "1.5px solid rgba(0,212,106,0.45)",
        }}
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Rotating highlight */}
        <motion.div className="absolute inset-0 rounded-full"
          style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.22) 0%, transparent 45%, rgba(0,212,106,0.12) 100%)" }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }} />

        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{ scale: [0.85, 1.12, 0.85], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="w-8 h-8" style={{ color: "rgba(255,255,255,0.95)", filter: "drop-shadow(0 0 8px rgba(0,212,106,0.8))" }} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

export function EmptyStateView({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 py-6 text-center">

        {/* ── Desktop orbit ── */}
        <div className="hidden sm:block relative flex-shrink-0" style={{ width: ORBIT_SIZE, height: ORBIT_SIZE }}>

          {/* Dashed orbit ring */}
          <svg className="absolute inset-0 pointer-events-none" width={ORBIT_SIZE} height={ORBIT_SIZE}>
            <motion.circle
              cx={ORBIT_CENTER} cy={ORBIT_CENTER} r={ORBIT_RADIUS}
              fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="5 9"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.2, delay: 0.2, ease: "easeOut" }}
            />
          </svg>

          {/* Rotating glow dot on the ring */}
          <motion.div
            className="absolute"
            style={{ width: ORBIT_SIZE, height: ORBIT_SIZE, top: 0, left: 0 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          >
            <div style={{
              position: "absolute",
              top: ORBIT_CENTER - ORBIT_RADIUS - 4,
              left: ORBIT_CENTER - 4,
              width: 8, height: 8,
              borderRadius: "50%",
              background: "#00d46a",
              boxShadow: "0 0 10px rgba(0,212,106,0.9), 0 0 24px rgba(0,212,106,0.5)",
            }} />
          </motion.div>

          {/* Counter-rotating slower dot */}
          <motion.div
            className="absolute"
            style={{ width: ORBIT_SIZE, height: ORBIT_SIZE, top: 0, left: 0 }}
            animate={{ rotate: -360 }}
            transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
          >
            <div style={{
              position: "absolute",
              top: ORBIT_CENTER - ORBIT_RADIUS - 3,
              left: ORBIT_CENTER - 3,
              width: 6, height: 6,
              borderRadius: "50%",
              background: "rgba(0,212,106,0.6)",
              boxShadow: "0 0 8px rgba(0,212,106,0.7)",
            }} />
          </motion.div>

          {/* Module nodes */}
          {ORBIT_MODULES.map((mod, i) => (
            <OrbitModule
              key={mod.id}
              {...mod}
              angle={(i * 360) / ORBIT_MODULES.length}
              onSuggestionClick={onSuggestionClick}
            />
          ))}

          {/* Central orb */}
          <div style={{
            position: "absolute",
            left: ORBIT_CENTER - 80 * 1.1,
            top: ORBIT_CENTER - 80 * 1.1,
          }}>
            <UniqOrbHero size={80} />
          </div>
        </div>

        {/* ── Mobile grid (sm:hidden) ── */}
        <div className="flex sm:hidden flex-col items-center gap-4 w-full max-w-xs">
          <UniqOrbHero size={70} />
          <div className="grid grid-cols-4 gap-2 w-full">
            {ORBIT_MODULES.map((mod) => (
              <motion.button
                key={mod.id}
                onClick={() => onSuggestionClick(mod.prompt)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 4, padding: "10px 4px", borderRadius: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.09)",
                }}
                whileHover={{ scale: 1.06, borderColor: mod.color + "55", background: mod.color + "11" }}
                whileTap={{ scale: 0.93 }}
              >
                <mod.icon style={{ width: 18, height: 18, color: mod.color }} strokeWidth={1.8} />
                <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>
                  {mod.label}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Headline */}
        <motion.div
          className="space-y-1.5"
          style={{ marginTop: "-12px" }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <h2 className="text-xl font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
            Olá, sou a{" "}
            <span style={{ color: "var(--green)", textShadow: "0 0 20px rgba(0,212,106,0.5)" }}>
              Uniq AI
            </span>
          </h2>
          <p className="text-sm max-w-xs mx-auto" style={{ color: "var(--text-3)" }}>
            Clique em um módulo ou escreva o que você precisa
          </p>
        </motion.div>
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
