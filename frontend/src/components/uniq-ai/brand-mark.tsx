"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type UniqAIBrandMarkProps = {
  className?: string;
  style?: CSSProperties;
  stroke?: string;
  glow?: boolean;
};

export function UniqAIBrandMark({
  className,
  style,
  stroke = "currentColor",
  glow = false,
}: UniqAIBrandMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      style={style}
    >
      <g
        stroke={stroke}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={glow ? { filter: `drop-shadow(0 0 10px ${stroke})` } : undefined}
      >
        <path d="M16 40C16 28.954 24.954 20 36 20H48" opacity="0.94" />
        <path d="M16 24C27.046 24 36 32.954 36 44V48" opacity="0.86" />
        <path d="M48 24C36.954 24 28 32.954 28 44V48" opacity="0.72" />
      </g>
    </svg>
  );
}
