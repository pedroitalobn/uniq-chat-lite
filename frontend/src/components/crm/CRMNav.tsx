"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Contact, Briefcase, Building2, Filter, Upload, GitMerge,
  ListTodo, CalendarClock, GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  match: (p: string) => boolean;
};

const MAIN_ITEMS: NavItem[] = [
  { href: "/crm/deals",     label: "Deals",     icon: Briefcase,     match: (p) => p === "/crm" || p.startsWith("/crm/deals") },
  { href: "/crm/contacts",  label: "Contatos",  icon: Contact,       match: (p) => p.startsWith("/crm/contacts") },
  { href: "/crm/companies", label: "Empresas",  icon: Building2,     match: (p) => p.startsWith("/crm/companies") },
  { href: "/crm/funnels",   label: "Funis",     icon: GitBranch,     match: (p) => p.startsWith("/crm/funnels") },
  { href: "/crm/tasks",     label: "Tarefas",   icon: ListTodo,      match: (p) => p.startsWith("/crm/tasks") },
  { href: "/crm/meetings",  label: "Reuniões",  icon: CalendarClock, match: (p) => p.startsWith("/crm/meetings") },
  { href: "/crm/segments",  label: "Segmentos", icon: Filter,        match: (p) => p.startsWith("/crm/segments") },
];

const TOOL_ITEMS: NavItem[] = [
  { href: "/crm/import",     label: "Importar",   icon: Upload,   match: (p) => p.startsWith("/crm/import") },
  { href: "/crm/duplicates", label: "Duplicatas", icon: GitMerge, match: (p) => p.startsWith("/crm/duplicates") },
];

export function CRMNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: barra horizontal com scroll */}
      <nav
        className="md:hidden flex gap-1 overflow-x-auto px-1 py-1 rounded-xl scrollbar-none"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
      >
        {[...MAIN_ITEMS, ...TOOL_ITEMS].map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              )}
              style={{
                background: active ? "var(--green-dim)" : "transparent",
                color: active ? "var(--green)" : "var(--text-2)",
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop: sidebar */}
      <aside className="hidden md:block w-44 lg:w-52 flex-shrink-0 sticky top-0 self-start">
        <nav
          className="rounded-2xl overflow-hidden w-full"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
        >
          {MAIN_ITEMS.map((item, i) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 lg:px-4 py-2.5 text-left transition-colors relative",
                  i < MAIN_ITEMS.length - 1 ? "border-b" : ""
                )}
                style={{
                  borderColor: "var(--surface-border)",
                  background: active ? "var(--green-dim)" : "transparent",
                }}
              >
                {active && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                    style={{ background: "var(--green)" }}
                  />
                )}
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                <span className="text-xs font-medium truncate" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>
                  {item.label}
                </span>
              </Link>
            );
          })}

          <div
            className="px-3 lg:px-4 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-widest border-t"
            style={{ color: "var(--text-3)", borderColor: "var(--surface-border)" }}
          >
            Ferramentas
          </div>

          {TOOL_ITEMS.map((item, i) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 lg:px-4 py-2 text-left transition-colors relative",
                  i < TOOL_ITEMS.length - 1 ? "border-b" : ""
                )}
                style={{
                  borderColor: "var(--surface-border)",
                  background: active ? "var(--green-dim)" : "transparent",
                }}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                <span className="text-xs truncate" style={{ color: active ? "var(--green)" : "var(--text-2)" }}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
