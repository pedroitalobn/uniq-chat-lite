"use client";

import { CRMNav } from "@/components/crm/CRMNav";
import { Database } from "lucide-react";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Título global do módulo — antes só apareciam os títulos por
          subpágina (Deals/Contatos/Empresas), o usuário sentia falta de
          um header único pra orientar onde está. */}
      <div className="flex items-center gap-2 px-3 sm:px-4 pt-2">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(0,212,106,0.12)", border: "1px solid rgba(0,212,106,0.25)" }}
        >
          <Database className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
        </span>
        <h1 className="text-base font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
          CRM
        </h1>
        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
          Contatos · Negócios · Jornadas
        </span>
      </div>
      <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-3 md:gap-4">
        <CRMNav />
        <div className="flex-1 min-w-0 min-h-0 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
