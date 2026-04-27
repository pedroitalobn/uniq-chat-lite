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

  // Desktop: TOPO central. Mesmo motion.div pro pill e pro chat expandido
  // — Framer Motion tween automaticamente width/height/borderRadius/posição
  // entre os dois layouts via layoutId. É o "morph" do iPhone Dynamic
  // Island: a pill cresce in-place pra virar o chat e volta colapsando.
  const isExpanded = state.mode === "expanded";
  const islandSpring = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.8 };

  return (
    <>
      {/* Backdrop (só no expanded). Click fora fecha. */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
            className="fixed inset-0 z-[89] bg-black/40 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* A "ilha". Width/height/border-radius animam via layout, dando o
          efeito de pill esticando até virar o chat. */}
      <motion.div
        layout
        transition={islandSpring}
        onClick={isExpanded ? undefined : open}
        role={isExpanded ? undefined : "button"}
        aria-label={isExpanded ? undefined : "Abrir Uniq AI"}
        className={`fixed top-3 left-1/2 -translate-x-1/2 z-[90] overflow-hidden shadow-2xl ${
          isExpanded
            ? "w-[min(480px,calc(100vw-2rem))] h-[min(540px,calc(100vh-2.5rem))] rounded-3xl flex flex-col cursor-default"
            : "h-9 rounded-full flex items-center gap-2 px-3 cursor-pointer"
        }`}
        style={{
          background: isExpanded ? "var(--surface-1)" : "rgba(10, 12, 14, 0.92)",
          backdropFilter: isExpanded ? undefined : "blur(12px)",
          border: isExpanded ? "1px solid var(--surface-border)" : "1px solid var(--border-default)",
          boxShadow: isExpanded
            ? "0 24px 80px rgba(0,0,0,0.55)"
            : "0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px var(--border-default)",
        }}
      >
        {!isExpanded && (
          // Conteúdo da pill (compacto). AnimatePresence interno faz fade
          // entre os estados (idle/executing/result) sem reabrir a ilha.
          <motion.div
            layout="position"
            className="flex items-center gap-2 w-full"
          >
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
            <span className="text-xs font-medium text-white/90 whitespace-nowrap">
              {state.mode === "executing"
                ? (state.preview || "Processando…")
                : state.mode === "result"
                  ? state.result.text.slice(0, 60)
                  : "Pergunte ao Uniq AI"}
            </span>
            <span className="text-[10px] text-white/40 font-mono ml-1 hidden sm:inline">⌘K</span>
          </motion.div>
        )}

        {isExpanded && (
          // Conteúdo expandido — fade-in suave. layout="position" preserva
          // o posicionamento durante o morph.
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.1 }}
            className="flex-1 min-h-0 flex flex-col relative"
          >
            <button
              onClick={close}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
            <IslandQuickActions />
            <div className="flex-1 min-h-0">
              <UniqAIChatPanel compact messages={messages} onMessagesChange={setMessages} />
            </div>
          </motion.div>
        )}
      </motion.div>
    </>
  );
}

// Mantenho o ícone exportado pro caso de qualquer outra superfície querer
// disparar o "abrir DI" via botão próprio (header de uma página, etc).
export { MessageSquare as UniqAIIconAlt };

// IslandQuickActions — strip de notificações/ações rápidas no topo da
// ilha expandida. Discreto, navegável por teclado, agiliza tarefas
// comuns sem precisar abrir o chat completo.
//
// Próxima iteração: pollar /v1/conversations/inbox-stats + WS subscriber
// pra puxar eventos reais (mensagem nova, venda concluída, campanha
// finalizada). Aqui é a estrutura.
import Link from "next/link";
import { Inbox, ShoppingBag, Megaphone, Bot } from "lucide-react";

function IslandQuickActions() {
  const items = [
    { href: "/inbox", icon: Inbox, label: "Inbox", color: "var(--green)" },
    { href: "/shops", icon: ShoppingBag, label: "Shop", color: "#fbbf24" },
    { href: "/campaigns", icon: Megaphone, label: "Campanhas", color: "#60a5fa" },
    { href: "/agents", icon: Bot, label: "Agentes", color: "#a78bfa" },
  ];
  return (
    <div className="px-3 pt-3 pb-2 flex items-center gap-1.5 border-b" style={{ borderColor: "var(--surface-border)" }}>
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
          style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
        >
          <it.icon className="w-3.5 h-3.5" style={{ color: it.color }} />
          <span className="hidden sm:inline">{it.label}</span>
        </Link>
      ))}
    </div>
  );
}
