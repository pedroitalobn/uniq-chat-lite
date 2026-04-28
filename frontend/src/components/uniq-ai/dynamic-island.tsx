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
  const { state, open, close } = useUniqAIIsland();
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
  // comando — inspirado em https://skiper-ui.com/v1/skiper2 e iOS Dynamic
  // Island. SEM modal, SEM backdrop. Resultado aparece inline na pill.
  const isExpanded = state.mode === "expanded";
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

  return (
    <motion.div
      layout
      transition={islandSpring}
      onClick={isExpanded ? undefined : open}
      role={isExpanded ? undefined : "button"}
      aria-label={isExpanded ? undefined : "Abrir Uniq AI"}
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-[90] overflow-hidden ${
        isExpanded
          ? "w-[min(560px,calc(100vw-2rem))] h-12 rounded-full flex items-center gap-2 px-3 cursor-default"
          : "h-9 rounded-full flex items-center gap-2 px-3 cursor-pointer"
      }`}
      style={{
        background: "rgba(10, 12, 14, 0.94)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px var(--border-default)",
      }}
    >
      {/* Avatar — sempre presente (compacto na pill, idem no expandido) */}
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: "var(--green)" }}
      >
        {state.mode === "executing"
          ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
          : state.mode === "result"
            ? <CheckCircle2 className="w-3.5 h-3.5 text-white" />
            : <Sparkles className="w-3.5 h-3.5 text-white" />}
      </div>

      {/* Pill colapsada: label clicável */}
      {!isExpanded && (
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

