import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "super_admin" | "customer" | "lead";
      is_beta?: boolean;
      plan?: Record<string, unknown>;
    };
  }

  interface User {
    role: "super_admin" | "customer" | "lead";
    is_beta?: boolean;
    plan?: Record<string, unknown>;
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    role?: string;
    is_beta?: boolean;
    plan?: unknown;
    userId?: string;
    username?: string;
  }
}
