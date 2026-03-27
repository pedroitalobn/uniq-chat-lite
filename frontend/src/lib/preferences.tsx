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
    nav_dashboard: "Dashboard", nav_servers: "Servers", nav_instances: "Instâncias",
    nav_crm: "CRM", nav_campaigns: "Campanhas", nav_api_keys: "API Keys",
    nav_integrations: "Integrações",
    nav_api_docs: "API Docs", nav_settings: "Conta", nav_logout: "Sair da conta",
    nav_admin: "Admin", nav_users: "Usuários", nav_plans: "Planos",
    settings_title: "Configurações", settings_desc: "Gerencie seu perfil e segurança da conta",
    settings_profile: "Perfil", settings_profile_desc: "Atualize seu nome e username",
    settings_security: "Segurança", settings_security_desc: "Altere sua senha de acesso",
    settings_account: "Informações da conta",
    settings_preferences: "Preferências", settings_preferences_desc: "Idioma, tema e fuso horário",
    settings_language: "Idioma", settings_theme: "Tema",
    settings_theme_dark: "Escuro", settings_theme_light: "Claro", settings_theme_system: "Sistema",
    settings_timezone: "Fuso horário", settings_save: "Salvar preferências", settings_saved: "Preferências salvas!",
    instances_title: "Instâncias", instances_new: "Nova Instância",
    campaigns_new: "Nova Campanha",
    crm_new_contact: "Novo Contato",
    servers_new: "Novo Server",
    timezone_label: "Fuso horário ativo",
  },
  en: {
    nav_dashboard: "Dashboard", nav_servers: "Servers", nav_instances: "Instances",
    nav_crm: "CRM", nav_campaigns: "Campaigns", nav_api_keys: "API Keys",
    nav_integrations: "Integrations",
    nav_api_docs: "API Docs", nav_settings: "Account", nav_logout: "Sign out",
    nav_admin: "Admin", nav_users: "Users", nav_plans: "Plans",
    settings_title: "Settings", settings_desc: "Manage your profile and account security",
    settings_profile: "Profile", settings_profile_desc: "Update your name and username",
    settings_security: "Security", settings_security_desc: "Change your access password",
    settings_account: "Account information",
    settings_preferences: "Preferences", settings_preferences_desc: "Language, theme and timezone",
    settings_language: "Language", settings_theme: "Theme",
    settings_theme_dark: "Dark", settings_theme_light: "Light", settings_theme_system: "System",
    settings_timezone: "Timezone", settings_save: "Save preferences", settings_saved: "Preferences saved!",
    instances_title: "Instances", instances_new: "New Instance",
    campaigns_new: "New Campaign",
    crm_new_contact: "New Contact",
    servers_new: "New Server",
    timezone_label: "Active timezone",
  },
  es: {
    nav_dashboard: "Panel", nav_servers: "Servidores", nav_instances: "Instancias",
    nav_crm: "CRM", nav_campaigns: "Campañas", nav_api_keys: "Claves API",
    nav_integrations: "Integraciones",
    nav_api_docs: "Docs API", nav_settings: "Cuenta", nav_logout: "Cerrar sesión",
    nav_admin: "Admin", nav_users: "Usuarios", nav_plans: "Planes",
    settings_title: "Configuración", settings_desc: "Gestiona tu perfil y seguridad",
    settings_profile: "Perfil", settings_profile_desc: "Actualiza tu nombre y usuario",
    settings_security: "Seguridad", settings_security_desc: "Cambia tu contraseña",
    settings_account: "Información de la cuenta",
    settings_preferences: "Preferencias", settings_preferences_desc: "Idioma, tema y zona horaria",
    settings_language: "Idioma", settings_theme: "Tema",
    settings_theme_dark: "Oscuro", settings_theme_light: "Claro", settings_theme_system: "Sistema",
    settings_timezone: "Zona horaria", settings_save: "Guardar preferencias", settings_saved: "¡Preferencias guardadas!",
    instances_title: "Instancias", instances_new: "Nueva Instancia",
    campaigns_new: "Nueva Campaña",
    crm_new_contact: "Nuevo Contacto",
    servers_new: "Nuevo Servidor",
    timezone_label: "Zona horaria activa",
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
    const lang = (localStorage.getItem("sc-lang") as Language) || "pt";
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

  const setLanguage = (l: Language) => { setLangState(l); localStorage.setItem("sc-lang", l); };
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
