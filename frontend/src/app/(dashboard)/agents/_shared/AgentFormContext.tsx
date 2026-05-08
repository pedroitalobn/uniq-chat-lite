"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAgentForm } from "./useAgentForm";

// Context que expõe o estado do form do agente pra Studio e Settings.
// O layout do agente usa o hook uma vez e provê pra todos os filhos —
// evita refetch duplicado e mantém a edição compartilhada (Save no
// header pega mudanças feitas em qualquer página).
type Ctx = ReturnType<typeof useAgentForm> & { instanceId: string; agentId: string };

const AgentFormCtx = createContext<Ctx | null>(null);

export function AgentFormProvider({
  instanceId,
  agentId,
  children,
}: {
  instanceId: string;
  agentId: string;
  children: ReactNode;
}) {
  const form = useAgentForm(instanceId, agentId);
  return (
    <AgentFormCtx.Provider value={{ ...form, instanceId, agentId }}>
      {children}
    </AgentFormCtx.Provider>
  );
}

export function useAgentFormContext() {
  const ctx = useContext(AgentFormCtx);
  if (!ctx) throw new Error("useAgentFormContext deve ser usado dentro de <AgentFormProvider>");
  return ctx;
}
