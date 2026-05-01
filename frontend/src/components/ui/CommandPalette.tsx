"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  { id: "uniq-ai",      label: "Uniq AI",      icon: Sparkles,        href: "/uniq-ai",      shortcut: "G U", section: "Ações rápidas" },
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

  if (!open) return null;

  let globalIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div
        className="w-full max-w-xl mx-4 rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--surface-border)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.6)",
          maxHeight: "60vh",
        }}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-3)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar páginas e ações..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--text-1)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ color: "var(--text-4)" }}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-4)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: "var(--text-4)" }}>
              Nenhum resultado encontrado
            </p>
          )}
          {sections.map((section) => {
            const sectionItems = filtered.filter((i) => i.section === section);
            return (
              <div key={section}>
                <p
                  className="text-[10px] font-semibold uppercase tracking-widest px-4 py-1.5"
                  style={{ color: "var(--text-4)" }}
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-100"
                      style={{
                        background: isActive ? "var(--surface-3)" : "transparent",
                        borderLeft: isActive ? "2px solid var(--green)" : "2px solid transparent",
                        color: isActive ? "var(--text-1)" : "var(--text-2)",
                      }}
                    >
                      <span
                        className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0"
                        style={{
                          background: isActive ? "rgba(0,212,106,0.12)" : "var(--surface-3)",
                          color: isActive ? "var(--green)" : "var(--text-3)",
                        }}
                      >
                        <item.icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="flex-1 text-sm font-medium">{item.label}</span>
                      {item.shortcut && (
                        <span className="flex items-center gap-1">
                          {item.shortcut.split(" ").map((k, i) => (
                            <kbd
                              key={i}
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{
                                background: "var(--surface-3)",
                                border: "1px solid var(--surface-border)",
                                color: "var(--text-4)",
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
          className="flex items-center gap-3 px-4 py-2 text-[10px]"
          style={{
            borderTop: "1px solid var(--surface-border)",
            color: "var(--text-4)",
          }}
        >
          <span><kbd className="font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="font-mono">↵</kbd> selecionar</span>
          <span><kbd className="font-mono">ESC</kbd> fechar</span>
        </div>
      </div>
    </div>
  );
}
