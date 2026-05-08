"use client";

// MobileDock — substitui a BottomNav padrão por uma "pill bar" estilo
// app nativo. 5 slots:
//   1. Início (link)
//   2. Inbox (link, badge unread)
//   3. ✨ Uniq AI — botão DESTACADO no centro (raised, gradient verde,
//       acima da linha do dock). Substitui a FAB flutuante /right-4 que
//       sobrepunha o menu antes.
//   4. CRM (link)
//   5. Mais (abre sheet com Campanhas/Jornadas/Agentes/Help Desk/etc)
//
// Glassmorphism + safe-area-inset-bottom + haptic-friendly tap targets
// (≥44px) — sensação de nativo dentro do browser.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Headset, Contact, MoreHorizontal, Sparkles,
  Megaphone, Wand2, Bot, Smartphone, Plug, Settings, Building2,
  LifeBuoy, ShoppingBag, X, Database, Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUniqAIIsland } from "@/components/uniq-ai/island-context";

type NavEntry = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const PRIMARY_LEFT: NavEntry[] = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/inbox",     label: "Inbox",  icon: Headset },
];

const PRIMARY_RIGHT: NavEntry[] = [
  { href: "/crm",       label: "CRM",       icon: Database },
];

// "Mais" — todos os módulos secundários acessíveis pelo sheet.
const MORE: NavEntry[] = [
  { href: "/campaigns",    label: "Campanhas",   icon: Megaphone },
  { href: "/journeys",     label: "Jornadas",    icon: Wand2 },
  { href: "/agents",       label: "Agentes",     icon: Bot },
  { href: "/help-desk",    label: "Help Desk",   icon: LifeBuoy },
  { href: "/shops",        label: "Lojas",       icon: ShoppingBag },
  { href: "/instances",    label: "Instâncias",  icon: Smartphone },
  { href: "/servers",      label: "Servidores",  icon: Server },
  { href: "/integrations", label: "Integrações", icon: Plug },
  { href: "/workspace",    label: "Workspace",   icon: Building2 },
  { href: "/settings",     label: "Configurações", icon: Settings },
];

export function MobileDock() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const island = useUniqAIIsland();

  const isActive = (href: string) =>
    pathname === href || (pathname?.startsWith(href + "/") ?? false);
  const isMoreActive =
    MORE.some((i) => isActive(i.href)) ||
    (pathname?.startsWith("/uniq-ai") ?? false);

  // Esc fecha sheet (UX teclado).
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  return (
    <>
      {/* Floating dock — só aparece em mobile/tablet pequeno */}
      <nav
        className="md:hidden fixed left-1/2 -translate-x-1/2 z-40 px-2"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          width: "min(94vw, 460px)",
        }}
      >
        <div
          className="relative flex items-center justify-between gap-1 px-2"
          style={{
            height: 64,
            background: "rgba(10,10,20,0.78)",
            backdropFilter: "blur(28px) saturate(200%)",
            WebkitBackdropFilter: "blur(28px) saturate(200%)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 28,
            boxShadow: "0 12px 40px rgba(0,0,0,0.50), 0 -2px 12px rgba(0,212,106,0.08), inset 0 1px 0 rgba(255,255,255,0.10)",
          }}
        >
          {PRIMARY_LEFT.map((item, i) => (
            <DockItem key={item.href} item={item} active={isActive(item.href)} index={i} />
          ))}

          {/* Uniq AI — botão centro, raised */}
          <UniqAICenterButton open={() => island.open()} />

          {PRIMARY_RIGHT.map((item, i) => (
            <DockItem key={item.href} item={item} active={isActive(item.href)} index={i + 3} />
          ))}

          {/* Mais (sheet trigger) */}
          <button
            onClick={() => setSheetOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-2xl"
            style={{
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
              background: isMoreActive ? "rgba(0,212,106,0.10)" : "transparent",
              color: isMoreActive ? "var(--green)" : "var(--text-3)",
            }}
            aria-label="Mais"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">Mais</span>
          </button>
        </div>
      </nav>

      {/* Sheet de "Mais" — bottom sheet estilo iOS */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              key="backdrop"
              className="md:hidden fixed inset-0 z-50"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              key="sheet"
              className="md:hidden fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl"
              style={{
                background: "rgba(10,10,20,0.92)",
                backdropFilter: "blur(28px) saturate(200%)",
                WebkitBackdropFilter: "blur(28px) saturate(200%)",
                borderTop: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 -16px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              {/* Drag handle visual (não funcional — UX iOS) */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.18)" }} />
              </div>
              <div
                className="flex items-center justify-between px-5 pt-2 pb-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Módulos</p>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-2)" }}
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 p-4 pb-2">
                {MORE.map((item, index) => {
                  const active = isActive(item.href);
                  return (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, scale: 0.95, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: index * 0.03, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <Link
                        href={item.href}
                        onClick={() => setSheetOpen(false)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-2xl"
                        style={
                          active
                            ? {
                                background: "rgba(0,212,106,0.14)",
                                border: "1px solid rgba(0,212,106,0.30)",
                                color: "var(--green)",
                                boxShadow: "0 0 18px rgba(0,212,106,0.18)",
                              }
                            : {
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                color: "var(--text-1)",
                              }
                        }
                      >
                        <item.icon className="w-5 h-5" />
                        <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function DockItem({ item, active, index }: { item: NavEntry; active: boolean; index: number }) {
  return (
    <motion.div
      className="flex-1 flex"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        href={item.href}
        className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-2xl"
        style={{
          transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
          background: active ? "rgba(0,212,106,0.12)" : "transparent",
          color: active ? "var(--green)" : "var(--text-3)",
        }}
      >
        <item.icon className="w-5 h-5" />
        <span className="text-[10px] font-medium leading-none">{item.label}</span>
      </Link>
    </motion.div>
  );
}

function UniqAICenterButton({ open }: { open: () => void }) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 64, flex: "0 0 auto" }}
    >
      <motion.button
        onClick={open}
        whileTap={{ scale: 0.92 }}
        className="absolute flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          top: -16, // raised acima da linha do dock
          background: "linear-gradient(135deg, #00d46a 0%, #00b259 100%)",
          boxShadow: "0 8px 24px rgba(0,212,106,0.45), 0 0 0 4px rgba(10,10,20,0.78), inset 0 1px 0 rgba(255,255,255,0.30)",
        }}
        aria-label="Abrir Uniq AI"
      >
        <Sparkles className="w-6 h-6" style={{ color: "#0a0a14" }} />
      </motion.button>
      {/* Espaço-fantasma pra o item central não comprimir os outros */}
      <span className="text-[9px] font-medium absolute bottom-1" style={{ color: "var(--text-3)" }}>
        Uniq AI
      </span>
    </div>
  );
}
