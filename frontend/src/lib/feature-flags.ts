// White-label feature flags. Cada flag oculta o módulo do menu e bloqueia
// a rota no middleware. O código de cada módulo permanece intacto — só fica
// inacessível pela UI. Para habilitar, setar a env correspondente como "true".

const truthy = (v: string | undefined) => v === "true" || v === "1";

export const features = {
  shops: truthy(process.env.NEXT_PUBLIC_ENABLE_SHOPS),
  helpdesk: truthy(process.env.NEXT_PUBLIC_ENABLE_HELPDESK),
  billing: truthy(process.env.NEXT_PUBLIC_ENABLE_BILLING),
  usage: truthy(process.env.NEXT_PUBLIC_ENABLE_USAGE),
} as const;

export type FeatureKey = keyof typeof features;

// Mapa rota → flag. Usado pelo middleware e por componentes que querem
// renderizar condicionalmente links externos ao SidebarDock.
export const ROUTE_FEATURE_MAP: Record<string, FeatureKey> = {
  "/shops": "shops",
  "/help-desk": "helpdesk",
  "/billing": "billing",
  "/usage": "usage",
};

export function isRouteEnabled(pathname: string): boolean {
  for (const [prefix, key] of Object.entries(ROUTE_FEATURE_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return features[key];
    }
  }
  return true;
}
