"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

export interface ConversationRow {
  id: string;
  status: string;
  priority: string;
  channel_type: string;
  subject?: string;
  last_message_preview?: string;
  last_message_at?: string;
  unread_count: number;
  agent_unread_count: number;
  assigned_user_id?: string | null;
  contact?: { name: string; avatar_url?: string; phone?: string } | null;
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
}: {
  items: ConversationRow[];
  isLoading?: boolean;
  emptyLabel?: string;
  /** Text for the inline action button (e.g. "Atender"). When provided, clicking it does NOT navigate. */
  actionLabel?: string;
  onAction?: (conv: ConversationRow) => void;
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

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((conv) => {
        const status = STATUS_STYLES[conv.status] ?? STATUS_STYLES.open;
        const rowInner = (
          <div className="flex items-start gap-4 px-6 py-4 transition hover:bg-zinc-100 dark:hover:bg-zinc-900/40">
            <div
              className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                PRIORITY_DOT[conv.priority] ?? PRIORITY_DOT.normal
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">
                  {conv.contact?.name || conv.subject || "Contato"}
                </span>
                <time className="flex-shrink-0 text-xs text-zinc-500">
                  {relativeTime(conv.last_message_at)}
                </time>
              </div>
              <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
                {conv.last_message_preview || "—"}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                  {status.label}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {conv.channel_type}
                </span>
                {conv.agent_unread_count > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
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
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {actionLabel}
              </button>
            )}
          </div>
        );
        return (
          <li key={conv.id}>
            <Link href={`/inbox/${conv.id}`} className="block">
              {rowInner}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
