"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "soft" | "outline";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

// Button is the single primitive every page should use. Centraliza o
// arredondamento (rounded-lg), altura consistente, estado ativo/desabilitado
// e o accent verde Uniq (var(--green)). Evita a mistura de bg-blue-600 /
// bg-white que apareceu em algumas páginas do inbox/crm.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading,
    iconLeft,
    iconRight,
    fullWidth,
    className = "",
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const sizeStyles: Record<Size, string> = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-9 px-3 text-sm",
    lg: "h-11 px-5 text-sm",
  };

  const radius = size === "sm" ? "rounded-md" : "rounded-lg";

  const variantStyle: Record<Variant, React.CSSProperties> = {
    primary: {
      background: "var(--green, #00d46a)",
      color: "#03170a",
      border: "1px solid rgba(0,212,106,0.5)",
      boxShadow: "0 1px 0 rgba(0,0,0,0.12)",
      fontWeight: 600,
    },
    ghost: {
      background: "transparent",
      color: "hsl(240 15% 85%)",
      border: "1px solid transparent",
    },
    soft: {
      background: "rgba(255,255,255,0.04)",
      color: "hsl(240 15% 88%)",
      border: "1px solid hsl(240 12% 16%)",
    },
    outline: {
      background: "transparent",
      color: "hsl(240 15% 85%)",
      border: "1px solid hsl(240 12% 22%)",
    },
    danger: {
      background: "rgba(239,68,68,0.14)",
      color: "#fca5a5",
      border: "1px solid rgba(239,68,68,0.35)",
    },
  };

  const hoverByVariant: Record<Variant, string> = {
    primary: "hover:brightness-110",
    ghost: "hover:bg-white/5",
    soft: "hover:bg-white/[0.07]",
    outline: "hover:bg-white/5",
    danger: "hover:bg-[rgba(239,68,68,0.22)]",
  };

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-1.5 font-medium",
        "transition-all duration-150 ease-out",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "whitespace-nowrap select-none",
        radius,
        sizeStyles[size],
        hoverByVariant[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      style={variantStyle[variant]}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : iconLeft}
      {children && <span>{children}</span>}
      {!loading && iconRight}
    </button>
  );
});
