import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next.js 16 exige default export ou named export "proxy".
// Usamos apenas authConfig (edge-safe, sem axios/providers) para
// validar o JWT do cookie no Edge Runtime.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // Aplica o proxy em todas as rotas EXCETO assets estáticos do Next.js
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
