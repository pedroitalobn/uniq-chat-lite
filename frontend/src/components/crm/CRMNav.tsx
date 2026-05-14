"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Contact, Briefcase, Building2, Filter, Upload, GitMerge,
  ListTodo, CalendarClock, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  match: (p: string) => boolean;
};

const MAIN_ITEMS: NavItem[] = [
  { href: "/crm/deals",     label: "Deals",     description: "Pipeline de vendas",  icon: Briefcase,     match: (p) => p === "/crm" || p.startsWith("/crm/deals") },
  { href: "/crm/contacts",  label: "Contatos",  description: "Pessoas e leads",     icon: Contact,       match: (p) => p.startsWith("/crm/contacts") },
  { href: "/crm/companies", label: "Empresas",  description: "Organizações",        icon: Building2,     match: (p) => p.startsWith("/crm/companies") },
  { href: "/crm/properties", label: "Propriedades", description: "Funis, tags e campos", icon: SlidersHorizontal, match: (p) => p.startsWith("/crm/properties") || p.startsWith("/crm/funnels") },
  { href: "/crm/tasks",     label: "Tarefas",   description: "Follow-ups",          icon: ListTodo,      match: (p) => p.startsWith("/crm/tasks") },
  { href: "/crm/meetings",  label: "Reuniões",  description: "Agendamentos",        icon: CalendarClock, match: (p) => p.startsWith("/crm/meetings") },
  { href: "/crm/segments",  label: "Segmentos", description: "Grupos e filtros",    icon: Filter,        match: (p) => p.startsWith("/crm/segments") },
];

const TOOL_ITEMS: NavItem[] = [
  { href: "/crm/import",     label: "Importar",   description: "CSV e planilhas",   icon: Upload,   match: (p) => p.startsWith("/crm/import") },
  { href: "/crm/duplicates", label: "Duplicatas", description: "Mesclar registros", icon: GitMerge, match: (p) => p.startsWith("/crm/duplicates") },
];

const glassPanel: React.CSSProperties = {
  background: "linear-gradient(135deg, var(--border-subtle) 0%, rgba(255,255,255,0.02) 100%)",
  backdropFilter: "blur(16px) saturate(180%)",
  WebkitBackdropFilter: "blur(16px) saturate(180%)",
  border: "1px solid var(--border-default)",
};

export function CRMNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: barra horizontal scroll com glassmorphism */}
      <nav
        className="md:hidden flex gap-1 overflow-x-auto p-1.5 rounded-2xl scrollbar-none"
        style={glassPanel}
      >
        {[...MAIN_ITEMS, ...TOOL_ITEMS].map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 flex-shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition-all",
              )}
              style={{
                background: active
                  ? "linear-gradient(135deg, rgba(37, 99, 235,0.18), rgba(37, 99, 235,0.06))"
                  : "transparent",
                border: active ? "1px solid rgba(37, 99, 235,0.25)" : "1px solid transparent",
                color: active ? "var(--green)" : "var(--text-2)",
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop: sidebar com glassmorphism + descrições */}
      <aside className="hidden md:block w-48 lg:w-56 flex-shrink-0 sticky top-0 self-start">
        <nav className="rounded-2xl overflow-hidden p-1.5 space-y-0.5" style={glassPanel}>
          {MAIN_ITEMS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative"
                style={{
                  background: active
                    ? "linear-gradient(135deg, rgba(37, 99, 235,0.16), rgba(37, 99, 235,0.04))"
                    : "transparent",
                  border: active ? "1px solid rgba(37, 99, 235,0.22)" : "1px solid transparent",
                }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: active ? "rgba(37, 99, 235,0.18)" : "var(--input)",
                    border: `1px solid ${active ? "rgba(37, 99, 235,0.25)" : "var(--border-subtle)"}`,
                  }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>
                    {item.label}
                  </p>
                  <p className="text-[10px] truncate hidden lg:block" style={{ color: "var(--text-3)" }}>
                    {item.description}
                  </p>
                </div>
              </Link>
            );
          })}

          <div
            className="px-3 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--text-3)" }}
          >
            Ferramentas
          </div>

          {TOOL_ITEMS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
                style={{
                  background: active
                    ? "linear-gradient(135deg, rgba(37, 99, 235,0.16), rgba(37, 99, 235,0.04))"
                    : "transparent",
                  border: active ? "1px solid rgba(37, 99, 235,0.22)" : "1px solid transparent",
                }}
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{
                    background: active ? "rgba(37, 99, 235,0.18)" : "var(--input)",
                    border: `1px solid ${active ? "rgba(37, 99, 235,0.25)" : "var(--border-subtle)"}`,
                  }}
                >
                  <Icon className="w-3 h-3" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                </div>
                <p className="text-xs truncate" style={{ color: active ? "var(--green)" : "var(--text-2)" }}>
                  {item.label}
                </p>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
