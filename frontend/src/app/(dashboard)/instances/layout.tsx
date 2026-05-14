"use client";

import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { Smartphone } from "lucide-react";

export default function InstancesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <ModuleHeader
        icon={Smartphone}
        title="Instâncias"
        subtitle="Conexões com WhatsApp, Instagram, Telegram"
        color="#2563EB"
        bg="rgba(37, 99, 235,0.10)"
        border="rgba(37, 99, 235,0.25)"
      />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
