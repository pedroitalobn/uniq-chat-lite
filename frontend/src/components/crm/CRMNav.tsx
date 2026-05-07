"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, Briefcase, Building2, Filter, Upload, GitMerge, ChevronRight, ListTodo, CalendarClock, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

const MAIN_ITEMS = [
  {
    href: "/crm/deals",
    label: "Deals",
    description: "Pipeline de vendas",
    icon: Briefcase,
    match: (p: string) => p === "/crm" || p.startsWith("/crm/deals"),
  },
  {
    href: "/crm/contacts",
    label: "Contatos",
    description: "Pessoas e leads",
    icon: Contact,
    match: (p: string) => p.startsWith("/crm/contacts"),
  },
  {
    href: "/crm/companies",
    label: "Empresas",
    description: "Organizações",
    icon: Building2,
    match: (p: string) => p.startsWith("/crm/companies"),
  },
  {
    href: "/crm/funnels",
    label: "Funis",
    description: "Pipelines + etapas",
    icon: GitBranch,
    match: (p: string) => p.startsWith("/crm/funnels"),
  },
  {
    href: "/crm/tasks",
    label: "Tarefas",
    description: "Follow-ups e ações",
    icon: ListTodo,
    match: (p: string) => p.startsWith("/crm/tasks"),
  },
  {
    href: "/crm/meetings",
    label: "Reuniões",
    description: "Agendamentos",
    icon: CalendarClock,
    match: (p: string) => p.startsWith("/crm/meetings"),
  },
  {
    href: "/crm/segments",
    label: "Segmentos",
    description: "Grupos e filtros",
    icon: Filter,
    match: (p: string) => p.startsWith("/crm/segments"),
  },
];

const TOOL_ITEMS = [
  {
    href: "/crm/import",
    label: "Importar",
    description: "CSV e planilhas",
    icon: Upload,
    match: (p: string) => p.startsWith("/crm/import"),
  },
  {
    href: "/crm/duplicates",
    label: "Duplicatas",
    description: "Mesclar registros",
    icon: GitMerge,
    match: (p: string) => p.startsWith("/crm/duplicates"),
  },
];

export function CRMNav() {
  const pathname = usePathname();

  return (
    <aside className="w-44 lg:w-52 flex-shrink-0 sticky top-0 self-start">
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
                "w-full flex items-center gap-3 px-3 lg:px-4 py-3 lg:py-3.5 text-left transition-all duration-150 relative",
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
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: active ? "rgba(0,212,106,0.15)" : "var(--surface-3)",
                  border: `1px solid ${active ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>
                  {item.label}
                </p>
                <p className="text-[10px] truncate mt-0.5 hidden lg:block" style={{ color: "var(--text-3)" }}>
                  {item.description}
                </p>
              </div>
              <ChevronRight
                className="w-3 h-3 flex-shrink-0 transition-transform"
                style={{ color: active ? "var(--green)" : "var(--text-3)", transform: active ? "translateX(1px)" : "none" }}
              />
            </Link>
          );
        })}

        {/* Divider + Ferramentas label */}
        <div
          className="px-3 lg:px-4 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest border-t"
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
                "w-full flex items-center gap-3 px-3 lg:px-4 py-2.5 text-left transition-all duration-150 relative",
                i < TOOL_ITEMS.length - 1 ? "border-b" : ""
              )}
              style={{
                borderColor: "var(--surface-border)",
                background: active ? "var(--green-dim)" : "transparent",
              }}
            >
              {active && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r"
                  style={{ background: "var(--green)" }}
                />
              )}
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{
                  background: active ? "rgba(0,212,106,0.15)" : "var(--surface-3)",
                  border: `1px solid ${active ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                }}
              >
                <Icon className="w-3 h-3" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
              </div>
              <p className="text-xs truncate flex-1" style={{ color: active ? "var(--green)" : "var(--text-2)" }}>
                {item.label}
              </p>
              <ChevronRight
                className="w-3 h-3 flex-shrink-0"
                style={{ color: active ? "var(--green)" : "var(--text-3)", transform: active ? "translateX(1px)" : "none" }}
              />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
