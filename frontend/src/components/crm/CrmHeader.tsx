"use client";

// CrmHeader — barra de AÇÕES + TOOLBAR no topo das páginas do CRM. Antes
// renderizava título + subtítulo + ícone (h1 grande), o que duplicava
// o título já mostrado pelo ModuleHeader do layout. Agora o título
// único vive no ModuleHeader; este componente fica responsável só pela
// linha de ações (botões "Novo deal", filtros, etc) e a toolbar abaixo.
// Props title/subtitle/icon mantidas pra compat com call-sites mas
// renderizadas como linha discreta opcional.

import type { ReactNode } from "react";

export function CrmHeader({
  subtitle,
  actions,
  toolbar,
  children,
}: {
  /** @deprecated mantido pra compat — ignorado no render. ModuleHeader provê o título. */
  title?: ReactNode;
  /** Linha discreta opcional acima das ações (ex: "Funil: Vendas SP"). */
  subtitle?: ReactNode;
  /** @deprecated mantido pra compat — ignorado. */
  icon?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
}) {
  // Sem actions, toolbar nem subtitle, não renderiza nada — alguns
  // pages chamam só pra título e agora o ModuleHeader cobre.
  if (!actions && !toolbar && !subtitle && !children) return null;

  return (
    <header
      className="rounded-2xl px-4 sm:px-5 py-3 space-y-3"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {(subtitle || actions) && (
        <div className="flex items-center gap-3 flex-wrap">
          {subtitle && (
            <p className="text-xs truncate min-w-0 flex-1" style={{ color: "var(--text-3)" }}>
              {subtitle}
            </p>
          )}
          {actions && <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>}
        </div>
      )}
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
        background: "var(--input)",
        border: "1px solid rgba(255,255,255,0.09)",
      }}
    >
      {children}
    </div>
  );
}
