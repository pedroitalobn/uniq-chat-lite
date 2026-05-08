"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { Plug } from "lucide-react";

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={Plug}
        title="Integrações"
        subtitle="LLMs · Webhooks · Apps externos"
        color="#60a5fa"
        bg="rgba(96,165,250,0.10)"
        border="rgba(96,165,250,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
