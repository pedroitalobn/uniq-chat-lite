"use client";

import { CRMTabs } from "@/components/crm/CRMTabs";

// Shared layout for /crm/* — renderiza CRMTabs UMA VEZ no topo, alinhada
// à esquerda. Antes cada página renderizava o componente em posições
// diferentes (ora à direita do título, ora dentro de um header de filtros)
// — UX ficou inconsistente.
export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 sm:mb-5">
        <CRMTabs />
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
