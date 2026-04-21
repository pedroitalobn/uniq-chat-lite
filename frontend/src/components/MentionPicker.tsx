"use client";

/**
 * MentionPicker — editor rich com menções tipadas renderizadas como chips.
 *
 * Substitui o textarea por um `contenteditable` div. Cada menção vira um
 * <span> não-editável com estilo próprio (cor da categoria), tornando o
 * token legível em vez do formato cru `@[label](type:id)`.
 *
 * API externa:
 *  - `value` (string) é o formato canônico serializado (`@[label](type:id)`).
 *    Parent continua controlando igual a um textarea; emitimos no onChange.
 *  - `renderedText` (tokens → labels) e `mentions[]` vêm no payload do
 *    onChange/onSend como antes — zero mudança no agents/page.tsx.
 *
 * Interação:
 *  - Digite `/` no editor → popup abre com categorias.
 *  - Digite `@` → popup abre em busca global.
 *  - Popup tem CAMPO DE BUSCA visível e auto-focado; lista os itens mais
 *    recentes da categoria (limite 8). Setas/Enter/Esc navegam.
 *  - Ao escolher, o trecho `/xxx` ou `@xxx` no editor é substituído por
 *    um chip estilizado e o foco volta pro editor na posição certa.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Layers,
  Route,
  Search as SearchIcon,
  Smartphone,
  Tag as TagIcon,
  Type as TypeIcon,
  User,
  Users,
  Zap,
} from "lucide-react";

export type MentionType =
  // entidades (referência a registros do banco)
  | "instance"
  | "group"
  | "contact"
  | "tag"
  | "funnel"
  | "journey"
  // conceitos do canvas (static — paridade com StepType/TriggerType do backend)
  | "trigger"
  | "step"
  | "keyword"
  // ação composta (tipo de ação + parâmetro inline, ex: responder privado "X")
  | "action";

export interface Mention {
  type: MentionType;
  id: string;
  label: string;
  meta?: Record<string, string>;
}

export interface MentionPickerHandles {
  value: string;
  renderedText: string;
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
  /** Filtra quais categorias aparecem no picker. Default: todas. */
  allowedCategories?: MentionType[];
  /** Steps adicionais (ex: steps existentes do flow atual) que aparecem em /passo. */
  extraSteps?: { type: "step"; id: string; label: string; meta?: Record<string, string> }[];
  /** Se setado, usa como JID da instância para resolver grupos (usado no canvas quando
   * o usuário ainda não mencionou uma instância no texto mas ela está selecionada em outro lugar). */
  defaultInstanceId?: string;
  /** Altura mínima do editor em px. Default 22 (uma linha). */
  minRows?: number;
}

// ─── RichMentionText ─────────────────────────────────────────────────────────
// Renderiza texto com tokens `@[label](type:id)` substituindo cada token por
// um chip estilizado igual ao do editor. Usar no histórico de chat para que a
// mensagem enviada pelo usuário mantenha o destaque visual das menções.
export function RichMentionText({ text, className }: { text: string; className?: string }) {
  const parts: Array<{ kind: "text"; value: string } | { kind: "chip"; type: MentionType; id: string; label: string }> = [];
  let last = 0;
  const re = /@\[([^\]]+)\]\((instance|group|contact|tag|funnel|journey|trigger|step|keyword):([A-Za-z0-9_@.\-]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "chip", label: m[1], type: m[2] as MentionType, id: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });

  if (parts.length === 0) return <span className={className}>{text}</span>;

  return (
    <span className={className} style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.value}</span>;
        const meta = CATEGORIES.find((c) => c.type === p.type);
        const c = meta?.color ?? "#64748b";
        return (
          <span
            key={i}
            title={`${meta?.label ?? p.type}: ${p.label}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "1px 8px",
              margin: "0 1px",
              borderRadius: "6px",
              fontSize: "90%",
              fontWeight: 600,
              background: c + "22",
              color: c,
              border: `1px solid ${c}55`,
            }}
          >
            @{p.label}
          </span>
        );
      })}
    </span>
  );
}

// ─── Token parse/serialize ───────────────────────────────────────────────────
const TOKEN_RE = /@\[([^\]]+)\]\((instance|group|contact|tag|funnel|journey|trigger|step|keyword|action):([A-Za-z0-9_@.\-]+)\)/g;

export function parseMentions(text: string): { mentions: Mention[]; rendered: string } {
  const mentions: Mention[] = [];
  const rendered = text.replace(TOKEN_RE, (_m, label, type, id) => {
    mentions.push({ type: type as MentionType, id, label });
    return label;
  });
  return { mentions, rendered };
}

// ─── Category metadata ───────────────────────────────────────────────────────
const CATEGORIES: {
  type: MentionType;
  slash: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}[] = [
  // Entidades (referência a registro no banco)
  { type: "instance", slash: "instancia", label: "Instância WhatsApp", icon: Smartphone, color: "#00d46a" },
  { type: "group",    slash: "grupo",     label: "Grupo WhatsApp",     icon: Users,      color: "#60a5fa" },
  { type: "contact",  slash: "contato",   label: "Contato CRM",        icon: User,       color: "#a78bfa" },
  { type: "tag",      slash: "tag",       label: "Tag",                icon: TagIcon,    color: "#f59e0b" },
  { type: "funnel",   slash: "funil",     label: "Funil",              icon: GitBranch,  color: "#ec4899" },
  { type: "journey",  slash: "jornada",   label: "Jornada",            icon: Route,      color: "#22d3ee" },
  // Conceitos do canvas (enum estático)
  { type: "trigger",  slash: "gatilho",   label: "Gatilho",            icon: Zap,        color: "#fbbf24" },
  { type: "action",   slash: "acao",      label: "Ação",               icon: Route,      color: "#10b981" },
  { type: "step",     slash: "passo",     label: "Tipo de passo",      icon: Layers,     color: "#94a3b8" },
  { type: "keyword",  slash: "palavra",   label: "Palavra-chave",      icon: TypeIcon,   color: "#ef4444" },
];

// Enums estáticos que o canvas entende. Espelha backend/internal/models/journey.go.
export const TRIGGER_OPTIONS: { id: string; label: string; hint?: string }[] = [
  { id: "any_message",            label: "Qualquer mensagem",      hint: "Dispara em qualquer DM/grupo" },
  { id: "group_keyword",          label: "Palavra-chave no grupo", hint: "Keyword recebida em grupo específico" },
  { id: "group_message",          label: "Mensagem no grupo",      hint: "Qualquer msg num grupo" },
  { id: "group_mention",          label: "Menção no grupo",        hint: "Quando mencionam a instância" },
  { id: "private_keyword",        label: "Palavra-chave privada",  hint: "Keyword em DM" },
  { id: "private_message",        label: "Mensagem privada",       hint: "Qualquer DM" },
  { id: "first_message",          label: "Primeira mensagem",      hint: "Primeira interação do contato" },
  { id: "contact_media_image",    label: "Recebeu imagem",         hint: "Contato enviou imagem" },
  { id: "contact_media_audio",    label: "Recebeu áudio",          hint: "Contato enviou áudio" },
  { id: "contact_media_video",    label: "Recebeu vídeo",          hint: "Contato enviou vídeo" },
  { id: "contact_media_document", label: "Recebeu documento",      hint: "Contato enviou documento" },
  { id: "contact_call",           label: "Ligação recebida" },
  { id: "group_join",             label: "Alguém entrou no grupo" },
  { id: "group_leave",            label: "Alguém saiu do grupo" },
  { id: "user_command",           label: "Comando (/start, /menu)" },
  { id: "button_click",           label: "Clicou em botão" },
  { id: "list_select",            label: "Selecionou item da lista" },
  { id: "scheduled",              label: "Agendado (cron)" },
  { id: "no_response",            label: "Contato sem resposta" },
  { id: "contact_tag",            label: "Contato recebeu tag" },
];

// Triggers que requerem uma palavra-chave associada. Quando o usuário
// escolhe um destes no picker, abrimos um follow-up inline perguntando a
// palavra e inserimos uma segunda menção do tipo keyword logo depois.
export const TRIGGER_NEEDS_KEYWORD = new Set<string>([
  "group_keyword",
  "private_keyword",
  "user_command",
]);

// Ações = combinações curadas de step_type + parâmetro. Quase todas pedem
// um texto/valor inline via follow-up. O backend transforma a menção em
// overrides (message_template, action_type, etc).
export const ACTION_OPTIONS: {
  id: string;           // action id (backend interpreta)
  label: string;
  hint?: string;
  prompt: string;       // pergunta do follow-up
  paramLabel: (v: string) => string; // como montar o label da chip
  needsParam?: boolean;  // default true
}[] = [
  { id: "reply_private", label: "Responder no privado", hint: "Manda mensagem em DM pro contato",
    prompt: "Qual mensagem enviar?", paramLabel: (v) => `Responder privado: "${v}"` },
  { id: "reply_group",   label: "Responder no grupo",   hint: "Manda mensagem no mesmo grupo",
    prompt: "Qual mensagem enviar?", paramLabel: (v) => `Responder no grupo: "${v}"` },
  { id: "ai_response",   label: "Responder com IA",     hint: "LLM gera a resposta",
    prompt: "Prompt/sistema da IA?", paramLabel: (v) => `IA: "${v}"` },
  { id: "add_tag",       label: "Adicionar tag",        hint: "Tag CRM no contato",
    prompt: "Qual tag?", paramLabel: (v) => `Tag: ${v}` },
  { id: "remove_tag",    label: "Remover tag",          hint: "Remove tag CRM",
    prompt: "Qual tag remover?", paramLabel: (v) => `Remove tag: ${v}` },
  { id: "update_stage",  label: "Mudar etapa no CRM",   hint: "Atualiza stage do contato",
    prompt: "Nome/id da etapa?", paramLabel: (v) => `Etapa: ${v}` },
  { id: "set_variable",  label: "Definir variável",     hint: "Armazena valor",
    prompt: "nome=valor", paramLabel: (v) => `Var: ${v}` },
  { id: "webhook",       label: "Chamar webhook",       hint: "POST para URL externa",
    prompt: "URL do webhook?", paramLabel: (v) => `Webhook: ${v}` },
  { id: "handoff",       label: "Transferir p/ humano", hint: "Encerra automação e notifica time",
    prompt: "Mensagem de encerramento?", paramLabel: (v) => `Handoff: "${v}"` },
  { id: "end",           label: "Encerrar fluxo",       hint: "Finaliza sem resposta", needsParam: false,
    prompt: "", paramLabel: () => "Encerrar" },
];

export const STEP_OPTIONS: { id: string; label: string; hint?: string }[] = [
  { id: "message",      label: "Enviar mensagem",       hint: "Texto ao contato" },
  { id: "buttons",      label: "Enviar botões",         hint: "Mensagem com quick-replies" },
  { id: "list",         label: "Enviar lista",          hint: "Menu com seções" },
  { id: "input",        label: "Aguardar resposta",     hint: "Coleta input do usuário" },
  { id: "wait",         label: "Esperar tempo",         hint: "Delay antes do próximo passo" },
  { id: "condition",    label: "Condição (if/else)",    hint: "Ramifica por variável" },
  { id: "ai_response",  label: "Resposta com IA",       hint: "LLM gera a resposta" },
  { id: "http_request", label: "Chamar API externa",    hint: "GET/POST, salva resultado" },
  { id: "media",        label: "Enviar mídia",          hint: "Imagem, vídeo, áudio, doc" },
  { id: "handoff",      label: "Transferir p/ humano",  hint: "Atendimento manual" },
  { id: "goto",         label: "Ir para step",          hint: "Pula para outro passo" },
  { id: "randomize",    label: "A/B split",             hint: "Divide em branches" },
  { id: "set_variable", label: "Definir variável",      hint: "Armazena valor" },
  { id: "add_tag",      label: "Adicionar tag",         hint: "Tag no contato CRM" },
  { id: "remove_tag",   label: "Remover tag",           hint: "Remove tag do CRM" },
  { id: "update_stage", label: "Mover de etapa",        hint: "Atualiza CRM stage" },
  { id: "end",          label: "Encerrar fluxo" },
];
const catMeta = (t: MentionType) => CATEGORIES.find((c) => c.type === t)!;

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function createChipEl(type: MentionType, id: string, label: string, meta?: Record<string, string>): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.setAttribute("data-m-type", type);
  chip.setAttribute("data-m-id", id);
  if (meta?.jid) chip.setAttribute("data-m-jid", meta.jid);
  if (meta?.phone) chip.setAttribute("data-m-phone", meta.phone);
  chip.setAttribute("contenteditable", "false");
  const c = catMeta(type).color;
  chip.className = "mention-chip";
  chip.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:4px",
    "padding:1px 8px",
    "margin:0 1px",
    "border-radius:6px",
    "font-size:12px",
    "font-weight:600",
    "line-height:1.6",
    "cursor:default",
    "user-select:none",
    `background:${c}22`,
    `color:${c}`,
    `border:1px solid ${c}55`,
  ].join(";");
  chip.textContent = "@" + label;
  return chip;
}

function renderValueToDOM(el: HTMLDivElement, value: string) {
  el.innerHTML = "";
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(value)) !== null) {
    const [full, label, type, id] = m;
    const start = m.index;
    if (start > last) el.appendChild(document.createTextNode(value.slice(last, start)));
    el.appendChild(createChipEl(type as MentionType, id, label));
    last = start + full.length;
  }
  if (last < value.length) el.appendChild(document.createTextNode(value.slice(last)));
  // Garante que sempre há um nó de texto no fim (caret precisa pousar em algum lugar)
  if (el.lastChild?.nodeType !== Node.TEXT_NODE) {
    el.appendChild(document.createTextNode(""));
  }
}

function readEditor(el: HTMLDivElement | null): MentionPickerHandles {
  if (!el) return { value: "", renderedText: "", mentions: [] };
  let value = "", rendered = "";
  const mentions: Mention[] = [];
  const walk = (node: ChildNode) => {
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? "";
      rendered += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.dataset.mType) {
        const label = (node.textContent ?? "").replace(/^@/, "");
        const m: Mention = {
          type: node.dataset.mType as MentionType,
          id: node.dataset.mId ?? "",
          label,
        };
        const meta: Record<string, string> = {};
        if (node.dataset.mJid) meta.jid = node.dataset.mJid;
        if (node.dataset.mPhone) meta.phone = node.dataset.mPhone;
        if (Object.keys(meta).length) m.meta = meta;
        mentions.push(m);
        value += `@[${label}](${m.type}:${m.id})`;
        rendered += label;
        return;
      }
      if (node.tagName === "BR") { value += "\n"; rendered += "\n"; return; }
      node.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  return { value, renderedText: rendered, mentions };
}

// ─── Picker state ────────────────────────────────────────────────────────────

interface PickerAnchor {
  // snapshot do range do trigger (`/` ou `@` + letras depois) para apagar
  // e substituir pelo chip no momento do pick.
  textNode: Text;
  startOffset: number;
  endOffset: number;
}

interface PickerState {
  open: boolean;
  trigger: "/" | "@";
  mode: "category" | "search" | "followUp";
  category: MentionType | null;
  query: string;
  anchor: PickerAnchor | null;
  followUp?: {
    prompt: string;
    apply: (value: string) => Mention[] | null; // menções a inserir no submit
    headerLabel: string;  // texto de título do follow-up (ex: "Gatilho: Palavra-chave no grupo")
  };
}

const CLOSED: PickerState = {
  open: false, trigger: "/", mode: "category", category: null, query: "", anchor: null,
};

// ─── Component ───────────────────────────────────────────────────────────────

export function MentionPicker({
  value, onChange, onSend, placeholder, disabled, isLoading,
  allowedCategories, extraSteps, defaultInstanceId, minRows,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastEmittedValue = useRef("");
  const [picker, setPicker] = useState<PickerState>(CLOSED);
  const [highlight, setHighlight] = useState(0);
  const [editorFocused, setEditorFocused] = useState(false);

  // ─── Sync parent value → DOM (só quando muda externamente) ─────────────────
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastEmittedValue.current) return;
    renderValueToDOM(el, value);
    lastEmittedValue.current = value;
  }, [value]);

  // ─── Emissão ────────────────────────────────────────────────────────────────
  const emit = useCallback(() => {
    const info = readEditor(editorRef.current);
    lastEmittedValue.current = info.value;
    onChange(info.value, info);
  }, [onChange]);

  // ─── Data fetching on-demand ────────────────────────────────────────────────
  const mentionedInstanceId = useMemo(() => {
    const info = readEditor(editorRef.current);
    return info.mentions.find((m) => m.type === "instance")?.id || defaultInstanceId;
  }, [value, defaultInstanceId]);

  const q = useCallback(<T,>(key: any[], fn: () => Promise<T>, enabled: boolean) =>
    useQuery<T>({ queryKey: key, queryFn: fn, enabled, staleTime: 60_000 }), []);

  const needsCategory = (c: MentionType) =>
    picker.open && (picker.category === c || picker.mode === "search" && !picker.category);

  const { data: instances = [] } = useQuery<any[]>({
    queryKey: ["mention", "instances"],
    queryFn: async () => (await instancesApi.list()).data ?? [],
    enabled: needsCategory("instance"),
    staleTime: 60_000,
  });
  const { data: groupsData } = useQuery<any>({
    queryKey: ["mention", "groups", mentionedInstanceId ?? "any"],
    queryFn: async () => {
      if (!mentionedInstanceId) return null;
      return (await groupsApi.list(mentionedInstanceId)).data;
    },
    enabled: needsCategory("group") && !!mentionedInstanceId,
    staleTime: 30_000,
  });
  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["mention", "contacts"],
    queryFn: async () => (await crmApi.listContacts({ limit: 200 })).data?.data ?? [],
    enabled: needsCategory("contact"),
    staleTime: 60_000,
  });
  const { data: tags = [] } = useQuery<any[]>({
    queryKey: ["mention", "tags"],
    queryFn: async () => (await crmApi.listTags()).data ?? [],
    enabled: needsCategory("tag"),
    staleTime: 60_000,
  });
  const { data: funnels = [] } = useQuery<any[]>({
    queryKey: ["mention", "funnels"],
    queryFn: async () => (await crmApi.listFunnels()).data ?? [],
    enabled: needsCategory("funnel"),
    staleTime: 60_000,
  });
  const { data: journeys = [] } = useQuery<any[]>({
    queryKey: ["mention", "journeys"],
    queryFn: async () => (await journeysApi.list()).data ?? [],
    enabled: needsCategory("journey"),
    staleTime: 30_000,
  });

  const groupItems: { type: MentionType; id: string; label: string; meta?: Record<string, string> }[] =
    Array.isArray(groupsData?.groups)
      ? groupsData.groups.map((g: any) => ({ type: "group" as MentionType, id: g.jid, label: g.name || g.subject || g.jid, meta: { jid: g.jid } }))
      : [];

  const allItems = useMemo(() => ({
    instance: instances.map((i: any) => ({ type: "instance" as MentionType, id: i.id, label: i.name || i.phone_number || "(sem nome)" })),
    group:    groupItems,
    contact:  contacts.map((c: any) => ({ type: "contact" as MentionType, id: c.id, label: c.name || c.phone, meta: { phone: c.phone } })),
    tag:      tags.map((t: any) => ({ type: "tag" as MentionType, id: t.id, label: t.name })),
    funnel:   funnels.map((f: any) => ({ type: "funnel" as MentionType, id: f.id, label: f.name })),
    journey:  journeys.map((j: any) => ({ type: "journey" as MentionType, id: j.id, label: j.name })),
    trigger:  TRIGGER_OPTIONS.map((t) => ({ type: "trigger" as MentionType, id: t.id, label: t.label, meta: t.hint ? { hint: t.hint } : undefined })),
    action:   ACTION_OPTIONS.map((a) => ({ type: "action" as MentionType, id: a.id, label: a.label, meta: a.hint ? { hint: a.hint } : undefined })),
    step:     [
      ...(extraSteps ?? []),
      ...STEP_OPTIONS.map((s) => ({ type: "step" as MentionType, id: s.id, label: s.label, meta: s.hint ? { hint: s.hint } : undefined })),
    ],
    // keyword é dinâmico — tratado direto em `suggestions`
    keyword:  [] as { type: MentionType; id: string; label: string; meta?: Record<string, string> }[],
  }), [instances, groupItems, contacts, tags, funnels, journeys, extraSteps]);

  // ─── Sugestões filtradas ────────────────────────────────────────────────────
  type Suggestion = {
    type: MentionType; id: string; label: string; meta?: Record<string, string>;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    color: string;
  };
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!picker.open) return [];
    const q = picker.query.toLowerCase().trim();
    const matches = (label: string) => !q || label.toLowerCase().includes(q);

    if (picker.mode === "category") {
      const allow = allowedCategories && allowedCategories.length > 0
        ? new Set(allowedCategories) : null;
      return CATEGORIES
        .filter((c) => (!allow || allow.has(c.type))
          && (!q || c.slash.includes(q) || c.label.toLowerCase().includes(q)))
        .map<Suggestion>((c) => ({ type: c.type, id: `__cat__:${c.type}`, label: c.label, icon: c.icon, color: c.color }));
    }
    if (picker.mode === "search" && picker.category) {
      const meta = catMeta(picker.category);
      // Keyword: user-defined. A query vira o próprio valor.
      if (picker.category === "keyword") {
        const raw = picker.query.trim();
        if (!raw) {
          return [{
            type: "keyword" as MentionType,
            id: "__placeholder__",
            label: "Digite a palavra pra marcar",
            icon: meta.icon,
            color: meta.color,
          }];
        }
        const safe = raw.replace(/[^A-Za-z0-9_@.\-]/g, "_"); // id-safe
        return [{
          type: "keyword" as MentionType,
          id: safe,
          label: raw,
          icon: meta.icon,
          color: meta.color,
        }];
      }
      const list = allItems[picker.category] ?? [];
      return list.filter((i) => matches(i.label)).slice(0, 8).map<Suggestion>((i) => ({ ...i, icon: meta.icon, color: meta.color }));
    }
    // busca global (@)
    const out: Suggestion[] = [];
    (["instance", "group", "contact", "tag", "funnel", "journey"] as MentionType[]).forEach((t) => {
      const meta = catMeta(t);
      for (const i of allItems[t] ?? []) {
        if (matches(i.label) && out.length < 8) {
          out.push({ ...i, icon: meta.icon, color: meta.color });
        }
      }
    });
    return out;
  }, [picker, allItems]);

  useEffect(() => { setHighlight(0); }, [picker.mode, picker.category, picker.query]);

  // ─── Detecção de trigger após mutação do editor ─────────────────────────────
  const detectTriggerFromCaret = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setPicker(CLOSED); return; }
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) { setPicker(CLOSED); return; }
    const text = container.textContent ?? "";
    const cursor = range.startOffset;
    const before = text.slice(0, cursor);
    const m = /(?:^|\s)([/@])([\w\-áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ ]*)$/.exec(before);
    if (!m) { setPicker(CLOSED); return; }
    const [, trig, query] = m;
    const startOffset = before.length - (trig.length + query.length);
    const endOffset = cursor;
    const anchor: PickerAnchor = {
      textNode: container as Text,
      startOffset,
      endOffset,
    };
    setPicker((prev) => {
      // Mantém categoria já escolhida se ainda estamos dentro do mesmo trigger
      if (prev.open && prev.mode === "search" && prev.category && prev.trigger === (trig as "/" | "@")) {
        return { ...prev, anchor, query };
      }
      return {
        open: true,
        trigger: trig as "/" | "@",
        mode: trig === "/" ? "category" : "search",
        category: trig === "/" ? null : null,
        query,
        anchor,
      };
    });
  }, []);

  const onInput = () => {
    emit();
    detectTriggerFromCaret();
  };

  // ─── Aplicar sugestão ───────────────────────────────────────────────────────
  const closePicker = () => setPicker(CLOSED);

  // Insere uma sequência de menções no lugar do anchor. Primeira menção
  // substitui a âncora; as seguintes vão sendo inseridas logo depois.
  const insertMentionsAtAnchor = useCallback((mentions: Mention[]) => {
    const anchor = picker.anchor;
    const editor = editorRef.current;
    if (!anchor || !editor) return;
    const textNode = anchor.textNode;
    if (!textNode.parentNode) return;
    const fullText = textNode.textContent ?? "";
    const before = fullText.slice(0, anchor.startOffset);
    const after = fullText.slice(anchor.endOffset);

    const parent = textNode.parentNode;
    const beforeNode = document.createTextNode(before);
    // o texto depois começa com NBSP pra garantir que há um espaço entre o
    // último chip e o que o usuário já escreveu
    const afterNode = document.createTextNode("\u00A0" + after);
    parent.replaceChild(afterNode, textNode);
    parent.insertBefore(beforeNode, afterNode);

    let lastNode: Node = beforeNode;
    mentions.forEach((m, i) => {
      const chip = createChipEl(m.type, m.id, m.label, m.meta);
      parent.insertBefore(chip, afterNode);
      lastNode = chip;
      // espaço entre chips
      if (i < mentions.length - 1) {
        const sp = document.createTextNode(" ");
        parent.insertBefore(sp, afterNode);
        lastNode = sp;
      }
    });
    void lastNode;

    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(afterNode, 1);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    editor.focus();
    emit();
  }, [picker.anchor, emit]);

  const applySuggestion = useCallback((s: Suggestion | null) => {
    if (!picker.open || !s) return;
    if (s.id === "__placeholder__") return;

    // Categoria → troca pro modo de busca na categoria escolhida
    if (picker.mode === "category") {
      setPicker((p) => ({ ...p, mode: "search", category: s.type, query: "" }));
      searchRef.current?.focus();
      return;
    }

    // Trigger que precisa de keyword: insere o chip do trigger e muda pra
    // follow-up perguntando a palavra.
    if (picker.mode === "search" && picker.category === "trigger" && TRIGGER_NEEDS_KEYWORD.has(s.id)) {
      insertMentionsAtAnchor([{ type: "trigger", id: s.id, label: s.label }]);
      setPicker((p) => ({
        ...p,
        mode: "followUp",
        query: "",
        followUp: {
          prompt: "Qual palavra-chave? (Enter pra confirmar)",
          headerLabel: `Gatilho: ${s.label}`,
          apply: (v) => {
            const raw = v.trim();
            if (!raw) return null;
            const safe = raw.replace(/[^A-Za-z0-9_@.\-]/g, "_");
            return [{ type: "keyword", id: safe, label: raw }];
          },
        },
      }));
      // pequeno delay pra o popup re-renderizar e pegar o foco no search
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }

    // Ação com parâmetro: NÃO insere ainda. Entra em follow-up pedindo o
    // valor; ao submeter, insere uma única chip "action" com meta.value.
    if (picker.mode === "search" && picker.category === "action") {
      const action = ACTION_OPTIONS.find((a) => a.id === s.id);
      if (!action) return;
      if (action.needsParam === false) {
        insertMentionsAtAnchor([{ type: "action", id: action.id, label: action.label }]);
        closePicker();
        return;
      }
      setPicker((p) => ({
        ...p,
        mode: "followUp",
        query: "",
        followUp: {
          prompt: action.prompt,
          headerLabel: `Ação: ${action.label}`,
          apply: (v) => {
            const val = v.trim();
            if (!val) return null;
            return [{
              type: "action",
              id: action.id,
              label: action.paramLabel(val),
              meta: { value: val, action_type: action.id },
            }];
          },
        },
      }));
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }

    // Caminho padrão: insere um chip único e fecha
    insertMentionsAtAnchor([{ type: s.type, id: s.id, label: s.label, meta: s.meta }]);
    closePicker();
  }, [picker, insertMentionsAtAnchor]);

  // Submit do follow-up — chamado via Enter no search
  const submitFollowUp = useCallback(() => {
    if (picker.mode !== "followUp" || !picker.followUp) return;
    const result = picker.followUp.apply(picker.query);
    if (result && result.length > 0) {
      insertMentionsAtAnchor(result);
    }
    closePicker();
  }, [picker, insertMentionsAtAnchor]);

  // ─── Teclado no editor ──────────────────────────────────────────────────────
  const onEditorKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Atalhos do popup se estiver aberto e o usuário não tiver focado o input
    // de busca (a navegação via input tem seu próprio handler).
    if (picker.open && document.activeElement !== searchRef.current && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && suggestions[highlight])) {
        e.preventDefault();
        applySuggestion(suggestions[highlight] ?? null);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); closePicker(); return; }
    }

    // Enter solto (sem popup ativo) = enviar
    if (e.key === "Enter" && !e.shiftKey && !picker.open) {
      e.preventDefault();
      doSend();
      return;
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Em follow-up Enter submete o valor escrito
    if (picker.mode === "followUp") {
      if (e.key === "Enter")  { e.preventDefault(); submitFollowUp(); return; }
      if (e.key === "Escape") { e.preventDefault(); closePicker(); editorRef.current?.focus(); return; }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); applySuggestion(suggestions[highlight] ?? null); return; }
    if (e.key === "Escape")    { e.preventDefault(); closePicker(); editorRef.current?.focus(); return; }
  };

  // ─── Envio ──────────────────────────────────────────────────────────────────
  const doSend = () => {
    const info = readEditor(editorRef.current);
    if (!info.value.trim() || disabled || isLoading) return;
    onSend(info);
  };

  // ─── Foco automático no input de busca quando o popup abre em modo search ───
  useEffect(() => {
    if (picker.open && picker.mode === "search") {
      // pequeno atraso para garantir que o DOM da lista já renderizou
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [picker.open, picker.mode]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  const info = readEditor(editorRef.current);
  const hasContent = info.renderedText.trim().length > 0;
  const canSend = hasContent && !disabled;

  return (
    <div className="px-6 pb-5 pt-3 relative">
      <div
        className="flex items-end gap-2 rounded-2xl px-4 py-3 relative"
        style={{
          background: isLoading ? "rgba(0,212,106,0.08)" : "var(--surface-3)",
          border: `1px solid ${isLoading ? "rgba(0,212,106,0.3)" : editorFocused ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
          transition: "border-color .15s ease",
        }}
      >
        <div
          ref={editorRef}
          contentEditable={!disabled && !isLoading}
          suppressContentEditableWarning
          onInput={onInput}
          onKeyDown={onEditorKeyDown}
          onFocus={() => setEditorFocused(true)}
          onBlur={() => setEditorFocused(false)}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
          data-placeholder={placeholder || "Digite / para mencionar instância, grupo, contato, tag, funil ou jornada…"}
          className="mention-editor flex-1 bg-transparent outline-none text-sm leading-relaxed py-0.5"
          style={{
            color: "var(--text-1)",
            minHeight: "22px",
            maxHeight: "180px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            opacity: isLoading ? 0.6 : 1,
          }}
        />
        <button
          onClick={doSend}
          disabled={!canSend || isLoading}
          className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
          style={{
            background: canSend && !isLoading ? "var(--green)" : "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            opacity: canSend && !isLoading ? 1 : 0.5,
          }}
          title="Enviar (Enter)"
        >
          <Hash className="w-4 h-4" style={{ color: canSend ? "white" : "var(--text-3)" }} />
        </button>
      </div>

      {/* Placeholder via CSS */}
      <style>{`
        .mention-editor:empty::before {
          content: attr(data-placeholder);
          color: var(--text-3);
          pointer-events: none;
          display: block;
        }
      `}</style>

      {/* Picker dropdown */}
      {picker.open && (
        <div
          className="absolute left-6 right-6 bottom-full mb-2 rounded-xl overflow-hidden shadow-2xl z-20"
          style={{ background: "hsl(240 18% 8%)", border: "1px solid hsl(240 12% 16%)" }}
          onMouseDown={(e) => { e.preventDefault(); /* evita blur do editor */ }}
        >
          {/* Header com label + search */}
          <div className="px-3 pt-2.5 pb-2" style={{ borderBottom: "1px solid hsl(240 12% 14%)" }}>
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wider"
              style={{ color: "hsl(240 8% 48%)" }}>
              {picker.mode === "followUp" ? (
                <>
                  <Zap className="w-3 h-3" style={{ color: "#fbbf24" }} />
                  {picker.followUp?.headerLabel || "Preencha o valor"}
                  <button
                    onClick={closePicker}
                    className="ml-auto text-[10px] normal-case tracking-normal underline"
                    style={{ color: "hsl(240 8% 60%)" }}>
                    cancelar
                  </button>
                </>
              ) : picker.mode === "category" ? (
                <><Hash className="w-3 h-3" /> Escolha a categoria</>
              ) : picker.category ? (
                <>
                  <Hash className="w-3 h-3" />
                  {catMeta(picker.category).label}
                  <button
                    onClick={() => { setPicker((p) => ({ ...p, mode: "category", category: null, query: "" })); }}
                    className="ml-auto text-[10px] normal-case tracking-normal underline"
                    style={{ color: "hsl(240 8% 60%)" }}>
                    ← trocar
                  </button>
                </>
              ) : (
                <><AtSign className="w-3 h-3" /> Busca global (todos os tipos)</>
              )}
            </div>
            {(picker.mode === "search" || picker.mode === "followUp") && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 14%)" }}>
                <SearchIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 46%)" }} />
                <input
                  ref={searchRef}
                  type="text"
                  value={picker.query}
                  onChange={(e) => setPicker((p) => ({ ...p, query: e.target.value }))}
                  onKeyDown={onSearchKeyDown}
                  placeholder={
                    picker.mode === "followUp"
                      ? picker.followUp?.prompt || "Digite o valor"
                      : picker.category
                        ? `Buscar ${catMeta(picker.category).label.toLowerCase()}…`
                        : "Buscar em todos os tipos…"
                  }
                  className="flex-1 bg-transparent outline-none text-xs"
                  style={{ color: "hsl(240 15% 90%)" }}
                />
                {picker.query && picker.mode !== "followUp" && (
                  <button
                    onClick={() => setPicker((p) => ({ ...p, query: "" }))}
                    className="text-[10px]"
                    style={{ color: "hsl(240 8% 46%)" }}>limpar</button>
                )}
                {picker.mode === "followUp" && (
                  <button
                    onClick={submitFollowUp}
                    className="text-[10px] px-2 py-0.5 rounded"
                    style={{ background: "var(--green)", color: "white" }}
                  >OK</button>
                )}
              </div>
            )}
          </div>

          {/* Lista — em follow-up só mostra um hint de ajuda, sem sugestões */}
          {picker.mode === "followUp" ? (
            <div className="px-4 py-4 text-xs" style={{ color: "hsl(240 8% 60%)" }}>
              <p>Digite o valor e pressione <b>Enter</b> para inserir a menção.</p>
            </div>
          ) : suggestions.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto py-1">
              {suggestions.map((s, idx) => {
                const Icon = s.icon;
                const active = idx === highlight;
                return (
                  <li key={`${s.type}-${s.id}`}>
                    <button
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => applySuggestion(s)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                      style={{ background: active ? "rgba(255,255,255,0.05)" : "transparent" }}
                    >
                      <span className="flex items-center justify-center w-5 h-5 rounded"
                        style={{ background: s.color + "22" }}>
                        <Icon className="w-3 h-3" style={{ color: s.color }} />
                      </span>
                      <span className="flex-1 text-sm truncate" style={{ color: "hsl(240 15% 90%)" }}>{s.label}</span>
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: "hsl(240 8% 42%)" }}>
                        {s.type}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-xs" style={{ color: "hsl(240 8% 48%)" }}>
              {picker.mode === "search" && picker.category === "group" && !mentionedInstanceId
                ? "Selecione uma instância primeiro com /instancia"
                : picker.query
                  ? "Nenhum resultado."
                  : "Carregando…"}
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs mt-2" style={{ color: "var(--text-3)" }}>
        {isLoading
          ? <span style={{ color: "var(--green)" }}>Aguarde, processando…</span>
          : <>Enter envia · Shift+Enter quebra linha · <b>/</b> categoria · <b>@</b> busca global</>}
      </p>
    </div>
  );
}

export default MentionPicker;
