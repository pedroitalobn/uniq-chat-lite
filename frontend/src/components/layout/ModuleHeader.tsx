"use client";

// ModuleHeader — header padronizado pra cada módulo principal (CRM,
// Campanhas, Jornadas, Agentes, Help Desk, Shops, etc). Visualmente
// alinhado: ícone colorido em badge + título + subtítulo curto.
// Mover pra um componente único pra ficar fácil bater consistência
// em todas as páginas e ajustar o estilo num lugar só.

import type { LucideIcon } from "lucide-react";

export function ModuleHeader({
  icon: Icon,
  title,
  subtitle,
  color = "var(--green)",
  bg = "rgba(0,212,106,0.12)",
  border = "rgba(0,212,106,0.25)",
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 pt-2">
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ background: bg, border: `1px solid ${border}` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color }} />
      </span>
      <h1 className="text-base font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
        {title}
      </h1>
      {subtitle && (
        <span className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
          {subtitle}
        </span>
      )}
    </div>
  );
}
