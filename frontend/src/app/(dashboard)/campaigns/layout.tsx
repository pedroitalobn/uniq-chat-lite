"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { Megaphone } from "lucide-react";

export default function CampaignsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={Megaphone}
        title="Campanhas"
        subtitle="Disparos em massa · Templates · Segmentos"
        color="#fbbf24"
        bg="rgba(251,191,36,0.10)"
        border="rgba(251,191,36,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
