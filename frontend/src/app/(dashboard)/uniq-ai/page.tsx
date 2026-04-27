"use client";

// Home do Uniq AI — chat ao centro estilo Claude/GPT, sidebar lateral
// com histórico de conversas. Empty state mostra o input centralizado;
// após mensagens, vira layout normal de chat.

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, MessageSquare, MoreHorizontal,
  Pencil, Plus, Sparkles, Trash2,
} from "lucide-react";
import { UniqAIChatPanel } from "@/features/uniq-ai/chat-panel";
import type { Message } from "@/features/uniq-ai/atoms";
import {
  type Conversation, deriveTitle, getActiveId, loadConversations,
  migrateLegacyIfNeeded, newConversation, saveConversations, setActiveId,
} from "@/features/uniq-ai/conversations";
import { cn } from "@/lib/utils";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.floor(diff / min))}m atrás`;
  if (diff < day) return `${Math.floor(diff / hr)}h atrás`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d atrás`;
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function UniqAIPage() {
  // Hidratamos com [] e populamos no client effect — evita mismatch SSR.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const migrated = migrateLegacyIfNeeded();
    const list = migrated || loadConversations();
    setConversations(list);
    const stored = getActiveId();
    if (stored && list.some((c) => c.id === stored)) {
      setActiveIdState(stored);
    } else if (list.length > 0) {
      setActiveIdState(list[0].id);
    }
    setHydrated(true);
  }, []);

  // Persiste em localStorage a cada mudança (depois da hidratação inicial).
  useEffect(() => {
    if (!hydrated) return;
    saveConversations(conversations);
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setActiveId(activeId);
  }, [activeId, hydrated]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  // Lista ordenada (mais recente primeiro)
  const sortedConvs = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const startNew = useCallback(() => {
    // Se já há uma conversa vazia ativa, só foca nela em vez de criar duplicata.
    if (activeConversation && activeConversation.messages.length === 0) {
      setMobileSidebarOpen(false);
      return;
    }
    const conv = newConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveIdState(conv.id);
    setMobileSidebarOpen(false);
  }, [activeConversation]);

  const selectConversation = useCallback((id: string) => {
    setActiveIdState(id);
    setMobileSidebarOpen(false);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      // Se deletei a ativa, troca pra próxima ou cria uma nova vazia.
      if (id === activeId) {
        if (next.length > 0) setActiveIdState(next[0].id);
        else {
          const fresh = newConversation();
          setActiveIdState(fresh.id);
          return [fresh];
        }
      }
      return next;
    });
  }, [activeId]);

  const renameConversation = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c)),
    );
    setRenaming(null);
  }, []);

  // Handler do chat: atualiza messages da conversa ativa. Se ainda não há
  // ativa, cria uma vazia (e o ChatPanel chama onBeforeFirstSend antes).
  const handleMessagesChange = useCallback(
    (next: Message[] | ((prev: Message[]) => Message[])) => {
      setConversations((prev) => {
        const id = activeId;
        if (!id) return prev;
        return prev.map((c) => {
          if (c.id !== id) return c;
          const newMessages = typeof next === "function" ? next(c.messages) : next;
          // Atualiza title se ainda é "Nova conversa" e já tem mensagem do user.
          const title = c.title === "Nova conversa" ? deriveTitle(newMessages) : c.title;
          return { ...c, messages: newMessages, title, updatedAt: Date.now() };
        });
      });
    },
    [activeId],
  );

  const handleBeforeFirstSend = useCallback(() => {
    if (!activeConversation) {
      const conv = newConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveIdState(conv.id);
    }
  }, [activeConversation]);

  // Garantia: sempre tem ao menos uma conversa após hidratar.
  useEffect(() => {
    if (!hydrated) return;
    if (conversations.length === 0) {
      const fresh = newConversation();
      setConversations([fresh]);
      setActiveIdState(fresh.id);
    }
  }, [hydrated, conversations.length]);

  const sidebar = (
    <aside
      className={cn(
        "flex flex-col h-full border-r overflow-hidden transition-all duration-200",
        sidebarCollapsed ? "w-12" : "w-64",
      )}
      style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}
    >
      {/* Top */}
      <div className="flex items-center justify-between px-3 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--surface-border)" }}>
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--green)" }} />
            <span className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>Uniq AI</span>
          </div>
        )}
        <button
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="p-1 rounded-md hover:bg-[var(--surface-3)] transition-colors hidden lg:block"
          style={{ color: "var(--text-3)" }}
          title={sidebarCollapsed ? "Expandir" : "Recolher"}
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* New conversation */}
      <div className="px-2 py-2 flex-shrink-0">
        <button
          onClick={startNew}
          className={cn(
            "flex items-center gap-2 w-full rounded-lg text-xs font-medium transition-all",
            sidebarCollapsed ? "p-2 justify-center" : "px-3 py-2",
          )}
          style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.18)", color: "var(--green)" }}
          title="Nova conversa"
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          {!sidebarCollapsed && <span>Nova conversa</span>}
        </button>
      </div>

      {/* List */}
      {!sidebarCollapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
          {sortedConvs.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>
              Nenhuma conversa ainda
            </p>
          ) : (
            sortedConvs.map((c) => {
              const isActive = c.id === activeId;
              const isRenaming = renaming === c.id;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group rounded-lg px-2 py-2 cursor-pointer transition-all",
                    isActive ? "bg-[var(--surface-3)]" : "hover:bg-[var(--surface-3)]",
                  )}
                  onClick={() => !isRenaming && selectConversation(c.id)}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare
                      className="w-3.5 h-3.5 flex-shrink-0"
                      style={{ color: isActive ? "var(--green)" : "var(--text-3)" }}
                    />
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") renameConversation(c.id, renameDraft);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        onBlur={() => renameConversation(c.id, renameDraft)}
                        className="flex-1 bg-transparent outline-none text-xs font-medium border-b"
                        style={{ color: "var(--text-1)", borderColor: "var(--green)" }}
                      />
                    ) : (
                      <span
                        className="flex-1 text-xs font-medium truncate"
                        style={{ color: isActive ? "var(--text-1)" : "var(--text-2)" }}
                      >
                        {c.title}
                      </span>
                    )}
                    {!isRenaming && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameDraft(c.title);
                            setRenaming(c.id);
                          }}
                          className="p-1 rounded hover:bg-[var(--surface-2)]"
                          style={{ color: "var(--text-3)" }}
                          title="Renomear"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(c.id);
                          }}
                          className="p-1 rounded hover:bg-[var(--surface-2)] hover:text-red-400"
                          style={{ color: "var(--text-3)" }}
                          title="Excluir"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] mt-0.5 ml-5" style={{ color: "var(--text-3)" }}>
                    {formatRelative(c.updatedAt)} · {c.messages.length} msgs
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}
    </aside>
  );

  if (!hydrated) {
    // Skeleton até o localStorage hidratar — evita flash do empty state.
    return (
      <div className="flex h-full min-h-0 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--surface-border)" }}>
        <div className="w-64 border-r animate-pulse" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }} />
        <div className="flex-1 animate-pulse" style={{ background: "var(--surface-2)" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Mobile top bar com botão pra abrir sidebar */}
      <div className="lg:hidden flex items-center justify-between px-3 py-2 border-b flex-shrink-0" style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors"
          style={{ color: "var(--text-2)" }}
          title="Conversas"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium truncate flex-1 text-center" style={{ color: "var(--text-1)" }}>
          {activeConversation?.title || "Uniq AI"}
        </span>
        <button
          onClick={startNew}
          className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors"
          style={{ color: "var(--green)" }}
          title="Nova conversa"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex rounded-2xl overflow-hidden border" style={{ borderColor: "var(--surface-border)" }}>
        {/* Sidebar desktop */}
        <div className="hidden lg:flex h-full">{sidebar}</div>

        {/* Sidebar mobile (drawer) */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="lg:hidden fixed inset-y-0 left-0 z-50"
              >
                {sidebar}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Chat area */}
        <div className="flex-1 min-w-0 min-h-0">
          {activeConversation && (
            <UniqAIChatPanel
              key={activeConversation.id}
              messages={activeConversation.messages}
              onMessagesChange={handleMessagesChange}
              onBeforeFirstSend={handleBeforeFirstSend}
              hideHeader
            />
          )}
        </div>
      </div>
    </div>
  );
}
