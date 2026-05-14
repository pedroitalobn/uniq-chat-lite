"use client";

import { useMemo } from "react";
import {
  MessageSquare,
  ListChecks,
  Hand,
  Clock,
  GitBranch,
  Bot,
  Image as ImageIcon,
  HandHelping,
  Tag,
  Variable,
  Webhook,
  Zap,
  Repeat,
  CornerDownRight,
  StopCircle,
  Mail,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

// JourneyPreview — timeline vertical do flow. Cada step vira um nó com
// ícone + label + resumo da config. Conexões mostradas como linha
// vertical conectora; branches saem com setas pra direita.
//
// Read-only — edição vive no chat (instruções pra IA) ou no canvas
// avançado. Foco aqui é "ver o que está configurado".

type Step = {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, any> | string;
  next_step_id?: string;
  branch_true?: string;
  branch_false?: string;
  is_start_step?: boolean;
};

type Flow = {
  start_step?: string;
  steps?: Step[];
};

const TYPE_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  message:        { icon: MessageSquare, color: "#2563EB", label: "WhatsApp" },
  email:          { icon: Mail,          color: "#3b82f6", label: "Email" },
  sms:            { icon: Smartphone,    color: "#ec4899", label: "SMS" },
  buttons:        { icon: ListChecks,    color: "#60a5fa", label: "Botões" },
  list:           { icon: ListChecks,    color: "#60a5fa", label: "Lista" },
  input:          { icon: Hand,          color: "#fbbf24", label: "Pergunta" },
  wait:           { icon: Clock,         color: "#a78bfa", label: "Espera" },
  wait_until:     { icon: Clock,         color: "#a78bfa", label: "Espera até" },
  condition:      { icon: GitBranch,     color: "#f97316", label: "Condição" },
  ai_response:    { icon: Bot,           color: "#a5b4fc", label: "Resposta IA" },
  http_request:   { icon: Webhook,       color: "#94a3b8", label: "HTTP" },
  media:          { icon: ImageIcon,     color: "#ec4899", label: "Mídia" },
  handoff:        { icon: HandHelping,   color: "#fb923c", label: "Atendente" },
  goto:           { icon: Repeat,        color: "#94a3b8", label: "Pular pra" },
  randomize:      { icon: GitBranch,     color: "#a78bfa", label: "Aleatório" },
  set_variable:   { icon: Variable,      color: "#22d3ee", label: "Variável" },
  add_tag:        { icon: Tag,           color: "#10b981", label: "Add tag" },
  remove_tag:     { icon: Tag,           color: "#94a3b8", label: "Remover tag" },
  update_stage:   { icon: Zap,           color: "#fb923c", label: "Mudar etapa" },
  end:            { icon: StopCircle,    color: "#ef4444", label: "Fim" },
};

export function JourneyPreview({
  flow,
  changedStepIds = new Set<string>(),
}: {
  flow: Flow | null | undefined;
  // Highlight verde nos steps que foram modificados pela última ação
  // da IA — comparação feita no caller via diff entre flows antes/depois.
  changedStepIds?: Set<string>;
}) {
  const steps = useMemo(() => orderSteps(flow), [flow]);

  if (!steps.length) {
    return (
      <div
        className="rounded-2xl p-8 text-center space-y-2"
        style={{
          background: "var(--surface-1)",
          border: "1px dashed var(--surface-border)",
        }}
      >
        <Bot className="w-7 h-7 mx-auto" style={{ color: "var(--text-3)" }} />
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          Jornada vazia
        </p>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Diga pra QChat AI o que você quer que aconteça e ela monta os passos pra você.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Linha vertical conectora */}
      <div
        className="absolute left-4 top-6 bottom-6 w-px"
        style={{
          background:
            "linear-gradient(180deg, transparent, var(--surface-border) 8%, var(--surface-border) 92%, transparent)",
        }}
      />

      <div className="space-y-3">
        {steps.map((step, idx) => (
          <PreviewNode
            key={step.id}
            step={step}
            position={idx === 0 ? "start" : idx === steps.length - 1 ? "end" : "mid"}
            highlighted={changedStepIds.has(step.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PreviewNode({
  step,
  position,
  highlighted,
}: {
  step: Step;
  position: "start" | "mid" | "end";
  highlighted: boolean;
}) {
  const meta = TYPE_META[step.type] || TYPE_META.message;
  const Icon = meta.icon;
  const label = step.label || meta.label;
  const cfg = parseConfig(step.config);
  const summary = summarizeStep(step.type, cfg);
  const isCondition = step.type === "condition" || step.type === "randomize";

  return (
    <div className="relative pl-10">
      {/* Bolinha do timeline */}
      <span
        className="absolute left-0 top-3 w-8 h-8 rounded-full flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${meta.color}33, ${meta.color}10)`,
          border: `2px solid ${highlighted ? "#2563EB" : meta.color}`,
          boxShadow: highlighted
            ? "0 0 14px rgba(37, 99, 235,0.55)"
            : `0 0 8px ${meta.color}33`,
        }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
      </span>

      <div
        className="rounded-xl px-3 py-2 transition-all"
        style={{
          background: highlighted
            ? "linear-gradient(135deg, rgba(37, 99, 235,0.06), rgba(37, 99, 235,0.02))"
            : "var(--surface-1)",
          border: `1px solid ${highlighted ? "rgba(37, 99, 235,0.30)" : "var(--surface-border)"}`,
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
            {label}
          </p>
          <span
            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              background: `${meta.color}1a`,
              color: meta.color,
              border: `1px solid ${meta.color}33`,
            }}
          >
            {meta.label}
          </span>
          {position === "start" && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
              style={{ background: "rgba(251,191,36,0.10)", color: "#fbbf24" }}
            >
              início
            </span>
          )}
          {highlighted && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
              style={{ background: "rgba(37, 99, 235,0.10)", color: "var(--green)" }}
            >
              novo
            </span>
          )}
        </div>

        {summary && (
          <p
            className="text-[11px] mt-1 line-clamp-3 whitespace-pre-wrap"
            style={{ color: "var(--text-3)" }}
          >
            {summary}
          </p>
        )}

        {isCondition && (step.branch_true || step.branch_false) && (
          <div className="mt-1.5 flex flex-col gap-0.5 text-[10px]" style={{ color: "var(--text-4)" }}>
            {step.branch_true && (
              <span className="inline-flex items-center gap-1">
                <CornerDownRight className="w-2.5 h-2.5" style={{ color: "var(--green)" }} />
                <span style={{ color: "var(--green)" }}>SE sim</span> → {step.branch_true}
              </span>
            )}
            {step.branch_false && (
              <span className="inline-flex items-center gap-1">
                <CornerDownRight className="w-2.5 h-2.5" style={{ color: "#ef4444" }} />
                <span style={{ color: "#ef4444" }}>SE não</span> → {step.branch_false}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// orderSteps — devolve steps em ordem topológica (começa pelo start_step
// e segue next_step_id). Steps órfãos vão pro fim. Cobre 95% dos
// flows; em casos com branches complexos usuário tem o canvas.
function orderSteps(flow: Flow | null | undefined): Step[] {
  if (!flow?.steps?.length) return [];
  const map = new Map<string, Step>();
  flow.steps.forEach((s) => map.set(s.id, s));

  const ordered: Step[] = [];
  const visited = new Set<string>();
  let cursor = flow.start_step || flow.steps.find((s) => s.is_start_step)?.id || flow.steps[0].id;

  while (cursor && !visited.has(cursor)) {
    const s = map.get(cursor);
    if (!s) break;
    visited.add(cursor);
    ordered.push(s);
    // Prefere next_step_id; fallback pra branch_true (caminho "sim")
    cursor = s.next_step_id || s.branch_true || "";
  }
  // Adiciona órfãos no fim
  flow.steps.forEach((s) => {
    if (!visited.has(s.id)) ordered.push(s);
  });
  return ordered;
}

function parseConfig(raw: Step["config"]): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function summarizeStep(type: string, cfg: Record<string, any>): string {
  switch (type) {
    case "message":
      return cfg.message || "";
    case "email":
      return [
        cfg.to ? `→ ${cfg.to}` : "→ contact.email",
        cfg.subject ? `📧 ${cfg.subject}` : "",
      ].filter(Boolean).join("\n");
    case "sms":
      return [
        cfg.to ? `→ ${cfg.to}` : "→ contact.phone",
        cfg.text || "",
      ].filter(Boolean).join("\n");
    case "buttons": {
      const b = (cfg.buttons || []).map((x: any) => x.text).join(" · ");
      return [cfg.message, b ? `[${b}]` : ""].filter(Boolean).join("\n");
    }
    case "list":
      return cfg.message || "";
    case "input":
      return [cfg.prompt, cfg.variable_name ? `→ {{flow.${cfg.variable_name}}}` : ""].filter(Boolean).join(" ");
    case "wait":
      return `aguarda ${cfg.duration || "?"}`;
    case "condition":
      return `${cfg.left || "?"} ${cfg.operator || "?"} ${cfg.right || "?"}`;
    case "ai_response":
      return cfg.user_prompt || cfg.system_prompt || "";
    case "http_request":
      return `${cfg.method || "GET"} ${cfg.url || ""}`;
    case "media":
      return `${cfg.media_type || "?"} · ${cfg.url || ""}`;
    case "set_variable":
      return `${cfg.name || "?"} = ${cfg.value || ""}`;
    case "add_tag":
    case "remove_tag":
      return cfg.tag || "";
    case "handoff":
      return cfg.message || "transferir pra humano";
    case "goto":
      return `pular pra step ${cfg.target_step_id || "?"}`;
    case "update_stage":
      return cfg.stage_id || "";
  }
  return "";
}
