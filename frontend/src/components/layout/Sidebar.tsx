"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BookOpen, Bot, Building2, Calendar, ChevronDown, ChevronLeft, ChevronRight, Contact,
  CreditCard, Globe, Hash, HelpCircle, Home,
  Info, KanbanSquare, Layers, LayoutDashboard, Link2, List, Loader2, LogOut,
  Mail, MapPin, Megaphone, Menu, MessageSquare, Minus, MoreHorizontal,
  MoreVertical, Phone, Plug, Plus, Search, Send, Settings, Shield, Smartphone,
  Smile, Sparkles, Star, Tag, Trash2, Users, Wand2, X, Zap, StickyNote,
  Wrench, ExternalLink, Server, Headset, ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { Logo } from "@/components/Logo";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { WorkspaceCustomizeDialog, resolveWorkspaceIcon } from "@/components/layout/WorkspaceCustomizeDialog";
import { conversationsApi } from "@/lib/api";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = usePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Collapsed state — persistido em localStorage. Sidebar fica w-14 (só
  // ícones), centro do conteúdo passa a coincidir com viewport.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("uniq-sidebar-collapsed") : null;
    if (saved === "true") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("uniq-sidebar-collapsed", collapsed ? "true" : "false");
    // CSS vars pra outros componentes lerem (Dynamic Island, etc.):
    // --sidebar-w-offset = metade da largura, usada pra centralizar
    // a Dynamic Island no content area. Em mobile zeramos via JS quando
    // viewport < lg breakpoint (sidebar vira drawer, fora do flow).
    const isLg = window.matchMedia("(min-width: 1024px)").matches;
    const half = isLg ? (collapsed ? "1.75rem" : "7rem") : "0px";
    document.documentElement.style.setProperty("--sidebar-w", collapsed ? "3.5rem" : "14rem");
    document.documentElement.style.setProperty("--sidebar-w-offset", half);
  }, [collapsed]);

  // Re-set offset quando viewport muda (mobile <-> desktop).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      const half = mq.matches ? (collapsed ? "1.75rem" : "7rem") : "0px";
      document.documentElement.style.setProperty("--sidebar-w-offset", half);
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [collapsed]);
  const { currentWorkspace, setCurrentWorkspace, workspaces } = useWorkspace();

  const { data: unreadData } = useQuery({
    queryKey: ["inbox-unread-count", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return { total: 0 };
      try {
        const res = await conversationsApi.list(currentWorkspace.id, { status: "open", limit: 1 });
        return res.data as { total?: number; items?: unknown[] };
      } catch {
        return { total: 0 };
      }
    },
    enabled: !!currentWorkspace?.id,
    refetchInterval: 30000,
  });
  const unreadCount = (unreadData?.total ?? 0) as number;

  // Cor + ícone do workspace atual (com fallbacks). Defaults:
  // roxo (#7c3aed) e Building2 — aplicados quando o user ainda
  // não personalizou. Mudanças locais via dialog dão feedback
  // imediato (sem esperar refetch de workspaces).
  const wsColor = currentWorkspace?.color || "#7c3aed";
  const WsIcon = resolveWorkspaceIcon(currentWorkspace?.icon);
  const { hasPerm, hasAnyPerm, isOwner, isSuperAdmin, isLoading: permsLoading } = useWorkspacePermissions();
  const isAdmin = isSuperAdmin;
  const isBeta = !!(session?.user?.is_beta) || isSuperAdmin;
  const planName = (session?.user?.plan as { name?: string } | undefined)?.name ?? session?.user?.role;
  // Flags do plano (allow_*) — gate primário pra módulos pagos. Antes a
  // sidebar usava só `isBeta` e perm, então plano Business com
  // allow_campaigns=true não via Campanhas porque não tinha is_beta.
  // Super-admin e isBeta seguem como bypass pra QA / staff.
  // Política de fallback: se a flag NÃO veio no payload (undefined),
  // assumimos true — evita esconder módulos pra usuários antigos cujo
  // session ainda não tem o objeto plan completo. Só esconde quando
  // o flag chega EXPLICITAMENTE false.
  const plan = (session?.user?.plan ?? {}) as Record<string, boolean | undefined>;
  const planAllows = (key: string) => {
    if (isSuperAdmin || isBeta) return true;
    const v = plan[key];
    return v !== false;
  };
  const initials = session?.user?.name?.[0]?.toUpperCase() || "U";

  // Gradiente dinâmico de avatar baseado no nome — cada usuário tem sua cor
  const avatarGradient = (() => {
    const name = session?.user?.name || "U";
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 50) % 360} 75% 40%))`;
  })();

  // Itens ficam todos listados com a regra `show` — `true` = sempre visível;
  // função = visível quando a condição bate. Dono do workspace e super-admin
  // bypassam qualquer regra (via hasPerm retornando true no isOwner).
  type NavItem = {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
    exact: boolean;
    show: boolean;
  };

  // ENQUANTO as permissions estão carregando OU não temos workspace ainda,
  // mostramos TODOS os itens (otimista). Sem isso, o sidebar nasce vazio
  // pro owner também — `isOwner` só vira true depois que a query do role
  // resolve. Cada página alvo já valida perm individualmente, então o
  // flash visual é aceitável.
  const optimistic = permsLoading || !currentWorkspace;

  // Cada módulo é gateado por uma permission key. `hasPerm` retorna true
  // automaticamente pra owner e super-admin (lógica no provider), então
  // quem é dono vê tudo sem precisar ter permission explícita, enquanto
  // agentes comuns só veem o que foi liberado na role deles.
  // Inbox: gate só por inbox:view. Tickets:view é sub-perm pra carregar
  // conversas — quando admin tira inbox:view, o módulo some da sidebar
  // independente do que o user tenha em tickets.
  const canSeeInbox = optimistic || hasPerm(PERM.inboxView);
  const canSeeCRM = optimistic || hasAnyPerm([PERM.crmView, PERM.companiesView, PERM.dealsView]);
  const canSeeDashboard = optimistic || hasPerm(PERM.dashboardView) || hasAnyPerm([PERM.ticketsView, PERM.inboxView]);
  // Uniq AI e Jornadas saíram de /agents (Apr/26). Como o backend ainda não
  // distribuiu uniqai:use / journeys:* nos roles existentes, usamos
  // agents:view como fallback pra que quem já tinha acesso continue vendo
  // os novos itens. Owners/super-admin já bypassam por hasPerm.
  const canSeeUniqAi = optimistic || hasAnyPerm([PERM.uniqAiUse, PERM.agentsView]);
  const canSeeJourneys = optimistic || hasAnyPerm([PERM.journeysView, PERM.journeysManage, PERM.agentsView]);
  const canSeeAgents = optimistic || hasAnyPerm([PERM.agentsView, PERM.agentsManage]);
  const canSeeServers = optimistic || hasAnyPerm([PERM.serversView, PERM.serversManage]);
  const canSeeInstances = optimistic || hasAnyPerm([PERM.instancesView, PERM.instancesCreate, PERM.instancesEdit]);
  const canSeeCampaigns = optimistic || hasPerm(PERM.campaignsView);
  const canSeeIntegrations = optimistic || hasAnyPerm([PERM.integrationsView, PERM.integrationsManage]);
  const canSeeBilling = optimistic || hasAnyPerm([PERM.billingView, PERM.billingManage]);

  // Ordem reflete a hierarquia mental: Uniq AI primeiro (entrada principal,
  // estilo Claude/GPT), depois Inbox/CRM/Campanhas/Jornadas (módulos onde se
  // executa o trabalho), depois Agentes (configuração de personalidade), e
  // por último a infra (Servers/Instances/Integrations) e Conta.
  const navItems: NavItem[] = [
    // Política de gate: módulos historicamente perm-only continuam só
    // por permissão (canSeeX). Os 3 abaixo (Campaigns/Journeys/Help Desk)
    // estavam atrás de `isBeta` antes — agora respeitam plan.allow_*.
    // Adicionar planAllows nos demais sobre-bloqueia clientes pagantes
    // cujo session.user.plan não traz a flag explicitamente.
    { href: "/uniq-ai",      label: "Uniq AI",             icon: Sparkles,        exact: false, show: canSeeUniqAi },
    { href: "/dashboard",    label: t("nav_dashboard"),    icon: LayoutDashboard, exact: true,  show: canSeeDashboard },
    { href: "/inbox",        label: t("nav_inbox"),        icon: Headset,         exact: false, show: canSeeInbox },
    { href: "/crm",          label: t("nav_crm"),          icon: Contact,         exact: false, show: canSeeCRM },
    { href: "/campaigns",    label: t("nav_campaigns"),    icon: Megaphone,       exact: false, show: canSeeCampaigns && planAllows("allow_campaigns") },
    { href: "/journeys",     label: "Jornadas",            icon: Wand2,           exact: false, show: canSeeJourneys && planAllows("allow_journeys") },
    { href: "/agents",       label: "Agentes",             icon: Bot,             exact: false, show: canSeeAgents },
    { href: "/help-desk",    label: "Help Desk",           icon: BookOpen,        exact: false, show: planAllows("allow_helpdesk") },
    { href: "/shops",        label: "Shops",               icon: ShoppingBag,     exact: false, show: true },
    { href: "/servers",      label: t("nav_servers"),      icon: Server,          exact: false, show: canSeeServers },
    { href: "/instances",    label: t("nav_instances"),    icon: Smartphone,      exact: false, show: canSeeInstances },
    { href: "/integrations", label: t("nav_integrations"), icon: Plug,            exact: false, show: canSeeIntegrations },
    // /workspace é onde mora time, papéis, mensageria/timezone, bloqueios
    // e tópicos de assinatura. Antes só dava pra acessar via botão pequeno
    // dentro do card de workspace (escondia em sidebar collapsed). Agora
    // entrada primária pra qualquer membro do workspace.
    { href: "/workspace",    label: "Workspace",           icon: Building2,       exact: false, show: !!currentWorkspace },
    { href: "/settings",     label: t("nav_settings"),     icon: Settings,        exact: false, show: true },
  ];
  const visibleNavItems = navItems.filter((n) => n.show);

  const adminItems = [
    { href: "/admin/inspect", label: "Inspect", icon: Server },
    { href: "/admin/users", label: t("nav_users"), icon: Users },
    { href: "/admin/plans", label: t("nav_plans"), icon: CreditCard },
    { href: "/admin/providers", label: "Providers", icon: Layers },
    // Uniq AI agora vive como aba dentro de /admin/providers (?tab=ai),
    // sem entrada solta na sidebar.
  ];

  const closeMobile = () => setMobileOpen(false);

  const sidebarContent = (
    <aside
      className={cn("relative flex flex-col h-full shrink-0 overflow-hidden",
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        collapsed ? "w-14" : "w-56"
      )}
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "4px 0 24px rgba(0,0,0,0.30), inset -1px 0 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Linha difusa no topo — luz ambiente */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
        pointerEvents: "none",
        zIndex: 1,
      }} />

      {/* Ambient glow — radial verde no topo, pulsa suave */}
      <div
        className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full uniq-glow-pulse"
        style={{ background: "radial-gradient(circle, rgba(0,212,106,0.07) 0%, transparent 70%)" }}
      />

      {/* Logo + collapse toggle */}
      <div className="relative flex items-center justify-between px-3 h-14 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {!collapsed && <Logo height={36} />}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden lg:flex p-1.5 rounded-lg transition-all duration-150 hover:bg-white/[0.06]"
          style={{ color: "var(--text-4)", marginLeft: collapsed ? "auto" : 0, marginRight: collapsed ? "auto" : 0 }}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={closeMobile}
          className="lg:hidden p-1 rounded-lg transition-colors"
          style={{ color: "var(--text-3)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Workspace — compacto, sem borda pesada */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-2 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-2.5 mb-2">
            <button
              onClick={() => currentWorkspace && setCustomizeOpen(true)}
              disabled={!currentWorkspace}
              title={currentWorkspace?.is_owner ? "Personalizar workspace" : "Detalhes"}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 hover:brightness-110"
              style={{
                background: `linear-gradient(135deg, ${wsColor}30, ${wsColor}12)`,
                border: `1px solid ${wsColor}30`,
                boxShadow: `0 0 20px rgba(0,212,106,0.15), 0 0 0 1px rgba(255,255,255,0.12)`,
                transition: "box-shadow 0.3s ease",
              }}
            >
              <WsIcon className="w-3.5 h-3.5" style={{ color: wsColor }} />
            </button>
            <div className="flex-1 min-w-0">
              {workspaces.length >= 1 ? (
                <WorkspaceDropdown
                  workspaces={workspaces}
                  currentId={currentWorkspace?.id || ""}
                  onSelect={(ws) => {
                    const full = workspaces.find((w) => w.id === ws.id);
                    if (full) setCurrentWorkspace(full);
                  }}
                />
              ) : (
                <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                  Selecione workspace
                </p>
              )}
              <p className="text-[9px] mt-0.5 font-medium" style={{
                color: currentWorkspace?.is_owner ? "#fbbf24" : "var(--text-4)"
              }}>
                {currentWorkspace?.is_owner ? "Proprietário" : currentWorkspace ? "Membro" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push("/workspace")}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium"
            style={{
              background: "rgba(124,58,237,0.07)",
              border: "1px solid rgba(124,58,237,0.12)",
              color: "#a78bfa",
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(124,58,237,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(124,58,237,0.07)"; }}
          >
            <Settings className="w-3 h-3" />
            Gerenciar workspaces
          </button>
        </div>
      )}

      {/* Search / Command Palette trigger */}
      <div className={cn("flex-shrink-0", collapsed ? "px-1.5 py-2" : "px-2 py-2")}>
        {collapsed ? (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("uniq:cmd-k"))}
            title="Buscar (⌘K)"
            className="w-full flex items-center justify-center p-2 rounded-lg"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-3)",
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text-1)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-3)"; }}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("uniq:cmd-k"))}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-3)",
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text-2)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-3)"; }}
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 text-left">Buscar...</span>
            <kbd
              className="text-[10px] px-1 py-0.5 rounded flex-shrink-0"
              style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-4)" }}
            >
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 py-2 space-y-px overflow-y-auto", collapsed ? "px-1.5" : "px-2")}>
        {visibleNavItems.map((item, index) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          const isInbox = item.href === "/inbox";
          return (
            <motion.div
              key={item.href}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link
                href={item.href}
                onClick={closeMobile}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center rounded-xl text-sm font-medium",
                  collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2"
                )}
                style={active
                  ? {
                      background: "linear-gradient(90deg, rgba(0,212,106,0.18) 0%, rgba(0,212,106,0.06) 100%)",
                      color: "var(--text-1)",
                      boxShadow: "inset 2px 0 0 var(--green), 0 2px 16px rgba(0,212,106,0.12), 0 0 0 1px rgba(0,212,106,0.08)",
                      backdropFilter: "blur(12px)",
                      transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                    }
                  : {
                      color: "var(--text-3)",
                      transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                    }
                }
                onMouseEnter={e => {
                  if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                }}
                onMouseLeave={e => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Icon container */}
                <span
                  className="relative flex items-center justify-center w-5 h-5 flex-shrink-0 rounded-md"
                  style={active
                    ? {
                        background: "linear-gradient(135deg, rgba(0,212,106,0.28), rgba(0,212,106,0.12))",
                        backdropFilter: "blur(12px)",
                        border: "1px solid rgba(0,212,106,0.35)",
                        boxShadow: "0 0 16px rgba(0,212,106,0.30), inset 0 1px 0 rgba(255,255,255,0.12)",
                        color: "var(--green)",
                        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                      }
                    : {
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        color: "inherit",
                        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                      }
                  }
                >
                  <item.icon className="w-3.5 h-3.5" />
                  {collapsed && isInbox && unreadCount > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                      style={{ background: "var(--green)", boxShadow: "0 0 5px var(--green)" }}
                    />
                  )}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && isInbox && unreadCount > 0 && (
                  <span
                    className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex-shrink-0"
                    style={{ background: "var(--green)", color: "#000", boxShadow: "0 0 6px rgba(0,212,106,0.4)" }}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
                {!collapsed && active && unreadCount === 0 && (
                  <span
                    className="ml-auto w-1 h-1 rounded-full flex-shrink-0"
                    style={{ background: "var(--green)", boxShadow: "0 0 5px var(--green)" }}
                  />
                )}
              </Link>
            </motion.div>
          );
        })}

        {/* Admin */}
        {isAdmin && (
          <div className="pt-3">
            <div className="flex items-center gap-1.5 px-2.5 mb-1">
              <Shield className="w-2.5 h-2.5" style={{ color: "rgba(245,158,11,0.5)" }} />
              {!collapsed && (
                <p className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-4)" }}>
                  {t("nav_admin")}
                </p>
              )}
            </div>
            {adminItems.map((item, index) => {
              const active = pathname.startsWith(item.href);
              return (
                <motion.div
                  key={item.href}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (visibleNavItems.length + index) * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Link
                    href={item.href}
                    onClick={closeMobile}
                    className={cn(
                      "group relative flex items-center rounded-xl text-sm font-medium",
                      collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-2.5 py-2"
                    )}
                    style={active
                      ? {
                          background: "linear-gradient(90deg, rgba(0,212,106,0.15) 0%, rgba(0,212,106,0.05) 100%)",
                          color: "var(--text-1)",
                          boxShadow: "inset 2px 0 0 var(--green), 0 0 20px rgba(0,212,106,0.08)",
                          backdropFilter: "blur(8px)",
                          transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                        }
                      : {
                          color: "var(--text-3)",
                          transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                        }
                    }
                    onMouseEnter={e => {
                      if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    }}
                    onMouseLeave={e => {
                      if (!active) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span
                      className="flex items-center justify-center w-5 h-5 flex-shrink-0 rounded-md"
                      style={active
                        ? {
                            background: "linear-gradient(135deg, rgba(0,212,106,0.25), rgba(0,212,106,0.10))",
                            backdropFilter: "blur(8px)",
                            border: "1px solid rgba(0,212,106,0.30)",
                            boxShadow: "0 0 12px rgba(0,212,106,0.20)",
                            color: "var(--green)",
                            transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                          }
                        : {
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: "inherit",
                            transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                          }
                      }
                    >
                      <item.icon className="w-3.5 h-3.5" />
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Upgrade prompt — só pro dono, plano free */}
      {!collapsed && canSeeBilling && planName?.toLowerCase() === "free" && (
        <div className="px-2 pb-2">
          <Link
            href="/settings?section=billing"
            onClick={closeMobile}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.18) 0%, rgba(0,212,106,0.06) 100%)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(0,212,106,0.28)",
              color: "var(--green)",
              boxShadow: "0 4px 16px rgba(0,212,106,0.15), inset 0 1px 0 rgba(255,255,255,0.10)",
              transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,212,106,0.25), inset 0 1px 0 rgba(255,255,255,0.15)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,212,106,0.15), inset 0 1px 0 rgba(255,255,255,0.10)";
            }}
          >
            <Zap className="w-3 h-3" />
            Fazer upgrade
          </Link>
        </div>
      )}

      {/* User section */}
      <div
        className="flex-shrink-0 p-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div
          className={cn(
            "flex items-center rounded-xl cursor-default mb-1",
            collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2"
          )}
          style={{
            background: "rgba(255,255,255,0.03)",
            transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {/* Avatar com gradiente único por usuário */}
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{
              background: avatarGradient,
              color: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
          >
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate leading-tight" style={{ color: "var(--text-1)" }}>
                {session?.user?.name || "Usuário"}
                {session?.user?.is_beta && (
                  <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    BETA
                  </span>
                )}
              </p>
              <p className="text-[10px] truncate capitalize leading-tight mt-0.5" style={{ color: "var(--text-4)" }}>
                {planName}
              </p>
            </div>
          )}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={cn(
            "flex items-center rounded-xl text-xs w-full",
            "hover:text-red-400 hover:bg-red-500/[0.07]",
            collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-2.5 py-2"
          )}
          style={{
            color: "var(--text-4)",
            transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
          }}
          title={collapsed ? t("nav_logout") : undefined}
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          {!collapsed && t("nav_logout")}
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

      {/* Customize dialog — abre clicando no chip de workspace */}
      {customizeOpen && currentWorkspace && (
        <WorkspaceCustomizeDialog
          workspaceId={currentWorkspace.id}
          initialName={currentWorkspace.name}
          initialColor={currentWorkspace.color}
          initialIcon={currentWorkspace.icon}
          isOwner={!!currentWorkspace.is_owner}
          onClose={() => setCustomizeOpen(false)}
          onSaved={(next) => {
            // Update otimista no contexto global pra ver o ícone/cor mudar
            // sem esperar o refetch da lista de workspaces.
            setCurrentWorkspace({
              ...currentWorkspace,
              name: next.name,
              color: next.color,
              icon: next.icon,
            });
          }}
        />
      )}
    </>
  );
}

// Dropdown custom pra workspaces — substitui <select> nativo que renderiza
// com tema do OS (branco no macOS) ignorando dark theme da Uniq.
// Inclui ícone + cor + role (Owner/Member) por workspace.
function WorkspaceDropdown({
  workspaces,
  currentId,
  onSelect,
}: {
  workspaces: Array<{ id: string; name: string; color?: string; icon?: string; is_owner?: boolean }>;
  currentId: string;
  onSelect: (ws: { id: string; name: string; color?: string; icon?: string; is_owner?: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = workspaces.find((w) => w.id === currentId);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 text-xs font-medium truncate text-left"
        style={{ color: "var(--text-1)" }}
      >
        <span className="truncate flex-1">{current?.name || "Selecione"}</span>
        <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "var(--text-3)" }} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-lg overflow-hidden uniq-fade-in"
          style={{
            width: "max-content",
            minWidth: "100%",
            maxWidth: "260px",
            background: "var(--surface-1)",
            border: "1px solid var(--surface-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div className="py-1 max-h-72 overflow-y-auto">
            {workspaces.map((ws) => {
              const Icon = resolveWorkspaceIcon(ws.icon);
              const active = ws.id === currentId;
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => {
                    onSelect(ws);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
                  style={{
                    background: active ? "rgba(0,212,106,0.08)" : undefined,
                  }}
                >
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{
                      background: `${ws.color || "#7c3aed"}22`,
                      border: `1px solid ${ws.color || "#7c3aed"}44`,
                    }}
                  >
                    <Icon className="w-3 h-3" style={{ color: ws.color || "#7c3aed" }} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                      {ws.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: ws.is_owner ? "#fbbf24" : "var(--text-3)" }}>
                      {ws.is_owner ? "Proprietário" : "Membro"}
                    </span>
                  </span>
                  {active && (
                    <span className="text-[10px] shrink-0" style={{ color: "var(--green)" }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
