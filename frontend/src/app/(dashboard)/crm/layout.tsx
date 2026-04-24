"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, Briefcase, Building2 } from "lucide-react";

// Shared layout for /crm/* — renders a sub-nav at the top so a single
// sidebar entry ("CRM") can host Contatos / Deals / Empresas without adding
// more top-level sections. Mantém identidade Uniq.chat (cores HSL).
const TABS = [
  { href: "/crm",           label: "Contatos",  icon: Contact,    match: (p: string) => p === "/crm" || p.startsWith("/crm/contacts") },
  { href: "/crm/deals",     label: "Deals",     icon: Briefcase,  match: (p: string) => p.startsWith("/crm/deals") },
  { href: "/crm/companies", label: "Empresas",  icon: Building2,  match: (p: string) => p.startsWith("/crm/companies") },
];

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <nav
        className="flex items-center gap-0.5 border-b px-4"
        style={{ borderColor: "hsl(240 12% 16%)" }}
      >
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors"
              style={{
                color: active ? "hsl(240 15% 90%)" : "hsl(240 8% 52%)",
                borderBottom: active
                  ? "2px solid #00d46a"
                  : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
