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
} from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
type StepType =
  | "message" | "buttons" | "list" | "input" | "wait" | "condition"
  | "ai_response" | "http_request" | "media" | "handoff" | "goto"
  | "randomize" | "set_variable" | "add_tag" | "remove_tag"
  | "update_stage" | "end";

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
};

// ─── Custom node ──────────────────────────────────────────────────────────────
function FlowNode({ data, selected }: NodeProps) {
  const step = data.step as FlowStep;
  const meta = STEP_META[step.type] || STEP_META.message;
  const Icon = meta.icon;
  const preview = data.preview as string | undefined;

  return (
    <div
      className="rounded-xl px-3 py-2.5 min-w-[200px] max-w-[240px] shadow-sm"
      style={{
        background: "var(--surface-2, #1a1a1a)",
        border: `2px solid ${selected ? meta.color : "var(--surface-border, #2a2a2a)"}`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: meta.color, width: 8, height: 8 }} />

      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: meta.bg, border: `1px solid ${meta.color}44` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase font-bold tracking-wide opacity-60">{meta.label}</p>
          <p className="text-xs font-semibold truncate" style={{ color: "var(--text-1)" }}>
            {step.label || meta.label}
          </p>
        </div>
        {step.is_start_step && (
          <div className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,212,106,0.15)", color: "var(--green)" }}>
            INÍCIO
          </div>
        )}
      </div>

      {preview && (
        <p className="text-[10px] opacity-60 line-clamp-2 mt-1" style={{ color: "var(--text-2)" }}>
          {preview}
        </p>
      )}

      {meta.hasTwoBranches ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true"
            style={{ background: "#10b981", left: "30%", width: 10, height: 10 }} />
          <Handle type="source" position={Position.Bottom} id="false"
            style={{ background: "#ef4444", left: "70%", width: 10, height: 10 }} />
          <div className="flex justify-between mt-2 text-[9px] opacity-70 px-1">
            <span style={{ color: "#10b981" }}>✓ sim</span>
            <span style={{ color: "#ef4444" }}>✗ não</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} style={{ background: meta.color, width: 8, height: 8 }} />
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
    if (s.next_step_id && byId.has(s.next_step_id)) {
      edges.push({
        id: `${s.id}-next-${s.next_step_id}`,
        source: s.id,
        target: s.next_step_id,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#666" },
        style: { stroke: "#666", strokeWidth: 2 },
      });
    }
    if (s.branch_true && byId.has(s.branch_true)) {
      edges.push({
        id: `${s.id}-true-${s.branch_true}`,
        source: s.id, sourceHandle: "true",
        target: s.branch_true,
        type: "smoothstep",
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

// ─── Step library (sidebar) ───────────────────────────────────────────────────
function StepLibrary({ onAdd }: { onAdd: (type: StepType) => void }) {
  const types: StepType[] = [
    "message", "buttons", "list", "input", "wait", "condition",
    "ai_response", "http_request", "media", "handoff", "goto",
    "randomize", "set_variable", "add_tag", "remove_tag", "update_stage", "end",
  ];
  return (
    <div className="p-3 overflow-y-auto h-full">
      <p className="text-[10px] uppercase font-bold opacity-60 mb-2 px-1">Adicionar Step</p>
      <div className="grid grid-cols-2 gap-1.5">
        {types.map(t => {
          const meta = STEP_META[t];
          const Icon = meta.icon;
          return (
            <button
              key={t}
              onClick={() => onAdd(t)}
              className="flex flex-col items-center gap-1 p-2 rounded-lg text-center transition-all hover:scale-[1.03]"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: meta.bg, border: `1px solid ${meta.color}33` }}>
                <Icon className="w-4 h-4" style={{ color: meta.color }} />
              </div>
              <span className="text-[10px] font-semibold" style={{ color: "var(--text-1)" }}>{meta.label}</span>
            </button>
          );
        })}
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
          <p className="text-[10px] uppercase font-bold opacity-60">{meta.label}</p>
          <p className="text-xs font-semibold">{step.label || meta.label}</p>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Rótulo</label>
        <input className={txt} style={txtStyle} value={step.label || ""}
          onChange={e => update({ label: e.target.value })} />
      </div>
      <div>
        <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">ID</label>
        <input className={txt} style={{ ...txtStyle, opacity: 0.6 }} value={step.id} disabled />
      </div>

      {/* Config fields per type */}
      {(step.type === "message" || step.type === "handoff") && (
        <div>
          <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Mensagem</label>
          <textarea className={txt + " min-h-[80px]"} style={txtStyle}
            value={String(cfg.message || "")}
            onChange={e => updateCfg({ message: e.target.value })} />
          <p className="text-[9px] opacity-50 mt-1">Placeholders: {"{{name}}"}, {"{{last_input}}"}, {"{{flow.var}}"}</p>
        </div>
      )}

      {step.type === "buttons" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Mensagem</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.message || "")}
              onChange={e => updateCfg({ message: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Botões</label>
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
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Pergunta</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.prompt || "")}
              onChange={e => updateCfg({ prompt: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Salvar em variável</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.variable_name || "")}
              onChange={e => updateCfg({ variable_name: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "wait" && (
        <div>
          <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Duração</label>
          <input className={txt} style={txtStyle} placeholder="5s, 2m, 1h"
            value={String(cfg.duration || "")}
            onChange={e => updateCfg({ duration: e.target.value })} />
        </div>
      )}

      {step.type === "condition" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Valor esquerdo</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.left || "")} placeholder="{{last_input}}"
              onChange={e => updateCfg({ left: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Operador</label>
            <select className={txt} style={txtStyle}
              value={String(cfg.operator || "eq")}
              onChange={e => updateCfg({ operator: e.target.value })}>
              {["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "exists", "empty", "regex", "gt", "lt", "gte", "lte"].map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Valor direito</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.right || "")}
              onChange={e => updateCfg({ right: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "ai_response" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">System Prompt</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.system_prompt || "")}
              onChange={e => updateCfg({ system_prompt: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">User Prompt</label>
            <textarea className={txt + " min-h-[60px]"} style={txtStyle}
              value={String(cfg.user_prompt || "")}
              onChange={e => updateCfg({ user_prompt: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Salvar em variável (opcional)</label>
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
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Método</label>
            <select className={txt} style={txtStyle} value={String(cfg.method || "GET")}
              onChange={e => updateCfg({ method: e.target.value })}>
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">URL</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.url || "")}
              onChange={e => updateCfg({ url: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Body (JSON)</label>
            <textarea className={txt + " min-h-[60px] font-mono"} style={txtStyle}
              value={String(cfg.body || "")}
              onChange={e => updateCfg({ body: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Salvar resposta em</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.save_result || "")}
              onChange={e => updateCfg({ save_result: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Campo JSON (dot-path)</label>
            <input className={txt} style={txtStyle} placeholder="data.id"
              value={String(cfg.save_field || "")}
              onChange={e => updateCfg({ save_field: e.target.value })} />
          </div>
        </>
      )}

      {step.type === "set_variable" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Nome</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.name || "")}
              onChange={e => updateCfg({ name: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Valor</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.value || "")}
              onChange={e => updateCfg({ value: e.target.value })} />
          </div>
        </>
      )}

      {(step.type === "add_tag" || step.type === "remove_tag") && (
        <div>
          <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Tag</label>
          <input className={txt} style={txtStyle}
            value={String(cfg.tag || "")}
            onChange={e => updateCfg({ tag: e.target.value })} />
        </div>
      )}

      {step.type === "media" && (
        <>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Tipo</label>
            <select className={txt} style={txtStyle} value={String(cfg.media_type || "image")}
              onChange={e => updateCfg({ media_type: e.target.value })}>
              {["image", "video", "audio", "document"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">URL</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.url || "")}
              onChange={e => updateCfg({ url: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Legenda</label>
            <input className={txt} style={txtStyle}
              value={String(cfg.caption || "")}
              onChange={e => updateCfg({ caption: e.target.value })} />
          </div>
        </>
      )}

      <div className="pt-3 border-t border-[var(--surface-border)] flex gap-2">
        <button
          onClick={onSetStart}
          className="flex-1 text-[10px] py-2 rounded-lg font-semibold"
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
        <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Mensagem do usuário</label>
        <input className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
          value={input} onChange={e => setInput(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Nome do contato</label>
        <input className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
          value={contact} onChange={e => setContact(e.target.value)} />
      </div>
      <button
        onClick={run} disabled={loading}
        className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2"
        style={{ background: "var(--green)", color: "white", opacity: loading ? 0.7 : 1 }}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
        Simular execução
      </button>

      {events.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] uppercase font-bold opacity-60 mb-2">Eventos ({events.length})</p>
          <div className="space-y-1.5">
            {events.map((ev, i) => (
              <div key={i} className="p-2 rounded-lg text-[10px]"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-bold" style={{ color: "var(--green)" }}>{String(ev.action)}</span>
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

// ─── Main builder page ────────────────────────────────────────────────────────
function BuilderCanvas() {
  const params = useParams();
  const router = useRouter();
  const journeyId = String(params.id);

  const [journey, setJourney] = useState<{ name?: string; status?: string } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmPrompt, setLlmPrompt] = useState("");
  const [rightTab, setRightTab] = useState<"config" | "simulate">("config");
  const llmInputRef = useRef<HTMLTextAreaElement>(null);

  // Carregar journey + flow
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await journeysApi.get(journeyId);
      const data = res.data;
      setJourney({ name: data.journey?.name, status: data.journey?.status });
      const flow: JourneyFlow | null = data.flow || data.journey?.flow || null;
      const { nodes: ns, edges: es } = flowToGraph(flow);
      setNodes(ns);
      setEdges(es);
    } catch {
      toast.error("Falha ao carregar jornada");
    } finally {
      setLoading(false);
    }
  }, [journeyId, setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  const onConnect = useCallback(
    (conn: Connection) => {
      const color = conn.sourceHandle === "true" ? "#10b981"
        : conn.sourceHandle === "false" ? "#ef4444" : "#666";
      const label = conn.sourceHandle === "true" ? "sim"
        : conn.sourceHandle === "false" ? "não" : undefined;
      setEdges(es => addEdge({
        ...conn,
        type: "smoothstep",
        label,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2 },
      }, es));
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
  };

  const deleteStep = () => {
    if (!selectedId) return;
    setNodes(ns => ns.filter(n => n.id !== selectedId));
    setEdges(es => es.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
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
  };

  const save = async () => {
    setSaving(true);
    try {
      const flow = graphToFlow(nodes, edges);
      await journeysApi.updateFlow(journeyId, flow);
      toast.success("Jornada salva");
    } catch {
      toast.error("Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const editWithLLM = async () => {
    if (!llmPrompt.trim()) return;
    setLlmBusy(true);
    try {
      // Salva flow atual primeiro para que o LLM edite a versão correta
      const currentFlow = graphToFlow(nodes, edges);
      if (currentFlow.steps.length > 0) {
        await journeysApi.updateFlow(journeyId, currentFlow);
      }
      const res = await journeysApi.editWithLLM(journeyId, llmPrompt);
      const newFlow: JourneyFlow | null = res.data?.flow || null;
      if (newFlow) {
        const { nodes: ns, edges: es } = flowToGraph(newFlow);
        setNodes(ns);
        setEdges(es);
        toast.success("Fluxo atualizado pela IA");
        setLlmPrompt("");
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
        <button onClick={() => router.push("/agents")}
          className="p-1.5 rounded-lg hover:bg-[var(--surface-3)]">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <p className="text-[10px] uppercase font-bold opacity-60">Flow Builder</p>
          <p className="text-sm font-semibold truncate">{journey?.name || "Jornada sem nome"}</p>
        </div>
        <div className="text-[10px] px-2 py-1 rounded-md"
          style={{
            background: journey?.status === "active" ? "rgba(0,212,106,0.15)" : "rgba(234,179,8,0.15)",
            color: journey?.status === "active" ? "var(--green)" : "#eab308",
          }}>
          {journey?.status}
        </div>
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          style={{ background: "var(--green)", color: "white", opacity: saving ? 0.7 : 1 }}>
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            minZoom={0.2}
            maxZoom={2}
            colorMode="dark"
          >
            <Background color="#333" gap={20} />
            <Controls className="!bg-[var(--surface-2)] !border-[var(--surface-border)]" />
            <MiniMap className="!bg-[var(--surface-2)]" nodeColor={(n) => {
              const s = n.data?.step as FlowStep | undefined;
              return s ? STEP_META[s.type]?.color || "#666" : "#666";
            }} />
          </ReactFlow>

          {/* LLM edit bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(720px,calc(100%-2rem))]"
            style={{ zIndex: 10 }}>
            <motion.div
              className="flex items-end gap-2 rounded-2xl p-2 pl-4 shadow-lg"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
              }}
            >
              <Sparkles className="w-4 h-4 mt-2 flex-shrink-0" style={{ color: "var(--green)" }} />
              <textarea
                ref={llmInputRef}
                rows={1}
                placeholder="Edite o fluxo via IA: 'adicione um step pedindo email', 'troque a mensagem do welcome'..."
                value={llmPrompt}
                onChange={e => setLlmPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    editWithLLM();
                  }
                }}
                className="flex-1 bg-transparent outline-none text-xs resize-none py-1.5"
                style={{ color: "var(--text-1)", maxHeight: 120 }}
              />
              <button
                onClick={editWithLLM}
                disabled={!llmPrompt.trim() || llmBusy}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                style={{
                  background: llmPrompt.trim() && !llmBusy ? "var(--green)" : "var(--surface-3)",
                  color: llmPrompt.trim() && !llmBusy ? "white" : "var(--text-3)",
                }}
              >
                {llmBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                Editar com IA
              </button>
            </motion.div>
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

        {/* Right: config / simulate */}
        <div className="w-[320px] flex-shrink-0 border-l flex flex-col"
          style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
          <div className="flex border-b" style={{ borderColor: "var(--surface-border)" }}>
            {(["config", "simulate"] as const).map(t => (
              <button
                key={t}
                onClick={() => setRightTab(t)}
                className={cn("flex-1 py-2.5 text-xs font-semibold transition-colors",
                  rightTab === t ? "" : "opacity-50")}
                style={{
                  borderBottom: rightTab === t ? "2px solid var(--green)" : "2px solid transparent",
                  color: rightTab === t ? "var(--text-1)" : "var(--text-2)",
                }}
              >
                {t === "config" ? "Configuração" : "Simulador"}
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
