"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, Briefcase, Building2, Filter, Upload, GitMerge } from "lucide-react";

// CRMTabs — pílulas de navegação entre Contatos / Deals / Empresas.
// Componente standalone pra cada página posicionar onde fizer sentido
// no próprio header (em vez de empurrar pra cima do título).
// Ordem reflete a importância no fluxo de venda: Deals primeiro (pipeline =
// onde o trabalho acontece), depois Contatos e Empresas como suporte.
// /crm sempre redireciona pra /crm/deals (default).
const TABS = [
  { href: "/crm/deals",     label: "Deals",     icon: Briefcase,  match: (p: string) => p === "/crm" || p.startsWith("/crm/deals") },
  { href: "/crm/contacts",  label: "Contatos",  icon: Contact,    match: (p: string) => p.startsWith("/crm/contacts") },
  { href: "/crm/companies", label: "Empresas",  icon: Building2,  match: (p: string) => p.startsWith("/crm/companies") },
  { href: "/crm/segments",  label: "Segmentos", icon: Filter,     match: (p: string) => p.startsWith("/crm/segments") },
  { href: "/crm/import",     label: "Importar",   icon: Upload,    match: (p: string) => p.startsWith("/crm/import") },
  { href: "/crm/duplicates", label: "Duplicatas", icon: GitMerge,  match: (p: string) => p.startsWith("/crm/duplicates") },
];

export function CRMTabs({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <div
      className={
        "flex items-center gap-0.5 rounded-2xl p-1 " + (className ?? "")
      }
      style={{
        background: "var(--surface-solid)",
        border: "1px solid var(--border)",
      }}
    >
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="flex items-center gap-2 rounded-xl px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium transition-all duration-150"
            style={
              active
                ? {
                    background: "rgba(0,212,106,0.12)",
                    color: "#00d46a",
                    border: "1px solid rgba(0,212,106,0.25)",
                  }
                : {
                    background: "transparent",
                    color: "var(--text-3)",
                    border: "1px solid transparent",
                  }
            }
          >
            <t.icon className="h-3.5 w-3.5" />
            <span className="hidden xs:inline sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
