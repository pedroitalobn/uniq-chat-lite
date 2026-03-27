"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import { PreferencesProvider } from "@/lib/preferences";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          {children}
          <Toaster
            theme="system"
            position="top-right"
            richColors
            closeButton
          />
        </PreferencesProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
