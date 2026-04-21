"use client";

/**
 * MentionPicker — textarea com autocomplete de "menções" tipadas.
 *
 * Como o usuário usa:
 *  - digita `/` para abrir o menu de categorias (instância, grupo, contato,
 *    tag, jornada) e depois busca dentro da categoria.
 *  - digita `@` para abrir uma busca global (procura em todas as categorias
 *    ao mesmo tempo por nome).
 *
 * Ao escolher um item, injetamos no texto um token no formato
 *   @[Label](type:id)
 * que é facilmente parseável com uma regex. O componente expõe:
 *  - `value`: string raw com os tokens dentro.
 *  - `renderedText`: string com tokens substituídos pelos labels (o que vai
 *    no prompt "humano" exibido no chat).
 *  - `mentions`: array estruturado com os itens referenciados (o backend usa
 *    como hint autoritativo de resolução).
 *
 * Fallback: se o usuário digitar livre, sem menção, o backend continua
 * tentando adivinhar por nome (comportamento atual).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  crmApi,
  groupsApi,
  instancesApi,
  journeysApi,
} from "@/lib/api";
import {
  AtSign,
  GitBranch,
  Hash,
  MessageSquare,
  Route,
  Smartphone,
  Tag as TagIcon,
  User,
  Users,
} from "lucide-react";

export type MentionType =
  | "instance"
  | "group"
  | "contact"
  | "tag"
  | "funnel"
  | "journey";

export interface Mention {
  type: MentionType;
  id: string;
  label: string;
  // extras úteis para o backend (ex: JID cru do grupo)
  meta?: Record<string, string>;
}

export interface MentionPickerHandles {
  /** valor atual com tokens embutidos */
  value: string;
  /** valor renderizado (tokens → labels) — o que vai pro LLM */
  renderedText: string;
  /** menções extraídas do texto */
  mentions: Mention[];
}

interface Props {
  value: string;
  onChange: (v: string, info: MentionPickerHandles) => void;
  onSend: (info: MentionPickerHandles) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
}

// ─── Token parser ────────────────────────────────────────────────────────────

const TOKEN_RE = /@\[([^\]]+)\]\((instance|group|contact|tag|funnel|journey):([A-Za-z0-9_@.\-]+)\)/g;

export function parseMentions(text: string): { mentions: Mention[]; rendered: string } {
  const mentions: Mention[] = [];
  const rendered = text.replace(TOKEN_RE, (_m, label, type, id) => {
    mentions.push({ type: type as MentionType, id, label });
    return label;
  });
  return { mentions, rendered };
}

function tokenFor(type: MentionType, id: string, label: string): string {
  return `@[${label}](${type}:${id})`;
}

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES: {
  type: MentionType;
  slash: string; // atalho digitado após /
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}[] = [
  { type: "instance", slash: "instancia", label: "Instância WhatsApp", icon: Smartphone, color: "#00d46a" },
  { type: "group",    slash: "grupo",     label: "Grupo WhatsApp",     icon: Users,      color: "#60a5fa" },
  { type: "contact",  slash: "contato",   label: "Contato CRM",        icon: User,       color: "#a78bfa" },
  { type: "tag",      slash: "tag",       label: "Tag",                icon: TagIcon,    color: "#f59e0b" },
  { type: "funnel",   slash: "funil",     label: "Funil",              icon: GitBranch,  color: "#ec4899" },
  { type: "journey",  slash: "jornada",   label: "Jornada",            icon: Route,      color: "#22d3ee" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function MentionPicker({
  value, onChange, onSend, onKeyDown, placeholder, disabled, isLoading,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<
    | { open: false }
    | { open: true; mode: "category" | "search"; category?: MentionType; triggerPos: number; query: string }
  >({ open: false });
  const [highlight, setHighlight] = useState(0);

  const { mentions, rendered } = useMemo(() => parseMentions(value), [value]);

  // Autosize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);

  // ─── Data fetching (por categoria; habilitado on demand) ────────────────────
  const mentionedInstanceId = mentions.find((m) => m.type === "instance")?.id;

  const { data: instances = [] } = useQuery<any[]>({
    queryKey: ["mention", "instances"],
    queryFn: async () => (await instancesApi.list()).data ?? [],
    enabled: picker.open && (picker.category === "instance" || picker.mode === "search"),
    staleTime: 60_000,
  });
  const { data: groupsData } = useQuery<any>({
    queryKey: ["mention", "groups", mentionedInstanceId ?? "any"],
    queryFn: async () => {
      if (mentionedInstanceId) return (await groupsApi.list(mentionedInstanceId)).data;
      return null;
    },
    enabled: picker.open && (picker.category === "group" || picker.mode === "search") && !!mentionedInstanceId,
    staleTime: 30_000,
  });
  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["mention", "contacts"],
    queryFn: async () => (await crmApi.listContacts({ limit: 100 })).data?.data ?? [],
    enabled: picker.open && (picker.category === "contact" || picker.mode === "search"),
    staleTime: 60_000,
  });
  const { data: tags = [] } = useQuery<any[]>({
    queryKey: ["mention", "tags"],
    queryFn: async () => (await crmApi.listTags()).data ?? [],
    enabled: picker.open && (picker.category === "tag" || picker.mode === "search"),
    staleTime: 60_000,
  });
  const { data: funnels = [] } = useQuery<any[]>({
    queryKey: ["mention", "funnels"],
    queryFn: async () => (await crmApi.listFunnels()).data ?? [],
    enabled: picker.open && (picker.category === "funnel" || picker.mode === "search"),
    staleTime: 60_000,
  });
  const { data: journeys = [] } = useQuery<any[]>({
    queryKey: ["mention", "journeys"],
    queryFn: async () => (await journeysApi.list()).data ?? [],
    enabled: picker.open && (picker.category === "journey" || picker.mode === "search"),
    staleTime: 30_000,
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const groupItems: { type: MentionType; id: string; label: string; meta?: Record<string, string> }[] =
    Array.isArray(groupsData?.groups)
      ? groupsData.groups.map((g: any) => ({ type: "group", id: g.jid, label: g.name || g.subject || g.jid, meta: { jid: g.jid } }))
      : [];

  const allItems = useMemo(() => ({
    instance: instances.map((i: any) => ({ type: "instance" as MentionType, id: i.id, label: i.name || i.phone_number || "(sem nome)" })),
    group:    groupItems,
    contact:  contacts.map((c: any) => ({ type: "contact" as MentionType, id: c.id, label: c.name || c.phone, meta: { phone: c.phone } })),
    tag:      tags.map((t: any) => ({ type: "tag" as MentionType, id: t.id, label: t.name })),
    funnel:   funnels.map((f: any) => ({ type: "funnel" as MentionType, id: f.id, label: f.name })),
    journey:  journeys.map((j: any) => ({ type: "journey" as MentionType, id: j.id, label: j.name })),
  }), [instances, groupItems, contacts, tags, funnels, journeys]);

  // ─── Filter items based on current picker query ─────────────────────────
  type Suggestion = {
    type: MentionType;
    id: string;
    label: string;
    meta?: Record<string, string>;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    color: string;
  };
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!picker.open) return [];
    const q = picker.query.toLowerCase();
    const matchesQuery = (label: string) => !q || label.toLowerCase().includes(q);

    if (picker.mode === "category") {
      return CATEGORIES.filter((c) => !q || c.slash.includes(q) || c.label.toLowerCase().includes(q))
        .map<Suggestion>((c) => ({ type: c.type, id: `__cat__:${c.type}`, label: c.label, icon: c.icon, color: c.color }));
    }

    const categoryMeta = (t: MentionType) => CATEGORIES.find((c) => c.type === t)!;

    if (picker.mode === "search") {
      if (picker.category) {
        const list = allItems[picker.category] ?? [];
        const meta = categoryMeta(picker.category);
        return list.filter((i) => matchesQuery(i.label)).slice(0, 8).map((i) => ({ ...i, icon: meta.icon, color: meta.color }));
      }
      // global search (@): mistura tudo
      const buckets: (MentionType)[] = ["instance", "group", "contact", "tag", "funnel", "journey"];
      const out: { type: MentionType; id: string; label: string; meta?: Record<string, string>; icon: any; color: string }[] = [];
      for (const t of buckets) {
        const meta = categoryMeta(t);
        const list = allItems[t] ?? [];
        for (const i of list) {
          if (matchesQuery(i.label)) out.push({ ...i, icon: meta.icon, color: meta.color });
          if (out.length >= 8) return out;
        }
      }
      return out;
    }
    return [];
  }, [picker, allItems]);

  // Discriminated union: só acessa campos internos quando aberto.
  const pickerMode = picker.open ? picker.mode : null;
  const pickerCategory = picker.open ? picker.category : null;
  const pickerQuery = picker.open ? picker.query : "";
  useEffect(() => { setHighlight(0); }, [picker.open, pickerMode, pickerCategory, pickerQuery]);

  // ─── Input handling ─────────────────────────────────────────────────────

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const cursor = e.target.selectionStart ?? next.length;
    updatePickerFromCursor(next, cursor);
    emitChange(next);
  };

  const updatePickerFromCursor = (text: string, cursor: number) => {
    // olha os últimos caracteres antes do cursor até um whitespace/início
    const before = text.slice(0, cursor);
    const triggerMatch = /(?:^|\s)([/@])([\w\-áéíóúâêôãõç]*)$/i.exec(before);
    if (!triggerMatch) {
      if (picker.open) setPicker({ open: false });
      return;
    }
    const [, trig, q] = triggerMatch;
    const triggerPos = before.length - (trig.length + q.length);

    if (trig === "/") {
      // pode ser modo categoria (sem "/" pick ainda) OU modo search após escolher
      setPicker((prev) => {
        if (prev.open && prev.mode === "search" && prev.category) {
          return { ...prev, query: q, triggerPos };
        }
        return { open: true, mode: "category", triggerPos, query: q.toLowerCase() };
      });
    } else {
      // '@' busca global
      setPicker({ open: true, mode: "search", triggerPos, query: q });
    }
  };

  const emitChange = (next: string) => {
    const info = parseMentions(next);
    onChange(next, { value: next, renderedText: info.rendered, mentions: info.mentions });
  };

  const applySuggestion = useCallback((
    item: { type: MentionType; id: string; label: string; meta?: Record<string, string> } | null
  ) => {
    if (!picker.open || !item) return;
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);

    // categoria: não injeta token, só muda modo pra search
    if (picker.mode === "category") {
      setPicker({ open: true, mode: "search", category: item.type, triggerPos: picker.triggerPos, query: "" });
      // remove o fragmento "/catquery" e deixa só o "/" como âncora? Simplificamos: apaga o trecho digitado desde trigger e deixa cursor lá.
      const newText = before.slice(0, picker.triggerPos) + after;
      emitChange(newText);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(picker.triggerPos, picker.triggerPos);
      });
      return;
    }

    // insere o token
    const token = tokenFor(item.type, item.id, item.label);
    const newText = before.slice(0, picker.triggerPos) + token + " " + after;
    const caret = (before.slice(0, picker.triggerPos) + token + " ").length;
    emitChange(newText);
    setPicker({ open: false });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, [picker, value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker.open && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions[highlight];
        applySuggestion(s ? { type: s.type, id: s.id, label: s.label, meta: s.meta } : null);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setPicker({ open: false }); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const info = parseMentions(value);
      if (value.trim() && !disabled && !isLoading) {
        onSend({ value, renderedText: info.rendered, mentions: info.mentions });
      }
      return;
    }
    onKeyDown?.(e);
  };

  const handleSend = () => {
    const info = parseMentions(value);
    if (!value.trim() || disabled || isLoading) return;
    onSend({ value, renderedText: info.rendered, mentions: info.mentions });
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  const canSend = !!value.trim() && !disabled;

  return (
    <div className="px-6 pb-5 pt-3 relative">
      <div
        className="flex items-end gap-2 rounded-2xl px-4 py-3 relative"
        style={{
          background: isLoading ? "rgba(0,212,106,0.08)" : "var(--surface-3)",
          border: `1px solid ${isLoading ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
          transition: "all 0.2s ease",
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={(e) => {
            const el = e.currentTarget;
            updatePickerFromCursor(el.value, el.selectionStart ?? 0);
          }}
          placeholder={placeholder || "Digite / para mencionar instância, grupo, contato, tag, funil ou jornada…"}
          disabled={disabled || isLoading}
          rows={1}
          className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed py-0.5"
          style={{ color: "var(--text-1)", maxHeight: "180px", opacity: isLoading ? 0.6 : 1 }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend || isLoading}
          className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
          style={{
            background: canSend && !isLoading ? "var(--green)" : "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            opacity: canSend && !isLoading ? 1 : 0.5,
          }}
          title="Enviar (Enter)"
        >
          <MessageSquare className="w-4 h-4" style={{ color: canSend ? "white" : "var(--text-3)" }} />
        </button>
      </div>

      {/* Picker dropdown */}
      {picker.open && suggestions.length > 0 && (
        <div
          className="absolute left-6 right-6 bottom-full mb-2 rounded-xl overflow-hidden shadow-2xl z-20"
          style={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 16%)" }}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider flex items-center gap-1.5"
            style={{ color: "hsl(240 8% 48%)", borderBottom: "1px solid hsl(240 12% 14%)" }}>
            {picker.mode === "category" ? (
              <><Hash className="w-3 h-3" /> Categoria</>
            ) : picker.category ? (
              <><Hash className="w-3 h-3" /> {CATEGORIES.find((c) => c.type === picker.category)?.label}</>
            ) : (
              <><AtSign className="w-3 h-3" /> Busca global</>
            )}
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {suggestions.map((s, idx) => {
              const Icon = s.icon;
              const active = idx === highlight;
              return (
                <li key={`${s.type}-${s.id}`}>
                  <button
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => applySuggestion({ type: s.type, id: s.id, label: s.label, meta: s.meta })}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ background: active ? "rgba(255,255,255,0.04)" : "transparent" }}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: s.color }} />
                    <span className="flex-1 text-sm truncate" style={{ color: "hsl(240 15% 90%)" }}>{s.label}</span>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: "hsl(240 8% 42%)" }}>
                      {s.type}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-center text-xs mt-2" style={{ color: "var(--text-3)" }}>
        {isLoading ? (
          <span style={{ color: "var(--green)" }}>Aguarde, processando…</span>
        ) : (
          <>Enter envia · Shift+Enter quebra linha · <b>/</b> categoria · <b>@</b> busca global</>
        )}
      </p>

      {/* Debug: mostra menções ativas (útil durante rollout). Mantém silencioso se nenhuma. */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 px-2">
          {mentions.map((m, i) => {
            const meta = CATEGORIES.find((c) => c.type === m.type);
            const Icon = meta?.icon ?? Hash;
            return (
              <span key={`${m.type}-${m.id}-${i}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{ background: (meta?.color ?? "#64748b") + "22", color: meta?.color ?? "#64748b" }}>
                <Icon className="w-2.5 h-2.5" />
                {m.label}
              </span>
            );
          })}
        </div>
      )}

      {/* renderedText mantém-se acessível via onChange; não precisa de UI aqui */}
      {!rendered && null}
    </div>
  );
}

export default MentionPicker;
