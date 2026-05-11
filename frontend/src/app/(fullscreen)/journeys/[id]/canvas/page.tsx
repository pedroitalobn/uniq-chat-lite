"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import {
  Save, Play, Sparkles, ArrowLeft, Plus, Wand2, Loader2, Send,
  MessageSquare, Clock, GitBranch, Tag, Bot, ListTree, Inbox,
  Image as ImageIcon, Globe, Shuffle, UserPlus, Variable, ArrowRightCircle,
  Trash2, X, PlayCircle, Zap,
  Radio, Users2, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { journeysApi, instancesApi, groupsApi } from "@/lib/api";
import { FunnelOptionPicker, StageOptionPicker } from "@/components/crm/FunnelStagePicker";
import { cn } from "@/lib/utils";
import { MentionPicker, parseMentions, type MentionPickerHandles } from "@/components/MentionPicker";
import { showConfirm } from "@/lib/confirm";

// ─── Types ────────────────────────────────────────────────────────────────────
type StepType =
  | "message" | "buttons" | "list" | "input" | "wait" | "condition"
  | "ai_response" | "http_request" | "media" | "handoff" | "goto"
  | "randomize" | "set_variable" | "add_tag" | "remove_tag"
  | "update_stage" | "end"
  | "product_search" | "product_carousel"
  // Customer.io-inspired
  | "wait_until" | "multivariate" | "send_in_timezone" | "unsubscribe"
  // New types
  | "cross_channel" | "delay_days" | "crm_update" | "send_email";

interface FlowStep {
  id: string;
  type: StepType;
  label?: string;
  config?: Record<string, unknown>;
  next_step_id?: string;
  is_start_step?: boolean;
  branch_true?: string;
  branch_false?: string;
}

interface JourneyFlow {
  start_step?: string;
  steps: FlowStep[];
}

// ─── Step metadata (icon, color, label, default config) ──────────────────────
const STEP_META: Record<StepType, {
  label: string;
  color: string;
  bg: string;
  icon: React.ElementType;
  defaultConfig: Record<string, unknown>;
  hasTwoBranches?: boolean;
}> = {
  message:     { label: "Mensagem",    color: "#3b82f6", bg: "rgba(59,130,246,0.12)",  icon: MessageSquare, defaultConfig: { message: "Olá {{name}}!", mode: "private" } },
  buttons:     { label: "Botões",      color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   icon: ListTree,      defaultConfig: { message: "Escolha uma opção:", buttons: [{ id: "b1", text: "Opção 1" }, { id: "b2", text: "Opção 2" }], mode: "private" } },
  list:        { label: "Lista",       color: "#0ea5e9", bg: "rgba(14,165,233,0.12)",  icon: ListTree,      defaultConfig: { message: "Ver opções:", button_text: "Ver", sections: [{ title: "Opções", rows: [{ id: "r1", title: "Item 1" }] }] } },
  input:       { label: "Input",       color: "#8b5cf6", bg: "rgba(139,92,246,0.12)",  icon: Inbox,         defaultConfig: { prompt: "Qual seu nome?", variable_name: "nome" } },
  wait:        { label: "Aguardar",    color: "#eab308", bg: "rgba(234,179,8,0.12)",   icon: Clock,         defaultConfig: { duration: "5s" } },
  condition:   { label: "Condição",    color: "#a855f7", bg: "rgba(168,85,247,0.12)",  icon: GitBranch,     defaultConfig: { left: "{{last_input}}", operator: "contains", right: "" }, hasTwoBranches: true },
  ai_response: { label: "Resposta IA", color: "#10b981", bg: "rgba(16,185,129,0.12)",  icon: Bot,           defaultConfig: { system_prompt: "Você é um atendente prestativo.", user_prompt: "{{last_input}}", send_to_user: true } },
  http_request:{ label: "HTTP",        color: "#f97316", bg: "rgba(249,115,22,0.12)",  icon: Globe,         defaultConfig: { method: "GET", url: "https://api.exemplo.com", save_result: "resposta" } },
  media:       { label: "Mídia",       color: "#ec4899", bg: "rgba(236,72,153,0.12)",  icon: ImageIcon,     defaultConfig: { media_type: "image", url: "", caption: "" } },
  handoff:     { label: "Humano",      color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  icon: UserPlus,      defaultConfig: { message: "Transferindo para um atendente...", user_id: "" } },
  goto:        { label: "Ir para",     color: "#64748b", bg: "rgba(100,116,139,0.12)", icon: ArrowRightCircle, defaultConfig: { target_step_id: "" } },
  randomize:   { label: "A/B Split",   color: "#d946ef", bg: "rgba(217,70,239,0.12)",  icon: Shuffle,       defaultConfig: { branches: [{ step_id: "", weight: 1 }, { step_id: "", weight: 1 }] } },
  set_variable:{ label: "Variável",    color: "#6366f1", bg: "rgba(99,102,241,0.12)",  icon: Variable,      defaultConfig: { name: "minha_var", value: "" } },
  add_tag:     { label: "Add Tag",     color: "#22c55e", bg: "rgba(34,197,94,0.12)",   icon: Tag,           defaultConfig: { tag: "" } },
  remove_tag:  { label: "Rem Tag",     color: "#94a3b8", bg: "rgba(148,163,184,0.12)", icon: Tag,           defaultConfig: { tag: "" } },
  update_stage:{ label: "Estágio CRM", color: "#14b8a6", bg: "rgba(20,184,166,0.12)",  icon: GitBranch,     defaultConfig: { stage_id: "" } },
  end:         { label: "Fim",         color: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: X,             defaultConfig: {} },
  // Shop nodes (Fase 10)
  product_search:   { label: "Buscar produtos",    color: "#22c55e", bg: "rgba(34,197,94,0.12)",  icon: Tag,      defaultConfig: { query: "{{last_input}}", limit: 5, save_to_var: "products" } },
  product_carousel: { label: "Carousel produtos",  color: "#22c55e", bg: "rgba(34,197,94,0.12)",  icon: ListTree, defaultConfig: { header: "Produtos pra você", message: "Confira:", products_var: "products", button_text: "Ver" } },
  // Customer.io-inspired
  wait_until:       { label: "Aguardar evento",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: Clock,    defaultConfig: { event: "shop.order_paid", timeout_minutes: 1440 } },
  multivariate:     { label: "A/B/C split",        color: "#a855f7", bg: "rgba(168,85,247,0.12)", icon: GitBranch,defaultConfig: { branches: [{ weight: 50, next: "", label: "A" }, { weight: 50, next: "", label: "B" }] } },
  send_in_timezone: { label: "Janela horária",     color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: Clock,    defaultConfig: { window_start_hour: 9, window_end_hour: 18 } },
  unsubscribe:      { label: "Unsubscribe (LGPD)", color: "#ef4444", bg: "rgba(239,68,68,0.12)",  icon: X,        defaultConfig: { channel: "all", reason: "user_optout" } },
  // New types
  cross_channel: { label: "Multi-canal",   color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", icon: Radio,   defaultConfig: { message: "{{message}}", channels: ["whatsapp", "instagram"], fallback: "whatsapp" } },
  delay_days:    { label: "Delay (dias)",  color: "#eab308", bg: "rgba(234,179,8,0.12)",  icon: Clock,   defaultConfig: { days: 1, hours: 0 } },
  crm_update:    { label: "Atualizar CRM", color: "#14b8a6", bg: "rgba(20,184,166,0.12)", icon: Users2,  defaultConfig: { field: "name", value: "{{last_input}}" } },
  send_email:    { label: "Enviar Email",  color: "#6366f1", bg: "rgba(99,102,241,0.12)", icon: Mail,    defaultConfig: { to: "{{contact.email}}", subject: "Olá {{name}}", body: "" } },
};

// ─── Custom node (glass-card design) ─────────────────────────────────────────
function FlowNode({ data, selected }: NodeProps) {
  const step = data.step as FlowStep;
  const meta = STEP_META[step.type] || STEP_META.message;
  const Icon = meta.icon;
  const preview = data.preview as string | undefined;
  const isStart = step.is_start_step;

  return (
    <div
      style={{
        background: selected
          ? `linear-gradient(135deg, ${meta.bg} 0%, rgba(255,255,255,0.04) 100%)`
          : "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: selected ? `1.5px solid ${meta.color}` : "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        boxShadow: selected
          ? `0 0 0 3px ${meta.color}22, 0 8px 24px rgba(0,0,0,0.40)`
          : "0 4px 16px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.08)",
        minWidth: 220,
        maxWidth: 260,
        padding: "10px 12px",
        position: "relative",
        overflow: "hidden",
        transition: "box-shadow 0.2s ease, border-color 0.2s ease",
      }}
    >
      {/* Ambient orb */}
      <div style={{
        position: "absolute", top: -20, right: -20, width: 80, height: 80,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${meta.color}22 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {/* Top line accent for start step */}
      {isStart && (
        <div style={{
          position: "absolute", top: 0, left: "20%", right: "20%", height: 2,
          background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
          borderRadius: 1,
        }} />
      )}

      <Handle type="target" position={Position.Top}
        style={{ background: meta.color, width: 8, height: 8, border: "2px solid rgba(0,0,0,0.3)", top: -5 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: preview ? 6 : 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: meta.bg, border: `1px solid ${meta.color}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon style={{ width: 14, height: 14, color: meta.color }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", opacity: 0.5, color: meta.color, marginBottom: 1,
          }}>
            {meta.label}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 600, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "rgba(255,255,255,0.9)",
          }}>
            {step.label || meta.label}
          </div>
        </div>
        {isStart && (
          <div style={{
            fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
            padding: "2px 6px", borderRadius: 6, flexShrink: 0,
            background: "rgba(0,212,106,0.15)", color: "#00d46a",
            border: "1px solid rgba(0,212,106,0.3)",
          }}>
            START
          </div>
        )}
      </div>

      {preview && (
        <div style={{
          fontSize: 10, opacity: 0.55, lineHeight: 1.4,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
          color: "rgba(255,255,255,0.8)",
          padding: "4px 6px",
          background: "rgba(0,0,0,0.20)",
          borderRadius: 6,
          marginTop: 4,
        }}>
          {preview}
        </div>
      )}

      {meta.hasTwoBranches ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true"
            style={{ background: "#10b981", left: "28%", width: 10, height: 10, border: "2px solid rgba(0,0,0,0.3)" }} />
          <Handle type="source" position={Position.Bottom} id="false"
            style={{ background: "#ef4444", left: "72%", width: 10, height: 10, border: "2px solid rgba(0,0,0,0.3)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, padding: "0 4px" }}>
            <span style={{ fontSize: 9, color: "#10b981", fontWeight: 600 }}>✓ Sim</span>
            <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 600 }}>✗ Não</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom}
          style={{ background: meta.color, width: 8, height: 8, border: "2px solid rgba(0,0,0,0.3)", bottom: -5 }} />
      )}
    </div>
  );
}

const nodeTypes = { flowStep: FlowNode };

// ─── Helpers: flow ↔ react-flow conversions ───────────────────────────────────
function stepPreview(step: FlowStep): string {
  const cfg = (step.config || {}) as Record<string, unknown>;
  switch (step.type) {
    case "message":
    case "handoff":
      return String(cfg.message || "").slice(0, 60);
    case "buttons":
      return `${cfg.message || ""} (${(cfg.buttons as unknown[])?.length || 0} botões)`;
    case "list":
      return String(cfg.message || "");
    case "input":
      return `→ ${cfg.variable_name || "?"}`;
    case "wait":
      return `${cfg.duration || "5s"}`;
    case "delay_days":
      return `${cfg.days || 0}d ${cfg.hours || 0}h`;
    case "condition":
      return `${cfg.left} ${cfg.operator} ${cfg.right}`;
    case "ai_response":
      return String(cfg.user_prompt || cfg.system_prompt || "").slice(0, 60);
    case "http_request":
      return `${cfg.method} ${cfg.url}`.slice(0, 60);
    case "set_variable":
      return `${cfg.name} = ${cfg.value}`;
    case "add_tag":
    case "remove_tag":
      return String(cfg.tag || "");
    case "goto":
      return `→ ${cfg.target_step_id || "?"}`;
    case "crm_update":
      return `${cfg.field} = ${cfg.value}`;
    case "send_email":
      return String(cfg.subject || cfg.to || "").slice(0, 60);
    case "cross_channel":
      return String(cfg.message || "").slice(0, 60);
    default:
      return "";
  }
}

function flowToGraph(flow: JourneyFlow | null): { nodes: Node[]; edges: Edge[] } {
  if (!flow || !flow.steps?.length) return { nodes: [], edges: [] };

  // Posicionamento automático em árvore (BFS a partir do start)
  const byId = new Map(flow.steps.map(s => [s.id, s]));
  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const levels = new Map<string, number>();

  const startId = flow.start_step || flow.steps.find(s => s.is_start_step)?.id || flow.steps[0].id;
  const queue: Array<{ id: string; level: number }> = [{ id: startId, level: 0 }];

  while (queue.length) {
    const { id, level } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    levels.set(id, level);

    const step = byId.get(id);
    if (!step) continue;
    const children = [step.next_step_id, step.branch_true, step.branch_false]
      .filter(Boolean) as string[];
    for (const c of children) {
      if (!visited.has(c)) queue.push({ id: c, level: level + 1 });
    }
  }
  // Adiciona órfãos
  for (const s of flow.steps) {
    if (!visited.has(s.id)) {
      levels.set(s.id, 0);
    }
  }

  // Agrupa por nível para espalhar horizontalmente
  const byLevel = new Map<number, string[]>();
  for (const [id, lv] of levels) {
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(id);
  }
  const X_GAP = 280;
  const Y_GAP = 140;
  for (const [lv, ids] of byLevel) {
    const totalWidth = (ids.length - 1) * X_GAP;
    ids.forEach((id, i) => {
      positions.set(id, { x: i * X_GAP - totalWidth / 2, y: lv * Y_GAP });
    });
  }

  const nodes: Node[] = flow.steps.map(s => ({
    id: s.id,
    type: "flowStep",
    position: positions.get(s.id) || { x: 0, y: 0 },
    data: { step: s, preview: stepPreview(s) },
  }));

  const edges: Edge[] = [];
  for (const s of flow.steps) {
    const isCondition = s.type === "condition";
    if (s.next_step_id && byId.has(s.next_step_id)) {
      edges.push({
        id: `${s.id}-next-${s.next_step_id}`,
        source: s.id,
        target: s.next_step_id,
        type: "smoothstep",
        animated: isCondition,
        markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(255,255,255,0.25)" },
        style: { stroke: "rgba(255,255,255,0.25)", strokeWidth: 2 },
      });
    }
    if (s.branch_true && byId.has(s.branch_true)) {
      edges.push({
        id: `${s.id}-true-${s.branch_true}`,
        source: s.id, sourceHandle: "true",
        target: s.branch_true,
        type: "smoothstep",
        animated: true,
        label: "sim",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#10b981" },
        style: { stroke: "#10b981", strokeWidth: 2 },
      });
    }
    if (s.branch_false && byId.has(s.branch_false)) {
      edges.push({
        id: `${s.id}-false-${s.branch_false}`,
        source: s.id, sourceHandle: "false",
        target: s.branch_false,
        type: "smoothstep",
        animated: true,
        label: "não",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#ef4444" },
        style: { stroke: "#ef4444", strokeWidth: 2 },
      });
    }
  }

  return { nodes, edges };
}

function graphToFlow(nodes: Node[], edges: Edge[]): JourneyFlow {
  const byId = new Map<string, FlowStep>();
  for (const n of nodes) {
    const step = n.data.step as FlowStep;
    byId.set(n.id, { ...step, next_step_id: "", branch_true: "", branch_false: "" });
  }
  for (const e of edges) {
    const step = byId.get(e.source);
    if (!step) continue;
    if (e.sourceHandle === "true") step.branch_true = e.target;
    else if (e.sourceHandle === "false") step.branch_false = e.target;
    else step.next_step_id = e.target;
  }

  const start = nodes.find(n => (n.data.step as FlowStep).is_start_step)?.id
    || nodes[0]?.id;

  return {
    start_step: start,
    steps: nodes.map(n => byId.get(n.id)!).filter(Boolean),
  };
}

// ─── Step library categories ──────────────────────────────────────────────────
const STEP_CATEGORIES: { label: string; color: string; types: StepType[] }[] = [
  {
    label: "Mensagens",
    color: "#3b82f6",
    types: ["message", "buttons", "list", "media", "input"],
  },
  {
    label: "Lógica",
    color: "#a855f7",
    types: ["wait", "delay_days", "condition", "goto", "randomize", "multivariate", "end"],
  },
  {
    label: "Integrações",
    color: "#f97316",
    types: ["ai_response", "http_request", "cross_channel", "send_email", "handoff"],
  },
  {
    label: "CRM & Tags",
    color: "#10b981",
    types: ["add_tag", "remove_tag", "update_stage", "crm_update", "set_variable"],
  },
  {
    label: "Avançado",
    color: "#f59e0b",
    types: ["wait_until", "send_in_timezone", "unsubscribe", "product_search", "product_carousel"],
  },
];

// ─── Step library (sidebar) ───────────────────────────────────────────────────
function StepLibrary({ onAdd }: { onAdd: (type: StepType) => void }) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? (Object.entries(STEP_META) as [StepType, typeof STEP_META[StepType]][])
        .filter(([, m]) => m.label.toLowerCase().includes(search.toLowerCase()))
        .map(([t]) => t)
    : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "12px 12px 8px",
        borderBottom: "1px solid var(--border-subtle)",
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
      }}>
        <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>
          Passos
        </p>
        <div style={{ position: "relative" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            style={{
              width: "100%", padding: "5px 8px 5px 28px", borderRadius: 8, fontSize: 11,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.8)", outline: "none", boxSizing: "border-box",
            }}
          />
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, opacity: 0.4 }}>🔍</span>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {filtered ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {filtered.map(t => {
              const meta = STEP_META[t];
              const Icon = meta.icon;
              return (
                <button
                  key={t}
                  onClick={() => onAdd(t)}
                  style={{
                    padding: "8px 6px", borderRadius: 10, textAlign: "center",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    cursor: "pointer", transition: "all 0.15s ease",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = meta.bg;
                    (e.currentTarget as HTMLElement).style.borderColor = meta.color + "44";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 4px" }}>
                    <Icon style={{ width: 14, height: 14, color: meta.color }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.7)", display: "block" }}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          STEP_CATEGORIES.map(cat => (
            <div key={cat.label} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: cat.color, marginBottom: 4, paddingLeft: 2 }}>
                {cat.label}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {cat.types.filter(t => STEP_META[t]).map(t => {
                  const meta = STEP_META[t];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={t}
                      onClick={() => onAdd(t)}
                      style={{
                        padding: "7px 6px", borderRadius: 10, textAlign: "center",
                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                        cursor: "pointer", transition: "all 0.15s ease",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = meta.bg;
                        (e.currentTarget as HTMLElement).style.borderColor = meta.color + "44";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                      }}
                    >
                      <div style={{ width: 26, height: 26, borderRadius: 7, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 3px" }}>
                        <Icon style={{ width: 13, height: 13, color: meta.color }} />
                      </div>
                      <span style={{ fontSize: 9.5, fontWeight: 500, color: "rgba(255,255,255,0.65)", display: "block", lineHeight: 1.2 }}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Config panel for selected node ───────────────────────────────────────────
function ConfigPanel({
  step, onChange, onDelete, onSetStart,
}: {
  step: FlowStep | null;
  onChange: (s: FlowStep) => void;
  onDelete: () => void;
  onSetStart: () => void;
}) {
  if (!step) {
    return (
      <div className="p-4 h-full flex items-center justify-center text-center">
        <p className="text-xs opacity-50">Selecione um step no canvas para editar</p>
      </div>
    );
  }

  const meta = STEP_META[step.type];
  const cfg = (step.config || {}) as Record<string, unknown>;

  const update = (patch: Partial<FlowStep>) => onChange({ ...step, ...patch });
  const updateCfg = (patch: Record<string, unknown>) =>
    update({ config: { ...cfg, ...patch } });

  const txt = "w-full px-2.5 py-1.5 rounded-lg text-xs outline-none";
  const txtStyle: React.CSSProperties = {
    background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)",
  };

  return (
    <div className="p-4 overflow-y-auto h-full space-y-3">
      <div className="flex items-center gap-2 pb-3 border-b border-[var(--surface-border)]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: meta.bg, border: `1px solid ${meta.color}33` }}>
          <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
        </div>
        <div className="flex-1">
          <p className="text-[10px] uppercase font-semibold opacity-60">{meta.label}</p>
          <p className="text-xs font-medium">{step.label || meta.label}</p>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Rótulo</label>
        <input className={txt} style={txtStyle} value={step.label || ""}
          onChange={e => update({ label: e.target.value })} />
      </div>
      <div>
        <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">ID</label>
        <input className={txt} style={{ ...txtStyle, opacity: 0.6 }} value={step.id} disabled />
      </div>

      {/* Config fields per type */}
      {(step.type === "message" || step.type === "handoff") && (
        <div>
          <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Mensagem</label>
          <textarea className={txt + " min-h-[80px]"} style={txtStyle}
            value={String(cfg.message || "")}
            onChange={e => updateCfg({ message: e.target.value })} />
          <p className="text-[9px] opacity-50 mt-1">Placeholders: {"{{name}}"}, {"{{last_input}}"}, {"{{flow.var}}"}</p>
        </div>
      )}

      {step.type === "buttons" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Mensagem</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.message || "")}
              onChange={e => updateCfg({ message: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Botões</label>
            {((cfg.buttons as Array<{ id: string; text: string }>) || []).map((b, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <input className={txt} style={{ ...txtStyle, flex: "0 0 60px" }} value={b.id}
                  onChange={e => {
                    const arr = [...((cfg.buttons as Array<{ id: string; text: string }>) || [])];
                    arr[i] = { ...arr[i], id: e.target.value };
                    updateCfg({ buttons: arr });
                  }} />
                <input className={txt} style={txtStyle} value={b.text}
                  onChange={e => {
                    const arr = [...((cfg.buttons as Array<{ id: string; text: string }>) || [])];
                    arr[i] = { ...arr[i], text: e.target.value };
                    updateCfg({ buttons: arr });
                  }} />
                <button className="px-2 opacity-60 hover:opacity-100"
                  onClick={() => {
                    const arr = [...((cfg.buttons as Array<{ id: string; text: string }>) || [])];
                    arr.splice(i, 1);
                    updateCfg({ buttons: arr });
                  }}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button className="text-[10px] mt-1 opacity-70 hover:opacity-100"
              onClick={() => {
                const arr = [...((cfg.buttons as Array<{ id: string; text: string }>) || [])];
                arr.push({ id: `b${arr.length + 1}`, text: "Nova opção" });
                updateCfg({ buttons: arr });
              }}>
              + adicionar botão
            </button>
          </div>
        </>
      )}

      {step.type === "input" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Pergunta</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.prompt || "")}
              onChange={e => updateCfg({ prompt: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Salvar em variável</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.variable_name || "")}
              onChange={e => updateCfg({ variable_name: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "wait" && (
        <div>
          <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Duração</label>
          <input className={txt} style={txtStyle} placeholder="5s, 2m, 1h"
            value={String(cfg.duration || "")}
            onChange={e => updateCfg({ duration: e.target.value })} />
        </div>
      )}

      {step.type === "condition" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Valor esquerdo</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.left || "")} placeholder="{{last_input}}"
              onChange={e => updateCfg({ left: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Operador</label>
            <select className={txt} style={txtStyle}
              value={String(cfg.operator || "eq")}
              onChange={e => updateCfg({ operator: e.target.value })}>
              {["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "exists", "empty", "regex", "gt", "lt", "gte", "lte"].map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Valor direito</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.right || "")}
              onChange={e => updateCfg({ right: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "ai_response" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">System Prompt</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.system_prompt || "")}
              onChange={e => updateCfg({ system_prompt: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">User Prompt</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.user_prompt || "")}
              onChange={e => updateCfg({ user_prompt: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Salvar em variável (opcional)</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.variable_name || "")}
              onChange={e => updateCfg({ variable_name: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!cfg.send_to_user}
              onChange={e => updateCfg({ send_to_user: e.target.checked })} />
            Enviar resposta ao usuário
          </label>
        </>
      )}

      {step.type === "http_request" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Método</label>
            <select className={txt} style={txtStyle} value={String(cfg.method || "GET")}
              onChange={e => updateCfg({ method: e.target.value })}>
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">URL</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.url || "")}
              onChange={e => updateCfg({ url: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Body (JSON)</label>
            <textarea className={txt + " min-h-[60px] font-mono"} style={txtStyle}
              value={String(cfg.body || "")}
              onChange={e => updateCfg({ body: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Salvar resposta em</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.save_result || "")}
              onChange={e => updateCfg({ save_result: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Campo JSON (dot-path)</label>
            <input className={txt} style={txtStyle} placeholder="data.id"
              value={String(cfg.save_field || "")}
              onChange={e => updateCfg({ save_field: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "set_variable" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Nome</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.name || "")}
              onChange={e => updateCfg({ name: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Valor</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.value || "")}
              onChange={e => updateCfg({ value: e.target.value })} />
          </div>
        </>
      )}

      {(step.type === "add_tag" || step.type === "remove_tag") && (
        <div>
          <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Tag</label>
          <input className={txt} style={txtStyle}
            value={String(cfg.tag || "")}
            onChange={e => updateCfg({ tag: e.target.value })} />
        </div>
      )}

      {step.type === "media" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Tipo</label>
            <select className={txt} style={txtStyle} value={String(cfg.media_type || "image")}
              onChange={e => updateCfg({ media_type: e.target.value })}>
              {["image", "video", "audio", "document"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">URL</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.url || "")}
              onChange={e => updateCfg({ url: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Legenda</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.caption || "")}
              onChange={e => updateCfg({ caption: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "delay_days" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Dias</label>
            <input type="number" min={0} className={txt} style={txtStyle}
              value={Number(cfg.days || 0)}
              onChange={e => updateCfg({ days: Number(e.target.value) })} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Horas</label>
            <input type="number" min={0} max={23} className={txt} style={txtStyle}
              value={Number(cfg.hours || 0)}
              onChange={e => updateCfg({ hours: Number(e.target.value) })} />
          </div>
        </div>
      )}

      {step.type === "crm_update" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Campo</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.field || "")}
              onChange={e => updateCfg({ field: e.target.value })}
              placeholder="ex: name, email, phone" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Valor</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.value || "")}
              onChange={e => updateCfg({ value: e.target.value })}
              placeholder="{{last_input}}" />
          </div>
        </>
      )}

      {step.type === "send_email" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Para</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.to || "")}
              onChange={e => updateCfg({ to: e.target.value })}
              placeholder="{{contact.email}}" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Assunto</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.subject || "")}
              onChange={e => updateCfg({ subject: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Corpo</label>
            <textarea className={txt + " min-h-[80px]"} style={txtStyle}
              value={String(cfg.body || "")}
              onChange={e => updateCfg({ body: e.target.value })} />
          </div>
        </>
      )}

      <div className="pt-3 border-t border-[var(--surface-border)] flex gap-2">
        <button
          onClick={onSetStart}
          className="flex-1 text-[10px] py-2 rounded-lg font-medium"
          style={{ background: "rgba(0,212,106,0.15)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.3)" }}
        >
          {step.is_start_step ? "✓ É início" : "Definir como início"}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-2 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Inline journey name editor ───────────────────────────────────────────────
function JourneyNameEditor({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  const commit = () => {
    setEditing(false);
    const n = draft.trim();
    if (n && n !== name) onSave(n);
    else setDraft(name);
  };
  if (editing) return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setEditing(false); setDraft(name); }
      }}
      autoFocus
      style={{
        fontSize: 13, fontWeight: 600, background: "transparent", border: "none",
        borderBottom: "1px solid #00d46a", outline: "none",
        color: "rgba(255,255,255,0.9)", width: "100%", padding: "0 2px",
      }}
    />
  );
  return (
    <button
      onClick={() => setEditing(true)}
      title="Clique para renomear"
      style={{
        fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)",
        background: "none", border: "none", cursor: "pointer",
        textAlign: "left", padding: 0, maxWidth: "100%",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        display: "block", width: "100%",
      }}
    >
      {name}
    </button>
  );
}

// ─── Instance / Group pickers ────────────────────────────────────────────────
function InstancePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: instances = [], isLoading } = useQuery<any[]>({
    queryKey: ["builder-instances"],
    queryFn: async () => (await instancesApi.list()).data ?? [],
    staleTime: 60_000,
  });
  const current = instances.find((i: any) => i.id === value);
  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none cursor-pointer"
        style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
      >
        <option value="">— selecione —</option>
        {instances.map((i: any) => (
          <option key={i.id} value={i.id} style={{ background: "hsl(240 18% 8%)" }}>
            {i.name || i.phone_number || i.id}
            {i.status ? ` · ${i.status === "connected" ? "🟢" : "⚫"}` : ""}
          </option>
        ))}
      </select>
      {isLoading && <p className="text-[10px] mt-1 opacity-60">Carregando…</p>}
      {!isLoading && instances.length === 0 && (
        <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>Nenhuma instância encontrada.</p>
      )}
      {current && value && (
        <p className="text-[10px] mt-1 font-mono" style={{ color: "var(--text-3)" }}>
          id: {value.slice(0, 8)}…
        </p>
      )}
    </div>
  );
}

function GroupPicker({ value, onChange, instanceId }: { value: string; onChange: (v: string) => void; instanceId?: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["builder-groups", instanceId],
    queryFn: async () => instanceId ? (await groupsApi.list(instanceId)).data : null,
    enabled: !!instanceId,
    staleTime: 30_000,
  });
  const groups: any[] = Array.isArray(data?.groups) ? data.groups : [];
  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!instanceId}
        className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none cursor-pointer disabled:opacity-50"
        style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
      >
        <option value="">— selecione —</option>
        {groups.map((g: any) => (
          <option key={g.jid} value={g.jid} style={{ background: "hsl(240 18% 8%)" }}>
            {g.name || g.subject || g.jid}
          </option>
        ))}
      </select>
      {!instanceId && (
        <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
          Selecione uma instância primeiro.
        </p>
      )}
      {instanceId && isLoading && <p className="text-[10px] mt-1 opacity-60">Carregando grupos…</p>}
      {instanceId && !isLoading && groups.length === 0 && (
        <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>Nenhum grupo encontrado nesta instância.</p>
      )}
      {value && (
        <p className="text-[10px] mt-1 font-mono" style={{ color: "var(--text-3)" }}>jid: {value}</p>
      )}
    </div>
  );
}

// ─── Trigger types ────────────────────────────────────────────────────────────
const TRIGGER_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "any_message",            label: "Qualquer mensagem",      hint: "Dispara pra TODA mensagem recebida." },
  { value: "group_keyword",          label: "Palavra-chave em grupo", hint: "Filtra por grupo + keywords." },
  { value: "group_message",          label: "Mensagem em grupo",      hint: "Qualquer msg num grupo específico." },
  { value: "group_mention",          label: "Menção no grupo",        hint: "Quando mencionam a instância no grupo." },
  { value: "private_keyword",        label: "Palavra-chave privada",  hint: "Filtra DM por keywords." },
  { value: "private_message",        label: "Mensagem privada",       hint: "Toda mensagem direta." },
  { value: "first_message",          label: "Primeira mensagem",      hint: "Só na primeira interação do contato." },
  { value: "contact_media_image",    label: "Recebeu imagem",         hint: "Quando o contato envia imagem." },
  { value: "contact_media_audio",    label: "Recebeu áudio",          hint: "Quando o contato envia áudio." },
  { value: "contact_media_video",    label: "Recebeu vídeo",          hint: "Quando o contato envia vídeo." },
  { value: "contact_media_document", label: "Recebeu documento",      hint: "Quando o contato envia documento." },
  { value: "contact_location",       label: "Recebeu localização",    hint: "Quando o contato envia localização." },
  { value: "contact_call",           label: "Ligação recebida",       hint: "Qualquer ligação entrante." },
  { value: "contact_call_missed",    label: "Chamada perdida",        hint: "Ligou e ninguém atendeu." },
  { value: "contact_call_rejected",  label: "Chamada rejeitada",      hint: "Ligação rejeitada manualmente." },
  { value: "user_command",           label: "Comando (/start, /menu)",hint: "Comandos reservados no início da msg." },
  { value: "webhook",                label: "Webhook externo",        hint: "Dispara quando recebe um POST no endpoint do webhook desta jornada." },
  { value: "cron_schedule",          label: "Agendado (Cron)",        hint: "Dispara em horário fixo. Configure a expressão cron no campo abaixo." },
  { value: "contact_tag_added",      label: "Tag adicionada",         hint: "Dispara quando uma tag específica é adicionada ao contato." },
  { value: "contact_tag_removed",    label: "Tag removida",           hint: "Dispara quando uma tag específica é removida do contato." },
  { value: "deal_stage_changed",     label: "Estágio CRM mudou (legacy)", hint: "DEPRECATED — use deal_stage_enter abaixo." },
  // CRM v2 — triggers granulares de Deal lifecycle. trigger_filter
  // (JSON) aceita { funnel_id, stage_id, status, min_value, max_value }.
  { value: "deal_stage_enter",       label: "Deal entrou em estágio", hint: "Quando um deal cai num stage específico (CRM v2). Filtre por funnel_id + stage_id." },
  { value: "deal_stage_exit",        label: "Deal saiu de estágio",   hint: "Quando um deal sai de determinado stage (CRM v2)." },
  { value: "deal_created",           label: "Deal criado",            hint: "Quando um novo deal é criado (CRM v2). Pode filtrar por funnel_id." },
  { value: "deal_won",               label: "Deal ganho",             hint: "Quando um deal vira status=won (CRM v2)." },
  { value: "deal_lost",              label: "Deal perdido",           hint: "Quando um deal vira status=lost (CRM v2)." },
  { value: "order_placed",           label: "Pedido realizado",       hint: "Dispara quando um pedido é criado na loja." },
  { value: "order_shipped",          label: "Pedido enviado",         hint: "Dispara quando um pedido tem status 'enviado'." },
  { value: "contact_birthday",       label: "Aniversário do contato", hint: "Dispara no aniversário do contato (campo birthday no CRM)." },
];

// ─── Trigger panel ────────────────────────────────────────────────────────────
function TriggerPanel({
  journeyId, initial, onSaved,
}: {
  journeyId: string;
  initial: JourneyMeta | null;
  onSaved: (next: Partial<JourneyMeta & { status: string }>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [triggerType, setTriggerType] = useState(initial?.trigger_type ?? "any_message");
  const [keywordsStr, setKeywordsStr] = useState(
    Array.isArray(initial?.keywords) ? (initial!.keywords as string[]).join(", ") : (initial?.keywords as string | undefined ?? ""),
  );
  const [instanceId, setInstanceId] = useState(initial?.instance_id ?? "");
  const [groupJID, setGroupJID] = useState(initial?.group_jid ?? "");
  const [responseMode, setResponseMode] = useState(initial?.response_mode ?? "private");
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  // Customer.io-inspired: goal tracking + exit conditions + re-entry rule
  const [goalEvent, setGoalEvent] = useState(initial?.goal_event ?? "");
  const [exitConditionsRaw, setExitConditionsRaw] = useState(initial?.exit_conditions ?? "[]");
  const [reEntryRule, setReEntryRule] = useState(initial?.re_entry_rule ?? "never");
  // New fields
  const [cronExpr, setCronExpr] = useState((initial as any)?.cron_expr ?? "");
  const [tagName, setTagName] = useState((initial as any)?.tag_name ?? "");
  // CRM v2 deal-trigger filter — parseado do trigger_filter JSON.
  const initialDealFilter = (() => {
    try {
      const raw = initial?.trigger_filter ?? "";
      if (!raw) return null;
      return JSON.parse(raw) as { funnel_id?: string; stage_id?: string; status?: string };
    } catch { return null; }
  })();
  const [dealFunnelId, setDealFunnelId] = useState(initialDealFilter?.funnel_id ?? "");
  const [dealStageId, setDealStageId] = useState(initialDealFilter?.stage_id ?? "");
  const [dealStatus, setDealStatus] = useState(initialDealFilter?.status ?? "");

  // Re-sync quando a jornada externa recarrega
  useEffect(() => {
    if (!initial) return;
    setName(initial.name ?? "");
    setTriggerType(initial.trigger_type ?? "any_message");
    setKeywordsStr(
      Array.isArray(initial.keywords) ? (initial.keywords as string[]).join(", ") : ((initial.keywords as string | undefined) ?? ""),
    );
    setInstanceId(initial.instance_id ?? "");
    setGroupJID(initial.group_jid ?? "");
    setResponseMode(initial.response_mode ?? "private");
    setGoalEvent(initial.goal_event ?? "");
    setExitConditionsRaw(initial.exit_conditions ?? "[]");
    setReEntryRule(initial.re_entry_rule ?? "never");
    setCronExpr((initial as any)?.cron_expr ?? "");
    setTagName((initial as any)?.tag_name ?? "");
  }, [initial]);

  const needsKeywords = triggerType === "group_keyword" || triggerType === "private_keyword" || triggerType === "user_command";
  const needsGroup = triggerType.startsWith("group_");
  const isDealTrigger = triggerType.startsWith("deal_");

  const inputClass = "w-full rounded-lg px-2.5 py-1.5 text-sm outline-none";
  const inputStyle: React.CSSProperties = { background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" };

  const persist = async () => {
    setSaving(true);
    try {
      const keywords = needsKeywords
        ? keywordsStr.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      // CRM v2 deal triggers serializam dealFunnel/Stage/Status num
      // JSON pra trigger_filter — backend usa pra filtrar journey
      // dispatch via CrmJourneyDispatcher.matchesFilter.
      let triggerFilter = "";
      if (isDealTrigger) {
        const f: Record<string, unknown> = {};
        if (dealFunnelId) f.funnel_id = dealFunnelId;
        if (dealStageId) f.stage_id = dealStageId;
        if (dealStatus) f.status = dealStatus;
        triggerFilter = Object.keys(f).length > 0 ? JSON.stringify(f) : "";
      }
      const res = await journeysApi.updateTrigger(journeyId, {
        name: name.trim() || undefined,
        trigger_type: triggerType,
        trigger_filter: triggerFilter,
        keywords,
        group_jid: needsGroup ? groupJID : "",
        instance_id: instanceId,
        response_mode: responseMode,
        goal_event: goalEvent.trim() || "",
        exit_conditions: exitConditionsRaw,
        re_entry_rule: reEntryRule,
        cron_expr: triggerType === "cron_schedule" ? cronExpr.trim() : undefined,
        tag_name: (triggerType === "contact_tag_added" || triggerType === "contact_tag_removed") ? tagName.trim() : undefined,
      } as any);
      toast.success("Gatilho salvo ✓");
      onSaved({
        name: res.data?.name,
        trigger_type: res.data?.trigger_type,
        trigger_filter: res.data?.trigger_filter,
        keywords: res.data?.keywords,
        group_jid: res.data?.group_jid,
        instance_id: res.data?.instance_id,
        response_mode: res.data?.response_mode,
      });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Falha ao salvar gatilho";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    const next = initial?.status === "active" ? "paused" : "active";
    setTogglingStatus(true);
    try {
      await journeysApi.updateStatus(journeyId, next);
      toast.success(next === "active" ? "Jornada ativada" : "Jornada pausada");
      onSaved({ status: next });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Falha ao alterar status";
      toast.error(msg);
    } finally {
      setTogglingStatus(false);
    }
  };

  const currentType = TRIGGER_TYPES.find((t) => t.value === triggerType) || TRIGGER_TYPES[0];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Onboarding B2B"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Tipo de gatilho</label>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value)}
          className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none cursor-pointer"
          style={inputStyle}
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t.value} value={t.value} style={{ background: "hsl(240 18% 8%)" }}>{t.label}</option>
          ))}
        </select>
        <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>{currentType.hint}</p>
      </div>

      {needsKeywords && (
        <div>
          <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">
            Palavras-chave (separadas por vírgula)
          </label>
          <input
            value={keywordsStr}
            onChange={(e) => setKeywordsStr(e.target.value)}
            placeholder="ex: teste, oi, menu"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      )}

      {needsGroup && (
        <div>
          <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Grupo WhatsApp</label>
          <GroupPicker value={groupJID} onChange={setGroupJID} instanceId={instanceId} />
        </div>
      )}

      <div>
        <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Instância WhatsApp</label>
        <InstancePicker value={instanceId} onChange={setInstanceId} />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Resposta padrão</label>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
          {[["private", "Privado"], ["group", "No grupo"]].map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => setResponseMode(v)}
              className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: responseMode === v ? "var(--green)" : "transparent",
                color: responseMode === v ? "white" : "var(--text-2)",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Cron & Webhook fields ─────────────────────────────────── */}
      {triggerType === "cron_schedule" && (
        <div>
          <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Expressão Cron</label>
          <input
            value={cronExpr}
            onChange={e => setCronExpr(e.target.value)}
            placeholder="0 9 * * 1 (toda segunda 9h)"
            className={inputClass}
            style={inputStyle}
          />
          <p style={{ fontSize: 9, marginTop: 4, opacity: 0.5, color: "var(--text-3)" }}>
            Ex: "0 9 * * 1" = toda segunda 9h · "0 8 1 * *" = dia 1 de cada mês 8h
          </p>
        </div>
      )}

      {triggerType === "webhook" && (
        <div>
          <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Endpoint do Webhook</label>
          <div style={{
            padding: "6px 10px", borderRadius: 8,
            background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.20)",
            fontSize: 10, fontFamily: "monospace", color: "#a78bfa", wordBreak: "break-all",
          }}>
            POST /v1/journeys/{journeyId}/webhook
          </div>
          <p style={{ fontSize: 9, marginTop: 4, opacity: 0.5, color: "var(--text-3)" }}>
            Envie um POST para este endpoint com os dados do evento. Os campos do body ficam disponíveis como {"{{"}webhook.campo{"}}"}
          </p>
        </div>
      )}

      {(triggerType === "contact_tag_added" || triggerType === "contact_tag_removed") && (
        <div>
          <label className="text-[10px] uppercase tracking-wider font-medium mb-1 block opacity-60">Nome da Tag</label>
          <input
            value={tagName}
            onChange={e => setTagName(e.target.value)}
            placeholder="ex: cliente-vip, pagou, churned"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      )}

      {/* CRM v2 — filtros de deal lifecycle. Vazios = dispara pra
          todos deals; preenche pra escopar (ex: só funil X stage Y). */}
      {isDealTrigger && (
        <div className="space-y-2 rounded-lg p-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <p className="text-[10px] uppercase tracking-wider font-medium opacity-60">
            Filtrar deals
          </p>
          <div>
            <label className="text-[10px] block mb-1 opacity-60">Funil (opcional)</label>
            <FunnelOptionPicker value={dealFunnelId}
              onChange={(v) => { setDealFunnelId(v); setDealStageId(""); }} />
          </div>
          {dealFunnelId && (triggerType === "deal_stage_enter" || triggerType === "deal_stage_exit") && (
            <div>
              <label className="text-[10px] block mb-1 opacity-60">Estágio (opcional)</label>
              <StageOptionPicker funnelId={dealFunnelId} value={dealStageId}
                onChange={setDealStageId} />
            </div>
          )}
          {(triggerType === "deal_created" || triggerType === "deal_stage_enter") && (
            <div>
              <label className="text-[10px] block mb-1 opacity-60">Status (opcional)</label>
              <select value={dealStatus} onChange={(e) => setDealStatus(e.target.value)}
                className={inputClass} style={inputStyle}>
                <option value="">Qualquer status</option>
                <option value="open">Aberto</option>
                <option value="won">Ganho</option>
                <option value="lost">Perdido</option>
              </select>
            </div>
          )}
          <p className="text-[10px] opacity-50">
            Sem filtros = dispara em qualquer deal.
          </p>
        </div>
      )}

      {/* ─── Goals & Lifecycle (Customer.io-inspired) ─────────────── */}
      <div className="pt-3 mt-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
        <p className="text-[10px] uppercase tracking-wider font-medium mb-2 opacity-60">Goals & Lifecycle</p>

        <div className="mb-2">
          <label className="text-[10px] block mb-1 opacity-60">Goal event (incrementa contagem quando ocorre)</label>
          <input value={goalEvent} onChange={(e) => setGoalEvent(e.target.value)}
            placeholder="ex: deal.won, shop.order_paid, tag.added:vip"
            className="w-full rounded-lg px-2.5 py-1.5 text-sm font-mono outline-none"
            style={inputStyle} />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
            Conversões: <span className="font-mono">{initial?.goal_count ?? 0}</span>
          </p>
        </div>

        <div className="mb-2">
          <label className="text-[10px] block mb-1 opacity-60">Re-entry rule</label>
          <select value={reEntryRule} onChange={(e) => setReEntryRule(e.target.value)}
            className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
            style={inputStyle}>
            <option value="never">Apenas uma vez por contato</option>
            <option value="always">Sempre (entra de novo a cada trigger)</option>
            <option value="after_days:7">Após 7 dias do último run</option>
            <option value="after_days:30">Após 30 dias do último run</option>
            <option value="after_days:90">Após 90 dias do último run</option>
          </select>
        </div>

        <div className="mb-2">
          <label className="text-[10px] block mb-1 opacity-60">
            Exit conditions (JSON array — encerra execução)
          </label>
          <textarea value={exitConditionsRaw}
            onChange={(e) => setExitConditionsRaw(e.target.value)}
            rows={3}
            placeholder='[{"event":"deal.won"},{"event_prefix":"tag.added:cliente"}]'
            className="w-full rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none"
            style={inputStyle} />
        </div>
      </div>

      <div className="pt-2 flex gap-2">
        <button
          onClick={persist}
          disabled={saving}
          className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: "var(--green)", color: "white", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar gatilho
        </button>
        <button
          onClick={toggleStatus}
          disabled={togglingStatus}
          className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
          style={{
            background: initial?.status === "active" ? "rgba(239,68,68,0.12)" : "rgba(0,212,106,0.12)",
            color: initial?.status === "active" ? "#ef4444" : "var(--green)",
            border: `1px solid ${initial?.status === "active" ? "rgba(239,68,68,0.3)" : "rgba(0,212,106,0.3)"}`,
          }}
        >
          {togglingStatus ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : initial?.status === "active" ? <X className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
          {initial?.status === "active" ? "Pausar" : "Ativar"}
        </button>
      </div>
    </div>
  );
}

// ─── Simulator panel ──────────────────────────────────────────────────────────
function SimulatorPanel({ journeyId }: { journeyId: string }) {
  const [input, setInput] = useState("oi");
  const [contact, setContact] = useState("João Teste");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await journeysApi.simulate(journeyId, input, contact);
      setResult(res.data);
    } catch (e) {
      toast.error("Falha na simulação");
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const events = (result as { events?: Array<Record<string, unknown>> })?.events || [];

  return (
    <div className="p-4 space-y-3">
      <div>
        <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Mensagem do usuário</label>
        <input className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
          value={input} onChange={e => setInput(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] uppercase font-semibold opacity-60 block mb-1">Nome do contato</label>
        <input className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
          value={contact} onChange={e => setContact(e.target.value)} />
      </div>
      <button
        onClick={run} disabled={loading}
        className="w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2"
        style={{ background: "var(--green)", color: "white", opacity: loading ? 0.7 : 1 }}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
        Simular execução
      </button>

      {events.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] uppercase font-semibold opacity-60 mb-2">Eventos ({events.length})</p>
          <div className="space-y-1.5">
            {events.map((ev, i) => (
              <div key={i} className="p-2 rounded-lg text-[10px]"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-semibold" style={{ color: "var(--green)" }}>{String(ev.action)}</span>
                  <span className="opacity-50">{String(ev.step_id)}</span>
                </div>
                <pre className="opacity-70 whitespace-pre-wrap break-all">
                  {JSON.stringify(ev.payload, null, 1)}
                </pre>
              </div>
            ))}
          </div>
          {(result as { waiting_for?: string })?.waiting_for && (
            <p className="mt-2 text-[10px] opacity-60">
              ⏸ Aguardando input no step: <b>{(result as { waiting_for: string }).waiting_for}</b>
            </p>
          )}
          {(result as { error?: string })?.error && (
            <p className="mt-2 text-[10px]" style={{ color: "#ef4444" }}>
              ✗ {(result as { error: string }).error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Seed flow ────────────────────────────────────────────────────────────────
function seedFlow(): JourneyFlow {
  return {
    start_step: "s1",
    steps: [
      {
        id: "s1",
        type: "message",
        label: "Mensagem de boas-vindas",
        is_start_step: true,
        config: { message: "Olá {{name}}! 👋", mode: "private" },
      },
    ],
  };
}

// ─── Main builder page ────────────────────────────────────────────────────────
interface JourneyMeta {
  name?: string;
  status?: string;
  trigger_type?: string;
  trigger_filter?: string;
  keywords?: string[] | string;
  group_jid?: string;
  instance_id?: string;
  response_mode?: string;
  // Customer.io-inspired
  goal_event?: string;
  goal_count?: number;
  exit_conditions?: string;
  re_entry_rule?: string;
}

function BuilderCanvas() {
  const params = useParams();
  const router = useRouter();
  const journeyId = String(params.id);

  const [journey, setJourney] = useState<JourneyMeta | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmPrompt, setLlmPrompt] = useState("");
  const [rightTab, setRightTab] = useState<"config" | "trigger" | "simulate">("config");
  const llmInputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await journeysApi.get(journeyId);
      const data = res.data;
      const j = data.journey || {};
      setJourney({
        name: j.name,
        status: j.status,
        trigger_type: j.trigger_type,
        trigger_filter: j.trigger_filter,
        keywords: data.keywords ?? j.keywords,
        group_jid: j.group_jid,
        instance_id: j.instance_id,
        response_mode: j.response_mode,
      });
      const flow: JourneyFlow | null = data.flow || j.flow || null;
      const effective = flow && Array.isArray(flow.steps) && flow.steps.length > 0 ? flow : seedFlow();
      const { nodes: ns, edges: es } = flowToGraph(effective);
      setNodes(ns);
      setEdges(es);
      setSavedOnce(!!flow && Array.isArray(flow.steps) && flow.steps.length > 0);
      setDirty(!flow || !Array.isArray(flow.steps) || flow.steps.length === 0);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Falha ao carregar jornada";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [journeyId, setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  const onConnect = useCallback(
    (conn: Connection) => {
      const color = conn.sourceHandle === "true" ? "#10b981"
        : conn.sourceHandle === "false" ? "#ef4444" : "rgba(255,255,255,0.25)";
      const label = conn.sourceHandle === "true" ? "sim"
        : conn.sourceHandle === "false" ? "não" : undefined;
      setEdges(es => addEdge({
        ...conn,
        type: "smoothstep",
        label,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2 },
      }, es));
      setDirty(true);
    },
    [setEdges],
  );

  const addStep = (type: StepType) => {
    const id = `s_${Math.random().toString(36).slice(2, 8)}`;
    const newStep: FlowStep = {
      id,
      type,
      label: STEP_META[type].label,
      config: { ...STEP_META[type].defaultConfig },
      is_start_step: nodes.length === 0,
    };
    setNodes(ns => [
      ...ns,
      {
        id,
        type: "flowStep",
        position: { x: Math.random() * 300, y: Math.random() * 200 },
        data: { step: newStep, preview: stepPreview(newStep) },
      },
    ]);
    setSelectedId(id);
    setDirty(true);
  };

  const selectedStep: FlowStep | null = useMemo(() => {
    if (!selectedId) return null;
    const n = nodes.find(x => x.id === selectedId);
    return (n?.data.step as FlowStep) || null;
  }, [nodes, selectedId]);

  const updateStep = (updated: FlowStep) => {
    setNodes(ns => ns.map(n =>
      n.id === updated.id
        ? { ...n, data: { step: updated, preview: stepPreview(updated) } }
        : n,
    ));
    setDirty(true);
  };

  const deleteStep = () => {
    if (!selectedId) return;
    setNodes(ns => ns.filter(n => n.id !== selectedId));
    setEdges(es => es.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    setDirty(true);
  };

  const setStartStep = () => {
    if (!selectedId) return;
    setNodes(ns => ns.map(n => ({
      ...n,
      data: {
        ...n.data,
        step: { ...(n.data.step as FlowStep), is_start_step: n.id === selectedId },
      },
    })));
    setDirty(true);
  };

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    if (changes.some((c) => c.type === "position" || c.type === "remove" || c.type === "dimensions")) {
      setDirty(true);
    }
  }, [onNodesChange]);

  const handleEdgesChange: typeof onEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    if (changes.some((c) => c.type === "remove")) setDirty(true);
  }, [onEdgesChange]);

  const save = async () => {
    setSaving(true);
    try {
      const flow = graphToFlow(nodes, edges);
      if (!flow.steps.length) {
        toast.error("Flow vazio — adicione ao menos um step antes de salvar.");
        return;
      }
      await journeysApi.updateFlow(journeyId, flow);
      toast.success("Jornada salva ✓");
      setSavedOnce(true);
      setDirty(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (e as { message?: string })?.message
        || "Falha ao salvar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const markDirty = useCallback(() => setDirty(true), []);

  const editWithLLM = async (info?: MentionPickerHandles) => {
    const raw = (info?.value ?? llmPrompt).trim();
    if (!raw) return;
    const rendered = info?.renderedText?.trim() || raw;
    const mentions = info?.mentions ?? [];
    setLlmBusy(true);
    try {
      const currentFlow = graphToFlow(nodes, edges);
      if (currentFlow.steps.length > 0) {
        await journeysApi.updateFlow(journeyId, currentFlow);
      }
      const res = await journeysApi.editWithLLM(journeyId, raw, undefined, {
        rendered_text: rendered,
        mentions,
      });
      const newFlow: JourneyFlow | null = res.data?.flow || null;
      if (newFlow) {
        const { nodes: ns, edges: es } = flowToGraph(newFlow);
        setNodes(ns);
        setEdges(es);
        toast.success("Fluxo atualizado pela IA");
        setLlmPrompt("");
        setDirty(true);
      } else {
        toast.error("IA não retornou fluxo válido");
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || "Falha ao editar via IA";
      toast.error(msg);
    } finally {
      setLlmBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--surface-1)" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--surface-1)", color: "var(--text-1)" }}>
      {/* Topbar */}
      <div className="h-14 flex items-center px-4 gap-3 border-b"
        style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
        <button
          onClick={async () => {
            if (dirty && !(await showConfirm("Você tem alterações não salvas. Sair mesmo assim?", { title: "Sair sem salvar", confirmLabel: "Sair" }))) return;
            router.push("/journeys");
          }}
          className="p-1.5 rounded-lg hover:bg-[var(--surface-3)]"
          title="Voltar para Jornadas"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Name — editable inline */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.4, marginBottom: 2 }}>
            Flow Builder
          </p>
          <JourneyNameEditor
            name={journey?.name || "Jornada sem nome"}
            onSave={async (next) => {
              try {
                await journeysApi.updateTrigger(journeyId, { name: next } as any);
                setJourney(j => ({ ...j, name: next }));
                toast.success("Nome atualizado");
              } catch { toast.error("Falha ao renomear"); }
            }}
          />
        </div>

        {/* Save state indicator */}
        <div className="text-[10px] px-2 py-1 rounded-md font-medium flex items-center gap-1"
          style={{
            background: dirty ? "rgba(234,179,8,0.12)" : "rgba(0,212,106,0.12)",
            color: dirty ? "#eab308" : "var(--green)",
          }}
          title={dirty ? "Alterações não salvas" : "Tudo salvo"}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: dirty ? "#eab308" : "var(--green)" }} />
          {dirty ? "Não salvo" : savedOnce ? "Salvo" : "Pronto para salvar"}
        </div>

        {/* Status badge with animated dot for active */}
        <div className="text-[10px] px-2 py-1 rounded-md flex items-center gap-1"
          style={{
            background: journey?.status === "active" ? "rgba(0,212,106,0.15)" : "rgba(234,179,8,0.15)",
            color: journey?.status === "active" ? "var(--green)" : "#eab308",
          }}>
          {journey?.status === "active" && (
            <span className="relative flex w-1.5 h-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: "var(--green)" }} />
              <span className="relative inline-flex rounded-full w-1.5 h-1.5"
                style={{ background: "var(--green)" }} />
            </span>
          )}
          {journey?.status}
        </div>

        {/* Step count pill */}
        <div style={{
          fontSize: 10, padding: "4px 8px", borderRadius: 6,
          background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {nodes.length} step{nodes.length !== 1 ? "s" : ""}
        </div>

        <button onClick={save} disabled={saving || !dirty}
          className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-opacity"
          style={{
            background: "var(--green)",
            color: "white",
            opacity: saving ? 0.7 : dirty ? 1 : 0.4,
            cursor: saving || !dirty ? "default" : "pointer",
          }}
          title={dirty ? "Salvar alterações" : "Nada para salvar"}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar
        </button>
      </div>

      {/* Main area: library | canvas | right panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: step library */}
        <div className="w-[220px] flex-shrink-0 border-r overflow-hidden"
          style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
          <StepLibrary onAdd={addStep} />
        </div>

        {/* Center: canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            minZoom={0.2}
            maxZoom={2}
            colorMode="dark"
          >
            <Background color="rgba(255,255,255,0.04)" gap={24} size={1} />
            <Controls className="!bg-[var(--surface-2)] !border-[var(--surface-border)]" />
            <MiniMap className="!bg-[var(--surface-2)]" nodeColor={(n) => {
              const s = n.data?.step as FlowStep | undefined;
              return s ? STEP_META[s.type]?.color || "#666" : "#666";
            }} />
          </ReactFlow>

          {/* LLM edit bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(720px,calc(100%-2rem))]"
            style={{ zIndex: 10 }}>
            <div style={{
              borderRadius: 20, overflow: "hidden",
              background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
              backdropFilter: "blur(24px) saturate(200%)",
              WebkitBackdropFilter: "blur(24px) saturate(200%)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.10)",
            }}>
              <div className="flex items-center gap-2 px-4 pt-2 text-[10px] uppercase tracking-wider"
                style={{ color: "var(--text-3)" }}>
                <Sparkles className="w-3 h-3" style={{ color: "var(--green)" }} />
                Editar com IA — <b>/</b> abre categorias (passo, palavra, gatilho…)
                {llmBusy && <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: "var(--green)" }} />}
              </div>
              <MentionPicker
                value={llmPrompt}
                onChange={(v) => setLlmPrompt(v)}
                onSend={(info) => editWithLLM(info)}
                placeholder="Ex: adicione um /passo pedindo email depois do primeiro passo; responda /palavra preco com tabela"
                disabled={llmBusy}
                isLoading={llmBusy}
                extraSteps={nodes.map((n) => {
                  const s = n.data?.step as FlowStep | undefined;
                  const label = s?.label || s?.id || n.id;
                  return {
                    type: "step" as const,
                    id: s?.id || n.id,
                    label: `#${s?.id || n.id} · ${label}`,
                    meta: s?.type ? { step_type: s.type, existing: "true" } : { existing: "true" },
                  };
                })}
              />
            </div>
          </div>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center opacity-60">
                <Zap className="w-10 h-10 mx-auto mb-2" style={{ color: "var(--green)" }} />
                <p className="text-sm">Canvas vazio</p>
                <p className="text-xs mt-1">Adicione um step pelo menu à esquerda ou use a IA abaixo</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: config / trigger / simulate */}
        <div className="w-[320px] flex-shrink-0 border-l flex flex-col"
          style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
          <div className="flex border-b" style={{ borderColor: "var(--surface-border)" }}>
            {(["config", "trigger", "simulate"] as const).map(t => (
              <button
                key={t}
                onClick={() => setRightTab(t)}
                className={cn("flex-1 py-2.5 text-xs font-medium transition-colors",
                  rightTab === t ? "" : "opacity-50")}
                style={{
                  borderBottom: rightTab === t ? "2px solid var(--green)" : "2px solid transparent",
                  color: rightTab === t ? "var(--text-1)" : "var(--text-2)",
                }}
              >
                {t === "config" ? "Step" : t === "trigger" ? "Gatilho" : "Simulador"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === "config" ? (
              <ConfigPanel
                step={selectedStep}
                onChange={updateStep}
                onDelete={deleteStep}
                onSetStart={setStartStep}
              />
            ) : rightTab === "trigger" ? (
              <TriggerPanel
                journeyId={journeyId}
                initial={journey}
                onSaved={(next) => setJourney((j) => ({ ...j, ...next }))}
              />
            ) : (
              <SimulatorPanel journeyId={journeyId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <ReactFlowProvider>
      <BuilderCanvas />
    </ReactFlowProvider>
  );
}
