"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  MessageCircle, Settings, Eye, Smartphone, Monitor, ArrowRight,
  Layout, Shield, Palette, Type, MousePointer, BoxSelect,
} from "lucide-react";
import { toast } from "sonner";
import { widgetApi } from "@/lib/helpdesk-api";
import api from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const BADGE_STYLES = [
  { id: "bubble" as const, label: "Bolha", icon: MessageCircle },
  { id: "pill" as const, label: "Pílula", icon: BoxSelect },
  { id: "square" as const, label: "Quadrado", icon: Layout },
  { id: "minimal" as const, label: "Minimal", icon: MousePointer },
];

const POSITIONS = [
  { id: "bottom-right" as const, label: "Inferior direito" },
  { id: "bottom-left" as const, label: "Inferior esquerdo" },
  { id: "top-right" as const, label: "Superior direito" },
  { id: "top-left" as const, label: "Superior esquerdo" },
];

const SHADOWS = [
  { id: "none" as const, label: "Nenhuma" },
  { id: "soft" as const, label: "Suave" },
  { id: "medium" as const, label: "Média" },
  { id: "strong" as const, label: "Forte" },
];

const EMOJI_ICONS = ["💬", "🚀", "❓", "👋", "🤖", "✨", "📞", "🛟", "🔔", "💡", "🎯", "🏆"];

function firstNonEmpty(...vals: (string | undefined)[]) {
  for (const v of vals) if (v && v.trim() !== "") return v;
  return "";
}

export default function WidgetBuilder() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([]);

  const [form, setForm] = useState<Record<string, any>>({
    enabled: true,
    display_name: "",
    greeting: "",
    primary_color: "#00d46a",
    position: "bottom-right",
    avatar_url: "",
    destination_type: "inbox",
    destination_instance_id: null,
    help_desk_enabled: true,
    badge_style: "bubble",
    badge_icon: "💬",
    badge_color: "",
    offset_x: 20,
    offset_y: 20,
    border_radius: 9999,
    shadow_intensity: "medium",
  });

  // Load widget config
  useEffect(() => {
    if (!wsId) return;
    setLoading(true);
    widgetApi.getWidget(wsId)
      .then((res) => {
        const d = res.data;
        setForm((prev) => ({
          ...prev,
          ...d,
          badge_color: d.badge_color || d.primary_color || "#00d46a",
        }));
      })
      .catch(() => toast.error("Erro ao carregar config do widget"))
      .finally(() => setLoading(false));
  }, [wsId]);

  // Load workspace instances for destination dropdown
  useEffect(() => {
    if (!wsId) return;
    api.get("/v1/instances", { headers: { "X-Workspace-ID": wsId } })
      .then((res) => {
        const items = (res.data ?? []).filter((i: any) => i.channel !== "webchat");
        setInstances(items.map((i: any) => ({ id: i.id, name: i.name })));
      })
      .catch(() => {});
  }, [wsId]);

  const update = (patch: Record<string, any>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    if (!wsId) return;
    setSaving(true);
    try {
      const payload = { ...form };
      // badge_color vazio herda primary_color no backend, mas enviamos explicitamente
      if (!payload.badge_color) payload.badge_color = payload.primary_color;
      await widgetApi.updateWidget(payload, wsId);
      toast.success("Widget salvo!");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const color = form.primary_color ?? "#00d46a";
  const badgeColor = form.badge_color || color;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: "var(--text-3)" }} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      {/* Left — Form */}
      <div className="space-y-5">
        {/* Appearance */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Palette className="w-4 h-4" style={{ color }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Aparência do badge</h3>
          </div>

          {/* Badge style */}
          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Estilo do botão</label>
            <div className="grid grid-cols-4 gap-2">
              {BADGE_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => update({ badge_style: s.id })}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all"
                  style={{
                    background: form.badge_style === s.id ? `${color}14` : "var(--input)",
                    border: `1px solid ${form.badge_style === s.id ? color : "var(--border-default)"}`,
                  }}
                >
                  <s.icon className="w-4 h-4" style={{ color: form.badge_style === s.id ? color : "var(--text-3)" }} />
                  <span className="text-[10px] font-medium" style={{ color: form.badge_style === s.id ? color : "var(--text-3)" }}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Icon picker */}
          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Ícone do botão</label>
            <div className="flex gap-2 flex-wrap">
              {EMOJI_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => update({ badge_icon: emoji })}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all"
                  style={{
                    background: form.badge_icon === emoji ? `${color}20` : "var(--input)",
                    border: `1px solid ${form.badge_icon === emoji ? color : "var(--border-default)"}`,
                  }}
                >
                  {emoji}
                </button>
              ))}
              <input
                value={form.badge_icon ?? ""}
                onChange={(e) => update({ badge_icon: e.target.value })}
                placeholder="Emoji ou ícone"
                className="w-28 h-9 rounded-lg px-2 text-xs"
                style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }}
              />
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Cor principal</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primary_color} onChange={(e) => update({ primary_color: e.target.value })}
                  className="w-9 h-9 rounded-lg border-0 p-0.5 cursor-pointer" style={{ background: "var(--input)" }} />
                <input value={form.primary_color} onChange={(e) => update({ primary_color: e.target.value })}
                  className="flex-1 h-9 rounded-lg px-2 text-xs font-mono" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Cor do badge</label>
              <div className="flex items-center gap-2">
                <input type="color" value={badgeColor} onChange={(e) => update({ badge_color: e.target.value })}
                  className="w-9 h-9 rounded-lg border-0 p-0.5 cursor-pointer" style={{ background: "var(--input)" }} />
                <input value={badgeColor} onChange={(e) => update({ badge_color: e.target.value })}
                  className="flex-1 h-9 rounded-lg px-2 text-xs font-mono" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
              </div>
            </div>
          </div>

          {/* Position */}
          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Posição na tela</label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => update({ position: p.id })}
                  className="px-3 py-2 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: form.position === p.id ? `${color}14` : "var(--input)",
                    border: `1px solid ${form.position === p.id ? color : "var(--border-default)"}`,
                    color: form.position === p.id ? color : "var(--text-3)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Offset + Border radius + Shadow */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Offset X (px)</label>
              <input type="number" value={form.offset_x} onChange={(e) => update({ offset_x: Number(e.target.value) })}
                className="w-full h-9 rounded-lg px-2 text-xs" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Offset Y (px)</label>
              <input type="number" value={form.offset_y} onChange={(e) => update({ offset_y: Number(e.target.value) })}
                className="w-full h-9 rounded-lg px-2 text-xs" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Border radius (px)</label>
              <input type="number" value={form.border_radius} onChange={(e) => update({ border_radius: Number(e.target.value) })}
                className="w-full h-9 rounded-lg px-2 text-xs" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Intensidade da sombra</label>
            <div className="flex gap-2">
              {SHADOWS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => update({ shadow_intensity: s.id })}
                  className="flex-1 py-2 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: form.shadow_intensity === s.id ? `${color}14` : "var(--input)",
                    border: `1px solid ${form.shadow_intensity === s.id ? color : "var(--border-default)"}`,
                    color: form.shadow_intensity === s.id ? color : "var(--text-3)",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Type className="w-4 h-4" style={{ color }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Conteúdo</h3>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Nome do widget</label>
            <input value={form.display_name ?? ""} onChange={(e) => update({ display_name: e.target.value })}
              placeholder="Suporte" className="w-full h-10 rounded-xl px-3 text-sm" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Mensagem de boas-vindas</label>
            <input value={form.greeting ?? ""} onChange={(e) => update({ greeting: e.target.value })}
              placeholder="Olá! Como posso ajudar?" className="w-full h-10 rounded-xl px-3 text-sm" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Avatar URL (opcional)</label>
            <input value={form.avatar_url ?? ""} onChange={(e) => update({ avatar_url: e.target.value })}
              placeholder="https://..." className="w-full h-10 rounded-xl px-3 text-sm" style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }} />
          </div>
        </div>

        {/* Routing */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}>
          <div className="flex items-center gap-2 mb-1">
            <ArrowRight className="w-4 h-4" style={{ color }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Roteamento</h3>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Para onde as mensagens vão?</label>
            <div className="flex gap-2">
              <button
                onClick={() => update({ destination_type: "inbox" })}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: form.destination_type === "inbox" ? `${color}14` : "var(--input)",
                  border: `1px solid ${form.destination_type === "inbox" ? color : "var(--border-default)"}`,
                  color: form.destination_type === "inbox" ? color : "var(--text-3)",
                }}
              >
                <Monitor className="w-3.5 h-3.5" /> Inbox
              </button>
              <button
                onClick={() => update({ destination_type: "redirect_instance" })}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: form.destination_type === "redirect_instance" ? `${color}14` : "var(--input)",
                  border: `1px solid ${form.destination_type === "redirect_instance" ? color : "var(--border-default)"}`,
                  color: form.destination_type === "redirect_instance" ? color : "var(--text-3)",
                }}
              >
                <Smartphone className="w-3.5 h-3.5" /> Instância
              </button>
            </div>
          </div>
          {form.destination_type === "redirect_instance" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Instância de destino</label>
              <select
                value={form.destination_instance_id ?? ""}
                onChange={(e) => update({ destination_instance_id: e.target.value || null })}
                className="w-full h-10 rounded-xl px-3 text-sm"
                style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }}
              >
                <option value="">Selecione uma instância</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: color, color: "#03170a", opacity: saving ? 0.7 : 1 }}>
            {saving ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Settings className="w-4 h-4" />
            )}
            Salvar widget
          </button>
        </div>
      </div>

      {/* Right — Live Preview */}
      <div className="space-y-4">
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}>
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4" style={{ color }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Preview ao vivo</h3>
          </div>
          <PreviewContainer form={form} />
        </div>
      </div>
    </div>
  );
}

function PreviewContainer({ form }: { form: Record<string, any> }) {
  const color = form.primary_color ?? "#00d46a";
  const badgeColor = form.badge_color || color;
  const pos = form.position ?? "bottom-right";
  const isTop = pos.startsWith("top");
  const isLeft = pos.endsWith("left");

  const shadowMap: Record<string, string> = {
    none: "none",
    soft: `0 2px 12px ${badgeColor}30`,
    medium: `0 4px 24px ${badgeColor}44`,
    strong: `0 8px 40px ${badgeColor}60`,
  };

  const badgeSize = form.badge_style === "pill" ? { w: 120, h: 48 } :
    form.badge_style === "square" ? { w: 56, h: 56 } :
    form.badge_style === "minimal" ? { w: 40, h: 40 } :
    { w: 56, h: 56 };

  const borderR = form.badge_style === "bubble" ? "50%" :
    form.badge_style === "pill" ? 9999 :
    form.badge_style === "square" ? 14 :
    form.border_radius ?? 9999;

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ background: "#1a1a2e", border: "1px solid var(--border-default)", height: 320 }}>
      {/* Fake website background */}
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: `radial-gradient(circle at 20% 30%, ${color}15 0%, transparent 50%), radial-gradient(circle at 80% 70%, ${color}10 0%, transparent 50%)`
      }} />
      <div className="absolute inset-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="h-6 rounded-t-lg" style={{ background: "rgba(255,255,255,0.05)" }} />
      </div>

      {/* Badge */}
      <motion.div
        className="absolute flex items-center justify-center cursor-pointer"
        style={{
          [isTop ? "top" : "bottom"]: `${form.offset_y ?? 20}px`,
          [isLeft ? "left" : "right"]: `${form.offset_x ?? 20}px`,
          width: badgeSize.w,
          height: badgeSize.h,
          borderRadius: borderR,
          background: badgeColor,
          boxShadow: shadowMap[form.shadow_intensity ?? "medium"],
          color: "#fff",
          fontSize: form.badge_style === "pill" ? 13 : 20,
          fontWeight: 700,
          zIndex: 10,
        }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
      >
        {form.badge_style === "pill" ? (
          <span className="flex items-center gap-1.5">
            <span>{form.badge_icon || "💬"}</span>
            <span>{form.display_name || "Chat"}</span>
          </span>
        ) : (
          <span>{form.badge_icon || "💬"}</span>
        )}
      </motion.div>
    </div>
  );
}
