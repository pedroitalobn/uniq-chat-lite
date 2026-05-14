"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type QChatAIBrandMarkProps = {
  className?: string;
  style?: CSSProperties;
  stroke?: string;
  glow?: boolean;
};

export function QChatAIBrandMark({
  className,
  style,
  stroke = "currentColor",
  glow = false,
}: QChatAIBrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      shapeRendering="geometricPrecision"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      style={style}
    >
      <g
        stroke={stroke}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={glow ? { filter: `drop-shadow(0 0 10px ${stroke})` } : undefined}
      >
        {/* Opacidade unificada em 1 — em telas pequenas as variações 0.94/
            0.86/0.72 sumiam contra o verde do botão dock e davam impressão
            de "marca quebrada". strokeWidth subido pra 6 mantém os traços
            sólidos mesmo a 24px de render no MobileDock. */}
        <path d="M16 40C16 28.954 24.954 20 36 20H48" />
        <path d="M16 24C27.046 24 36 32.954 36 44V48" />
        <path d="M48 24C36.954 24 28 32.954 28 44V48" />
      </g>
    </svg>
  );
}
