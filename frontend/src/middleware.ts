import { NextRequest, NextResponse } from "next/server";

// País → idioma. Espanhol cobre América Latina, Inglês é o fallback global.
const COUNTRY_LANG: Record<string, string> = {
  // Português
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", CV: "pt", GW: "pt", ST: "pt", TL: "pt",
  // Espanhol
  ES: "es", MX: "es", AR: "es", CO: "es", PE: "es", VE: "es", CL: "es",
  EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es",
  SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", GQ: "es",
};

const SUPPORTED = ["pt", "en", "es"];
const COOKIE = "sc-lang";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Usuário já escolheu idioma manualmente → respeitar e não sobrescrever.
  const existing = req.cookies.get(COOKIE)?.value;
  if (existing && SUPPORTED.includes(existing)) return res;

  // Override de teste: ?_country=US  (remover em produção ou restringir por env)
  const testCountry = req.nextUrl.searchParams.get("_country")?.toUpperCase();

  // 1. Cloudflare CF-IPCountry (sem custo, sem rate-limit, sem terceiro)
  const cfCountry =
    testCountry ||
    req.headers.get("cf-ipcountry") ||
    req.headers.get("CF-IPCountry");

  let lang: string | undefined;
  if (cfCountry && cfCountry !== "XX") {
    lang = COUNTRY_LANG[cfCountry] ?? "en";
  }

  // 2. Fallback: Accept-Language do browser
  if (!lang) {
    const accept = req.headers.get("accept-language") ?? "";
    const primary = accept.split(",")[0]?.split(/[-_]/)[0]?.toLowerCase();
    lang = SUPPORTED.includes(primary) ? primary : "pt";
  }

  res.cookies.set(COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 ano
    sameSite: "lax",
    httpOnly: false, // precisa ser legível no client
  });

  return res;
}

export const config = {
  // Exclui assets estáticos e rotas de API internas
  matcher: ["/((?!_next/static|_next/image|favicon|api/).*)"],
};
