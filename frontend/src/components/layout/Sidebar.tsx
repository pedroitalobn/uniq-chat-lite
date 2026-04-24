"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Building2, Calendar, ChevronDown, Contact, CreditCard, Globe, Hash, HelpCircle, Home,
  Info, KanbanSquare, Layers, LayoutDashboard, Link2, List, Loader2, LogOut,
  Mail, MapPin, Megaphone, Menu, MessageSquare, Minus, MoreHorizontal,
  MoreVertical, Phone, Plug, Plus, Search, Send, Settings, Shield, Smartphone,
  Smile, Sparkles, Star, Tag, Trash2, Users, X, Zap, StickyNote,
  Wrench, ExternalLink, Server, Headset, BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { Logo } from "@/components/Logo";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = usePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { currentWorkspace, setCurrentWorkspace, workspaces } = useWorkspace();
  const isAdmin = session?.user?.role === "super_admin";
  const planName = (session?.user?.plan as { name?: string } | undefined)?.name ?? session?.user?.role;
  const initials = session?.user?.name?.[0]?.toUpperCase() || "U";

  const navItems = [
    { href: "/dashboard",    label: t("nav_dashboard"),    icon: LayoutDashboard, exact: true },
    { href: "/agents",       label: "Agentes IA",          icon: Zap,             exact: false },
    { href: "/servers",     label: t("nav_servers"),      icon: Server,          exact: false },
    { href: "/instances",   label: t("nav_instances"),    icon: Smartphone,      exact: false },
    { href: "/inbox",       label: "Inbox",               icon: Headset,         exact: false },
    { href: "/reports/overview", label: "Relatórios",     icon: BarChart3,        exact: false },
    { href: "/crm",         label: t("nav_crm"),          icon: Contact,         exact: false },
    { href: "/campaigns",   label: t("nav_campaigns"),    icon: Megaphone,       exact: false },
    { href: "/integrations", label: t("nav_integrations"), icon: Plug,            exact: false },
    { href: "/settings",     label: "Conta",               icon: Settings,        exact: false },
  ];

  const adminItems = [
    { href: "/admin/inspect", label: "Inspect", icon: Server },
    { href: "/admin/users", label: t("nav_users"), icon: Users },
    { href: "/admin/plans", label: t("nav_plans"), icon: CreditCard },
    { href: "/admin/payment-settings", label: "Pagamento", icon: Shield },
    { href: "/admin/proxy", label: "Proxy Global", icon: Globe },
  ];

  const closeMobile = () => setMobileOpen(false);

  const sidebarContent = (
    <aside className="w-56 flex flex-col h-full border-r shrink-0"
      style={{ background: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}>

      {/* Logo */}
      <div className="flex items-center justify-between px-4 h-14 border-b"
        style={{ borderColor: "var(--sidebar-border)" }}>
        <Logo height={38} />
        <button
          onClick={closeMobile}
          className="lg:hidden p-1 rounded-lg transition-colors"
          style={{ color: "var(--text-3)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Workspace info */}
      <div className="px-3 py-3 border-b" style={{ borderColor: "var(--sidebar-border)" }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(124,58,237,0.15)" }}>
            <Building2 className="w-4 h-4" style={{ color: "#a78bfa" }} />
          </div>
          <div className="flex-1 min-w-0">
            {workspaces.length > 1 ? (
              <div className="relative">
                <select
                  value={currentWorkspace?.id || ""}
                  onChange={(e) => {
                    const ws = workspaces.find(w => w.id === e.target.value);
                    if (ws) setCurrentWorkspace(ws);
                  }}
                  className="w-full appearance-none bg-transparent text-xs font-medium truncate pr-5 cursor-pointer"
                  style={{ color: "var(--text-1)" }}
                >
                  {workspaces.map(ws => (
                    <option key={ws.id} value={ws.id} style={{ background: "var(--surface-2)", color: "var(--text-1)" }}>{ws.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "var(--text-3)" }} />
              </div>
            ) : (
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                {currentWorkspace?.name || "Selecione workspace"}
              </p>
            )}
            {currentWorkspace?.is_owner ? (
              <p className="text-[10px]" style={{ color: "#fbbf24" }}>Proprietário</p>
            ) : currentWorkspace ? (
              <p className="text-[10px]" style={{ color: "hsl(240 8% 45%)" }}>Membro</p>
            ) : null}
          </div>
        </div>
        <button
          onClick={() => {
            router.push("/workspace");
          }}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all"
          style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.15)", color: "#a78bfa" }}
        >
          <Settings className="w-3 h-3" />
          Gerenciar workspaces
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} onClick={closeMobile}
              className={cn(
                "group relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                active ? "text-white" : "hover:opacity-80"
              )}
              style={active
                ? { background: "rgba(255,255,255,0.06)", color: "var(--text-1)",
                    boxShadow: "inset 1px 0 0 0 var(--green), inset 0 0 0 1px rgba(255,255,255,0.06)" }
                : { color: "var(--text-3)" }
              }
            >
              <item.icon className="w-4 h-4 flex-shrink-0 transition-colors"
                style={active ? { color: "var(--green)" } : undefined} />
              <span>{item.label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--green)", boxShadow: "0 0 6px var(--green)" }} />
              )}
            </Link>
          );
        })}

        {/* Admin */}
        {isAdmin && (
          <div className="pt-4">
            <div className="flex items-center gap-1.5 px-3 mb-1.5">
              <Shield className="w-3 h-3 text-amber-500/60" />
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                {t("nav_admin")}
              </p>
            </div>
            {adminItems.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} onClick={closeMobile}
                  className="group relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150"
                  style={active
                    ? { background: "rgba(255,255,255,0.06)", color: "var(--text-1)",
                        boxShadow: "inset 1px 0 0 0 var(--green), inset 0 0 0 1px rgba(255,255,255,0.06)" }
                    : { color: "var(--text-3)" }
                  }
                >
                  <item.icon className="w-4 h-4 flex-shrink-0"
                    style={active ? { color: "var(--green)" } : undefined} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      {/* Upgrade prompt for free plan */}
      {planName?.toLowerCase() === "free" && (
        <div className="px-2.5 pb-2 space-y-2">
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 38%)" }}>Mensagens hoje</span>
              <span className="text-[10px] font-mono" style={{ color: "hsl(240 8% 50%)" }}>—/100</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: "0%", background: "var(--green)" }} />
            </div>
          </div>
          <Link href="/plans" onClick={closeMobile}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.14)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.08)"; }}>
            <Zap className="w-3 h-3" />
            Fazer upgrade
          </Link>
        </div>
      )}
      {planName?.toLowerCase() !== "free" && !isAdmin && (
        <div className="px-2.5 pb-2">
          <Link href="/settings" onClick={closeMobile}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-all"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "hsl(240 8% 46%)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}>
            <CreditCard className="w-3 h-3" />
            Gerenciar plano
          </Link>
        </div>
      )}

      {/* User section */}
      <div className="p-2.5 border-t" style={{ borderColor: "var(--sidebar-border)" }}>
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl mb-0.5"
          style={{ background: "rgba(128,128,128,0.06)" }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.2), rgba(0,212,106,0.05))",
              boxShadow: "inset 0 0 0 1px rgba(0,212,106,0.2)",
              color: "var(--green)",
            }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate leading-tight" style={{ color: "var(--text-1)" }}>
              {session?.user?.name || "Usuário"}
              {session?.user?.is_beta && (
                <span className="ml-2 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  BETA
                </span>
              )}
            </p>
            <p className="text-[10px] truncate capitalize leading-tight mt-0.5" style={{ color: "var(--text-3)" }}>
              {planName}
            </p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs hover:text-red-400 hover:bg-red-500/[0.08] transition-all w-full"
          style={{ color: "var(--text-3)" }}
        >
          <LogOut className="w-3.5 h-3.5" />
          {t("nav_logout")}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Hamburger button — mobile/tablet only */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-40 p-2 rounded-xl transition-colors"
        style={{
          background: "var(--sidebar-bg)",
          border: "1px solid var(--sidebar-border)",
          color: "var(--text-2)",
        }}
        aria-label="Abrir menu"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex h-full">
        {sidebarContent}
      </div>

      {/* Mobile/tablet backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={closeMobile}
        />
      )}

      {/* Mobile/tablet drawer */}
      <div className={cn(
        "lg:hidden fixed inset-y-0 left-0 z-50 flex transition-transform duration-300 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {sidebarContent}
      </div>
    </>
  );
}
