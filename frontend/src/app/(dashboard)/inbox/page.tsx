"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Send, Check, CheckCheck, Image, Mic, FileText, MapPin,
  Users, Phone, Video, MessageSquare, User, Archive, Trash2, Star,
  MoreHorizontal, ChevronRight, Filter, EyeOff, Pin, Tag, BellOff
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

function fmtTime(d: string) {
  if (!d) return "";
  const date = new Date(d);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function MsgTime(ts: number) {
  const date = new Date(ts * 1000);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function MsgBody({ msg }: { msg: ChatMessage }) {
  let t = msg.content;
  try { if (t?.startsWith('"') && t?.endsWith('"')) t = JSON.parse(t); } catch {}
  if (msg.type === "reaction") return <span className="text-lg">{t || "👍"}</span>;
  const icons: Record<string, React.ReactNode> = {
    image: <Image className="w-3.5 h-3.5" />, audio: <Mic className="w-3.5 h-3.5" />,
    document: <FileText className="w-3.5 h-3.5" />, location: <MapPin className="w-3.5 h-3.5" />,
  };
  if (icons[msg.type]) return <span className="flex items-center gap-1.5 opacity-80">{icons[msg.type]}<span>{t}</span></span>;
  return <span>{t}</span>;
}

export default function InboxPage() {
  const { currentWorkspace } = useWorkspace();
  const qc = useQueryClient();

  const [channels, setChannels] = useState<ChannelType[]>(["whatsapp"]);
  const [instance, setInstance] = useState("");
  const [chat, setChat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showFilters, setShowFilters] = useState(true);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number; y: number; jid: string } | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [contactNotes, setContactNotes] = useState("");
  const [contactOwner, setContactOwner] = useState("");
  const [contactStage, setContactStage] = useState("");
  const [newTag, setNewTag] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);

  const { data: instData = [] } = useQuery<Instance[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then(r => r.data),
  });

  const chInst = instData.filter(i => channels.includes(i.channel as ChannelType) && i.status === "connected");
  const chAvail = CHANNELS.filter(c => instData.some(i => i.channel === c.id && i.status === "connected"));
  const cur = CHANNELS.find(c => c.id === channels[0]) || CHANNELS[0];

  useEffect(() => {
    if (chInst.length > 0 && !chInst.find(i => i.id === instance)) { setInstance(chInst[0].id); setChat(null); }
  }, [channels, chInst]);

  useEffect(() => {
    if (chAvail.length > 0 && !chAvail.find(c => channels.includes(c.id))) setChannels([chAvail[0].id]);
  }, [chAvail]);

  const { data: chatsD } = useQuery({
    queryKey: ["chats", instance, search, filter],
    enabled: !!instance,
    refetchInterval: 3000,
    queryFn: async () => {
      try { return (await inboxApi.getChats(instance, search, filter)).data; }
      catch { return { chats: [] }; }
    }
  });

  const { data: msgsD } = useQuery({
    queryKey: ["msgs", instance, chat],
    enabled: !!instance && !!chat,
    refetchInterval: 2000,
    queryFn: async () => {
      try { return (await inboxApi.getMessages(instance, chat)).data; }
      catch { return { messages: [] }; }
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

  const sendMut = useMutation({
    mutationFn: (content: string) => inboxApi.sendMessage(instance, chat!, { content, type: "text" }),
    onSuccess: () => { setInput(""); qc.invalidateQueries({ queryKey: ["msgs", instance, chat] }); qc.invalidateQueries({ queryKey: ["chats", instance] }); inpRef.current?.focus(); },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro"),
  });

  const readMut = useMutation({
    mutationFn: () => inboxApi.markRead(instance, chat!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats", instance] }),
  });

  const updateMessageMut = useMutation({
    mutationFn: (data: { is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean }) => 
      inboxApi.updateMessage(instance, selectedMsgId || selectedMessages[0] || "", data),
    onSuccess: () => { 
      toast.success("Mensagem atualizada!");
      qc.invalidateQueries({ queryKey: ["msgs", instance, chat] });
      qc.invalidateQueries({ queryKey: ["chats", instance] });
      setSelectedMessages([]);
      setSelectedMsgId(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro"),
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

  const handleMsgAction = (action: string) => {
    setSelectedMsgId(null);
    switch (action) {
      case "star":
        updateMessageMut.mutate({ is_favorite: true });
        break;
      case "pin":
        updateMessageMut.mutate({ is_pinned: true });
        break;
      case "delete":
        updateMessageMut.mutate({ is_deleted: true });
        break;
      case "archive":
        updateMessageMut.mutate({ is_archived: true });
        break;
    }
  };

  useEffect(() => { if (chat) readMut.mutate(); }, [chat]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgsD]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setChatContextMenu(null);
    if (chatContextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [chatContextMenu]);

  // Close message menu on click outside
  useEffect(() => {
    const handleClick = () => setSelectedMsgId(null);
    if (selectedMsgId) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [selectedMsgId]);

  const list: ChatContact[] = chatsD?.chats || [];
  const msgs: ChatMessage[] = msgsD?.messages || [];
  const ct: ContactInfo = contactD?.contact || { jid: chat || "", name: chat?.split("@")[0] || "", phone: chat || "", tags: [], notes: "" };

  // Update contact sidebar state when contact data changes
  useEffect(() => {
    if (contactD?.contact) {
      setContactNotes(contactD.contact.notes || "");
      setContactOwner(contactD.contact.owner || "");
      setContactStage(contactD.contact.stage || "");
    }
  }, [contactD]);

  const handleAction = (action: string) => {
    setShowChatMenu(false);
    if (!chat) return;
    const phone = chat.split("@")[0];
    const currentContact = list.find(c => c.jid === chat);
    const name = currentContact?.name || phone;
    
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/crm/contacts/search`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ 
        phone,
        instance_id: instance,
        name,
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

  const curChannel = CHANNELS.find(c => c.id === channels[0]) || CHANNELS[0];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3" style={{ color: "var(--text-1)" }}>
          <MessageSquare className="w-6 h-6" style={{ color: curChannel.color }} />
          Inbox
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
          Gerencie todas as suas conversas em um só lugar.
        </p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* ═══ SUBMENU SIDEBAR (icons only) ═══ */}
        <aside className="w-16 flex-shrink-0">
          <nav className="rounded-2xl overflow-hidden flex flex-col items-center py-3 gap-1" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            {CHANNELS.map(ch => {
              const isActive = channels.includes(ch.id);
              const isConnected = instData.some((inst: Instance) => inst.channel === ch.id && inst.status === "connected");
              return (
                <button
                  key={ch.id}
                  onClick={() => {
                    if (!isConnected) return;
                    if (isActive && channels.length > 1) {
                      setChannels(channels.filter(c => c !== ch.id));
                    } else if (!isActive) {
                      setChannels([...channels, ch.id]);
                    }
                  }}
                  className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-all relative",
                    isConnected ? "cursor-pointer hover:opacity-80" : "cursor-default opacity-40")}
                  style={{
                    background: isActive ? `${ch.color}20` : "var(--surface-3)",
                    border: `1px solid ${isActive ? ch.color + "50" : "transparent"}`,
                  }}
                  title={isConnected ? ch.label : `${ch.label} (desconectado)`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r" style={{ background: ch.color }} />
                  )}
                  <span className="text-[10px] font-bold" style={{ color: isActive ? ch.color : isConnected ? "var(--text-3)" : "var(--text-3)" }}>
                    {ch.label.slice(0, 2)}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ═══ MAIN INBOX AREA ═══ */}
        <div className="flex-1 min-h-0 rounded-2xl overflow-hidden" style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          <div className="h-full flex">
            {/* Conversations List */}
            <div className="w-[207px] min-w-[207px] max-w-[207px] flex-shrink-0 flex flex-col border-r min-w-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
              {/* Search & Filter */}
              <div className="p-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg text-xs outline-none"
                      style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }} />
                  </div>
                  <button onClick={() => setShowFilters(!showFilters)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: showFilters ? `${curChannel.color}20` : "var(--surface-3)", color: showFilters ? curChannel.color : "var(--text-3)" }}>
                    <Filter className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Filter tabs */}
                {showFilters && (
                  <div className="flex flex-wrap gap-1">
                    {([
                      { id: "all" as FilterType, label: "Todos", icon: MessageSquare },
                      { id: "unread" as FilterType, label: "Não lidos", icon: EyeOff },
                      { id: "starred" as FilterType, label: "Favoritos", icon: Star },
                      { id: "archived" as FilterType, label: "Arquivados", icon: Archive },
                    ]).map(f => (
                      <button key={f.id} onClick={() => setFilter(f.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all"
                        style={{ background: filter === f.id ? `${curChannel.color}20` : "var(--surface-3)", color: filter === f.id ? curChannel.color : "var(--text-3)" }}>
                        <f.icon className="w-3 h-3" />
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Instance selector */}
              {chInst.length > 1 && (
                <div className="px-3 py-2 border-b" style={{ borderColor: "var(--surface-border)" }}>
                  <select value={instance} onChange={e => { setInstance(e.target.value); setChat(null); }}
                    className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                    style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}>
                    {chInst.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
              )}

              {/* Chat list */}
              <div className="flex-1 overflow-y-auto">
                {!instance ? (
                  <div className="flex items-center justify-center h-32 text-xs" style={{ color: "var(--text-3)" }}>Selecione instância</div>
                ) : list.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-xs" style={{ color: "var(--text-3)" }}>Sem conversas</div>
                ) : list.map(c => (
                  <button key={c.jid} onClick={() => setChat(c.jid)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setChat(c.jid);
                      setChatContextMenu({ x: e.clientX, y: e.clientY, jid: c.jid });
                    }}
                    className={cn("w-full flex items-center gap-3 px-3 py-3 transition-colors border-b",
                      chat === c.jid ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}
                    style={{ borderColor: "var(--surface-border)" }}>
                    <div className="relative">
                      {c.avatar ? (
                        <img src={c.avatar} className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold"
                          style={{ background: `${curChannel.color}20`, color: curChannel.color }}>
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      {c.is_online && !c.is_group && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2" style={{ background: "#22c55e", borderColor: "var(--surface-2)" }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{c.name}</span>
                        <span className="text-[10px] shrink-0 ml-2" style={{ color: "var(--text-3)" }}>{fmtTime(c.last_time)}</span>
                      </div>
                      <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>{c.last_message || "—"}</p>
                    </div>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ background: curChannel.color, color: "#000" }}>
                        {c.unread_count > 99 ? "99+" : c.unread_count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 min-w-[380px] flex flex-col min-w-0" style={{ background: "var(--surface-1)" }}>
              {!chat ? (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${curChannel.color}12` }}>
                    <MessageSquare className="w-8 h-8" style={{ color: curChannel.color, opacity: 0.5 }} />
                  </div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Selecione uma conversa</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Escolha ao lado para começar</p>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
                    style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
                    <div className="flex items-center gap-4">
                      {ct.avatar ? (
                        <img src={ct.avatar} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                          style={{ background: `${curChannel.color}20`, color: curChannel.color }}>
                          {ct.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{ct.name}</div>
                        <div className="text-xs" style={{ color: "var(--text-3)" }}>{ct.phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5"
                        style={{ color: "var(--text-3)" }}>
                        <Phone className="w-4 h-4" />
                      </button>
                      <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5"
                        style={{ color: "var(--text-3)" }}>
                        <Video className="w-4 h-4" />
                      </button>
                      <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5"
                        style={{ color: "var(--text-3)" }}>
                        <Search className="w-4 h-4" />
                      </button>
                      <div className="relative">
                        <button onClick={() => setShowChatMenu(!showChatMenu)}
                          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5"
                          style={{ color: "var(--text-3)" }}>
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {showChatMenu && (
                          <div className="absolute right-0 top-full mt-1 w-48 rounded-xl shadow-lg z-50 py-1"
                            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                            {[
                              { icon: Star, label: "Favoritar", action: "star" },
                              { icon: Pin, label: "Fixar", action: "pin" },
                              { icon: Archive, label: "Arquivar", action: "archive" },
                              { icon: BellOff, label: "Silenciar", action: "mute" },
                              { icon: Tag, label: "Adicionar tag", action: "tag" },
                              { icon: Trash2, label: "Excluir", action: "delete", color: "#ef4444" },
                            ].map((item, i) => (
                              <button key={i} onClick={() => handleAction(item.action)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5"
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
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {msgs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: `${curChannel.color}10` }}>
                          <MessageSquare className="w-7 h-7" style={{ color: curChannel.color, opacity: 0.5 }} />
                        </div>
                        <p className="text-sm" style={{ color: "var(--text-3)" }}>Sem mensagens ainda</p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Envie uma mensagem para iniciar</p>
                      </div>
                    ) : (
                      msgs.map(m => {
                        const sent = m.from_me;
                        return (
                          <div key={m.id} className={cn("flex", sent ? "justify-end" : "items-start gap-2")}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (!sent) {
                                setSelectedMsgId(m.id);
                              }
                            }}>
                            {!sent && (
                              ct.avatar ? <img src={ct.avatar} className="w-7 h-7 rounded-full object-cover mt-1" />
                              : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold mt-1"
                                  style={{ background: `${curChannel.color}20`, color: curChannel.color }}>
                                  {ct.name.slice(0, 2).toUpperCase()}
                                </div>
                            )}
                            <div className={cn("max-w-[65%]")}>
                              <div className={cn("px-2.5 py-1.5 rounded-xl text-[12px] leading-[1.4]", sent ? "rounded-br-sm" : "rounded-bl-sm")}
                                style={sent
                                  ? { background: curChannel.color, color: "#fff", fontFamily: "system-ui, -apple-system, 'SF Pro Text', sans-serif" }
                                  : { background: "var(--surface-3)", color: "var(--text-1)", fontFamily: "system-ui, -apple-system, 'SF Pro Text', sans-serif" }}>
                                <MsgBody msg={m} />
                              </div>
                              <div className={cn("flex items-center gap-1 mt-0.5", sent ? "justify-end" : "justify-start")}>
                                <span className="text-[10px]" style={{ color: "var(--text-3)" }}>{MsgTime(m.timestamp)}</span>
                                {sent && (
                                  m.status === "read" ? <CheckCheck className="w-3 h-3 text-blue-400" />
                                  : m.status === "delivered" ? <CheckCheck className="w-3 h-3" style={{ color: "var(--text-3)" }} />
                                  : m.status === "sent" ? <Check className="w-3 h-3" style={{ color: "var(--text-3)" }} />
                                  : null
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={endRef} />
                  </div>

                  {/* Input */}
                  <div className="p-3 border-t shrink-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
                    <div className="flex items-center gap-2">
                      <button className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5" style={{ color: "var(--text-3)" }}>
                        <Image className="w-4 h-4" />
                      </button>
                      <div className="flex-1">
                        <input ref={inpRef} value={input} onChange={e => setInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.trim()) sendMut.mutate(input.trim()); } }}
                          placeholder="Mensagem..."
                          className="w-full px-4 py-2 rounded-full text-sm outline-none"
                          style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }} />
                      </div>
                      <button onClick={() => { if (input.trim()) sendMut.mutate(input.trim()); }}
                        disabled={!input.trim() || sendMut.isPending}
                        className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
                        style={{ background: input.trim() ? curChannel.color : "var(--surface-3)", color: input.trim() ? "#fff" : "var(--text-3)" }}>
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Contact Sidebar */}
            <div className="w-[336px] min-w-[336px] max-w-[336px] flex-shrink-0 flex flex-col overflow-y-auto border-l" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
              {!chat ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: "var(--surface-3)" }}>
                    <User className="w-7 h-7" style={{ color: "var(--text-3)", opacity: 0.5 }} />
                  </div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Dados do contato</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Selecione uma conversa</p>
                </div>
              ) : (
                <>
                  {/* Profile */}
                  <div className="p-4 border-b text-center" style={{ borderColor: "var(--surface-border)" }}>
                    {ct.avatar ? (
                      <img src={ct.avatar} className="w-16 h-16 rounded-full mx-auto object-cover" />
                    ) : (
                      <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-lg font-bold"
                        style={{ background: `${curChannel.color}20`, color: curChannel.color }}>
                        {ct.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <h3 className="text-sm font-semibold mt-3" style={{ color: "var(--text-1)" }}>{ct.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{ct.phone}</p>
                    <div className="flex justify-center gap-2 mt-3">
                      {[Phone, Video, MessageSquare].map((I, i) => (
                        <button key={i} className="w-8 h-8 rounded-lg flex items-center justify-center"
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
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                            style={{ background: `${curChannel.color}20`, color: curChannel.color }}>
                            {tag}
                          </span>
                        )) : <span className="text-xs" style={{ color: "var(--text-3)" }}>Nenhuma tag</span>}
                      </div>
                      {ct.contact_id && tagsD?.tags && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {tagsD.tags.map((tag: any) => (
                            <button key={tag.id} onClick={() => {
                              const currentTags = ct.tags || [];
                              const tagNames = tagsD.tags.map((t: any) => t.name);
                              const tagId = tag.id;
                              // Toggle tag - if already has it, remove it, else add it
                              const hasTag = currentTags.includes(tag.name);
                              // Need to get tag IDs
                              const currentTagObjs = tagsD.tags.filter((t: any) => currentTags.includes(t.name));
                              const newTagIds = hasTag 
                                ? currentTagObjs.filter((t: any) => t.id !== tag.id).map((t: any) => t.id)
                                : [...currentTagObjs.map((t: any) => t.id), tagId];
                              assignTagsMut.mutate(newTagIds);
                            }}
                              className="text-[10px] px-2 py-0.5 rounded-full border"
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chat Context Menu */}
      {chatContextMenu && (
        <div 
          className="fixed w-48 rounded-xl shadow-lg z-50 py-1"
          style={{ left: chatContextMenu.x, top: chatContextMenu.y, background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { icon: Star, label: "Favoritar", action: "star" },
            { icon: Pin, label: "Fixar", action: "pin" },
            { icon: Archive, label: "Arquivar", action: "archive" },
            { icon: BellOff, label: "Silenciar", action: "mute" },
            { icon: Trash2, label: "Excluir", action: "delete", color: "#ef4444" },
          ].map((item, i) => (
            <button key={i} onClick={() => { handleAction(item.action); setChatContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5"
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
          className="fixed w-40 rounded-xl shadow-lg z-50 py-1"
          style={{ 
            left: "50%", 
            top: "50%", 
            transform: "translate(-50%, -50%)",
            background: "var(--surface-2)", 
            border: "1px solid var(--surface-border)" 
          }}
        >
          <div className="px-3 py-2 text-xs font-medium border-b" style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}>
            Mensagem
          </div>
          {[
            { icon: Star, label: "Favoritar", action: "star" },
            { icon: Pin, label: "Fixar", action: "pin" },
            { icon: Archive, label: "Arquivar", action: "archive" },
            { icon: Trash2, label: "Excluir", action: "delete", color: "#ef4444" },
          ].map((item, i) => (
            <button key={i} onClick={() => { handleMsgAction(item.action); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5"
              style={{ color: item.color || "var(--text-2)" }}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
          <button onClick={() => setSelectedMsgId(null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5"
            style={{ color: "var(--text-3)" }}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
