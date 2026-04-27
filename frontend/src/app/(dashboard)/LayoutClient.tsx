"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, instancesApi } from "@/lib/api";

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  // Full-width: rotas que precisam do espaço todo (inbox messenger-style,
  // CRM com kanban/laterais, etc). Demais páginas seguem o padding padrão
  // mas sem o cap de max-w-6xl — laterais ganham espaço pra reorganizar
  // conteúdo ao invés de ficar tudo empilhado verticalmente.
  // /uniq-ai e /journeys ocupam viewport inteiro pra render do chat
  // estilo Claude e da lista/atividade lado-a-lado sem max-w cap.
  const isFullWidth =
    pathname === "/uniq-ai" ||
    pathname === "/journeys" ||
    pathname.startsWith("/journeys/") ||
    pathname === "/inbox" ||
    pathname.startsWith("/inbox/") ||
    pathname === "/crm" ||
    pathname.startsWith("/crm/");

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

  // Auto-reconnect disconnected instances ONCE per session.
  // Without the ref guard this re-fired every time the instances query
  // refetched (every poll), and since each reconnect leaves the row in
  // "connecting", the next refetch would trigger another reconnect — a
  // tight 2s loop that hammered the backend and never let pairing settle.
  const hasAutoReconnected = useRef(false);
  useEffect(() => {
    if (hasAutoReconnected.current) return;
    if (!instances || instances.length === 0) return;

    const disconnected = instances.filter(
      (i: any) => (i.channel === "whatsapp" || !i.channel) && i.status === "disconnected"
    );
    if (disconnected.length === 0) return;

    hasAutoReconnected.current = true;
    console.log("[Layout] Auto-reconnecting", disconnected.length, "instances");

    disconnected.forEach((inst: any, idx: number) => {
      setTimeout(() => {
        instancesApi.reconnect(inst.id).catch(() => {});
      }, idx * 500);
    });

    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["instances"] });
    }, disconnected.length * 500 + 3000);
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

  // Listener pro evento "instance-stale" disparado pelo interceptor axios
  // quando bate 404 em /v1/instances/<id>/*. Invalida o cache de instances
  // pra forçar refresh — sem isso o user fica preso vendo "instância não
  // encontrada" mesmo a lista estando errada no client.
  useEffect(() => {
    function onStale() {
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["instances-for-inbox"] });
    }
    window.addEventListener("uniq:instance-stale", onStale);
    return () => window.removeEventListener("uniq:instance-stale", onStale);
  }, [qc]);

  if (sessionLoading) {
    return (
      <main className="flex-1 overflow-hidden">
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
      <main className="flex-1 overflow-hidden">
        <div className="px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">
          {children}
        </div>
      </main>
    );
  }

  // Default — sem max-w cap, mas com padding consistente em todos os
  // breakpoints. Laterais ganham espaço; conteúdo que precisa de leitura
  // confortável usa max-w no próprio componente (ex: settings forms).
  return (
    <main className="flex-1 overflow-hidden">
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">
        {children}
      </div>
    </main>
  );
}
