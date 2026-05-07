"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot, BookOpen, Building2, ChevronDown, ChevronRight, Contact, CreditCard,
  Headset, Layers, LayoutDashboard, LogOut, Megaphone, Menu, Plug,
  Search, Server, Settings, Shield, ShoppingBag, Smartphone,
  Sparkles, Users, Wand2, X, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePreferences } from "@/lib/preferences";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { WorkspaceCustomizeDialog, resolveWorkspaceIcon } from "@/components/layout/WorkspaceCustomizeDialog";
import { conversationsApi } from "@/lib/api";

// ─── Layout constants ─────────────────────────────────────────────────────────
const DOCK_W_COLLAPSED = 64;   // px — icon-only mode
const DOCK_W_EXPANDED  = 220;  // px — icon + label mode
const LS_KEY = "uniq-dock-expanded";

// ─── Design tokens (inline, dark theme) ──────────────────────────────────────
const C = {
  bg:       "rgba(10,10,17,0.88)",
  border:   "rgba(255,255,255,0.07)",
  text1:    "rgba(255,255,255,0.88)",
  text2:    "rgba(255,255,255,0.55)",
  text3:    "rgba(255,255,255,0.28)",
  active:   "#00d46a",
  activeB:  "rgba(0,212,106,0.14)",
  hover:    "rgba(255,255,255,0.07)",
  amber:    "rgba(245,158,11,0.75)",
  amberB:   "rgba(245,158,11,0.08)",
  red:      "#f87171",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function NavLink({
  href,
  icon: Icon,
  label,
  badge,
  isActive,
  expanded,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: number | string;
  isActive: boolean;
  expanded: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const showTip = !expanded && hovered;

  return (
    <div style={{ position: "relative" }}>
      <Link
        href={href}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: expanded ? 10 : 0,
          padding: expanded ? "8px 10px" : "0",
          width: expanded ? "100%" : 40,
          height: 40,
          borderRadius: 11,
          justifyContent: expanded ? "flex-start" : "center",
          textDecoration: "none",
          flexShrink: 0,
          background: isActive ? C.activeB : hovered ? C.hover : "transparent",
          border: isActive ? `1px solid rgba(0,212,106,0.28)` : "1px solid transparent",
          boxShadow: isActive ? "0 0 14px rgba(0,212,106,0.18)" : "none",
          color: isActive ? C.active : hovered ? C.text1 : C.text2,
          transition: "all 0.18s cubic-bezier(0.34,1.2,0.64,1)",
          transform: hovered && !expanded ? "scale(1.07) translateX(2px)" : "scale(1)",
        }}
      >
        {/* Icon wrapper */}
        <span style={{
          width: 22, height: 22,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, position: "relative",
          borderRadius: 7,
          background: isActive ? "rgba(0,212,106,0.18)" : "transparent",
        }}>
          <Icon style={{ width: 15, height: 15 }} strokeWidth={isActive ? 2.2 : 1.8} />
          {/* Badge dot when collapsed */}
          {!expanded && badge != null && (
            <span style={{
              position: "absolute", top: -3, right: -3,
              minWidth: 14, height: 14, borderRadius: 99,
              background: C.active, color: "#000",
              fontSize: 8, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 2px",
            }}>
              {typeof badge === "number" && badge > 99 ? "99+" : badge}
            </span>
          )}
        </span>

        {/* Label — only when expanded */}
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                overflow: "hidden", whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Badge pill when expanded */}
        {expanded && badge != null && (
          <span style={{
            marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 99,
            background: C.active, color: "#000", fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 4px", flexShrink: 0,
          }}>
            {typeof badge === "number" && badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>

      {/* Tooltip when collapsed */}
      <AnimatePresence>
        {showTip && (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.13 }}
            style={{
              position: "absolute", left: "calc(100% + 12px)", top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none", whiteSpace: "nowrap", zIndex: 200,
            }}
          >
            <div style={{
              padding: "4px 10px", borderRadius: 8,
              background: "rgba(16,16,24,0.97)",
              border: `1px solid ${C.border}`,
              color: C.text1, fontSize: 11, fontWeight: 500,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}>
              {label}
              {badge != null && (
                <span style={{ marginLeft: 6, color: C.active }}>{badge}</span>
              )}
              <span style={{
                position: "absolute", left: -4, top: "50%", transform: "translateY(-50%)",
                width: 0, height: 0,
                borderTop: "4px solid transparent", borderBottom: "4px solid transparent",
                borderRight: "4px solid rgba(16,16,24,0.97)",
              }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SidebarDock() {
  const pathname  = usePathname();
  const router    = useRouter();
  const { data: session } = useSession();
  const { t }     = usePreferences();

  const [mobileOpen,    setMobileOpen]    = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // userExpanded é a preferência persistida (clique no botão recolher).
  // hoverExpanded é o estado transient do mouse-over: quando o usuário
  // passa o mouse no dock recolhido, expande temporariamente como um
  // dock real do macOS — voltando ao estado salvo quando o mouse sai.
  const [userExpanded, setUserExpanded] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const expanded = userExpanded || hoverExpanded;
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Persist expand state
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === "true") setUserExpanded(true);
  }, []);
  const toggleExpanded = () => {
    setUserExpanded((v) => {
      localStorage.setItem(LS_KEY, (!v).toString());
      return !v;
    });
  };

  // Pequeno delay no exit pra evitar flicker quando o cursor passa por
  // gaps entre items. Entrada é instantânea pra UX responsiva.
  const handleDockEnter = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverExpanded(true);
  };
  const handleDockLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoverExpanded(false);
      hoverTimerRef.current = null;
    }, 180);
  };
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Sync CSS vars so Dynamic Island + content area align correctly. Usa
  // userExpanded (não o effective expanded) pelo mesmo motivo do spacer:
  // hover não pode causar reflow do conteúdo.
  useEffect(() => {
    const w = userExpanded ? DOCK_W_EXPANDED : DOCK_W_COLLAPSED;
    document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
    document.documentElement.style.setProperty("--sidebar-w-offset", `${w / 2}px`);
  }, [userExpanded]);

  const { currentWorkspace, setCurrentWorkspace, workspaces } = useWorkspace();
  const { hasPerm, hasAnyPerm, isSuperAdmin, isLoading: permsLoading } = useWorkspacePermissions();

  const isAdmin  = isSuperAdmin;
  const isBeta   = !!(session?.user?.is_beta) || isSuperAdmin;
  const optimistic = permsLoading || !currentWorkspace;
  const planName = (session?.user?.plan as { name?: string } | undefined)?.name ?? session?.user?.role;
  // Mesma política da Sidebar: undefined = libera (compat com sessions
  // antigas), false explícito = esconde, super-admin/beta bypassam.
  const plan = (session?.user?.plan ?? {}) as Record<string, boolean | undefined>;
  const planAllows = (key: string) => {
    if (isSuperAdmin || isBeta) return true;
    const v = plan[key];
    return v !== false;
  };

  const canSeeInbox        = optimistic || hasPerm(PERM.inboxView);
  const canSeeCRM          = optimistic || hasAnyPerm([PERM.crmView, PERM.companiesView, PERM.dealsView]);
  const canSeeDashboard    = optimistic || hasPerm(PERM.dashboardView) || hasAnyPerm([PERM.ticketsView, PERM.inboxView]);
  const canSeeUniqAi       = optimistic || hasAnyPerm([PERM.uniqAiUse, PERM.agentsView]);
  const canSeeJourneys     = optimistic || hasAnyPerm([PERM.journeysView, PERM.journeysManage, PERM.agentsView]);
  const canSeeAgents       = optimistic || hasAnyPerm([PERM.agentsView, PERM.agentsManage]);
  const canSeeServers      = optimistic || hasAnyPerm([PERM.serversView, PERM.serversManage]);
  const canSeeInstances    = optimistic || hasAnyPerm([PERM.instancesView, PERM.instancesCreate, PERM.instancesEdit]);
  const canSeeCampaigns    = optimistic || hasPerm(PERM.campaignsView);
  const canSeeIntegrations = optimistic || hasAnyPerm([PERM.integrationsView, PERM.integrationsManage]);
  const canSeeBilling      = optimistic || hasAnyPerm([PERM.billingView, PERM.billingManage]);

  const { data: unreadData } = useQuery({
    queryKey: ["inbox-unread-count", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return { total: 0 };
      try {
        const res = await conversationsApi.list(currentWorkspace.id, { status: "open", limit: 1 });
        return res.data as { total?: number };
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

  function isActive(href: string, exact = false) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  }

  const navItems = [
    // Mesma política do Sidebar: só Campaigns/Journeys/Help Desk
    // ganham gate de plano (eram bloqueados por isBeta antes). Os
    // demais ficam perm-only pra não esconder de plano pago cujo
    // session.user.plan não traz allow_* preenchido.
    { href: "/uniq-ai",      label: "Uniq AI",              icon: Sparkles,       show: canSeeUniqAi },
    { href: "/dashboard",    label: t("nav_dashboard"),     icon: LayoutDashboard, show: canSeeDashboard },
    { href: "/inbox",        label: t("nav_inbox"),         icon: Headset,         show: canSeeInbox, badge: unreadCount > 0 ? unreadCount : undefined },
    { href: "/crm",          label: t("nav_crm"),           icon: Contact,         show: canSeeCRM },
    { href: "/campaigns",    label: t("nav_campaigns"),     icon: Megaphone,       show: canSeeCampaigns && planAllows("allow_campaigns") },
    { href: "/journeys",     label: "Jornadas",             icon: Wand2,           show: canSeeJourneys && planAllows("allow_journeys") },
    { href: "/agents",       label: "Agentes",              icon: Bot,             show: canSeeAgents },
    { href: "/help-desk",    label: "Help Desk",            icon: BookOpen,        show: planAllows("allow_helpdesk") },
    { href: "/shops",        label: "Shops",                icon: ShoppingBag,     show: true },
    { href: "/servers",      label: t("nav_servers"),       icon: Server,          show: canSeeServers },
    { href: "/instances",    label: t("nav_instances"),     icon: Smartphone,      show: canSeeInstances },
    { href: "/integrations", label: t("nav_integrations"),  icon: Plug,            show: canSeeIntegrations },
    { href: "/workspace",    label: "Workspace",            icon: Building2,       show: !!currentWorkspace },
    { href: "/settings",     label: t("nav_settings"),      icon: Settings,        show: true },
  ].filter((n) => n.show);

  const adminItems = [
    { href: "/admin/users",       label: t("nav_users"),  icon: Users },
    { href: "/admin/plans",       label: t("nav_plans"),  icon: CreditCard },
    { href: "/admin/providers",   label: "Providers",     icon: Layers },
    // Uniq AI vive como aba dentro de /admin/providers (?tab=ai)
    { href: "/admin/inspect",     label: "Inspect",       icon: Server },
  ];

  // ─── Desktop dock content ──────────────────────────────────────────────────
  // dockW = largura visual atual (responde a hover + clique).
  // spacerW = largura do espaçador que empurra o conteúdo. Mantém só o que
  // o usuário escolheu — assim o hover não causa layout shift do conteúdo
  // (o dock é position:fixed; o spacer não precisa acompanhar o hover).
  const dockW = expanded ? DOCK_W_EXPANDED : DOCK_W_COLLAPSED;
  const spacerW = userExpanded ? DOCK_W_EXPANDED : DOCK_W_COLLAPSED;

  const DesktopDock = (
    <motion.div
      onMouseEnter={handleDockEnter}
      onMouseLeave={handleDockLeave}
      animate={{ width: dockW }}
      transition={{ type: "spring", damping: 26, stiffness: 280 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        borderRadius: 20,
        background: C.bg,
        backdropFilter: "blur(28px) saturate(200%)",
        WebkitBackdropFilter: "blur(28px) saturate(200%)",
        border: `1px solid ${C.border}`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
        overflow: "hidden",
        padding: "10px 10px 8px",
        gap: 0,
        maxHeight: "calc(100vh - 32px)",
      }}
    >
      {/* ── Workspace area ── */}
      <WorkspaceSection
        wsColor={wsColor}
        WsIcon={WsIcon}
        currentWorkspace={currentWorkspace}
        workspaces={workspaces}
        expanded={expanded}
        onSetCurrentWorkspace={setCurrentWorkspace}
        onCustomize={() => setCustomizeOpen(true)}
        onManage={() => router.push("/workspace")}
      />

      <Divider />

      {/* ── Search ── */}
      <div style={{ width: "100%", marginBottom: 2 }}>
        <ActionRow
          icon={Search}
          label="Buscar (⌘K)"
          expanded={expanded}
          onClick={() => window.dispatchEvent(new CustomEvent("uniq:cmd-k"))}
        />
      </div>

      <Divider />

      {/* ── Nav items ── */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 2,
        flex: 1, overflowY: "auto", width: "100%",
        scrollbarWidth: "none",
      }}>
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            badge={item.badge}
            isActive={isActive(item.href)}
            expanded={expanded}
          />
        ))}

        {/* Admin section */}
        {isAdmin && (
          <>
            <Divider />
            {expanded && (
              <p style={{
                fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.1em", color: C.amber,
                padding: "4px 6px 2px", marginTop: 2,
              }}>
                Admin
              </p>
            )}
            {adminItems.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                isActive={isActive(item.href)}
                expanded={expanded}
              />
            ))}
          </>
        )}
      </div>

      <Divider />

      {/* ── Upgrade (free plan) ── */}
      {canSeeBilling && planName?.toLowerCase() === "free" && (
        <div style={{ width: "100%", marginBottom: 2 }}>
          <ActionRow
            icon={Zap}
            label="Fazer upgrade"
            expanded={expanded}
            onClick={() => router.push("/settings?section=billing")}
            color="#00d46a"
          />
        </div>
      )}

      {/* ── User area ── */}
      <UserSection
        initials={initials}
        avatarGradient={avatarGradient}
        name={session?.user?.name}
        planName={planName}
        isBeta={!!session?.user?.is_beta}
        expanded={expanded}
        onSettings={() => router.push("/settings")}
        onLogout={() => signOut({ callbackUrl: "/login" })}
        logoutLabel={t("nav_logout")}
      />

      {/* ── Expand/collapse toggle ── */}
      <button
        onClick={toggleExpanded}
        title={expanded ? "Recolher menu" : "Expandir menu"}
        style={{
          marginTop: 6,
          width: expanded ? "100%" : 40,
          height: 28,
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
          gap: expanded ? 8 : 0,
          padding: expanded ? "0 10px" : "0",
          border: "none",
          background: "transparent",
          color: C.text3,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 500,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = C.hover;
          e.currentTarget.style.color = C.text2;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = C.text3;
        }}
      >
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.25 }}
        >
          <ChevronRight style={{ width: 13, height: 13 }} />
        </motion.div>
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden", whiteSpace: "nowrap" }}
            >
              Recolher
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-40 p-2 rounded-xl"
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          color: C.text2,
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
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 40,
        }}
      >
        {DesktopDock}
      </div>

      {/* Spacer so content doesn't overlap the dock. Mantém a largura do
          estado SAVED (userExpanded) — não acompanha hover, pra não fazer
          a UI inteira mexer enquanto o dock expande temporariamente. */}
      <motion.div
        className="hidden lg:block"
        animate={{ width: spacerW + 20 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        style={{ flexShrink: 0 }}
      />

      {/* Mobile backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
            className="lg:hidden fixed top-0 left-0 z-50"
            style={{
              // 100dvh respeita a barra do browser mobile (Chrome/Safari) —
              // inset-y-0 ou 100vh deixavam o rodapé do drawer (logout +
              // avatar) coberto pela URL bar. Combina com safe-area no
              // padding interno pra também respeitar a home indicator do
              // iOS quando está com a barra estática.
              height: "100dvh",
              width: 240,
              background: C.bg,
              backdropFilter: "blur(24px)",
              borderRight: `1px solid ${C.border}`,
              boxShadow: "8px 0 32px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <MobileDrawer
              navItems={navItems}
              adminItems={adminItems}
              isAdmin={isAdmin}
              pathname={pathname}
              wsColor={wsColor}
              WsIcon={WsIcon}
              currentWorkspace={currentWorkspace}
              workspaces={workspaces}
              initials={initials}
              avatarGradient={avatarGradient}
              session={session}
              planName={planName}
              onSetCurrentWorkspace={setCurrentWorkspace}
              onClose={() => setMobileOpen(false)}
              logoutLabel={t("nav_logout")}
            />
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
          onSaved={(next) =>
            setCurrentWorkspace({ ...currentWorkspace, name: next.name, color: next.color, icon: next.icon })
          }
        />
      )}
    </>
  );
}

// ─── Workspace section ────────────────────────────────────────────────────────

function WorkspaceSection({
  wsColor, WsIcon, currentWorkspace, workspaces, expanded,
  onSetCurrentWorkspace, onCustomize, onManage,
}: {
  wsColor: string;
  WsIcon: React.ElementType;
  currentWorkspace: any;
  workspaces: any[];
  expanded: boolean;
  onSetCurrentWorkspace: (ws: any) => void;
  onCustomize: () => void;
  onManage: () => void;
}) {
  const [wsOpen, setWsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wsOpen) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setWsOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [wsOpen]);

  return (
    <div ref={ref} style={{ width: "100%", marginBottom: 2, position: "relative" }}>
      {expanded ? (
        /* Expanded: full row with name, role, dropdown chevron */
        <button
          onClick={() => workspaces.length > 1 ? setWsOpen((v) => !v) : onCustomize()}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "8px 8px", borderRadius: 11,
            border: "none", background: "transparent", cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            background: `linear-gradient(135deg, ${wsColor}30, ${wsColor}12)`,
            border: `1px solid ${wsColor}38`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <WsIcon style={{ width: 14, height: 14, color: wsColor }} />
          </span>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <p style={{
              fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.88)",
              margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {currentWorkspace?.name || "Workspace"}
            </p>
            <p style={{ fontSize: 10, color: currentWorkspace?.is_owner ? "#fbbf24" : C.text3, margin: 0 }}>
              {currentWorkspace?.is_owner ? "Proprietário" : "Membro"}
            </p>
          </div>
          {workspaces.length > 1 && (
            <ChevronDown style={{ width: 12, height: 12, color: C.text3, flexShrink: 0 }} />
          )}
        </button>
      ) : (
        /* Collapsed: just icon, click to customize */
        <button
          onClick={() => workspaces.length > 1 ? setWsOpen((v) => !v) : onCustomize()}
          title={currentWorkspace?.name || "Workspace"}
          style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: `linear-gradient(135deg, ${wsColor}28, ${wsColor}10)`,
            border: `1px solid ${wsColor}38`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", outline: "none",
            transition: "all 0.18s cubic-bezier(0.34,1.56,0.64,1)",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.07) translateX(2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1) translateX(0)"; }}
        >
          <WsIcon style={{ width: 16, height: 16, color: wsColor }} />
        </button>
      )}

      {/* Workspace dropdown */}
      <AnimatePresence>
        {wsOpen && workspaces.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            style={{
              position: "absolute",
              left: expanded ? 0 : "calc(100% + 12px)",
              top: expanded ? "calc(100% + 4px)" : "0",
              zIndex: 200,
              minWidth: 200,
              borderRadius: 14,
              background: "rgba(12,12,20,0.97)",
              border: `1px solid ${C.border}`,
              boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
              backdropFilter: "blur(20px)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "6px 6px" }}>
              {workspaces.map((ws) => {
                const Icon = resolveWorkspaceIcon(ws.icon);
                const isCurrent = ws.id === currentWorkspace?.id;
                return (
                  <button
                    key={ws.id}
                    onClick={() => { onSetCurrentWorkspace(ws); setWsOpen(false); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", borderRadius: 10,
                      border: "none", cursor: "pointer",
                      background: isCurrent ? "rgba(0,212,106,0.10)" : "transparent",
                      color: isCurrent ? C.active : C.text1,
                      fontSize: 13, fontWeight: 500, textAlign: "left",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{
                      width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                      background: `${ws.color || "#7c3aed"}22`,
                      border: `1px solid ${ws.color || "#7c3aed"}40`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon style={{ width: 12, height: 12, color: ws.color || "#7c3aed" }} />
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ws.name}
                    </span>
                    {isCurrent && <span style={{ color: C.active, fontSize: 12 }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <div style={{ height: 1, background: C.border, margin: "0 6px" }} />
            <div style={{ padding: "4px 6px 6px" }}>
              <button
                onClick={() => { onManage(); setWsOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 9, border: "none", cursor: "pointer",
                  background: "transparent", color: C.text2, fontSize: 12, fontWeight: 500,
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <Settings style={{ width: 12, height: 12 }} />
                Gerenciar workspaces
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── User section ─────────────────────────────────────────────────────────────

function UserSection({
  initials, avatarGradient, name, planName, isBeta, expanded,
  onSettings, onLogout, logoutLabel,
}: {
  initials: string;
  avatarGradient: string;
  name?: string | null;
  planName?: string;
  isBeta: boolean;
  expanded: boolean;
  onSettings: () => void;
  onLogout: () => void;
  logoutLabel: string;
}) {
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        onClick={onSettings}
        style={{
          width: expanded ? "100%" : 40,
          height: 40,
          borderRadius: 11,
          display: "flex",
          alignItems: "center",
          gap: expanded ? 8 : 0,
          justifyContent: expanded ? "flex-start" : "center",
          padding: expanded ? "0 8px" : "0",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          transition: "all 0.18s cubic-bezier(0.34,1.2,0.64,1)",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = C.hover; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 9, flexShrink: 0,
          background: avatarGradient, color: "#fff",
          fontSize: 11, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {initials}
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden", whiteSpace: "nowrap", textAlign: "left" }}
            >
              <p style={{ fontSize: 12, fontWeight: 600, color: C.text1, margin: 0, lineHeight: 1.3 }}>
                {name || "Usuário"}
                {isBeta && (
                  <span style={{
                    marginLeft: 6, padding: "1px 5px", borderRadius: 4,
                    fontSize: 8, fontWeight: 700, background: "rgba(139,92,246,0.2)",
                    color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)",
                  }}>BETA</span>
                )}
              </p>
              <p style={{ fontSize: 10, color: C.text3, margin: 0, textTransform: "capitalize" }}>
                {planName}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      <button
        onClick={onLogout}
        style={{
          width: expanded ? "100%" : 40,
          height: 34,
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          gap: expanded ? 8 : 0,
          justifyContent: expanded ? "flex-start" : "center",
          padding: expanded ? "0 10px" : "0",
          border: "none",
          background: "transparent",
          color: C.text3,
          cursor: "pointer",
          fontSize: 12,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = C.red;
          e.currentTarget.style.background = "rgba(248,113,113,0.07)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = C.text3;
          e.currentTarget.style.background = "transparent";
        }}
      >
        <LogOut style={{ width: 13, height: 13, flexShrink: 0 }} />
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden", whiteSpace: "nowrap" }}
            >
              {logoutLabel}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}

// ─── Action row (search, upgrade) ────────────────────────────────────────────

function ActionRow({
  icon: Icon, label, expanded, onClick, color,
}: {
  icon: React.ElementType; label: string; expanded: boolean;
  onClick: () => void; color?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const showTip = !expanded && hovered;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: expanded ? "100%" : 40, height: 36, borderRadius: 10,
          display: "flex", alignItems: "center",
          gap: expanded ? 8 : 0,
          justifyContent: expanded ? "flex-start" : "center",
          padding: expanded ? "0 10px" : "0",
          border: "none",
          background: hovered ? (color ? `${color}14` : C.hover) : "transparent",
          color: color ? (hovered ? color : `${color}99`) : (hovered ? C.text1 : C.text2),
          cursor: "pointer", fontSize: 12, fontWeight: 500,
          transition: "all 0.15s ease",
        }}
      >
        <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden", whiteSpace: "nowrap" }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Tooltip when collapsed */}
      <AnimatePresence>
        {showTip && (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.13 }}
            style={{
              position: "absolute", left: "calc(100% + 12px)", top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none", whiteSpace: "nowrap", zIndex: 200,
            }}
          >
            <div style={{
              padding: "4px 10px", borderRadius: 8,
              background: "rgba(16,16,24,0.97)", border: `1px solid ${C.border}`,
              color: C.text1, fontSize: 11, fontWeight: 500,
            }}>
              {label}
              <span style={{
                position: "absolute", left: -4, top: "50%", transform: "translateY(-50%)",
                width: 0, height: 0,
                borderTop: "4px solid transparent", borderBottom: "4px solid transparent",
                borderRight: "4px solid rgba(16,16,24,0.97)",
              }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <div style={{
      width: "85%", height: 1,
      background: `linear-gradient(90deg, transparent, ${C.border}, transparent)`,
      margin: "4px 0",
      flexShrink: 0,
    }} />
  );
}

// ─── Mobile drawer ────────────────────────────────────────────────────────────

function MobileDrawer({
  navItems, adminItems, isAdmin, pathname, wsColor, WsIcon,
  currentWorkspace, workspaces, initials, avatarGradient, session,
  planName, onSetCurrentWorkspace, onClose, logoutLabel,
}: {
  navItems: any[];
  adminItems: any[];
  isAdmin: boolean;
  pathname: string;
  wsColor: string;
  WsIcon: React.ElementType;
  currentWorkspace: any;
  workspaces: any[];
  initials: string;
  avatarGradient: string;
  session: any;
  planName?: string;
  onSetCurrentWorkspace: (ws: any) => void;
  onClose: () => void;
  logoutLabel: string;
}) {
  const router = useRouter();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 16px 12px",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg, ${wsColor}28, ${wsColor}10)`,
            border: `1px solid ${wsColor}38`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <WsIcon style={{ width: 14, height: 14, color: wsColor }} />
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.text1, margin: 0 }}>
              {currentWorkspace?.name || "Uniq"}
            </p>
            <p style={{ fontSize: 10, color: currentWorkspace?.is_owner ? "#fbbf24" : C.text3, margin: 0 }}>
              {currentWorkspace?.is_owner ? "Proprietário" : "Membro"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4 }}
        >
          <X style={{ width: 16, height: 16 }} />
        </button>
      </div>

      {/* Workspace switcher */}
      {workspaces.length > 1 && (
        <div style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}` }}>
          {workspaces.map((ws) => {
            const Icon = resolveWorkspaceIcon(ws.icon);
            const isCurrent = ws.id === currentWorkspace?.id;
            return (
              <button
                key={ws.id}
                onClick={() => { onSetCurrentWorkspace(ws); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 9, border: "none", cursor: "pointer",
                  background: isCurrent ? "rgba(0,212,106,0.10)" : "transparent",
                  color: isCurrent ? C.active : C.text2,
                  fontSize: 12, fontWeight: 500,
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: `${ws.color || "#7c3aed"}22`, border: `1px solid ${ws.color || "#7c3aed"}40`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon style={{ width: 10, height: 10, color: ws.color || "#7c3aed" }} />
                </span>
                {ws.name}
                {isCurrent && <span style={{ marginLeft: "auto", color: C.active, fontSize: 11 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 10px", borderRadius: 10, marginBottom: 2,
                textDecoration: "none",
                color: active ? C.text1 : C.text2,
                background: active ? C.activeB : "transparent",
                fontSize: 13, fontWeight: active ? 600 : 500,
              }}
            >
              <item.icon style={{ width: 16, height: 16, color: active ? C.active : "inherit", flexShrink: 0 }} />
              {item.label}
              {item.badge != null && (
                <span style={{
                  marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 99,
                  background: C.active, color: "#000", fontSize: 9, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                }}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div style={{ height: 1, background: C.border, margin: "8px 4px" }} />
            <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.amber, padding: "2px 10px 4px" }}>Admin</p>
            {adminItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", borderRadius: 10, marginBottom: 2,
                    textDecoration: "none",
                    color: active ? C.text1 : C.text2,
                    background: active ? C.activeB : "transparent",
                    fontSize: 13, fontWeight: active ? 600 : 500,
                  }}
                >
                  <item.icon style={{ width: 15, height: 15, color: active ? C.active : C.amber, flexShrink: 0 }} />
                  {item.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User footer */}
      <div style={{ padding: "8px 8px 12px", borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={() => { router.push("/settings"); onClose(); }}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: 10, border: "none",
            background: "rgba(255,255,255,0.03)", cursor: "pointer", marginBottom: 4,
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: avatarGradient, color: "#fff", fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: C.text1, margin: 0 }}>
              {session?.user?.name || "Usuário"}
            </p>
            <p style={{ fontSize: 10, color: C.text3, margin: 0, textTransform: "capitalize" }}>{planName}</p>
          </div>
        </button>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 10, border: "none",
            background: "transparent", cursor: "pointer",
            color: C.text3, fontSize: 12, fontWeight: 500,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.red; e.currentTarget.style.background = "rgba(248,113,113,0.07)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.text3; e.currentTarget.style.background = "transparent"; }}
        >
          <LogOut style={{ width: 14, height: 14 }} />
          {logoutLabel}
        </button>
      </div>
    </>
  );
}
