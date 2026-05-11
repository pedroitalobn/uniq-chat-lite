"use client";

// Dialog rápido pra editar nome, cor e ícone do workspace. Aberto via
// menu de contexto no chip de workspace do Sidebar. Só o owner pode
// editar — o backend retorna 403 caso contrário.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Bell, Bot, Briefcase, Building2, Check, Coffee, Compass,
  Crown, Diamond, Flame, Gem, Heart, LucideIcon, Megaphone, MessageSquare,
  Mic2, Music, Palette, Pin, Plane, Rocket, Shield, ShoppingBag, Smile,
  Sparkles, Star, Sun, Target, TrendingUp, Trophy, Wand2, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { workspacesApi } from "@/lib/api";
import { motion } from "framer-motion";

const ICONS: Record<string, LucideIcon> = {
  Building2, Sparkles, Rocket, Crown, Heart, Star, Zap, Trophy,
  Diamond, Gem, Flame, Sun, Coffee, Plane, Compass, Target,
  Pin, Music, ShoppingBag, Megaphone, Bot, Wand2, Mic2, Smile,
  TrendingUp, Activity, MessageSquare, Briefcase, Shield, Bell, Palette,
};

const COLORS = [
  "#00d46a", "#3b82f6", "#a78bfa", "#f472b6", "#fbbf24", "#10b981",
  "#06b6d4", "#8b5cf6", "#ec4899", "#f97316", "#ef4444", "#64748b",
];

export function WorkspaceCustomizeDialog({
  workspaceId,
  initialName,
  initialColor,
  initialIcon,
  isOwner,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  initialName: string;
  initialColor?: string;
  initialIcon?: string;
  isOwner: boolean;
  onClose: () => void;
  onSaved: (next: { name: string; color: string; icon: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor || "#7c3aed");
  const [icon, setIcon] = useState(initialIcon || "Building2");
  const queryClient = useQueryClient();

  useEffect(() => {
    setName(initialName);
    setColor(initialColor || "#7c3aed");
    setIcon(initialIcon || "Building2");
  }, [workspaceId, initialName, initialColor, initialIcon]);

  const saveMutation = useMutation({
    mutationFn: () => workspacesApi.update(workspaceId, { name, color, icon }),
    onSuccess: () => {
      toast.success("Workspace atualizado");
      onSaved({ name, color, icon });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Falha ao atualizar workspace");
    },
  });

  const PreviewIcon = ICONS[icon] ?? Building2;

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0"
        style={{
          background: "rgba(0,0,0,0.70)",
          backdropFilter: "blur(8px) saturate(150%)",
          WebkitBackdropFilter: "blur(8px) saturate(150%)",
        }}
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 32 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 50%, rgba(0,0,0,0.10) 100%)",
          backdropFilter: "blur(32px) saturate(200%) brightness(1.1)",
          WebkitBackdropFilter: "blur(32px) saturate(200%) brightness(1.1)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 40px 80px rgba(0,0,0,0.70), 0 16px 32px rgba(0,0,0,0.50), 0 4px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.20)",
        }}
      >
        {/* Top light line */}
        <div style={{
          position: "absolute", top: 0, left: "20%", right: "20%", height: "1px",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.30), transparent)",
          pointerEvents: "none",
        }} />
        {/* Ambient orb */}
        <div style={{
          position: "absolute", top: "-50px", right: "-50px",
          width: "180px", height: "180px", borderRadius: "50%",
          background: `radial-gradient(circle, ${color}26 0%, transparent 70%)`,
          filter: "blur(35px)", pointerEvents: "none",
        }} />
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}22`, border: `1px solid ${color}44` }}>
              <PreviewIcon className="w-5 h-5" style={{ color }} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{name || "Workspace"}</h3>
              <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Personalize aparência</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-3)]" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-3)" }}>
              Nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none disabled:opacity-50"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
              placeholder="Nome do workspace"
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-3)" }}>
              Cor de destaque
            </label>
            <div className="grid grid-cols-6 gap-2">
              {COLORS.map((c) => {
                const active = c.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={c}
                    onClick={() => isOwner && setColor(c)}
                    disabled={!isOwner}
                    className="aspect-square rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
                    style={{
                      background: c,
                      boxShadow: active ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${c}` : "none",
                    }}
                  >
                    {active && <Check className="w-4 h-4 text-white drop-shadow-sm" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => isOwner && setColor(e.target.value)}
                disabled={!isOwner}
                className="w-8 h-8 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}
              />
              <span className="text-xs font-mono" style={{ color: "var(--text-3)" }}>{color.toUpperCase()}</span>
            </div>
          </div>

          {/* Icon */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-3)" }}>
              Ícone
            </label>
            <div className="grid grid-cols-8 gap-1.5 max-h-44 overflow-y-auto p-1 rounded-lg" style={{ background: "var(--surface-3)" }}>
              {Object.entries(ICONS).map(([name, Icon]) => {
                const active = name === icon;
                return (
                  <button
                    key={name}
                    onClick={() => isOwner && setIcon(name)}
                    disabled={!isOwner}
                    title={name}
                    className="aspect-square rounded-lg flex items-center justify-center transition-all disabled:opacity-50"
                    style={{
                      background: active ? `${color}22` : "transparent",
                      border: `1px solid ${active ? `${color}66` : "transparent"}`,
                      color: active ? color : "var(--text-2)",
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {!isOwner && (
            <p className="text-xs text-center" style={{ color: "var(--text-3)" }}>
              Apenas o proprietário pode editar este workspace.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t flex gap-2 justify-end" style={{ borderColor: "var(--border-subtle)" }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!isOwner || saveMutation.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ background: color, color: "#fff" }}
          >
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Helper para resolver o ícone fora do dialog (Sidebar, etc).
export function resolveWorkspaceIcon(name?: string): LucideIcon {
  if (!name) return Building2;
  return ICONS[name] ?? Building2;
}
