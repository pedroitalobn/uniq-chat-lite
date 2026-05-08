"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { Bot } from "lucide-react";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={Bot}
        title="Agentes IA"
        subtitle="Personalidade · Conhecimento · Ações · Ativação"
        color="#a5b4fc"
        bg="rgba(99,102,241,0.10)"
        border="rgba(99,102,241,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
