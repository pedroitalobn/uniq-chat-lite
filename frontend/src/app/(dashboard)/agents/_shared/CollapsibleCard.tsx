"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Card colapsável usado como bloco padrão do Studio. Padrão: aberto.
// O ícone gira 180º quando fecha. Props simples (title + icon + meta)
// pra evitar componentes intermediários com slots.
export function CollapsibleCard({
  title,
  icon: Icon,
  meta,
  defaultOpen = true,
  children,
  accentColor,
}: {
  title: string;
  icon: typeof ChevronDown;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  // Cor de destaque do ícone — opcional
  accentColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = accentColor || "var(--text-2)";

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--surface-border)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]"
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: `${color}1a`,
            border: `1px solid ${color}33`,
            color,
          }}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
        <h3 className="text-sm font-semibold text-left flex-shrink-0" style={{ color: "var(--text-1)" }}>
          {title}
        </h3>
        {/* Meta wrappa quando tem muitos chips (KnowledgeCard tem 3+
           chips em mobile). flex-1 permite ocupar espaço; justify-end
           empurra os chips pra direita. */}
        {meta && (
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end min-w-0">
            {meta}
          </div>
        )}
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ${meta ? "" : "ml-auto"}`}
          style={{
            color: "var(--text-3)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid var(--surface-border)" }}>
          {children}
        </div>
      )}
    </section>
  );
}
