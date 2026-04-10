"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, instancesApi } from "@/lib/api";

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isFullWidth = pathname === "/inbox";

  // Fetch session and load instances on mount
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        const res = await authApi.me();
        return res.data;
      } catch {
        router.push("/login");
        return null;
      }
    },
    retry: false,
  });

  // Load instances when session is available
  const { data: instances } = useQuery({
    queryKey: ["instances"],
    queryFn: async () => {
      try {
        const res = await instancesApi.list();
        return res.data;
      } catch {
        return [];
      }
    },
    enabled: !!sessionData,
    staleTime: 30000,
  });

  // Auto-reconnect disconnected instances on mount
  useEffect(() => {
    if (!instances || instances.length === 0) return;
    
    const disconnected = instances.filter(
      (i: any) => i.status === "disconnected" || i.status === "connecting"
    );
    
    if (disconnected.length > 0) {
      console.log("[Layout] Auto-reconnecting", disconnected.length, "instances");
      
      disconnected.forEach((inst: any, idx: number) => {
        setTimeout(() => {
          instancesApi.reconnect(inst.id).catch(() => {});
        }, idx * 500);
      });

      // Refresh after reconnects
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["instances"] });
      }, disconnected.length * 500 + 3000);
    }
  }, [instances, qc]);

  // Refresh inbox chats when instances are loaded
  useEffect(() => {
    if (!instances || instances.length === 0) return;
    
    const connectedInstances = instances.filter((i: any) => i.status === "connected");
    
    if (connectedInstances.length > 0 && pathname === "/inbox") {
      console.log("[Layout] Refreshing inbox for", connectedInstances.length, "instances");
      qc.invalidateQueries({ queryKey: ["chats"] });
    }
  }, [instances, pathname, qc]);

  if (sessionLoading) {
    return (
      <main className="flex-1 overflow-hidden bg-dot-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Carregando...</span>
          </div>
        </div>
      </main>
    );
  }

  if (isFullWidth) {
    return (
      <main className="flex-1 overflow-hidden bg-dot-grid">
        <div className="px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">
          {children}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-hidden bg-dot-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">
        {children}
      </div>
    </main>
  );
}
