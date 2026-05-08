"use client";

// BottomSheet — modal estilo iOS/Android pra mobile. Slide up do fundo,
// drag handle, backdrop com blur, suporta swipe-down pra fechar.
// Usar como wrapper genérico em qualquer modal que faça sentido virar
// sheet em mobile (em desktop pode cair pro modal centralizado normal,
// mas aqui é sempre sheet — caller decide quando renderizar).
//
// Pattern de uso:
//   <BottomSheet open={x} onClose={() => setX(false)} title="Filtros">
//     <Conteúdo />
//   </BottomSheet>

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { haptic } from "@/lib/haptics";

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = "85vh",
  showHandle = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Altura máxima do sheet — default 85vh */
  maxHeight?: string | number;
  /** Drag handle no topo (visual + funcional pra fechar). Default true. */
  showHandle?: boolean;
}) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Bloqueia scroll do body enquanto sheet está aberto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) setDragY(delta);
  };
  const onTouchEnd = () => {
    if (dragY > 100) {
      haptic.tap();
      onClose();
    }
    startY.current = null;
    setDragY(0);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="bs-backdrop"
            className="fixed inset-0 z-[90]"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            key="bs-panel"
            className="fixed bottom-0 left-0 right-0 z-[91] rounded-t-3xl flex flex-col"
            style={{
              background: "rgba(10,10,20,0.94)",
              backdropFilter: "blur(28px) saturate(200%)",
              WebkitBackdropFilter: "blur(28px) saturate(200%)",
              borderTop: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 -16px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
              maxHeight,
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              transform: `translateY(${dragY}px)`,
              transition: dragY === 0 ? "transform 0.22s cubic-bezier(0.16,1,0.3,1)" : "none",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            {showHandle && (
              <div
                className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
              >
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.18)" }} />
              </div>
            )}
            {title && (
              <div
                className="flex items-center justify-between px-5 pb-3 pt-1"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>{title}</p>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-2)" }}
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
