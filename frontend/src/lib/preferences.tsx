"use client";

import { createContext, useContext, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Language = "pt" | "en" | "es";
export type ThemeMode = "dark" | "light" | "system";

interface Preferences {
  language: Language;
  theme: ThemeMode;
  timezone: string;
  setLanguage: (l: Language) => void;
  setTheme: (t: ThemeMode) => void;
  setTimezone: (tz: string) => void;
  t: (key: TKey) => string;
}

// ─── Translations ─────────────────────────────────────────────────────────────

const TR = {
  pt: {
    // Nav
    nav_dashboard: "Dashboard", nav_servers: "Servers", nav_instances: "Instâncias",
    nav_crm: "CRM", nav_campaigns: "Campanhas", nav_api_keys: "API Keys",
    nav_integrations: "Integrações", nav_inbox: "Inbox",
    nav_api_docs: "API Docs", nav_settings: "Conta", nav_logout: "Sair da conta",
    nav_admin: "Admin", nav_users: "Usuários", nav_plans: "Planos",
    // Settings
    settings_title: "Configurações", settings_desc: "Gerencie seu perfil e segurança da conta",
    settings_profile: "Perfil", settings_profile_desc: "Atualize seu nome e username",
    settings_security: "Segurança", settings_security_desc: "Altere sua senha de acesso",
    settings_account: "Informações da conta",
    settings_preferences: "Preferências", settings_preferences_desc: "Idioma, tema e fuso horário",
    settings_language: "Idioma", settings_theme: "Tema",
    settings_theme_dark: "Escuro", settings_theme_light: "Claro", settings_theme_system: "Sistema",
    settings_timezone: "Fuso horário", settings_save: "Salvar preferências", settings_saved: "Preferências salvas!",
    timezone_label: "Fuso horário ativo",
    // Instances
    instances_title: "Instâncias", instances_new: "Nova Instância",
    instance_connected: "Conectado", instance_disconnected: "Desconectado", instance_connecting: "Conectando",
    instance_scan_qr: "Escanear QR Code", instance_reconnect: "Reconectar", instance_delete: "Excluir",
    // Inbox
    inbox_title: "Inbox", inbox_all: "Todos", inbox_open: "Abertos", inbox_pending: "Pendentes",
    inbox_unassigned: "Sem atribuição", inbox_snoozed: "Soneca", inbox_resolved: "Resolvidos",
    inbox_closed: "Encerrados", inbox_attendances: "Atendimentos",
    inbox_my: "Meus atendimentos", inbox_all_agents: "Todos os agentes",
    inbox_all_channels: "Todos os canais", inbox_all_instances: "Todas as instâncias",
    inbox_all_queues: "Todas as filas", inbox_search: "Buscar…",
    inbox_select: "Selecione um atendimento", inbox_empty: "Nenhum atendimento neste filtro.",
    inbox_refresh: "Atualizar", inbox_enable_notif: "Ativar notificações",
    inbox_manage_queues: "Gerenciar filas →", inbox_reports: "Relatórios e métricas do atendimento",
    // CRM
    crm_new_contact: "Novo Contato", crm_new_deal: "Novo Deal", crm_new_company: "Nova Empresa",
    crm_contacts: "Contatos", crm_deals: "Deals", crm_companies: "Empresas",
    crm_segments: "Segmentos", crm_import: "Importar", crm_duplicates: "Duplicatas",
    crm_search: "Buscar…", crm_empty_contacts: "Ainda sem contatos cadastrados.",
    crm_empty_deals: "Nenhum deal neste funil.", crm_empty_companies: "Ainda sem empresas cadastradas.",
    // Campaigns
    campaigns_new: "Nova Campanha", campaigns_title: "Campanhas",
    // Servers
    servers_new: "Novo Server", servers_title: "Servers",
    // Common
    common_save: "Salvar", common_cancel: "Cancelar", common_delete: "Excluir",
    common_edit: "Editar", common_create: "Criar", common_loading: "Carregando…",
    common_error: "Ocorreu um erro", common_success: "Sucesso", common_confirm: "Confirmar",
    common_search: "Buscar", common_filter: "Filtrar", common_clear: "Limpar",
    common_back: "Voltar", common_next: "Próximo", common_close: "Fechar",
    common_name: "Nome", common_email: "E-mail", common_phone: "Telefone",
    common_status: "Status", common_created_at: "Criado em", common_updated_at: "Atualizado em",
    common_no_results: "Nenhum resultado encontrado.", common_try_again: "Tentar novamente",
  },
  en: {
    // Nav
    nav_dashboard: "Dashboard", nav_servers: "Servers", nav_instances: "Instances",
    nav_crm: "CRM", nav_campaigns: "Campaigns", nav_api_keys: "API Keys",
    nav_integrations: "Integrations", nav_inbox: "Inbox",
    nav_api_docs: "API Docs", nav_settings: "Account", nav_logout: "Sign out",
    nav_admin: "Admin", nav_users: "Users", nav_plans: "Plans",
    // Settings
    settings_title: "Settings", settings_desc: "Manage your profile and account security",
    settings_profile: "Profile", settings_profile_desc: "Update your name and username",
    settings_security: "Security", settings_security_desc: "Change your access password",
    settings_account: "Account information",
    settings_preferences: "Preferences", settings_preferences_desc: "Language, theme and timezone",
    settings_language: "Language", settings_theme: "Theme",
    settings_theme_dark: "Dark", settings_theme_light: "Light", settings_theme_system: "System",
    settings_timezone: "Timezone", settings_save: "Save preferences", settings_saved: "Preferences saved!",
    timezone_label: "Active timezone",
    // Instances
    instances_title: "Instances", instances_new: "New Instance",
    instance_connected: "Connected", instance_disconnected: "Disconnected", instance_connecting: "Connecting",
    instance_scan_qr: "Scan QR Code", instance_reconnect: "Reconnect", instance_delete: "Delete",
    // Inbox
    inbox_title: "Inbox", inbox_all: "All", inbox_open: "Open", inbox_pending: "Pending",
    inbox_unassigned: "Unassigned", inbox_snoozed: "Snoozed", inbox_resolved: "Resolved",
    inbox_closed: "Closed", inbox_attendances: "Conversations",
    inbox_my: "My conversations", inbox_all_agents: "All agents",
    inbox_all_channels: "All channels", inbox_all_instances: "All instances",
    inbox_all_queues: "All queues", inbox_search: "Search…",
    inbox_select: "Select a conversation", inbox_empty: "No conversations match this filter.",
    inbox_refresh: "Refresh", inbox_enable_notif: "Enable notifications",
    inbox_manage_queues: "Manage queues →", inbox_reports: "Reports and attendance metrics",
    // CRM
    crm_new_contact: "New Contact", crm_new_deal: "New Deal", crm_new_company: "New Company",
    crm_contacts: "Contacts", crm_deals: "Deals", crm_companies: "Companies",
    crm_segments: "Segments", crm_import: "Import", crm_duplicates: "Duplicates",
    crm_search: "Search…", crm_empty_contacts: "No contacts yet.",
    crm_empty_deals: "No deals in this funnel.", crm_empty_companies: "No companies yet.",
    // Campaigns
    campaigns_new: "New Campaign", campaigns_title: "Campaigns",
    // Servers
    servers_new: "New Server", servers_title: "Servers",
    // Common
    common_save: "Save", common_cancel: "Cancel", common_delete: "Delete",
    common_edit: "Edit", common_create: "Create", common_loading: "Loading…",
    common_error: "An error occurred", common_success: "Success", common_confirm: "Confirm",
    common_search: "Search", common_filter: "Filter", common_clear: "Clear",
    common_back: "Back", common_next: "Next", common_close: "Close",
    common_name: "Name", common_email: "Email", common_phone: "Phone",
    common_status: "Status", common_created_at: "Created at", common_updated_at: "Updated at",
    common_no_results: "No results found.", common_try_again: "Try again",
  },
  es: {
    // Nav
    nav_dashboard: "Panel", nav_servers: "Servidores", nav_instances: "Instancias",
    nav_crm: "CRM", nav_campaigns: "Campañas", nav_api_keys: "Claves API",
    nav_integrations: "Integraciones", nav_inbox: "Bandeja",
    nav_api_docs: "Docs API", nav_settings: "Cuenta", nav_logout: "Cerrar sesión",
    nav_admin: "Admin", nav_users: "Usuarios", nav_plans: "Planes",
    // Settings
    settings_title: "Configuración", settings_desc: "Gestiona tu perfil y seguridad",
    settings_profile: "Perfil", settings_profile_desc: "Actualiza tu nombre y usuario",
    settings_security: "Seguridad", settings_security_desc: "Cambia tu contraseña",
    settings_account: "Información de la cuenta",
    settings_preferences: "Preferencias", settings_preferences_desc: "Idioma, tema y zona horaria",
    settings_language: "Idioma", settings_theme: "Tema",
    settings_theme_dark: "Oscuro", settings_theme_light: "Claro", settings_theme_system: "Sistema",
    settings_timezone: "Zona horaria", settings_save: "Guardar preferencias", settings_saved: "¡Preferencias guardadas!",
    timezone_label: "Zona horaria activa",
    // Instances
    instances_title: "Instancias", instances_new: "Nueva Instancia",
    instance_connected: "Conectado", instance_disconnected: "Desconectado", instance_connecting: "Conectando",
    instance_scan_qr: "Escanear código QR", instance_reconnect: "Reconectar", instance_delete: "Eliminar",
    // Inbox
    inbox_title: "Bandeja", inbox_all: "Todos", inbox_open: "Abiertos", inbox_pending: "Pendientes",
    inbox_unassigned: "Sin asignar", inbox_snoozed: "Pospuestos", inbox_resolved: "Resueltos",
    inbox_closed: "Cerrados", inbox_attendances: "Atenciones",
    inbox_my: "Mis atenciones", inbox_all_agents: "Todos los agentes",
    inbox_all_channels: "Todos los canales", inbox_all_instances: "Todas las instancias",
    inbox_all_queues: "Todas las colas", inbox_search: "Buscar…",
    inbox_select: "Selecciona una conversación", inbox_empty: "Ninguna atención en este filtro.",
    inbox_refresh: "Actualizar", inbox_enable_notif: "Activar notificaciones",
    inbox_manage_queues: "Gestionar colas →", inbox_reports: "Informes y métricas de atención",
    // CRM
    crm_new_contact: "Nuevo Contacto", crm_new_deal: "Nuevo Deal", crm_new_company: "Nueva Empresa",
    crm_contacts: "Contactos", crm_deals: "Deals", crm_companies: "Empresas",
    crm_segments: "Segmentos", crm_import: "Importar", crm_duplicates: "Duplicados",
    crm_search: "Buscar…", crm_empty_contacts: "Aún sin contactos registrados.",
    crm_empty_deals: "Ningún deal en este embudo.", crm_empty_companies: "Aún sin empresas registradas.",
    // Campaigns
    campaigns_new: "Nueva Campaña", campaigns_title: "Campañas",
    // Servers
    servers_new: "Nuevo Servidor", servers_title: "Servidores",
    // Common
    common_save: "Guardar", common_cancel: "Cancelar", common_delete: "Eliminar",
    common_edit: "Editar", common_create: "Crear", common_loading: "Cargando…",
    common_error: "Ocurrió un error", common_success: "Éxito", common_confirm: "Confirmar",
    common_search: "Buscar", common_filter: "Filtrar", common_clear: "Limpiar",
    common_back: "Volver", common_next: "Siguiente", common_close: "Cerrar",
    common_name: "Nombre", common_email: "Correo", common_phone: "Teléfono",
    common_status: "Estado", common_created_at: "Creado el", common_updated_at: "Actualizado el",
    common_no_results: "No se encontraron resultados.", common_try_again: "Intentar de nuevo",
  },
} as const;

export type TKey = keyof typeof TR["pt"];

// ─── Context ──────────────────────────────────────────────────────────────────

const FALLBACK_TZ = "America/Sao_Paulo";

const PreferencesContext = createContext<Preferences>({
  language: "pt", theme: "dark", timezone: FALLBACK_TZ,
  setLanguage: () => {}, setTheme: () => {}, setTimezone: () => {},
  t: (k) => TR["pt"][k] ?? k,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLangState] = useState<Language>("pt");
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  // Always start with the fallback so SSR and initial client render match.
  // The real value (localStorage / browser timezone) is loaded in useEffect.
  const [timezone, setTzState] = useState<string>(FALLBACK_TZ);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Lê cookie sc-lang (setado pelo middleware via CF-IPCountry) como fonte
    // primária; cai para localStorage para retrocompatibilidade.
    const cookieLang = document.cookie
      .split("; ")
      .find((r) => r.startsWith("sc-lang="))
      ?.split("=")[1] as Language | undefined;
    const lang = cookieLang || (localStorage.getItem("sc-lang") as Language) || "pt";
    const th = (localStorage.getItem("sc-theme") as ThemeMode) || "dark";
    const tz = localStorage.getItem("sc-tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLangState(lang);
    setThemeState(th);
    setTzState(tz);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const apply = (t: ThemeMode) => {
      root.classList.remove("dark", "light");
      if (t === "system") {
        root.classList.add(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      } else {
        root.classList.add(t);
      }
    };
    apply(theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const h = () => apply("system");
      mq.addEventListener("change", h);
      return () => mq.removeEventListener("change", h);
    }
  }, [theme, mounted]);

  const setLanguage = (l: Language) => {
    setLangState(l);
    localStorage.setItem("sc-lang", l);
    // Grava no cookie também para que o middleware não sobrescreva na próxima request.
    document.cookie = `sc-lang=${l};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  };
  const setTheme = (t: ThemeMode) => { setThemeState(t); localStorage.setItem("sc-theme", t); };
  const setTimezone = (tz: string) => { setTzState(tz); localStorage.setItem("sc-tz", tz); };
  const t = (k: TKey): string => TR[language]?.[k] ?? TR["pt"][k] ?? k;

  return (
    <PreferencesContext.Provider value={{ language, theme, timezone, setLanguage, setTheme, setTimezone, t }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}

// ─── Common timezones ─────────────────────────────────────────────────────────

export const TIMEZONES = [
  { value: "America/Sao_Paulo",     label: "São Paulo (BRT, UTC-3)" },
  { value: "America/Fortaleza",     label: "Fortaleza (BRT, UTC-3)" },
  { value: "America/Manaus",        label: "Manaus (AMT, UTC-4)" },
  { value: "America/Belem",         label: "Belém (BRT, UTC-3)" },
  { value: "America/Recife",        label: "Recife (BRT, UTC-3)" },
  { value: "America/New_York",      label: "New York (EST, UTC-5)" },
  { value: "America/Chicago",       label: "Chicago (CST, UTC-6)" },
  { value: "America/Denver",        label: "Denver (MST, UTC-7)" },
  { value: "America/Los_Angeles",   label: "Los Angeles (PST, UTC-8)" },
  { value: "America/Mexico_City",   label: "Mexico City (CST, UTC-6)" },
  { value: "America/Bogota",        label: "Bogotá (COT, UTC-5)" },
  { value: "America/Lima",          label: "Lima (PET, UTC-5)" },
  { value: "America/Santiago",      label: "Santiago (CLT, UTC-4)" },
  { value: "America/Buenos_Aires",  label: "Buenos Aires (ART, UTC-3)" },
  { value: "Europe/London",         label: "London (GMT, UTC+0)" },
  { value: "Europe/Paris",          label: "Paris (CET, UTC+1)" },
  { value: "Europe/Berlin",         label: "Berlin (CET, UTC+1)" },
  { value: "Europe/Madrid",         label: "Madrid (CET, UTC+1)" },
  { value: "Europe/Lisbon",         label: "Lisbon (WET, UTC+0)" },
  { value: "Africa/Lagos",          label: "Lagos (WAT, UTC+1)" },
  { value: "Asia/Dubai",            label: "Dubai (GST, UTC+4)" },
  { value: "Asia/Kolkata",          label: "India (IST, UTC+5:30)" },
  { value: "Asia/Singapore",        label: "Singapore (SGT, UTC+8)" },
  { value: "Asia/Tokyo",            label: "Tokyo (JST, UTC+9)" },
  { value: "Asia/Shanghai",         label: "Shanghai (CST, UTC+8)" },
  { value: "Australia/Sydney",      label: "Sydney (AEST, UTC+10)" },
  { value: "Pacific/Auckland",      label: "Auckland (NZST, UTC+12)" },
  { value: "UTC",                   label: "UTC (UTC+0)" },
];
