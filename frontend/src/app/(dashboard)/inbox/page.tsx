"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import api from "@/lib/api";
import {
  Search, Send, Check, CheckCheck, Image, Mic, FileText, MapPin,
  Users, Phone, Video, MessageSquare, User, Archive, Trash2, Star,
  MoreHorizontal, ChevronRight, ChevronDown, Filter, EyeOff, Pin, Tag, BellOff,
  Smile, Paperclip, ArrowDown, RefreshCw, Copy, Clock, AlertCircle, Zap
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

// Initials ignora conectores ("da", "de", etc.) e combina a primeira letra
// de cada palavra em caixa alta — "Pedro Benevides" → "PB".
function initialsFromName(name: string | undefined | null): string {
  if (!name) return "?";
  const skip = new Set(["da", "de", "di", "do", "du", "das", "dos", "e", "van", "von", "la", "le", "del", "der"]);
  const words = name.trim().split(/\s+/).filter(w => w.length > 0 && !skip.has(w.toLowerCase()));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

interface ChatContact {
  jid: string; name: string; phone: string; avatar?: string;
  last_message: string; last_time: string; unread_count: number;
  is_online: boolean; is_group?: boolean;
}

interface ChatMessage {
  id: string; content: string; from_me: boolean;
  timestamp: number; status: string; type: string;
  sender_jid?: string; sender_name?: string;
  is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean;
}

interface ContactInfo {
  jid: string; name: string; phone: string; avatar?: string;
  email?: string; tags: string[]; funnel?: string; stage?: string; journey?: string;
  contact_id?: string; owner?: string; owner_name?: string; notes?: string;
  is_group?: boolean;
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
  // O content pode ser:
  //  - uma string JSON-encoded (texto simples)
  //  - um objeto JSON com { url, mime_type, filename, caption, error }
  //    para mensagens de mídia enviadas via /inbox/.../messages/media
  let parsed: any = null;
  try { parsed = JSON.parse(msg.content); } catch {}
  const isObj = parsed && typeof parsed === "object" && !Array.isArray(parsed);
  const text = typeof parsed === "string" ? parsed : (isObj ? (parsed.caption || parsed.text || "") : msg.content);
  const url = isObj ? parsed.url as string | undefined : undefined;
  const errMsg = isObj ? parsed.error as string | undefined : undefined;

  if (msg.type === "reaction") return <span className="text-xl">{text || "👍"}</span>;

  if (msg.type === "image" && url) {
    return (
      <div className="flex flex-col gap-1.5">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={parsed.filename || "imagem"} className="max-w-[260px] max-h-[260px] rounded-lg object-cover" />
        </a>
        {text && <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</span>}
        {errMsg && <span className="text-[10px] text-red-400">{errMsg}</span>}
      </div>
    );
  }
  if (msg.type === "video" && url) {
    return (
      <div className="flex flex-col gap-1.5">
        <video src={url} controls className="max-w-[300px] rounded-lg" />
        {text && <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</span>}
        {errMsg && <span className="text-[10px] text-red-400">{errMsg}</span>}
      </div>
    );
  }
  if (msg.type === "audio" && url) {
    return (
      <div className="flex flex-col gap-1.5">
        <audio src={url} controls className="max-w-[260px]" />
        {errMsg && <span className="text-[10px] text-red-400">{errMsg}</span>}
      </div>
    );
  }
  if (msg.type === "document" && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors"
        style={{ background: "rgba(255,255,255,0.03)" }}>
        <FileText className="w-5 h-5 flex-shrink-0" />
        <span className="text-xs truncate">{parsed.filename || "Documento"}</span>
      </a>
    );
  }

  // Fallback para mídias sem URL (recebidas) — ícone + label
  const icons: Record<string, React.ReactNode> = {
    image: <Image className="w-4 h-4" />, audio: <Mic className="w-4 h-4" />,
    video: <Image className="w-4 h-4" />, document: <FileText className="w-4 h-4" />,
    location: <MapPin className="w-4 h-4" />,
  };
  if (icons[msg.type]) return <span className="flex items-center gap-1.5 opacity-80">{icons[msg.type]}<span>{text}</span></span>;
  return <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</span>;
}

// ─── WebSocket Hook for Real-Time Messages (Global) ──────────────────────────

const API_WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") || "ws://localhost:8080";

function useInboxWebSocket(instanceId: string, activeChat: string | null, qc: ReturnType<typeof useQueryClient>, onStatusChange: (s: "connected" | "disconnected" | "connecting") => void, onSync: () => void, session: { accessToken?: string } | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onSyncRef = useRef(onSync);
  const instanceIdRef = useRef(instanceId);
  const activeChatRef = useRef(activeChat);
  const connectedRef = useRef(false);
  const tokenRef = useRef("");
  const shouldReconnectRef = useRef(true);

  onStatusChangeRef.current = onStatusChange;
  onSyncRef.current = onSync;
  instanceIdRef.current = instanceId;
  activeChatRef.current = activeChat;
  tokenRef.current = (session?.accessToken as string) || "";

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    connectedRef.current = false;
  }, []);

  const connect = useCallback(() => {
    if (connectedRef.current || wsRef.current) return;

    shouldReconnectRef.current = true;
    onStatusChangeRef.current("connecting");
    try {
      const token = tokenRef.current;
      if (!token) {
        onStatusChangeRef.current("disconnected");
        if (shouldReconnectRef.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
        return;
      }
      const wsUrl = `${API_WS_URL}/ws/events?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        connectedRef.current = true;
        onStatusChangeRef.current("connected");
      };
      ws.onclose = () => {
        connectedRef.current = false;
        wsRef.current = null;
        onStatusChangeRef.current("disconnected");
        if (shouldReconnectRef.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ping") return;

          const eventInstance = msg.instance || "";
          const currentInstance = instanceIdRef.current;

          if (msg.type === "history.sync") {
            if (!currentInstance || !eventInstance || eventInstance === currentInstance) {
              onSyncRef.current();
            }
          }

          if (msg.type === "message" || msg.type === "message_received" || msg.type === "message.received" || msg.type === "message.sent") {
            if (eventInstance) {
              qc.invalidateQueries({ queryKey: ["chats", eventInstance] });
              const chat = activeChatRef.current;
              if (chat && currentInstance === eventInstance) {
                qc.invalidateQueries({ queryKey: ["msgs", eventInstance, chat] });
              }
            } else if (currentInstance) {
              qc.invalidateQueries({ queryKey: ["chats", currentInstance] });
              const chat = activeChatRef.current;
              if (chat) {
                qc.invalidateQueries({ queryKey: ["msgs", currentInstance, chat] });
              }
            }
          }

          if (msg.type === "message_status" || msg.type === "message.status") {
            if (eventInstance) {
              const chat = activeChatRef.current;
              if (chat && currentInstance === eventInstance) {
                qc.invalidateQueries({ queryKey: ["msgs", eventInstance, chat] });
              }
            } else if (currentInstance) {
              const chat = activeChatRef.current;
              if (chat) {
                qc.invalidateQueries({ queryKey: ["msgs", currentInstance, chat] });
              }
            }
          }

          if (msg.type === "instance_status") {
            qc.invalidateQueries({ queryKey: ["instances"] });
            if (eventInstance) {
              qc.invalidateQueries({ queryKey: ["chats", eventInstance] });
            }
          }
        } catch {}
      };
    } catch { onStatusChangeRef.current("disconnected"); }
  }, [qc, disconnect]);

  useEffect(() => {
    if (!session?.accessToken) {
      disconnect();
      return;
    }

    shouldReconnectRef.current = true;
    connect();

    return () => {
      disconnect();
    };
  }, [session?.accessToken, connect, disconnect]);

  return wsRef;
}

// ─── Contact List Item ──────────────────────────────────────────────────────

function ContactItem({
  contact, isActive, channelColor, onClick, onContextMenu, selectedInstances, instData,
}: {
  contact: ChatContact; isActive: boolean; channelColor: string;
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void;
  selectedInstances?: string[]; instData?: Instance[];
}) {
  // Get channels for this contact's instance
  const contactChannels = useMemo(() => {
    if (!selectedInstances || selectedInstances.length <= 1 || !instData) return [];
    const contactInst = instData.filter(i => selectedInstances.includes(i.id) && i.status === "connected");
    return contactInst;
  }, [selectedInstances, instData]);

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
            {contact.is_group ? <Users className="w-5 h-5" /> : initialsFromName(contact.name)}
          </div>
        )}
        {contact.is_online && !contact.is_group && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
            style={{ background: "#22c55e", borderColor: "var(--surface-2)" }} />
        )}
        {/* Channel badges for multi-instance */}
        {contactChannels.length > 0 && (
          <div className="absolute -bottom-1 -right-1 flex -space-x-1">
            {contactChannels.slice(0, 3).map(inst => {
              const ch = CHANNELS.find(c => c.id === inst.channel);
              return (
                <span key={inst.id} className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border"
                  style={{ background: ch?.color || "#888", color: "#fff", borderColor: "var(--surface-2)" }}
                  title={inst.name}>
                  {ch?.label.slice(0, 2).toUpperCase()}
                </span>
              );
            })}
            {contactChannels.length > 3 && (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold bg-gray-500"
                style={{ color: "#fff", borderColor: "var(--surface-2)" }}>
                +{contactChannels.length - 3}
              </span>
            )}
          </div>
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
  msg, channelColor, contactAvatar, contactName, isGroupChat, onContextMenu, onResend,
}: {
  msg: ChatMessage; channelColor: string; contactAvatar?: string; contactName: string; isGroupChat?: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onResend?: (msgId: string) => void;
}) {
  const sent = msg.from_me;
  const senderPhone = msg.sender_jid ? msg.sender_jid.split("@")[0].split(":")[0] : "";
  const senderName = msg.sender_name?.trim() || "";
  // Em grupos mostramos o nome de quem enviou (ou só o telefone quando não
  // temos pushName), e em parênteses o número para facilitar identificar.
  const senderDisplay = senderName
    ? (senderPhone && senderPhone !== senderName ? `${senderName} · ${senderPhone}` : senderName)
    : (senderPhone || "Contato");

  return (
    <div className={cn("flex gap-2 group", sent ? "justify-end" : "items-end")}
      onContextMenu={onContextMenu}>
      {/* Received avatar */}
      {!sent && (
        (!isGroupChat && contactAvatar)
          ? <img src={contactAvatar} className="w-7 h-7 rounded-full object-cover flex-shrink-0 mb-5" alt="" />
          : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0 mb-5"
              style={{ background: `${channelColor}18`, color: channelColor }}>
              {initialsFromName(senderDisplay)}
            </div>
      )}

      {/* Bubble */}
      <div className="max-w-[70%] min-w-[80px]">
        {!sent && isGroupChat && (
          <div className="text-[11px] mb-1 px-1" style={{ color: "var(--text-3)" }}>
            {senderDisplay}
          </div>
        )}
        <div
          className={cn(
            "px-3 py-2 text-[13px] leading-[1.5] relative",
            sent ? "rounded-2xl rounded-br-md" : "rounded-2xl rounded-bl-md"
          )}
          style={sent
            ? { background: "rgb(37 211 102 / 17%)", color: "rgb(255, 255, 255)" }
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
            : msg.status === "pending" ? (
                <Clock className="w-3 h-3 animate-pulse" style={{ color: "var(--text-3)" }} aria-label="enviando" />
              )
            : msg.status === "failed" ? (
                <button
                  onClick={() => onResend?.(msg.id)}
                  title="Reenviar — clique para tentar de novo"
                  className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded transition-colors"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reenviar</span>
                </button>
              )
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
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [channels, setChannels] = useState<ChannelType[]>(["whatsapp"]);
  const [instance, setInstance] = useState("");
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [showInstanceDropdown, setShowInstanceDropdown] = useState(false);
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
  const [contactFunnel, setContactFunnel] = useState("");
  const [contactJourney, setContactJourney] = useState("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  const [msgOffset, setMsgOffset] = useState(0);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(true);
  const [olderMsgs, setOlderMsgs] = useState<ChatMessage[]>([]);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected" | "connecting">("disconnected");
  const [isSyncing, setIsSyncing] = useState<boolean | undefined>(undefined);
  const [showNewFunnel, setShowNewFunnel] = useState(false);
  const [showNewStage, setShowNewStage] = useState(false);
  const [newFunnelName, setNewFunnelName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgsContainerRef = useRef<HTMLDivElement>(null);
  const instanceDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (instanceDropdownRef.current && !instanceDropdownRef.current.contains(e.target as Node)) {
        setShowInstanceDropdown(false);
      }
    };
    if (showInstanceDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showInstanceDropdown]);

  // ── Data queries ──

  const { data: instData = [] } = useQuery<Instance[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then(r => r.data),
    enabled: !!currentWorkspace,
    staleTime: 30 * 1000, // 30 seconds
  });

  const chInst = instData.filter(i => i.status === "connected" || i.status === "connecting" || i.status === "disconnected");
  const chAvail = CHANNELS.filter(c => instData.some(i => i.channel === c.id && (i.status === "connected" || i.status === "connecting" || i.status === "disconnected")));

  // Auto-select most recent instance if none selected
  useEffect(() => {
    if (chInst.length > 0) {
      if (selectedInstances.length === 0 && instance === "") {
        // Select most recent connected instance by default
        setSelectedInstances([chInst[0].id]);
        setChat(null);
      }
    }
  }, [chInst.length]);

  // Sync selectedInstances with legacy instance state
  useEffect(() => {
    if (selectedInstances.length > 0 && !selectedInstances.includes(instance)) {
      // Update legacy instance when multi-select changes
    } else if (selectedInstances.length === 0 && instance) {
      setSelectedInstances([instance]);
    }
  }, [selectedInstances, instance]);

  useEffect(() => {
    if (chAvail.length > 0 && !chAvail.find(c => channels.includes(c.id))) setChannels([chAvail[0].id]);
  }, [chAvail.length]);

  const activeInstance = selectedInstances[0] || instance;

  // Chat list — aggregate from all selected instances
  const chatInstanceId = selectedInstances[0] || instance;
  const { data: chatsD, refetch: refetchChats } = useQuery({
    queryKey: ["chats", chatInstanceId, search, filter],
    enabled: !!chatInstanceId,
    refetchInterval: 5000,
    queryFn: async () => {
      const instId = selectedInstances[0] || instance;
      if (!instId) return { chats: [], connected: true };
      const instIds = [instId];

      const allChats: any[] = [];
      // `connected` reflete se pelo menos uma das instâncias consultadas está
      // viva. Quando TODAS vierem com connected=false, a UI mostra banner
      // "instância desconectada" em vez de empty state genérico.
      let anyConnected = false;
      let sawAny = false;
      for (const instId of instIds) {
        try {
          const res = await inboxApi.getChats(instId, search, filter);
          sawAny = true;
          if (res.data?.connected !== false) anyConnected = true;
          const chats = res.data?.chats || [];
          chats.forEach((c: any) => c.instance_id = instId);
          allChats.push(...chats);
        } catch {}
      }

      // Deduplicate by jid, keeping most recent
      const seen = new Map<string, any>();
      for (const chat of allChats) {
        const existing = seen.get(chat.jid);
        if (!existing || new Date(chat.last_time) > new Date(existing.last_time)) {
          seen.set(chat.jid, chat);
        }
      }

      return {
        chats: Array.from(seen.values()).sort((a, b) =>
          new Date(b.last_time).getTime() - new Date(a.last_time).getTime()
        ),
        connected: sawAny ? anyConnected : true,
      };
    }
  });

  // Track which instance each chat belongs to
  const chatInstanceMap = useMemo(() => {
    const map = new Map<string, string>();
    if (chatsD?.chats) {
      (chatsD.chats as any[]).forEach(c => {
        if (c.instance_id) map.set(c.jid, c.instance_id);
      });
    }
    return map;
  }, [chatsD?.chats]);

  // Messages — poll every 4s as fallback, WS gives instant
  const { data: msgsD } = useQuery({
    queryKey: ["msgs", activeInstance, chat, msgOffset],
    enabled: !!activeInstance && !!chat,
    refetchInterval: 4000,
    queryFn: async () => {
      try { return (await inboxApi.getMessages(activeInstance, chat, { offset: msgOffset })).data; }
      catch { return { messages: [], has_more: false }; }
    }
  });

  const { data: contactD } = useQuery({
    queryKey: ["contact", activeInstance, chat],
    enabled: !!activeInstance && !!chat,
    queryFn: async () => {
      try { return (await inboxApi.getChat(activeInstance, chat)).data; }
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

  const { data: tagsD = [] } = useQuery<any[]>({
    queryKey: ["crmTags", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      try { return (await crmApi.listTags(currentWorkspace!.id)).data || []; }
      catch { return []; }
    }
  });

  // Query keys alinhadas com as do CRM (frontend/src/app/(dashboard)/crm/page.tsx)
  // para que invalidações cruzem os dois lados automaticamente.
  const { data: funnelsD } = useQuery({
    queryKey: ["funnels", currentWorkspace?.id],
    enabled: !!currentWorkspace?.id,
    queryFn: async () => {
      try { return (await crmApi.listFunnels(currentWorkspace!.id)).data || []; }
      catch { return []; }
    }
  });

  const { data: funnelOptionsD } = useQuery({
    queryKey: ["funnel-options", currentWorkspace?.id],
    queryFn: async () => {
      try { return (await crmApi.listFunnelOptions(currentWorkspace?.id)).data || []; }
      catch { return []; }
    }
  });

  const { data: stageOptionsD } = useQuery({
    queryKey: ["stage-options", currentWorkspace?.id],
    queryFn: async () => {
      try { return (await crmApi.listStageOptions(currentWorkspace?.id)).data || []; }
      catch { return []; }
    }
  });

  const { data: journeyOptionsD } = useQuery({
    queryKey: ["journey-options"],
    queryFn: async () => {
      try { return (await crmApi.listJourneyOptions()).data || []; }
      catch { return []; }
    }
  });

  // Funil atual do contato → etapas daquele funil (cascata).
  // Se o contato não tem funil atribuído, o dropdown de etapa fica bloqueado.
  const currentFunnelObj = (funnelsD || []).find((f: any) => f.name === contactFunnel);
  const { data: contactFunnelStagesD } = useQuery<any[]>({
    queryKey: ["funnel-stages", currentFunnelObj?.id],
    enabled: !!currentFunnelObj?.id,
    queryFn: async () => {
      try { return (await crmApi.listFunnelStages(currentFunnelObj!.id)).data || []; }
      catch { return []; }
    }
  });

  // ── WebSocket for real-time ──
  useInboxWebSocket(instance, chat, qc, setWsStatus, () => {
    setIsSyncing(true);
    qc.invalidateQueries({ queryKey: ["chats", instance] });
    if (chat) {
      qc.invalidateQueries({ queryKey: ["msgs", instance, chat] });
      qc.invalidateQueries({ queryKey: ["contact", instance, chat] });
    }
    setTimeout(() => setIsSyncing(false), 2000);
  }, session);

  // ── Mutations ──

  const sendMut = useMutation({
    mutationFn: (content: string) => inboxApi.sendMessage(activeInstance, chat!, { content, type: "text" }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: ["msgs", activeInstance, chat] });
      qc.invalidateQueries({ queryKey: ["chats", selectedInstances.join(",") || instance] });
      inpRef.current?.focus();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao enviar"),
  });

  const readMut = useMutation({
    mutationFn: () => inboxApi.markRead(activeInstance, chat!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats"] }),
  });

  const resendMut = useMutation({
    mutationFn: (msgId: string) => inboxApi.resendMessage(activeInstance, msgId),
    onSuccess: () => {
      toast.success("Reenviando…");
      qc.invalidateQueries({ queryKey: ["msgs", activeInstance, chat] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao reenviar"),
  });

  // Upload do arquivo pro MinIO e depois envio da mídia com o URL.
  const uploadAndSend = useMutation({
    mutationFn: async (file: File) => {
      if (!activeInstance || !chat) throw new Error("sem chat ativo");
      const up = await inboxApi.uploadMedia(activeInstance, file);
      const { url, mime_type } = up.data as { url: string; mime_type: string };
      await inboxApi.sendMedia(activeInstance, chat, {
        url,
        mime_type,
        filename: file.name,
      });
    },
    onSuccess: () => {
      toast.success("Enviando mídia…");
      qc.invalidateQueries({ queryKey: ["msgs", activeInstance, chat] });
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao enviar mídia"),
  });

  const updateMessageMut = useMutation({
    mutationFn: (data: { is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean }) =>
      inboxApi.updateMessage(activeInstance, selectedMsgId || "", data),
    onSuccess: () => {
      toast.success("Mensagem atualizada!");
      qc.invalidateQueries({ queryKey: ["msgs", activeInstance, chat] });
      setSelectedMsgId(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro"),
  });

  const list: ChatContact[] = useMemo(() => {
    const chats = chatsD?.chats || [];
    // Dedupe por telefone (normalizado) em vez de jid cru — evita aparecer
    // duas vezes o mesmo contato quando o backend guardou entradas com o
    // sufixo @s.whatsapp.net e outras sem. Para grupos (@g.us), mantém o
    // jid completo como chave.
    const seen = new Set<string>();
    return chats.filter(c => {
      const isGroup = (c.jid || "").includes("@g.us");
      const key = isGroup ? c.jid : (c.phone || c.jid?.split("@")[0] || c.jid);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [chatsD?.chats]);
  const currentMsgs: ChatMessage[] = msgsD?.messages || [];
  const msgs: ChatMessage[] = useMemo(() => {
    const merged = [...olderMsgs, ...currentMsgs];
    const seen = new Set<string>();
    return merged.filter((m) => {
      const key = `${m.id}-${m.timestamp}-${m.from_me ? "out" : "in"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [olderMsgs, currentMsgs]);
  const hasMore = msgsD?.has_more ?? false;
  const liveChat = list.find(c => c.jid === chat);
  const ct: ContactInfo = {
    ...(contactD?.contact || { jid: chat || "", name: chat?.split("@")[0] || "", phone: chat || "", tags: [], notes: "" }),
    name: liveChat?.name || contactD?.contact?.name || chat?.split("@")[0] || "",
    phone: liveChat?.phone || contactD?.contact?.phone || chat?.split("@")[0] || "",
    funnel: contactD?.contact?.funnel || "",
    stage: contactD?.contact?.stage || "",
    journey: contactD?.contact?.journey || "",
  };

  // Reset pagination when chat changes
  useEffect(() => {
    setMsgOffset(0);
    setHasMoreMsgs(true);
    setOlderMsgs([]);
  }, [chat]);

  // Keep local has-more in sync with server response for first page
  useEffect(() => {
    if (msgOffset === 0) {
      setHasMoreMsgs(msgsD?.has_more ?? false);
    }
  }, [msgsD?.has_more, msgOffset]);

  const loadMoreMut = useMutation({
    mutationFn: async (currentOffset: number) => {
      const newOffset = currentOffset + 50;
      const res = await inboxApi.getMessages(instance, chat, { offset: newOffset });
      return { ...res.data, newOffset };
    },
    onSuccess: (data) => {
      const newBatch: ChatMessage[] = data.messages || [];
      if (newBatch.length > 0) {
        setOlderMsgs(prev => {
          const seen = new Set(prev.map(m => m.id));
          const filtered = newBatch.filter(m => !seen.has(m.id));
          return [...filtered, ...prev];
        });
        setMsgOffset(data.newOffset);
      }
      setHasMoreMsgs(data.has_more ?? false);
      if (newBatch.length === 0) {
        toast.info("Não há mensagens mais antigas");
      }
    },
    onError: () => {
      toast.error("Falha ao carregar mensagens antigas");
    },
  });

  // CRM mutations
  const ensureContactAndUpdate = useMutation({
    mutationFn: async (data: { name?: string; email?: string; notes?: string; funnel?: string; stage?: string; journey?: string; owner?: string }) => {
      if (ct.contact_id) {
        return crmApi.updateContact(ct.contact_id, data);
      }
      // No contact yet - create one first
      const phone = ct.phone || chat?.split("@")[0] || "";
      const name = ct.name || phone;
      const created = await crmApi.createContact({
        name,
        phone,
        workspace_id: currentWorkspace?.id,
      });
      // Then update with the desired data
      const contactId = created.data?.contact?.id || created.data?.id;
      if (!contactId) throw new Error("Falha ao criar contato");
      return crmApi.updateContact(contactId, data);
    },
    onSuccess: () => {
      toast.success("Contato atualizado!");
      qc.invalidateQueries({ queryKey: ["contact", instance, chat] });
      // Propaga mudança para o CRM e para os dropdowns de segmentação.
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contacts-all"] });
      qc.invalidateQueries({ queryKey: ["funnel-options"] });
      qc.invalidateQueries({ queryKey: ["stage-options"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao atualizar"),
  });

  const ensureContactAndAssignTags = useMutation({
    mutationFn: async (tagIds: string[]) => {
      let contactId = ct.contact_id;
      if (!contactId) {
        const phone = ct.phone || chat?.split("@")[0] || "";
        const name = ct.name || phone;
        const created = await crmApi.createContact({
          name,
          phone,
          workspace_id: currentWorkspace?.id,
        });
        contactId = created.data?.contact?.id || created.data?.id;
        if (!contactId) throw new Error("Falha ao criar contato");
        // Invalidate to get new contact_id
        qc.invalidateQueries({ queryKey: ["contact", instance, chat] });
      }
      return crmApi.assignTags(contactId, tagIds);
    },
    onSuccess: () => {
      toast.success("Tags atualizadas!");
      qc.invalidateQueries({ queryKey: ["contact", instance, chat] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao atualizar tags"),
  });

  const updateContactMut = ensureContactAndUpdate;

  const assignTagsMut = ensureContactAndAssignTags;

  const createFunnelMut = useMutation({
    mutationFn: (data: { name: string; color?: string }) => crmApi.createFunnel({ ...data, workspace_id: currentWorkspace?.id }),
    onSuccess: () => {
      toast.success("Funil criado!");
      qc.invalidateQueries({ queryKey: ["funnels"] });
      qc.invalidateQueries({ queryKey: ["funnel-options"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao criar funil"),
  });

  const createStageMut = useMutation({
    mutationFn: ({ funnelId, data }: { funnelId: string; data: { name: string; color?: string } }) =>
      crmApi.createFunnelStage(funnelId, data),
    onSuccess: () => {
      toast.success("Etapa criada!");
      qc.invalidateQueries({ queryKey: ["funnel-stages"] });
      qc.invalidateQueries({ queryKey: ["stage-options"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao criar etapa"),
  });

  // ── Effects ──

  useEffect(() => { if (chat) readMut.mutate(); }, [chat]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgsD]);

  useEffect(() => {
    if (contactD?.contact) {
      setContactNotes(contactD.contact.notes || "");
      setContactOwner(contactD.contact.owner || "");
      setContactStage(contactD.contact.stage || "");
      setContactFunnel(contactD.contact.funnel || "");
      setContactJourney(contactD.contact.journey || "");
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
      qc.invalidateQueries({ queryKey: ["chats", selectedInstances.join(",") || instance] });
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
  const currentInstData = instData.find(i => i.id === activeInstance);
  const isInstagramInbox = currentInstData?.channel === "instagram";

  const chatActiveInstance = chat ? (chatInstanceMap.get(chat) || activeInstance) : activeInstance;

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
            {isInstagramInbox && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${curChannel.color}20`, color: curChannel.color }}>
                Instagram
              </span>
            )}
{/* Instance selector dropdown */}
              {chInst.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowInstanceDropdown(!showInstanceDropdown)}
                    className="px-4 py-2 rounded-lg text-sm font-medium outline-none cursor-pointer min-w-[200px] flex items-center justify-between gap-2"
                    style={{ background: `${curChannel.color}15`, color: curChannel.color, border: `1px solid ${curChannel.color}30` }}
                  >
                    <span>{selectedInstances.length > 0 ? `${selectedInstances.length} instância(s)` : "Selecionar instâncias"}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {showInstanceDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-80 rounded-xl shadow-xl z-50 py-1 max-h-72 overflow-y-auto"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                      {chInst.map(i => {
                        const isSelected = selectedInstances.includes(i.id);
                        const ch = CHANNELS.find(c => c.id === i.channel);
                        return (
                          <button
                            key={i.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedInstances(selectedInstances.filter(id => id !== i.id));
                              } else {
                                setSelectedInstances([...selectedInstances, i.id]);
                              }
                              setChat(null);
                            }}
                            className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
                            style={{ color: "var(--text-1)" }}
                          >
                            <span className={`w-4 h-4 rounded flex items-center justify-center ${isSelected ? '' : 'border'}`}
                              style={{ background: isSelected ? curChannel.color : 'transparent', borderColor: curChannel.color }}>
                              {isSelected && <Check className="w-3 h-3" style={{ color: "#000" }} />}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{i.name}</div>
                              <div className="text-[10px]" style={{ color: ch?.color || "var(--text-3)" }}>{ch?.label}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {/* Refresh button */}
              {activeInstance && currentInstData?.channel === "whatsapp" && (
                <button
                  onClick={async () => {
                    try {
                      await instancesApi.reconnect(activeInstance);
                      toast.success("Instância reconectada");
                    } catch {
                      toast.error("Falha ao reconectar instância");
                    } finally {
                      qc.invalidateQueries({ queryKey: ["instances"] });
                      qc.invalidateQueries({ queryKey: ["chats", selectedInstances.join(",") || instance] });
                      if (chat) {
                        setOlderMsgs([]);
                        setMsgOffset(0);
                        qc.invalidateQueries({ queryKey: ["msgs", activeInstance, chat] });
                        qc.invalidateQueries({ queryKey: ["contact", activeInstance, chat] });
                      }
                    }
                  }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10 active:scale-95"
                  style={{ color: wsStatus === "connected" ? curChannel.color : "var(--text-3)" }}
                  title="Reconectar e atualizar instância"
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
        <aside className="w-14 sm:w-[56px] flex-shrink-0 flex flex-col items-center py-3 gap-1 hidden sm:flex"
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
        <div className="w-60 sm:w-72 md:w-[340px] flex-shrink-0 flex flex-col hidden md:flex"
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
            {!(instance || selectedInstances.length > 0) ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: `${curChannel.color}10` }}>
                  <MessageSquare className="w-7 h-7" style={{ color: curChannel.color, opacity: 0.4 }} />
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Sem instância conectada</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Conecte uma instância para ver conversas</p>
              </div>
            ) : chatsD?.connected === false ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                  style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.25)" }}>
                  <AlertCircle className="w-7 h-7" style={{ color: "#eab308" }} />
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Instância desconectada</p>
                <p className="text-xs mt-1 max-w-xs" style={{ color: "var(--text-3)" }}>
                  As conversas voltam assim que a instância reconectar. O histórico está salvo.
                </p>
                <a
                  href="/instances"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5"
                  style={{ background: "rgba(234,179,8,0.15)", color: "#eab308", border: "1px solid rgba(234,179,8,0.3)" }}
                >
                  Reconectar em /instances
                </a>
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
                selectedInstances={selectedInstances}
                instData={instData}
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
                      {initialsFromName(ct.name)}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                      <span>{ct.name}</span>
                      {ct.journey && (
                        <span
                          title={`Este contato está na jornada "${ct.journey}"`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: "#a855f71a", color: "#c084fc", border: "1px solid #a855f733" }}>
                          <Zap className="w-2.5 h-2.5" />
                          {ct.journey}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const value = ct.jid || "";
                        if (!value) return;
                        navigator.clipboard.writeText(value);
                        toast.success("JID copiado");
                      }}
                      className="text-xs inline-flex items-center gap-1 hover:underline"
                      style={{ color: "var(--text-3)" }}
                      title="Clique para copiar JID"
                    >
                      <span>{ct.jid}</span>
                      <Copy className="w-3 h-3" />
                    </button>
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
                      key={`${m.id}-${m.timestamp}-${m.from_me ? "out" : "in"}`}
                      msg={m}
                      channelColor={curChannel.color}
                      contactAvatar={ct.avatar}
                      contactName={ct.name}
                      isGroupChat={ct.is_group}
                      onContextMenu={(e) => {
                        if (!m.from_me) {
                          e.preventDefault();
                          setSelectedMsgId(m.id);
                        }
                      }}
                      onResend={(id) => resendMut.mutate(id)}
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
                  <input ref={fileInputRef} type="file" className="hidden"
                    accept="image/*,video/*,audio/*,application/pdf,application/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAndSend.mutate(f);
                      if (e.target) e.target.value = "";
                    }} />
                  <button onClick={() => fileInputRef.current?.click()}
                    disabled={uploadAndSend.isPending}
                    className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors flex-shrink-0 disabled:opacity-40"
                    style={{ color: "var(--text-3)" }}
                    title="Anexar imagem, áudio ou documento">
                    {uploadAndSend.isPending
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Paperclip className="w-4 h-4" />}
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
          <div className="w-64 sm:w-[300px] flex-shrink-0 flex flex-col overflow-y-auto hidden lg:flex"
            style={{ background: "var(--surface-2)", borderLeft: "1px solid var(--surface-border)" }}>
          {/* Profile header */}
            <div className="p-5 border-b text-center" style={{ borderColor: "var(--surface-border)" }}>
              {ct.avatar ? (
                <img src={ct.avatar} className="w-16 h-16 rounded-full mx-auto object-cover" alt="" />
              ) : (
                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-lg font-bold"
                  style={{ background: `${curChannel.color}18`, color: curChannel.color }}>
                  {initialsFromName(ct.name)}
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
              {membersD?.members && (
                <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Responsável</p>
                  <select value={contactOwner} onChange={(e) => {
                    setContactOwner(e.target.value);
                    ensureContactAndUpdate.mutate({ owner: e.target.value });
                  }}
                    disabled={ensureContactAndUpdate.isPending}
                    className="w-full p-2 rounded-lg text-xs outline-none"
                    style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
                    <option value="">Selecionar...</option>
                    {membersD.members.map((m: any) => (
                      <option key={m.user_id || m.id} value={m.user_id || m.id}>{m.user?.name || m.name || "Membro"}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Funnel */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Funil</p>
                  <button onClick={() => setShowNewFunnel(true)}
                    className="text-[10px] hover:opacity-70" style={{ color: curChannel.color }}>+ Novo</button>
                </div>
                <select value={contactFunnel} onChange={(e) => {
                  const newFunnel = e.target.value;
                  setContactFunnel(newFunnel);
                  // Trocou de funil → etapa antiga provavelmente não existe no novo funil.
                  // Limpa stage pra evitar registro "órfão".
                  setContactStage("");
                  ensureContactAndUpdate.mutate({ funnel: newFunnel, stage: "" });
                }}
                  disabled={ensureContactAndUpdate.isPending}
                  className="w-full p-2 rounded-lg text-xs outline-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
                  <option value="">Nenhum</option>
                  {(funnelsD || []).map((f: any) => (
                    <option key={f.id} value={f.name}>{f.name}</option>
                  ))}
                  {(funnelOptionsD || []).filter((n: string) => !(funnelsD || []).find((f: any) => f.name === n)).map((name: string) => (
                    <option key={name} value={name}>{name} (legado)</option>
                  ))}
                </select>
              </div>

              {/* Stage — opções vêm do funil atualmente atribuído (cascata).
                  Se o funil é "legado" (existe só como string em contacts, não tem ID),
                  cai no fallback de stage-options global. */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Etapa</p>
                  <button
                    onClick={() => setShowNewStage(true)}
                    disabled={!currentFunnelObj}
                    className="text-[10px] hover:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ color: curChannel.color }}
                  >+ Nova</button>
                </div>
                <select value={contactStage} onChange={(e) => {
                  setContactStage(e.target.value);
                  ensureContactAndUpdate.mutate({ stage: e.target.value });
                }}
                  disabled={ensureContactAndUpdate.isPending || !contactFunnel}
                  className="w-full p-2 rounded-lg text-xs outline-none disabled:opacity-50"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
                  <option value="">
                    {contactFunnel ? "Sem etapa" : "Escolha um funil primeiro"}
                  </option>
                  {currentFunnelObj
                    ? (contactFunnelStagesD || []).map((s: any) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))
                    : (stageOptionsD || []).map((s: string) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                </select>
              </div>

              {/* Journey */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Jornada</p>
                <select value={contactJourney} onChange={(e) => {
                  setContactJourney(e.target.value);
                  ensureContactAndUpdate.mutate({ journey: e.target.value });
                }}
                  disabled={ensureContactAndUpdate.isPending}
                  className="w-full p-2 rounded-lg text-xs outline-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
                  <option value="">Todas</option>
                  {(journeyOptionsD || []).map((j: string) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
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
                {tagsD && tagsD.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tagsD.map((tag: any) => {
                      const currentTags = ct.tags || [];
                      const hasTag = currentTags.includes(tag.name);
                      return (
                        <button key={tag.id} onClick={() => {
                          const currentTagObjs = (tagsD || []).filter((t: any) => currentTags.includes(t.name));
                          const newTagIds = hasTag
                            ? currentTagObjs.filter((t: any) => t.id !== tag.id).map((t: any) => t.id)
                            : [...currentTagObjs.map((t: any) => t.id), tag.id];
                          ensureContactAndAssignTags.mutate(newTagIds);
                        }}
                          className="text-[10px] px-2 py-0.5 rounded-full border transition-colors hover:opacity-80"
                          style={{ borderColor: curChannel.color, color: curChannel.color }}>
                          {hasTag ? "✓" : "+"} {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="p-3 rounded-xl" style={{ background: "var(--surface-1)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Notas</p>
                <textarea
                  value={contactNotes}
                  onChange={(e) => setContactNotes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const noteToSave = contactNotes.trim();
                      if (noteToSave) {
                        ensureContactAndUpdate.mutate({ notes: noteToSave });
                        setContactNotes("");
                      }
                    }
                  }}
                  placeholder="Escreva uma nota e pressione Enter para salvar..."
                  rows={3}
                  className="w-full p-2 rounded-lg text-xs outline-none resize-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
                />
                <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>Pressione Enter para adicionar nota</p>
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

      {/* New Funnel Modal */}
      {showNewFunnel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewFunnel(false)}>
          <div className="rounded-xl p-5 w-72" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>Novo Funil</h3>
            <input
              type="text"
              value={newFunnelName}
              onChange={(e) => setNewFunnelName(e.target.value)}
              placeholder="Nome do funil"
              className="w-full p-2 rounded-lg text-xs mb-3 outline-none"
              style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setShowNewFunnel(false)}
                className="flex-1 p-2 rounded-lg text-xs"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                Cancelar
              </button>
              <button onClick={() => { if (newFunnelName.trim()) { createFunnelMut.mutate({ name: newFunnelName.trim() }); setShowNewFunnel(false); setNewFunnelName(""); } }}
                className="flex-1 p-2 rounded-lg text-xs font-medium"
                style={{ background: curChannel.color, color: "#fff" }}>
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Stage Modal — cria etapa SEMPRE no funil atualmente atribuído ao
          contato, pra manter coerência. Se o contato não tem funil, o botão
          "+ Nova" nem fica habilitado. */}
      {showNewStage && currentFunnelObj && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewStage(false)}>
          <div className="rounded-xl p-5 w-72" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-1)" }}>Nova Etapa</h3>
            <p className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
              no funil <span style={{ color: "var(--text-2)" }}>{currentFunnelObj.name}</span>
            </p>
            <input
              type="text"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Nome da etapa"
              className="w-full p-2 rounded-lg text-xs mb-3 outline-none"
              style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setShowNewStage(false)}
                className="flex-1 p-2 rounded-lg text-xs"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                Cancelar
              </button>
              <button onClick={() => {
                if (newStageName.trim()) {
                  createStageMut.mutate({ funnelId: currentFunnelObj.id, data: { name: newStageName.trim() } });
                  setShowNewStage(false);
                  setNewStageName("");
                }
              }}
                className="flex-1 p-2 rounded-lg text-xs font-medium"
                style={{ background: curChannel.color, color: "#fff" }}>
                Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
