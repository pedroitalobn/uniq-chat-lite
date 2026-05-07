"use client";

// CrmHeader — header glass-morphism unificado pra todas as páginas do CRM.
// Estrutura padronizada: (linha 1) título + ações; (linha 2) toolbar.
// Mantém a estética consistente com o resto do app (gradient + backdrop-blur).

import type { ReactNode } from "react";

export function CrmHeader({
  title,
  subtitle,
  icon,
  actions,
  toolbar,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header
      className="rounded-2xl px-4 sm:px-5 py-3 sm:py-4 space-y-3"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        {icon && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(0,212,106,0.10)",
              border: "1px solid rgba(0,212,106,0.20)",
            }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate" style={{ color: "var(--text-1)" }}>
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-3)" }}>
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>}
      </div>
      {toolbar}
      {children}
    </header>
  );
}

// Botão glass pequeno — usado em ações secundárias do header.
export function CrmHeaderButton({
  children, onClick, active, accent, title: titleAttr, disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  accent?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const accentStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
    border: "1px solid rgba(0,212,106,0.30)",
    color: "var(--green)",
    boxShadow: "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
  };
  const activeStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "var(--text-1)",
  };
  const idleStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "var(--text-2)",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titleAttr}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
      style={accent ? accentStyle : active ? activeStyle : idleStyle}
    >
      {children}
    </button>
  );
}

// Toggle group glass — wrapper pra um conjunto de ViewToggles.
export function CrmHeaderToggleGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-xl p-0.5"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.09)",
      }}
    >
      {children}
    </div>
  );
}
