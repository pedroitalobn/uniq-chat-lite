"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, MessageSquare, Pencil, Plus, Sparkles, Trash2, Wand2, Zap,
  PanelLeftOpen, PanelRightOpen, X,
} from "lucide-react";
// Note: Sparkles kept for ActivityDrawer icons via EVENT_ICON record
import { UniqAIChatPanel } from "@/features/uniq-ai/chat-panel";
import type { Message } from "@/features/uniq-ai/atoms";
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

type AgentEvent = {
  id: string;
  type: "journey_created" | "instance_queried" | "campaign_event" | "contact_event" | "message_sent" | "error";
  label: string;
  time: Date;
  status: "success" | "running" | "error";
};

function deriveAgentEvents(messages: Message[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const lower = msg.content.toLowerCase();
    const time = msg.createdAt ?? new Date();
    if (lower.includes("jornada") && (lower.includes("criada") || lower.includes("criado")))
      events.push({ id: `${msg.id}-journey`, type: "journey_created", label: "Jornada criada", time, status: "success" });
    if (lower.includes("instância") || lower.includes("instancia"))
      events.push({ id: `${msg.id}-instance`, type: "instance_queried", label: "Instância consultada", time, status: "success" });
    if (lower.includes("campanha"))
      events.push({ id: `${msg.id}-campaign`, type: "campaign_event", label: "Evento de campanha", time, status: "success" });
    if (lower.includes("contato"))
      events.push({ id: `${msg.id}-contact`, type: "contact_event", label: "Contato acessado", time, status: "success" });
    if (lower.includes("❌") || lower.includes("não consegui"))
      events.push({ id: `${msg.id}-error`, type: "error", label: "Erro na execução", time, status: "error" });
  }
  return events;
}

const EVENT_DOT: Record<AgentEvent["status"], string> = {
  success: "#4ade80", running: "#facc15", error: "#f87171",
};
const EVENT_ICON: Record<AgentEvent["type"], React.ReactNode> = {
  journey_created: <Sparkles className="w-3 h-3" style={{ color: "#4ade80" }} />,
  instance_queried: <Zap className="w-3 h-3" style={{ color: "#60a5fa" }} />,
  campaign_event: <Activity className="w-3 h-3" style={{ color: "#c084fc" }} />,
  contact_event: <MessageSquare className="w-3 h-3" style={{ color: "#facc15" }} />,
  message_sent: <MessageSquare className="w-3 h-3" style={{ color: "#4ade80" }} />,
  error: <span className="text-[10px]">❌</span>,
};

// Glassmorphism panel base style
const glassStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.09)",
  boxShadow: "0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
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
            <div style={{ position: "absolute", top: 0, left: "10%", right: "10%", height: "1px", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)" }} />

            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--green)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Conversas</span>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/8" style={{ color: "var(--text-3)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-3 py-2 flex-shrink-0">
              <button onClick={onNew}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}>
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

// Drawer panel — agent activity
function ActivityDrawer({ open, onClose, events }: { open: boolean; onClose: () => void; events: AgentEvent[] }) {
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
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed inset-y-0 right-0 z-50 w-72 flex flex-col overflow-hidden rounded-l-2xl"
            style={glassStyle}
          >
            <div style={{ position: "absolute", top: 0, left: "10%", right: "10%", height: "1px", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)" }} />

            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 flex-shrink-0" style={{ color: "var(--green)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Atividade</span>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/8" style={{ color: "var(--text-3)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <Activity className="w-7 h-7 opacity-15" style={{ color: "var(--text-3)" }} />
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>Nenhuma ação ainda</p>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>As ações do agente aparecerão aqui</p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                  <div className="space-y-3">
                    {events.map((event) => (
                      <motion.div key={event.id} className="flex gap-3 items-start pl-1"
                        initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
                        <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10"
                          style={{ background: "rgba(10,10,18,0.8)", border: `2px solid ${EVENT_DOT[event.status]}` }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {EVENT_ICON[event.type]}
                            <span className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{event.label}</span>
                          </div>
                          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                            {formatRelative(event.time.getTime())} atrás
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default function UniqAIPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showConvs, setShowConvs] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

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

  const agentEvents = useMemo(
    () => deriveAgentEvents(activeConversation?.messages ?? []),
    [activeConversation?.messages],
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
      {/* Floating toolbar — top-left and top-right toggle buttons */}
      <div className="absolute top-3 left-3 z-20">
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowConvs(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
          style={{
            ...glassStyle,
            color: "var(--text-2)",
            borderColor: "rgba(255,255,255,0.09)",
          }}
          title="Conversas"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Conversas</span>
        </motion.button>
      </div>

      <div className="absolute top-3 right-3 z-20">
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowActivity(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
          style={{
            ...glassStyle,
            color: agentEvents.length > 0 ? "var(--green)" : "var(--text-2)",
            borderColor: agentEvents.length > 0 ? "rgba(0,212,106,0.25)" : "rgba(255,255,255,0.09)",
          }}
          title="Atividade do agente"
        >
          <span className="hidden sm:inline">Atividade</span>
          <PanelRightOpen className="w-3.5 h-3.5" />
          {agentEvents.length > 0 && (
            <span className="ml-0.5 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,212,106,0.18)", color: "var(--green)" }}>
              {agentEvents.length}
            </span>
          )}
        </motion.button>
      </div>

      {/* Chat area — full height */}
      <div className="flex-1 min-h-0 flex flex-col">
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
      <ActivityDrawer
        open={showActivity} onClose={() => setShowActivity(false)}
        events={agentEvents}
      />
    </div>
  );
}
