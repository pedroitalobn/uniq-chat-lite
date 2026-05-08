"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { Route } from "lucide-react";

export default function JourneysLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={Route}
        title="Jornadas"
        subtitle="Fluxos automatizados de mensagens"
        color="#a78bfa"
        bg="rgba(167,139,250,0.10)"
        border="rgba(167,139,250,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
