"use client";

// Multi-conversa estilo Claude/GPT — persiste em localStorage.
// Migra automaticamente o histórico mono-conversa antigo (chave
// `agents_chat_history`) para a primeira conversa quando o usuário
// abre o /uniq-ai pela primeira vez no novo modelo.

import type { Message } from "./atoms";

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "uniqai_conversations";
const ACTIVE_KEY = "uniqai_active_conversation";
const LEGACY_KEY = "agents_chat_history";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  const list = safeParse<Conversation[]>(localStorage.getItem(STORAGE_KEY), []);
  return list.map((c) => ({
    ...c,
    messages: c.messages.map((m: any) => ({ ...m, createdAt: m.createdAt ? new Date(m.createdAt) : undefined })),
  }));
}

export function saveConversations(list: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getActiveId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

// Title heurístico: primeira frase da primeira mensagem do user, capada.
export function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Nova conversa";
  const text = firstUser.content.replace(/\n+/g, " ").trim();
  if (text.length <= 48) return text || "Nova conversa";
  return text.slice(0, 45) + "…";
}

export function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "Nova conversa",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Migra o storage antigo (mono-conversa) na primeira execução do novo
// modelo. Importa as mensagens do `agents_chat_history` como uma
// conversa "Histórico anterior" e remove a chave legada.
export function migrateLegacyIfNeeded(): Conversation[] | null {
  if (typeof window === "undefined") return null;
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return null; // já migrado
  const legacy = safeParse<any[]>(localStorage.getItem(LEGACY_KEY), []);
  if (!legacy.length) return null;
  const messages: Message[] = legacy.map((m: any) => ({
    id: m.id || crypto.randomUUID(),
    role: m.role,
    content: m.content,
    createdAt: m.createdAt ? new Date(m.createdAt) : undefined,
  }));
  const now = Date.now();
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title: deriveTitle(messages) || "Histórico anterior",
    messages,
    createdAt: now,
    updatedAt: now,
  };
  saveConversations([conv]);
  setActiveId(conv.id);
  localStorage.removeItem(LEGACY_KEY);
  return [conv];
}
