"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import { PreferencesProvider } from "@/lib/preferences";
import { WebSocketProvider } from "@/contexts/WebSocketContext";

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
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <WebSocketProvider>
            {children}
            <Toaster
              theme="system"
              position="top-right"
              richColors
              closeButton
            />
          </WebSocketProvider>
        </PreferencesProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
