"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, Briefcase, Building2 } from "lucide-react";

// Shared layout for /crm/* — sub-nav centralizada com pílulas (segmented
// control) no estilo Uniq dark + accent verde. Substitui o underline antigo
// pra ficar consistente com o resto da app.
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
        className="flex items-center justify-center px-4 py-3"
        style={{ borderBottom: "1px solid hsl(240 12% 14%)" }}
      >
        <div
          className="flex items-center gap-0.5 rounded-2xl p-1"
          style={{
            background: "hsl(240 18% 6%)",
            border: "1px solid hsl(240 12% 13%)",
          }}
        >
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                className="flex items-center gap-2 rounded-xl px-4 py-1.5 text-sm font-medium transition-all duration-150"
                style={
                  active
                    ? {
                        background: "rgba(0,212,106,0.12)",
                        color: "#00d46a",
                        border: "1px solid rgba(0,212,106,0.25)",
                      }
                    : {
                        background: "transparent",
                        color: "hsl(240 8% 55%)",
                        border: "1px solid transparent",
                      }
                }
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
