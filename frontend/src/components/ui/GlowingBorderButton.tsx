"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

interface GlowingBorderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  glowColor?: string;
  className?: string;
}

export function GlowingBorderButton({
  children,
  glowColor = "#00d46a",
  className = "",
  style,
  ...props
}: GlowingBorderButtonProps) {
  return (
    <button
      {...props}
      className={`relative overflow-hidden text-sm font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-50 group ${className}`}
      style={{
        background: "transparent",
        borderRadius: "12px",
        padding: "1px",
        ...style,
      }}
    >
      {/* Animated border */}
      <span
        className="absolute inset-0 rounded-[12px] opacity-70 group-hover:opacity-100 transition-opacity"
        style={{
          background: `conic-gradient(from var(--angle), ${glowColor}, transparent 40%, ${glowColor} 70%, transparent)`,
          animation: "spin-border 3s linear infinite",
        }}
      />
      <style>{`
        @property --angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes spin-border {
          to { --angle: 360deg; }
        }
      `}</style>
      <span
        className="relative flex items-center justify-center gap-2 w-full h-full rounded-[11px] z-10"
        style={{ background: "hsl(240 18% 6%)", color: glowColor, padding: "10px 20px" }}
      >
        {children}
      </span>
    </button>
  );
}
