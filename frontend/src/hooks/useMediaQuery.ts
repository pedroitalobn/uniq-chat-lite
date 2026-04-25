"use client";

import { useEffect, useState } from "react";

// useMediaQuery — listener leve pra reagir a media queries em runtime.
// Default initial=false pra SSR não divergir do primeiro paint client.
export function useMediaQuery(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(initial);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 usa addListener; modernos usam addEventListener
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    } else {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, [query]);

  return matches;
}

// Atalhos pra os breakpoints Tailwind padrão.
export const useIsMobile = () => useMediaQuery("(max-width: 1023px)");
export const useIsTablet = () => useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
