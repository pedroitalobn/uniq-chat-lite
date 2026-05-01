"use client";

import { usePathname } from "next/navigation";
import { CRMNav } from "@/components/crm/CRMNav";

const PAGE_NAMES: Array<{ match: (p: string) => boolean; label: string }> = [
  { match: (p) => p === "/crm" || p.startsWith("/crm/deals"),      label: "Deals" },
  { match: (p) => p.startsWith("/crm/contacts"),                    label: "Contatos" },
  { match: (p) => p.startsWith("/crm/companies"),                   label: "Empresas" },
  { match: (p) => p.startsWith("/crm/segments"),                    label: "Segmentos" },
  { match: (p) => p.startsWith("/crm/import"),                      label: "Importar" },
  { match: (p) => p.startsWith("/crm/duplicates"),                  label: "Duplicatas" },
];

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pageLabel = PAGE_NAMES.find((n) => n.match(pathname))?.label ?? "";

  return (
    <div className="flex h-full flex-col pt-10 sm:pt-12">
      {/* Header — CRM em destaque, subpágina como label menor */}
      <div className="mb-5 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 95%)" }}>
          CRM
        </h1>
        {pageLabel && (
          <>
            <span style={{ color: "hsl(240 8% 30%)" }}>/</span>
            <span className="text-sm font-medium" style={{ color: "hsl(240 8% 55%)" }}>
              {pageLabel}
            </span>
          </>
        )}
      </div>

      {/* Body — submenu vertical à esquerda + conteúdo à direita */}
      <div className="flex flex-1 min-h-0 gap-0">
        <CRMNav />
        <div className="flex-1 min-w-0 pl-6 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
