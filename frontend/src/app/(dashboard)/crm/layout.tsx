"use client";

import { CRMTabs } from "@/components/crm/CRMTabs";

// Shared layout for /crm/* — renderiza CRMTabs UMA VEZ no topo, alinhada
// à esquerda. Antes cada página renderizava o componente em posições
// diferentes (ora à direita do título, ora dentro de um header de filtros)
// — UX ficou inconsistente.
// pt-10 sm:pt-12 dá folga vertical pra Dynamic Island fixa no topo
// não sobrepor o título/pílulas.
export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col pt-10 sm:pt-12">
      <div className="mb-3">
        <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>
          CRM
        </h1>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Gerencie deals, contatos e empresas em um só lugar
        </p>
      </div>
      <div className="mb-4 sm:mb-5">
        <CRMTabs />
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
