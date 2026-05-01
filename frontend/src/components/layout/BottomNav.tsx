"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Headset, Contact, Megaphone, MoreHorizontal,
  Wand2, Bot, Smartphone, Plug, Settings, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavEntry = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const PRIMARY: NavEntry[] = [
  { href: "/dashboard",  label: "Início",    icon: LayoutDashboard },
  { href: "/inbox",      label: "Inbox",     icon: Headset },
  { href: "/crm",        label: "CRM",       icon: Contact },
  { href: "/campaigns",  label: "Campanhas", icon: Megaphone },
];

const MORE: NavEntry[] = [
  { href: "/journeys",     label: "Jornadas",    icon: Wand2 },
  { href: "/agents",       label: "Agentes",     icon: Bot },
  { href: "/instances",    label: "Instâncias",  icon: Smartphone },
  { href: "/integrations", label: "Integrações", icon: Plug },
  { href: "/settings",     label: "Settings",    icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const isMoreActive = MORE.some((i) => isActive(i.href));

  return (
    <>
      {/* Bottom bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center"
        style={{
          height: "56px",
          background: "var(--surface-1)",
          borderTop: "1px solid var(--surface-border)",
        }}
      >
        {PRIMARY.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-all duration-150"
            >
              <span
                className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-150"
                style={{
                  background: active ? "var(--green-dim)" : "transparent",
                  color: active ? "var(--green)" : "var(--text-3)",
                }}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
              </span>
            </Link>
          );
        })}

        {/* More button */}
        <button
          onClick={() => setSheetOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-all duration-150"
        >
          <span
            className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-150"
            style={{
              background: isMoreActive ? "var(--green-dim)" : "transparent",
              color: isMoreActive ? "var(--green)" : "var(--text-3)",
            }}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">Mais</span>
          </span>
        </button>
      </nav>

      {/* Sheet backdrop */}
      {sheetOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setSheetOpen(false)}
        />
      )}

      {/* Sheet drawer */}
      <div
        className={cn(
          "md:hidden fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl transition-transform duration-300 ease-in-out",
          sheetOpen ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          background: "var(--surface-2)",
          borderTop: "1px solid var(--surface-border)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--surface-border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Mais opções</p>
          <button
            onClick={() => setSheetOpen(false)}
            className="p-1 rounded-lg"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 p-4">
          {MORE.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSheetOpen(false)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all duration-150"
                style={{
                  background: active ? "var(--green-dim)" : "var(--surface-3)",
                  color: active ? "var(--green)" : "var(--text-2)",
                }}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
