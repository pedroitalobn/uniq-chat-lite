"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Headset, Contact, Megaphone, Bot, Wand2, Smartphone, Plug, Settings,
  LayoutDashboard, Sparkles, Search, X,
} from "lucide-react";

type CommandItem = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  href: string;
  shortcut?: string;
  section: string;
};

const ITEMS: CommandItem[] = [
  { id: "dashboard",    label: "Dashboard",    icon: LayoutDashboard, href: "/dashboard",    shortcut: "G D", section: "Navegação" },
  { id: "inbox",        label: "Inbox",        icon: Headset,         href: "/inbox",        shortcut: "G I", section: "Navegação" },
  { id: "crm",          label: "CRM",          icon: Contact,         href: "/crm",          shortcut: "G C", section: "Navegação" },
  { id: "campaigns",    label: "Campanhas",    icon: Megaphone,       href: "/campaigns",    shortcut: "G P", section: "Navegação" },
  { id: "agents",       label: "Agentes",      icon: Bot,             href: "/agents",       shortcut: "G A", section: "Navegação" },
  { id: "journeys",     label: "Jornadas",     icon: Wand2,           href: "/journeys",     shortcut: "G J", section: "Navegação" },
  { id: "instances",    label: "Instâncias",   icon: Smartphone,      href: "/instances",    shortcut: "G N", section: "Navegação" },
  { id: "integrations", label: "Integrações",  icon: Plug,            href: "/integrations", shortcut: "G T", section: "Navegação" },
  { id: "settings",     label: "Settings",     icon: Settings,        href: "/settings",     shortcut: "G S", section: "Navegação" },
  { id: "uniq-ai",      label: "QChat AI",      icon: Sparkles,        href: "/uniq-ai",      shortcut: "G U", section: "Ações rápidas" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) {
            setQuery("");
            return false;
          }
          setQuery("");
          setActiveIndex(0);
          return true;
        });
      }
      if (e.key === "Escape") closePalette();
    };
    const onCustom = () => openPalette();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("uniq:cmd-k", onCustom);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("uniq:cmd-k", onCustom);
    };
  }, [openPalette, closePalette]);

  const filtered = query.trim()
    ? ITEMS.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.section.toLowerCase().includes(query.toLowerCase())
      )
    : ITEMS;

  const sections = Array.from(new Set(filtered.map((i) => i.section)));

  const navigate = useCallback((item: CommandItem) => {
    router.push(item.href);
    closePalette();
  }, [router, closePalette]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[activeIndex];
        if (item) navigate(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, activeIndex, navigate]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  let globalIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="cmd-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={closePalette}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9998,
              background: "rgba(0,0,0,0.70)",
              backdropFilter: "blur(8px) saturate(150%)",
              WebkitBackdropFilter: "blur(8px) saturate(150%)",
            }}
          />

          {/* Modal */}
          <motion.div
            key="cmd-modal"
            initial={{ opacity: 0, scale: 0.95, y: -20, x: "-50%" }}
            animate={{ opacity: 1, scale: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, scale: 0.96, y: -10, x: "-50%" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: "fixed",
              top: "20%",
              left: "50%",
              width: "min(600px, 90vw)",
              zIndex: 9999,
              background: "linear-gradient(160deg, var(--border-default) 0%, var(--input) 50%, rgba(0,0,0,0.10) 100%)",
              backdropFilter: "blur(32px) saturate(200%) brightness(1.1)",
              WebkitBackdropFilter: "blur(32px) saturate(200%) brightness(1.1)",
              border: "1px solid var(--border-strong)",
              borderRadius: "24px",
              boxShadow: "0 40px 80px rgba(0,0,0,0.70), 0 16px 32px rgba(0,0,0,0.50), 0 4px 8px rgba(0,0,0,0.30), inset 0 1px 0 var(--border-strong), inset 0 -1px 0 rgba(0,0,0,0.20)",
              overflow: "hidden",
              maxHeight: "60vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Top light line */}
            <div style={{
              position: "absolute",
              top: 0,
              left: "20%",
              right: "20%",
              height: "1px",
              background: "linear-gradient(90deg, transparent, var(--border-strong), transparent)",
              pointerEvents: "none",
            }} />

            {/* Ambient orb */}
            <div style={{
              position: "absolute",
              top: "-60px",
              right: "-60px",
              width: "200px",
              height: "200px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(37, 99, 235,0.15) 0%, transparent 70%)",
              filter: "blur(40px)",
              pointerEvents: "none",
            }} />

            {/* Search input */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Search
                className="w-4 h-4"
                style={{
                  position: "absolute",
                  left: "20px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-3)",
                  pointerEvents: "none",
                }}
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar páginas e ações..."
                style={{
                  background: "var(--border-subtle)",
                  backdropFilter: "blur(8px)",
                  border: "none",
                  borderBottom: "1px solid var(--border-default)",
                  color: "var(--text-1)",
                  fontSize: "16px",
                  padding: "18px 20px 18px 52px",
                  width: "100%",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  style={{
                    position: "absolute",
                    right: "16px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-4)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Results */}
            <div style={{ overflowY: "auto", padding: "8px 0", flex: 1 }}>
              {filtered.length === 0 && (
                <p
                  className="text-center text-sm py-8"
                  style={{ color: "var(--text-4)" }}
                >
                  Nenhum resultado encontrado
                </p>
              )}
              {sections.map((section) => {
                const sectionItems = filtered.filter((i) => i.section === section);
                return (
                  <div key={section}>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-widest"
                      style={{
                        color: "var(--text-4)",
                        padding: "6px 16px",
                        opacity: 0.6,
                      }}
                    >
                      {section}
                    </p>
                    {sectionItems.map((item) => {
                      globalIndex++;
                      const idx = globalIndex;
                      const isActive = activeIndex === idx;
                      return (
                        <button
                          key={item.id}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => navigate(item)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px 16px",
                            borderRadius: "12px",
                            cursor: "pointer",
                            transition: "all 0.15s cubic-bezier(0.16,1,0.3,1)",
                            margin: "2px 8px",
                            width: "calc(100% - 16px)",
                            textAlign: "left",
                            border: "none",
                            background: isActive ? "var(--border-default)" : "transparent",
                            backdropFilter: isActive ? "blur(4px)" : undefined,
                            borderLeft: isActive ? "2px solid var(--green)" : "2px solid transparent",
                            boxShadow: isActive ? "inset 0 0 20px rgba(37, 99, 235,0.05)" : "none",
                            color: isActive ? "var(--text-1)" : "var(--text-2)",
                            boxSizing: "border-box",
                          }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "28px",
                              height: "28px",
                              borderRadius: "8px",
                              flexShrink: 0,
                              background: isActive ? "rgba(37, 99, 235,0.12)" : "var(--border-subtle)",
                              color: isActive ? "var(--green)" : "var(--text-3)",
                              transition: "all 0.15s cubic-bezier(0.16,1,0.3,1)",
                            }}
                          >
                            <item.icon style={{ width: "14px", height: "14px" }} />
                          </span>
                          <span style={{ flex: 1, fontSize: "14px", fontWeight: 500 }}>{item.label}</span>
                          {item.shortcut && (
                            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              {item.shortcut.split(" ").map((k, i) => (
                                <kbd
                                  key={i}
                                  style={{
                                    fontSize: "10px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "var(--border-subtle)",
                                    border: "1px solid var(--border-default)",
                                    color: "var(--text-4)",
                                    fontFamily: "monospace",
                                  }}
                                >
                                  {k}
                                </kbd>
                              ))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "8px 16px",
                fontSize: "10px",
                borderTop: "1px solid var(--border-subtle)",
                color: "var(--text-4)",
                flexShrink: 0,
              }}
            >
              <span><kbd style={{ fontFamily: "monospace" }}>↑↓</kbd> navegar</span>
              <span><kbd style={{ fontFamily: "monospace" }}>↵</kbd> selecionar</span>
              <span><kbd style={{ fontFamily: "monospace" }}>ESC</kbd> fechar</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
