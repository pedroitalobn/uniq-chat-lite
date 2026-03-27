import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Usa apenas a config edge-safe (sem axios/Node.js).
// O NextAuth com providers: [] valida o JWT do cookie sem precisar
// chamar nenhum provider externo — funciona 100% no Edge Runtime.
export const { auth: proxy } = NextAuth(authConfig);

export const config = {
  matcher: [
    // Aplica o proxy em todas as rotas EXCETO assets estáticos do Next.js
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
