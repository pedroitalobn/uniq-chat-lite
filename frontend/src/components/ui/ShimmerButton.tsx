"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  shimmerColor?: string;
  background?: string;
  borderRadius?: string;
  className?: string;
}

export function ShimmerButton({
  children,
  shimmerColor = "rgba(255,255,255,0.25)",
  background = "#2563EB",
  borderRadius = "12px",
  className = "",
  style,
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      {...props}
      className={`relative overflow-hidden text-sm font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-50 ${className}`}
      style={{
        background,
        borderRadius,
        color: "#050508",
        ...style,
      }}
    >
      {/* Shimmer layer */}
      <span
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(105deg, transparent 35%, ${shimmerColor} 50%, transparent 65%)`,
          backgroundSize: "250% 100%",
          animation: "shimmer 2.2s infinite linear",
        }}
      />
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
      `}</style>
      <span className="relative z-10 flex items-center justify-center gap-2">
        {children}
      </span>
    </button>
  );
}
