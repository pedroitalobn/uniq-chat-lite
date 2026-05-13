import { useId } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  height?: number;
}

const GREEN = "#00d46a";

// Rounded-rect loop centered at origin, W=12, H=13.5, R=4.5
// Each loop is a "frame" — same shape, rotated 120° for each copy
const LOOP =
  "M -1.5 -6.75 L 1.5 -6.75 A 4.5 4.5 0 0 1 6 -2.25 L 6 2.25 A 4.5 4.5 0 0 1 1.5 6.75 L -1.5 6.75 A 4.5 4.5 0 0 1 -6 2.25 L -6 -2.25 A 4.5 4.5 0 0 1 -1.5 -6.75 Z";

// Loop centers — orbit radius 5.5 from symbol center (18,18)
// A = top (270°), B = bottom-right (30°), C = bottom-left (150°)
const A = { cx: 18, cy: 12.5, r: 0 };
const B = { cx: 22.76, cy: 20.75, r: 120 };
const C = { cx: 13.24, cy: 20.75, r: 240 };

const t = (p: typeof A) => `translate(${p.cx} ${p.cy}) rotate(${p.r})`;

export function Logo({ className, height = 32 }: LogoProps) {
  const fontSize = Math.round(height * 0.52);
  // IDs únicos por instância. SVG mask IDs são globais no documento — quando
  // o Logo aparece em mais de um lugar (header + mobile dock + página de
  // auth simultaneamente em mobile) os masks "uc-ma/uc-mb/uc-mc" colidiam,
  // o navegador resolvia pra primeira instância e os outros logos
  // renderizavam com interlock errado, parecendo "quebrados".
  const uid = useId().replace(/:/g, "");
  const idA = `uc-ma-${uid}`;
  const idB = `uc-mb-${uid}`;
  const idC = `uc-mc-${uid}`;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* ── Symbol ── */}
      <svg
        viewBox="0 0 36 36"
        height={height}
        width={height}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 dark:[filter:drop-shadow(0_0_8px_rgba(0,212,106,0.5))]"
        aria-hidden="true"
      >
        <defs>
          <mask id={idA}>
            <rect width="36" height="36" fill="white" />
            <path d={LOOP} transform={t(B)} fill="none"
              stroke="black" strokeWidth="3.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </mask>
          <mask id={idC}>
            <rect width="36" height="36" fill="white" />
            <path d={LOOP} transform={t(A)} fill="none"
              stroke="black" strokeWidth="3.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </mask>
          <mask id={idB}>
            <rect width="36" height="36" fill="white" />
            <path d={LOOP} transform={t(C)} fill="none"
              stroke="black" strokeWidth="3.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </mask>
        </defs>

        <path d={LOOP} transform={t(A)} mask={`url(#${idA})`}
          stroke={GREEN} strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d={LOOP} transform={t(C)} mask={`url(#${idC})`}
          stroke={GREEN} strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d={LOOP} transform={t(B)} mask={`url(#${idB})`}
          stroke={GREEN} strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* ── Wordmark ── */}
      <span
        className="font-semibold leading-none tracking-tight text-[#1a3d2b] dark:text-white"
        style={{ fontSize }}
      >
        uniq
        <span className="font-normal" style={{ color: GREEN }}>
          .chat
        </span>
      </span>
    </span>
  );
}
