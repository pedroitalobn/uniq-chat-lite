"use client";

// ModuleHeader — header padronizado pra cada módulo principal (CRM,
// Campanhas, Jornadas, Agentes, Help Desk, Shops, etc). É o ÚNICO título
// da página — antes coexistia com CrmHeader/headers locais que criavam
// duplicidade visual. Tipografia maior (text-lg sm:text-xl) pra ser
// percebido como o título principal sem competir com seções internas.

import type { LucideIcon } from "lucide-react";

export function ModuleHeader({
  icon: Icon,
  title,
  subtitle,
  color = "var(--green)",
  bg = "rgba(37, 99, 235,0.12)",
  border = "rgba(37, 99, 235,0.25)",
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 sm:px-4 pt-3 sm:pt-4 flex-wrap">
      <span
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: bg, border: `1px solid ${border}` }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </span>
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight leading-none" style={{ color: "var(--text-1)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-[11px] sm:text-xs mt-1 truncate" style={{ color: "var(--text-3)" }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
