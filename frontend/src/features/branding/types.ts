export type ThemePreset = "modern" | "classic" | "standard" | "minimal";

export interface BrandingConfig {
  app_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font_family: string;
  theme_preset: ThemePreset;
  logo_light_url: string;
  logo_dark_url: string;
  favicon_url: string;
  login_bg_url: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  app_name: "qchat",
  primary_color: "#2563EB",
  secondary_color: "#3B82F6",
  accent_color: "#0EA5E9",
  font_family: "inter",
  theme_preset: "modern",
  logo_light_url: "",
  logo_dark_url: "",
  favicon_url: "",
  login_bg_url: "",
};
