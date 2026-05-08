"use client";

// SwipeRow — wrapper que adiciona swipe-to-action ao estilo iOS Mail /
// Telegram. Swipe esquerda revela actions à direita; swipe direita revela
// actions à esquerda. Cada action é uma função + label + cor + icon.
//
// Comportamento:
//   - Drag até threshold pequeno (40px): cancela e snap volta
//   - Drag até threshold grande (140px): triggera o ÚLTIMO action do lado
//     automaticamente (igual iOS Mail "swipe to delete")
//   - Drag intermediário: trava no estado revelado, user toca a action pra
//     executar
//   - Tap fora ou em outra row: fecha
//
// Em desktop os touch events não disparam — comporta-se como div normal.

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { haptic } from "@/lib/haptics";

export type SwipeAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  color: string;       // background da action revelada
  textColor?: string;  // default: white
  onAction: () => void;
};

export function SwipeRow({
  children,
  leftActions = [],
  rightActions = [],
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  /** Actions reveladas com swipe pra direita (aparecem à esquerda do row). */
  leftActions?: SwipeAction[];
  /** Actions reveladas com swipe pra esquerda (aparecem à direita do row). */
  rightActions?: SwipeAction[];
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const [snapped, setSnapped] = useState<"left" | "right" | null>(null);
  const triggered = useRef(false);

  const ACTION_W = 72; // px por action
  const FULL_SWIPE_THRESHOLD = 140;
  const MIN_REVEAL = 40;

  const leftRevealW = leftActions.length * ACTION_W;
  const rightRevealW = rightActions.length * ACTION_W;

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!snapped) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setSnapped(null);
        setDrag(0);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [snapped]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    triggered.current = false;
    if (snapped) {
      setSnapped(null);
      setDrag(0);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (disabled || startX.current === null || startY.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - (startY.current ?? 0);
    // Se o gesto é mais vertical que horizontal, deixa scroll passar.
    if (Math.abs(dy) > Math.abs(dx) + 6) {
      startX.current = null;
      return;
    }
    // Limita ao lado que tem actions.
    let val = dx;
    if (val > 0 && leftActions.length === 0) val = 0;
    if (val < 0 && rightActions.length === 0) val = 0;
    // Resistência depois do reveal completo.
    const maxLeft = leftRevealW + 40;
    const maxRight = -(rightRevealW + 40);
    if (val > maxLeft) val = maxLeft + (val - maxLeft) * 0.3;
    if (val < maxRight) val = maxRight + (val - maxRight) * 0.3;
    setDrag(val);
    // Haptic ao cruzar threshold de full-swipe.
    if (Math.abs(val) >= FULL_SWIPE_THRESHOLD && !triggered.current) {
      triggered.current = true;
      haptic.tap();
    }
  };

  const onTouchEnd = () => {
    if (disabled || startX.current === null) return;
    startX.current = null;
    const abs = Math.abs(drag);
    if (abs >= FULL_SWIPE_THRESHOLD) {
      // Full swipe — executa a última action do lado.
      const actions = drag > 0 ? leftActions : rightActions;
      const action = actions[actions.length - 1];
      if (action) {
        haptic.success();
        action.onAction();
      }
      setDrag(0);
      setSnapped(null);
    } else if (abs >= MIN_REVEAL) {
      // Snap pro estado revelado.
      const target = drag > 0 ? leftRevealW : -rightRevealW;
      setDrag(target);
      setSnapped(drag > 0 ? "left" : "right");
    } else {
      // Cancela — volta.
      setDrag(0);
      setSnapped(null);
    }
  };

  return (
    <div ref={ref} className={className} style={{ position: "relative", overflow: "hidden" }}>
      {/* Right actions revelados quando swipe pra esquerda */}
      {rightActions.length > 0 && (
        <div
          className="absolute top-0 right-0 bottom-0 flex"
          style={{ pointerEvents: snapped === "right" ? "auto" : "none" }}
        >
          {rightActions.map((a) => (
            <button
              key={a.id}
              onClick={() => { haptic.tap(); a.onAction(); setSnapped(null); setDrag(0); }}
              className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
              style={{ width: ACTION_W, background: a.color, color: a.textColor || "white" }}
            >
              {a.icon && <a.icon className="w-4 h-4" />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {/* Left actions revelados quando swipe pra direita */}
      {leftActions.length > 0 && (
        <div
          className="absolute top-0 left-0 bottom-0 flex"
          style={{ pointerEvents: snapped === "left" ? "auto" : "none" }}
        >
          {leftActions.map((a) => (
            <button
              key={a.id}
              onClick={() => { haptic.tap(); a.onAction(); setSnapped(null); setDrag(0); }}
              className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
              style={{ width: ACTION_W, background: a.color, color: a.textColor || "white" }}
            >
              {a.icon && <a.icon className="w-4 h-4" />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {/* Conteúdo arrasto-translado */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${drag}px)`,
          transition: startX.current === null
            ? "transform 0.22s cubic-bezier(0.16,1,0.3,1)"
            : "none",
          background: "var(--surface-1)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}
