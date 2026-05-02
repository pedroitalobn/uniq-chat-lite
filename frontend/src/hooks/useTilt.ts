"use client";

import { useRef, useCallback } from "react";

// useTilt — retorna handlers que aplicam 3D perspective tilt via CSS transform.
// Max tilt: maxDeg graus em X e Y. Smooth spring no mouse leave via transition.
export function useTilt(maxDeg = 7) {
  const ref = useRef<HTMLElement | null>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width  - 0.5; // -0.5 → 0.5
    const y = (e.clientY - rect.top)  / rect.height - 0.5;
    const rotY =  x * maxDeg * 2;
    const rotX = -y * maxDeg * 2;
    el.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(4px)`;
    el.style.transition = "transform 0.1s ease-out";
  }, [maxDeg]);

  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg) translateZ(0px)";
    el.style.transition = "transform 0.5s cubic-bezier(0.16,1,0.3,1)";
  }, []);

  return { ref, onMouseMove, onMouseLeave };
}
