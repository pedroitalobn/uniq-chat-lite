"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { AnimatedTabContent } from "@/components/ui/AnimatedTabContent";
import {
  CreditCard, Shield, Edit2, Check, X, Loader2, Globe, Zap, Plus, GripVertical, Trash2, Flame,
} from "lucide-react";
import { toast } from "sonner";
import type { Plan } from "@/types";
import { cn } from "@/lib/utils";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

interface EditState {
  name: string;
  price: number;
  // Limites globais
  max_instances: number;
  max_messages_per_day: number;
  // Credits (Uniq Credits — Phase 1+ usage system)
  ai_credits_included_per_cycle: number;
  voice_credits_included_per_cycle: number;
  message_credits_included_per_cycle: number;
  overage_allowed_default: boolean;
  overage_millicents_per_credit?: number | null;
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
  allow_voice: boolean;
  allow_journeys: boolean;
  allow_crm: boolean;
  allow_inbox: boolean;
  allow_campaigns: boolean;
  allow_triggers: boolean;
  allow_warmup: boolean;
  allow_newsletters: boolean;
  allow_communities: boolean;
  allow_whatsapp_qr: boolean;
  allow_waba: boolean;
  allow_instagram: boolean;
  allow_tiktok: boolean;
  allow_api_access: boolean;
  allow_global_webhook: boolean;
  allow_shop: boolean;
  allow_helpdesk: boolean;
  allow_webchat: boolean;
  allow_proxy: boolean;
  allow_proxy_residencial: boolean;
  is_active: boolean;
  stripe_price_id: string;
  asaas_product_id: string;
  abacatepay_product_id: string;
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
  extra: { description: string; stripe_price_id: string; highlights: string[]; support?: string; asaas_product_id?: string; abacatepay_product_id?: string }
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  FEATURE_KEYS.forEach(({ key }) => {
    obj[key] = checkboxes[key] ?? false;
  });
  obj["description"] = extra.description;
  if (extra.highlights.length > 0) obj["highlights"] = extra.highlights;
  if (extra.stripe_price_id) obj["stripe_price_id"] = extra.stripe_price_id;
  if (extra.asaas_product_id) obj["asaas_product_id"] = extra.asaas_product_id;
  if (extra.abacatepay_product_id) obj["abacatepay_product_id"] = extra.abacatepay_product_id;
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
  // Drag-to-reorder: o GripVertical era só decorativo antes — não dava
  // pra reordenar. Agora usa @hello-pangea/dnd (já no bundle pra
  // contatos/deals) com chave instável (idx + valor) pra evitar
  // colisão quando dois itens têm texto vazio recém-adicionado.
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    const next = [...highlights];
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    onChange(next);
  };

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
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="highlights-list">
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="space-y-1.5"
            >
              {highlights.map((item, i) => (
                <Draggable key={`hl-${i}`} draggableId={`hl-${i}`} index={i}>
                  {(dragProvided, snapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      className="flex items-center gap-2"
                      style={{
                        ...dragProvided.draggableProps.style,
                        background: snapshot.isDragging ? "rgba(0,212,106,0.05)" : undefined,
                        borderRadius: snapshot.isDragging ? 8 : 0,
                      }}
                    >
                      <span
                        {...dragProvided.dragHandleProps}
                        className="cursor-grab active:cursor-grabbing p-0.5"
                        style={{ color: "hsl(240 8% 28%)" }}
                        title="Arraste pra reordenar"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
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
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
              {highlights.length === 0 && (
                <p className="text-[11px] text-center py-2" style={{ color: "hsl(240 8% 28%)" }}>
                  Nenhum texto personalizado
                </p>
              )}
            </div>
          )}
        </Droppable>
      </DragDropContext>
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
    ai_credits_included_per_cycle: p?.ai_credits_included_per_cycle ?? 0,
    voice_credits_included_per_cycle: p?.voice_credits_included_per_cycle ?? 0,
    message_credits_included_per_cycle: p?.message_credits_included_per_cycle ?? 0,
    overage_allowed_default: p?.overage_allowed_default ?? false,
    overage_millicents_per_credit: p?.overage_millicents_per_credit ?? null,
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
    allow_voice: p?.allow_voice ?? false,
    allow_journeys: p?.allow_journeys ?? false,
    allow_crm: p?.allow_crm ?? false,
    allow_inbox: p?.allow_inbox ?? true,
    allow_campaigns: p?.allow_campaigns ?? false,
    allow_triggers: p?.allow_triggers ?? false,
    allow_warmup: p?.allow_warmup ?? false,
    allow_newsletters: p?.allow_newsletters ?? false,
    allow_communities: p?.allow_communities ?? false,
    allow_whatsapp_qr: p?.allow_whatsapp_qr ?? true,
    allow_waba: p?.allow_waba ?? false,
    allow_instagram: p?.allow_instagram ?? false,
    allow_tiktok: p?.allow_tiktok ?? false,
    allow_api_access: p?.allow_api_access ?? true,
    allow_global_webhook: p?.allow_global_webhook ?? false,
    allow_shop: p?.allow_shop ?? false,
    allow_helpdesk: p?.allow_helpdesk ?? false,
    allow_webchat: p?.allow_webchat ?? false,
    allow_proxy: p?.allow_proxy ?? false,
    allow_proxy_residencial: p?.allow_proxy_residencial ?? false,
    is_active: p?.is_active ?? true,
    stripe_price_id: p?.stripe_price_id ?? "",
    asaas_product_id: p?.asaas_product_id ?? "",
    abacatepay_product_id: p?.abacatepay_product_id ?? "",
    description: typeof featObj["description"] === "string" ? featObj["description"] : "",
    highlights: (() => {
      const saved = Array.isArray(featObj["highlights"]) ? (featObj["highlights"] as string[]) : [];
      return saved.length > 0 ? saved : (p ? generateAutoHighlights(p, featObj) : []);
    })(),
    features: JSON.stringify(featObj, null, 2),
  });

  // O state checkboxes/setCheckboxes existia pra alimentar o grid
  // "Canais visíveis (UI marketing)" — esse grid foi removido, o
  // marketing JSON agora é derivado dos toggles reais. Deixamos só
  // o tipo pra silenciar o linter dos refs antigos no submit.
  void defaultCheckboxes; void featuresObjToCheckboxes;

  const [activeTab, setActiveTab] = useState<"general" | "limits" | "features" | "gateway" | "visuals">("general");

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        price: form.price,
        max_instances: form.max_instances,
        max_messages_per_day: form.max_messages_per_day,
        ai_credits_included_per_cycle: form.ai_credits_included_per_cycle,
        voice_credits_included_per_cycle: form.voice_credits_included_per_cycle,
        message_credits_included_per_cycle: form.message_credits_included_per_cycle,
        overage_allowed_default: form.overage_allowed_default,
        overage_millicents_per_credit: form.overage_millicents_per_credit,
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
        allow_voice: form.allow_voice,
        allow_journeys: form.allow_journeys,
        allow_crm: form.allow_crm,
        allow_inbox: form.allow_inbox,
        allow_campaigns: form.allow_campaigns,
        allow_triggers: form.allow_triggers,
        allow_warmup: form.allow_warmup,
        allow_newsletters: form.allow_newsletters,
        allow_communities: form.allow_communities,
        allow_whatsapp_qr: form.allow_whatsapp_qr,
        allow_waba: form.allow_waba,
        allow_instagram: form.allow_instagram,
        allow_tiktok: form.allow_tiktok,
        allow_api_access: form.allow_api_access,
        allow_global_webhook: form.allow_global_webhook,
        allow_shop: form.allow_shop,
        allow_helpdesk: form.allow_helpdesk,
        allow_webchat: form.allow_webchat,
        allow_proxy: form.allow_proxy,
        allow_proxy_residencial: form.allow_proxy_residencial,
        is_active: form.is_active,
        stripe_price_id: form.stripe_price_id || undefined,
        asaas_product_id: form.asaas_product_id || undefined,
        abacatepay_product_id: form.abacatepay_product_id || undefined,
        // features JSON é derivado dos toggles reais — antes tinha um
        // grid de "Canais marketing" separado que duplicava info; foi
        // removido. Agora a lista pública/cards reflete EXATAMENTE
        // o que está habilitado no plano.
        features: JSON.stringify(checkboxesToFeaturesObj({
          whatsapp:     form.allow_whatsapp_qr,
          instagram:    form.allow_instagram,
          crm:          form.allow_crm,
          campaigns:    form.allow_campaigns,
          integrations: form.allow_global_webhook || form.allow_api_access,
          api:          form.allow_api_access,
          webhooks:     form.allow_global_webhook,
          mcp:          form.allow_ai,
        }, {
          description: form.description,
          stripe_price_id: form.stripe_price_id,
          highlights: form.highlights,
          asaas_product_id: form.asaas_product_id,
          abacatepay_product_id: form.abacatepay_product_id,
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

      {/* Backdrop — z-[200] pra cobrir o WorkspaceSwitcher fixo do
          topo (que rodava em z-50/z-100 e ficava visível por cima do
          backdrop antigo, dando aparência de "drawer cortado"). */}
      <div
        className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Drawer — usa tokens do design system
          (var(--surface-1), var(--surface-border), var(--text-*)) em
          vez de cores hardcoded; assim acompanha automaticamente
          mudanças de tema. */}
      <div
        className="fixed top-0 right-0 z-[201] w-full max-w-md flex flex-col animate-drawer-in"
        style={{
          // 100dvh respeita a barra de URL do browser mobile —
          // diferente de 100vh que inclui chrome e fazia o footer
          // "Salvar" sumir atrás da barra. Em desktop é idêntico.
          height: "100dvh",
          maxHeight: "100dvh",
          background: "var(--surface-1)",
          borderLeft: "1px solid var(--surface-border)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
        }}
      >

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
            style={{ borderColor: "var(--surface-border)" }}>
            <div>
              <h2 className="text-base font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
                {isEditing ? "Editar Plano" : "Novo Plano"}
              </h2>
              {isEditing && <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-3)" }}>{p!.id}</p>}
            </div>
            <button onClick={onClose} className="p-2 rounded-xl transition-colors hover:bg-white/5"
              style={{ color: "var(--text-3)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div
            className="flex px-2 pt-2 border-b overflow-x-auto flex-shrink-0 custom-scrollbar"
            style={{ borderColor: "var(--surface-border)" }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2"
                style={{
                  color: activeTab === tab.id ? "var(--green)" : "var(--text-3)",
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
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar"
            style={{ background: "var(--surface-2)" }}>
            <AnimatedTabContent tabKey={activeTab}>
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

                <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--text-3)" }}>Globais</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Max. Workspaces" value={form.max_workspaces} onChange={(v) => setForm({ ...form, max_workspaces: v })} />
                  <NumField label="Max. Usuários" value={form.max_users} onChange={(v) => setForm({ ...form, max_users: v })} />
                  <NumField label="Max. Instâncias WPP" value={form.max_instances} onChange={(v) => setForm({ ...form, max_instances: v })} />
                  <NumField label="Envios diários" value={form.max_messages_per_day} onChange={(v) => setForm({ ...form, max_messages_per_day: v })} />
                </div>

                {/* Uniq Credits — allowance mensal por categoria. Free
                    plan zero em tudo = PAYG puro (user só usa AI/Voice
                    se comprar topup). overage_allowed_default vira o
                    default da quota; user pode mudar pelo painel /usage. */}
                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "var(--text-3)" }}>
                  Uniq Credits (allowance mensal — 0 = PAYG)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Créditos AI / mês" value={form.ai_credits_included_per_cycle} onChange={(v) => setForm({ ...form, ai_credits_included_per_cycle: v })} />
                  <NumField label="Créditos Voice / mês" value={form.voice_credits_included_per_cycle} onChange={(v) => setForm({ ...form, voice_credits_included_per_cycle: v })} />
                  <NumField label="Créditos Mensagens / mês" value={form.message_credits_included_per_cycle} onChange={(v) => setForm({ ...form, message_credits_included_per_cycle: v })} />
                  <NumField label="Overage R$ / 1k créditos extras (millicents)" value={form.overage_millicents_per_credit ?? 0} onChange={(v) => setForm({ ...form, overage_millicents_per_credit: v || null })} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs mt-2" style={{ color: "var(--text-2)" }}>
                  <input
                    type="checkbox"
                    checked={form.overage_allowed_default}
                    onChange={(e) => setForm({ ...form, overage_allowed_default: e.target.checked })}
                  />
                  Permitir overage por padrão (user pode mudar depois)
                </label>

                {/* Avisos de inconsistência: quando feature flag (Allow*) está ON
                    mas o cap (Max*) está em 0, fica ambíguo — backend trata como
                    ilimitado pra não quebrar o plano (ver fix em campaigns.go),
                    mas é melhor o admin escolher explícito (-1 ilimitado, N>0
                    cap, ou desligar a feature). hint passa pra NumField que
                    realça em âmbar e mostra texto guia. */}
                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "var(--text-3)" }}>Por módulo</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Max. Agentes IA" value={form.max_agents} onChange={(v) => setForm({ ...form, max_agents: v })}
                    mismatchHint={maxMismatchHint("Uniq AI / Agentes", form.allow_ai, form.max_agents)} />
                  <NumField label="Max. Jornadas" value={form.max_journeys} onChange={(v) => setForm({ ...form, max_journeys: v })}
                    mismatchHint={maxMismatchHint("Jornadas", form.allow_journeys, form.max_journeys)} />
                  <NumField label="Max. Campanhas" value={form.max_campaigns} onChange={(v) => setForm({ ...form, max_campaigns: v })}
                    mismatchHint={maxMismatchHint("Campanhas", form.allow_campaigns, form.max_campaigns)} />
                  <NumField label="Max. Triggers" value={form.max_triggers} onChange={(v) => setForm({ ...form, max_triggers: v })}
                    mismatchHint={maxMismatchHint("Triggers", form.allow_triggers, form.max_triggers)} />
                  <NumField label="Max. Webhooks" value={form.max_webhooks} onChange={(v) => setForm({ ...form, max_webhooks: v })} />
                  <NumField label="Max. Contatos (CRM)" value={form.max_contacts} onChange={(v) => setForm({ ...form, max_contacts: v })}
                    mismatchHint={maxMismatchHint("CRM", form.allow_crm, form.max_contacts)} />
                  <NumField label="Max. Deals" value={form.max_deals} onChange={(v) => setForm({ ...form, max_deals: v })}
                    mismatchHint={maxMismatchHint("CRM", form.allow_crm, form.max_deals)} />
                </div>

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "var(--text-3)" }}>Shop</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Max. Lojas" value={form.max_shops} onChange={(v) => setForm({ ...form, max_shops: v })}
                    mismatchHint={maxMismatchHint("Shop", form.allow_shop, form.max_shops)} />
                  <NumField label="Max. Produtos" value={form.max_products} onChange={(v) => setForm({ ...form, max_products: v })}
                    mismatchHint={maxMismatchHint("Shop", form.allow_shop, form.max_products)} />
                  <NumField label="Max. Integrações Shop" value={form.max_shop_integrations} onChange={(v) => setForm({ ...form, max_shop_integrations: v })}
                    mismatchHint={maxMismatchHint("Shop", form.allow_shop, form.max_shop_integrations)} />
                </div>

                <p className="text-[10px] uppercase tracking-wider font-medium pt-3" style={{ color: "var(--text-3)" }}>Proxy</p>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Instâncias por proxy" value={form.max_instances_per_proxy} onChange={(v) => setForm({ ...form, max_instances_per_proxy: v })}
                    mismatchHint={maxMismatchHint("Proxy", form.allow_proxy, form.max_instances_per_proxy)} />
                  <NumField label="Pool máximo" value={form.max_proxy_pool} onChange={(v) => setForm({ ...form, max_proxy_pool: v })}
                    mismatchHint={maxMismatchHint("Proxy", form.allow_proxy, form.max_proxy_pool)} />
                </div>
              </div>
            )}

            {activeTab === "features" && (
              <div className="space-y-5 animate-fade-in-up">
                {/* Núcleo de atendimento — sempre visível, padrão */}
                <FeatureGroup title="Atendimento" hint="Funcionalidades core de inbox e fila">
                  <FeatureToggle label="Inbox" desc="/inbox + queues + departments + SLA"
                    checked={form.allow_inbox} onChange={(v) => setForm({ ...form, allow_inbox: v })} color="#22c55e" />
                  <FeatureToggle label="Help Desk" desc="/help-desk — central de ajuda + artigos públicos"
                    checked={form.allow_helpdesk} onChange={(v) => setForm({ ...form, allow_helpdesk: v })} color="#22d3ee" />
                </FeatureGroup>

                {/* Canais — instâncias que o user pode criar */}
                <FeatureGroup title="Canais (instâncias)" hint="Tipos de instância que o plano libera. Se um canal está OFF, ele some da UI de criação de instância.">
                  <FeatureToggle label="WhatsApp (QR)" desc="ChannelType=whatsapp — whatsmeow/Baileys via QR/pareamento"
                    checked={form.allow_whatsapp_qr} onChange={(v) => setForm({ ...form, allow_whatsapp_qr: v })} color="#25d366" />
                  <FeatureToggle label="WhatsApp Business API" desc="ChannelType=waba — Cloud API da Meta com templates"
                    checked={form.allow_waba} onChange={(v) => setForm({ ...form, allow_waba: v })} color="#0a8f4d" />
                  <FeatureToggle label="WhatsApp Communities" desc="Comunidades + grupos linkados (whatsmeow)"
                    checked={form.allow_communities} onChange={(v) => setForm({ ...form, allow_communities: v })} color="#10b981" />
                  <FeatureToggle label="Instagram" desc="ChannelType=instagram — DM via Graph API"
                    checked={form.allow_instagram} onChange={(v) => setForm({ ...form, allow_instagram: v })} color="#e1306c" />
                  <FeatureToggle label="TikTok" desc="ChannelType=tiktok — Business Messaging"
                    checked={form.allow_tiktok} onChange={(v) => setForm({ ...form, allow_tiktok: v })} color="#fe2c55" />
                  <FeatureToggle label="WebChat (widget)" desc="ChannelType=webchat — chat embedável no site"
                    checked={form.allow_webchat} onChange={(v) => setForm({ ...form, allow_webchat: v })} color="#06b6d4" />
                  <FeatureToggle label="Newsletters / Channels" desc="WhatsApp Channels (broadcast)"
                    checked={form.allow_newsletters} onChange={(v) => setForm({ ...form, allow_newsletters: v })} color="#06b6d4" />
                </FeatureGroup>

                {/* CRM e Vendas — funil + automação de vendas */}
                <FeatureGroup title="CRM & Vendas">
                  <FeatureToggle label="CRM" desc="/crm/contacts/companies/deals/segments/tasks/meetings"
                    checked={form.allow_crm} onChange={(v) => setForm({ ...form, allow_crm: v })} color="#f59e0b" />
                  <FeatureToggle label="Shop / Produtos" desc="/shops + integrações de e-commerce"
                    checked={form.allow_shop} onChange={(v) => setForm({ ...form, allow_shop: v })} color="#22c55e" />
                  <FeatureToggle label="Campanhas" desc="/campaigns — disparos em massa pra contatos/grupos"
                    checked={form.allow_campaigns} onChange={(v) => setForm({ ...form, allow_campaigns: v })} color="#fb923c" />
                </FeatureGroup>

                {/* IA & Automação — agentes, jornadas, triggers */}
                <FeatureGroup title="Automação & IA">
                  <FeatureToggle label="Uniq AI / Agentes" desc="/agents — RAG + tools + voz (TTS) + IVC"
                    checked={form.allow_ai} onChange={(v) => setForm({ ...form, allow_ai: v })} color="#a78bfa" />
                  <FeatureToggle label="Uniq Voice" desc="TTS gerenciado pela plataforma + provider próprio"
                    checked={form.allow_voice} onChange={(v) => setForm({ ...form, allow_voice: v })} color="#f59e0b" />
                  <FeatureToggle label="Jornadas" desc="/journeys — flow builder de automações"
                    checked={form.allow_journeys} onChange={(v) => setForm({ ...form, allow_journeys: v })} color="#60a5fa" />
                  <FeatureToggle label="Triggers" desc="Autoresponders por keyword/regex"
                    checked={form.allow_triggers} onChange={(v) => setForm({ ...form, allow_triggers: v })} color="#a855f7" />
                  <FeatureToggle label="Warmup" desc="Aquecimento anti-ban automático"
                    checked={form.allow_warmup} onChange={(v) => setForm({ ...form, allow_warmup: v })} color="#ec4899" />
                </FeatureGroup>

                {/* Integração — API, webhooks, proxy */}
                <FeatureGroup title="API & Infra">
                  <FeatureToggle label="Acesso API" desc="SDK REST + instance token (n8n, Zapier, etc.)"
                    checked={form.allow_api_access} onChange={(v) => setForm({ ...form, allow_api_access: v })} color="#60a5fa" />
                  <FeatureToggle label="Webhooks globais" desc="/webhooks/system (workspace-wide)"
                    checked={form.allow_global_webhook} onChange={(v) => setForm({ ...form, allow_global_webhook: v })} color="#fbbf24" />
                  <FeatureToggle label="Proxy padrão" desc="Sessão WhatsApp via proxy datacenter"
                    checked={form.allow_proxy} onChange={(v) => setForm({ ...form, allow_proxy: v })} color="#60a5fa" />
                  <FeatureToggle label="Proxy residencial" desc="Pool premium (anti-ban robusto, custo maior)"
                    checked={form.allow_proxy_residencial} onChange={(v) => setForm({ ...form, allow_proxy_residencial: v })} color="#a78bfa" />
                </FeatureGroup>

                <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.18)", color: "#93c5fd" }}>
                  💡 Módulos desligados aqui são automaticamente escondidos da UI do user (sidebar, menus, criação de instância). Sem flag separada de "marketing".
                </p>
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
                  <p className="text-[10px] mt-1.5" style={{ color: "var(--text-4)" }}>Copie o ID da precificação do produto no painel do Stripe.</p>
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
                  <p className="text-[10px] mt-1.5" style={{ color: "var(--text-4)" }}>Mapeado apenas em integrações compatíveis no Asaas.</p>
                </div>
                <div>
                  <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>AbacatePay Product ID</label>
                  <input
                    type="text"
                    value={form.abacatepay_product_id}
                    onChange={(e) => setForm({ ...form, abacatepay_product_id: e.target.value })}
                    placeholder="prod_xxxxxxxxxxxxxxxxx"
                    className="input-field w-full font-mono text-xs"
                  />
                  <p className="text-[10px] mt-1.5" style={{ color: "var(--text-4)" }}>ID do produto no painel da AbacatePay para checkout PIX recorrente.</p>
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
                <div className="border-t" style={{ borderColor: "var(--border-subtle)" }} />
                <HighlightsEditor highlights={form.highlights} onChange={(h) => setForm({ ...form, highlights: h })} />
                <p className="text-[10px]" style={{ color: "hsl(240 8% 36%)" }}>
                  Os textos foram pré-preenchidos com o que está exibido ao vivo em /plans. Edite conforme necessário — qualquer alteração substitui os valores automáticos.
                </p>
              </div>
            )}

            </AnimatedTabContent>
          </div>

          {/* Footer Actions — paddingBottom inclui safe-area pra não ficar
              colado na home indicator do iOS. */}
          <div
            className="px-5 pt-4 border-t flex gap-3 flex-shrink-0"
            style={{
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
              borderColor: "var(--surface-border)",
              background: "var(--surface-1)",
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
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-4)" }}>Workspaces</p>
              <p className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>{plan.max_workspaces === -1 ? "∞" : plan.max_workspaces}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-4)" }}>Instâncias</p>
              <p className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>{plan.max_instances === -1 ? "∞" : plan.max_instances}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-4)" }}>Usuários</p>
              <p className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>{plan.max_users === -1 ? "∞" : plan.max_users}</p>
           </div>
           <div className="flex-1 min-w-[90px] rounded-xl p-3 flex flex-col justify-center" style={{ background: "rgba(0,0,0,0.2)" }}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-4)" }}>Msgs/dia</p>
              <p className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>{plan.max_messages_per_day === -1 ? "∞" : plan.max_messages_per_day.toLocaleString("pt-BR")}</p>
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
            <span key={key} className="flex items-center gap-1.5 text-[9px] px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "var(--text-2)" }}>
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
    background: "var(--surface-solid)",
    border: "1px solid var(--border)",
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
            <>Use <code className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: "var(--surface-2)", color: "var(--text-1)" }}>-1</code> em limites numéricos para definir como ilimitado.</>,
            "Alterar o status de comercialização para 'Inativo' remove o plano da tela de aquisição, mas não interrompe subscrições em andamento.",
            <>O campo <strong style={{ color: "var(--text-1)" }}>Stripe Price ID</strong> dita o produto faturado no checkout dinâmico da plataforma.</>,
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
      background: "var(--surface-solid)",
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
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "Plano"}</div>
          {description && <div style={{ fontSize: 9, color: "hsl(240 8% 46%)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{description}</div>}
        </div>
      </div>

      {/* Price */}
      <div style={{ marginBottom: 10 }}>
        {isFree ? (
          <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text-1)" }}>Grátis</span>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{ fontSize: 10, color: "hsl(240 8% 46%)" }}>R$</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text-1)" }}>{price}</span>
            <span style={{ fontSize: 10, color: "hsl(240 8% 42%)" }}>/mês</span>
          </div>
        )}
      </div>

      {/* Highlights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {(highlights.length > 0 ? highlights : ["(usando valores dos limites)"]).slice(0, 6).map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "var(--text-2)" }}>
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

// maxMismatchHint — devolve mensagem de aviso quando a feature flag (Allow*)
// está ligada mas o cap (Max*) está em 0. Combinação ambígua: backend trata
// como ilimitado (defesa anti-bug, ver campaigns.go), mas é melhor o admin
// escolher explícito. Vazio = sem aviso.
function maxMismatchHint(featureName: string, allow: boolean, max: number): string | undefined {
  if (allow && max === 0) {
    return `${featureName} está ON mas o limite é 0 — backend trata como ilimitado. Use -1 pra explicitar ilimitado, ou desligue a feature.`;
  }
  return undefined;
}

function NumField({
  label, value, onChange, mismatchHint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Quando passado, exibe aviso âmbar abaixo do input. Usado pra
   *  detectar plan editor inconsistente (ex: allow_campaigns=true +
   *  max_campaigns=0 → ambíguo). */
  mismatchHint?: string;
}) {
  return (
    <div>
      <label className="text-xs block mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-field w-full font-mono text-sm"
        style={mismatchHint
          ? { borderColor: "rgba(245,158,11,0.55)", boxShadow: "0 0 0 1px rgba(245,158,11,0.20)" }
          : undefined}
      />
      {mismatchHint && (
        <p className="text-[10px] mt-1 flex items-start gap-1" style={{ color: "#f59e0b" }}>
          <span aria-hidden>⚠</span>
          <span>{mismatchHint}</span>
        </p>
      )}
    </div>
  );
}

function FeatureToggle({ label, desc, checked, onChange, color }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; color: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-1.5">
      <Toggle checked={checked} onChange={onChange} color={color} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium block" style={{ color: checked ? color : "hsl(240 15% 80%)" }}>{label}</span>
        <span className="text-[10px] block truncate" style={{ color: "hsl(240 8% 46%)" }}>{desc}</span>
      </div>
    </label>
  );
}

// FeatureGroup — agrupa toggles correlatos com header e contador
// "N de M ligados". Substitui o cabeçalho "Módulos principais" /
// "Adicionais" / "API & Infra" que era só texto.
function FeatureGroup({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "hsl(240 15% 70%)" }}>{title}</p>
      </div>
      {hint && <p className="text-[11px] mb-2" style={{ color: "var(--text-3)" }}>{hint}</p>}
      <div className="space-y-0">{children}</div>
    </div>
  );
}
