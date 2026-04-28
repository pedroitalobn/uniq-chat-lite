"use client";

// Contexto global da Dynamic Island do Uniq AI.
// Adaptado do PlayerContext de /Users/p/Documents/Dev/obliqthink — simplificado
// pro caso de uso de chat: idle | expanded | executing | result.
//
// `pageContext` é o que cada rota registra (ex: /inbox/[id] registra o
// instanceId+conversationId atual). O Uniq AI usa pra inferir intents
// contextuais ("manda mensagem pra ela amanhã" → sabe quem é "ela").

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";

export type IslandPageContext = {
  // Escopo da página atual — usado pelo Uniq AI pra inferir intent contextual.
  scope: "inbox" | "crm" | "campaigns" | "journeys" | "agents" | "instances" | "home" | "other";
  label?: string;
  meta?: Record<string, unknown>;
};

type IslandResult = {
  id: string;
  text: string;
  at: number;
};

// Notification — evento realtime que estoura inline na pill (msg nova,
// venda, campanha finalizada). Inspirado em iOS Live Activities.
// Auto-dismiss em 6s; click numa action segue pro href + fecha.
export type IslandNotification = {
  id: string;
  kind: "message" | "sale" | "campaign" | "journey" | "info";
  title: string;
  subtitle?: string;
  // até 2 ações inline. href absoluta ou relativa; onClick opcional.
  actions?: Array<{ label: string; href?: string; onClick?: () => void }>;
  at: number;
};

type IslandState =
  | { mode: "idle" }
  | { mode: "expanded" }
  | { mode: "executing"; preview?: string }
  | { mode: "result"; result: IslandResult }
  | { mode: "notification"; notification: IslandNotification };

type IslandContextValue = {
  state: IslandState;
  pageContext: IslandPageContext | null;
  registerPage: (ctx: IslandPageContext | null) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  flashExecuting: (preview?: string) => void;
  flashResult: (text: string) => void;
  pushNotification: (n: Omit<IslandNotification, "id" | "at">) => void;
  dismissNotification: () => void;
};

const IslandContext = createContext<IslandContextValue | null>(null);

export function UniqAIIslandProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<IslandPageContext | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [executing, setExecuting] = useState<{ preview?: string } | null>(null);
  const [result, setResult] = useState<IslandResult | null>(null);
  const [notification, setNotification] = useState<IslandNotification | null>(null);
  const pageContextRef = useRef(pageContext);
  pageContextRef.current = pageContext;

  // Result auto-dismiss após 3.5s (mesmo timing do obliqthink note-saved).
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 3500);
    return () => clearTimeout(t);
  }, [result]);

  // Notification auto-dismiss após 6s (mais tempo pra user clicar action).
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 6000);
    return () => clearTimeout(t);
  }, [notification]);

  // Atalho Cmd/Ctrl+K → toggle ilha. Ignora quando user está em input/textarea.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setManualOpen((m) => !m);
      } else if (e.key === "Escape" && manualOpen) {
        setManualOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualOpen]);

  const open = useCallback(() => setManualOpen(true), []);
  const close = useCallback(() => setManualOpen(false), []);
  const toggle = useCallback(() => setManualOpen((m) => !m), []);
  const registerPage = useCallback((ctx: IslandPageContext | null) => setPageContext(ctx), []);
  const flashExecuting = useCallback((preview?: string) => setExecuting({ preview }), []);
  const flashResult = useCallback((text: string) => {
    setExecuting(null);
    setResult({ id: String(Date.now()), text, at: Date.now() });
  }, []);
  const pushNotification = useCallback((n: Omit<IslandNotification, "id" | "at">) => {
    setNotification({ ...n, id: String(Date.now()), at: Date.now() });
  }, []);
  const dismissNotification = useCallback(() => setNotification(null), []);

  const state = useMemo<IslandState>(() => {
    // Manual open tem prioridade — user quer interagir.
    if (manualOpen) return { mode: "expanded" };
    if (notification) return { mode: "notification", notification };
    if (result) return { mode: "result", result };
    if (executing) return { mode: "executing", preview: executing.preview };
    return { mode: "idle" };
  }, [manualOpen, notification, result, executing]);

  const value = useMemo<IslandContextValue>(
    () => ({ state, pageContext, registerPage, open, close, toggle, flashExecuting, flashResult, pushNotification, dismissNotification }),
    [state, pageContext, registerPage, open, close, toggle, flashExecuting, flashResult, pushNotification, dismissNotification],
  );

  return <IslandContext.Provider value={value}>{children}</IslandContext.Provider>;
}

export function useUniqAIIsland(): IslandContextValue {
  const ctx = useContext(IslandContext);
  if (!ctx) throw new Error("useUniqAIIsland deve ser usado dentro de UniqAIIslandProvider");
  return ctx;
}

// Hook utilitário — cada página registra seu contexto e o Uniq AI usa
// pra inferir intent. Sem cleanup automático: a próxima navegação chama
// registerPage com o novo contexto, evitando race nas trocas de rota.
export function useUniqAIPageContext(ctx: IslandPageContext | null) {
  const { registerPage } = useUniqAIIsland();
  useEffect(() => {
    registerPage(ctx);
  }, [ctx?.scope, ctx?.label, registerPage]);
}
