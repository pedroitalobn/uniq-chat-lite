"use client";

// QuickActionMenu — menu de ações rápidas estilo iOS context menu.
// Aparece sobre um overlay escurecido, posicionado próximo ao ponto onde o
// long-press disparou. Ações renderizadas em pílula vertical com ícone +
// label, último item pode ser destrutivo (vermelho). Tap fora fecha.
//
// Pattern de uso (junto com useLongPress):
//   const [menu, setMenu] = useState<{x:number; y:number}|null>(null);
//   const longPress = useLongPress(() => {
//     setMenu({ x: lastX.current, y: lastY.current });
//   });
//   <div {...longPress}>...row...</div>
//   <QuickActionMenu
//     anchor={menu}
//     onClose={() => setMenu(null)}
//     items={[{ id, label, icon, onSelect }, ...]}
//   />

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { haptic } from "@/lib/haptics";

export type QuickAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Pinta o item em vermelho (destrutivo). Default false. */
  destructive?: boolean;
  /** Subtítulo opcional (cinza, abaixo do label). */
  hint?: string;
  onSelect: () => void;
};

export function QuickActionMenu({
  anchor,
  onClose,
  items,
  preview,
}: {
  /** Posição em px (clientX/Y) onde o gesture disparou. null = fechado. */
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  items: QuickAction[];
  /** Card de preview opcional acima do menu (ex: avatar + nome do contato). */
  preview?: React.ReactNode;
}) {
  const open = anchor !== null;
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Calcula posição do menu garantindo que ele fica DENTRO da viewport —
  // evita cortar borda direita / inferior em telas pequenas.
  useEffect(() => {
    if (!open || !anchor) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const menuW = 240;
    // Estima altura: 52px por item + padding. Ajusta com ref após mount.
    const estimatedH = items.length * 52 + (preview ? 76 : 16);
    let left = anchor.x - menuW / 2;
    let top = anchor.y + 8;
    // Ajusta horizontal pra não cortar nas bordas.
    if (left < 12) left = 12;
    if (left + menuW > W - 12) left = W - menuW - 12;
    // Se estouraria no fim da tela, abre pra cima.
    if (top + estimatedH > H - 24) top = anchor.y - estimatedH - 12;
    if (top < 12) top = 12;
    setPos({ left, top });
  }, [open, anchor, items.length, preview]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && pos && (
        <>
          <motion.div
            key="qa-backdrop"
            className="fixed inset-0 z-[120]"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            onContextMenu={(e) => { e.preventDefault(); onClose(); }}
          />
          <motion.div
            key="qa-menu"
            ref={menuRef}
            className="fixed z-[121] rounded-2xl overflow-hidden"
            style={{
              left: pos.left,
              top: pos.top,
              width: 240,
              background: "rgba(20,20,30,0.96)",
              backdropFilter: "blur(28px) saturate(200%)",
              WebkitBackdropFilter: "blur(28px) saturate(200%)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 24px 48px rgba(0,0,0,0.55)",
            }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.6 }}
          >
            {preview && (
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                {preview}
              </div>
            )}
            <div className="py-1">
              {items.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    item.onSelect();
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-white/10"
                  style={{
                    color: item.destructive ? "#ef4444" : "var(--text-1)",
                    borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.05)" : undefined,
                  }}
                >
                  {item.icon && (
                    <item.icon
                      className="w-4 h-4 flex-shrink-0"
                      style={{ color: item.destructive ? "#ef4444" : "var(--text-2)" }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.label}</div>
                    {item.hint && (
                      <div className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
                        {item.hint}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
