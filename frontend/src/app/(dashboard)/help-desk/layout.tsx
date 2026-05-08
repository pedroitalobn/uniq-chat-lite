"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { LifeBuoy } from "lucide-react";

export default function HelpDeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={LifeBuoy}
        title="Help Desk"
        subtitle="Tickets · Filas · SLA"
        color="#22d3ee"
        bg="rgba(34,211,238,0.10)"
        border="rgba(34,211,238,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
