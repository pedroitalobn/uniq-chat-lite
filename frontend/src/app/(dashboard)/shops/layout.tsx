"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { ShoppingBag } from "lucide-react";

export default function ShopsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={ShoppingBag}
        title="Lojas"
        subtitle="Catálogo · Pedidos · Integrações de e-commerce"
        color="#ec4899"
        bg="rgba(236,72,153,0.10)"
        border="rgba(236,72,153,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
