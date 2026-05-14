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
import { signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Headset, MoreHorizontal,
  Megaphone, Wand2, Bot, Smartphone, Plug, Settings, Building2,
  LifeBuoy, ShoppingBag, X, Database, Server, Zap, LogOut,
} from "lucide-react";
import { useUniqAIIsland } from "@/components/uniq-ai/island-context";
import { UniqAIBrandMark } from "@/components/uniq-ai/brand-mark";
import { haptic } from "@/lib/haptics";
import { features } from "@/lib/feature-flags";

type NavEntry = {
  href?: string;
  label: string;
  icon: typeof LayoutDashboard;
  action?: () => void;
};

const PRIMARY_LEFT: NavEntry[] = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/inbox",     label: "Inbox",  icon: Headset },
];

const PRIMARY_RIGHT: NavEntry[] = [
  { href: "/crm",       label: "CRM",       icon: Database },
];

const SLOT_CENTERS = ["10%", "30%", "50%", "70%", "90%"] as const;

// "Mais" — todos os módulos secundários acessíveis pelo sheet.
const MORE: NavEntry[] = [
  { href: "/campaigns",    label: "Campanhas",   icon: Megaphone },
  { href: "/journeys",     label: "Jornadas",    icon: Wand2 },
  { href: "/agents",       label: "Agentes",     icon: Bot },
  ...(features.helpdesk ? [{ href: "/help-desk", label: "Help Desk", icon: LifeBuoy }] : []),
  ...(features.shops ? [{ href: "/shops", label: "Lojas", icon: ShoppingBag }] : []),
  { href: "/instances",    label: "Instâncias",  icon: Smartphone },
  { href: "/servers",      label: "Servidores",  icon: Server },
  { href: "/integrations", label: "Integrações", icon: Plug },
  ...(features.usage ? [{ href: "/usage", label: "Consumo", icon: Zap }] : []),
  { href: "/workspace",    label: "Workspace",   icon: Building2 },
  { href: "/settings",     label: "Configurações", icon: Settings },
  { label: "Sair",         icon: LogOut,         action: () => signOut({ callbackUrl: "/login" }) },
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
  const activeSlot = pathname?.startsWith("/uniq-ai")
    ? 2
    : isActive("/dashboard")
      ? 0
      : isActive("/inbox")
        ? 1
        : isActive("/crm")
          ? 3
          : isMoreActive
            ? 4
            : null;

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
      {/* Fade scrim atrás do dock — gradient transparente → opaco do
          fundo da app. Esconde conteúdo "vazando" pelas laterais e fundo
          do dock flutuante. Pointer-events-none pra não bloquear scroll. */}
      <div
        aria-hidden
        className="md:hidden fixed left-0 right-0 z-30 pointer-events-none"
        style={{
          bottom: 0,
          height: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
          background: "linear-gradient(to bottom, transparent 0%, rgba(10,10,20,0.35) 35%, rgba(10,10,20,0.85) 70%, rgba(10,10,20,0.96) 100%)",
        }}
      />

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
            border: "1px solid var(--border-default)",
            borderRadius: 28,
            boxShadow: "0 12px 40px rgba(0,0,0,0.50), 0 -2px 12px rgba(0,212,106,0.08), inset 0 1px 0 var(--border-default)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-5 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)" }}
          />
          <motion.div
            className="pointer-events-none absolute bottom-1.5 h-10 w-[58px] -translate-x-1/2 rounded-[18px]"
            style={{
              left: activeSlot == null ? "-20%" : SLOT_CENTERS[activeSlot],
              background: "linear-gradient(180deg, rgba(0,212,106,0.16) 0%, rgba(0,212,106,0.05) 72%, transparent 100%)",
              boxShadow: "0 0 24px rgba(0,212,106,0.16)",
            }}
            animate={{
              left: activeSlot == null ? "-20%" : SLOT_CENTERS[activeSlot],
              opacity: activeSlot == null ? 0 : 1,
            }}
            transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.8 }}
          />
          <motion.div
            className="pointer-events-none absolute bottom-[7px] h-[3px] w-11 -translate-x-1/2 rounded-full"
            style={{
              left: activeSlot == null ? "-20%" : SLOT_CENTERS[activeSlot],
              background: "linear-gradient(90deg, rgba(0,212,106,0.12), rgba(110,255,178,0.98), rgba(0,212,106,0.12))",
              boxShadow: "0 0 12px rgba(0,212,106,0.55), 0 0 26px rgba(0,212,106,0.22)",
            }}
            animate={{
              left: activeSlot == null ? "-20%" : SLOT_CENTERS[activeSlot],
              opacity: activeSlot == null ? 0 : 1,
              width: activeSlot === 2 ? 36 : 44,
            }}
            transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.75 }}
          />

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
            onClick={() => { haptic.tap(); setSheetOpen(true); }}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-2xl"
            style={{
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
              background: "transparent",
              color: isMoreActive ? "rgba(255,255,255,0.92)" : "var(--text-3)",
            }}
            aria-label="Mais"
          >
            <span
              className="relative flex items-center justify-center rounded-xl"
              style={{
                width: 32,
                height: 32,
                background: isMoreActive ? "radial-gradient(circle, rgba(0,212,106,0.24) 0%, rgba(0,212,106,0.08) 72%, transparent 100%)" : "transparent",
                boxShadow: isMoreActive ? "0 0 18px rgba(0,212,106,0.2), inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
              }}
            >
              {isMoreActive && (
                <motion.span
                  className="absolute inset-0 rounded-xl"
                  style={{ border: "1px solid rgba(0,212,106,0.28)" }}
                  animate={{ opacity: [0.55, 1, 0.55], scale: [1, 1.06, 1] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <MoreHorizontal className="w-5 h-5" />
            </span>
            <span className="relative inline-flex flex-col items-center text-[10px] font-medium leading-none">
              <span>Mais</span>
              <motion.span
                className="mt-1 h-[2px] rounded-full"
                style={{
                  background: "linear-gradient(90deg, rgba(0,212,106,0.2), rgba(0,212,106,0.95), rgba(0,212,106,0.2))",
                  boxShadow: "0 0 8px rgba(0,212,106,0.4)",
                }}
                animate={{
                  width: isMoreActive ? "100%" : "0%",
                  opacity: isMoreActive ? 1 : 0,
                }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
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
                borderTop: "1px solid var(--border-default)",
                boxShadow: "0 -16px 48px rgba(0,0,0,0.55), inset 0 1px 0 var(--border-default)",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              {/* Drag handle visual (não funcional — UX iOS) */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--border-strong)" }} />
              </div>
              <div
                className="flex items-center justify-between px-5 pt-2 pb-3"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Módulos</p>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "var(--border-subtle)", color: "var(--text-2)" }}
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 p-4 pb-2">
                {MORE.map((item, index) => {
                  const active = item.href ? isActive(item.href) : false;
                  const cardStyle = active
                    ? {
                        background: "rgba(0,212,106,0.14)",
                        border: "1px solid rgba(0,212,106,0.30)",
                        color: "var(--green)",
                        boxShadow: "0 0 18px rgba(0,212,106,0.18)",
                      }
                    : item.action
                      ? {
                          background: "rgba(248,113,113,0.08)",
                          border: "1px solid rgba(248,113,113,0.18)",
                          color: "#fca5a5",
                        }
                      : {
                          background: "var(--input)",
                          border: "1px solid var(--border-default)",
                          color: "var(--text-1)",
                        };
                  return (
                    <motion.div
                      key={item.href || item.label}
                      initial={{ opacity: 0, scale: 0.95, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: index * 0.03, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {item.href ? (
                        <Link
                          href={item.href}
                          onClick={() => setSheetOpen(false)}
                          className="flex flex-col items-center gap-1.5 p-3 rounded-2xl"
                          style={cardStyle}
                        >
                          <item.icon className="w-5 h-5" />
                          <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
                        </Link>
                      ) : (
                        <button
                          onClick={() => {
                            haptic.tap();
                            setSheetOpen(false);
                            item.action?.();
                          }}
                          className="flex w-full flex-col items-center gap-1.5 p-3 rounded-2xl"
                          style={cardStyle}
                        >
                          <item.icon className="w-5 h-5" />
                          <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
                        </button>
                      )}
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
        onClick={() => haptic.tap()}
        className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-2xl"
        style={{
          transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
          background: "transparent",
          color: active ? "rgba(255,255,255,0.92)" : "var(--text-3)",
        }}
      >
        <span
          className="relative flex items-center justify-center rounded-xl"
          style={{
            width: 32,
            height: 32,
            background: active ? "radial-gradient(circle, rgba(0,212,106,0.24) 0%, rgba(0,212,106,0.08) 72%, transparent 100%)" : "transparent",
            boxShadow: active ? "0 0 18px rgba(0,212,106,0.2), inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
          }}
        >
          {active && (
            <motion.span
              className="absolute inset-0 rounded-xl"
              style={{ border: "1px solid rgba(0,212,106,0.28)" }}
              animate={{ opacity: [0.55, 1, 0.55], scale: [1, 1.06, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <item.icon className="w-5 h-5" />
        </span>
        <span className="relative inline-flex flex-col items-center text-[10px] font-medium leading-none">
          <span>{item.label}</span>
          <motion.span
            className="mt-1 h-[2px] rounded-full"
            style={{
              background: "linear-gradient(90deg, rgba(0,212,106,0.2), rgba(0,212,106,0.95), rgba(0,212,106,0.2))",
              boxShadow: "0 0 8px rgba(0,212,106,0.4)",
            }}
            animate={{
              width: active ? "100%" : "0%",
              opacity: active ? 1 : 0,
            }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          />
        </span>
      </Link>
    </motion.div>
  );
}

function UniqAICenterButton({ open }: { open: () => void }) {
  const pathname = usePathname();
  const isActive = pathname?.startsWith("/uniq-ai") ?? false;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 64, flex: "0 0 auto" }}
    >
      <motion.button
        onClick={() => { haptic.select(); open(); }}
        whileTap={{ scale: 0.92 }}
        className="absolute flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          top: -16, // raised acima da linha do dock
          background: "linear-gradient(135deg, #00d46a 0%, #00b259 100%)",
          boxShadow: isActive
            ? "0 10px 28px rgba(0,212,106,0.52), 0 0 0 4px rgba(10,10,20,0.78), 0 0 0 1px rgba(167,255,205,0.85), inset 0 1px 0 rgba(255,255,255,0.32)"
            : "0 8px 24px rgba(0,212,106,0.45), 0 0 0 4px rgba(10,10,20,0.78), inset 0 1px 0 var(--border-strong)",
        }}
        aria-label="Abrir Uniq AI"
      >
        {isActive && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ border: "1px solid rgba(167,255,205,0.7)" }}
            animate={{ scale: [1, 1.08, 1], opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <UniqAIBrandMark className="w-6 h-6" stroke="#0a0a14" />
      </motion.button>
    </div>
  );
}
