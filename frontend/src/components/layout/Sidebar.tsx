"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard, Smartphone, Key, LogOut,
  Users, CreditCard, Shield, BookOpen, Contact, Megaphone, Server, Settings, Plug, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { Logo } from "@/components/Logo";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = usePreferences();
  const isAdmin = session?.user?.role === "admin";
  const planName = (session?.user?.plan as { name?: string } | undefined)?.name ?? session?.user?.role;
  const initials = session?.user?.name?.[0]?.toUpperCase() || "U";

  const navItems = [
    { href: "/dashboard",  label: t("nav_dashboard"),  icon: LayoutDashboard, exact: true },
    { href: "/servers",    label: t("nav_servers"),    icon: Server,           exact: false },
    { href: "/instances",  label: t("nav_instances"),  icon: Smartphone,       exact: false },
    { href: "/crm",        label: t("nav_crm"),        icon: Contact,          exact: false },
    { href: "/campaigns",     label: t("nav_campaigns"),     icon: Megaphone, exact: false },
    { href: "/integrations",  label: t("nav_integrations"),  icon: Plug,      exact: false },
    { href: "/api-keys",      label: t("nav_api_keys"),      icon: Key,       exact: false },
    { href: "/docs",       label: t("nav_api_docs"),   icon: BookOpen,         exact: false },
    { href: "/settings",   label: t("nav_settings"),   icon: Settings,         exact: false },
  ];

  const adminItems = [
    { href: "/admin/users",  label: t("nav_users"),  icon: Users },
    { href: "/admin/plans",  label: t("nav_plans"),  icon: CreditCard },
  ];

  return (
    <aside className="w-56 flex flex-col h-full border-r shrink-0"
      style={{ background: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}>

      {/* Logo */}
      <div className="flex items-center px-4 h-14 border-b"
        style={{ borderColor: "var(--sidebar-border)" }}>
        <Logo height={38} />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href}
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
                <Link key={item.href} href={item.href}
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

      {/* Upgrade prompt / usage for free plan */}
      {planName?.toLowerCase() === "free" && (
        <div className="px-2.5 pb-2 space-y-2">
          {/* Usage counter */}
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 38%)" }}>Mensagens hoje</span>
              <span className="text-[10px] font-mono" style={{ color: "hsl(240 8% 50%)" }}>—/100</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: "0%", background: "var(--green)" }} />
            </div>
          </div>
          {/* Upgrade button */}
          <Link href="/plans" className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.14)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,212,106,0.08)"; }}>
            <Zap className="w-3 h-3" />
            Fazer upgrade
          </Link>
        </div>
      )}
      {/* Upgrade button for non-free non-admin paid users */}
      {planName?.toLowerCase() !== "free" && planName?.toLowerCase() !== "admin" && !isAdmin && (
        <div className="px-2.5 pb-2">
          <Link href="/settings" className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-all"
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
}
