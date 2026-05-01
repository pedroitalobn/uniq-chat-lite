"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, Briefcase, Building2, Filter, Upload, GitMerge } from "lucide-react";

const MAIN_ITEMS = [
  {
    href: "/crm/deals",
    label: "Deals",
    icon: Briefcase,
    match: (p: string) => p === "/crm" || p.startsWith("/crm/deals"),
  },
  {
    href: "/crm/contacts",
    label: "Contatos",
    icon: Contact,
    match: (p: string) => p.startsWith("/crm/contacts"),
  },
  {
    href: "/crm/companies",
    label: "Empresas",
    icon: Building2,
    match: (p: string) => p.startsWith("/crm/companies"),
  },
  {
    href: "/crm/segments",
    label: "Segmentos",
    icon: Filter,
    match: (p: string) => p.startsWith("/crm/segments"),
  },
];

const TOOL_ITEMS = [
  {
    href: "/crm/import",
    label: "Importar",
    icon: Upload,
    match: (p: string) => p.startsWith("/crm/import"),
  },
  {
    href: "/crm/duplicatas",
    label: "Duplicatas",
    icon: GitMerge,
    match: (p: string) => p.startsWith("/crm/duplicates"),
  },
];

export function CRMNav() {
  const pathname = usePathname();

  return (
    <aside
      className="flex-shrink-0 w-40 flex flex-col py-1"
      style={{ borderRight: "1px solid hsl(240 12% 13%)" }}
    >
      {/* Main navigation */}
      <nav className="flex flex-col gap-0.5 pr-3">
        {MAIN_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150"
              style={
                active
                  ? {
                      background: "rgba(0,212,106,0.10)",
                      color: "#00d46a",
                      borderLeft: "2px solid #00d46a",
                      paddingLeft: "10px",
                    }
                  : {
                      color: "hsl(240 8% 55%)",
                      borderLeft: "2px solid transparent",
                      paddingLeft: "10px",
                    }
              }
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="my-3 mr-3" style={{ height: 1, background: "hsl(240 12% 13%)" }} />

      {/* Tool items */}
      <nav className="flex flex-col gap-0.5 pr-3">
        {TOOL_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150"
              style={
                active
                  ? {
                      background: "rgba(0,212,106,0.08)",
                      color: "#00d46a",
                      borderLeft: "2px solid #00d46a",
                      paddingLeft: "10px",
                    }
                  : {
                      color: "hsl(240 8% 42%)",
                      borderLeft: "2px solid transparent",
                      paddingLeft: "10px",
                    }
              }
            >
              <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
