import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rotas públicas: apenas /login e callbacks internos do NextAuth
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth");

  if (isPublic) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Aplica middleware em todas as rotas exceto assets estáticos:
     * - _next/static
     * - _next/image
     * - favicon.ico, robots.txt, sitemap.xml
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
