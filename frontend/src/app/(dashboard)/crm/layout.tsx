"use client";

import { CRMNav } from "@/components/crm/CRMNav";
import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { Database } from "lucide-react";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={Database}
        title="CRM"
        subtitle="Contatos · Negócios · Jornadas"
      />
      <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-3 md:gap-4">
        <CRMNav />
        <div className="flex-1 min-w-0 min-h-0 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
