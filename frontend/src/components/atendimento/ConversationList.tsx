"use client";

import Link from "next/link";
import { MessageCircle, Users as UsersIcon, UserCheck } from "lucide-react";

export interface ConversationRow {
  id: string;
  status: string;
  priority: string;
  channel_type: string;
  channel_key?: string;
  /** Instance UUID — usada pra resolver o nome da instância no chip da lista. */
  instance_id?: string;
  subject?: string;
  last_message_preview?: string;
  last_message_at?: string;
  last_message_type?: string;
  unread_count: number;
  agent_unread_count: number;
  assigned_user_id?: string | null;
  contact?: { name: string; avatar_url?: string; phone?: string } | null;
  last_message_from_me?: boolean;
}

// isGroupChannelKey — true quando o channel_key parece um grupo do WhatsApp
// (sufixos @g.us / -g.us / "group:" etc). Detecta sem precisar de coluna
// extra no DB.
function isGroupChannelKey(key?: string): boolean {
  if (!key) return false;
  const k = key.toLowerCase();
  return (
    k.endsWith("@g.us") ||
    k.endsWith("-g.us") ||
    k.startsWith("group:") ||
    /^\d+-\d+@/.test(k) // padrão típico: 123-456789@s.whatsapp.net (grupos legacy)
  );
}

// isNewsletterChannelKey — true quando JID/key indica canal/newsletter
// (WhatsApp Channels). Detecta múltiplos formatos que vimos na prática:
//   @newsletter, @broadcast, @broadcast.whatsapp.net, prefixo "newsletter:"
function isNewsletterChannelKey(key?: string): boolean {
  if (!key) return false;
  const k = key.toLowerCase();
  return (
    k.endsWith("@newsletter") ||
    k.endsWith("@broadcast") ||
    k.includes("@broadcast.") ||
    k.startsWith("newsletter:") ||
    k.startsWith("channel:")
  );
}

// Formata número internacional pra exibição amigável.
// 5511999999999 → +55 (11) 99999-9999  /  +1 999 999 9999
function formatPhoneNumber(num: string): string {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 8) return num;
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const half = rest.length === 9 ? 5 : 4;
    return `+55 (${ddd}) ${rest.slice(0, half)}-${rest.slice(half)}`;
  }
  if (digits.startsWith("1") && digits.length === 11) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return `+${digits}`;
}

// Formata o channel_key de um chat sem nome conhecido pra display amigável.
function formatChannelKey(key?: string): string {
  if (!key) return "Contato sem nome";
  if (isNewsletterChannelKey(key)) return "📢 Canal";
  const num = key.split("@")[0]?.split(":").pop() || "";
  if (/^\d{8,15}$/.test(num)) return formatPhoneNumber(num);
  return key.length > 30 ? key.slice(0, 28) + "…" : key;
}

// initialsOf — pega 1-2 letras pro avatar fallback
function initialsOf(name?: string, channelKey?: string): string {
  const source = (name || channelKey || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return "?";
}

// Avatar — round image se contact.avatar_url existe; senão fallback letra(s)
// com cor estável a partir do nome (hash → hue). Grupos viram um ícone
// específico pra deixar claro que não é 1:1.
function Avatar({
  src,
  name,
  channelKey,
  isGroup,
  size = 40,
}: {
  src?: string;
  name?: string;
  channelKey?: string;
  isGroup?: boolean;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "avatar"}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, background: "var(--surface-2)" }}
        onError={(e) => {
          // Fallback se imagem 404 — esconde e deixa o sibling render
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (isGroup) {
    return (
      <div
        className="flex items-center justify-center rounded-full flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: "rgba(167,139,250,0.12)",
          border: "1px solid rgba(167,139,250,0.25)",
          color: "#c4b5fd",
        }}
      >
        <UsersIcon style={{ width: size * 0.45, height: size * 0.45 }} />
      </div>
    );
  }
  // Hue determinística (hash do nome) → cor consistente entre renders
  const text = (name || channelKey || "?");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className="flex items-center justify-center rounded-full font-medium flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 50% 22%)`,
        color: `hsl(${hue} 70% 75%)`,
        fontSize: size * 0.4,
      }}
    >
      {initialsOf(name, channelKey)}
    </div>
  );
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  open: { label: "Aberto", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  pending: { label: "Pendente", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  snoozed: { label: "Soneca", cls: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400" },
  resolved: { label: "Resolvido", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  closed: { label: "Encerrado", cls: "bg-zinc-500/10 text-zinc-500" },
};

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-zinc-400",
  normal: "bg-blue-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

// formatPreview — converte last_message_preview pro display amigável.
// Backend pode estar gravando JSON cru de mídia ({"url":...,"caption":...,"media_key":...}).
// Extraímos texto/caption ou caímos pra label do tipo.
export function formatPreview(raw?: string, type?: string, isFromMe?: boolean): string {
  void isFromMe;
  if (!raw) return "—";
  // Se começa com { tenta JSON
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const cap = typeof obj.caption === "string" ? obj.caption : "";
      const text = typeof obj.text === "string" ? obj.text : "";
      const body = (cap || text).trim();
      if (body) return body;
      const t = (type || (typeof obj.type === "string" ? obj.type : "") || "").toLowerCase();
      return labelForType(t);
    } catch {
      return raw;
    }
  }
  // JSON-encoded string ("oi") — desempacota
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const unwrap = JSON.parse(raw);
      if (typeof unwrap === "string") return unwrap || "—";
    } catch { /* fall through */ }
  }
  return raw;
}

function labelForType(t: string): string {
  switch (t) {
    case "image": return "📷 Imagem";
    case "video": return "🎬 Vídeo";
    case "audio": return "🔊 Áudio";
    case "document": return "📄 Documento";
    case "sticker": return "😊 Sticker";
    case "location": case "live_location": return "📍 Localização";
    case "contact": case "contacts": return "👤 Contato";
    case "poll": return "📊 Enquete";
    case "call": return "📞 Chamada";
    case "reaction": return "😀 Reação";
    case "buttons": case "interactive": return "🎯 Botões";
    case "list": return "📋 Lista";
    case "revoke": return "🚫 Apagada";
    default: return "Mensagem";
  }
}

export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return "agora";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}min`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function ConversationList({
  items,
  isLoading,
  emptyLabel = "Nenhum atendimento por aqui.",
  actionLabel,
  onAction,
  selectedId,
  getHref,
  density = "comfortable",
  instanceLabel,
  showInstanceChip,
}: {
  items: ConversationRow[];
  isLoading?: boolean;
  emptyLabel?: string;
  /** Text for the inline action button (e.g. "Atender"). When provided, clicking it does NOT navigate. */
  actionLabel?: string;
  onAction?: (conv: ConversationRow) => void;
  /** Highlighted row — used by the split inbox to mark the open conversation. */
  selectedId?: string;
  /** Customizable link target so the same list works with /inbox/:id and /inbox?c=:id. */
  getHref?: (conv: ConversationRow) => string;
  /** `compact` reduz o padding quando a lista fica na coluna estreita do split. */
  density?: "comfortable" | "compact";
  /** Map de instance_id → label amigável pra resolver o nome da instância no chip. */
  instanceLabel?: (instanceId?: string) => string | undefined;
  /** Mostra o chip da instância em cada linha — usado quando o filtro inclui
   *  mais de uma instância (ou nenhuma seleção, "todas"). */
  showInstanceChip?: boolean;
}) {
  if (isLoading) {
    return (
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {[...Array(5)].map((_, i) => (
          <li key={i} className="flex gap-4 px-6 py-4">
            <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-zinc-500">
        <MessageCircle className="h-10 w-10 opacity-30" />
        <p className="text-sm">{emptyLabel}</p>
      </div>
    );
  }

  const isCompact = density === "compact";
  const pad = isCompact ? "px-3 py-2.5" : "px-6 py-4";
  const avatarSize = isCompact ? 38 : 44;

  return (
    <ul>
      {items.map((conv) => {
        const status = STATUS_STYLES[conv.status] ?? STATUS_STYLES.open;
        const isSelected = selectedId === conv.id;
        const isGroup = isGroupChannelKey(conv.channel_key);
        const isNewsletter = isNewsletterChannelKey(conv.channel_key);
        const href = getHref ? getHref(conv) : `/inbox/${conv.id}`;
        // Prioridade: nome do contato → subject → JID formatado (newsletter
        // vira 📢 Canal, número vira +55 11 ...). Antes mostrava JID cru
        // tipo 5511...@s.whatsapp.net quando não tinha contato cadastrado.
        // Cascade pra resolver nome legível:
        //   1. nome do contato (CRM)
        //   2. subject da conversa (set pelo backend ao criar)
        //   3. telefone formatado (se contato existe sem nome)
        //   4. JID formatado (último recurso)
        // Trim previne string só com espaços passando como "nome válido".
        const contactName = conv.contact?.name?.trim();
        const subject = conv.subject?.trim();
        const contactPhone = conv.contact?.phone?.trim();
        const baseName =
          contactName ||
          subject ||
          (contactPhone ? formatPhoneNumber(contactPhone) : "") ||
          formatChannelKey(conv.channel_key);
        // Newsletter sempre prefixado com 📢 pra diferenciar visualmente
        const displayName = isNewsletter && !baseName.startsWith("📢")
          ? `📢 ${baseName}`
          : baseName;
        const hasUnread = conv.agent_unread_count > 0;
        const rowInner = (
          <div
            className={`flex items-start gap-3 transition ${pad}`}
            style={
              isSelected
                ? {
                    background: "rgba(0,212,106,0.06)",
                    borderLeft: "2px solid #00d46a",
                    paddingLeft: isCompact ? 10 : 22,
                  }
                : {
                    borderLeft: "2px solid transparent",
                  }
            }
          >
            {/* Avatar + priority dot sobreposto */}
            <div className="relative flex-shrink-0">
              <Avatar
                src={conv.contact?.avatar_url}
                name={conv.contact?.name}
                channelKey={conv.channel_key}
                isGroup={isGroup}
                size={avatarSize}
              />
              {/* priority dot só pra prioridades acima de normal */}
              {conv.priority && conv.priority !== "normal" && conv.priority !== "low" && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[hsl(240_18%_5%)] ${
                    PRIORITY_DOT[conv.priority] ?? PRIORITY_DOT.normal
                  }`}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-sm flex items-center gap-1.5"
                  style={{
                    color: hasUnread ? "hsl(240 15% 95%)" : "hsl(240 15% 90%)",
                    fontWeight: hasUnread ? 600 : 500,
                  }}
                >
                  {isGroup && (
                    <UsersIcon className="h-3 w-3 flex-shrink-0" style={{ color: "#a78bfa" }} />
                  )}
                  <span className="truncate">{displayName}</span>
                </span>
                <time
                  className="flex-shrink-0 text-[10px]"
                  style={{
                    color: hasUnread ? "#00d46a" : "hsl(240 8% 44%)",
                    fontWeight: hasUnread ? 600 : 400,
                  }}
                >
                  {relativeTime(conv.last_message_at)}
                </time>
              </div>
              <p
                className="mt-0.5 line-clamp-1 text-xs"
                style={{
                  color: hasUnread ? "hsl(240 15% 75%)" : "hsl(240 8% 52%)",
                  fontWeight: hasUnread ? 500 : 400,
                }}
              >
                {conv.last_message_from_me && (
                  <span style={{ color: "hsl(240 8% 42%)" }}>Você: </span>
                )}
                {formatPreview(conv.last_message_preview, conv.last_message_type, conv.last_message_from_me)}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.cls}`}>
                  {status.label}
                </span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    background: "var(--surface-2)",
                    color: "hsl(240 8% 58%)",
                  }}
                >
                  {conv.channel_type}
                </span>
                {showInstanceChip && instanceLabel && instanceLabel(conv.instance_id) && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium truncate max-w-[120px]"
                    style={{
                      background: "rgba(0,212,106,0.08)",
                      color: "#00d46a",
                      border: "1px solid rgba(0,212,106,0.18)",
                    }}
                    title={instanceLabel(conv.instance_id)}
                  >
                    {instanceLabel(conv.instance_id)}
                  </span>
                )}
                {conv.agent_unread_count > 0 && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ background: "#ef4444", color: "white" }}
                  >
                    {conv.agent_unread_count}
                  </span>
                )}
              </div>
            </div>
            {actionLabel && onAction && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAction(conv);
                }}
                title={actionLabel}
                aria-label={actionLabel}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors"
                style={{
                  background: "transparent",
                  color: "#00d46a",
                  border: "1px solid rgba(0,212,106,0.3)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,212,106,0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <UserCheck className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
        return (
          <li
            key={conv.id}
            style={{
              borderBottom: "1px solid var(--border-default)",
            }}
            className="hover:bg-white/5"
          >
            <Link href={href} className="block" scroll={false}>
              {rowInner}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
