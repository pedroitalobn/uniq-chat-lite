"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { BrandingConfig, DEFAULT_BRANDING, ThemePreset } from "./types";

type Ctx = {
  branding: BrandingConfig;
  setBranding: (b: Partial<BrandingConfig>) => void;
  reload: () => Promise<void>;
};

const BrandingContext = createContext<Ctx>({
  branding: DEFAULT_BRANDING,
  setBranding: () => {},
  reload: async () => {},
});

// Converte "#6366F1" → "99 102 241" para usar em rgb(var(--brand-primary) / <alpha>).
function hexToRgbTuple(hex: string): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyBranding(b: BrandingConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", hexToRgbTuple(b.primary_color));
  root.style.setProperty("--brand-secondary", hexToRgbTuple(b.secondary_color));
  root.style.setProperty("--brand-accent", hexToRgbTuple(b.accent_color));
  root.setAttribute("data-theme", b.theme_preset);
  root.setAttribute("data-font", b.font_family);
  if (b.favicon_url) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = b.favicon_url;
  }
  if (b.app_name) {
    // Atualiza o título base; páginas que usam <title> próprio sobrescrevem.
    const baseTitle = document.title.split(" — ").pop() || "";
    document.title = baseTitle && baseTitle !== b.app_name ? `${baseTitle} — ${b.app_name}` : b.app_name;
  }
}

export function BrandingProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial?: Partial<BrandingConfig>;
}) {
  const [branding, setBrandingState] = useState<BrandingConfig>({
    ...DEFAULT_BRANDING,
    ...(initial || {}),
  });

  const fetchPublic = useCallback(async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${apiBase}/v1/branding/public`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<BrandingConfig>;
      const next = { ...DEFAULT_BRANDING, ...data };
      setBrandingState(next);
      applyBranding(next);
    } catch {
      // Falha silenciosa — mantém defaults.
    }
  }, []);

  useEffect(() => {
    applyBranding(branding);
    fetchPublic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBranding = useCallback((patch: Partial<BrandingConfig>) => {
    setBrandingState((prev) => {
      const next = { ...prev, ...patch };
      applyBranding(next);
      return next;
    });
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, setBranding, reload: fetchPublic }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}

export const THEME_PRESETS: { value: ThemePreset; label: string; description: string }[] = [
  { value: "modern", label: "Modern", description: "Inter, glassmorphism, gradientes suaves (Linear/Vercel)" },
  { value: "classic", label: "Classic", description: "Serif, sóbrio, bordas suaves, corporativo" },
  { value: "standard", label: "Standard", description: "Geist/shadcn neutro padrão" },
  { value: "minimal", label: "Minimal", description: "Ultra clean, sem sombras, monocromático" },
];
