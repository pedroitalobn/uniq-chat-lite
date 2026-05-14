"use client";

import { useEffect, useRef } from "react";

// Orbs reativos ao cursor — cada orb se move em direção ao cursor com
// intensidade diferente (parallax). Usa RAF para throttle e CSS transform
// para evitar repaints de layout.
//
// Orbs: 3 fixos (verde, roxo, azul) que correspondem ao gradient mesh
// do html. São separados do CSS pra poder animar via JS.
const ORBS = [
  // { color, opacity, size, baseX%, baseY%, intensity (0-1) }
  { color: "37,99,235",  opacity: 0.12, size: 600, x: 15, y: 8,   intensity: 0.025 },
  { color: "99,102,241", opacity: 0.09, size: 500, x: 85, y: 5,   intensity: -0.018 },
  { color: "139,92,246", opacity: 0.07, size: 450, x: 5,  y: 55,  intensity: 0.02  },
  { color: "59,130,246", opacity: 0.06, size: 480, x: 92, y: 50,  intensity: -0.015 },
];

export function CursorReactiveBackground() {
  const orbRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef  = useRef<number | null>(null);
  const target  = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Normaliza -0.5 → 0.5 relativo ao centro da viewport
      target.current = {
        x: e.clientX / window.innerWidth  - 0.5,
        y: e.clientY / window.innerHeight - 0.5,
      };
    };

    const tick = () => {
      // Lerp suave (ease) em direção ao cursor
      current.current.x += (target.current.x - current.current.x) * 0.06;
      current.current.y += (target.current.y - current.current.y) * 0.06;

      orbRefs.current.forEach((el, i) => {
        if (!el) return;
        const orb = ORBS[i];
        const dx = current.current.x * orb.intensity * window.innerWidth;
        const dy = current.current.y * orb.intensity * window.innerHeight;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: -1 }}
    >
      {ORBS.map((orb, i) => (
        <div
          key={i}
          ref={(el) => { orbRefs.current[i] = el; }}
          className="absolute rounded-full"
          style={{
            width:  orb.size,
            height: orb.size,
            left:   `calc(${orb.x}% - ${orb.size / 2}px)`,
            top:    `calc(${orb.y}% - ${orb.size / 2}px)`,
            background: `radial-gradient(circle, rgba(${orb.color},${orb.opacity}) 0%, transparent 70%)`,
            filter: "blur(40px)",
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
