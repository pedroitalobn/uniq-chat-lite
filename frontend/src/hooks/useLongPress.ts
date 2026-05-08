"use client";

// useLongPress — hook que dispara callback ao segurar um elemento por
// N ms (default 500ms). Padrão iOS de "preview / quick actions".
// Cancela se o user mover muito o dedo (>10px) ou tirar antes do tempo.
// Em desktop também funciona com mouse (hold left button).
//
// Retorna props pra spread no elemento alvo:
//   <div {...useLongPress(() => openMenu(), 500)}>...</div>

import { useCallback, useRef } from "react";
import { haptic } from "@/lib/haptics";

export function useLongPress(
  onLongPress: () => void,
  ms = 500,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const triggered = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    startPos.current = null;
  }, []);

  const start = useCallback((x: number, y: number) => {
    triggered.current = false;
    startPos.current = { x, y };
    timer.current = setTimeout(() => {
      triggered.current = true;
      haptic.warning(); // pulso forte indica "menu disponível"
      onLongPress();
    }, ms);
  }, [onLongPress, ms]);

  const move = useCallback((x: number, y: number) => {
    if (!startPos.current) return;
    const dx = Math.abs(x - startPos.current.x);
    const dy = Math.abs(y - startPos.current.y);
    if (dx > 10 || dy > 10) cancel();
  }, [cancel]);

  return {
    onTouchStart: (e: React.TouchEvent) => start(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onMouseDown: (e: React.MouseEvent) => start(e.clientX, e.clientY),
    onMouseMove: (e: React.MouseEvent) => move(e.clientX, e.clientY),
    onMouseUp: cancel,
    onMouseLeave: cancel,
    /** Verifica se um onClick subsequente é resultado de long-press (pra ignorar). */
    wasTriggered: () => triggered.current,
  };
}
