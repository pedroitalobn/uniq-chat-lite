"use client";

// Shared layout for /crm/* — passthrough. As tabs (Contatos / Deals /
// Empresas) ficam embutidas dentro do header de cada página via
// <CRMTabs />, posicionadas inline com filtros e search pra preservar
// a hierarquia visual (título da página vem primeiro).
export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col">{children}</div>;
}
