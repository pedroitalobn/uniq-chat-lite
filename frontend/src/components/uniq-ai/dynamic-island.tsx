"use client";

// Dynamic Island do Uniq AI — pill/bubble flutuante que dá acesso ao chat
// global em qualquer página. Inspirado no iOS 16+ Dynamic Island.
//
// Layouts:
//  - Desktop: pill no TOPO central → MORFA in-place pra um chat expandido
//    (mesmo elemento, layoutId compartilhado, transição spring fluida).
//    É exatamente o efeito do iPhone: a ilha cresce a partir dela mesma
//    em vez de surgir um popover separado.
//  - Mobile: bubble FAB no canto direito inferior → abre bottom-sheet.
//
// Visibilidade: oculta em /uniq-ai (já é o chat full-screen) e em
// /inbox/[id] no mobile (conflita com input do messenger).

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import { UniqAIChatPanel } from "@/features/uniq-ai/chat-panel";
import type { Message } from "@/features/uniq-ai/atoms";
import { useUniqAIIsland } from "./island-context";
import { useConversationWS } from "@/hooks/useConversationWS";

function shouldHide(pathname: string, isMobile: boolean): boolean {
  // /uniq-ai já é o chat full-screen, não faz sentido sobrepor.
  if (pathname === "/uniq-ai") return true;
  // No mobile, /inbox/[id] tem o input do messenger no rodapé. Esconder
  // pra não sobrepor. Em /inbox (lista), continua visível.
  if (isMobile && /^\/inbox\/[^/]+$/.test(pathname)) return true;
  return false;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export function UniqAIIsland() {
  const { state, open, close, dismissNotification, pushNotification } = useUniqAIIsland();

  // Realtime subscriber: nova mensagem inbound + venda + campanha viram
  // notificações inline. Cada página pode também chamar pushNotification
  // direto via context.
  useConversationWS({
    prefixes: ["conversation.message_inbound", "shop.order_paid", "campaign."],
    onEvent: (evt) => {
      const t = evt.type || "";
      if (t === "conversation.message_inbound") {
        const data = (evt.payload || {}) as { from_name?: string; preview?: string; conversation_id?: string };
        pushNotification({
          kind: "message",
          title: data.from_name ? `${data.from_name}` : "Nova mensagem",
          subtitle: data.preview?.slice(0, 60),
          actions: data.conversation_id
            ? [{ label: "Abrir", href: `/inbox?c=${data.conversation_id}` }]
            : undefined,
        });
      } else if (t === "shop.order_paid") {
        const data = (evt.payload || {}) as { customer?: string; total?: number; order_id?: string };
        pushNotification({
          kind: "sale",
          title: `Venda confirmada${data.total ? ` · R$ ${data.total.toFixed(2)}` : ""}`,
          subtitle: data.customer,
          actions: [{ label: "Ver", href: data.order_id ? `/shops?order=${data.order_id}` : "/shops" }],
        });
      } else if (t.startsWith("campaign.")) {
        const data = (evt.payload || {}) as { name?: string; campaign_id?: string };
        const verb = t === "campaign.completed" ? "finalizada" : t === "campaign.paused" ? "pausada" : "atualizada";
        pushNotification({
          kind: "campaign",
          title: `Campanha ${verb}`,
          subtitle: data.name,
          actions: data.campaign_id
            ? [{ label: "Ver", href: `/campaigns/${data.campaign_id}` }]
            : undefined,
        });
      }
    },
  });
  const pathname = usePathname() || "";
  const isMobile = useIsMobile();
  // Scratch chat efêmero — a ilha não persiste conversa nem se mistura
  // com o histórico do /uniq-ai. Reset a cada navegação ou close.
  const [messages, setMessages] = useState<Message[]>([]);
  useEffect(() => {
    if (state.mode !== "expanded") return;
  }, [state.mode]);

  if (shouldHide(pathname, isMobile)) return null;

  // Mobile: bubble FAB + bottom-sheet.
  if (isMobile) {
    return (
      <>
        {state.mode !== "expanded" && (
          <motion.button
            onClick={open}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="fixed bottom-4 right-4 z-[100] w-14 h-14 rounded-full flex items-center justify-center shadow-2xl"
            style={{
              background: "var(--green)",
              boxShadow: "0 8px 32px rgba(0,212,106,0.35), inset 0 0 0 1px var(--border-strong)",
            }}
            aria-label="Abrir Uniq AI"
          >
            {state.mode === "executing"
              ? <Loader2 className="w-6 h-6 text-white animate-spin" />
              : state.mode === "result"
                ? <CheckCircle2 className="w-6 h-6 text-white" />
                : <Sparkles className="w-6 h-6 text-white" />}
          </motion.button>
        )}

        <AnimatePresence>
          {state.mode === "expanded" && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={close}
                className="fixed inset-0 z-[99] bg-black/60 backdrop-blur-sm"
              />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="fixed inset-x-0 bottom-0 z-[100] h-[88vh] rounded-t-3xl overflow-hidden flex flex-col"
                style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
              >
                {/* Drag handle */}
                <button onClick={close} className="flex flex-col items-center pt-2 pb-1 flex-shrink-0">
                  <div className="w-10 h-1 rounded-full" style={{ background: "var(--surface-border)" }} />
                </button>
                <div className="flex-1 min-h-0">
                  <UniqAIChatPanel compact messages={messages} onMessagesChange={setMessages} />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Result toast no rodapé */}
        <AnimatePresence>
          {state.mode === "result" && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.92 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="fixed bottom-20 right-4 z-[99] max-w-[85vw] rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-2"
              style={{ background: "rgba(0,212,106,0.95)", color: "white" }}
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs font-medium truncate">{state.result.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // Desktop: TOPO central. Pill compacta que cresce LEVEMENTE pra receber
  // comando — inspirado em https://skiper-ui.com/v1/skiper2 + cult-ui +
  // iOS Live Activities. SEM modal, SEM backdrop. Resultado e
  // notificações realtime aparecem inline na pill.
  const isExpanded = state.mode === "expanded";
  const isNotif = state.mode === "notification";
  const islandSpring = { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.7 };
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded) {
      // Foca o input após a animação de morph terminar.
      setTimeout(() => inputRef.current?.focus(), 220);
    } else {
      setPrompt("");
    }
  }, [isExpanded]);

  const submitPrompt = () => {
    if (!prompt.trim()) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: prompt }]);
    setPrompt("");
  };

  // Blueprint por estado — padrão cult-ui. Cada estado tem width/height
  // explícitos; framer-motion `animate` interpola simétrico do centro.
  const blueprint = {
    idle:         { width: 220, height: 36 },
    expanded:     { width: 560, height: 48 },
    notification: { width: 520, height: 48 },
    executing:    { width: 280, height: 36 },
    result:       { width: 320, height: 36 },
  } as const;
  const target = blueprint[state.mode] ?? blueprint.idle;

  return (
    <motion.div
      onClick={isExpanded || isNotif ? undefined : open}
      role={isExpanded || isNotif ? undefined : "button"}
      aria-label={isExpanded || isNotif ? undefined : "Abrir Uniq AI"}
      animate={{ width: target.width, height: target.height }}
      transition={islandSpring}
      className={`fixed top-3 z-[90] overflow-hidden rounded-full flex items-center gap-2 px-3 ${
        isExpanded || isNotif ? "cursor-default" : "cursor-pointer"
      }`}
      style={{
        // Centro fixo: top-3 + left calculado via CSS var (sidebar offset).
        // animate={{ width, height }} interpola SIMÉTRICO via spring.
        // transform: translateX(-50%) mantém pivot no centro.
        // maxWidth garante que mobile não estoura viewport.
        left: "calc(50% + var(--sidebar-w-offset, 0px))",
        transform: "translateX(-50%)",
        maxWidth: "calc(100vw - 2rem)",
        background: "rgba(10, 12, 14, 0.94)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px var(--border-default)",
      }}
    >
      {/* Avatar — sempre presente (compacto na pill, idem no expandido) */}
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: isNotif
            ? notifKindColor(state.mode === "notification" ? state.notification.kind : "info")
            : "var(--green)",
        }}
      >
        {state.mode === "executing" ? (
          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
        ) : state.mode === "result" ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
        ) : state.mode === "notification" ? (
          notifKindIcon(state.notification.kind)
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-white" />
        )}
      </div>

      {/* Pill colapsada: label clicável */}
      {!isExpanded && !isNotif && (
        <motion.div layout="position" className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs font-medium text-white/90 whitespace-nowrap truncate">
            {state.mode === "executing"
              ? (state.preview || "Processando…")
              : state.mode === "result"
                ? state.result.text.slice(0, 60)
                : "Pergunte ao Uniq AI"}
          </span>
          <span className="text-[10px] text-white/40 font-mono ml-auto hidden sm:inline">⌘K</span>
        </motion.div>
      )}

      {/* Pill em modo notification: title + subtitle + até 2 actions inline */}
      {isNotif && state.mode === "notification" && (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <div className="flex-1 min-w-0 flex flex-col leading-tight">
            <span className="text-xs font-medium text-white truncate">
              {state.notification.title}
            </span>
            {state.notification.subtitle && (
              <span className="text-[10px] text-white/55 truncate">
                {state.notification.subtitle}
              </span>
            )}
          </div>
          {(state.notification.actions || []).slice(0, 2).map((a, i) => (
            a.href ? (
              <a key={i} href={a.href} onClick={dismissNotification}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
                style={{ background: "rgba(255,255,255,0.12)", color: "white" }}>
                {a.label}
              </a>
            ) : (
              <button key={i} onClick={() => { a.onClick?.(); dismissNotification(); }}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
                style={{ background: "rgba(255,255,255,0.12)", color: "white" }}>
                {a.label}
              </button>
            )
          ))}
          <button onClick={dismissNotification}
            className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            style={{ color: "rgba(255,255,255,0.5)" }} aria-label="Fechar">
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      {/* Pill expandida: input inline + send + close. SEM modal, SEM backdrop. */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, delay: 0.08 }}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPrompt();
              if (e.key === "Escape") close();
            }}
            placeholder="Pergunte, crie jornada, agende disparo…"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
          />
          <button
            onClick={submitPrompt}
            disabled={!prompt.trim()}
            className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
            style={{ background: "var(--green)" }}
            aria-label="Enviar"
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </button>
          <button
            onClick={close}
            className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            style={{ color: "rgba(255,255,255,0.5)" }}
            aria-label="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}

// Mantenho o ícone exportado pro caso de qualquer outra superfície querer
// disparar o "abrir DI" via botão próprio (header de uma página, etc).
export { MessageSquare as UniqAIIconAlt };

// ─── Notification kind → icon + cor ──────────────────────────────────
function notifKindColor(kind: string): string {
  switch (kind) {
    case "message":  return "#60a5fa";
    case "sale":     return "var(--green)";
    case "campaign": return "#f59e0b";
    case "journey":  return "#a78bfa";
    default:         return "#6b7280";
  }
}

function notifKindIcon(kind: string) {
  // Mantém icons inline (não depende de lazy). Importação no topo.
  switch (kind) {
    case "message":  return <MessageSquare className="w-3.5 h-3.5 text-white" />;
    case "sale":     return <CheckCircle2 className="w-3.5 h-3.5 text-white" />;
    case "campaign": return <Sparkles className="w-3.5 h-3.5 text-white" />;
    case "journey":  return <Sparkles className="w-3.5 h-3.5 text-white" />;
    default:         return <MessageSquare className="w-3.5 h-3.5 text-white" />;
  }
}

