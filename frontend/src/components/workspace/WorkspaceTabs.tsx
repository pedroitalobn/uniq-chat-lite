"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Shield, Bell, ShieldOff, Mail } from "lucide-react";

// WorkspaceTabs — pílulas de navegação compartilhadas pras páginas
// internas do workspace (team, roles, messaging, suppressions,
// subscriptions). Cada página renderiza no header.
export function WorkspaceTabs({ workspaceId, className }: {
  workspaceId: string;
  className?: string;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: `/workspace/${workspaceId}/team`,           label: "Time",          icon: Users },
    { href: `/workspace/${workspaceId}/roles`,          label: "Papéis",        icon: Shield },
    { href: `/workspace/${workspaceId}/messaging`,      label: "Mensageria",    icon: Bell },
    { href: `/workspace/${workspaceId}/suppressions`,   label: "Bloqueios",     icon: ShieldOff },
    { href: `/workspace/${workspaceId}/subscriptions`,  label: "Tópicos",       icon: Mail },
  ];

  return (
    <div
      className={"flex items-center gap-0.5 rounded-2xl p-1 overflow-x-auto " + (className ?? "")}
      style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}
    >
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="flex items-center gap-2 rounded-xl px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium transition-all whitespace-nowrap"
            style={
              active
                ? { background: "rgba(0,212,106,0.12)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.25)" }
                : { background: "transparent", color: "var(--text-3)", border: "1px solid transparent" }
            }
          >
            <t.icon className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
