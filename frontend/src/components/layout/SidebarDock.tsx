"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot, BookOpen, Contact, CreditCard, Headset, Layers, LayoutDashboard,
  LogOut, Megaphone, Menu, Plug, Search, Server, Settings, ShoppingBag,
  Smartphone, Sparkles, Users, Wand2, X, Shield,
} from "lucide-react";
import { usePreferences } from "@/lib/preferences";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { WorkspaceCustomizeDialog, resolveWorkspaceIcon } from "@/components/layout/WorkspaceCustomizeDialog";
import { conversationsApi } from "@/lib/api";
import { DockContainer, DockDivider, DockIcon } from "@/components/ui/dock";
import { motion, AnimatePresence } from "framer-motion";

// Width the dock takes in the layout (for margin/padding compensation).
export const DOCK_W = 64; // px

export function SidebarDock() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = usePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { currentWorkspace, setCurrentWorkspace } = useWorkspace();
  const { hasPerm, hasAnyPerm, isOwner, isSuperAdmin, isLoading: permsLoading } = useWorkspacePermissions();

  const isAdmin = isSuperAdmin;
  const isBeta = !!(session?.user?.is_beta) || isSuperAdmin;
  const optimistic = permsLoading || !currentWorkspace;

  const canSeeInbox     = optimistic || hasPerm(PERM.inboxView);
  const canSeeCRM       = optimistic || hasAnyPerm([PERM.crmView, PERM.companiesView, PERM.dealsView]);
  const canSeeDashboard = optimistic || hasPerm(PERM.dashboardView) || hasAnyPerm([PERM.ticketsView, PERM.inboxView]);
  const canSeeUniqAi    = optimistic || hasAnyPerm([PERM.uniqAiUse, PERM.agentsView]);
  const canSeeJourneys  = optimistic || hasAnyPerm([PERM.journeysView, PERM.journeysManage, PERM.agentsView]);
  const canSeeAgents    = optimistic || hasAnyPerm([PERM.agentsView, PERM.agentsManage]);
  const canSeeServers   = optimistic || hasAnyPerm([PERM.serversView, PERM.serversManage]);
  const canSeeInstances = optimistic || hasAnyPerm([PERM.instancesView, PERM.instancesCreate, PERM.instancesEdit]);
  const canSeeCampaigns = optimistic || hasPerm(PERM.campaignsView);
  const canSeeIntegrations = optimistic || hasAnyPerm([PERM.integrationsView, PERM.integrationsManage]);

  const { data: unreadData } = useQuery({
    queryKey: ["inbox-unread-count", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return { total: 0 };
      try {
        const res = await conversationsApi.list(currentWorkspace.id, { status: "open", limit: 1 });
        return res.data as { total?: number; items?: unknown[] };
      } catch { return { total: 0 }; }
    },
    enabled: !!currentWorkspace?.id,
    refetchInterval: 30000,
  });
  const unreadCount = (unreadData?.total ?? 0) as number;

  const wsColor = currentWorkspace?.color || "#7c3aed";
  const WsIcon  = resolveWorkspaceIcon(currentWorkspace?.icon);

  const initials = session?.user?.name?.[0]?.toUpperCase() || "U";
  const avatarGradient = (() => {
    const name = session?.user?.name || "U";
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 50) % 360} 75% 40%))`;
  })();

  // Sync CSS vars so Dynamic Island and content area know the dock width
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${DOCK_W}px`);
    document.documentElement.style.setProperty("--sidebar-w-offset", `${DOCK_W / 2}px`);
  }, []);

  function active(href: string, exact = false) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  }

  const navItems = [
    { href: "/uniq-ai",      label: "Uniq AI",                icon: Sparkles,       show: canSeeUniqAi },
    { href: "/dashboard",    label: t("nav_dashboard"),       icon: LayoutDashboard, show: canSeeDashboard },
    { href: "/inbox",        label: t("nav_inbox"),           icon: Headset,         show: canSeeInbox, badge: unreadCount > 0 ? unreadCount : undefined },
    { href: "/crm",          label: t("nav_crm"),             icon: Contact,         show: canSeeCRM },
    { href: "/campaigns",    label: t("nav_campaigns"),       icon: Megaphone,       show: isBeta && canSeeCampaigns },
    { href: "/journeys",     label: "Jornadas",               icon: Wand2,           show: isBeta && canSeeJourneys },
    { href: "/agents",       label: "Agentes",                icon: Bot,             show: canSeeAgents },
    { href: "/help-desk",    label: "Help Desk",              icon: BookOpen,        show: isBeta },
    { href: "/shops",        label: "Shops",                  icon: ShoppingBag,     show: true },
    { href: "/servers",      label: t("nav_servers"),         icon: Server,          show: canSeeServers },
    { href: "/instances",    label: t("nav_instances"),       icon: Smartphone,      show: canSeeInstances },
    { href: "/integrations", label: t("nav_integrations"),   icon: Plug,            show: canSeeIntegrations },
  ].filter((n) => n.show);

  const adminItems = [
    { href: "/admin/users",       label: t("nav_users"),  icon: Users },
    { href: "/admin/plans",       label: t("nav_plans"),  icon: CreditCard },
    { href: "/admin/providers",   label: "Providers",     icon: Layers },
    { href: "/admin/platform-ai", label: "Uniq AI Admin", icon: Sparkles },
    { href: "/admin/inspect",     label: "Inspect",       icon: Server },
  ];

  // ─── Desktop dock ───────────────────────────────────────────────────────────
  const DockContent = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
        padding: "0 8px",
        justifyContent: "space-between",
      }}
    >
      {/* Top: workspace icon */}
      <DockContainer>
        {/* Workspace button */}
        <button
          onClick={() => currentWorkspace && setCustomizeOpen(true)}
          title={currentWorkspace?.name || "Workspace"}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            background: `linear-gradient(135deg, ${wsColor}28, ${wsColor}10)`,
            border: `1px solid ${wsColor}38`,
            boxShadow: `0 0 18px ${wsColor}22`,
            cursor: "pointer",
            outline: "none",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          <WsIcon style={{ width: 16, height: 16, color: wsColor }} />
        </button>

        <DockDivider />

        {/* Search */}
        <DockIcon
          icon={Search}
          label="Buscar (⌘K)"
          onClick={() => window.dispatchEvent(new CustomEvent("uniq:cmd-k"))}
        />

        <DockDivider />

        {/* Nav items */}
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
            <DockIcon
              icon={item.icon}
              label={item.label}
              active={active(item.href)}
              badge={item.badge}
            />
          </Link>
        ))}

        <DockDivider />

        {/* Settings */}
        <Link href="/settings" style={{ textDecoration: "none" }}>
          <DockIcon icon={Settings} label={t("nav_settings")} active={active("/settings")} />
        </Link>

        {/* Admin */}
        {isAdmin && (
          <AdminSubDock
            items={adminItems}
            active={active}
          />
        )}

        <DockDivider />

        {/* User avatar */}
        <DockIcon
          icon={Settings}
          label={session?.user?.name || "Usuário"}
          onClick={() => router.push("/settings")}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 8,
              background: avatarGradient,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {initials}
          </div>
        </DockIcon>

        {/* Sign out */}
        <DockIcon
          icon={LogOut}
          label={t("nav_logout")}
          onClick={() => signOut({ callbackUrl: "/login" })}
          danger
        />
      </DockContainer>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-40 p-2 rounded-xl transition-colors"
        style={{
          background: "rgba(10,10,16,0.8)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.7)",
          backdropFilter: "blur(12px)",
        }}
        aria-label="Abrir menu"
      >
        <Menu style={{ width: 16, height: 16 }} />
      </button>

      {/* Desktop floating dock */}
      <div
        className="hidden lg:flex"
        style={{
          position: "fixed",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 40,
          flexDirection: "column",
        }}
      >
        {DockContent}
      </div>

      {/* Spacer so content doesn't go under the dock */}
      <div className="hidden lg:block" style={{ width: DOCK_W, flexShrink: 0 }} />

      {/* Mobile backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="lg:hidden fixed inset-y-0 left-0 z-50 flex flex-col"
            style={{
              width: 240,
              background: "rgba(10,10,16,0.96)",
              backdropFilter: "blur(24px)",
              borderRight: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "8px 0 32px rgba(0,0,0,0.4)",
            }}
          >
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 16px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: `linear-gradient(135deg, ${wsColor}28, ${wsColor}10)`,
                  border: `1px solid ${wsColor}38`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <WsIcon style={{ width: 14, height: 14, color: wsColor }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                  {currentWorkspace?.name || "Uniq"}
                </span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4 }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* Nav */}
            <nav style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
              {navItems.map((item) => {
                const isActive = active(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px", borderRadius: 10,
                      marginBottom: 2,
                      textDecoration: "none",
                      color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
                      background: isActive ? "rgba(0,212,106,0.12)" : "transparent",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <item.icon style={{
                      width: 16, height: 16, flexShrink: 0,
                      color: isActive ? "#00d46a" : "inherit",
                    }} />
                    <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 500 }}>
                      {item.label}
                    </span>
                    {item.badge ? (
                      <span style={{
                        marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 99,
                        background: "#00d46a", color: "#000", fontSize: 10,
                        fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                        padding: "0 4px",
                      }}>
                        {typeof item.badge === "number" && item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}

              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 4px" }} />

              <Link href="/settings" onClick={() => setMobileOpen(false)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                borderRadius: 10, textDecoration: "none",
                color: active("/settings") ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
                background: active("/settings") ? "rgba(0,212,106,0.12)" : "transparent",
              }}>
                <Settings style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{t("nav_settings")}</span>
              </Link>
            </nav>

            {/* User + logout */}
            <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", borderRadius: 10,
                background: "rgba(255,255,255,0.03)", marginBottom: 4,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: avatarGradient, color: "#fff", fontSize: 11,
                  fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session?.user?.name || "Usuário"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: 10, border: "none",
                  background: "transparent", cursor: "pointer",
                  color: "rgba(255,255,255,0.4)", fontSize: 13, transition: "all 0.15s ease",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.background = "rgba(248,113,113,0.07)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.background = "transparent"; }}
              >
                <LogOut style={{ width: 14, height: 14 }} />
                {t("nav_logout")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workspace customize dialog */}
      {customizeOpen && currentWorkspace && (
        <WorkspaceCustomizeDialog
          workspaceId={currentWorkspace.id}
          initialName={currentWorkspace.name}
          initialColor={currentWorkspace.color}
          initialIcon={currentWorkspace.icon}
          isOwner={!!currentWorkspace.is_owner}
          onClose={() => setCustomizeOpen(false)}
          onSaved={(next) => {
            setCurrentWorkspace({ ...currentWorkspace, name: next.name, color: next.color, icon: next.icon });
          }}
        />
      )}
    </>
  );
}

// ─── Admin sub-dock ───────────────────────────────────────────────────────────
function AdminSubDock({
  items,
  active,
}: {
  items: { href: string; label: string; icon: React.ElementType }[];
  active: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const router = useRouter();

  return (
    <div style={{ position: "relative" }}>
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setOpen((v) => !v)}
        aria-label="Admin"
        style={{
          width: 40, height: 40, borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid rgba(245,158,11,0.25)",
          background: hovered ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.06)",
          color: "rgba(245,158,11,0.8)",
          cursor: "pointer", outline: "none",
          transform: hovered ? "scale(1.07) translateX(2px)" : "scale(1)",
          transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <Shield style={{ width: 14, height: 14 }} strokeWidth={2} />
      </button>

      {/* Tooltip when closed */}
      {hovered && !open && (
        <div style={{
          position: "absolute", left: "calc(100% + 10px)", top: "50%",
          transform: "translateY(-50%)", pointerEvents: "none",
          whiteSpace: "nowrap", zIndex: 100,
        }}>
          <div style={{
            padding: "4px 10px", borderRadius: 8,
            background: "rgba(20,20,30,0.95)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.92)", fontSize: 11, fontWeight: 500,
          }}>
            Admin
            <span style={{
              position: "absolute", left: -5, top: "50%", transform: "translateY(-50%)",
              width: 0, height: 0,
              borderTop: "5px solid transparent", borderBottom: "5px solid transparent",
              borderRight: "5px solid rgba(20,20,30,0.95)",
            }} />
          </div>
        </div>
      )}

      {/* Sub-dock flyout */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -8, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute",
              left: "calc(100% + 10px)",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "10px 10px",
              borderRadius: 16,
              background: "rgba(10,10,16,0.95)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(245,158,11,0.20)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            }}
          >
            <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(245,158,11,0.6)", paddingLeft: 4, marginBottom: 4 }}>Admin</p>
            {items.map((item) => {
              const isActive = active(item.href);
              return (
                <button
                  key={item.href}
                  onClick={() => { router.push(item.href); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 10px", borderRadius: 8,
                    border: "none", cursor: "pointer",
                    background: isActive ? "rgba(0,212,106,0.12)" : "transparent",
                    color: isActive ? "#00d46a" : "rgba(255,255,255,0.65)",
                    fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <item.icon style={{ width: 14, height: 14, flexShrink: 0 }} />
                  {item.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
