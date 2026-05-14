"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Pencil, Plus, Trash2,
  PanelLeftOpen, X,
} from "lucide-react";
import { QChatAIChatPanel } from "@/features/uniq-ai/chat-panel";
import type { Message } from "@/features/uniq-ai/atoms";
import { QChatAIBrandMark } from "@/components/uniq-ai/brand-mark";
import {
  type Conversation, deriveTitle, loadConversations,
  migrateLegacyIfNeeded, newConversation, saveConversations, setActiveId,
} from "@/features/uniq-ai/conversations";
import { cn } from "@/lib/utils";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.floor(diff / min))}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

// Glassmorphism panel base style
const glassStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, var(--border-default) 0%, var(--input) 100%)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  border: "1px solid var(--border-default)",
  boxShadow: "0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 var(--border-default)",
};

// Drawer panel — conversations history
function ConversationsDrawer({
  open, onClose, conversations, activeId, renaming, renameDraft,
  onSelect, onNew, onDelete, onStartRename, onRenameDraft, onRenameCommit,
}: {
  open: boolean; onClose: () => void;
  conversations: Conversation[]; activeId: string | null;
  renaming: string | null; renameDraft: string;
  onSelect: (id: string) => void; onNew: () => void;
  onDelete: (id: string) => void; onStartRename: (id: string, title: string) => void;
  onRenameDraft: (v: string) => void; onRenameCommit: (id: string, title: string) => void;
}) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed inset-y-0 left-0 z-50 w-72 flex flex-col overflow-hidden rounded-r-2xl"
            style={glassStyle}
          >
            {/* Top shimmer */}
            <div style={{ position: "absolute", top: 0, left: "10%", right: "10%", height: "1px", background: "linear-gradient(90deg, transparent, var(--border-strong), transparent)" }} />

            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-2">
                <QChatAIBrandMark className="w-4 h-4 flex-shrink-0" stroke="var(--green)" />
                <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Conversas</span>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/8" style={{ color: "var(--text-3)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-3 py-2 flex-shrink-0">
              <button onClick={onNew}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: "rgba(37, 99, 235,0.12)", border: "1px solid rgba(37, 99, 235,0.2)", color: "var(--green)" }}>
                <Plus className="w-3.5 h-3.5" />
                Nova conversa
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-0.5">
              {sorted.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>Nenhuma conversa ainda</p>
              ) : sorted.map((c) => {
                const isActive = c.id === activeId;
                const isRenaming = renaming === c.id;
                return (
                  <div key={c.id}
                    className={cn("group rounded-xl px-2.5 py-2 cursor-pointer transition-all", isActive ? "bg-white/8" : "hover:bg-white/5")}
                    onClick={() => !isRenaming && onSelect(c.id)}>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isActive ? "var(--green)" : "var(--text-3)" }} />
                      {isRenaming ? (
                        <input autoFocus value={renameDraft}
                          onChange={(e) => onRenameDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onRenameCommit(c.id, renameDraft); if (e.key === "Escape") onRenameCommit(c.id, c.title); }}
                          onBlur={() => onRenameCommit(c.id, renameDraft)}
                          className="flex-1 bg-transparent outline-none text-xs font-medium border-b"
                          style={{ color: "var(--text-1)", borderColor: "var(--green)" }} />
                      ) : (
                        <span className="flex-1 text-xs font-medium truncate" style={{ color: isActive ? "var(--text-1)" : "var(--text-2)" }}>
                          {c.title}
                        </span>
                      )}
                      {!isRenaming && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); onStartRename(c.id, c.title); }}
                            className="p-1 rounded-md hover:bg-white/8" style={{ color: "var(--text-3)" }}>
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                            className="p-1 rounded-md hover:bg-red-500/15 hover:text-red-400" style={{ color: "var(--text-3)" }}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] mt-0.5 ml-5" style={{ color: "var(--text-3)" }}>
                      {formatRelative(c.updatedAt)} · {c.messages.length}
                    </p>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default function QChatAIPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showConvs, setShowConvs] = useState(false);

  useEffect(() => {
    const migrated = migrateLegacyIfNeeded();
    const existing = migrated || loadConversations();
    const fresh = existing.length > 0 && existing[0].messages.length === 0
      ? existing[0] : newConversation();
    const list = existing.length > 0 && existing[0].messages.length === 0
      ? existing : [fresh, ...existing];
    setConversations(list);
    setActiveIdState(fresh.id);
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) saveConversations(conversations); }, [conversations, hydrated]);
  useEffect(() => { if (hydrated) setActiveId(activeId); }, [activeId, hydrated]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  const startNew = useCallback(() => {
    if (activeConversation && activeConversation.messages.length === 0) { setShowConvs(false); return; }
    const conv = newConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveIdState(conv.id);
    setShowConvs(false);
  }, [activeConversation]);

  const selectConversation = useCallback((id: string) => {
    setActiveIdState(id); setShowConvs(false);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === activeId) {
        if (next.length > 0) setActiveIdState(next[0].id);
        else { const f = newConversation(); setActiveIdState(f.id); return [f]; }
      }
      return next;
    });
  }, [activeId]);

  const renameConversation = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c));
    setRenaming(null);
  }, []);

  const handleMessagesChange = useCallback(
    (next: Message[] | ((prev: Message[]) => Message[])) => {
      setConversations((prev) => {
        const id = activeId;
        if (!id) return prev;
        return prev.map((c) => {
          if (c.id !== id) return c;
          const msgs = typeof next === "function" ? next(c.messages) : next;
          const title = c.title === "Nova conversa" ? deriveTitle(msgs) : c.title;
          return { ...c, messages: msgs, title, updatedAt: Date.now() };
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

  useEffect(() => {
    if (!hydrated) return;
    if (conversations.length === 0) {
      const f = newConversation();
      setConversations([f]);
      setActiveIdState(f.id);
    }
  }, [hydrated, conversations.length]);

  if (!hydrated) {
    return (
      <div className="flex h-full min-h-0 rounded-2xl overflow-hidden animate-pulse"
        style={{ background: "rgba(255,255,255,0.02)" }} />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle at 50% 38%, rgba(37, 99, 235,0.12) 0%, rgba(37, 99, 235,0.04) 26%, transparent 62%)",
          }}
          animate={{ opacity: [0.55, 0.9, 0.55], scale: [1, 1.05, 1] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
              "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            ].join(","),
            backgroundSize: "34px 34px, 34px 34px",
            maskImage: "radial-gradient(circle at center, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.38) 62%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(circle at center, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.38) 62%, transparent 100%)",
            opacity: 0.35,
          }}
          animate={{ backgroundPosition: ["0px 0px, 0px 0px", "0px 34px, 34px 0px"] }}
          transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
        />

        <motion.div
          className="absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(90deg, transparent 0%, rgba(37, 99, 235,0.08) 50%, transparent 100%)",
            opacity: 0.18,
            transform: "translateX(-30%) skewX(-18deg)",
          }}
          animate={{ x: ["-18%", "112%"] }}
          transition={{ duration: 11, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Floating toolbar */}
      <div className="absolute top-3 left-3 z-20">
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowConvs(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
          style={{
            ...glassStyle,
            color: "var(--text-2)",
            borderColor: "var(--border-default)",
          }}
          title="Conversas"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Conversas</span>
        </motion.button>
      </div>

      {/* Chat area — full height */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeConversation && (
          <QChatAIChatPanel
            key={activeConversation.id}
            messages={activeConversation.messages}
            onMessagesChange={handleMessagesChange}
            onBeforeFirstSend={handleBeforeFirstSend}
            hideHeader
          />
        )}
      </div>

      {/* Drawers */}
      <ConversationsDrawer
        open={showConvs} onClose={() => setShowConvs(false)}
        conversations={conversations} activeId={activeId}
        renaming={renaming} renameDraft={renameDraft}
        onSelect={selectConversation} onNew={startNew}
        onDelete={deleteConversation}
        onStartRename={(id, title) => { setRenameDraft(title); setRenaming(id); }}
        onRenameDraft={setRenameDraft} onRenameCommit={renameConversation}
      />
    </div>
  );
}
