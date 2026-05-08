"use client";

// PullToRefresh — gesto pull-down nativo de iOS/Android pra refresh de
// listas. Lightweight, sem deps externas. Detecta touch start no topo
// do scroll e mede o pull até liberar — quando passa do threshold,
// dispara onRefresh e mostra o spinner enquanto resolve.
//
// Funciona em qualquer container com overflow-auto/scroll, basta
// envolver o conteúdo. Em desktop (sem touch events) é no-op visual.

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { haptic } from "@/lib/haptics";

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  className,
}: {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  threshold?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      // Só inicia pull se o scroll está NO TOPO. Evita conflito com
      // scroll normal pra baixo.
      if (el.scrollTop > 2) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      triggered.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshing || startY.current === null) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      // Resistência crescente — quanto mais puxa, menos avança (sensação
      // de elasticidade tipo iOS).
      const resisted = Math.min(threshold * 1.5, Math.pow(delta, 0.85));
      setPull(resisted);
      if (resisted >= threshold && !triggered.current) {
        triggered.current = true;
        haptic.tap(); // feedback ao atingir threshold
      }
      if (delta > 10) {
        // previne scroll-bounce nativo enquanto puxa
        e.preventDefault();
      }
    };

    const onTouchEnd = async () => {
      const reached = pull >= threshold;
      startY.current = null;
      if (reached) {
        setRefreshing(true);
        setPull(threshold);
        haptic.success();
        try {
          await Promise.resolve(onRefresh());
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing, pull, threshold, onRefresh]);

  const progress = Math.min(1, pull / threshold);
  const indicatorOpacity = Math.min(1, pull / 30);
  const rotate = progress * 180;

  return (
    <div ref={ref} className={className} style={{ position: "relative", overflow: "auto", height: "100%" }}>
      {/* Indicador no topo — fica acima do conteúdo via translate negativo */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: `translate(-50%, ${pull - 36}px)`,
          opacity: indicatorOpacity,
          transition: refreshing ? "transform 0.2s ease-out" : pull === 0 ? "transform 0.25s cubic-bezier(0.16,1,0.3,1), opacity 0.2s" : "none",
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 36,
            height: 36,
            background: "rgba(10,10,20,0.85)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(0,212,106,0.30)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          }}
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--green)" }} />
          ) : (
            <ArrowDown
              className="w-4 h-4 transition-transform"
              style={{
                color: progress >= 1 ? "var(--green)" : "var(--text-3)",
                transform: `rotate(${rotate}deg)`,
              }}
            />
          )}
        </div>
      </div>

      {/* Conteúdo desloca pra baixo enquanto puxa */}
      <div
        style={{
          transform: `translateY(${pull}px)`,
          transition: refreshing ? "transform 0.2s ease-out" : pull === 0 ? "transform 0.25s cubic-bezier(0.16,1,0.3,1)" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
