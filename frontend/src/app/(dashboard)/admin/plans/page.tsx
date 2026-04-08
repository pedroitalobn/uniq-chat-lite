"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import {
  CreditCard, Shield, Edit2, Check, X, Loader2, Globe, Zap, Plus, GripVertical, Trash2, Flame,
} from "lucide-react";
import { toast } from "sonner";
import type { Plan } from "@/types";
import { cn } from "@/lib/utils";

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
  asaas_product_id: string;
  description: string;
  highlights: string[]; 
  features: string; 
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
  extra: { description: string; stripe_price_id: string; highlights: string[]; support?: string; asaas_product_id?: string }
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  FEATURE_KEYS.forEach(({ key }) => {
    obj[key] = checkboxes[key] ?? false;
  });
  obj["description"] = extra.description;
  if (extra.highlights.length > 0) obj["highlights"] = extra.highlights;
  if (extra.stripe_price_id) obj["stripe_price_id"] = extra.stripe_price_id;
  if (extra.asaas_product_id) obj["asaas_product_id"] = extra.asaas_product_id;
  return obj;
}

// ─── Highlights editor ────────────────────────────────────────────────────────
function HighlightsEditor({ highlights, onChange }: { highlights: string[]; onChange: (h: string[]) => void; }) {
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
            Nenhum texto personalizado
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Toggle component ─────────────────────────────────────────────────────────
function Toggle({ checked, onChange, color = "var(--green)" }: { checked: boolean; onChange: (v: boolean) => void; color?: string; }) {
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
function FeatureGrid({ checkboxes, onChange }: { checkboxes: Record<string, boolean>; onChange: (key: string, val: boolean) => void; }) {
  return (
    <div>
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

// ─── Plan Drawer ────────────────────────────────────────────────────────────
function PlanDrawer({ plan, onClose }: { plan: Plan | "new"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isEditing = plan !== "new";
  const p = isEditing ? (plan as Plan) : null;

  const featObj = p ? parseFeaturesObj(p) : {};
  const defaultCheckboxes = Object.fromEntries(FEATURE_KEYS.map(({ key }) => [key, false]));

  const [form, setForm] = useState<EditState>({
    name: p?.name || "",
    price: p?.price || 0,
    max_instances: p?.max_instances ?? 1,
    max_messages_per_day: p?.max_messages_per_day ?? 100,
    max_users: p?.max_users ?? 1,
    max_workspaces: p?.max_workspaces ?? 1,
    allow_proxy: p?.allow_proxy ?? false,
    is_active: p?.is_active ?? true,
    stripe_price_id: p?.stripe_price_id ?? "",
    asaas_product_id: (p as any)?.asaas_product_id ?? "",
    description: typeof featObj["description"] === "string" ? featObj["description"] : "",
    highlights: Array.isArray(featObj["highlights"]) ? (featObj["highlights"] as string[]) : [],
    features: JSON.stringify(featObj, null, 2),
  });

  const [checkboxes, setCheckboxes] = useState<Record<string, boolean>>(() =>
    isEditing ? featuresObjToCheckboxes(featObj) : defaultCheckboxes
  );

  const [activeTab, setActiveTab] = useState<"general" | "limits" | "features" | "gateway" | "visuals">("general");

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        price: form.price,
        max_instances: form.max_instances,
        max_messages_per_day: form.max_messages_per_day,
        max_users: form.max_users,
        max_workspaces: form.max_workspaces,
        allow_proxy: form.allow_proxy,
        is_active: form.is_active,
        stripe_price_id: form.stripe_price_id || undefined,
        asaas_product_id: form.asaas_product_id || undefined,
        features: JSON.stringify(checkboxesToFeaturesObj(checkboxes, {
          description: form.description,
          stripe_price_id: form.stripe_price_id,
          highlights: form.highlights,
          asaas_product_id: form.asaas_product_id,
        })),
      };

      if (isEditing) {
        return adminApi.updatePlan(p!.id, payload);
      }
      return adminApi.createPlan(payload);
    },
    onSuccess: () => {
      toast.success(isEditing ? "Plano atualizado!" : "Plano criado!");
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans-public"] });
      queryClient.invalidateQueries({ queryKey: ["stripe-plans"] });
      onClose();
    },
    onError: () => toast.error(isEditing ? "Erro ao atualizar plano" : "Erro ao criar plano"),
  });

  const TABS = [
    { id: "general", label: "Geral" },
    { id: "limits", label: "Limites" },
    { id: "features", label: "Recursos" },
    { id: "gateway", label: "Cobranças" },
    { id: "visuals", label: "Aparência" },
  ] as const;

  return (
    <>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-drawer-in { animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
      
      <div className="fixed inset-0 z-50 flex justify-end">
        {/* Backdrop */}
        <div 
          className="absolute inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity" 
          onClick={onClose} 
        />
        
        {/* Slide-over Drawer */}
        <div className="relative w-full max-w-lg h-full shadow-2xl flex flex-col animate-drawer-in"
          style={{ background: "hsl(240 12% 8%)", borderLeft: "1px solid hsl(240 12% 15%)" }}>
          
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b flex-shrink-0" style={{ borderColor: "hsl(240 12% 15%)" }}>
            <div>
              <h2 className="text-lg font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
                {isEditing ? "Editar Plano" : "Novo Plano"}
              </h2>
              {isEditing && <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{p!.id}</p>}
            </div>
            <button onClick={onClose} className="p-2 rounded-xl transition-colors hover:bg-white/5 text-zinc-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex px-2 pt-2 border-b overflow-x-auto flex-shrink-0 custom-scrollbar" style={{ borderColor: "hsl(240 12% 12%)" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors"
                style={{
                  color: activeTab === tab.id ? "var(--green)" : "hsl(240 8% 46%)",
                  borderColor: activeTab === tab.id ? "var(--green)" : "transparent"
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            
            {activeTab === "general" && (
              <div className="space-y-4 animate-fade-in-up">
                <div>
                  <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Nome do plano</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="input-field w-full"
                    placeholder="Ex: Profissional"
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Preço (R$)</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Descrição (Card)</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={3}
                    className="input-field w-full resize-none"
                    placeholder="Descrição breve para exibição aos clientes."
                  />
                </div>
                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
                    <div>
                      <span className="text-sm font-medium block" style={{ color: "hsl(240 15% 93%)" }}>Status de Comercialização</span>
                      <span className="text-[10px] block" style={{ color: "hsl(240 8% 46%)" }}>Permitir assinaturas públicas deste plano</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "limits" && (
              <div className="space-y-4 animate-fade-in-up">
                <div className="p-3 mb-4 rounded-lg text-[11px]" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                  Dica: Utilize <strong className="font-mono px-1 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.2)" }}>-1</strong> para configurar limites infinitos (ilimitado).
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Max. Workspaces</label>
                    <input type="number" value={form.max_workspaces} onChange={(e) => setForm({ ...form, max_workspaces: Number(e.target.value) })} className="input-field w-full font-mono" />
                  </div>
                  <div>
                    <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Max. Usuários</label>
                    <input type="number" value={form.max_users} onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })} className="input-field w-full font-mono" />
                  </div>
                  <div>
                    <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Max. Instâncias WPP</label>
                    <input type="number" value={form.max_instances} onChange={(e) => setForm({ ...form, max_instances: Number(e.target.value) })} className="input-field w-full font-mono" />
                  </div>
                  <div>
                    <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Limite de Envios Diários</label>
                    <input type="number" value={form.max_messages_per_day} onChange={(e) => setForm({ ...form, max_messages_per_day: Number(e.target.value) })} className="input-field w-full font-mono" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "features" && (
              <div className="space-y-6 animate-fade-in-up">
                <FeatureGrid checkboxes={checkboxes} onChange={(key, val) => setCheckboxes({ ...checkboxes, [key]: val })} />
                
                <div className="pt-4 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  <label className="flex items-center gap-3 cursor-pointer mt-4">
                    <Toggle checked={form.allow_proxy} onChange={(v) => setForm({ ...form, allow_proxy: v })} color="#60a5fa" />
                    <div>
                      <span className="text-sm font-medium block" style={{ color: "#60a5fa" }}>Sessão via Proxy</span>
                      <span className="text-[10px] block" style={{ color: "hsl(240 8% 46%)" }}>Habilita menu de proxies na página da instância</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "gateway" && (
              <div className="space-y-4 animate-fade-in-up">
                <div>
                  <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Stripe Price ID</label>
                  <input
                    type="text"
                    value={form.stripe_price_id}
                    onChange={(e) => setForm({ ...form, stripe_price_id: e.target.value })}
                    placeholder="price_xxxxxxxxxxxxxxxxx"
                    className="input-field w-full font-mono text-xs"
                  />
                  <p className="text-[10px] mt-1.5" style={{ color: "hsl(240 8% 38%)" }}>Copie o ID da precificação do produto no painel do Stripe.</p>
                </div>
                <div>
                  <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>Asaas Product ID (se aplicável)</label>
                  <input
                    type="text"
                    value={form.asaas_product_id}
                    onChange={(e) => setForm({ ...form, asaas_product_id: e.target.value })}
                    placeholder="prod_xxxxxxxxxxxxxxxxx"
                    className="input-field w-full font-mono text-xs"
                  />
                  <p className="text-[10px] mt-1.5" style={{ color: "hsl(240 8% 38%)" }}>Mapeado apenas em integrações compatíveis no Asaas.</p>
                </div>
              </div>
            )}

            {activeTab === "visuals" && (
              <div className="animate-fade-in-up">
                <HighlightsEditor highlights={form.highlights} onChange={(h) => setForm({ ...form, highlights: h })} />
              </div>
            )}

          </div>

          {/* Footer Actions */}
          <div className="p-5 border-t flex gap-3 flex-shrink-0" style={{ borderColor: "hsl(240 12% 15%)", background: "hsl(240 12% 7%)" }}>
            <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">
              Cancelar
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {isEditing ? "Salvar Alterações" : "Criar Plano"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────
function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const featObj = parseFeaturesObj(plan);
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
      className="rounded-2xl p-4 sm:p-5 pb-5 sm:pb-6 pr-5 sm:pr-8 animate-fade-in-up relative group transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:-translate-y-0.5"
      style={{ background: style.bg, border: `1px solid ${style.border}` }}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8">
        
        {/* Left: Identity */}
        <div className="flex items-center gap-4 w-full lg:w-[260px] flex-shrink-0">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: style.gradient, border: `1px solid ${style.border}` }}>
            {plan.name === "Enterprise" || plan.name === "Business"
              ? <Zap className="w-5 h-5" style={{ color: style.icon }} />
              : plan.name === "Pro"
              ? <CreditCard className="w-5 h-5" style={{ color: style.icon }} />
              : plan.name === "Starter"
              ? <Flame className="w-5 h-5" style={{ color: style.icon }} />
              : <Shield className="w-5 h-5" style={{ color: style.icon }} />
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-bold text-base truncate" style={{ color: "hsl(240 15% 93%)" }}>{plan.name}</h3>
              {plan.is_active ? 
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0" style={{ background: "rgba(0,212,106,0.08)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.15)" }}>Ativo</span> : 
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0" style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}>Inativo</span>}
            </div>
            <p className="text-sm font-medium truncate" style={{ color: style.accent }}>
              {plan.price === 0 ? "Gratuito" : `R$ ${plan.price}/mês`}
            </p>
          </div>
        </div>

        {/* Middle: Limits Wrapper */}
        <div className="flex-1 flex flex-wrap gap-2 w-full lg:pr-10">
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Workspaces</p>
              <p className="text-lg font-bold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_workspaces === -1 ? "∞" : plan.max_workspaces}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Instâncias</p>
              <p className="text-lg font-bold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_instances === -1 ? "∞" : plan.max_instances}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Usuários</p>
              <p className="text-lg font-bold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_users === -1 ? "∞" : plan.max_users}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Msgs/dia</p>
              <p className="text-lg font-bold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_messages_per_day === -1 ? "∞" : plan.max_messages_per_day.toLocaleString("pt-BR")}</p>
           </div>
           
           <div className="flex-[1.5] min-w-[110px] rounded-xl p-3 flex items-center justify-center gap-2" style={{ background: plan.allow_proxy ? "rgba(96,165,250,0.06)" : "rgba(0,0,0,0.15)", border: plan.allow_proxy ? "1px solid rgba(96,165,250,0.12)" : "1px solid transparent" }}>
            <Globe className="w-4 h-4 hidden sm:block" style={{ color: plan.allow_proxy ? "#60a5fa" : "hsl(240 8% 28%)" }} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: plan.allow_proxy ? "#93c5fd" : "hsl(240 8% 36%)" }}>
              Proxy {plan.allow_proxy ? "On" : "Off"}
            </span>
          </div>
        </div>
      </div>
      
      {/* Features string at the bottom if any */}
      {enabledFeatures.length > 0 && (
         <div className="mt-5 pt-4 border-t flex flex-wrap gap-2 lg:pr-10" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {enabledFeatures.map(({ key, label, icon }) => (
              <span key={key} className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "hsl(240 8% 65%)" }}>
                {icon} {label}
              </span>
            ))}
         </div>
      )}

      {/* Edit Button Float */}
      <div className="absolute bottom-4 sm:bottom-5 right-4 sm:right-5 z-10 flex lg:opacity-0 group-hover:opacity-100 transition-opacity">
         <button onClick={onEdit} className="btn-primary px-3 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs rounded-xl flex items-center gap-1.5" style={{ background: "rgba(0,212,106,0.15)", border: "1px solid rgba(0,212,106,0.25)", color: "var(--green)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.25)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.15)" }}>
           <Edit2 className="w-3.5 h-3.5 md:hidden" />
           <span className="hidden md:inline">Editar Configurações</span>
           <span className="inline md:hidden">Editar</span>
         </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminPlansPage() {
  const [activePlanDrawer, setActivePlanDrawer] = useState<Plan | "new" | null>(null);

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminApi.listPlans().then((r) => r.data),
  });

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  return (
    <div className="space-y-7 relative">
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
            onClick={() => setActivePlanDrawer("new")}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-150 active:scale-[0.97]"
            style={{ color: "var(--green)", background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.18)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.1)" }}
          >
            <Plus className="w-4 h-4" />
            Novo Plano
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Shield className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-amber-500">Admin</span>
          </div>
        </div>
      </div>

      {/* Plans grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onEdit={() => setActivePlanDrawer(plan)} />
          ))}
        </div>
      )}

      {/* Global Drawer */}
      {activePlanDrawer !== null && (
        <PlanDrawer 
          plan={activePlanDrawer} 
          onClose={() => setActivePlanDrawer(null)} 
        />
      )}

      {/* Notes */}
      <div className="rounded-2xl p-5 space-y-3" style={cardStyle}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 46%)" }}>
          Notas da Engenharia
        </h3>
        <ul className="space-y-2">
          {[
            <>Use <code className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.06)", color: "hsl(240 15% 88%)" }}>-1</code> em limites numéricos para definir como ilimitado.</>,
            "Alterar o status de comercialização para 'Inativo' remove o plano da tela de aquisição, mas não interrompe subscrições em andamento.",
            <>O campo <strong style={{ color: "hsl(240 15% 88%)" }}>Stripe Price ID</strong> dita o produto faturado no checkout dinâmico da plataforma.</>,
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
