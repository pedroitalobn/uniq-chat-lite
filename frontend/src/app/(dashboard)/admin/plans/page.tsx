"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import {
  CreditCard, Shield, Edit2, Check, X, Loader2, Globe, Zap, Plus, GripVertical, Trash2, Flame,
} from "lucide-react";
import { toast } from "sonner";
import type { Plan } from "@/types";

interface EditState {
  name: string;
  price: number;
  max_instances: number;
  max_messages_per_day: number;
  max_users: number;
  max_workspaces: number;
  allow_proxy: boolean;
  is_active: boolean;
  stripe_price_id: string;
  description: string;
  highlights: string[]; // custom feature texts shown on /plans
  features: string; // raw JSON string
}

const FEATURE_KEYS = [
  { key: "whatsapp",     label: "WhatsApp",     icon: "📱" },
  { key: "instagram",    label: "Instagram",    icon: "📸" },
  { key: "crm",          label: "CRM",          icon: "👥" },
  { key: "campaigns",    label: "Campanhas",    icon: "📢" },
  { key: "integrations", label: "Integrações",  icon: "🔌" },
  { key: "api",          label: "API Access",   icon: "🔑" },
  { key: "webhooks",     label: "Webhooks",     icon: "🪝" },
  { key: "mcp",          label: "MCP",          icon: "🤖" },
];

const PLAN_STYLES: Record<string, { icon: string; accent: string; bg: string; border: string; gradient: string }> = {
  Free:       { icon: "#64748b", accent: "#64748b", bg: "rgba(100,116,139,0.05)", border: "rgba(100,116,139,0.12)", gradient: "linear-gradient(135deg,rgba(100,116,139,0.12),rgba(100,116,139,0.04))" },
  Starter:    { icon: "#fb923c", accent: "#fb923c", bg: "rgba(251,146,60,0.05)",  border: "rgba(251,146,60,0.15)",  gradient: "linear-gradient(135deg,rgba(251,146,60,0.12),rgba(251,146,60,0.04))" },
  Pro:        { icon: "#60a5fa", accent: "#60a5fa", bg: "rgba(96,165,250,0.05)",  border: "rgba(96,165,250,0.15)",  gradient: "linear-gradient(135deg,rgba(96,165,250,0.12),rgba(96,165,250,0.04))" },
  Business:   { icon: "#a78bfa", accent: "#a78bfa", bg: "rgba(167,139,250,0.05)", border: "rgba(167,139,250,0.15)", gradient: "linear-gradient(135deg,rgba(167,139,250,0.12),rgba(167,139,250,0.04))" },
  Enterprise: { icon: "#a78bfa", accent: "#a78bfa", bg: "rgba(167,139,250,0.05)", border: "rgba(167,139,250,0.15)", gradient: "linear-gradient(135deg,rgba(167,139,250,0.12),rgba(167,139,250,0.04))" },
  _default:   { icon: "#c084fc", accent: "#c084fc", bg: "rgba(192,132,252,0.05)", border: "rgba(192,132,252,0.15)", gradient: "linear-gradient(135deg,rgba(192,132,252,0.12),rgba(192,132,252,0.04))" },
};

function getPlanStyle(name: string) {
  return PLAN_STYLES[name] ?? PLAN_STYLES["_default"];
}

function parseFeaturesObj(plan: Plan): Record<string, unknown> {
  if (!plan.features) return {};
  try { return JSON.parse(plan.features); } catch { return {}; }
}

function featuresObjToCheckboxes(featObj: Record<string, unknown>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  // channels array support: {"channels":["whatsapp","instagram"]}
  const channels = Array.isArray(featObj.channels) ? (featObj.channels as string[]) : [];
  FEATURE_KEYS.forEach(({ key }) => {
    if (typeof featObj[key] === "boolean") {
      result[key] = featObj[key] as boolean;
    } else if (channels.includes(key)) {
      result[key] = true;
    } else {
      result[key] = false;
    }
  });
  return result;
}

function checkboxesToFeaturesObj(
  checkboxes: Record<string, boolean>,
  extra: { description: string; stripe_price_id: string; highlights: string[]; support?: string }
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  FEATURE_KEYS.forEach(({ key }) => {
    obj[key] = checkboxes[key] ?? false;
  });
  obj["description"] = extra.description;
  // Only store highlights if the admin has customized them
  if (extra.highlights.length > 0) obj["highlights"] = extra.highlights;
  if (extra.stripe_price_id) obj["stripe_price_id"] = extra.stripe_price_id;
  return obj;
}

// ─── Highlights editor ────────────────────────────────────────────────────────
function HighlightsEditor({
  highlights,
  onChange,
}: {
  highlights: string[];
  onChange: (h: string[]) => void;
}) {
  const update = (i: number, val: string) => {
    const next = [...highlights];
    next[i] = val;
    onChange(next);
  };
  const remove = (i: number) => onChange(highlights.filter((_, idx) => idx !== i));
  const add = () => onChange([...highlights, ""]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium" style={{ color: "hsl(240 8% 46%)" }}>
          Textos das funcionalidades
          <span className="ml-1.5 text-[10px]" style={{ color: "hsl(240 8% 32%)" }}>
            (exibidos em /plans · vazio = gerado automaticamente)
          </span>
        </p>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg transition-colors"
          style={{ color: "var(--green)", background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.18)" }}
        >
          <Plus className="w-3 h-3" /> Adicionar
        </button>
      </div>
      <div className="space-y-1.5">
        {highlights.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 28%)" }} />
            <input
              type="text"
              value={item}
              onChange={(e) => update(i, e.target.value)}
              placeholder="Ex: 5 instâncias WhatsApp"
              className="input-field flex-1 text-xs py-1.5"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1 rounded-lg flex-shrink-0 transition-colors"
              style={{ color: "hsl(240 8% 35%)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f87171"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 35%)"; }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {highlights.length === 0 && (
          <p className="text-[11px] text-center py-2" style={{ color: "hsl(240 8% 28%)" }}>
            Nenhum texto personalizado · clique em Adicionar para customizar
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Toggle component ─────────────────────────────────────────────────────────
function Toggle({ checked, onChange, color = "var(--green)" }: {
  checked: boolean; onChange: (v: boolean) => void; color?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
      style={{ background: checked ? color : "hsl(240 12% 18%)" }}
    >
      <span
        className="absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

// ─── Feature checkboxes grid ──────────────────────────────────────────────────
function FeatureGrid({
  checkboxes,
  onChange,
}: {
  checkboxes: Record<string, boolean>;
  onChange: (key: string, val: boolean) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium mb-2" style={{ color: "hsl(240 8% 46%)" }}>Recursos incluídos</p>
      <div className="grid grid-cols-2 gap-2">
        {FEATURE_KEYS.map(({ key, label, icon }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer p-2 rounded-xl transition-colors overflow-hidden min-w-0"
            style={{
              background: checkboxes[key] ? "rgba(0,212,106,0.06)" : "rgba(255,255,255,0.02)",
              border: checkboxes[key] ? "1px solid rgba(0,212,106,0.18)" : "1px solid rgba(255,255,255,0.05)",
            }}>
            <span className="text-sm leading-none flex-shrink-0">{icon}</span>
            <span className="text-xs flex-1 truncate min-w-0" style={{ color: checkboxes[key] ? "hsl(240 15% 88%)" : "hsl(240 8% 50%)" }}>{label}</span>
            <Toggle checked={checkboxes[key]} onChange={(v) => onChange(key, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Plan Edit Form ───────────────────────────────────────────────────────────
function PlanEditForm({
  form,
  setForm,
  checkboxes,
  setCheckboxes,
  onCancel,
  onSave,
  isPending,
}: {
  form: EditState;
  setForm: (f: EditState) => void;
  checkboxes: Record<string, boolean>;
  setCheckboxes: (c: Record<string, boolean>) => void;
  onCancel: () => void;
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Nome do plano</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Preço (R$)</label>
          <input
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Instâncias (-1 = ∞)</label>
          <input
            type="number"
            value={form.max_instances}
            onChange={(e) => setForm({ ...form, max_instances: Number(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Msgs/dia (-1 = ∞)</label>
          <input
            type="number"
            value={form.max_messages_per_day}
            onChange={(e) => setForm({ ...form, max_messages_per_day: Number(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Usuários (-1 = ∞)</label>
          <input
            type="number"
            value={form.max_users}
            onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Workspaces (-1 = ∞)</label>
          <input
            type="number"
            value={form.max_workspaces}
            onChange={(e) => setForm({ ...form, max_workspaces: Number(e.target.value) })}
            className="input-field w-full"
          />
        </div>
      </div>

      {/* Stripe Price ID */}
      <div>
        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Stripe Price ID</label>
        <input
          type="text"
          value={form.stripe_price_id}
          onChange={(e) => setForm({ ...form, stripe_price_id: e.target.value })}
          placeholder="price_xxxxxxxx"
          className="input-field w-full font-mono text-xs"
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Descrição (exibida na página de planos)</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Ideal para pequenos negócios..."
          rows={2}
          className="input-field w-full resize-none text-sm"
        />
      </div>

      {/* Feature checkboxes */}
      <FeatureGrid
        checkboxes={checkboxes}
        onChange={(key, val) => setCheckboxes({ ...checkboxes, [key]: val })}
      />

      {/* Highlights editor */}
      <HighlightsEditor
        highlights={form.highlights}
        onChange={(h) => setForm({ ...form, highlights: h })}
      />

      {/* Toggles */}
      <div className="flex items-center gap-5 flex-wrap">
        <label className="flex items-center gap-2.5 cursor-pointer flex-shrink-0">
          <Toggle checked={form.allow_proxy} onChange={(v) => setForm({ ...form, allow_proxy: v })} color="rgba(96,165,250,0.8)" />
          <span className="text-xs" style={{ color: "hsl(240 8% 60%)" }}>Proxy</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer flex-shrink-0">
          <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
          <span className="text-xs" style={{ color: "hsl(240 8% 60%)" }}>Ativo</span>
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost flex-1 py-2 text-sm">
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={isPending}
          className="btn-primary flex-1 flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-40"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salvar
        </button>
      </div>
    </div>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────
function PlanCard({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);

  const featObj = parseFeaturesObj(plan);
  const [checkboxes, setCheckboxes] = useState<Record<string, boolean>>(() => featuresObjToCheckboxes(featObj));

  const [form, setForm] = useState<EditState>({
    name: plan.name,
    price: plan.price,
    max_instances: plan.max_instances,
    max_messages_per_day: plan.max_messages_per_day,
    max_users: plan.max_users,
    max_workspaces: plan.max_workspaces,
    allow_proxy: plan.allow_proxy,
    is_active: plan.is_active,
    stripe_price_id: plan.stripe_price_id ?? "",
    description: (typeof featObj["description"] === "string" ? featObj["description"] : "") as string,
    highlights: Array.isArray(featObj["highlights"]) ? (featObj["highlights"] as string[]) : [],
    features: JSON.stringify(featObj, null, 2),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      const featuresPayload = checkboxesToFeaturesObj(checkboxes, {
        description: form.description,
        stripe_price_id: form.stripe_price_id,
        highlights: form.highlights,
      });
      return adminApi.updatePlan(plan.id, {
        name: form.name,
        price: form.price,
        max_instances: form.max_instances,
        max_messages_per_day: form.max_messages_per_day,
        max_users: form.max_users,
        max_workspaces: form.max_workspaces,
        allow_proxy: form.allow_proxy,
        is_active: form.is_active,
        stripe_price_id: form.stripe_price_id || undefined,
        // backend expects features as JSON string
        features: JSON.stringify(featuresPayload),
      });
    },
    onSuccess: () => {
      toast.success("Plano atualizado!");
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans-public"] });
      queryClient.invalidateQueries({ queryKey: ["stripe-plans"] });
      setShowEditModal(false);
    },
    onError: () => toast.error("Erro ao atualizar plano"),
  });

  const style = getPlanStyle(plan.name);
  const description = typeof featObj["description"] === "string" ? featObj["description"] : "";
  const enabledFeatures = FEATURE_KEYS.filter(({ key }) => {
    const v = featObj[key];
    if (typeof v === "boolean") return v;
    if (Array.isArray(featObj.channels)) return (featObj.channels as string[]).includes(key);
    return false;
  });

  return (
    <div
      className="rounded-2xl p-5 space-y-5 animate-fade-in-up"
      style={{ background: style.bg, border: `1px solid ${style.border}` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: style.gradient, border: `1px solid ${style.border}` }}
          >
            {plan.name === "Enterprise" || plan.name === "Business"
              ? <Zap className="w-5 h-5" style={{ color: style.icon }} />
              : plan.name === "Pro"
              ? <CreditCard className="w-5 h-5" style={{ color: style.icon }} />
              : plan.name === "Starter"
              ? <Flame className="w-5 h-5" style={{ color: style.icon }} />
              : <Shield className="w-5 h-5" style={{ color: style.icon }} />
            }
          </div>
          <div>
            <h3 className="font-bold text-sm" style={{ color: "hsl(240 15% 93%)" }}>{plan.name}</h3>
            <p className="text-xs mt-0.5" style={{ color: style.accent }}>
              {plan.price === 0 ? "Gratuito" : `R$ ${plan.price}/mês`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={plan.is_active ? {
              background: "rgba(0,212,106,0.08)",
              color: "#00d46a",
              border: "1px solid rgba(0,212,106,0.15)",
            } : {
              background: "rgba(239,68,68,0.08)",
              color: "#f87171",
              border: "1px solid rgba(239,68,68,0.15)",
            }}
          >
            {plan.is_active ? "Ativo" : "Inativo"}
          </span>
          <button
            onClick={() => setShowEditModal(true)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 80%)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 38%)";
            }}
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Display only - click edit to modify */}
      <div className="space-y-3">
        {description && (
          <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 55%)" }}>{description}</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)" }}>
            <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "hsl(240 8% 38%)" }}>Instâncias</p>
            <p className="text-xl font-bold" style={{ color: "hsl(240 15% 88%)" }}>
              {plan.max_instances === -1 ? "∞" : plan.max_instances}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)" }}>
            <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "hsl(240 8% 38%)" }}>Msgs/dia</p>
            <p className="text-xl font-bold" style={{ color: "hsl(240 15% 88%)" }}>
              {plan.max_messages_per_day === -1 ? "∞" : plan.max_messages_per_day.toLocaleString("pt-BR")}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)" }}>
            <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "hsl(240 8% 38%)" }}>Usuários</p>
            <p className="text-xl font-bold" style={{ color: "hsl(240 15% 88%)" }}>
              {plan.max_users === -1 ? "∞" : plan.max_users}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)" }}>
            <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "hsl(240 8% 38%)" }}>Workspaces</p>
            <p className="text-xl font-bold" style={{ color: "hsl(240 15% 88%)" }}>
              {plan.max_workspaces === -1 ? "∞" : plan.max_workspaces}
            </p>
          </div>
          <div
            className="col-span-2 rounded-xl p-3 flex items-center gap-2"
            style={plan.allow_proxy ? {
              background: "rgba(96,165,250,0.06)",
              border: "1px solid rgba(96,165,250,0.12)",
            } : {
              background: "rgba(0,0,0,0.15)",
            }}
          >
            <Globe className="w-3.5 h-3.5" style={{ color: plan.allow_proxy ? "#60a5fa" : "hsl(240 8% 28%)" }} />
            <span className="text-xs font-medium" style={{ color: plan.allow_proxy ? "#93c5fd" : "hsl(240 8% 36%)" }}>
              Proxy {plan.allow_proxy ? "habilitado" : "desabilitado"}
            </span>
          </div>
        </div>

        {enabledFeatures.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {enabledFeatures.map(({ key, label, icon }) => (
              <span key={key} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "hsl(240 8% 62%)" }}>
                {icon} {label}
              </span>
            ))}
          </div>
        )}
      </div>

        {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowEditModal(false)} />
          <div className="relative w-full max-w-md sm:max-w-lg md:max-w-xl max-h-[90dvh] sm:max-h-[85vh] rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ background: "hsl(240 12% 8%)", border: `1px solid ${style.border}` }}>
            <div className="flex items-center justify-between p-3 sm:p-4 border-b flex-shrink-0"
              style={{ borderColor: "hsl(240 12% 15%)", background: "hsl(240 12% 8%)" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: style.gradient }}>
                  {plan.name === "Enterprise" || plan.name === "Business"
                    ? <Zap className="w-4 h-4" style={{ color: style.icon }} />
                    : plan.name === "Pro"
                    ? <CreditCard className="w-4 h-4" style={{ color: style.icon }} />
                    : plan.name === "Starter"
                    ? <Flame className="w-4 h-4" style={{ color: style.icon }} />
                    : <Shield className="w-4 h-4" style={{ color: style.icon }} />
                  }
                </div>
                <h3 className="font-bold text-sm" style={{ color: "hsl(240 15% 93%)" }}>Editar {plan.name}</h3>
              </div>
              <button onClick={() => setShowEditModal(false)} className="p-1.5 rounded-lg" style={{ color: "hsl(240 8% 40%)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Nome do plano</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Preço (R$)</label>
                  <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Instâncias (-1 = ∞)</label>
                  <input type="number" value={form.max_instances} onChange={(e) => setForm({ ...form, max_instances: Number(e.target.value) })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Msgs/dia (-1 = ∞)</label>
                  <input type="number" value={form.max_messages_per_day} onChange={(e) => setForm({ ...form, max_messages_per_day: Number(e.target.value) })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Usuários (-1 = ∞)</label>
                  <input type="number" value={form.max_users} onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Workspaces (-1 = ∞)</label>
                  <input type="number" value={form.max_workspaces} onChange={(e) => setForm({ ...form, max_workspaces: Number(e.target.value) })} className="input-field w-full" />
                </div>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Stripe Price ID</label>
                <input type="text" value={form.stripe_price_id} onChange={(e) => setForm({ ...form, stripe_price_id: e.target.value })} placeholder="price_xxxxxxxx" className="input-field w-full font-mono text-xs" />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 46%)" }}>Descrição</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="input-field w-full resize-none text-sm" />
              </div>
              <FeatureGrid checkboxes={checkboxes} onChange={(key, val) => setCheckboxes({ ...checkboxes, [key]: val })} />
              <HighlightsEditor highlights={form.highlights} onChange={(h) => setForm({ ...form, highlights: h })} />
              <div className="flex items-center gap-5 flex-wrap">
                <label className="flex items-center gap-2.5 cursor-pointer flex-shrink-0">
                  <Toggle checked={form.allow_proxy} onChange={(v) => setForm({ ...form, allow_proxy: v })} color="rgba(96,165,250,0.8)" />
                  <span className="text-xs" style={{ color: "hsl(240 8% 60%)" }}>Proxy</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer flex-shrink-0">
                  <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
                  <span className="text-xs" style={{ color: "hsl(240 8% 60%)" }}>Ativo</span>
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowEditModal(false)} className="btn-ghost flex-1 py-2 text-sm">Cancelar</button>
                <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="btn-primary flex-1 flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-40">
                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Plan Form ────────────────────────────────────────────────────────────
function NewPlanForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const defaultCheckboxes = Object.fromEntries(FEATURE_KEYS.map(({ key }) => [key, false])) as Record<string, boolean>;

  const [form, setForm] = useState<EditState>({
    name: "",
    price: 0,
    max_instances: 1,
    max_messages_per_day: 100,
    max_users: 1,
    max_workspaces: 1,
    allow_proxy: false,
    is_active: true,
    stripe_price_id: "",
    description: "",
    highlights: [],
    features: "{}",
  });
  const [checkboxes, setCheckboxes] = useState<Record<string, boolean>>(defaultCheckboxes);

  const createMutation = useMutation({
    mutationFn: () => {
      const featuresPayload = checkboxesToFeaturesObj(checkboxes, {
        description: form.description,
        stripe_price_id: form.stripe_price_id,
        highlights: form.highlights,
      });
      return adminApi.createPlan({
        name: form.name,
        price: form.price,
        max_instances: form.max_instances,
        max_messages_per_day: form.max_messages_per_day,
        max_users: form.max_users,
        max_workspaces: form.max_workspaces,
        allow_proxy: form.allow_proxy,
        is_active: form.is_active,
        stripe_price_id: form.stripe_price_id || undefined,
        // backend expects features as JSON string
        features: JSON.stringify(featuresPayload),
      });
    },
    onSuccess: () => {
      toast.success("Plano criado!");
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans-public"] });
      onDone();
    },
    onError: () => toast.error("Erro ao criar plano"),
  });

  return (
    <div
      className="rounded-2xl p-5 animate-fade-in-up"
      style={{ background: "rgba(0,212,106,0.04)", border: "1px solid rgba(0,212,106,0.15)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
          <Plus className="w-4 h-4" style={{ color: "var(--green)" }} />
        </div>
        <h3 className="font-bold text-sm" style={{ color: "hsl(240 15% 93%)" }}>Novo Plano</h3>
      </div>
      <PlanEditForm
        form={form}
        setForm={setForm}
        checkboxes={checkboxes}
        setCheckboxes={setCheckboxes}
        onCancel={onDone}
        onSave={() => createMutation.mutate()}
        isPending={createMutation.isPending}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminPlansPage() {
  const [creatingNew, setCreatingNew] = useState(false);

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminApi.listPlans().then((r) => r.data),
  });

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
            Planos
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            Configure limites e recursos de cada plano.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreatingNew((v) => !v)}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-150 active:scale-[0.97]"
            style={{
              background: creatingNew ? "rgba(0,212,106,0.18)" : "rgba(0,212,106,0.1)",
              border: "1px solid rgba(0,212,106,0.25)",
              color: "var(--green)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,106,0.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = creatingNew ? "rgba(0,212,106,0.18)" : "rgba(0,212,106,0.1)"; }}
          >
            {creatingNew ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {creatingNew ? "Cancelar" : "Novo Plano"}
          </button>
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
            style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)" }}
          >
            <Shield className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
            <span className="text-xs font-semibold" style={{ color: "#fbbf24" }}>Admin</span>
          </div>
        </div>
      </div>

      {/* New plan form */}
      {creatingNew && (
        <NewPlanForm onDone={() => setCreatingNew(false)} />
      )}

      {/* Plans grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-52 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
      )}

      {/* Notes */}
      <div className="rounded-2xl p-5 space-y-3" style={cardStyle}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
          Notas
        </h3>
        <ul className="space-y-2">
          {[
            <>Use <code className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.06)", color: "hsl(240 15% 80%)" }}>-1</code> em limites numéricos para definir como ilimitado.</>,
            "Alterar o plano Free não afeta usuários pagantes ativos.",
            <>A flag <strong style={{ color: "hsl(240 15% 80%)" }}>Proxy</strong> controla o acesso à aba de configuração de proxy nas instâncias.</>,
            <>O campo <strong style={{ color: "hsl(240 15% 80%)" }}>Stripe Price ID</strong> é usado para criar checkouts automáticos de assinatura.</>,
          ].map((note, i) => (
            <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "hsl(240 8% 46%)" }}>
              <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{ background: "hsl(240 8% 28%)" }} />
              {note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
