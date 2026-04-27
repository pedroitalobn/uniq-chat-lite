import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GithubProvider from "next-auth/providers/github";
import axios from "axios";
import { authConfig } from "@/auth.config";

// API_URL (server-side): usa hostname interno do Docker em produção.
// NEXT_PUBLIC_API_URL (client-side): domínio externo para o browser.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  "http://localhost:8080";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // ── Email / Username + Password ────────────────────────────────────────
    CredentialsProvider({
      id: "credentials",
      name: "Email ou Username",
      credentials: {
        identifier:     { label: "Email ou Username", type: "text" },
        password:       { label: "Senha", type: "password" },
        // 2FA: quando o /login pede código, o cliente repete a chamada com
        // challenge_token + code (sem identifier/password). authorize
        // detecta esse caso e usa /auth/2fa/verify direto.
        challenge_token: { label: "2FA Challenge", type: "text" },
        code:            { label: "Código TOTP", type: "text" },
      },
      async authorize(credentials) {
        // Caso 2: cliente já tem challenge_token + code (segunda etapa do 2FA).
        if (credentials?.challenge_token && credentials?.code) {
          try {
            const r = await axios.post(`${API_URL}/auth/2fa/verify`, {
              challenge_token: credentials.challenge_token,
              code: credentials.code,
            });
            const { access_token, user } = r.data;
            return {
              id: user.id, name: user.name, email: user.email,
              username: user.username, role: user.role, plan: user.plan,
              accessToken: access_token,
            };
          } catch {
            return null;
          }
        }
        // Caso 1: login normal por senha.
        if (!credentials?.identifier || !credentials?.password) return null;
        try {
          const response = await axios.post(`${API_URL}/auth/login`, {
            identifier: credentials.identifier,
            password: credentials.password,
          });
          // 2FA exigido — backend retorna 202 com challenge_token. Sinalizamos
          // pro frontend via Error.message no formato "REQUIRES_2FA::<token>".
          if (response.status === 202 && response.data?.requires_2fa) {
            throw new Error(`REQUIRES_2FA::${response.data.challenge_token}`);
          }
          const { access_token, user } = response.data;
          return {
            id: user.id, name: user.name, email: user.email,
            username: user.username, role: user.role, plan: user.plan,
            accessToken: access_token,
          };
        } catch (error: unknown) {
          if (error instanceof Error && error.message.startsWith("REQUIRES_2FA::")) {
            throw error;
          }
          if (axios.isAxiosError(error)) {
            const status = error.response?.status || 0;
            // 202 vem aqui se axios validateStatus default rejeitar — checa data
            if (status === 202 && error.response?.data?.requires_2fa) {
              throw new Error(`REQUIRES_2FA::${error.response.data.challenge_token}`);
            }
            if (status === 400 || status === 401) {
              return null;
            }
            const msg = error.response?.data?.error || "Erro ao autenticar";
            throw new Error(msg);
          }
          throw new Error("Erro de conexão");
        }
      },
    }),

    // ── Anthropic API Key (legacy) ─────────────────────────────────────────
    CredentialsProvider({
      id: "anthropic-key",
      name: "Anthropic API Key",
      credentials: {
        anthropicApiKey: { label: "Anthropic API Key", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.anthropicApiKey) return null;
        try {
          const response = await axios.post(
            `${API_URL}/auth/login`,
            { anthropic_api_key: credentials.anthropicApiKey },
            { withCredentials: false }
          );
          const { access_token, user } = response.data;
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            plan: user.plan,
            accessToken: access_token,
          };
        } catch (error: unknown) {
          if (axios.isAxiosError(error)) {
            const status = error.response?.status || 0;
            if (status === 400 || status === 401) {
              return null;
            }
            const msg = error.response?.data?.error || "Falha ao autenticar";
            throw new Error(msg);
          }
          throw new Error("Erro de conexão");
        }
      },
    }),

    // ── Google OAuth ───────────────────────────────────────────────────────
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })]
      : []),

    // ── GitHub OAuth ───────────────────────────────────────────────────────
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [GithubProvider({
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        })]
      : []),
  ],

  callbacks: {
    async signIn({ user, account }) {
      // For OAuth providers, create/login the user on our backend
      if (account?.provider === "google" || account?.provider === "github") {
        try {
          const response = await axios.post(`${API_URL}/auth/login`, {
            identifier: user.email,
            // Use a deterministic password derived from provider + sub
            oauth_provider: account.provider,
            oauth_token: account.access_token,
          });
          const { access_token, user: backendUser } = response.data;
          user.id = backendUser.id;
          (user as unknown as Record<string, unknown>).accessToken = access_token;
          (user as unknown as Record<string, unknown>).role = backendUser.role;
          (user as unknown as Record<string, unknown>).is_beta = backendUser.is_beta;
          (user as unknown as Record<string, unknown>).plan = backendUser.plan;
        } catch {
          // Allow sign-in even if backend sync fails — token won't have role/plan
        }
      }
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as Record<string, unknown>;
        token.accessToken = u.accessToken as string;
        token.role = u.role as string;
        token.is_beta = u.is_beta as boolean;
        token.plan = u.plan;
        token.userId = user.id;
        token.username = u.username as string;
      }
      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.user.role = token.role as "super_admin" | "customer";
      session.user.is_beta = token.is_beta as boolean;
      session.user.plan = token.plan as Record<string, unknown>;
      session.user.id = token.userId as string;
      (session.user as unknown as Record<string, unknown>).username = token.username;
      return session;
    },
  },

  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },

  secret: process.env.NEXTAUTH_SECRET,
});
