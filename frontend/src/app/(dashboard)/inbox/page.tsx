"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Send, Check, CheckCheck, Image, Mic, FileText, MapPin,
  Users, Phone, Video, MessageSquare, User, Archive, Trash2, Star,
  MoreHorizontal, ChevronRight, Filter, EyeOff, Pin, Tag, BellOff,
  Smile, Paperclip, ArrowDown, RefreshCw
} from "lucide-react";
import { instancesApi, inboxApi, crmApi, workspacesApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { Instance, ChannelType } from "@/types";

const CHANNELS: { id: ChannelType; label: string; color: string; description: string }[] = [
  { id: "whatsapp", label: "WhatsApp", color: "#25d366", description: "Mensagens WhatsApp" },
  { id: "instagram", label: "Instagram", color: "#e1306c", description: "Direct Messages" },
  { id: "facebook", label: "Facebook", color: "#1877f2", description: "Messenger" },
  { id: "telegram", label: "Telegram", color: "#229ed9", description: "Mensagens Telegram" },
  { id: "linkedin", label: "LinkedIn", color: "#0a66c2", description: "Mensagens LinkedIn" },
  { id: "tiktok", label: "TikTok", color: "#ff0050", description: "Mensagens TikTok" },
  { id: "kwai", label: "Kwai", color: "#ff6600", description: "Mensagens Kwai" },
];

type FilterType = "all" | "unread" | "starred" | "archived";

interface ChatContact {
  jid: string; name: string; phone: string; avatar?: string;
  last_message: string; last_time: string; unread_count: number;
  is_online: boolean; is_group?: boolean;
}

interface ChatMessage {
  id: string; content: string; from_me: boolean;
  timestamp: number; status: string; type: string;
  is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean;
}

interface ContactInfo {
  jid: string; name: string; phone: string; avatar?: string;
  email?: string; tags: string[]; funnel?: string; stage?: string;
  contact_id?: string; owner?: string; owner_name?: string; notes?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(d: string) {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  if (diffDays === 0) return `${h}:${m}`;
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][date.getDay()];
  return `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

function MsgTime(ts: number) {
  const date = new Date(ts * 1000);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function MsgBody({ msg }: { msg: ChatMessage }) {
  let t = msg.content;
  try { if (t?.startsWith('"') && t?.endsWith('"')) t = JSON.parse(t); } catch {}
  if (msg.type === "reaction") return <span className="text-xl">{t || "👍"}</span>;
  const icons: Record<string, React.ReactNode> = {
    image: <Image className="w-4 h-4" />, audio: <Mic className="w-4 h-4" />,
    document: <FileText className="w-4 h-4" />, location: <MapPin className="w-4 h-4" />,
  };
  if (icons[msg.type]) return <span className="flex items-center gap-1.5 opacity-80">{icons[msg.type]}<span>{t}</span></span>;
  return <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t}</span>;
}

// ─── WebSocket Hook for Real-Time Messages ──────────────────────────────────

function useInboxWebSocket(instanceId: string, activeChat: string | null, qc: ReturnType<typeof useQueryClient>, onStatusChange: (s: "connected" | "disconnected" | "connecting") => void, onSync: () => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onSyncRef = useRef(onSync);
  const instanceIdRef = useRef(instanceId);
  const activeChatRef = useRef(activeChat);
  const prevInstanceIdRef = useRef(instanceId);

  onStatusChangeRef.current = onStatusChange;
  onSyncRef.current = onSync;
  instanceIdRef.current = instanceId;
  activeChatRef.current = activeChat;

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!instanceIdRef.current) return;
    
    disconnect();
    onStatusChangeRef.current("connecting");
    console.log("[InboxWS] Connecting to ws://localhost:8080/api/instances/" + instanceIdRef.current + "/ws");
    try {
      const ws = new WebSocket(`ws://localhost:8080/api/instances/${instanceIdRef.current}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[InboxWS] Connected!");
        onStatusChangeRef.current("connected");
      };
      ws.onclose = (e) => { 
        console.log("[InboxWS] Closed:", e.code, e.reason);
        onStatusChangeRef.current("disconnected"); 
        wsRef.current = null; 
        reconnectTimer.current = setTimeout(connect, 3000); 
      };
      ws.onerror = (e) => { 
        console.log("[InboxWS] Error:", e); 
        ws.close(); 
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "history.sync") {
            onSyncRef.current();
          }
          if (data.type === "message" || data.type === "message_received" || data.type === "message.received") {
            qc.invalidateQueries({ queryKey: ["chats", instanceIdRef.current] });
            if (activeChatRef.current) {
              qc.invalidateQueries({ queryKey: ["msgs", instanceIdRef.current, activeChatRef.current] });
            }
          }
          if (data.type === "message_status" || data.type === "message.status") {
            if (activeChatRef.current) {
              qc.invalidateQueries({ queryKey: ["msgs", instanceIdRef.current, activeChatRef.current] });
            }
          }
        } catch {}
      };
    } catch { onStatusChangeRef.current("disconnected"); }
  }, [qc, disconnect]);

  useEffect(() => {
    if (instanceId && instanceId !== prevInstanceIdRef.current) {
      prevInstanceIdRef.current = instanceId;
      connect();
    } else if (instanceId) {
      connect();
    }
    return () => disconnect();
  }, [instanceId, connect, disconnect]);

  return wsRef;
}

// ─── Contact List Item ──────────────────────────────────────────────────────

function ContactItem({
  contact, isActive, channelColor, onClick, onContextMenu,
}: {
  contact: ChatContact; isActive: boolean; channelColor: string;
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 transition-all duration-150 relative group",
        isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      )}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r-full"
          style={{ background: channelColor }} />
      )}

      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {contact.avatar ? (
          <img src={contact.avatar} className="w-11 h-11 rounded-full object-cover" alt="" />
        ) : (
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{ background: `${channelColor}18`, color: channelColor }}>
            {contact.is_group ? <Users className="w-5 h-5" /> : contact.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        {contact.is_online && !contact.is_group && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
            style={{ background: "#22c55e", borderColor: "var(--surface-2)" }} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline gap-2 mb-0.5">
          <span className={cn("text-sm truncate", contact.unread_count > 0 ? "font-semibold" : "font-medium")}
            style={{ color: "var(--text-1)" }}>
            {contact.name}
          </span>
          <span className="text-[10px] shrink-0 tabular-nums"
            style={{ color: contact.unread_count > 0 ? channelColor : "var(--text-3)" }}>
            {fmtTime(contact.last_time)}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <p className={cn("text-xs truncate", contact.unread_count > 0 ? "font-medium" : "")}
            style={{ color: contact.unread_count > 0 ? "var(--text-2)" : "var(--text-3)" }}>
            {contact.last_message || "—"}
          </p>
          {contact.unread_count > 0 && (
            <span className="shrink-0 min-w-[20px] h-[20px] px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: channelColor, color: "#000" }}>
              {contact.unread_count > 99 ? "99+" : contact.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Message Bubble ─────────────────────────────────────────────────────────

function MessageBubble({
  msg, channelColor, contactAvatar, contactName, onContextMenu,
}: {
  msg: ChatMessage; channelColor: string; contactAvatar?: string; contactName: string;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const sent = msg.from_me;

  return (
    <div className={cn("flex gap-2 group", sent ? "justify-end" : "items-end")}
      onContextMenu={onContextMenu}>
      {/* Received avatar */}
      {!sent && (
        contactAvatar
          ? <img src={contactAvatar} className="w-7 h-7 rounded-full object-cover flex-shrink-0 mb-5" alt="" />
          : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0 mb-5"
              style={{ background: `${channelColor}18`, color: channelColor }}>
              {contactName.slice(0, 2).toUpperCase()}
            </div>
      )}

      {/* Bubble */}
      <div className="max-w-[70%] min-w-[80px]">
        <div
          className={cn(
            "px-3 py-2 text-[13px] leading-[1.5] relative",
            sent ? "rounded-2xl rounded-br-md" : "rounded-2xl rounded-bl-md"
          )}
          style={sent
            ? { background: channelColor, color: "#fff" }
            : { background: "var(--surface-3)", color: "var(--text-1)" }
          }
        >
          <MsgBody msg={msg} />
        </div>

        {/* Meta */}
        <div className={cn("flex items-center gap-1 mt-1 px-1", sent ? "justify-end" : "justify-start")}>
          <span className="text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
            {MsgTime(msg.timestamp)}
          </span>
          {sent && (
            msg.status === "read" ? <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
            : msg.status === "delivered" ? <CheckCheck className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
            : msg.status === "sent" ? <Check className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
            : null
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { currentWorkspace } = useWorkspace();
  const qc = useQueryClient();

  const [channels, setChannels] = useState<ChannelType[]>(["whatsapp"]);
  const [instance, setInstance] = useState("");
  const [chat, setChat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number; y: number; jid: string } | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [contactNotes, setContactNotes] = useState("");
  const [contactOwner, setContactOwner] = useState("");
  const [contactStage, setContactStage] = useState("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  const [msgOffset, setMsgOffset] = useState(0);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(true);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected" | "connecting">("disconnected");
  const [isSyncing, setIsSyncing] = useState<boolean | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);
  const msgsContainerRef = useRef<HTMLDivElement>(null);

  // ── Data queries ──

  const { data: instData = [] } = useQuery<Instance[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then(r => r.data),
  });

  const chInst = instData.filter(i => i.status === "connected");
  const chAvail = CHANNELS.filter(c => instData.some(i => i.channel === c.id && i.status === "connected"));

  useEffect(() => {
    if (chInst.length > 0 && !chInst.find(i => i.id === instance)) { setInstance(chInst[0].id); setChat(null); }
  }, [channels, chInst.length]);

  useEffect(() => {
    if (chAvail.length > 0 && !chAvail.find(c => channels.includes(c.id))) setChannels([chAvail[0].id]);
  }, [chAvail.length]);

  // Chat list — still poll every 5s as fallback, WS handles instant updates
  const { data: chatsD } = useQuery({
    queryKey: ["chats", instance, search, filter],
    enabled: !!instance,
    refetchInterval: 5000,
    queryFn: async () => {
      try { return (await inboxApi.getChats(instance, search, filter)).data; }
      catch { return { chats: [] }; }
    }
  });

  // Messages — poll every 4s as fallback, WS gives instant
  const { data: msgsD } = useQuery({
    queryKey: ["msgs", instance, chat, msgOffset],
    enabled: !!instance && !!chat,
    refetchInterval: 4000,
    queryFn: async () => {
      try { return (await inboxApi.getMessages(instance, chat, { offset: msgOffset })).data; }
      catch { return { messages: [], has_more: false }; }
    }
  });

  const { data: contactD } = useQuery({
    queryKey: ["contact", instance, chat],
    enabled: !!instance && !!chat,
    queryFn: async () => {
      try { return (await inboxApi.getChat(instance, chat)).data; }
      catch { return null; }
    }
  });

  const { data: membersD } = useQuery({
    queryKey: ["workspaceMembers", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      try { return (await workspacesApi.listMembers(currentWorkspace!.id)).data; }
      catch { return { members: [] }; }
    }
  });

  const { data: tagsD } = useQuery({
    queryKey: ["crmTags", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      try { return (await crmApi.listTags(currentWorkspace!.id)).data; }
      catch { return { tags: [] }; }
    }
  });

  // ── WebSocket for real-time ──
  useInboxWebSocket(instance, chat, qc, setWsStatus, () => { setIsSyncing(true); qc.invalidateQueries({ queryKey: ["chats", instance] }); if (chat) qc.invalidateQueries({ queryKey: ["msgs", instance, chat] }); setTimeout(() => setIsSyncing(false), 2000); });

  // ── Mutations ──

  const sendMut = useMutation({
    mutationFn: (content: string) => inboxApi.sendMessage(instance, chat!, { content, type: "text" }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: ["msgs", instance, chat] });
      qc.invalidateQueries({ queryKey: ["chats", instance] });
      inpRef.current?.focus();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao enviar"),
  });

  const readMut = useMutation({
    mutationFn: () => inboxApi.markRead(instance, chat!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats", instance] }),
  });

  const updateMessageMut = useMutation({
    mutationFn: (data: { is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean }) =>
      inboxApi.updateMessage(instance, selectedMsgId || "", data),
    onSuccess: () => {
      toast.success("Mensagem atualizada!");
      qc.invalidateQueries({ queryKey: ["msgs", instance, chat] });
      setSelectedMsgId(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro"),
  });

  const list: ChatContact[] = chatsD?.chats || [];
  const msgs: ChatMessage[] = msgsD?.messages || [];
  const hasMore = msgsD?.has_more ?? false;
  const ct: ContactInfo = contactD?.contact || { jid: chat || "", name: chat?.split("@")[0] || "", phone: chat || "", tags: [], notes: "" };

  // Reset pagination when chat changes
  useEffect(() => { setMsgOffset(0); setHasMoreMsgs(true); }, [chat]);

  const loadMoreMut = useMutation({
    mutationFn: async (currentOffset: number) => {
      const newOffset = currentOffset + 50;
      const res = await inboxApi.getMessages(instance, chat, { offset: newOffset });
      return { ...res.data, newOffset };
    },
    onSuccess: (data) => {
      if (data.messages && data.messages.length > 0) {
        setMsgOffset(data.newOffset);
        setHasMoreMsgs(data.has_more);
      }
    },
  });

  // CRM mutations
  const updateContactMut = useMutation({
    mutationFn: (data: { name?: string; email?: string; notes?: string; funnel?: string; stage?: string; journey?: string; owner?: string }) =>
      crmApi.updateContact(ct.contact_id!, data),
    onSuccess: () => {
      toast.success("Contato atualizado!");
      qc.invalidateQueries({ queryKey: ["contact", instance, chat] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao atualizar"),
  });

  const assignTagsMut = useMutation({
    mutationFn: (tagIds: string[]) => crmApi.assignTags(ct.contact_id!, tagIds),
    onSuccess: () => {
      toast.success("Tags atualizadas!");
      qc.invalidateQueries({ queryKey: ["contact", instance, chat] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao atualizar tags"),
  });

  // ── Effects ──

  useEffect(() => { if (chat) readMut.mutate(); }, [chat]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgsD]);

  useEffect(() => {
    if (contactD?.contact) {
      setContactNotes(contactD.contact.notes || "");
      setContactOwner(contactD.contact.owner || "");
      setContactStage(contactD.contact.stage || "");
    }
  }, [contactD]);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = () => { setChatContextMenu(null); setSelectedMsgId(null); };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Track scroll position for "scroll down" button
  const handleMessagesScroll = useCallback(() => {
    if (!msgsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = msgsContainerRef.current;
    setShowScrollDown(scrollHeight - scrollTop - clientHeight > 200);
  }, []);

  const scrollToBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleAction = (action: string) => {
    setShowChatMenu(false);
    if (!chat) return;
    const phone = chat.split("@")[0];
    const currentContact = list.find(c => c.jid === chat);
    const name = currentContact?.name || phone;

    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/crm/contacts/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({
        phone, instance_id: instance, name,
        ...(action === "star" && { favorite: true }),
        ...(action === "archive" && { archived: true }),
        ...(action === "mute" && { muted: true }),
        ...(action === "delete" && { deleted: true }),
      })
    }).then(() => {
      toast.success(action === "star" ? "Conversa favoritada!" : action === "archive" ? "Conversa arquivada!" : action === "mute" ? "Conversa silenciada!" : "Conversa excluída!");
      qc.invalidateQueries({ queryKey: ["chats", instance] });
    }).catch(() => toast.error("Erro ao realizar ação"));
  };

  const handleMsgAction = (action: string) => {
    switch (action) {
      case "star": updateMessageMut.mutate({ is_favorite: true }); break;
      case "pin": updateMessageMut.mutate({ is_pinned: true }); break;
      case "delete": updateMessageMut.mutate({ is_deleted: true }); break;
      case "archive": updateMessageMut.mutate({ is_archived: true }); break;
    }
    setSelectedMsgId(null);
  };

  const curChannel = CHANNELS.find(c => c.id === channels[0]) || CHANNELS[0];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3" style={{ color: "var(--text-1)" }}>
              <MessageSquare className="w-6 h-6" style={{ color: curChannel.color }} />
              Inbox
            </h1>
            {/* Instance selector dropdown */}
            {chInst.length > 0 && (
              <select
                value={instance}
                onChange={e => { setInstance(e.target.value); setChat(null); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none cursor-pointer"
                style={{ background: `${curChannel.color}15`, color: curChannel.color, border: `1px solid ${curChannel.color}30` }}
              >
                {chInst.map(i => (
                  <option key={i.id} value={i.id} style={{ background: "var(--surface-2)", color: "var(--text-1)" }}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            {/* Refresh button */}
            {instance && (
              <button
                onClick={() => { qc.invalidateQueries({ queryKey: ["chats", instance] }); if (chat) qc.invalidateQueries({ queryKey: ["msgs", instance, chat] }); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-all"
                style={{ color: wsStatus === "connected" ? "#22c55e" : "var(--text-3)" }}
                title="Atualizar conversas"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            {/* Sync indicator */}
            {(isSyncing === true || wsStatus === "connecting") && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium animate-pulse"
                style={{ background: `${curChannel.color}15`, color: curChannel.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: curChannel.color }} />
                {isSyncing ? "Sincronizando..." : "Conectando..."}
              </span>
            )}
            {/* WS status */}
            {wsStatus === "connected" && instance && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium"
                style={{ background: "#22c55e15", color: "#22c55e" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                Online
              </span>
            )}
            {wsStatus === "disconnected" && instance && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium"
                style={{ background: "#ef444415", color: "#ef4444" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                Offline
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
            Gerencie todas as suas conversas em um só lugar.
          </p>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {([
            { id: "all" as FilterType, label: "Todos", icon: MessageSquare },
            { id: "unread" as FilterType, label: "Não lidos", icon: EyeOff },
            { id: "starred" as FilterType, label: "Favoritos", icon: Star },
            { id: "archived" as FilterType, label: "Arquivados", icon: Archive },
          ]).map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: filter === f.id ? `${curChannel.color}18` : "transparent",
                color: filter === f.id ? curChannel.color : "var(--text-3)",
                border: filter === f.id ? `1px solid ${curChannel.color}30` : "1px solid transparent",
              }}>
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-0 flex-1 min-h-0 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--surface-border)" }}>
        {/* ═══ CHANNEL SIDEBAR (icons) ═══ */}
        <aside className="w-[56px] flex-shrink-0 flex flex-col items-center py-3 gap-1"
          style={{ background: "var(--surface-2)", borderRight: "1px solid var(--surface-border)" }}>
          {CHANNELS.map(ch => {
            const isActive = channels.includes(ch.id);
            const isConnected = instData.some((inst: Instance) => inst.channel === ch.id && inst.status === "connected");
            return (
              <button
                key={ch.id}
                onClick={() => {
                  if (!isConnected) return;
                  if (isActive && channels.length > 1) setChannels(channels.filter(c => c !== ch.id));
                  else if (!isActive) setChannels([...channels, ch.id]);
                }}
                className={cn("w-9 h-9 rounded-lg flex items-center justify-center transition-all relative",
                  isConnected ? "cursor-pointer hover:opacity-80" : "cursor-default opacity-30")}
                style={{
                  background: isActive ? `${ch.color}20` : "transparent",
                  border: isActive ? `1px solid ${ch.color}40` : "1px solid transparent",
                }}
                title={isConnected ? ch.label : `${ch.label} (desconectado)`}
              >
                <span className="text-[10px] font-bold" style={{ color: isActive ? ch.color : "var(--text-3)" }}>
                  {ch.label.slice(0, 2)}
                </span>
              </button>
            );
          })}
        </aside>

        {/* ═══ CONTACTS LIST ═══ */}
        <div className="w-[340px] flex-shrink-0 flex flex-col"
          style={{ background: "var(--surface-2)", borderRight: "1px solid var(--surface-border)" }}>

          {/* Search */}
          <div className="p-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-3)" }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar conversa..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }} />
            </div>
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto">
            {!instance ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: `${curChannel.color}10` }}>
                  <MessageSquare className="w-7 h-7" style={{ color: curChannel.color, opacity: 0.4 }} />
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Sem instância conectada</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Conecte uma instância para ver conversas</p>
              </div>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: "var(--surface-3)" }}>
                  <MessageSquare className="w-7 h-7" style={{ color: "var(--text-3)", opacity: 0.4 }} />
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Sem conversas</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>As conversas aparecerão aqui</p>
              </div>
            ) : list.map(c => (
              <ContactItem
                key={c.jid}
                contact={c}
                isActive={chat === c.jid}
                channelColor={curChannel.color}
                onClick={() => setChat(c.jid)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setChat(c.jid);
                  setChatContextMenu({ x: e.clientX, y: e.clientY, jid: c.jid });
                }}
              />
            ))}
          </div>
        </div>

        {/* ═══ CHAT AREA ═══ */}
        <div className="flex-1 flex flex-col min-w-0" style={{ background: "var(--surface-1)" }}>
          {!chat ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
                style={{ background: `${curChannel.color}08`, border: `1px solid ${curChannel.color}15` }}>
                <MessageSquare className="w-10 h-10" style={{ color: curChannel.color, opacity: 0.3 }} />
              </div>
              <p className="text-base font-semibold" style={{ color: "var(--text-2)" }}>Selecione uma conversa</p>
              <p className="text-sm mt-1.5" style={{ color: "var(--text-3)" }}>Escolha um contato ao lado para começar</p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b shrink-0"
                style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
                <div className="flex items-center gap-3">
                  {ct.avatar ? (
                    <img src={ct.avatar} className="w-10 h-10 rounded-full object-cover" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                      style={{ background: `${curChannel.color}18`, color: curChannel.color }}>
                      {ct.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{ct.name}</div>
                    <div className="text-xs" style={{ color: "var(--text-3)" }}>{ct.phone}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowContactPanel(!showContactPanel)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
                    style={{ color: showContactPanel ? curChannel.color : "var(--text-3)" }}>
                    <User className="w-4 h-4" />
                  </button>
                  <div className="relative">
                    <button onClick={() => setShowChatMenu(!showChatMenu)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
                      style={{ color: "var(--text-3)" }}>
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {showChatMenu && (
                      <div className="absolute right-0 top-full mt-1 w-48 rounded-xl shadow-xl z-50 py-1"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
                        onClick={e => e.stopPropagation()}>
                        {[
                          { icon: Star, label: "Favoritar", action: "star" },
                          { icon: Pin, label: "Fixar", action: "pin" },
                          { icon: Archive, label: "Arquivar", action: "archive" },
                          { icon: BellOff, label: "Silenciar", action: "mute" },
                          { icon: Trash2, label: "Excluir", action: "delete", color: "#ef4444" },
                        ].map((item, i) => (
                          <button key={i} onClick={() => handleAction(item.action)}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-white/5 transition-colors"
                            style={{ color: item.color || "var(--text-2)" }}>
                            <item.icon className="w-3.5 h-3.5" />
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 relative"
                ref={msgsContainerRef} onScroll={handleMessagesScroll}>
                {/* Load more button */}
                {hasMoreMsgs && msgs.length > 0 && (
                  <div className="flex justify-center py-2">
                    <button
                      onClick={() => loadMoreMut.mutate(msgOffset)}
                      disabled={loadMoreMut.isPending}
                      className="px-4 py-1.5 rounded-full text-xs font-medium transition-all hover:opacity-80"
                      style={{ background: `${curChannel.color}15`, color: curChannel.color }}>
                      {loadMoreMut.isPending ? "Carregando..." : "Carregar mais"}
                    </button>
                  </div>
                )}
                {msgs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${curChannel.color}08` }}>
                      <MessageSquare className="w-8 h-8" style={{ color: curChannel.color, opacity: 0.3 }} />
                    </div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Sem mensagens</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Envie uma mensagem para iniciar a conversa</p>
                  </div>
                ) : (
                  msgs.map(m => (
                    <MessageBubble
                      key={m.id}
                      msg={m}
                      channelColor={curChannel.color}
                      contactAvatar={ct.avatar}
                      contactName={ct.name}
                      onContextMenu={(e) => {
                        if (!m.from_me) {
                          e.preventDefault();
                          setSelectedMsgId(m.id);
                        }
                      }}
                    />
                  ))
                )}
                <div ref={endRef} />

                {/* Scroll to bottom FAB */}
                {showScrollDown && (
                  <button onClick={scrollToBottom}
                    className="fixed bottom-24 right-[calc(var(--contact-panel-width,340px)+72px)] w-10 h-10 rounded-full flex items-center justify-center shadow-xl z-30 transition-all hover:scale-105"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                    <ArrowDown className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
                <div className="flex items-center gap-3">
                  <button className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors flex-shrink-0"
                    style={{ color: "var(--text-3)" }}>
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <div className="flex-1">
                    <input ref={inpRef} value={input} onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.trim()) sendMut.mutate(input.trim()); } }}
                      placeholder="Escreva sua mensagem..."
                      className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all"
                      style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }} />
                  </div>
                  <button className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors flex-shrink-0"
                    style={{ color: "var(--text-3)" }}>
                    <Smile className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (input.trim()) sendMut.mutate(input.trim()); }}
                    disabled={!input.trim() || sendMut.isPending}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 disabled:opacity-30"
                    style={{ background: input.trim() ? curChannel.color : "var(--surface-3)", color: input.trim() ? "#fff" : "var(--text-3)" }}>
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ═══ CONTACT SIDEBAR ═══ */}
        {chat && showContactPanel && (
          <div className="w-[300px] flex-shrink-0 flex flex-col overflow-y-auto"
            style={{ background: "var(--surface-2)", borderLeft: "1px solid var(--surface-border)" }}>
            {/* Profile header */}
            <div className="p-5 border-b text-center" style={{ borderColor: "var(--surface-border)" }}>
              {ct.avatar ? (
                <img src={ct.avatar} className="w-16 h-16 rounded-full mx-auto object-cover" alt="" />
              ) : (
                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-lg font-bold"
                  style={{ background: `${curChannel.color}18`, color: curChannel.color }}>
                  {ct.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <h3 className="text-sm font-semibold mt-3" style={{ color: "var(--text-1)" }}>{ct.name}</h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{ct.phone}</p>
              <div className="flex justify-center gap-2 mt-3">
                {[Phone, Video, MessageSquare].map((I, i) => (
                  <button key={i} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
                    style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                    <I className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>

            {/* Info sections */}
            <div className="p-3 space-y-3">
              {/* Responsible */}
              {ct.contact_id && membersD?.members && (
                <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Responsável</p>
                  <select value={contactOwner} onChange={(e) => {
                    setContactOwner(e.target.value);
                    if (ct.contact_id) updateContactMut.mutate({ owner: e.target.value });
                  }}
                    disabled={!ct.contact_id || updateContactMut.isPending}
                    className="w-full p-2 rounded-lg text-xs outline-none"
                    style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
                    <option value="">Selecionar...</option>
                    {membersD.members.map((m: any) => (
                      <option key={m.user_id || m.id} value={m.user_id || m.id}>{m.user?.name || m.name || "Membro"}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Pipeline */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Pipeline</p>
                <div className="space-y-1.5">
                  {["Novo Lead", "Contatado", "Qualificado", "Fechado"].map((stage, i) => (
                    <button key={i} onClick={() => {
                      setContactStage(stage);
                      if (ct.contact_id) updateContactMut.mutate({ stage });
                    }}
                      disabled={!ct.contact_id || updateContactMut.isPending}
                      className="w-full p-2 rounded-lg text-xs text-left transition-all"
                      style={{ background: contactStage === stage ? curChannel.color : "var(--surface-3)", color: contactStage === stage ? "#fff" : "var(--text-2)" }}>
                      {stage}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {ct.tags?.length > 0 ? ct.tags.map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: `${curChannel.color}18`, color: curChannel.color }}>
                      {tag}
                    </span>
                  )) : <span className="text-xs" style={{ color: "var(--text-3)" }}>Nenhuma tag</span>}
                </div>
                {ct.contact_id && tagsD?.tags && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tagsD.tags.map((tag: any) => (
                      <button key={tag.id} onClick={() => {
                        const currentTags = ct.tags || [];
                        const currentTagObjs = tagsD.tags.filter((t: any) => currentTags.includes(t.name));
                        const hasTag = currentTags.includes(tag.name);
                        const newTagIds = hasTag
                          ? currentTagObjs.filter((t: any) => t.id !== tag.id).map((t: any) => t.id)
                          : [...currentTagObjs.map((t: any) => t.id), tag.id];
                        assignTagsMut.mutate(newTagIds);
                      }}
                        className="text-[10px] px-2 py-0.5 rounded-full border transition-colors hover:opacity-80"
                        style={{ borderColor: curChannel.color, color: curChannel.color }}>
                        + {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Notas</p>
                <textarea
                  value={contactNotes}
                  onChange={(e) => setContactNotes(e.target.value)}
                  onBlur={() => {
                    if (ct.contact_id && contactNotes !== (contactD?.contact?.notes || "")) {
                      updateContactMut.mutate({ notes: contactNotes });
                    }
                  }}
                  placeholder="Adicionar nota..."
                  rows={3}
                  disabled={!ct.contact_id}
                  className="w-full p-2 rounded-lg text-xs outline-none resize-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat Context Menu */}
      {chatContextMenu && (
        <div
          className="fixed w-48 rounded-xl shadow-xl z-50 py-1"
          style={{ left: chatContextMenu.x, top: chatContextMenu.y, background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
          onClick={(e) => e.stopPropagation()}>
          {[
            { icon: Star, label: "Favoritar", action: "star" },
            { icon: Pin, label: "Fixar", action: "pin" },
            { icon: Archive, label: "Arquivar", action: "archive" },
            { icon: BellOff, label: "Silenciar", action: "mute" },
            { icon: Trash2, label: "Excluir", action: "delete", color: "#ef4444" },
          ].map((item, i) => (
            <button key={i} onClick={() => { handleAction(item.action); setChatContextMenu(null); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-white/5 transition-colors"
              style={{ color: item.color || "var(--text-2)" }}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Message Context Menu */}
      {selectedMsgId && (
        <div
          className="fixed w-44 rounded-xl shadow-xl z-50 py-1"
          style={{
            left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            background: "var(--surface-2)", border: "1px solid var(--surface-border)"
          }}
          onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-2 text-xs font-medium border-b" style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}>
            Mensagem
          </div>
          {[
            { icon: Star, label: "Favoritar", action: "star" },
            { icon: Pin, label: "Fixar", action: "pin" },
            { icon: Archive, label: "Arquivar", action: "archive" },
            { icon: Trash2, label: "Excluir", action: "delete", color: "#ef4444" },
          ].map((item, i) => (
            <button key={i} onClick={() => handleMsgAction(item.action)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-white/5 transition-colors"
              style={{ color: item.color || "var(--text-2)" }}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
          <button onClick={() => setSelectedMsgId(null)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-white/5 transition-colors"
            style={{ color: "var(--text-3)" }}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
