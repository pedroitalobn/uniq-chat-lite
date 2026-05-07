"use client";

// Página dedicada de Funis. Antes o gerenciamento ficava só dentro
// de /crm/contacts (modal acessível pelo botão "Gerenciar funis"),
// mas funis são compartilhados entre Contatos, Deals e CRM —
// faz sentido ter rota própria + entrada na sidebar pra qualquer
// página chegar com 1 clique.
//
// O componente FunnelManagerPanel vive em components/crm e
// é o mesmo usado no modal antigo (/crm/contacts mantém o
// modal como atalho rápido).

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { FunnelManagerPanel } from "@/components/crm/FunnelManager";

export default function FunnelsPage() {
  const { currentWorkspace } = useWorkspace();
  return (
    <div className="p-6 h-full overflow-y-auto">
      <FunnelManagerPanel workspaceId={currentWorkspace?.id} />
    </div>
  );
}
