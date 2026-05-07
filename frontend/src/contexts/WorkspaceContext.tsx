"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspacesApi } from "@/lib/api";
import type { Workspace } from "@/types";

const LS_KEY = "uniq.currentWorkspaceId";

interface WorkspaceContextType {
  currentWorkspace: Workspace | null;
  setCurrentWorkspace: (ws: Workspace | null) => void;
  workspaces: Workspace[];
  isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  currentWorkspace: null,
  setCurrentWorkspace: () => {},
  workspaces: [],
  isLoading: true,
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentWorkspace, setCurrentWorkspaceState] = useState<Workspace | null>(null);

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => workspacesApi.list().then((r) => r.data.workspaces || r.data),
    // Refetch quando a aba volta a ficar visível — cobre o caso "aceitei
    // convite em outra aba e voltei pro app". Antes ficava 5min cacheado.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Persiste o ID em localStorage assim que muda — interceptor global
  // do api client usa isso pra injetar X-Workspace-ID em TODA request,
  // independente da página passar header explícito ou não. Antes, se
  // o componente não montasse o header manualmente, o backend respondia
  // 400 "X-Workspace-ID é obrigatório".
  const setCurrentWorkspace = (ws: Workspace | null) => {
    setCurrentWorkspaceState(ws);
    if (typeof window !== "undefined") {
      if (ws?.id) localStorage.setItem(LS_KEY, ws.id);
      else localStorage.removeItem(LS_KEY);
    }
  };

  // Auto-select: prefere o workspace persistido em localStorage; se
  // não bate com nenhum disponível, cai no primeiro da lista.
  useEffect(() => {
    if (isLoading || workspaces.length === 0 || currentWorkspace) return;
    const persistedId = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    const restored = persistedId ? workspaces.find((w) => w.id === persistedId) : null;
    setCurrentWorkspace(restored ?? workspaces[0]);
  }, [isLoading, workspaces, currentWorkspace]);

  return (
    <WorkspaceContext.Provider
      value={{
        currentWorkspace,
        setCurrentWorkspace,
        workspaces,
        isLoading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
