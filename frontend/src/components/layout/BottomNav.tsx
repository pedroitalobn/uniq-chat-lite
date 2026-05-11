"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Headset, Contact, Megaphone, MoreHorizontal,
  Wand2, Bot, Smartphone, Plug, Settings, Building2, X,
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
  { href: "/workspace",    label: "Workspace",   icon: Building2 },
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
          background: "rgba(10,10,20,0.75)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderTop: "1px solid var(--border-default)",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        {PRIMARY.map((item, index) => {
          const active = isActive(item.href);
          return (
            <motion.div
              key={item.href}
              className="flex-1 flex items-center justify-center h-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link
                href={item.href}
                className="flex flex-col items-center justify-center gap-0.5 h-full w-full"
                style={{ transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)" }}
              >
                <span
                  className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl"
                  style={active
                    ? {
                        background: "rgba(0,212,106,0.12)",
                        backdropFilter: "blur(8px)",
                        border: "1px solid rgba(0,212,106,0.25)",
                        borderRadius: "12px",
                        boxShadow: "0 0 16px rgba(0,212,106,0.15)",
                        color: "var(--green)",
                        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                      }
                    : {
                        background: "transparent",
                        border: "1px solid transparent",
                        color: "var(--text-3)",
                        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                      }
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium leading-none">{item.label}</span>
                </span>
              </Link>
            </motion.div>
          );
        })}

        {/* More button */}
        <motion.div
          className="flex-1 flex items-center justify-center h-full"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: PRIMARY.length * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <button
            onClick={() => setSheetOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 h-full w-full"
            style={{ transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)" }}
          >
            <span
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl"
              style={isMoreActive
                ? {
                    background: "rgba(0,212,106,0.12)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(0,212,106,0.25)",
                    borderRadius: "12px",
                    boxShadow: "0 0 16px rgba(0,212,106,0.15)",
                    color: "var(--green)",
                    transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                  }
                : {
                    background: "transparent",
                    border: "1px solid transparent",
                    color: "var(--text-3)",
                    transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                  }
              }
            >
              <MoreHorizontal className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">Mais</span>
            </span>
          </button>
        </motion.div>
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
          background: "rgba(10,10,20,0.85)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderTop: "1px solid var(--border-default)",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.08)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Mais opções</p>
          <button
            onClick={() => setSheetOpen(false)}
            className="p-1 rounded-lg"
            style={{
              color: "var(--text-3)",
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 p-4">
          {MORE.map((item, index) => {
            const active = isActive(item.href);
            return (
              <motion.div
                key={item.href}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.04, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  href={item.href}
                  onClick={() => setSheetOpen(false)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
                  style={active
                    ? {
                        background: "rgba(0,212,106,0.12)",
                        backdropFilter: "blur(8px)",
                        border: "1px solid rgba(0,212,106,0.25)",
                        boxShadow: "0 0 16px rgba(0,212,106,0.15)",
                        color: "var(--green)",
                        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                      }
                    : {
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: "var(--text-2)",
                        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                      }
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </>
  );
}
