"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspacesApi } from "@/lib/api";
import type { Workspace } from "@/types";

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
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => workspacesApi.list().then((r) => r.data.workspaces || r.data),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Auto-select first workspace if none selected
  useEffect(() => {
    if (!isLoading && workspaces.length > 0 && !currentWorkspace) {
      setCurrentWorkspace(workspaces[0]);
    }
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
