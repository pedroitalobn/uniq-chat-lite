"use client";

import { usePathname } from "next/navigation";
import { CRMNav } from "@/components/crm/CRMNav";

const PAGE_META: Array<{ match: (p: string) => boolean; label: string; description: string }> = [
  { match: (p) => p === "/crm" || p.startsWith("/crm/deals"),      label: "Deals",      description: "Pipeline e oportunidades de venda" },
  { match: (p) => p.startsWith("/crm/contacts"),                    label: "Contatos",   description: "Pessoas e leads do seu CRM" },
  { match: (p) => p.startsWith("/crm/companies"),                   label: "Empresas",   description: "Organizações e contas" },
  { match: (p) => p.startsWith("/crm/segments"),                    label: "Segmentos",  description: "Grupos e filtros avançados" },
  { match: (p) => p.startsWith("/crm/import"),                      label: "Importar",   description: "Importar dados via CSV ou planilha" },
  { match: (p) => p.startsWith("/crm/duplicates"),                  label: "Duplicatas", description: "Encontrar e mesclar registros duplicados" },
];

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const page = PAGE_META.find((n) => n.match(pathname));

  return (
    <div className="flex h-full flex-col">
      {/* Page header — mesmo padrão de /settings */}
      <div className="mb-5 flex-shrink-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
          CRM
        </h1>
        {page && (
          <p className="text-sm mt-0.5 hidden sm:block" style={{ color: "var(--text-3)" }}>
            {page.description}
          </p>
        )}
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0 gap-6">
        <CRMNav />
        {/* Content — rounded-2xl como as outras surfaces do design system */}
        <div
          className="flex-1 min-w-0 rounded-2xl overflow-hidden"
          style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
