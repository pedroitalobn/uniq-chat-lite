import type { NextAuthConfig } from "next-auth";

/**
 * Configuração edge-safe do NextAuth (sem imports Node.js/axios).
 * Usada pelo proxy.ts que roda no Edge Runtime.
 * Os providers (que usam axios) ficam apenas em auth.ts.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Rotas públicas: apenas /login e callbacks do NextAuth
      const isPublic =
        pathname === "/login" ||
        pathname.startsWith("/api/auth");

      if (isPublic) return true;
      if (isLoggedIn) return true;

      // Não autenticado em rota protegida → redireciona para /login
      return false;
    },
  },
  providers: [], // Providers (com axios) ficam em auth.ts
};
