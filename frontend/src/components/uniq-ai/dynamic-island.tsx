"use client";

// Dynamic Island do Uniq AI — pill/bubble flutuante que dá acesso ao chat
// global em qualquer página. Inspirado no iOS 16+ e na implementação de
// /Users/p/Documents/Dev/obliqthink, mas posicionada no rodapé (não topo).
//
// Layouts:
//  - Desktop: pill no rodapé central → expande pra um popover com o chat.
//  - Mobile: bubble FAB no canto direito inferior → abre bottom-sheet.
//
// Visibilidade: oculta em /uniq-ai (já é o chat full-screen) e em
// /inbox/[id] no mobile (conflita com input do messenger).

import { useEffect, useState } from "react";
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
              boxShadow: "0 8px 32px rgba(0,212,106,0.35), inset 0 0 0 1px rgba(255,255,255,0.1)",
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

  // Desktop: pill rodapé central + popover acima quando expandida.
  return (
    <>
      {state.mode !== "expanded" && (
        <motion.button
          onClick={open}
          initial={{ opacity: 0, y: 12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.92 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2 px-4 py-2.5 rounded-full shadow-2xl group"
          style={{
            background: "rgba(10, 12, 14, 0.92)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.04)",
          }}
          aria-label="Abrir Uniq AI"
        >
          <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--green)" }}>
            {state.mode === "executing"
              ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              : state.mode === "result"
                ? <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                : <Sparkles className="w-3.5 h-3.5 text-white" />}
          </div>
          <span className="text-xs font-medium text-white/90">
            {state.mode === "executing"
              ? (state.preview || "Processando…")
              : state.mode === "result"
                ? state.result.text.slice(0, 60)
                : "Pergunte ao Uniq AI"}
          </span>
          <span className="text-[10px] text-white/40 font-mono ml-1 hidden sm:inline">⌘K</span>
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
              className="fixed inset-0 z-[89] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 340, damping: 30 }}
              className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] w-[min(820px,calc(100vw-2rem))] h-[min(680px,calc(100vh-6rem))] rounded-3xl overflow-hidden shadow-2xl flex flex-col"
              style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
            >
              <button
                onClick={close}
                className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex-1 min-h-0">
                <UniqAIChatPanel compact messages={messages} onMessagesChange={setMessages} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// Mantenho o ícone exportado pro caso de qualquer outra superfície querer
// disparar o "abrir DI" via botão próprio (header de uma página, etc).
export { MessageSquare as UniqAIIconAlt };
