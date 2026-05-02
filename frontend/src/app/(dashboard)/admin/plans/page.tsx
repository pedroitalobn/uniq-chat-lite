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
  // Limites globais
  max_instances: number;
  max_messages_per_day: number;
  max_users: number;
  max_workspaces: number;
  // Sub-limites por módulo (-1=ilimitado, 0=bloqueado)
  max_agents: number;
  max_journeys: number;
  max_campaigns: number;
  max_triggers: number;
  max_webhooks: number;
  max_contacts: number;
  max_deals: number;
  max_shops: number;
  max_products: number;
  max_shop_integrations: number;
  max_instances_per_proxy: number;
  max_proxy_pool: number;
  // Feature flags
  allow_ai: boolean;
  allow_journeys: boolean;
  allow_crm: boolean;
  allow_inbox: boolean;
  allow_campaigns: boolean;
  allow_triggers: boolean;
  allow_warmup: boolean;
  allow_newsletters: boolean;
  allow_communities: boolean;
  allow_instagram: boolean;
  allow_tiktok: boolean;
  allow_api_access: boolean;
  allow_global_webhook: boolean;
  allow_shop: boolean;
  allow_proxy: boolean;
  allow_proxy_residencial: boolean;
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

const FEATURE_LABELS: Record<string, string> = Object.fromEntries(FEATURE_KEYS.map(({ key, label }) => [key, label]));

function generateAutoHighlights(plan: Plan, featObj: Record<string, unknown>): string[] {
  const highlights: string[] = [];
  const maxInst = plan.max_instances === -1 ? "Ilimitadas" : `${plan.max_instances}`;
  highlights.push(`${maxInst} instância${plan.max_instances !== 1 ? "s" : ""}`);
  highlights.push(plan.max_messages_per_day === -1 ? "Mensagens ilimitadas" : `${plan.max_messages_per_day.toLocaleString("pt-BR")} msgs/dia`);
  highlights.push(plan.max_users === -1 ? "Usuários ilimitados" : `${plan.max_users} usuário${plan.max_users !== 1 ? "s" : ""}`);
  highlights.push(plan.max_workspaces === -1 ? "Workspaces ilimitados" : `${plan.max_workspaces} workspace${plan.max_workspaces !== 1 ? "s" : ""}`);
  if (plan.allow_proxy) highlights.push("Proxy dedicado");
  Object.entries(FEATURE_LABELS).forEach(([key, label]) => {
    if (featObj[key] === true) highlights.push(label);
  });
  const channels = Array.isArray(featObj["channels"]) ? (featObj["channels"] as string[]) : [];
  channels.forEach((ch) => { const label = FEATURE_LABELS[ch]; if (label && !highlights.includes(label)) highlights.push(label); });
  const support = typeof featObj["support"] === "string" ? featObj["support"] : "";
  if (support === "priority") highlights.push("Suporte prioritário 24/7");
  else if (support === "email") highlights.push("Suporte por email");
  else if (support === "community") highlights.push("Suporte comunidade");
  return highlights;
}

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
              background: checkboxes[key] ? "rgba(0,212,106,0.06)" : "var(--surface-2)",
              border: checkboxes[key] ? "1px solid rgba(0,212,106,0.18)" : "1px solid var(--border-default)",
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
    price: p?.price ?? 0,
    max_instances: p?.max_instances ?? 1,
    max_messages_per_day: p?.max_messages_per_day ?? 100,
    max_users: p?.max_users ?? 1,
    max_workspaces: p?.max_workspaces ?? 1,
    max_agents: p?.max_agents ?? 0,
    max_journeys: p?.max_journeys ?? 0,
    max_campaigns: p?.max_campaigns ?? 0,
    max_triggers: p?.max_triggers ?? 0,
    max_webhooks: p?.max_webhooks ?? 5,
    max_contacts: p?.max_contacts ?? 0,
    max_deals: p?.max_deals ?? 0,
    max_shops: p?.max_shops ?? 0,
    max_products: p?.max_products ?? 0,
    max_shop_integrations: p?.max_shop_integrations ?? 0,
    max_instances_per_proxy: p?.max_instances_per_proxy ?? 0,
    max_proxy_pool: p?.max_proxy_pool ?? 0,
    allow_ai: p?.allow_ai ?? false,
    allow_journeys: p?.allow_journeys ?? false,
    allow_crm: p?.allow_crm ?? false,
    allow_inbox: p?.allow_inbox ?? true,
    allow_campaigns: p?.allow_campaigns ?? false,
    allow_triggers: p?.allow_triggers ?? false,
    allow_warmup: p?.allow_warmup ?? false,
    allow_newsletters: p?.allow_newsletters ?? false,
    allow_communities: p?.allow_communities ?? false,
    allow_instagram: p?.allow_instagram ?? false,
    allow_tiktok: p?.allow_tiktok ?? false,
    allow_api_access: p?.allow_api_access ?? true,
    allow_global_webhook: p?.allow_global_webhook ?? false,
    allow_shop: p?.allow_shop ?? false,
    allow_proxy: p?.allow_proxy ?? false,
    allow_proxy_residencial: p?.allow_proxy_residencial ?? false,
    is_active: p?.is_active ?? true,
    stripe_price_id: p?.stripe_price_id ?? "",
    asaas_product_id: p?.asaas_product_id ?? "",
    description: typeof featObj["description"] === "string" ? featObj["description"] : "",
    highlights: (() => {
      const saved = Array.isArray(featObj["highlights"]) ? (featObj["highlights"] as string[]) : [];
      return saved.length > 0 ? saved : (p ? generateAutoHighlights(p, featObj) : []);
    })(),
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
        max_agents: form.max_agents,
        max_journeys: form.max_journeys,
        max_campaigns: form.max_campaigns,
        max_triggers: form.max_triggers,
        max_webhooks: form.max_webhooks,
        max_contacts: form.max_contacts,
        max_deals: form.max_deals,
        max_shops: form.max_shops,
        max_products: form.max_products,
        max_shop_integrations: form.max_shop_integrations,
        max_instances_per_proxy: form.max_instances_per_proxy,
        max_proxy_pool: form.max_proxy_pool,
        allow_ai: form.allow_ai,
        allow_journeys: form.allow_journeys,
        allow_crm: form.allow_crm,
        allow_inbox: form.allow_inbox,
        allow_campaigns: form.allow_campaigns,
        allow_triggers: form.allow_triggers,
        allow_warmup: form.allow_warmup,
        allow_newsletters: form.allow_newsletters,
        allow_communities: form.allow_communities,
        allow_instagram: form.allow_instagram,
        allow_tiktok: form.allow_tiktok,
        allow_api_access: form.allow_api_access,
        allow_global_webhook: form.allow_global_webhook,
        allow_shop: form.allow_shop,
        allow_proxy: form.allow_proxy,
        allow_proxy_residencial: form.allow_proxy_residencial,
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
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || (isEditing ? "Erro ao atualizar plano" : "Erro ao criar plano"));
      console.error("[PlanDrawer] save error:", err);
    },
  });

  const TABS = [
    { id: "general", label: "Geral" },
    { id: "limits", label: "Limites" },
    { id: "features", label: "Recursos" },
    { id: "gateway", label: "Cobranças" },
    { id: "visuals", label: "Destaque (/plans)" },
  ] as const;

  return (
    <>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-drawer-in { animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
      
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />
      
      {/* Slide-over Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 z-[101] w-full max-w-md h-screen shadow-2xl flex flex-col animate-drawer-in"
        style={{
          background: "linear-gradient(180deg, rgba(20,20,35,0.96) 0%, rgba(10,10,20,0.98) 100%)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.50)",
        }}
      >
          
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.09)" }}>
            <div>
              <h2 className="text-lg font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
                {isEditing ? "Editar Plano" : "Novo Plano"}
              </h2>
              {isEditing && <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{p!.id}</p>}
            </div>
            <button onClick={onClose} className="p-2 rounded-xl transition-colors hover:bg-white/5 text-zinc-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div
            className="flex px-2 pt-2 border-b overflow-x-auto flex-shrink-0 custom-scrollbar"
            style={{ borderColor: "rgba(255,255,255,0.07)" }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2"
                style={{
                  color: activeTab === tab.id ? "var(--green)" : "hsl(240 8% 46%)",
                  borderColor: activeTab === tab.id ? "var(--green)" : "transparent",
                  background: activeTab === tab.id
                    ? "linear-gradient(180deg, rgba(0,212,106,0.06) 0%, transparent 100%)"
                    : "transparent",
                  transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
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
                  Dica: Utilize <strong className="font-mono px-1 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.2)" }}>-1</strong> para configurar limites infinitos (ilimitado), <strong className="font-mono px-1 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.2)" }}>0</strong> para bloquear.
                </div>

                <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "hsl(240 8% 50%)" }}>Globais</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Max. Workspaces" value={form.max_workspaces} onChange={(v) => setForm({ ...form, max_workspaces: v })} />
                  <NumField label="Max. Usuários" value={form.max_users} onChange={(v) => setForm({ ...form, max_users: v })} />
                  <NumField label="Max. Instâncias WPP" value={form.max_instances} onChange={(v) => setForm({ ...form, max_instances: v })} />
                  <NumField label="Envios diários" value={form.max_messages_per_day} onChange={(v) => setForm({ ...form, max_messages_per_day: v })} />
                </div>

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "hsl(240 8% 50%)" }}>Por módulo</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Max. Agentes IA" value={form.max_agents} onChange={(v) => setForm({ ...form, max_agents: v })} />
                  <NumField label="Max. Jornadas" value={form.max_journeys} onChange={(v) => setForm({ ...form, max_journeys: v })} />
                  <NumField label="Max. Campanhas" value={form.max_campaigns} onChange={(v) => setForm({ ...form, max_campaigns: v })} />
                  <NumField label="Max. Triggers" value={form.max_triggers} onChange={(v) => setForm({ ...form, max_triggers: v })} />
                  <NumField label="Max. Webhooks" value={form.max_webhooks} onChange={(v) => setForm({ ...form, max_webhooks: v })} />
                  <NumField label="Max. Contatos (CRM)" value={form.max_contacts} onChange={(v) => setForm({ ...form, max_contacts: v })} />
                  <NumField label="Max. Deals" value={form.max_deals} onChange={(v) => setForm({ ...form, max_deals: v })} />
                </div>

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "hsl(240 8% 50%)" }}>Shop</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Max. Lojas" value={form.max_shops} onChange={(v) => setForm({ ...form, max_shops: v })} />
                  <NumField label="Max. Produtos" value={form.max_products} onChange={(v) => setForm({ ...form, max_products: v })} />
                  <NumField label="Max. Integrações Shop" value={form.max_shop_integrations} onChange={(v) => setForm({ ...form, max_shop_integrations: v })} />
                </div>

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "hsl(240 8% 50%)" }}>Proxy</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Instâncias por proxy" value={form.max_instances_per_proxy} onChange={(v) => setForm({ ...form, max_instances_per_proxy: v })} />
                  <NumField label="Pool máximo" value={form.max_proxy_pool} onChange={(v) => setForm({ ...form, max_proxy_pool: v })} />
                </div>
              </div>
            )}

            {activeTab === "features" && (
              <div className="space-y-4 animate-fade-in-up">
                <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "hsl(240 8% 50%)" }}>Módulos principais</p>
                <FeatureToggle label="Inbox / Atendimento" desc="/inbox + queues + departments + SLA"
                  checked={form.allow_inbox} onChange={(v) => setForm({ ...form, allow_inbox: v })} color="#22c55e" />
                <FeatureToggle label="Uniq AI / Agentes" desc="/agents, RAG, OpenRouter, MCP"
                  checked={form.allow_ai} onChange={(v) => setForm({ ...form, allow_ai: v })} color="#a78bfa" />
                <FeatureToggle label="Jornadas" desc="/journeys — automações"
                  checked={form.allow_journeys} onChange={(v) => setForm({ ...form, allow_journeys: v })} color="#60a5fa" />
                <FeatureToggle label="CRM" desc="/crm/contacts/companies/deals/segments"
                  checked={form.allow_crm} onChange={(v) => setForm({ ...form, allow_crm: v })} color="#f59e0b" />
                <FeatureToggle label="Campanhas" desc="/campaigns — disparos em massa"
                  checked={form.allow_campaigns} onChange={(v) => setForm({ ...form, allow_campaigns: v })} color="#fb923c" />
                <FeatureToggle label="Shop / Produtos" desc="/shops + 10 integrações de e-commerce"
                  checked={form.allow_shop} onChange={(v) => setForm({ ...form, allow_shop: v })} color="#22c55e" />

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "hsl(240 8% 50%)" }}>Adicionais</p>
                <FeatureToggle label="Triggers (autoresponder)" desc="Sprint 8 — keyword matchers"
                  checked={form.allow_triggers} onChange={(v) => setForm({ ...form, allow_triggers: v })} color="#a855f7" />
                <FeatureToggle label="Warmup" desc="Anti-ban automático"
                  checked={form.allow_warmup} onChange={(v) => setForm({ ...form, allow_warmup: v })} color="#ec4899" />
                <FeatureToggle label="Newsletters / Channels" desc="WhatsApp Channels"
                  checked={form.allow_newsletters} onChange={(v) => setForm({ ...form, allow_newsletters: v })} color="#06b6d4" />
                <FeatureToggle label="Communities" desc="WhatsApp Communities"
                  checked={form.allow_communities} onChange={(v) => setForm({ ...form, allow_communities: v })} color="#10b981" />
                <FeatureToggle label="Instagram" desc="Multi-canal IG (DM)"
                  checked={form.allow_instagram} onChange={(v) => setForm({ ...form, allow_instagram: v })} color="#e1306c" />
                <FeatureToggle label="TikTok" desc="Multi-canal TikTok"
                  checked={form.allow_tiktok} onChange={(v) => setForm({ ...form, allow_tiktok: v })} color="#000" />

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "hsl(240 8% 50%)" }}>API & Infra</p>
                <FeatureToggle label="Acesso API" desc="SDK REST + instance token"
                  checked={form.allow_api_access} onChange={(v) => setForm({ ...form, allow_api_access: v })} color="#60a5fa" />
                <FeatureToggle label="Webhooks globais" desc="/webhooks/system (workspace-wide)"
                  checked={form.allow_global_webhook} onChange={(v) => setForm({ ...form, allow_global_webhook: v })} color="#fbbf24" />
                <FeatureToggle label="Sessão via Proxy" desc="Proxy padrão na instância"
                  checked={form.allow_proxy} onChange={(v) => setForm({ ...form, allow_proxy: v })} color="#60a5fa" />
                <FeatureToggle label="Proxy residencial" desc="Pool premium (mais caro)"
                  checked={form.allow_proxy_residencial} onChange={(v) => setForm({ ...form, allow_proxy_residencial: v })} color="#a78bfa" />

                <div className="pt-4 border-t" style={{ borderColor: "var(--border-default)" }}>
                  <p className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: "hsl(240 8% 50%)" }}>Canais visíveis (UI marketing)</p>
                  <FeatureGrid checkboxes={checkboxes} onChange={(key, val) => setCheckboxes({ ...checkboxes, [key]: val })} />
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
              <div className="space-y-5 animate-fade-in-up">
                {/* Live preview */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: "hsl(240 8% 46%)" }}>
                    Preview ao vivo · como aparece em /plans
                  </p>
                  <PlanCardPreview
                    name={form.name}
                    price={form.price}
                    description={form.description}
                    highlights={form.highlights}
                  />
                </div>
                <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }} />
                <HighlightsEditor highlights={form.highlights} onChange={(h) => setForm({ ...form, highlights: h })} />
                <p className="text-[10px]" style={{ color: "hsl(240 8% 36%)" }}>
                  Os textos foram pré-preenchidos com o que está exibido ao vivo em /plans. Edite conforme necessário — qualquer alteração substitui os valores automáticos.
                </p>
              </div>
            )}

          </div>

          {/* Footer Actions */}
          <div
            className="p-5 border-t flex gap-3 flex-shrink-0"
            style={{
              borderColor: "rgba(255,255,255,0.09)",
              background: "rgba(0,0,0,0.25)",
              backdropFilter: "blur(12px)",
            }}
          >
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
      className="rounded-2xl p-4 sm:p-5 pb-5 sm:pb-6 pr-5 sm:pr-8 animate-fade-in-up relative group"
      style={{
        background: `linear-gradient(135deg, ${style.bg} 0%, rgba(0,0,0,0.15) 100%)`,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: `1px solid ${style.border}`,
        borderRadius: "20px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)",
        transition: "all 0.35s cubic-bezier(0.16,1,0.3,1)",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.10)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      <div style={{
        position: "absolute", top: 0, left: "15%", right: "15%", height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)",
        pointerEvents: "none",
      }} />
      <div className="flex flex-wrap lg:flex-nowrap items-center gap-4 sm:gap-6">
        
        {/* Left: Icon */}
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

        {/* Identity Title */}
        <div className="min-w-[140px] flex-shrink-0 sm:w-[180px]">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold text-base truncate" style={{ color: "hsl(240 15% 93%)" }}>{plan.name}</h3>
            {plan.is_active ? 
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0" style={{ background: "rgba(0,212,106,0.08)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.15)" }}>Ativo</span> : 
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0" style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}>Inativo</span>}
          </div>
          <p className="text-sm font-medium truncate" style={{ color: style.accent }}>
            {plan.price === 0 ? "Gratuito" : `R$ ${plan.price}/mês`}
          </p>
        </div>

        {/* Middle: Limits Wrapper */}
        <div className="flex-1 flex flex-wrap gap-2 w-full lg:pr-10 min-w-[200px]">
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Workspaces</p>
              <p className="text-lg font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_workspaces === -1 ? "∞" : plan.max_workspaces}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Instâncias</p>
              <p className="text-lg font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_instances === -1 ? "∞" : plan.max_instances}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Usuários</p>
              <p className="text-lg font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_users === -1 ? "∞" : plan.max_users}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 38%)" }}>Msgs/dia</p>
              <p className="text-lg font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{plan.max_messages_per_day === -1 ? "∞" : plan.max_messages_per_day.toLocaleString("pt-BR")}</p>
           </div>
           
           <div className="flex-[1.5] min-w-[110px] rounded-xl p-3 flex items-center justify-center gap-2" style={{ background: plan.allow_proxy ? "rgba(96,165,250,0.06)" : "rgba(0,0,0,0.15)", border: plan.allow_proxy ? "1px solid rgba(96,165,250,0.12)" : "1px solid transparent" }}>
            <Globe className="w-4 h-4 hidden sm:block" style={{ color: plan.allow_proxy ? "#60a5fa" : "hsl(240 8% 28%)" }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: plan.allow_proxy ? "#93c5fd" : "hsl(240 8% 36%)" }}>
              Proxy {plan.allow_proxy ? "On" : "Off"}
            </span>
          </div>
        </div>
      </div>
      
      {/* Bottom Footer Area: Tags + Edit Button */}
      <div className="mt-4 pt-4 border-t flex items-center justify-between gap-4" style={{ borderColor: "var(--border-subtle)" }}>
        {/* Tags */}
        <div className="flex flex-wrap gap-2 flex-1">
          {enabledFeatures.map(({ key, label, icon }) => (
            <span key={key} className="flex items-center gap-1.5 text-[9px] px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 65%)" }}>
              {icon} {label}
            </span>
          ))}
          {enabledFeatures.length === 0 && <span className="text-[10px]" style={{ color: "hsl(240 8% 28%)" }}>Nenhum recurso extra</span>}
        </div>

        {/* Edit Action */}
        <button 
          onClick={onEdit} 
          className="btn-primary px-3 py-1.5 text-[10px] rounded-lg flex items-center gap-1.5 flex-shrink-0 transition-all active:scale-95 shadow-lg group-hover:shadow-green-500/10" 
          style={{ 
            background: "rgba(0,212,106,0.08)", 
            border: "1px solid rgba(0,212,106,0.18)", 
            color: "var(--green)" 
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.15)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.08)" }}
        >
          <Edit2 className="w-3 h-3" />
          <span>Editar</span>
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
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
            Planos
          </h1>
          <p className="text-sm mt-1 hidden sm:block" style={{ color: "hsl(240 8% 46%)" }}>
            Configure limites e recursos de cada plano.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setActivePlanDrawer("new")}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-all duration-150 active:scale-[0.97]"
            style={{ color: "var(--green)", background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.18)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.1)" }}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo Plano</span>
            <span className="sm:hidden">Novo</span>
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Shield className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-500 hidden sm:inline">Admin</span>
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
        <h3 className="text-xs font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 46%)" }}>
          Notas da Engenharia
        </h3>
        <ul className="space-y-2">
          {[
            <>Use <code className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: "var(--surface-2)", color: "hsl(240 15% 88%)" }}>-1</code> em limites numéricos para definir como ilimitado.</>,
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


// ─── Plan card preview (mirrors /plans PlanCard visually) ─────────────────────
const PREVIEW_META: Record<string, { color: string }> = {
  Free:     { color: "#60a5fa" },
  Starter:  { color: "#fb923c" },
  Pro:      { color: "#00d46a" },
  Business: { color: "#a78bfa" },
  Lifetime: { color: "#fbbf24" },
  _default: { color: "#c084fc" },
};

function PlanCardPreview({ name, price, description, highlights }: {
  name: string; price: number; description: string; highlights: string[];
}) {
  const meta = PREVIEW_META[name] ?? PREVIEW_META["_default"];
  const isFree = price === 0;

  return (
    <div style={{
      background: "hsl(240 18% 6%)",
      border: `1px solid ${meta.color}33`,
      borderRadius: 16,
      padding: "14px 16px",
      position: "relative",
      overflow: "hidden",
      maxWidth: 220,
    }}>
      {/* Ambient */}
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: `radial-gradient(circle, ${meta.color}18 0%, transparent 70%)`, pointerEvents: "none" }} />

      {/* Icon + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 10, background: `${meta.color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: meta.color }}>★</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(240 15% 92%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "Plano"}</div>
          {description && <div style={{ fontSize: 9, color: "hsl(240 8% 46%)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{description}</div>}
        </div>
      </div>

      {/* Price */}
      <div style={{ marginBottom: 10 }}>
        {isFree ? (
          <span style={{ fontSize: 18, fontWeight: 800, color: "hsl(240 15% 92%)" }}>Grátis</span>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{ fontSize: 10, color: "hsl(240 8% 46%)" }}>R$</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: "hsl(240 15% 92%)" }}>{price}</span>
            <span style={{ fontSize: 10, color: "hsl(240 8% 42%)" }}>/mês</span>
          </div>
        )}
      </div>

      {/* Highlights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {(highlights.length > 0 ? highlights : ["(usando valores dos limites)"]).slice(0, 6).map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "hsl(240 8% 65%)" }}>
            <span style={{ width: 10, height: 10, color: meta.color, flexShrink: 0 }}>✓</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
          </div>
        ))}
        {highlights.length === 0 && (
          <div style={{ fontSize: 9, color: "hsl(240 8% 35%)", fontStyle: "italic" }}>
            Adicione highlights abaixo para personalizar
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: "7px 0", borderRadius: 10, textAlign: "center", fontSize: 10, fontWeight: 600, background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30` }}>
        {isFree ? "Começar grátis →" : `Assinar por R$${price}/mês →`}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-field w-full font-mono text-sm"
      />
    </div>
  );
}

function FeatureToggle({ label, desc, checked, onChange, color }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; color: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <Toggle checked={checked} onChange={onChange} color={color} />
      <div>
        <span className="text-sm font-medium block" style={{ color: checked ? color : "hsl(240 15% 80%)" }}>{label}</span>
        <span className="text-[10px] block" style={{ color: "hsl(240 8% 46%)" }}>{desc}</span>
      </div>
    </label>
  );
}
